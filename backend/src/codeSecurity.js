import path from 'path';
import fs from 'node:fs/promises';
import { pool } from './db/client.js';
import { tableExists } from './db/utils.js';
import { readAbapProgramSource } from './sap.js';

// ── Code Security ─────────────────────────────────────────────────────────────
// All the artifacts live in the "CodeSecurity" folder at the application root:
//
//   CodeSecurity/
//   ├── codeSecurityChecks.txt          <- check definitions (key=value rows)
//   ├── codeSecurityChecksExample.txt   <- sample delivered with the project:
//   │                                      copied to codeSecurityChecks.txt when
//   │                                      that file is missing
//   └── <PROGRAM_NAME>/                 <- one folder per downloaded program
//       ├── <PROGRAM_NAME>.txt          <- ABAP source of the program
//       └── <INCLUDE_NAME>.txt          <- ABAP source of every include found
//
// The folder tree is created automatically if missing.

export const CODE_SECURITY_ROOT = path.join(process.cwd(), 'CodeSecurity'); //WARNING! to be fixed for issue #39
const CHECKS_FILE_NAME = 'codeSecurityChecks.txt';
const EXAMPLE_CHECKS_FILE_NAME = 'codeSecurityChecksExample.txt';

// Default content written when BOTH codeSecurityChecks.txt and
// codeSecurityChecksExample.txt are missing.
const DEFAULT_CHECKS_FILE_CONTENT = [
  'ID=001',
  'TEXT=check userid hardcoded in ABAP',
  'SEARCH_STRING=if. sy-uname eq',
  'EXCEPTION=*DDIC*',
  'IS_DEFECTIVE=TRUE',
  '',
  ''
].join('\r\n');

function getChecksFilePath() {
  return path.join(CODE_SECURITY_ROOT, CHECKS_FILE_NAME);
}

function getExampleChecksFilePath() {
  return path.join(CODE_SECURITY_ROOT, EXAMPLE_CHECKS_FILE_NAME);
}

