import pg from 'pg';

const { Pool } = pg;

// Pool PostgreSQL, health check, setup tabelle and app settings
const requiredVars = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];

for (const key of requiredVars) {
  if (!process.env[key]) {
    console.warn(`[db] Missing environment variable: ${key}`);
  }
}

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'appdb',
  user: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
  max: 10,
  idleTimeoutMillis: 10000
});

export async function checkDbHealth() {
  const start = Date.now();
  const result = await pool.query('SELECT 1 as ok');
  return {
    ok: result.rows?.[0]?.ok === 1,
    latencyMs: Date.now() - start
  };
}

export async function ensureSapRealmTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_realms (
      realm TEXT PRIMARY KEY,
      realm_description TEXT,
      sap_user TEXT NOT NULL,
      sap_password TEXT NOT NULL,
      sap_ashost TEXT NOT NULL,
      sap_sysnr TEXT NOT NULL,
      sap_client TEXT NOT NULL,
      sap_sid TEXT NOT NULL DEFAULT '',
      sap_language TEXT NOT NULL DEFAULT 'EN',
      sap_router TEXT NOT NULL DEFAULT '',
      realm_reference_date DATE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`ALTER TABLE sap_realms ADD COLUMN IF NOT EXISTS realm_description TEXT`);

  await pool.query(`ALTER TABLE sap_realms ADD COLUMN IF NOT EXISTS sap_sid TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE sap_realms ADD COLUMN IF NOT EXISTS sap_language TEXT NOT NULL DEFAULT 'EN'`);
  await pool.query(`ALTER TABLE sap_realms ADD COLUMN IF NOT EXISTS realm_reference_date DATE`);
}

export async function ensureSapImportTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_table_import_rows (
      id BIGSERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_data JSONB NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sap_table_import_rows_lookup
    ON sap_table_import_rows (realm, table_name, imported_at DESC)
  `);

  /* //old table:
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_user_statistics (
      id BIGSERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      selected_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  */

  // Separate table for USERTCODE rows extracted from SWNC_COLLECTOR_GET_AGGREGATES.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_user_stats (
      id BIGSERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      period_type TEXT NOT NULL,
      selected_at TIMESTAMPTZ NOT NULL,
      row_data JSONB NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_sap_user_stats_lookup
    ON sap_user_stats (realm, period_type, selected_at DESC)
  `);

  // Raw table with parsed ACTION and ACTIONTYPE columns
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_raw_user_stats (
      id SERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      period_type TEXT NOT NULL,
      selected_at TIMESTAMPTZ NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Add ACTION and ACTIONTYPE columns if they don't exist
  await pool.query(`ALTER TABLE sap_raw_user_stats ADD COLUMN IF NOT EXISTS "entry_id" TEXT`);
  await pool.query(`ALTER TABLE sap_raw_user_stats ADD COLUMN IF NOT EXISTS "action" TEXT`);
  await pool.query(`ALTER TABLE sap_raw_user_stats ADD COLUMN IF NOT EXISTS "actiontype" TEXT`);
}

export async function ensureAppSettingsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

export async function getAppSetting(key) {
  const result = await pool.query(
    `SELECT key, value, updated_at
     FROM app_settings
     WHERE key = $1`,
    [key]
  );
  return result.rows[0] || null;
}

export async function setAppSetting(key, value) {
  const result = await pool.query(
    `INSERT INTO app_settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key)
     DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
     RETURNING key, value, updated_at`,
    [key, value]
  );
  return result.rows[0];
}
