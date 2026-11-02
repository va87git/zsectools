import copyStreams from 'pg-copy-streams';
import { pipeline } from 'node:stream/promises';
import { pool } from './client.js';
import { tableExists, safeColumnName } from './utils.js';

// Export/import statistics and tables to TXT files
// Export functions for TXT format
export async function exportTablesToTxt(realm, tableNames) {
  const results = [];
  for (const tableName of tableNames) {
    const sanitizedTableName = `sap_raw_${realm.toLowerCase()}_${tableName.toLowerCase()}`;

    try {
      const dataResult = await pool.query(`SELECT * FROM "${sanitizedTableName}" ORDER BY id`);

      const tableComment = `# Table: ${tableName.toUpperCase()}`;
      let typeComment = '# TYPES: ';
      let header = '';
      let rows = [];

      if (dataResult.rows.length > 0) {
        const columns = Object.keys(dataResult.rows[0]).filter(c => c !== 'id' && c !== 'imported_at');
        header = columns.join('\t');

        const typeResult = await pool.query(
          `SELECT column_name, data_type, character_maximum_length
           FROM information_schema.columns
           WHERE table_name = $1`,
          [sanitizedTableName]
        );

        const typeMap = {};
        typeResult.rows.forEach(col => {
          let typeStr = col.data_type;
          if (col.character_maximum_length) {
            typeStr += `(${col.character_maximum_length})`;
          }
          typeMap[col.column_name.toLowerCase()] = typeStr;
        });

        const typesRow = columns.map(col => typeMap[col.toLowerCase()] || 'text').join('|');
        typeComment = `# TYPES: ${typesRow}`;

        rows = dataResult.rows.map(row =>
          columns.map(col => {
            const val = row[col];
            if (val === null || val === undefined) return '';
            if (val instanceof Date) return val.toISOString();
            return String(val);
          }).join('\t')
        );
      }

      results.push({ tableName, tableComment, typeComment, header, rows, rowCount: dataResult.rows.length });
    } catch (err) {
      results.push({ tableName, tableComment: `# Table: ${tableName.toUpperCase()}`, typeComment: '# TYPES: ', header: '', rows: [], rowCount: 0, error: err.message });
    }
  }
  return results;
}