// Keeps folder / file names safe on every platform (ABAP names are normally
// [A-Z0-9_], namespaces may contain slashes: they are flattened to '_').
function sanitizeFileName(name) {
  return String(name || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'UNNAMED';
}

// ── Folders ───────────────────────────────────────────────────────────────────

export async function ensureCodeSecurityDirs() {
  await fs.mkdir(CODE_SECURITY_ROOT, { recursive: true });
}

// ── Checks config file ────────────────────────────────────────────────────────

// Pure parser: key=value rows grouped into check records.
// A new record starts at "ID=" ; SEARCH_STRING= and EXCEPTION= may repeat
// (multi-line lists: every row is appended). Unknown keys are ignored.
export function parseChecksContent(content) {
  const checks = [];
  let current = null;

  const lines = String(content || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim().toUpperCase();
    const value = line.slice(eqIndex + 1).trim();

    if (key === 'ID') {
      // start of a new record
      if (current && current.id) checks.push(current);
      current = { id: value, text: '', searchStrings: [], exceptions: [], isDefective: false };
      continue;
    }
    if (!current) continue;

    if (key === 'TEXT') current.text = value;
    else if (key === 'SEARCH_STRING') { if (value) current.searchStrings.push(value); }
    else if (key === 'EXCEPTION') { if (value) current.exceptions.push(value); }
    else if (key === 'IS_DEFECTIVE') current.isDefective = value.toUpperCase() === 'TRUE';
  }

  if (current && current.id) checks.push(current);

  // keep only complete records
  return checks.filter((c) => c.id && c.searchStrings.length > 0);
}

export async function readCodeSecurityChecks() {
  await ensureCodeSecurityDirs();
  const filePath = getChecksFilePath();

  let content;
  try {
    content = await fs.readFile(filePath, 'utf8');
  } catch {
    // codeSecurityChecks.txt is missing:
    //   1. seed it from the delivered example file (codeSecurityChecksExample.txt)
    //   2. fall back to the built-in sample check when the example is missing too
    try {
      content = await fs.readFile(getExampleChecksFilePath(), 'utf8');
      await fs.writeFile(filePath, content, 'utf8');
    } catch {
      content = DEFAULT_CHECKS_FILE_CONTENT;
      await fs.writeFile(filePath, content, 'utf8');
    }
  }

  const checks = parseChecksContent(content);
  // display label: ID-TEXT (as required by the frontend)
  return checks.map((c) => ({ ...c, label: `${c.id}-${c.text}` }));
}

// ── DB results table ──────────────────────────────────────────────────────────

export async function ensureCodeSecurityResultsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS code_security_results (
      id BIGSERIAL PRIMARY KEY,
      program TEXT NOT NULL,
      check_id TEXT NOT NULL,
      result TEXT NOT NULL,
      occurrences INTEGER NOT NULL DEFAULT 0,
      ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_code_security_results_lookup
    ON code_security_results (check_id, program)
  `);
}

export async function getCodeSecurityResults(limit = 100, offset = 0) {
  if (!(await tableExists('code_security_results'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM code_security_results`)).rows[0].c);
  const res = await pool.query(
    `SELECT id, program, check_id, result, occurrences, ran_at
     FROM code_security_results
     ORDER BY check_id, program
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { rows: res.rows, total };
}

// ── Program search (TADIR) ────────────────────────────────────────────────────

// Converts the user pattern into a SQL ILIKE pattern:
//   * -> %   (any sequence of characters, SAP style)
//   + -> _   (exactly one character, SAP style)
// Typed % and _ keep working as PostgreSQL wildcards.
export function convertPatternToSql(pattern) {
  return String(pattern || '').trim().replace(/\*/g, '%').replace(/\+/g, '_');
}

export async function searchTadirPrograms(realm, pattern, limit = 500) {
  const tableName = `sap_raw_${String(realm || '').toLowerCase()}_tadir`;
  if (!(await tableExists(tableName))) {
    throw new Error(`Table '${tableName}' not found. Import the SAP table TADIR first.`);
  }

  const likePattern = convertPatternToSql(pattern);
  if (!likePattern) return { rows: [], total: 0, truncated: false };

  const fetchLimit = Number(limit) + 1;
  let rows;
  try {
    const res = await pool.query(
      `SELECT pgmid, object, obj_name, devclass, author
       FROM "${tableName}"
       WHERE lower(object) = 'prog' AND obj_name ILIKE $1
       ORDER BY obj_name
       LIMIT $2`,
      [likePattern, fetchLimit]
    );
    rows = res.rows;
  } catch (err) {
    // fallback for TADIR imports with a reduced column set
    const res = await pool.query(
      `SELECT pgmid, object, obj_name
       FROM "${tableName}"
       WHERE lower(object) = 'prog' AND obj_name ILIKE $1
       ORDER BY obj_name
       LIMIT $2`,
      [likePattern, fetchLimit]
    );
    rows = res.rows;
  }

  const truncated = rows.length > Number(limit);
  return {
    rows: truncated ? rows.slice(0, Number(limit)) : rows,
    total: truncated ? `>${Number(limit)}` : rows.length,
    truncated
  };
}

// ── Source download (RFC RPY_PROGRAM_READ, recursive on includes) ─────────────

// Downloads the ABAP source of `rootProgram` and of every include found,
// recursively. Every source is saved as:
//   CodeSecurity/<rootProgram>/<programOrIncludeName>.txt
// The traversal is protected against circular include graphs (visited set).
export async function downloadProgramSource(sapConfig, rootProgram, onProgress = null) {
  const program = String(rootProgram || '').trim();
  if (!program) throw new Error('Program name is required');

  await ensureCodeSecurityDirs();

  // one single folder per requested (root) program: includes are saved there too
  const programDir = path.join(CODE_SECURITY_ROOT, sanitizeFileName(program));
  await fs.mkdir(programDir, { recursive: true });

  const visited = new Set();
  const files = [];
  const errors = [];
  let downloaded = 0;

  const notify = (payload) => {
    if (typeof onProgress === 'function') {
      try { onProgress(payload); } catch { /* progress callbacks must never break the download */ }
    }
  };

  async function recurse(programName) {
    const name = String(programName || '').trim().toUpperCase();
    if (!name || visited.has(name)) return;
    visited.add(name);

    notify({ type: 'progress', program: name, downloaded, errors: errors.length });

    try {
      const { source, includes } = await readAbapProgramSource(sapConfig, name);
      const fileName = `${sanitizeFileName(name)}.txt`;
      await fs.writeFile(path.join(programDir, fileName), source, 'utf8');
      files.push(fileName);
      downloaded += 1;

      notify({ type: 'progress', program: name, downloaded, errors: errors.length, includes: includes.length });

      // recursive step: download every include with the same parameters
      for (const inc of includes) {
        await recurse(inc);
      }
    } catch (err) {
      errors.push({ program: name, error: err?.message || String(err) });
    }
  }

  await recurse(program);

  return {
    program,
    folder: programDir,
    files,
    downloaded,
    errors,
    visited: visited.size
  };
}

// Downloads the ABAP source of EVERY program in `programNames` (typically the
// rows listed in the frontend "Found programs" table — NOT the textbox value).
// One sub-folder per downloaded program:
//   CodeSecurity/<PROGRAM>/<programOrIncludeName>.txt
// Programs are processed sequentially; a failing program never stops the batch.
// Progress payloads (when onProgress is provided):
//   { type:'progress', programIndex, totalPrograms, rootProgram, program,
//     downloaded, includes, batchDownloaded, batchErrors }
export async function downloadProgramsSource(sapConfig, programNames, onProgress = null) {
  const list = (Array.isArray(programNames) ? programNames : [])
    .map((p) => String(p || '').trim().toUpperCase())
    .filter(Boolean);
  const unique = [...new Set(list)];
  if (!unique.length) {
    throw new Error('No programs to download: run a search first (the download processes the programs listed in the results table)');
  }

  await ensureCodeSecurityDirs();

  const notify = (payload) => {
    if (typeof onProgress === 'function') {
      try { onProgress(payload); } catch { /* progress callbacks must never break the download */ }
    }
  };

  const programs = [];
  const errors = [];
  let batchDownloaded = 0;

  for (let i = 0; i < unique.length; i++) {
    const rootProgram = unique[i];

    notify({
      type: 'progress',
      programIndex: i + 1,
      totalPrograms: unique.length,
      rootProgram,
      program: rootProgram,
      downloaded: 0,
      batchDownloaded,
      batchErrors: errors.length
    });

    const r = await downloadProgramSource(sapConfig, rootProgram, (p) => notify({
      ...p,
      programIndex: i + 1,
      totalPrograms: unique.length,
      rootProgram,
      batchDownloaded: batchDownloaded + (p.downloaded || 0),
      batchErrors: errors.length
    }));

    batchDownloaded += r.downloaded;
    for (const e of r.errors) errors.push({ ...e, rootProgram });
    programs.push({
      program: rootProgram,
      folder: r.folder,
      files: r.files,
      downloaded: r.downloaded,
      errors: r.errors
    });
  }

  return {
    programs,
    folders: programs.length,
    downloaded: batchDownloaded,
    errors
  };
}

// ── Checks execution ──────────────────────────────────────────────────────────

// Converts a SAP-style wildcard pattern into a case-insensitive RegExp:
//   * -> any sequence of characters (also across newlines)
//   + -> exactly one character
// Every other regex special char is escaped (kept literal).
// Returns null for empty patterns.
export function wildcardToRegExp(pattern, globalFlag = false) {
  // 1. escape every regex special char (so . ( ) [ ] ecc. in ABAP stay literal)
  const escaped = String(pattern || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!escaped) return null;

  // 2. SAP wildcards: * -> .*   + -> .   (the dotAll flag makes them match \n too)
  const regexSource = escaped.replace(/\\\*/g, '.*').replace(/\\\+/g, '.');

  // 3. case-insensitive (+ global when the caller needs every match)
  return new RegExp(regexSource, globalFlag ? 'gis' : 'i');
}

// Case-insensitive occurrence counter with SAP wildcards:
//   * -> any sequence of characters (also across newlines)
//   + -> exactly one character
export function countOccurrences(content, searchString) {
  const re = wildcardToRegExp(searchString, true);
  if (!re) return 0;

  const matches = String(content || '').match(re);
  return matches ? matches.length : 0;
}

// Removes ABAP comments:
//   - full-line comments: lines whose FIRST character is * (ABAP rule: col. 1)
//   - inline comments: everything after an unquoted " on the line
// (a " inside a single-quote literal is preserved)
export function stripAbapComments(content) {
  return String(content || '')
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*\*/.test(line)) return '';              // full-line comment
      let inLiteral = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === "'") inLiteral = !inLiteral;         // '' doubling works with toggle
        else if (ch === '"' && !inLiteral) return line.slice(0, i); // inline comment
      }
      return line;
    })
    .join('\n');
}

// Removes every line matching one of the EXCEPTION patterns
// (case-insensitive, SAP wildcards allowed): occurrences of the SEARCH_STRING
// falling on those lines are never counted (e.g. "if sy-uname = 'DDIC'").
// Accepts the already-compiled EXCEPTION RegExps.
export function removeExceptionLines(content, exceptionRegExps) {
  const regexes = Array.isArray(exceptionRegExps) ? exceptionRegExps.filter(Boolean) : [];
  if (!regexes.length) return String(content || '');
  return String(content || '')
    .split(/\r?\n/)
    .filter((line) => !regexes.some((re) => re.test(line)))
    .join('\n');
}

// Semaphore rule:
//   RED   = string found and IS_DEFECTIVE is TRUE
//           or string NOT found, IS_DEFECTIVE is FALSE and no EXCEPTION matched
//   GREEN = otherwise (an EXCEPTION match acts as a result inverter)
export function computeSemaphore(found, isDefective, exceptionHit = false) {
  const defective = isDefective === true || String(isDefective).toUpperCase() === 'TRUE';
  return (found && defective) || (!found && !defective && !exceptionHit) ? 'RED' : 'GREEN';
}

// Lists the downloaded program folders (one folder per program).
export async function listDownloadedProgramFolders() {
  await ensureCodeSecurityDirs();
  const entries = await fs.readdir(CODE_SECURITY_ROOT, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
}

// Runs a single check against ALL downloaded program folders:
// every SEARCH_STRING of the check is looked up in every .txt file of each
// folder (comments stripped; lines matching an EXCEPTION pattern are skipped).
// EXCEPTION also acts as a result inverter: if any EXCEPTION pattern is found
// in the program and IS_DEFECTIVE is FALSE, the check cannot be RED.
// One result row per program is stored in code_security_results.
export async function runCodeSecurityCheck(check) {
  await ensureCodeSecurityResultsTable();

  if (!check || !check.id || !check.searchStrings?.length) {
    throw new Error('Invalid check: id and at least one SEARCH_STRING are required');
  }

  // compile the EXCEPTION patterns once for the whole check run
  const exceptionRegExps = (check.exceptions || [])
    .map((ex) => wildcardToRegExp(ex))
    .filter(Boolean);

  const programFolders = await listDownloadedProgramFolders();
  const rows = [];

  for (const folder of programFolders) {
    const folderPath = path.join(CODE_SECURITY_ROOT, folder);
    const entries = await fs.readdir(folderPath, { withFileTypes: true });
    const txtFiles = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.txt'))
      .map((e) => e.name);

    let occurrences = 0;
    let exceptionHit = false;
    for (const fileName of txtFiles) {
      const stripped = stripAbapComments(
        await fs.readFile(path.join(folderPath, fileName), 'utf8')
      );

      // does any EXCEPTION pattern occur in the program?
      // (inverts the result for IS_DEFECTIVE=FALSE checks)
      if (!exceptionHit && exceptionRegExps.length) {
        exceptionHit = exceptionRegExps.some((re) => re.test(stripped));
      }

      // count the matches of every SEARCH_STRING, skipping lines
      // that match an EXCEPTION pattern (e.g. hardcoded 'DDIC' user)
      const content = removeExceptionLines(stripped, exceptionRegExps);
      for (const search of check.searchStrings) {
        occurrences += countOccurrences(content, search);
      }
    }

    const found = occurrences > 0;
    rows.push({
      program: folder,
      check_id: check.id,
      result: computeSemaphore(found, check.isDefective, exceptionHit),
      occurrences
    });
  }

  // refresh stored results for this check
  await pool.query(`DELETE FROM code_security_results WHERE check_id = $1`, [check.id]);
  for (const row of rows) {
    await pool.query(
      `INSERT INTO code_security_results (program, check_id, result, occurrences)
       VALUES ($1, $2, $3, $4)`,
      [row.program, row.check_id, row.result, row.occurrences]
    );
  }

  // check-level semaphore: red if at least one program is red
  const semaphore = rows.some((r) => r.result === 'RED') ? 'RED' : (rows.length ? 'GREEN' : null);

  return { checkId: check.id, semaphore, programs: rows.length, rows };
}

// Runs every check defined in the config file, sequentially.
export async function runAllCodeSecurityChecks() {
  const checks = await readCodeSecurityChecks();
  if (!checks.length) {
    throw new Error('No checks defined in codeSecurityChecks.txt');
  }

  const results = [];
  for (const check of checks) {
    const r = await runCodeSecurityCheck(check);
    results.push({
      checkId: check.id,
      label: check.label,
      semaphore: r.semaphore,
      programs: r.programs
    });
  }

  const redCount = results.filter((r) => r.semaphore === 'RED').length;
  const greenCount = results.filter((r) => r.semaphore === 'GREEN').length;

  return {
    total: results.length,
    redCount,
    greenCount,
    results,
    semaphores: Object.fromEntries(results.map((r) => [r.checkId, r.semaphore]))
  };
}
