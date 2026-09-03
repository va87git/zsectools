import { pool } from './client.js';

// SOD Tables: import from TXT, ruleset, export and cleanup
// List of expected SOD tables (logical table name -> will be created as sod_<name>)
export const SOD_EXPECTED_TABLES = [
  'sod_business_process',
  'sod_functions',
  'sod_function_actions',
  'sod_functions_business_process',
  'sod_function_permissions',
  'sod_risk_descriptions',
  'sod_risk_owners',
  'sod_risk_ruleset',
  'sod_risks',
  'sod_ruleset'
];

/**
 * Imports a single TXT file for the SOD & Audit module.
 * The file must have "#sod_table: <table_name>" as its first line, followed by
 * a header row (column names separated by tabs), and then the data rows.
 * If the table already exists, data is appended; otherwise it is created.
 */
export async function importSodTableFromTxt(txtContent) {
  const lines = txtContent.split(/\r?\n/).map(l => l.replace(/\r$/, '')).filter(l => l.trim().length > 0);
  if (lines.length === 0) {
    throw new Error('Empty file');
  }

  let detectedTableName = null;
  let header = [];
  let dataLines = [];

  for (const line of lines) {
    if (line.trim().toLowerCase().startsWith('#sod_table:')) {
      detectedTableName = line.split(':')[1]?.trim().toLowerCase();
    } else if (line.trim().startsWith('#')) {
      continue;
    } else if (header.length === 0) {
      header = line.split('\t').map(h => h.trim());
    } else {
      dataLines.push(line);
    }
  }

  if (!detectedTableName) {
    throw new Error('Missing "#sod_table:" header line');
  }
  if (header.length === 0) {
    throw new Error(`Missing column header row for table ${detectedTableName}`);
  }

  const sanitizedTableName = `sod_${detectedTableName.replace(/^sod_/, '')}`;

  const tableCheck = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [sanitizedTableName]
  );

  const tableExisted = tableCheck.rows[0].exists;

  if (!tableExisted) {
    const columnDefs = header.map(col => `"${col.toLowerCase()}" text`).join(', ');
    await pool.query(`CREATE TABLE "${sanitizedTableName}" (id SERIAL PRIMARY KEY, imported_at TIMESTAMPTZ DEFAULT NOW(), ${columnDefs})`);
  }
  // If the table already exists, new data is appended (no TRUNCATE)

  let imported = 0;
  for (const line of dataLines) {
    const rawValues = line.split('\t');
    const normalizedValues = new Array(header.length).fill(null);
    for (let i = 0; i < Math.min(rawValues.length, header.length); i++) {
      const val = rawValues[i] !== undefined ? rawValues[i].trim() : '';
      normalizedValues[i] = (val === '' ? null : val);
    }

    const placeholders = normalizedValues.map((_, idx) => `$${idx + 1}`).join(', ');
    const columnNames = header.map(col => `"${col.toLowerCase()}"`).join(', ');

    try {
      await pool.query(
        `INSERT INTO "${sanitizedTableName}" (${columnNames}) VALUES (${placeholders})`,
        normalizedValues
      );
      imported++;
    } catch (dbErr) {
      console.error('[SOD Import] SQL error on row:', dbErr.message);
    }
  }

  return { tableName: sanitizedTableName, logicalName: detectedTableName, imported, appended: tableExisted };
}

/**
 * Returns the list of available rulesets (rulesetid + description),
 * taking the first occurrence of each rulesetid from the sod_ruleset table
 * (language independant).
 */
export async function getSodRulesets() {
  const tableCheck = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sod_ruleset')`
  );
  if (!tableCheck.rows[0].exists) return [];

  const result = await pool.query(`
    SELECT DISTINCT ON (rulesetid) rulesetid, descn
    FROM sod_ruleset
    ORDER BY rulesetid, id ASC
  `);
  return result.rows.map(r => ({ rulesetId: r.rulesetid, description: r.descn || '' }));
}

/**
 * Exports, for a given rulesetid, all rows of each SOD table
 * in TXT format (same format as import: #sod_table header + tab-separated rows).
 * Returns an array of { fileName, content } for tables that have at least one row
 * for that rulesetid; missing tables or tables with no rows are skipped.
 */
export async function exportSodTablesForRuleset(rulesetId) {
  const files = [];

  for (const logicalName of SOD_EXPECTED_TABLES) {
    const tableName = `sod_${logicalName.replace(/^sod_/, '')}`;

    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
      [tableName]
    );
    if (!tableCheck.rows[0].exists) continue;

    const colsResult = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = $1 AND column_name NOT IN ('id', 'imported_at')
       ORDER BY ordinal_position`,
      [tableName]
    );
    const columns = colsResult.rows.map(r => r.column_name);
    if (columns.length === 0 || !columns.includes('rulesetid')) continue;

    const columnList = columns.map(c => `"${c}"`).join(', ');
    const dataResult = await pool.query(
      `SELECT ${columnList} FROM "${tableName}" WHERE rulesetid = $1`,
      [rulesetId]
    );
    if (dataResult.rows.length === 0) continue;

    const headerLine = columns.map(c => c.toUpperCase()).join('\t');
    const dataLines = dataResult.rows.map(row =>
      columns.map(c => (row[c] === null || row[c] === undefined) ? '' : String(row[c])).join('\t')
    );
    const content = [`#sod_table: ${logicalName}`, headerLine, ...dataLines].join('\n');

    files.push({ fileName: `${logicalName}.txt`, content });
  }

  return files;
}

/**
 * Deletes all occurrences of a rulesetid from all sod_* tables
 * that have a rulesetid column. Returns the number of deleted rows per table.
 */
export async function deleteSodRuleset(rulesetId) {
  const tablesResult = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sod_%'`
  );
  const sodTables = tablesResult.rows.map(r => r.table_name);

  const deletedByTable = [];
  let totalDeleted = 0;

  for (const tableName of sodTables) {
    const colsResult = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
      [tableName]
    );
    const columns = colsResult.rows.map(r => r.column_name);
    if (!columns.includes('rulesetid')) continue;

    const delResult = await pool.query(
      `DELETE FROM "${tableName}" WHERE rulesetid = $1`,
      [rulesetId]
    );
    if (delResult.rowCount > 0) {
      deletedByTable.push({ tableName, deleted: delResult.rowCount });
      totalDeleted += delResult.rowCount;
    }
  }

  return { totalDeleted, deletedByTable };
}

/**
 * Drops all tables starting with sod_ (full deletion of the SOD module).
 */
export async function deleteAllSodTables() {
  const tablesResult = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_name LIKE 'sod_%'`
  );
  const sodTables = tablesResult.rows.map(r => r.table_name);

  for (const tableName of sodTables) {
    await pool.query(`DROP TABLE IF EXISTS "${tableName}"`);
  }

  return { droppedTables: sodTables };
}