export async function exportStatisticsToTxt(realm, selectedAt = null, periodType = 'D') {
  const sanitizedTableName = 'sap_raw_user_stats';
  try {
    let query = `SELECT * FROM "${sanitizedTableName}" WHERE realm = $1`;
    const params = [realm];

    if (selectedAt) {
      query += ` AND selected_at = $2::timestamptz`;
      params.push(selectedAt);
    }

    query += ` ORDER BY id`;

    const dataResult = await pool.query(query, params);
    if (dataResult.rows.length > 0) {
      // Keep selected_at in the exported columns
      const columns = Object.keys(dataResult.rows[0]).filter(c => c !== 'id' && c !== 'realm' && c !== 'period_type' && c !== 'imported_at');
      const header = columns.join('\t');
      const rows = dataResult.rows.map(row =>
        columns.map(col => {
          const val = row[col];
          if (col === 'selected_at' && val instanceof Date) {
            return val.toISOString();
          }
          return val === null ? '' : String(val);
        }).join('\t')
      );
      // Include period_type in the file header
      return { header, rows, rowCount: dataResult.rows.length, periodType };
    }
    return { header: '', rows: [], rowCount: 0, periodType };
  } catch (err) {
    return { header: '', rows: [], rowCount: 0, periodType, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Import (FIX #46 - low performance of the TXT import)
//
// The previous implementation ran one "INSERT INTO ..." per data row
// (one network round trip + one query parse per row): importing large SAP
// tables like AGR_1251 or AGR_HIERT from TXT files took minutes or hours.
// Rows are now streamed into a single "COPY ... FROM STDIN" statement - the
// same strategy already used by the RFC import (sapImport.js) - with a
// chunked multi-row INSERT fallback that keeps the old behaviour (import the
// good rows, log and skip the bad ones) when COPY rejects the data.
// ---------------------------------------------------------------------------

// PostgreSQL hard limit: 65535 bind parameters per statement. Keep a safety margin.
const MAX_QUERY_PARAMS = 60000;
const MAX_INSERT_ROWS_PER_BATCH = 1000;

// Approximate size (in characters) of the chunks pushed into the COPY stream,
// so huge files never need to be materialized a second time in memory.
const COPY_CHUNK_CHARS = 1 << 20;

// Column types come from the uploaded TXT file: accept only safe type strings
// so a crafted file cannot inject SQL into the CREATE TABLE.
const SAFE_PG_TYPE_RE = /^[A-Za-z][A-Za-z0-9 _]*(\(\d+(,\s*\d+)?\))?$/;

function safeColumnType(type) {
  const t = String(type || '').trim().toLowerCase();
  return SAFE_PG_TYPE_RE.test(t) ? t : 'text';
}

// Escape a value for COPY ... WITH (FORMAT text). Empty values become NULL,
// exactly like the previous row-by-row INSERT implementation did.
function escapeCopyValue(value) {
  if (value === null || value === undefined || value === '') {
    return '\\N'; // NULL marker for COPY
  }

  // NUL bytes are not accepted by PostgreSQL TEXT columns: drop them
  // instead of aborting the whole COPY.
  // eslint-disable-next-line no-control-regex
  const str = String(value).replace(/\u0000/g, '');
  if (str === '') {
    return '\\N';
  }

  return str
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// Normalize one raw TXT data line into an array of values aligned with the header:
// - values are trimmed, empty ones become NULL (same rules as before);
// - rows with fewer columns are padded with NULLs, extra columns are ignored;
// - unlike the old implementation the line itself is NOT trimmed, so a row whose
//   first (or last) column is empty keeps its real position instead of shifting.
function normalizeRow(line, columnCount) {
  const rawValues = line.split('\t');
  const values = new Array(columnCount).fill(null);
  for (let i = 0; i < Math.min(rawValues.length, columnCount); i++) {
    const val = rawValues[i] ? rawValues[i].trim() : '';
    values[i] = (val === '' ? null : val);
  }
  return values;
}

// Iterate the lines of a (possibly huge) text without building the whole array of lines.
function* iterateLines(text, startOffset = 0) {
  let start = startOffset;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) {
      yield text.slice(start);
      return;
    }
    yield text.slice(start, nl);
    start = nl + 1;
  }
}

function isSkippableLine(line) {
  return /^\s*$/.test(line) || line.trimStart().startsWith('#');
}

export async function importTablesFromTxt(realm, tableName, txtContent) {
  if (typeof txtContent !== 'string' || txtContent.trim().length === 0) {
    return { imported: 0 };
  }

  // 1. Parse the metadata/header lines (a handful of lines at most).
  //    Data lines are NOT collected in memory: they are streamed straight into COPY.
  let detectedTableName = tableName;
  let columnTypes = [];
  let header = null;

  let dataOffset = 0; // character offset just after the header line
  let consumed = 0;
  for (const rawLine of iterateLines(txtContent)) {
    consumed += rawLine.length + 1; // +1 for '\n' (harmless for the last line)
    const line = rawLine.trim();
    if (line.length === 0) continue;
    if (line.startsWith('# Table:')) {
      detectedTableName = line.replace('# Table:', '').trim();
      continue;
    }
    if (line.startsWith('# TYPES:')) {
      columnTypes = line.replace('# TYPES:', '').trim().split('|');
      continue;
    }
    if (line.startsWith('#')) continue; // any other comment
    header = line.split('\t'); // the first non-comment line is the header
    dataOffset = consumed;
    break;
  }

  if (header === null || header.length === 0) return { imported: 0 };

  // 2. Table creation (same schema as before: id + imported_at + data columns)
  const sanitizedTableName = `sap_raw_${realm.toLowerCase()}_${detectedTableName.toLowerCase()}`;

  const safeColumns = header.map((col, idx) => safeColumnName(col, idx));
  const columnNames = safeColumns.map((c) => `"${c}"`).join(', ');

  if (!(await tableExists(sanitizedTableName))) {
    const columnDefs = safeColumns
      .map((col, idx) => `"${col}" ${safeColumnType(columnTypes[idx])}`)
      .join(', ');

    await pool.query(
      `CREATE TABLE "${sanitizedTableName}" (id SERIAL PRIMARY KEY, imported_at TIMESTAMPTZ DEFAULT NOW(), ${columnDefs})`
    );
  }

  // 3. Replace the content of the table (same behaviour as before)
  await pool.query(`TRUNCATE TABLE "${sanitizedTableName}"`);

  // 4. Bulk insert: stream the remaining lines into a single COPY FROM STDIN.
  try {
    const imported = await copyLinesIntoTable(sanitizedTableName, columnNames, header.length, txtContent, dataOffset);
    return { imported };
  } catch (copyErr) {
    console.warn(`[txtTransfer] COPY failed for ${sanitizedTableName} (${copyErr.message}), falling back to chunked INSERTs`);
  }

  // 5. Fallback: chunked multi-row INSERTs. Used only when COPY rejects the data
  //    (e.g. a hand-edited file with a value that does not fit a typed column):
  //    it preserves the old behaviour of importing the good rows and skipping the bad ones.
  const imported = await insertLinesInBatches(sanitizedTableName, columnNames, header.length, txtContent, dataOffset);
  return { imported };
}

// Stream all data lines (everything after the header) into COPY ... FROM STDIN.
async function copyLinesIntoTable(sanitizedTableName, columnNames, columnCount, txtContent, dataOffset) {
  const client = await pool.connect();
  let copyError = null;

  try {
    const copyCommand = `COPY "${sanitizedTableName}" (${columnNames}) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')`;
    const ingestStream = copyStreams.from(copyCommand);

    const copyPromise = new Promise((resolve, reject) => {
      ingestStream.on('finish', resolve);
      ingestStream.on('error', reject);
    });
    // If pipeline() fails first, copyPromise is never awaited: without this no-op handler
    // its rejection would be "unhandled" and Node would terminate the whole backend process.
    copyPromise.catch(() => {});

    client.query(ingestStream);

    let imported = 0;
    await pipeline(txtDataLineSource(txtContent, dataOffset, columnCount, () => imported++), ingestStream);
    await copyPromise;

    return imported;
  } catch (err) {
    copyError = err;
    throw err;
  } finally {
    // Passing the error destroys the connection instead of returning a broken one to the pool
    client.release(copyError || undefined);
  }
}

// Async generator that reads the data lines after the header, normalizes them and
// produces COPY-ready TSV chunks (~1MB each), so memory stays flat for huge files.
async function* txtDataLineSource(txtContent, dataOffset, columnCount, onRow) {
  let out = '';
  for (const line of iterateLines(txtContent, dataOffset)) {
    if (isSkippableLine(line)) continue;

    const values = normalizeRow(line, columnCount);
    out += values.map(escapeCopyValue).join('\t') + '\n';
    onRow();

    if (out.length >= COPY_CHUNK_CHARS) {
      yield out;
      out = '';
    }
  }
  if (out.length > 0) yield out;
}

// Fallback: multi-row INSERTs (with a per-row retry for failed batches).
async function insertLinesInBatches(sanitizedTableName, columnNames, columnCount, txtContent, dataOffset) {
  const rowsPerBatch = Math.max(1, Math.min(MAX_INSERT_ROWS_PER_BATCH, Math.floor(MAX_QUERY_PARAMS / columnCount)));
  let imported = 0;
  let batch = [];

  const flush = async () => {
    if (batch.length === 0) return;
    try {
      const tuples = [];
      const params = [];
      let p = 0;
      for (const values of batch) {
        const rowPlaceholders = values.map((v) => {
          p += 1;
          params.push(v);
          return `$${p}`;
        });
        tuples.push(`(${rowPlaceholders.join(', ')})`);
      }
      await pool.query(
        `INSERT INTO "${sanitizedTableName}" (${columnNames}) VALUES ${tuples.join(', ')}`,
        params
      );
      imported += batch.length;
    } catch (batchErr) {
      // One or more rows of the batch are invalid: retry the rows one by one to keep
      // the old behaviour (log and skip the bad rows, import the good ones).
      for (const values of batch) {
        try {
          const placeholders = values.map((_, idx) => `$${idx + 1}`).join(', ');
          await pool.query(
            `INSERT INTO "${sanitizedTableName}" (${columnNames}) VALUES (${placeholders})`,
            values
          );
          imported++;
        } catch (rowErr) {
          console.error('[txtTransfer] SQL error on row:', rowErr.message);
        }
      }
    }
    batch = [];
  };

  for (const line of iterateLines(txtContent, dataOffset)) {
    if (isSkippableLine(line)) continue;
    batch.push(normalizeRow(line, columnCount));
    if (batch.length >= rowsPerBatch) await flush();
  }
  await flush();

  return imported;
}
