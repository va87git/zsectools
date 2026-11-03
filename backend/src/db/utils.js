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

// Columns used by our own schema: SAP fields with these names get a "_sap" suffix
// (same convention as the RFC import).
// Fix #47
export const RESERVED_COLS = ['id', 'imported_at'];

export function renameReservedColumn(name) {
  const lower = String(name).trim().toLowerCase();
  return RESERVED_COLS.includes(lower) ? `${lower}_sap` : lower;
}

const SAFE_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_$]*$/;

export function safeColumnName(col, idx = 0) {
  const name = renameReservedColumn(col);
  return SAFE_IDENTIFIER_RE.test(name) ? name : `col_${idx + 1}`;
}
