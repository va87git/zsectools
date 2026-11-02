import { pool } from './client.js';

// Shared Helper (tables check exist)
/**
 * Checks whether a table exists in the current schema.
 */
export async function tableExists(tableName) {
  const result = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [tableName]
  );
  return result.rows[0].exists;
}

// Table/column names coming from imported TXT files must never reach a SQL
// statement raw: accept only plain identifiers, otherwise fall back to col_N.
const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function safeColumnName(col, idx = 0) {
  const name = String(col).trim().toLowerCase();
  return SAFE_IDENTIFIER_RE.test(name) ? name : `col_${idx + 1}`;
}
