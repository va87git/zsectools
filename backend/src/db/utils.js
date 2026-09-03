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
