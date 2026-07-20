import pg from 'pg';
import copyStreams from 'pg-copy-streams';

const { Pool } = pg;

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sap_user_statistics (
      id BIGSERIAL PRIMARY KEY,
      realm TEXT NOT NULL,
      selected_at TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

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

export async function listSapRealms() {
  const result = await pool.query(`
    SELECT realm, sap_user, sap_password, sap_ashost, sap_sysnr, sap_client, sap_sid, sap_language, sap_router, realm_reference_date, updated_at
    FROM sap_realms
    ORDER BY realm ASC
  `);
  return result.rows;
}

export async function getSapRealm(realm) {
  const result = await pool.query(
    `SELECT realm, realm_description, sap_user, sap_password, sap_ashost, sap_sysnr, sap_client, sap_sid, sap_language, sap_router, realm_reference_date, updated_at
     FROM sap_realms
     WHERE realm = $1`,
    [realm]
  );
  return result.rows[0] || null;
}

export async function upsertSapRealm(payload) {
  const {
    realm,
    realm_description,
    sap_user,
    sap_password,
    sap_ashost,
    sap_sysnr,
    sap_client,
    sap_sid,
    sap_language,
    sap_router,
    realm_reference_date
  } = payload;

  const result = await pool.query(
    `INSERT INTO sap_realms (realm, realm_description, sap_user, sap_password, sap_ashost, sap_sysnr, sap_client, sap_sid, sap_language, sap_router, realm_reference_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (realm)
     DO UPDATE SET
       realm_description = EXCLUDED.realm_description,
       sap_user = EXCLUDED.sap_user,
       sap_password = EXCLUDED.sap_password,
       sap_ashost = EXCLUDED.sap_ashost,
       sap_sysnr = EXCLUDED.sap_sysnr,
       sap_client = EXCLUDED.sap_client,
       sap_sid = EXCLUDED.sap_sid,
       sap_language = EXCLUDED.sap_language,
       sap_router = EXCLUDED.sap_router,
       realm_reference_date = EXCLUDED.realm_reference_date,
       updated_at = NOW()
     RETURNING realm, realm_description, sap_user, sap_password, sap_ashost, sap_sysnr, sap_client, sap_sid, sap_language, sap_router, realm_reference_date, updated_at`,
    [realm, realm_description || '', sap_user, sap_password, sap_ashost, sap_sysnr, sap_client, sap_sid, sap_language, sap_router || '', realm_reference_date || null]
  );

  return result.rows[0];
}

export async function deleteSapRealm(realm) {
  // First, delete all associated data for this realm
  await pool.query(`DELETE FROM sap_table_import_rows WHERE realm = $1`, [realm]);
  await pool.query(`DELETE FROM sap_user_statistics WHERE realm = $1`, [realm]);
  await pool.query(`DELETE FROM sap_user_stats WHERE realm = $1`, [realm]);
  await pool.query(`DELETE FROM sap_raw_user_stats WHERE realm = $1`, [realm]);

  // Delete all dynamically created raw tables for this realm (sap_raw_<tablename>)
  // We need to find them first
  /*
  const tableResult = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE 'sap_raw_%'`
  );

  for (const table of tableResult.rows) {
    const tableName = table.table_name;
    await pool.query(`DELETE FROM "${tableName}" WHERE realm = $1`, [realm]);
  }*/

  //New logic for realm-scoped table cleanup:
  //updated to also delete report and yr tables. Previously: LIKE 'sap_raw_` + realm + `%'`);
  const tableRealmResult = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name LIKE '%` + realm + `%'`);


  //drop all tables for this realm:
    for (const table of tableRealmResult.rows) {
    var tableName = table.table_name;
    //console.log("!INFO: entered the for loop. Table: " + tableName);
    await pool.query(`DROP TABLE IF EXISTS "${tableName}";`);
  }

  // Finally, delete the realm itself
  const result = await pool.query(
    `DELETE FROM sap_realms WHERE realm = $1`,
    [realm]
  );
  return result.rowCount > 0;
}

// Map SAP field types to PostgreSQL types
function mapSapTypeToPg(sapType, length) {
  switch (sapType) {
    case 'D': // Date (YYYYMMDD)
      return 'DATE';
    case 'T': // Time (HHMMSS)
      return 'TIME';
    case 'I': // Integer
      return 'INTEGER';
    case 'F': // Float
      return 'DOUBLE PRECISION';
    case 'P': // Packed number
      return 'NUMERIC';
    case 'b': // Byte/Int1
      return 'SMALLINT';
    case 'N': // Numeric text (keep as TEXT for safety with leading zeros)
      return 'TEXT';
    case 'C': // Char
    case 'STRING':
    case 'X': // Hex string
    default:
      return 'TEXT';
  }
}

// Escape special characters for COPY format
function escapeCopyValue(value) {
  if (value === null || value === undefined || value === '') {
    return '\\N'; // NULL marker for COPY
  }

  let str = String(value);

  // Escape backslash first, then other special chars
  str = str.replace(/\\/g, '\\\\');
  str = str.replace(/\t/g, '\\t');
  str = str.replace(/\n/g, '\\n');
  str = str.replace(/\r/g, '\\r');
  str = str.replace(/'/g, "\\'");
  str = str.replace(/"/g, '\\"');

  return str;
}

// Convert SAP date (YYYYMMDD) to PostgreSQL date format
// Returns null if the date is invalid (e.g., 0404-14-17, 00000000, or beyond PostgreSQL limits)
// PostgreSQL DATE supports years from 4713 BC to 4714 AD
function convertSapDate(value) {
  if (!value || value.length !== 8 || value === '00000000') {
    return null;
  }

  const year = parseInt(value.substring(0, 4), 10);
  const month = parseInt(value.substring(4, 6), 10);
  const day = parseInt(value.substring(6, 8), 10);

  // Validate month and day ranges
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  // Additional validation: check if day is valid for the given month
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day > daysInMonth) {
    return null;
  }

  // PostgreSQL DATE range: 4713 BC to 4714 AD
  // We allow years from 1 to 4714 (SAP typically uses 1900-9999, but we cap at PostgreSQL max)
  if (year < 1 || year > 4714) {
    return null;
  }

  // YYYYMMDD -> YYYY-MM-DD
  return `${value.substring(0, 4)}-${value.substring(4, 6)}-${value.substring(6, 8)}`;
}

// Convert SAP time (HHMMSS) to PostgreSQL time format
// Returns null if the time is invalid (e.g., 25:99:99, 000000, etc.)
function convertSapTime(value) {
  if (!value || value.length !== 6 || value === '000000') {
    return null;
  }

  const hours = parseInt(value.substring(0, 2), 10);
  const minutes = parseInt(value.substring(2, 4), 10);
  const seconds = parseInt(value.substring(4, 6), 10);

  // Validate time ranges
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
    return null;
  }

  // HHMMSS -> HH:MM:SS
  return `${value.substring(0, 2)}:${value.substring(2, 4)}:${value.substring(4, 6)}`;
}

// Convert SAP packed number to a safe numeric string
// Returns null if the value is empty or invalid
function convertSapPacked(value) {
  if (!value || value.trim() === '') {
    return null;
  }

  // Remove leading/trailing spaces and check if it's a valid number
  const trimmed = String(value).trim();

  // Check if it's a valid numeric string (digits, optional minus sign, optional decimal point)
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return trimmed;
  }

  // If it looks like a packed number with leading zeros, return as-is
  // PostgreSQL NUMERIC can handle it
  if (/^-?\d+$/.test(trimmed)) {
    return trimmed;
  }

  // Invalid format, return null to avoid DB errors
  return null;
}

export async function replaceImportedTableRows(realm, tableName, fields, rows, isAppend = false) {
  if (!rows || rows.length === 0) return;

  // New table naming: sap_raw_[realm]_[tableName]
  const sanitizedTableName = `sap_raw_${realm.toLowerCase()}_${tableName.toLowerCase()}`;

  // Reserved columns that conflict with our schema - rename them
  const reservedCols = ['id', 'imported_at'];

  // Build column definitions with proper types from SAP metadata
  const columnDefs = fields.map(f => {
    const colName = reservedCols.includes(f.name.toLowerCase()) ? `${f.name}_sap` : f.name;
    const colType = mapSapTypeToPg(f.type, f.length);
    return `"${colName.toLowerCase()}" ${colType}`;
  }).join(', ');

  // Check if table exists
  const tableCheck = await pool.query(`
    SELECT EXISTS (
      SELECT FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = $1
    )
  `, [sanitizedTableName]);

  const tableExists = tableCheck.rows[0]?.exists;

  if (!tableExists) {
    // Create new table with dynamic columns
    await pool.query(`
      CREATE TABLE "${sanitizedTableName}" (
        id SERIAL PRIMARY KEY,
        imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ${columnDefs}
      )
    `);
  } else {
    // Table exists - check for new columns and add them
    const existingColsResult = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = $1
    `, [sanitizedTableName]);

    const existingCols = new Set(existingColsResult.rows.map(r => r.column_name.toLowerCase()));

    for (const f of fields) {
      const colName = reservedCols.includes(f.name.toLowerCase()) ? `${f.name}_sap` : f.name;
      const colNameLower = colName.toLowerCase();

      if (!existingCols.has(colNameLower)) {
        const colType = mapSapTypeToPg(f.type, f.length);
        await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN "${colNameLower}" ${colType}`);
      }
    }
  }

  // Build insert column names (match renamed fields)
  const insertCols = fields.map(f => {
    const colName = reservedCols.includes(f.name.toLowerCase()) ? `${f.name}_sap` : f.name;
    return `"${colName.toLowerCase()}"`;
  });

  // Clear existing data only if NOT in append mode
  if (!isAppend) {
    await pool.query(`TRUNCATE TABLE "${sanitizedTableName}"`);
  }

  // Use COPY FROM STDIN for bulk insert (much faster than individual INSERTs)
  const { pipeline } = await import('node:stream/promises');
  const { Transform } = await import('node:stream');

  // Build COPY command
  const copyCommand = `COPY "${sanitizedTableName}" (${insertCols.join(', ')}) FROM STDIN WITH (FORMAT text, DELIMITER E'\\t', NULL '\\N')`;

  // Create a transform stream to convert rows to TSV format
  const rowStream = new Transform({
    objectMode: true,
    transform(row, _encoding, callback) {
      try {
        // Build TSV line for this row
        const values = fields.map(f => {
          const colName = reservedCols.includes(f.name.toLowerCase()) ? `${f.name}_sap` : f.name;
          let value = row[colName] ?? row[f.name] ?? null;

          // Convert SAP date/time/numeric formats if needed, with validation
          if (f.type === 'D' && value) {
            value = convertSapDate(value);
          } else if (f.type === 'T' && value) {
            value = convertSapTime(value);
          } else if (f.type === 'P' && value) {
            value = convertSapPacked(value);
          }

          return escapeCopyValue(value);
        });

        const line = values.join('\t') + '\n';
        this.push(line);
        callback();
      } catch (err) {
        callback(err);
      }
    }
  });

  // Execute COPY command using pg-copy-streams
  const client = await pool.connect();
  const ingestStream = copyStreams.from(copyCommand);

  try {
    const copyPromise = new Promise((resolve, reject) => {
      ingestStream.on('finish', resolve);
      ingestStream.on('error', reject);
    });

    client.query(ingestStream);

    // Pipe rows through transform stream to COPY
    await pipeline(
      (async function* generateRows() {
        for (const row of rows) {
          yield row;
        }
      })(),
      rowStream,
      ingestStream
    );

    await copyPromise;
  } finally {
    client.release();
  }
}

export async function getImportedTableRows(realm, tableName, limit = 100, offset = 0) {
  const sanitizedTableName = `sap_raw_${realm.toLowerCase()}_${tableName.toLowerCase()}`;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM "${sanitizedTableName}"`,
    );
    const total = Number(countResult.rows[0]?.total || 0);
//V3:
    const result = await pool.query(
      `SELECT * FROM "${sanitizedTableName}"`
    );

//V2:
    /*const result = await pool.query(
      `SELECT * FROM "${sanitizedTableName}"
       WHERE realm = $1
       ORDER BY id DESC`
    );*/
    //V1:
               /*const result = await pool.query(
      SELECT * FROM "${sanitizedTableName}"
       ORDER BY id DESC
       LIMIT $1 OFFSET $2,
      [limit, offset]);*/

    // Map back to expected row_data format for frontend compatibility
    const mappedRows = result.rows.map(row => {
      const { id, imported_at, ...rest } = row;
      return { row_data: JSON.stringify(rest), imported_at };
    });

    return { rows: mappedRows, total };
  } catch (err) {
    // If table doesn't exist yet, fallback to original compatibility table
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM sap_table_import_rows WHERE realm = $1 AND table_name = $2`,
      [realm, tableName]
    );
    const total = Number(countResult.rows[0]?.total || 0);

    const result = await pool.query(
      `SELECT row_data, imported_at
       FROM sap_table_import_rows
       WHERE realm = $1 AND table_name = $2
       ORDER BY id DESC
       LIMIT $3 OFFSET $4`,
      [realm, tableName, limit, offset]
    );

    return { rows: result.rows, total };
  }
}

export async function saveUserStatistics(realm, selectedAtIso, payload) {
  const result = await pool.query(
    `INSERT INTO sap_user_statistics (realm, selected_at, payload)
     VALUES ($1, $2::timestamptz, $3::jsonb)
     RETURNING id, realm, selected_at, imported_at`,
    [realm, selectedAtIso, JSON.stringify(payload)]
  );
  return result.rows[0];
}

export async function saveUserStats(realm, periodType, selectedAtIso, usertcodeRows, mode = 'overwrite') {
  if (!usertcodeRows || usertcodeRows.length === 0) return;

  const sanitizedTableName = 'sap_raw_user_stats';
  const firstRow = usertcodeRows[0];
  const columns = Object.keys(firstRow);

  // Ensure ACTION and ACTIONTYPE columns exist
  await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "action" TEXT`);
  await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "actiontype" TEXT`);

  // Create table with explicit columns for statistics
const columnDefs = columns.map(col => `"${col.toLowerCase()}" TEXT`).join(', ');

await pool.query(`CREATE TABLE IF NOT EXISTS "${sanitizedTableName}" (
  id SERIAL PRIMARY KEY,
  realm TEXT NOT NULL,
  period_type TEXT NOT NULL,
  selected_at TIMESTAMPTZ NOT NULL,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ${columnDefs},
  "action" TEXT,
  "actiontype" TEXT
)`);

// Add all dynamic columns if they don't exist
for (const col of columns) {
  const colNameLower = col.toLowerCase();
  await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "${colNameLower}" TEXT`);
}

// Ensure ACTION and ACTIONTYPE columns exist
await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "action" TEXT`);
await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "actiontype" TEXT`);

  // Delete existing data based on mode
  if (mode === 'overwrite') {
    // Overwrite mode: delete ALL data for this realm
    await pool.query(
      `DELETE FROM "${sanitizedTableName}" WHERE realm = $1`,
      [realm]
    );
  } else {
    // Append mode: delete only for this specific import to avoid duplicates
    await pool.query(
      `DELETE FROM "${sanitizedTableName}" WHERE realm = $1 AND period_type = $2 AND selected_at = $3::timestamptz`,
      [realm, periodType, selectedAtIso]
    );
  }

  // Helper to sanitize strings for UTF8 encoding
  // SAP may return data in ISO-8859-1 or other codepages that aren't valid UTF-8
  const sanitizeValue = (val) => {
    if (val === null || val === undefined) return null;
    const str = String(val);
    try {
      // Quick sanitization: encode to UTF-8 bytes, then decode back
      // This replaces invalid byte sequences with the replacement character
      return Buffer.from(str, 'binary').toString('utf8');
    } catch {
      // Fallback: just return the string, PostgreSQL may still reject it
      return str;
    }
  };

  // Helper to parse entry_id into ACTION and ACTIONTYPE
  // entry_id format: "TRANSACTION_CODE     T" (transaction code + spaces + single letter)
  const parseEntryId = (entryId) => {
    if (!entryId || typeof entryId !== 'string') {
      return { action: null, actiontype: null };
    }

    const trimmed = entryId.trimEnd();
    if (trimmed.length === 0) {
      return { action: null, actiontype: null };
    }

    // Last character is the ACTIONTYPE
    const actiontype = trimmed.charAt(trimmed.length - 1);

    // Everything before the last character (after trimming trailing spaces) is the ACTION
    const action = trimmed.slice(0, trimmed.length - 1).trimEnd();

    return { action, actiontype };
  };

  for (const row of usertcodeRows) {
    const colNames = columns.map(c => `"${c.toLowerCase()}"`).join(', ');
    const colPlaceholders = columns.map((_, i) => `$${i + 4}`).join(', ');
    const values = columns.map(c => sanitizeValue(row[c]));

    // Parse entry_id to extract ACTION and ACTIONTYPE
    const entryIdValue = row.ENTRY_ID || row.entry_id || '';
    const { action, actiontype } = parseEntryId(entryIdValue);

    // Build full placeholder list including action and actiontype with explicit TEXT casts
    const actionPlaceholder = `$${columns.length + 4}::TEXT`;
    const actiontypePlaceholder = `$${columns.length + 5}::TEXT`;

    await pool.query(
      `INSERT INTO "${sanitizedTableName}" (realm, period_type, selected_at, ${colNames}, "action", "actiontype")
       VALUES ($1, $2, $3::timestamptz, ${colPlaceholders}, ${actionPlaceholder}, ${actiontypePlaceholder})`,
      [realm, periodType, selectedAtIso, ...values, action, actiontype]
    );
  }

  // Legacy fallback for compatibility
  for (const row of usertcodeRows) {
    await pool.query(
      `INSERT INTO sap_user_stats (realm, period_type, selected_at, row_data)
       VALUES ($1, $2, $3::timestamptz, $4::jsonb)`,
      [realm, periodType, selectedAtIso, JSON.stringify(row)]
    );
  }
}

export async function getUserStats(realm, periodType, limit = 100, offset = 0) {
  const sanitizedTableName = 'sap_raw_user_stats';

  try {
    let query = `SELECT * FROM "${sanitizedTableName}" WHERE realm = $1`;
    const params = [realm];

    if (periodType) {
      query += ` AND period_type = $2 ORDER BY id DESC LIMIT $3 OFFSET $4`;
      params.push(periodType, limit, offset);
    } else {
      query += ` ORDER BY id DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    }

    const result = await pool.query(query, params);
    return result.rows.map(row => {
      const { id, realm: r, period_type, selected_at, imported_at, ...rest } = row;
      return { row_data: rest, imported_at };
    });
  } catch (err) {
    // Fallback to legacy table
    let query = `SELECT row_data, imported_at FROM sap_user_stats WHERE realm = $1`;
    const params = [realm];
    if (periodType) {
      query += ` AND period_type = $2 ORDER BY id DESC LIMIT $3 OFFSET $4`;
      params.push(periodType, limit, offset);
    } else {
      query += ` ORDER BY id DESC LIMIT $2 OFFSET $3`;
      params.push(limit, offset);
    }
    const result = await pool.query(query, params);
    return result.rows;
  }
}

export async function getUserStatsCount(realm, periodType) {
  let query = `SELECT COUNT(*) as total FROM sap_user_stats WHERE realm = $1`;
  const params = [realm];

  if (periodType) {
    query += ` AND period_type = $2`;
    params.push(periodType);
  }

  const result = await pool.query(query, params);
  return Number(result.rows[0]?.total || 0);
}

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

export async function importTablesFromTxt(realm, tableName, txtContent) {
  // 1. Rows cleanup
  const lines = txtContent.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length === 0) return { imported: 0 };

  let detectedTableName = tableName;
  let columnTypes = [];
  let header = [];
  let dataLines = [];

  // 2. Metadata analysis
  for (const line of lines) {
    if (line.startsWith('# Table:')) {
      detectedTableName = line.replace('# Table:', '').trim();
    } else if (line.startsWith('# TYPES:')) {
      columnTypes = line.replace('# TYPES:', '').trim().split('|');
    } else if (line.startsWith('#')) {
      continue;
    } else if (header.length === 0) {
      header = line.split('\t'); // the first non-# line is the header
    } else {
      dataLines.push(line); // everything else is data
    }
  }

  if (header.length === 0) return { imported: 0 };

  // 3. Table creation
  const sanitizedTableName = `sap_raw_${realm.toLowerCase()}_${detectedTableName.toLowerCase()}`;

  const tableCheck = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [sanitizedTableName]
  );

  if (!tableCheck.rows[0].exists) {
    const columnDefs = header.map((col, idx) => {
      const type = columnTypes[idx] || 'text';
      return `"${col.toLowerCase()}" ${type}`;
    }).join(', ');

    await pool.query(`CREATE TABLE "${sanitizedTableName}" (id SERIAL PRIMARY KEY, imported_at TIMESTAMPTZ DEFAULT NOW(), ${columnDefs})`);
  }

  // 4. Add data (new version)
  await pool.query(`TRUNCATE TABLE "${sanitizedTableName}"`);

  let imported = 0;
  for (const line of dataLines) {
    const rawValues = line.split('\t');

    // LOGIC CORRECTION:
    // If the row has fewer columns than the header, fill in null values
    // if there are more, we truncate them (ignore the excess)
    const normalizedValues = new Array(header.length).fill(null);
    for (let i = 0; i < Math.min(rawValues.length, header.length); i++) {
        const val = rawValues[i] ? rawValues[i].trim() : '';
        normalizedValues[i] = (val === '' ? null : val);
    }

    // now we always have an array of the correct length
    const placeholders = normalizedValues.map((_, idx) => `$${idx + 1}`).join(', ');
    const columnNames = header.map(col => `"${col.toLowerCase()}"`).join(', ');

    try {
      await pool.query(
        `INSERT INTO "${sanitizedTableName}" (${columnNames}) VALUES (${placeholders})`,
        normalizedValues
      );
      imported++;
    } catch (dbErr) {
      console.error("SQL error on row:", dbErr.message);
    }
  }
  return { imported };
}

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

/**
 * Checks whether a table exists in the current schema.
 */
async function tableExists(tableName) {
  const result = await pool.query(
    `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
    [tableName]
  );
  return result.rows[0].exists;
}

/**
 * Searches for elements (Users or Roles) using a SQL wildcard pattern and inserts them
 * (or updates) into the sod_ra_elements table. Creates the table if it does not exist.
 * Returns the found/inserted elements, or throws an error if the source tables
 * source tables (yr_<realm>_user_complete_info / yr_<realm>_roles_infos) do not exist.
 */
export async function searchAndAddSodRaElements(realm, elementType, pattern) {
  const sourceTable = elementType === 'Roles'
    ? `yr_${realm}_roles_infos`
    : `yr_${realm}_user_complete_info`;

  if (!(await tableExists(sourceTable))) {
    throw new Error('You must run the build additional infos function first');
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sod_ra_elements (
      elementtype TEXT,
      elementid TEXT PRIMARY KEY,
      elementdescription TEXT
    )
  `);
  // Migration: if the table already existed without the elementtype column, add it
  await pool.query(`ALTER TABLE sod_ra_elements ADD COLUMN IF NOT EXISTS elementtype TEXT`);

  let rows;
  if (elementType === 'Roles') {
    const result = await pool.query(
      `SELECT agr_name AS elementid, text AS elementdescription
       FROM "${sourceTable}"
       WHERE agr_name ILIKE $1`,
      [pattern]
    );
    rows = result.rows;
  } else {
    const result = await pool.query(
      `SELECT bname AS elementid,
              TRIM(CONCAT(COALESCE(name_first, ''), ' ', COALESCE(name_last, ''))) AS elementdescription
       FROM "${sourceTable}"
       WHERE bname ILIKE $1
         AND user_valid != 0`,
      [pattern]
    );
    rows = result.rows;
  }

  for (const row of rows) {
    await pool.query(
      `INSERT INTO sod_ra_elements (elementtype, elementid, elementdescription)
       VALUES ($1, $2, $3)
       ON CONFLICT (elementid) DO UPDATE SET elementtype = EXCLUDED.elementtype, elementdescription = EXCLUDED.elementdescription`,
      [elementType, row.elementid, row.elementdescription]
    );
  }

  return { added: rows.length, elements: rows };
}

/**
 * Returns a page of rows from the sod_ra_elements table (empty if the table does not exist),
 * along with the total count for pagination.
 */
export async function getSodRaElements(limit = 100, offset = 0) {
  if (!(await tableExists('sod_ra_elements'))) return { rows: [], total: 0 };
  const totalResult = await pool.query(`SELECT COUNT(*) AS count FROM sod_ra_elements`);
  const total = Number(totalResult.rows[0].count);
  const result = await pool.query(
    `SELECT elementtype, elementid, elementdescription FROM sod_ra_elements ORDER BY elementid LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return { rows: result.rows, total };
}

/**
 * Completely clears the sod_ra_elements table.
 */
export async function clearSodRaElements() {
  if (!(await tableExists('sod_ra_elements'))) return { cleared: 0 };
  const result = await pool.query(`DELETE FROM sod_ra_elements`);
  return { cleared: result.rowCount };
}

/**
 * Internal helper: runs a query with language fallback realmLang → EN → DE → 'NULL'.
 * The realm language must be passed directly by the caller (already available in realmConfig.sap_language).
 */
async function queryWithLangFallback(queryFn, realmLang) {
  const langs = [realmLang];
  if (!langs.includes('EN')) langs.push('EN');
  if (!langs.includes('DE')) langs.push('DE');

  for (const lang of langs) {
    const result = await queryFn(lang);
    if (result.rows.length > 0 && result.rows[0].descn) {
      return result.rows[0].descn;
    }
  }
  return 'NULL';
}

/**
 * Fetches the description of a SOD function from the sod_functions table.
 *  fallback language: realmLanguage → EN → DE → 'NULL'.
 *
 * @param {string} realmLanguage - SAP language of the realm (from realmConfig.sap_language)
 * @param {string} rulesetId     - Currently selected ruleset
 * @param {string} functId       - Function identifier to search for
 * @returns {string}             - Found description, or 'NULL'
 */
export async function getSodFunctionDescription(realmLanguage, rulesetId, functId) {
  return queryWithLangFallback(lang => pool.query(
    `SELECT descn FROM sod_functions WHERE rulesetid = $1 AND functid = $2 AND langu = $3 LIMIT 1`,
    [rulesetId, functId, lang]
  ), realmLanguage);
}

/**
 * Fetches the description of a SOD risk from the sod_risk_descriptions table.
 *  fallback language: realmLanguage → EN → DE → 'NULL'.
 *
 * @param {string} realmLanguage - SAP language of the realm (from realmConfig.sap_language)
 * @param {string} rulesetId     - Currently selected ruleset
 * @param {string} riskId        - Risk identifier to search for
 * @returns {string}             - Found description, or 'NULL'
 */
export async function getSodRiskDescription(realmLanguage, rulesetId, riskId) {
  return queryWithLangFallback(lang => pool.query(
    `SELECT descn FROM sod_risk_descriptions WHERE rulesetid = $1 AND riskid = $2 AND langu = $3 LIMIT 1`,
    [rulesetId, riskId, lang]
  ), realmLanguage);
}

/**
 * Runs the SOD analysis for all elements in sod_ra_elements.
 * Write results in sod_ra_results and return first 100 rows + total.
 */

function translateRiskLevel(numericValue) {
  switch (String(numericValue).trim()) {
    case '0': return 'Medium';
    case '1': return 'High';
    case '2': return 'Low';
    case '3': return 'Critical';
    case '4': return 'On Hold';
    default:  return numericValue || 'Unknown';
  }
}

function translateRiskType(numericValue) {
  switch (String(numericValue).trim()) {
    case '1': return 'SOD Risk';
    case '2': return 'Critical Function';
    case '3': return 'Critical Permission';
    default:  return numericValue || 'Unknown';
  }
}

export async function runSodAnalysis(realm, rulesetId, elementType, analysisLevel, realmLanguage, onProgress = null) {
  // Fetch the realm reference date BEFORE acquiring the dedicated client
  const realmConfig = await getSapRealm(realm);
  let realmRefDate = realmConfig?.realm_reference_date;
  if (!realmRefDate) {
    realmRefDate = new Date().toISOString().split('T')[0];
  } else {
    realmRefDate = realmRefDate instanceof Date ? realmRefDate.toISOString().split('T')[0] : String(realmRefDate);
  }
  // YYYYMMDD format for comparison with SAP from_dat/to_dat fields
  const realmRefDateSap = realmRefDate.replace(/-/g, '');

  // Use a dedicated client for the whole analysis: the TEMP TABLE only exists on the same connection
  const client = await pool.connect();
  // Local helper that always uses the dedicated client
  const q = (sql, params) => client.query(sql, params);

  try {
  await q(`DROP TABLE IF EXISTS sod_ra_results`);
  await q(`
    CREATE TABLE sod_ra_results (
      elementtype TEXT,
      elementid TEXT,
      elementdescription TEXT,
      riskid TEXT,
      riskdescription TEXT,
      risklevel TEXT,
      risktype TEXT,
      functionid TEXT,
      functiondescription TEXT,
      action TEXT,
      authobject TEXT,
      authfield TEXT,
      searchfrom TEXT,
      searchto TEXT,
      foundvaluefrom TEXT,
      foundvalueto TEXT,
      authorizationID TEXT,
      profilesingle TEXT,
      profilecomposite TEXT,
      rolesingle TEXT,
      rolecomposite TEXT
    )
  `);

  const elementsRes = await q(
    `SELECT elementid, elementdescription, elementtype FROM sod_ra_elements ORDER BY elementtype, elementid`
  );
  const elements = elementsRes.rows;

  const risksRes = await q(
    `SELECT riskid, fun1, fun2, fun3, fun4, fun5 FROM sod_risks
     WHERE rulesetid = $1 AND (inactive IS NULL OR inactive = '0' OR inactive = '')`,
    [rulesetId]
  );
  const risks = risksRes.rows;

  const totalElements = elements.length;

  for (let elIdx = 0; elIdx < elements.length; elIdx++) {
    const element = elements[elIdx];
    const elementId = element.elementid;
    const elementDesc = element.elementdescription;
    const elementType = element.elementtype; // taken from the table, not from the parameter

    // Notify progress to caller
    if (onProgress) onProgress({ current: elIdx + 1, total: totalElements, elementId });

    // STEP 1: Authorization buffer
    await q(`DROP TABLE IF EXISTS tmp_sod_element_auth`);

    if (elementType === 'Users') {
      let refUser = null;
      const refRes = await q(
        `SELECT refuser FROM sap_raw_${realm}_usrefus WHERE bname = $1 LIMIT 1`,
        [elementId]
      ).catch(() => ({ rows: [] }));
      if (refRes.rows.length > 0 && refRes.rows[0].refuser) refUser = refRes.rows[0].refuser;

      await q(`
        CREATE TEMP TABLE tmp_sod_element_auth (
          elementid TEXT, objct TEXT, auth TEXT, field TEXT,
          von TEXT, bis TEXT, profile_s TEXT, profile_c TEXT, reference_user TEXT,
          role_single TEXT, role_composite TEXT
        )
      `);

      const usersToProcess = [{ bname: elementId, asReference: false }];
      if (refUser) usersToProcess.push({ bname: refUser, asReference: true });

      for (const u of usersToProcess) {
        const actualBname = u.bname;
        const refLabel = u.asReference ? actualBname : '';

        // Simple profiles
        await q(`
          INSERT INTO tmp_sod_element_auth
          SELECT $1, ust10s.objct, ust10s.auth, ust12.field, ust12.von, ust12.bis,
                 ust04.profile, '', $2, '', ''
          FROM sap_raw_${realm}_ust04 ust04
          INNER JOIN sap_raw_${realm}_ust10s ust10s ON ust10s.profn = ust04.profile
          INNER JOIN sap_raw_${realm}_ust12 ust12 ON ust12.objct = ust10s.objct AND ust12.auth = ust10s.auth
          WHERE ust04.bname = $3
        `, [elementId, refLabel, actualBname]);

        // Composite profiles
        await q(`
          INSERT INTO tmp_sod_element_auth
          SELECT $1, ust10s.objct, ust10s.auth, ust12.field, ust12.von, ust12.bis,
                 ust10c.subprof, ust04.profile, $2, '', ''
          FROM sap_raw_${realm}_ust04 ust04
          INNER JOIN sap_raw_${realm}_ust10c ust10c ON ust10c.profn = ust04.profile
          INNER JOIN sap_raw_${realm}_ust10s ust10s ON ust10s.profn = ust10c.subprof
          INNER JOIN sap_raw_${realm}_ust12 ust12 ON ust12.objct = ust10s.objct AND ust12.auth = ust10s.auth
          WHERE ust04.bname = $3
        `, [elementId, refLabel, actualBname]);
      }
    } else if (elementType === 'Roles') {
      // Temp table with role_single and role_composite columns to track the role hierarchy
      await q(`
        CREATE TEMP TABLE tmp_sod_element_auth (
          elementid TEXT, objct TEXT, auth TEXT, field TEXT,
          von TEXT, bis TEXT, profile_s TEXT, profile_c TEXT, reference_user TEXT,
          role_single TEXT, role_composite TEXT
        )
      `);

      // Query 1: single role (elementid), single profiles
      await q(`
        INSERT INTO tmp_sod_element_auth
        SELECT $1, ust10s.objct, ust10s.auth, ust12.field, ust12.von, ust12.bis,
               agr1016.profile, '', '', $1, ''
        FROM sap_raw_${realm}_agr_1016 agr1016
        INNER JOIN sap_raw_${realm}_ust10s ust10s ON agr1016.profile = ust10s.profn
        INNER JOIN sap_raw_${realm}_ust12 ust12 ON ust10s.auth = ust12.auth AND ust10s.objct = ust12.objct
        WHERE agr1016.agr_name = $1
      `, [elementId]);

      // Query 2: single role (elementid), composite profiles
      await q(`
        INSERT INTO tmp_sod_element_auth
        SELECT $1, ust10s.objct, ust10s.auth, ust12.field, ust12.von, ust12.bis,
               ust10c.subprof, agr1016.profile, '', $1, ''
        FROM sap_raw_${realm}_agr_1016 agr1016
        INNER JOIN sap_raw_${realm}_ust10c ust10c ON agr1016.profile = ust10c.profn
        INNER JOIN sap_raw_${realm}_ust10s ust10s ON ust10c.subprof = ust10s.profn
        INNER JOIN sap_raw_${realm}_ust12 ust12 ON ust10s.auth = ust12.auth AND ust10s.objct = ust12.objct
        WHERE agr1016.agr_name = $1
      `, [elementId]);

      // Query 3: composite role (elementid = agr_agrs.agr_name), simple profiles of the child single roles
      await q(`
        INSERT INTO tmp_sod_element_auth
        SELECT agr_agrs.agr_name, ust10s.objct, ust10s.auth, ust12.field, ust12.von, ust12.bis,
               agr1016.profile, '', '', agr_agrs.child_agr, agr_agrs.agr_name
        FROM sap_raw_${realm}_agr_agrs agr_agrs
        INNER JOIN sap_raw_${realm}_agr_1016 agr1016 ON agr_agrs.child_agr = agr1016.agr_name
        INNER JOIN sap_raw_${realm}_ust10s ust10s ON agr1016.profile = ust10s.profn
        INNER JOIN sap_raw_${realm}_ust12 ust12 ON ust10s.auth = ust12.auth AND ust10s.objct = ust12.objct
        WHERE agr_agrs.agr_name = $1
      `, [elementId]);

      // Query 4: composite role (elementid = agr_agrs.agr_name), composite profiles of the child single roles
      await q(`
        INSERT INTO tmp_sod_element_auth
        SELECT agr_agrs.agr_name, ust10s.objct, ust10s.auth, ust12.field, ust12.von, ust12.bis,
               ust10c.subprof, agr1016.profile, '', agr_agrs.child_agr, agr_agrs.agr_name
        FROM sap_raw_${realm}_agr_agrs agr_agrs
        INNER JOIN sap_raw_${realm}_agr_1016 agr1016 ON agr_agrs.child_agr = agr1016.agr_name
        INNER JOIN sap_raw_${realm}_ust10c ust10c ON agr1016.profile = ust10c.profn
        INNER JOIN sap_raw_${realm}_ust10s ust10s ON ust10c.subprof = ust10s.profn
        INNER JOIN sap_raw_${realm}_ust12 ust12 ON ust10s.auth = ust12.auth AND ust10s.objct = ust12.objct
        WHERE agr_agrs.agr_name = $1
      `, [elementId]);
    }

    // STEP 2: For each active risk
    for (const risk of risks) {
      const riskId = risk.riskid;
      const riskDesc = await getSodRiskDescription(realmLanguage, rulesetId, riskId);
      // Fetch and translate risklevel and risktype from sod_risks
      const riskMetaRes = await q(
        `SELECT risklevel, risktype FROM sod_risks WHERE rulesetid = $1 AND riskid = $2 LIMIT 1`,
        [rulesetId, riskId]
      );
      const riskLevelRaw = riskMetaRes.rows[0]?.risklevel ?? '';
      const riskTypeRaw  = riskMetaRes.rows[0]?.risktype  ?? '';
      const riskLevel = translateRiskLevel(riskLevelRaw);
      const riskType  = translateRiskType(riskTypeRaw);
      const functionIds = ['fun1','fun2','fun3','fun4','fun5']
        .map(f => risk[f]).filter(f => f && f.trim() !== '');
      if (functionIds.length === 0) continue;

      const foundByFunction = {};

      for (const functId of functionIds) {
      const actionsRes = await q(
                `SELECT action FROM sod_function_actions
                 WHERE rulesetid = $1 AND functid = $2
                   AND (inactive IS NULL OR inactive = '0' OR inactive = '')`,
                [rulesetId, functId]
              );

              const foundRows = [];

              if (actionsRes.rows.length > 0) {
                // =========================================================================
                // SCENARIO A: function has actions
                // =========================================================================
                for (const actionRow of actionsRes.rows) {
                  const action = actionRow.action;
                  let objectToSearch, actionValue;
                  if (action.startsWith('[')) {
                    objectToSearch = 'S_SERVICE';
                    actionValue = action.replace(/^\[.*?\]/, '').trim();
                  } else {
                    objectToSearch = 'S_TCODE';
                    actionValue = action;
                  }

                  const authsRes = await q(
                    `SELECT DISTINCT objct, auth, field, von, bis, profile_s, profile_c, role_single, role_composite
                     FROM tmp_sod_element_auth
                     WHERE elementid = $1 AND UPPER(objct) = UPPER($2)`,
                    [elementId, objectToSearch]
                  );

                  const authMap = {};
                  for (const row of authsRes.rows) {
                    const key = row.auth;
                    if (!authMap[key]) authMap[key] = { auth: row.auth, profile_s: row.profile_s, profile_c: row.profile_c, role_single: row.role_single || '', role_composite: row.role_composite || '', fields: [], froms: [], tos: [] };
                    authMap[key].fields.push(row.field);
                    authMap[key].froms.push(row.von);
                    authMap[key].tos.push(row.bis);
                  }

                  for (const authEntry of Object.values(authMap)) {
                    const matched = authorizationCheck(
                      authEntry.auth,
                      objectToSearch, authEntry.fields, authEntry.froms, authEntry.tos,
                      objectToSearch, ['TCD'], [actionValue], [actionValue]
                    );
                    if (matched) {
                      const mi = authEntry.fields.findIndex((f, i) =>
                        checkAuthorizationField('TCD', actionValue, actionValue, f, authEntry.froms[i], authEntry.tos[i])
                      );

                      let permMatchRows = [];
                      if (analysisLevel === 'Permission') {
                        const permsRes = await q(
                          `SELECT resourceid, resourceextn, fromval, toval, searchtype, action
                           FROM sod_function_permissions
                           WHERE rulesetid = $1 AND functid = $2 AND action = $3
                             AND COALESCE(inactive::TEXT, '0') != '1'`,
                          [rulesetId, functId, action]
                        );
                        const permRows = permsRes.rows;

                        if (permRows.length > 0) {
                          const permByObj = {};
                          for (const pr of permRows) {
                            const obj = pr.resourceid;
                            const fld = pr.resourceextn;
                            if (!permByObj[obj]) permByObj[obj] = {};
                            if (!permByObj[obj][fld]) permByObj[obj][fld] = [];
                            const fromEmpty = !pr.fromval || pr.fromval.trim() === '';
                            const toEmpty   = !pr.toval   || pr.toval.trim()   === '';
                            const fromval = fromEmpty ? '{' : pr.fromval;
                            const toval   = toEmpty ? (fromEmpty ? '{' : fromval) : pr.toval;
                            permByObj[obj][fld].push({ fromval, toval, searchtype: (pr.searchtype || 'AND').toUpperCase() });
                          }

                          const authFullRes = await q(
                            `SELECT DISTINCT objct, field, von, bis, auth
                             FROM tmp_sod_element_auth
                             WHERE elementid = $1 AND auth = $2`,
                            [elementId, authEntry.auth]
                          );

                          const authByObj = {};
                          for (const ar of authFullRes.rows) {
                            const obj = ar.objct.toUpperCase();
                            if (!authByObj[obj]) authByObj[obj] = { fields: [], froms: [], tos: [] };
                            authByObj[obj].fields.push(ar.field);
                            authByObj[obj].froms.push(ar.von);
                            authByObj[obj].tos.push(ar.bis);
                          }

                          let permPassed = true;
                          for (const [resourceId, fieldMap] of Object.entries(permByObj)) {
                            const authObj = authByObj[resourceId.toUpperCase()];
                            if (!authObj) { permPassed = false; break; }

                            for (const [resourceExtn, valueRows] of Object.entries(fieldMap)) {
                              const andRows = valueRows.filter(v => v.searchtype === 'AND');
                              const orRows  = valueRows.filter(v => v.searchtype === 'OR');

                              for (const av of andRows) {
                                const anyMatch = authObj.fields.some((f, i) =>
                                  checkAuthorizationField(resourceExtn, av.fromval, av.toval, f, authObj.froms[i], authObj.tos[i])
                                );
                                if (!anyMatch) { permPassed = false; break; }
                              }
                              if (!permPassed) break;

                              if (orRows.length > 0) {
                                const anyOrMatch = orRows.some(ov =>
                                  authObj.fields.some((f, i) =>
                                    checkAuthorizationField(resourceExtn, ov.fromval, ov.toval, f, authObj.froms[i], authObj.tos[i])
                                  )
                                );
                                if (!anyOrMatch) { permPassed = false; break; }
                              }
                            }
                            if (!permPassed) break;
                          }

                          if (!permPassed) continue;

                          permMatchRows = [];
                          for (const [resourceId, fieldMap] of Object.entries(permByObj)) {
                            const authObj = authByObj[resourceId.toUpperCase()];
                            if (!authObj) continue;
                            for (const [resourceExtn, valueRows] of Object.entries(fieldMap)) {
                              for (const pv of valueRows) {
                                const matchIdx = authObj.fields.findIndex((f, i) =>
                                  checkAuthorizationField(resourceExtn, pv.fromval, pv.toval, f, authObj.froms[i], authObj.tos[i])
                                );
                                if (matchIdx >= 0) {
                                  permMatchRows.push({
                                    action, objectToSearch: resourceId, field: resourceExtn,
                                    searchFrom: pv.fromval === '{' ? '' : pv.fromval,
                                    searchTo: pv.toval === '{' ? '' : pv.toval,
                                    foundFrom: authObj.froms[matchIdx], foundTo: authObj.tos[matchIdx],
                                    auth: authEntry.auth, profileS: authEntry.profile_s, profileC: authEntry.profile_c,
                                    roleSingle: authEntry.role_single || '', roleComposite: authEntry.role_composite || ''
                                  });
                                }
                              }
                            }
                          }
                        }
                      } // end analysisLevel === 'Permission'

                      foundRows.push({
                        action, objectToSearch,
                        field: mi >= 0 ? authEntry.fields[mi] : authEntry.fields[0],
                        searchFrom: actionValue, searchTo: actionValue,
                        foundFrom: mi >= 0 ? authEntry.froms[mi] : authEntry.froms[0],
                        foundTo: mi >= 0 ? authEntry.tos[mi] : authEntry.tos[0],
                        auth: authEntry.auth, profileS: authEntry.profile_s, profileC: authEntry.profile_c,
                        roleSingle: authEntry.role_single || '', roleComposite: authEntry.role_composite || ''
                      });

                      if (analysisLevel === 'Permission' && permMatchRows.length > 0) {
                        foundRows.push(...permMatchRows);
                      }
                      break;
                    }
                  }
                } // end loop actionsRow
              } else if (analysisLevel === 'Permission') {
                // =========================================================================
                // SCENARIO B: PERMISSION-ONLY (es. S_DEVELOP - without actions)
                // =========================================================================
                //console.log(`Analysis [Permission-Only] Function: ${functId}`);

                // 1. get permissions
                const permsRes = await q(
                  `SELECT resourceid, resourceextn, fromval, toval, searchtype
                   FROM sod_function_permissions
                   WHERE rulesetid = $1 AND functid = $2
                     AND COALESCE(inactive::TEXT, '0') != '1'`,
                  [rulesetId, functId]
                );
                const permRows = permsRes.rows;

                if (permRows.length > 0) {
                  // group object - field
                  const permByObj = {};
                  for (const pr of permRows) {
                    const obj = pr.resourceid;
                    const fld = pr.resourceextn;
                    if (!permByObj[obj]) permByObj[obj] = {};
                    if (!permByObj[obj][fld]) permByObj[obj][fld] = [];
                    const fromEmpty = !pr.fromval || pr.fromval.trim() === '';
                    const toEmpty   = !pr.toval   || pr.toval.trim()   === '';
                    const fromval = fromEmpty ? '{' : pr.fromval;
                    const toval   = toEmpty ? (fromEmpty ? '{' : fromval) : pr.toval;
                    permByObj[obj][fld].push({ fromval, toval, searchtype: (pr.searchtype || 'AND').toUpperCase() });
                  }

                  // 2. get all authid
                  const userAuthsRes = await q(
                    `SELECT DISTINCT auth, objct, field, von, bis, profile_s, profile_c, role_single, role_composite
                     FROM tmp_sod_element_auth
                     WHERE elementid = $1`,
                    [elementId]
                  );

                  // group authid - object
                  const authMap = {};
                  for (const row of userAuthsRes.rows) {
                    const aId = row.auth;
                    const obj = row.objct.toUpperCase();
                    if (!authMap[aId]) {
                      authMap[aId] = {
                        auth: aId, profile_s: row.profile_s, profile_c: row.profile_c,
                        role_single: row.role_single || '', role_composite: row.role_composite || '',
                        objects: {}
                      };
                    }
                    if (!authMap[aId].objects[obj]) authMap[aId].objects[obj] = { fields: [], froms: [], tos: [] };
                    authMap[aId].objects[obj].fields.push(row.field);
                    authMap[aId].objects[obj].froms.push(row.von);
                    authMap[aId].objects[obj].tos.push(row.bis);
                  }

                  // 3. cycle authid
                  for (const authEntry of Object.values(authMap)) {
                    let permPassed = true;
                    let currentAuthMatchRows = [];

                    for (const [resourceId, fieldMap] of Object.entries(permByObj)) {
                      const authObj = authEntry.objects[resourceId.toUpperCase()];
                      if (!authObj) { permPassed = false; break; }

                      for (const [resourceExtn, valueRows] of Object.entries(fieldMap)) {
                        const andRows = valueRows.filter(v => v.searchtype === 'AND');
                        const orRows  = valueRows.filter(v => v.searchtype === 'OR');

                        for (const av of andRows) {
                          const matchIdx = authObj.fields.findIndex((f, i) =>
                            checkAuthorizationField(resourceExtn, av.fromval, av.toval, f, authObj.froms[i], authObj.tos[i])
                          );
                          if (matchIdx === -1) { permPassed = false; break; }

                          currentAuthMatchRows.push({
                            action: '', objectToSearch: resourceId, field: resourceExtn,
                            searchFrom: av.fromval === '{' ? '' : av.fromval, searchTo: av.toval === '{' ? '' : av.toval,
                            foundFrom: authObj.froms[matchIdx], foundTo: authObj.tos[matchIdx],
                            auth: authEntry.auth, profileS: authEntry.profile_s, profileC: authEntry.profile_c,
                            roleSingle: authEntry.role_single || '', roleComposite: authEntry.role_composite || ''
                          });
                        }
                        if (!permPassed) break;

                        if (orRows.length > 0) {
                          let anyOrMatch = false;
                          for (const ov of orRows) {
                            const matchIdx = authObj.fields.findIndex((f, i) =>
                              checkAuthorizationField(resourceExtn, ov.fromval, ov.toval, f, authObj.froms[i], authObj.tos[i])
                            );
                            if (matchIdx >= 0) {
                              anyOrMatch = true;
                              currentAuthMatchRows.push({
                                action: '', objectToSearch: resourceId, field: resourceExtn,
                                searchFrom: ov.fromval === '{' ? '' : ov.fromval, searchTo: ov.toval === '{' ? '' : ov.toval,
                                foundFrom: authObj.froms[matchIdx], foundTo: authObj.tos[matchIdx],
                                auth: authEntry.auth, profileS: authEntry.profile_s, profileC: authEntry.profile_c,
                                roleSingle: authEntry.role_single || '', roleComposite: authEntry.role_composite || ''
                              });
                              break;
                            }
                          }
                          if (!anyOrMatch) { permPassed = false; break; }
                        }
                      }
                      if (!permPassed) break;
                    }

                    // if authid match permission map, save
                    if (permPassed && currentAuthMatchRows.length > 0) {
                      foundRows.push(...currentAuthMatchRows);
                    }
                  }
                }
              } // end loop actions



        if (foundRows.length > 0) foundByFunction[functId] = foundRows;
      } // end loop functionIds

      // STEP 3: risk confirmed only if ALL functions have at least one action found
      if (!functionIds.every(f => foundByFunction[f] && foundByFunction[f].length > 0)) continue;

      // STEP 4: add to sod_ra_results
      for (const functId of functionIds) {
        const functDesc = await getSodFunctionDescription(realmLanguage, rulesetId, functId);
        for (const row of foundByFunction[functId]) {

          // Lookup rolesingle e rolecomposite
          let roleSingle = '';
          let roleComposite = '';

          if (elementType === 'Roles') {
            // For Roles: roleSingle and roleComposite are already in the tmp table row
            roleSingle = row.roleSingle || elementId;
            roleComposite = row.roleComposite || '';
          } else {
            // For Users: look up rolesingle in agr_1016 via profile_s or profile_c
            const profilesToTry = [row.profileS, row.profileC].filter(p => p && p.trim() !== '');
            for (const prof of profilesToTry) {
              const agr1016Res = await q(
                `SELECT agr_name FROM sap_raw_${realm}_agr_1016 WHERE profile = $1 LIMIT 1`,
                [prof]
              ).catch(() => ({ rows: [] }));
              if (agr1016Res.rows.length > 0 && agr1016Res.rows[0].agr_name) {
                roleSingle = agr1016Res.rows[0].agr_name;
                break;
              }
            }
            // rolecomposite: look up in agr_agrs + verify assignment in agr_users with valid dates
            if (roleSingle) {
              const agrAgrsRes = await q(
                `SELECT agr_name FROM sap_raw_${realm}_agr_agrs WHERE child_agr = $1`,
                [roleSingle]
              ).catch(() => ({ rows: [] }));
              for (const agrsRow of agrAgrsRes.rows) {
                const compositeRole = agrsRow.agr_name;
                const agrUsersRes = await q(
                  `SELECT 1 FROM sap_raw_${realm}_agr_users
                   WHERE agr_name = $1
                     AND uname = $2
                     AND from_dat <= $3
                     AND (to_dat IS NULL OR to_dat >= $3)
                   LIMIT 1`,
                  [compositeRole, elementId, realmRefDate]
                ).catch(() => ({ rows: [] }));
                if (agrUsersRes.rows.length > 0) {
                  roleComposite = compositeRole;
                  break;
                }
              }
            }
          }

          await q(`
            INSERT INTO sod_ra_results
            (elementtype,elementid,elementdescription,riskid,riskdescription,risklevel,risktype,
             functionid,functiondescription,action,authobject,authfield,
             searchfrom,searchto,foundvaluefrom,foundvalueto,
             authorizationID,profilesingle,profilecomposite,rolesingle,rolecomposite)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
          `, [
            elementType, elementId, elementDesc,
            riskId, riskDesc, riskLevel, riskType, functId, functDesc, row.action || '',
            row.objectToSearch, row.field,
            row.searchFrom, row.searchTo,
            row.foundFrom, row.foundTo,
            row.auth, row.profileS, row.profileC, roleSingle, roleComposite
          ]);
        }
      }
    } // fine loop risks

    await q(`DROP TABLE IF EXISTS tmp_sod_element_auth`);
  } // fine loop elements

  const totalRes = await q(`SELECT COUNT(*) AS count FROM sod_ra_results`);
  const total = Number(totalRes.rows[0].count);
  const previewRes = await q(`SELECT * FROM sod_ra_results LIMIT 100`);
  return { total, rows: previewRes.rows };
  } finally {
    client.release();
  }
}

/**
 * Compares a "search" authorization with a "check" authorization.
 * return true se if authorization field match EXACTLY, and if at least
 * one of the two ends of the "check" range (from or to) falls within the "search" range
 * (valueFromSearch <= valueToCheck OR valueToSearch >= valueFromCheck).
 *
 * Note: the authorization object comparison (objectSearch === objectCheck) is not
 * included here because it is already verified upstream by authorizationCheck at the global level.
 *
 * @param {string} fieldSearch      - Authorization field to search
 * @param {string|number} valueFromSearch - "from" value to search for
 * @param {string|number} valueToSearch   - "to" value to search for
 * @param {string} fieldCheck       - Authorization field to check
 * @param {string|number} valueFromCheck  - "from" value to check against
 * @param {string|number} valueToCheck    - "to" value to check against
 * @returns {boolean}
 */
export function checkAuthorizationField(
  fieldSearch, valueFromSearch, valueToSearch,
  fieldCheck, valueFromCheck, valueToCheck
) {
  if (fieldSearch !== fieldCheck) return false;

  // Helper function for SEARCH: expand wildcard, but leaves * as exact value (looking exactly for *)
  const expandWildcardSearch = (from, to) => {
    let f = String(from);
    let t = String(to || from);

    // Expand only if * is in string, but it is NOT the full string (eg. "SAR*")
    // if f is exactly "*", leave it as normal value (does not expand)
    if (f.includes("*") && f !== "*") {
      let prefix = f.replace("*", "");
      return [prefix, prefix + "{"];
    }

    return [f, t];
  };

  // Helper function to expand wildcards into a range
  const expandWildcard = (from, to) => {
    let f = String(from);
    let t = String(to || from);

    // If the value is "*", it covers everything: from "" to "{" (the character after 'z')
    if (f === "*") return ["", "{"];

    // if contains "*", eg: "SAR*"
    if (f.includes("*")) {
      let prefix = f.replace("*", "");
      return [prefix, prefix + "{"]; // { is the ASCII character after 'z'
    }

    return [f, t];
  };

  const [fSearch, tSearch] = expandWildcardSearch(valueFromSearch, valueToSearch);
  const [fCheck, tCheck] = expandWildcard(valueFromCheck, valueToCheck);

  // overlap logic: (Start1 <= End2) AND (Start1 >= End2)
  const valueOverlap = (fSearch <= tCheck) && (tSearch >= fCheck);

  //console.log(`Debug: Search[${fSearch}-${tSearch}] vs Check[${fCheck}-${tCheck}] -> ${valueOverlap}`);

  return valueOverlap;
}

/**
 * Reproduces the logic of the SAP kernel's AUTHORITY-CHECK: verifies whether an authorization
 * "check" authorization (up to 10 field/from/to rows) satisfies a "search" authorization
 * (fino a 10 righe field/from/to).
 *
 * For EVERY DISTINCT field present in the search (e.g. ACTVT, DICBERCLS), there must exist
 * at least one "check" row with the same field that matches (via checkAuthorizationField)
 * with at least one "search" row of the same field (OR across rows of the same field).
 * The function returns TRUE only if ALL distinct search fields find a match
 * (AND across different fields) - replicating the SAP behavior where an authorization
 * "covers" a request only if it satisfies every required field at the same time.
 *
 * Arrays can contain fewer than 10 values: empty/unset positions
 * (undefined, null, stringa vuota) vengono ignorate.
 *
 * @param {string} authorizationID
 * @param {string} objectToBeChecked
 * @param {string[]} fieldsToBeChecked            - up to 10 fields
 * @param {string[]} fieldsValuesFromToBeChecked   - up to 10 values "from"
 * @param {string[]} fieldsValuesToToBeChecked     - up to 10 values "to"
 * @param {string} objectToSearch
 * @param {string[]} fieldsToSearch                - up to 10 fields
 * @param {string[]} fieldsValuesFromToSearch       - up to 10 values "from"
 * @param {string[]} fieldsValuesToToSearch         - up to 10 values "to"
 * @returns {boolean}
 */
export function authorizationCheck(
  authorizationID,
  objectToBeChecked, fieldsToBeChecked, fieldsValuesFromToBeChecked, fieldsValuesToToBeChecked,
  objectToSearch, fieldsToSearch, fieldsValuesFromToSearch, fieldsValuesToToSearch
) {
  const isFilled = v => v !== undefined && v !== null && String(v).trim() !== '';

  // Build the valid rows (field + from + to) for the "check" side
  const checkRows = [];
  for (let i = 0; i < 10; i++) {
    const field = fieldsToBeChecked?.[i];
    if (!isFilled(field)) continue;
    checkRows.push({
      field,
      from: fieldsValuesFromToBeChecked?.[i] ?? '',
      to: fieldsValuesToToBeChecked?.[i] ?? ''
    });
  }

  // Build the valid rows (field + from + to) for the "search" side
  const searchRows = [];
  for (let i = 0; i < 10; i++) {
    const field = fieldsToSearch?.[i];
    if (!isFilled(field)) continue;
    searchRows.push({
      field,
      from: fieldsValuesFromToSearch?.[i] ?? '',
      to: fieldsValuesToToSearch?.[i] ?? ''
    });
  }

  if (searchRows.length === 0) {
    // no field required from search: nothing to check
    return false;
  }

  // The authorization object must match at the global level (e.g. both S_TABU_DIS)
  if (objectToBeChecked !== objectToSearch) {
    return false;
  }

  // DIFFERENT FIELDS required from search (es. ACTVT, DICBERCLS)
  const distinctSearchFields = [...new Set(searchRows.map(r => r.field))];

  // AND across different fields: every distinct search field must find at least one match
  return distinctSearchFields.every(fieldName => {
    const searchRowsForField = searchRows.filter(r => r.field === fieldName);
    const checkRowsForField = checkRows.filter(r => r.field === fieldName);

    // OR across rows of the same field (up to 10x10 combinations)
    return searchRowsForField.some(searchRow =>
      checkRowsForField.some(checkRow =>
        checkAuthorizationField(
          searchRow.field, searchRow.from, searchRow.to,
          checkRow.field, checkRow.from, checkRow.to
        )
      )
    );
  });
}

export async function importStatisticsFromTxt(realm, txtContent) {
  const sanitizedTableName = 'sap_raw_user_stats';
  const linesArray = txtContent.split(/\r?\n/);
  if (linesArray.length < 1) return { imported: 0 };

  // Assumption: the very first line is always "# PERIOD_TYPE: X"
  const firstLine = linesArray[0].trim();
  let periodType = 'D'; // fallback
  //periodType = firstLine.charAt(15).toUpperCase();
  if (firstLine.startsWith('# PERIOD_TYPE:')) {
    // Extract the character after the colon, robust to extra spaces
    const parts = firstLine.split(':');
    if (parts.length > 1) {
      const after = parts[1].trim();
      if (after.length > 0) {
        periodType = after[0].toUpperCase();
      }
    }
  }


  // Find the header line (first non-comment line)
  let headerLineIndex = -1;
  for (let i = 0; i < linesArray.length; i++) {
    const line = linesArray[i].trim();
    if (line && !line.startsWith('#')) {
      headerLineIndex = i;
      break;
    }
  }

  if (headerLineIndex === -1) return { imported: 0 };

  const headerLine = linesArray[headerLineIndex].trim();
  const header = headerLine.split('\t');
  const selectedAtIdx = header.findIndex(h => h.toLowerCase() === 'selected_at');

  // Ensure "selected_at" is not duplicated in columnDefs
  const filteredHeader = header.filter((_, idx) => idx !== selectedAtIdx);
  const columnDefs = filteredHeader.map(col => `"${col.toLowerCase()}" TEXT`).join(', ');

  await pool.query(`CREATE TABLE IF NOT EXISTS "${sanitizedTableName}" (
    id SERIAL PRIMARY KEY,
    realm TEXT NOT NULL,
    period_type TEXT NOT NULL,
    selected_at TIMESTAMPTZ NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ${columnDefs}
  )`);

  await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "action" TEXT`);
  await pool.query(`ALTER TABLE "${sanitizedTableName}" ADD COLUMN IF NOT EXISTS "actiontype" TEXT`);

  let imported = 0;
  for (let i = headerLineIndex + 1; i < linesArray.length; i++) {
    const line = linesArray[i].trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    const values = line.split('\t');
    if (values.length !== header.length) continue;

    // Use selected_at from file if available, otherwise current date
    let rowSelectedAt = new Date().toISOString();
    if (selectedAtIdx !== -1 && values[selectedAtIdx]) {
      rowSelectedAt = values[selectedAtIdx];
    }

    // Filter out the value corresponding to "selected_at" from the values array
    const filteredValues = values.filter((_, idx) => idx !== selectedAtIdx);

    const placeholders = filteredValues.map((_, idx) => `$${idx + 4}`).join(', ');
    const columnNames = filteredHeader.map(col => `"${col.toLowerCase()}"`).join(', ');

    await pool.query(
      `INSERT INTO "${sanitizedTableName}" (realm, period_type, selected_at, ${columnNames}) VALUES ($1, $2, $3::timestamptz, ${placeholders})`,
      [realm, periodType, rowSelectedAt, ...filteredValues]
    );
    imported++;
  }

  return { imported, periodType };
}

export async function getAggregatedUserStats(realm) {
  const sanitizedTableName = 'sap_raw_user_stats';
  try {
    const result = await pool.query(
      `SELECT period_type, selected_at, COUNT(*) as row_count
       FROM "${sanitizedTableName}"
       WHERE realm = $1
       GROUP BY period_type, selected_at
       ORDER BY selected_at DESC`,
      [realm]
    );
    return result.rows;
  } catch (err) {
    return [];
  }
}

export async function deleteUserStatsBatch(realm, periodType, selectedAt) {
  const sanitizedTableName = 'sap_raw_user_stats';
  const result = await pool.query(
    `DELETE FROM "${sanitizedTableName}"
     WHERE realm = $1 AND period_type = $2 AND selected_at = $3::timestamptz`,
    [realm, periodType, selectedAt]
  );
  return result.rowCount;
}

export async function buildAdditionalInfos(realm) {
  const realmConfig = await getSapRealm(realm);
  if (!realmConfig) {
    throw new Error(`Realm not found: ${realm}`);
  }

  // Get realm_reference_date, default to current date if not set
  let sProjectDate = realmConfig.realm_reference_date;
  if (!sProjectDate) {
    sProjectDate = new Date().toISOString().split('T')[0];
  } else {
    // Handle Date object from PostgreSQL
    sProjectDate = sProjectDate instanceof Date ? sProjectDate.toISOString().split('T')[0] : String(sProjectDate);
  }
  // Convert to YYYYMMDD format for SAP date comparison
  const sProjectDateSap = sProjectDate.replace(/-/g, '');

  // Get Project language
  let sProjectLanguage = realmConfig.sap_language;
  let fistCharProjectLang = sProjectLanguage[0];

  // Get Project client(mandante)
  let sProjectClient = realmConfig.sap_client;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');


    // Drop target tables if exists
    await client.query(`DROP TABLE IF EXISTS "yr_${realm}_user_complete_info"`);
    await client.query(`DROP TABLE IF EXISTS "yr_${realm}_role_stcode_exploded"`);
    await client.query(`DROP TABLE IF EXISTS "yr_${realm}_roles_descriptions"`);
    await client.query(`DROP TABLE IF EXISTS "yr_${realm}_tcodes_description"`);
    await client.query(`DROP TABLE IF EXISTS "yr_${realm}_statistic_slim"`);
    await client.query(`DROP TABLE IF EXISTS "yr_${realm}_roles_infos"`);


//**************************************info users:
    // Drop temporary tables if exists
    await client.query(`DROP TABLE IF EXISTS "tmp_sap_raw_${realm}_adr6_clean"`);

    // Query 1: Create temporary table
    await client.query(`
      CREATE TABLE "tmp_sap_raw_${realm}_adr6_clean" AS
      SELECT
        "persnumber",
        "smtp_addr"
      FROM "sap_raw_${realm}_adr6"
      WHERE
        "persnumber" <> '' AND
        "valid_to" = ''
    `);

    // Query 2: Create users main info table
    await client.query(`
      CREATE TABLE "yr_${realm}_user_complete_info" AS
      SELECT
        u02."bname",
        u02."gltgv",
        u02."gltgb",
        u02."erdat",
        u02."trdat",
        u02."uflag",
        u02."ustyp",
        u02."class",
        u21."persnumber",
        adrp."name_first",
        adrp."name_last",
        adrp."nickname",
        adrp."sort1",
        adrp."sort2",
        tmp."smtp_addr",
        adcp."department",
        adcp."function" as "function_col",
        CASE
          WHEN (
            (u02."gltgv" <= $1 OR u02."gltgv" = '19000101' OR u02."gltgv" IS NULL)
            AND (u02."gltgb" >= $1 OR u02."gltgb" = '19000101' OR u02."gltgb" IS NULL)
          )
          AND (u02."uflag" <> '64' AND u02."uflag" <> '192')
          THEN 1
          ELSE 0
        END AS "user_valid"
      FROM "sap_raw_${realm}_usr02" u02
      LEFT JOIN "sap_raw_${realm}_usr21" u21 ON u21."bname" = u02."bname"
      LEFT JOIN "sap_raw_${realm}_adrp" adrp ON adrp."persnumber" = u21."persnumber"
      LEFT JOIN "sap_raw_${realm}_adcp" adcp ON adcp."persnumber" = u21."persnumber"
      LEFT JOIN "tmp_sap_raw_${realm}_adr6_clean" tmp ON tmp."persnumber" = u21."persnumber"
    `, [sProjectDateSap]);

    // Drop temporary table
    await client.query(`DROP TABLE IF EXISTS "tmp_sap_raw_${realm}_adr6_clean"`);

    await client.query('COMMIT');
//***********************************S_TCODE EXPANDED
    await client.query(`
      CREATE TABLE yr_${realm}_role_stcode_exploded AS
-- First part: range between LOW and HIGH
--between:
SELECT
    sap_raw_${realm}_AGR_1251.AGR_NAME,
    sap_raw_${realm}_AGR_1251.LOW,
    sap_raw_${realm}_AGR_1251.HIGH,
    sap_raw_${realm}_TSTC.TCODE AS TCODETOTAL,
    1 as EXPLODED
FROM sap_raw_${realm}_AGR_1251
INNER JOIN sap_raw_${realm}_TSTC ON sap_raw_${realm}_TSTC.TCODE BETWEEN sap_raw_${realm}_AGR_1251.LOW AND sap_raw_${realm}_AGR_1251.HIGH
WHERE sap_raw_${realm}_AGR_1251.OBJECT = 'S_TCODE'
  AND sap_raw_${realm}_AGR_1251.HIGH <> ''
  AND sap_raw_${realm}_AGR_1251.DELETED is null

UNION

-- Seconda Parte: Corrispondenza esatta (senza wildcard). Low senza asterisco:
SELECT
    sap_raw_${realm}_AGR_1251.AGR_NAME,
    sap_raw_${realm}_AGR_1251.LOW,
    sap_raw_${realm}_AGR_1251.HIGH,
    sap_raw_${realm}_TSTC.TCODE AS TCODETOTAL,
    0 as EXPLODED
FROM sap_raw_${realm}_AGR_1251
INNER JOIN sap_raw_${realm}_TSTC ON sap_raw_${realm}_TSTC.TCODE = sap_raw_${realm}_AGR_1251.LOW
WHERE sap_raw_${realm}_AGR_1251.OBJECT = 'S_TCODE'
  AND sap_raw_${realm}_AGR_1251.DELETED is null
  AND sap_raw_${realm}_AGR_1251.HIGH is null
  AND POSITION('*' IN sap_raw_${realm}_AGR_1251.LOW) = 0

UNION

-- Terza Parte: high (asterisco in high non viene considerato in sap)
SELECT
    sap_raw_${realm}_AGR_1251.AGR_NAME,
    sap_raw_${realm}_AGR_1251.LOW,
    sap_raw_${realm}_AGR_1251.HIGH,
    sap_raw_${realm}_TSTC.TCODE AS TCODETOTAL,
    1 as EXPLODED
FROM sap_raw_${realm}_AGR_1251
INNER JOIN sap_raw_${realm}_TSTC ON sap_raw_${realm}_TSTC.TCODE LIKE REPLACE(REPLACE(sap_raw_${realm}_AGR_1251.HIGH, '*', '%'), '_', '\_')
WHERE sap_raw_${realm}_AGR_1251.OBJECT = 'S_TCODE'
  AND sap_raw_${realm}_AGR_1251.DELETED is null
  AND sap_raw_${realm}_AGR_1251.HIGH <> ''

UNION

-- Fourth part: wildcard in the LOW field. Low with asterisk:
SELECT
    sap_raw_${realm}_AGR_1251.AGR_NAME,
    sap_raw_${realm}_AGR_1251.LOW,
    sap_raw_${realm}_AGR_1251.HIGH,
    sap_raw_${realm}_TSTC.TCODE AS TCODETOTAL,
    1 as EXPLODED
FROM sap_raw_${realm}_AGR_1251
INNER JOIN sap_raw_${realm}_TSTC ON sap_raw_${realm}_TSTC.TCODE LIKE REPLACE(REPLACE(sap_raw_${realm}_AGR_1251.LOW, '*', '%'), '_', '[_]')
WHERE sap_raw_${realm}_AGR_1251.OBJECT = 'S_TCODE'
  AND sap_raw_${realm}_AGR_1251.DELETED is null
  AND sap_raw_${realm}_AGR_1251.HIGH is null
  AND POSITION('*' IN sap_raw_${realm}_AGR_1251.LOW) > 0
`);

//***********************************roles descriptions:
//drop the temp table if it exists:

    await client.query(`DROP TABLE IF EXISTS "tmp_sap_raw_${realm}_agr_texts_local"`);

    //create tmp table with the project language only:


    await client.query(`
      CREATE TABLE "tmp_sap_raw_${realm}_agr_texts_local" AS
      SELECT
      *
      FROM "sap_raw_${realm}_agr_texts"
      WHERE
        "spras" = $1
    `, [fistCharProjectLang]);

    //create the final table starting from the project language via left join:

        await client.query(`
      CREATE TABLE "yr_${realm}_roles_descriptions" AS
         SELECT sap_raw_${realm}_agr_define.agr_name, tmp_sap_raw_${realm}_agr_texts_local.text
        FROM sap_raw_${realm}_agr_define
        LEFT JOIN tmp_sap_raw_${realm}_agr_texts_local ON tmp_sap_raw_${realm}_agr_texts_local.agr_name = sap_raw_${realm}_agr_define.agr_name
        WHERE tmp_sap_raw_${realm}_agr_texts_local.line IS NULL OR tmp_sap_raw_${realm}_agr_texts_local.line = '00000'
    `);


    let tmpAltLang = (sProjectLanguage[0] === 'I') ? 'E' : 'I';
    //update rows for the alternative language:
        await client.query(`
 UPDATE "yr_${realm}_roles_descriptions"
        SET TEXT = sap_raw_${realm}_agr_texts.TEXT
        FROM "sap_raw_${realm}_agr_texts"
        WHERE sap_raw_${realm}_agr_texts.agr_name = yr_${realm}_roles_descriptions.agr_name
        AND (yr_${realm}_roles_descriptions.text IS NULL OR yr_${realm}_roles_descriptions.text = '')
        AND (sap_raw_${realm}_agr_texts.line IS NULL OR sap_raw_${realm}_agr_texts.line = '00000')
        AND sap_raw_${realm}_agr_texts.spras = $1
    `, [tmpAltLang]);

    //update rows for German (fallback):

            await client.query(`
 UPDATE "yr_${realm}_roles_descriptions"
        SET TEXT = sap_raw_${realm}_agr_texts.TEXT
        FROM "sap_raw_${realm}_agr_texts"
        WHERE sap_raw_${realm}_agr_texts.agr_name = yr_${realm}_roles_descriptions.agr_name
        AND (yr_${realm}_roles_descriptions.text IS NULL OR yr_${realm}_roles_descriptions.text = '')
        AND (sap_raw_${realm}_agr_texts.line IS NULL OR sap_raw_${realm}_agr_texts.line = '00000')
        AND sap_raw_${realm}_agr_texts.spras = 'D'
    `);

    //drop the temp table if it exists:

    await client.query(`DROP TABLE IF EXISTS "tmp_sap_raw_${realm}_agr_texts_local"`);

//***********************************tcode decriptions:

    //drop the temp table if it exists:
    await client.query(`DROP TABLE IF EXISTS "tmp_sap_raw_${realm}_tstct_local"`);


    //create tmp table with the project language only:

    await client.query(`
      CREATE TABLE "tmp_sap_raw_${realm}_tstct_local" AS
      SELECT
      *
      FROM "sap_raw_${realm}_tstct"
      WHERE
        "sprsl" = $1
    `, [fistCharProjectLang]);

    //create the final table with the project language:
        await client.query(`
      CREATE TABLE "yr_${realm}_tcodes_description" AS
      SELECT
      sap_raw_${realm}_tstc.tcode,
      tmp_sap_raw_${realm}_tstct_local.ttext
      FROM "sap_raw_${realm}_tstc"
      LEFT JOIN tmp_sap_raw_${realm}_tstct_local ON tmp_sap_raw_${realm}_tstct_local.tcode = sap_raw_${realm}_tstc.tcode
    `);

    //update the final table with the alternative language:

    await client.query(`
    UPDATE "yr_${realm}_tcodes_description"
        SET ttext = sap_raw_${realm}_tstct.ttext
        FROM "sap_raw_${realm}_tstct"
        WHERE sap_raw_${realm}_tstct.tcode = yr_${realm}_tcodes_description.tcode AND
        yr_${realm}_tcodes_description.ttext is null AND
        sap_raw_${realm}_tstct.sprsl = $1 AND
        sap_raw_${realm}_tstct.ttext <> '' AND
        sap_raw_${realm}_tstct.ttext IS NOT NULL
    `, [tmpAltLang]);

    //fallback in DE:

    await client.query(`
    UPDATE "yr_${realm}_tcodes_description"
        SET ttext = sap_raw_${realm}_tstct.ttext
        FROM "sap_raw_${realm}_tstct"
        WHERE sap_raw_${realm}_tstct.tcode = yr_${realm}_tcodes_description.tcode AND
        yr_${realm}_tcodes_description.ttext is null AND
        sap_raw_${realm}_tstct.sprsl = 'D' AND
        sap_raw_${realm}_tstct.ttext <> '' AND
        sap_raw_${realm}_tstct.ttext IS NOT NULL
    `);



    //drop the temp table if it exists:
    await client.query(`DROP TABLE IF EXISTS "tmp_sap_raw_${realm}_tstct_local"`);

//****************************statistiche utente:
//WARNING: THE CLIENT (MANDT) IS MISSING IN STATISTICS!!! It may be implicit. Investigate the call
//remove MANDT from where if not used:
        await client.query(`
    CREATE TABLE "yr_${realm}_statistic_slim" AS
    SELECT
        action,
        actiontype,
        account,
        COUNT(DISTINCT selected_at) as nexec
    FROM sap_raw_user_stats
    WHERE realm = '${realm}'
    GROUP BY action, actiontype, account
    `);


//*********************************roles info:
    // 1. Initial table creation: CASE WHEN replaces IIF

    const query1 = `
        CREATE TABLE yr_${realm}_roles_infos AS
        SELECT
            D.AGR_NAME,
            D.TEXT,
            CASE
                WHEN F.FLAG_VALUE = 'X' THEN 'COMPOSITE'
                ELSE 'SINGLE'
            END as ROLE_TYPE
        FROM yr_${realm}_roles_descriptions D
        LEFT JOIN sap_raw_${realm}_agr_flags F ON F.AGR_NAME = D.AGR_NAME
        WHERE F.FLAG_TYPE = 'COLL_AGR'
    `;
    await client.query(query1);

    // 2. Update Derived: Postgres Syntax (UPDATE ... FROM ... WHERE)
    const updateDerivati = `
        UPDATE yr_${realm}_roles_infos RI
        SET ROLE_TYPE = 'DERIVED'
        FROM sap_raw_${realm}_agr_define AD
        WHERE AD.AGR_NAME = RI.AGR_NAME
          AND AD.PARENT_AGR <> ''
    `;
    await client.query(updateDerivati);

    // 3. Update Composite da AGR_AGRS
    const updateComposite = `
        UPDATE yr_${realm}_roles_infos RI
        SET ROLE_TYPE = 'COMPOSITE'
        FROM sap_raw_${realm}_agr_agrs AA
        WHERE AA.AGR_NAME = RI.AGR_NAME
          AND AA.CHILD_AGR <> ''
    `;
    await client.query(updateComposite);

    // 4. Insert the remaining ones (UNDEFINED)
    const insertUndefined = `
        INSERT INTO yr_${realm}_roles_infos (AGR_NAME, TEXT, ROLE_TYPE)
        SELECT
            D.AGR_NAME,
            D.TEXT,
            'UNDEFINED'
        FROM yr_${realm}_roles_descriptions D
        LEFT JOIN yr_${realm}_roles_infos RI ON RI.AGR_NAME = D.AGR_NAME
        WHERE RI.ROLE_TYPE IS NULL
    `;
    await client.query(insertUndefined);

    // 5. Final update to turn UNDEFINED into SINGLE if present in 1251
    const updateFinalSingle = `
        UPDATE yr_${realm}_roles_infos RI
        SET ROLE_TYPE = 'SINGLE'
        FROM sap_raw_${realm}_agr_1251 A1
        WHERE RI.AGR_NAME = A1.AGR_NAME
          AND RI.ROLE_TYPE = 'UNDEFINED'
    `;
    await client.query(updateFinalSingle);

    return { success: true, message: 'Additional infos built successfully' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Execute generic report - supports multiple report types
export async function executeReport(realm, reportType, options = {}) {
  const realmConfig = await getSapRealm(realm);
  if (!realmConfig) {
    throw new Error(`Realm not found: ${realm}`);
  }

  // Compute project date = realm_reference_date – options.days
  let projectDate = realmConfig.realm_reference_date;
  if (!projectDate) {
    projectDate = new Date();
  } else {
    projectDate = new Date(projectDate);
  }
  const sProjectDate = projectDate.toISOString().split('T')[0]; //project date as a string for ROLE06
  const deltaDays = Number(options.days) || 0;
  projectDate.setDate(projectDate.getDate() - deltaDays);
  const deltaProjectDate = projectDate.toISOString().split('T')[0]; // YYYY-MM-DD.
  const pattern = options.pattern || '';
  const sProjectLanguage = realmConfig.sap_language;
  let fistCharProjectLang = sProjectLanguage[0];

  const client = await pool.connect();
  try {
    switch (reportType) {
      case 'USER01': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_user01"`);
        await client.query(`
          CREATE TABLE "yreport_${realm}_user01" AS
          SELECT
            "bname" AS "userid",
            "gltgv" AS "valid_from",
            "gltgb" AS "valid_to",
            "erdat" AS "created",
            "trdat" AS "last_logon",
            "uflag" AS "lock_code",
            "ustyp",
            "class" AS "usergroup",
            "name_first",
            "name_last",
            "nickname",
            "sort1",
            "sort2",
            "smtp_addr",
            "department",
            "function_col" AS "sapfunction",
            "user_valid"
          FROM "yr_${realm}_user_complete_info"
          WHERE
            "erdat" <= $1
            AND ("trdat" <= $1 OR "trdat" IS NULL)
            AND ("ustyp" = 'A' OR "ustyp" = 'S')
            AND "user_valid" = 1
        `, [deltaProjectDate]);

        return {
          success: true,
          message: 'USER01 report executed successfully',
          reportType: 'USER01',
          deltaProjectDate,
          tableName: `yreport_${realm}_user01`
        };
      }

            case 'USER02': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_user02"`);
        await client.query(`
    CREATE TABLE yreport_${realm}_user02 AS
    SELECT
    yr_${realm}_user_complete_info.BNAME AS USERID,
    yr_${realm}_user_complete_info.GLTGV AS DATE_FROM,
    yr_${realm}_user_complete_info.GLTGB AS DATE_TO,
    yr_${realm}_user_complete_info.ERDAT AS CREATED,
    yr_${realm}_user_complete_info.TRDAT AS LAST_LOGON,
    yr_${realm}_user_complete_info.USTYP,
    yr_${realm}_user_complete_info.CLASS AS USER_GROUP,
    yr_${realm}_user_complete_info.NAME_FIRST,
    yr_${realm}_user_complete_info.NAME_LAST,
    sap_raw_${realm}_ust04.PROFILE
    FROM
    yr_${realm}_user_complete_info
    INNER JOIN
    sap_raw_${realm}_ust04 ON sap_raw_${realm}_ust04.BNAME = yr_${realm}_user_complete_info.BNAME
    WHERE
    (sap_raw_${realm}_ust04.PROFILE = 'SAP_ALL' OR sap_raw_${realm}_ust04.PROFILE = 'SAP_NEW')
    AND yr_${realm}_user_complete_info.USER_VALID = 1
        `);

        return {
          success: true,
          message: 'USER02 report executed successfully',
          reportType: 'USER02',
          deltaProjectDate,
          tableName: `yreport_${realm}_USER02`
        };
      }

                  case 'USER03': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_user03"`);
        await client.query(`
    CREATE TABLE yreport_${realm}_user03 AS
    SELECT
    yr_${realm}_user_complete_info.BNAME as USERID,
    yr_${realm}_user_complete_info.GLTGV as DATE_FROM,
    yr_${realm}_user_complete_info.GLTGB as DATE_TO,
    yr_${realm}_user_complete_info.ERDAT as CREATED,
    yr_${realm}_user_complete_info.TRDAT as LAST_LOGON,
    yr_${realm}_user_complete_info.USTYP,
    yr_${realm}_user_complete_info.CLASS as USER_GROUP,
    yr_${realm}_user_complete_info.NAME_FIRST,
    yr_${realm}_user_complete_info.NAME_LAST,
    sap_raw_${realm}_ust04.PROFILE
    FROM
    yr_${realm}_user_complete_info
    INNER JOIN sap_raw_${realm}_ust04 ON sap_raw_${realm}_ust04.BNAME = yr_${realm}_user_complete_info.BNAME
    LEFT JOIN sap_raw_${realm}_agr_1016 ON sap_raw_${realm}_agr_1016.PROFILE = sap_raw_${realm}_ust04.PROFILE
    LEFT JOIN sap_raw_${realm}_agr_users ON sap_raw_${realm}_agr_users.AGR_NAME = sap_raw_${realm}_agr_1016.AGR_NAME
    AND sap_raw_${realm}_agr_users.UNAME = yr_${realm}_user_complete_info.BNAME
    where
    sap_raw_${realm}_agr_users.AGR_NAME is null and yr_${realm}_user_complete_info.USER_VALID = 1
        `);

        return {
          success: true,
          message: 'USER03 report executed successfully',
          reportType: 'USER03',
          deltaProjectDate,
          tableName: `yreport_${realm}_user03`
        };
      }

      case 'USER04': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_user04"`);
        await client.query(`
    CREATE TABLE yreport_${realm}_user04 AS
    SELECT
    yr_${realm}_user_complete_info.BNAME as USERID,
    yr_${realm}_user_complete_info.NAME_FIRST,
    yr_${realm}_user_complete_info.NAME_LAST,
    yr_${realm}_user_complete_info.GLTGV as DATE_FROM,
    yr_${realm}_user_complete_info.GLTGB as DATE_TO,
    yr_${realm}_user_complete_info.ERDAT as CREATED,
    yr_${realm}_user_complete_info.TRDAT as LAST_LOGON,
    yr_${realm}_user_complete_info.UFLAG as LOCK_CODE,
    yr_${realm}_user_complete_info.USTYP,
    yr_${realm}_user_complete_info.CLASS as USER_GROUP,
    yr_${realm}_user_complete_info.PERSNUMBER,
    yr_${realm}_user_complete_info.NICKNAME,
    yr_${realm}_user_complete_info.SORT1,
    yr_${realm}_user_complete_info.SORT2,
    yr_${realm}_user_complete_info.SMTP_ADDR as MAIL_ADDRESS,
    yr_${realm}_user_complete_info.DEPARTMENT,
    yr_${realm}_user_complete_info.function_col as "sapfunction",
    yr_${realm}_user_complete_info.USER_VALID
    FROM
    yr_${realm}_user_complete_info
        `);

        return {
          success: true,
          message: 'USER04 report executed successfully',
          reportType: 'USER04',
          deltaProjectDate,
          tableName: `yreport_${realm}_user04`
        };
      }

      case 'ROLE01': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role01"`);

        if (pattern && pattern.trim() !== '') {
          // With WHERE clause using pattern
          await client.query(`
CREATE TABLE "yreport_${realm}_role01" AS
SELECT
sap_raw_${realm}_agr_flags.AGR_NAME,
yr_${realm}_roles_descriptions.TEXT AS COMP_DESCR,
sap_raw_${realm}_agr_agrs.CHILD_AGR,
yr_${realm}_roles_descriptions1.TEXT AS SINGLE_DESCR,
yr_${realm}_role_stcode_exploded.TCODETOTAL,
yr_${realm}_tcodes_description.TTEXT AS TCODE_DESCRIPTION
FROM
sap_raw_${realm}_agr_flags
LEFT JOIN sap_raw_${realm}_agr_agrs ON sap_raw_${realm}_agr_agrs.AGR_NAME = sap_raw_${realm}_agr_flags.AGR_NAME
LEFT JOIN yr_${realm}_role_stcode_exploded ON yr_${realm}_role_stcode_exploded.AGR_NAME = sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME = sap_raw_${realm}_agr_flags.AGR_NAME
LEFT JOIN yr_${realm}_roles_descriptions yr_${realm}_roles_descriptions1 ON yr_${realm}_roles_descriptions1.AGR_NAME = sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN yr_${realm}_tcodes_description ON yr_${realm}_tcodes_description.TCODE = yr_${realm}_role_stcode_exploded.TCODETOTAL
WHERE
sap_raw_${realm}_agr_flags.FLAG_TYPE = 'COLL_AGR' AND
sap_raw_${realm}_agr_flags.FLAG_VALUE = 'X' AND
sap_raw_${realm}_agr_flags.AGR_NAME like $1
          `, [pattern]);
        } else {
          // No WHERE clause - select all
          await client.query(`
CREATE TABLE "yreport_${realm}_role01" AS
SELECT
sap_raw_${realm}_agr_flags.AGR_NAME,
yr_${realm}_roles_descriptions.TEXT AS COMP_DESCR,
sap_raw_${realm}_agr_agrs.CHILD_AGR,
yr_${realm}_roles_descriptions1.TEXT AS SINGLE_DESCR,
yr_${realm}_role_stcode_exploded.TCODETOTAL,
yr_${realm}_tcodes_description.TTEXT AS TCODE_DESCRIPTION
FROM
sap_raw_${realm}_agr_flags
LEFT JOIN sap_raw_${realm}_agr_agrs ON sap_raw_${realm}_agr_agrs.AGR_NAME = sap_raw_${realm}_agr_flags.AGR_NAME
LEFT JOIN yr_${realm}_role_stcode_exploded ON yr_${realm}_role_stcode_exploded.AGR_NAME = sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME = sap_raw_${realm}_agr_flags.AGR_NAME
LEFT JOIN yr_${realm}_roles_descriptions yr_${realm}_roles_descriptions1 ON yr_${realm}_roles_descriptions1.AGR_NAME = sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN yr_${realm}_tcodes_description ON yr_${realm}_tcodes_description.TCODE = yr_${realm}_role_stcode_exploded.TCODETOTAL
WHERE
sap_raw_${realm}_agr_flags.FLAG_TYPE = 'COLL_AGR' AND
sap_raw_${realm}_agr_flags.FLAG_VALUE = 'X'
          `);
        }

        return {
          success: true,
          message: 'ROLE01 report executed successfully',
          reportType: 'ROLE01',
          tableName: `yreport_${realm}_role01`,
          pattern: pattern || '(all)'
        };
      }

      case 'ROLE02': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role02"`);

        if (pattern && pattern.trim() !== '') {
          // With WHERE clause using pattern
          //end option was: [`%${pattern}%`]
          await client.query(`
CREATE TABLE "yreport_${realm}_role02" AS
SELECT
 sap_raw_${realm}_agr_tcodes.AGR_NAME,
 yr_${realm}_roles_descriptions.TEXT,
 sap_raw_${realm}_agr_tcodes.TCODE,
 yr_${realm}_tcodes_description.TTEXT
 FROM
 sap_raw_${realm}_agr_tcodes
 LEFT JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME = sap_raw_${realm}_agr_tcodes.AGR_NAME
 LEFT JOIN yr_${realm}_tcodes_description ON yr_${realm}_tcodes_description.TCODE = sap_raw_${realm}_agr_tcodes.TCODE
 WHERE sap_raw_${realm}_agr_tcodes.AGR_NAME like $1
          `, [pattern]);
        } else {
          // No WHERE clause - select all
          await client.query(`
CREATE TABLE "yreport_${realm}_role02" AS
SELECT
 sap_raw_${realm}_agr_tcodes.AGR_NAME,
 yr_${realm}_roles_descriptions.TEXT,
 sap_raw_${realm}_agr_tcodes.TCODE,
 yr_${realm}_tcodes_description.TTEXT
 FROM
 sap_raw_${realm}_agr_tcodes
 LEFT JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME = sap_raw_${realm}_agr_tcodes.AGR_NAME
 LEFT JOIN yr_${realm}_tcodes_description ON yr_${realm}_tcodes_description.TCODE = sap_raw_${realm}_agr_tcodes.TCODE
          `);
        }

        return {
          success: true,
          message: 'ROLE02 report executed successfully',
          reportType: 'ROLE02',
          tableName: `yreport_${realm}_role02`,
          pattern: pattern || '(all)'
        };
      }
            case 'ROLE03': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role03"`);
        await client.query(`
    CREATE TABLE yreport_${realm}_role03 AS
SELECT
sap_raw_${realm}_agr_1251.AGR_NAME,
sap_raw_${realm}_agr_1251.OBJECT,
sap_raw_${realm}_agr_1251.AUTH,
sap_raw_${realm}_agr_1251.FIELD,
sap_raw_${realm}_usorg_db.VTEXT as DESCRIPTION,
sap_raw_${realm}_agr_1251.LOW
FROM
sap_raw_${realm}_agr_1251
INNER JOIN sap_raw_${realm}_usorg_db ON sap_raw_${realm}_usorg_db.FIELD = sap_raw_${realm}_agr_1251.FIELD
WHERE
sap_raw_${realm}_agr_1251.DELETED is null AND
SUBSTRING(sap_raw_${realm}_agr_1251.LOW, 1, 1) <> '$' AND
sap_raw_${realm}_usorg_db.LANGU = 'E'
        `);

        return {
          success: true,
          message: 'ROLE03 report executed successfully',
          reportType: 'ROLE03',
          tableName: `yreport_${realm}_role03`
        };
      }
      //a subquery would be needed here for the org level description. If a custom one is created without a description, it will not show up.
            case 'ROLE04': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role04"`);

        if (pattern && pattern.trim() !== '') {
          // With WHERE clause using pattern
          //ho modificato l'opzione in fondo, era: [`%${pattern}%`]
          await client.query(`
CREATE TABLE "yreport_${realm}_role04" AS
SELECT
sap_raw_${realm}_agr_agrs.AGR_NAME as ROLE_COMPOSITE,
yr_${realm}_roles_descriptions.TEXT as COMPOSITE_DESCRIPTION,
sap_raw_${realm}_agr_agrs.CHILD_AGR as ROLE_SINGLE,
yr_${realm}_roles_descriptions1.TEXT AS SINGLE_DESCRIPTION,
sap_raw_${realm}_agr_1252.VARBL as ORG_LEVEL,
sap_raw_${realm}_usorg_db.VTEXT as ORG_LEVEL_DESCRIPTION,
sap_raw_${realm}_agr_1252.LOW as VALUE_FROM,
sap_raw_${realm}_agr_1252.HIGH as VALUE_TO
FROM
sap_raw_${realm}_agr_define
INNER JOIN sap_raw_${realm}_agr_agrs ON sap_raw_${realm}_agr_agrs.AGR_NAME = sap_raw_${realm}_agr_define.AGR_NAME
INNER JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME =
sap_raw_${realm}_agr_agrs.AGR_NAME
INNER JOIN yr_${realm}_roles_descriptions yr_${realm}_roles_descriptions1 ON yr_${realm}_roles_descriptions1.AGR_NAME =
sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN sap_raw_${realm}_agr_1252 ON sap_raw_${realm}_agr_1252.AGR_NAME = sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN sap_raw_${realm}_usorg_db ON sap_raw_${realm}_usorg_db.VARBL = sap_raw_${realm}_agr_1252.VARBL
where
sap_raw_${realm}_usorg_db.LANGU = $1 AND
sap_raw_${realm}_agr_agrs.AGR_NAME like $2
group by
sap_raw_${realm}_agr_agrs.AGR_NAME,
yr_${realm}_roles_descriptions1.TEXT,
sap_raw_${realm}_agr_agrs.CHILD_AGR,
yr_${realm}_roles_descriptions.TEXT,
sap_raw_${realm}_agr_1252.VARBL,
sap_raw_${realm}_agr_1252.LOW,
sap_raw_${realm}_agr_1252.HIGH,
sap_raw_${realm}_usorg_db.VTEXT
          `, [fistCharProjectLang, pattern]);
        } else {
          // No WHERE clause - select all
          await client.query(`
CREATE TABLE "yreport_${realm}_role04" AS
SELECT
sap_raw_${realm}_agr_agrs.AGR_NAME as ROLE_COMPOSITE,
yr_${realm}_roles_descriptions.TEXT as COMPOSITE_DESCRIPTION,
sap_raw_${realm}_agr_agrs.CHILD_AGR as ROLE_SINGLE,
yr_${realm}_roles_descriptions1.TEXT AS SINGLE_DESCRIPTION,
sap_raw_${realm}_agr_1252.VARBL as ORG_LEVEL,
sap_raw_${realm}_usorg_db.VTEXT as ORG_LEVEL_DESCRIPTION,
sap_raw_${realm}_agr_1252.LOW as VALUE_FROM,
sap_raw_${realm}_agr_1252.HIGH as VALUE_TO
FROM
sap_raw_${realm}_agr_define
INNER JOIN sap_raw_${realm}_agr_agrs ON sap_raw_${realm}_agr_agrs.AGR_NAME = sap_raw_${realm}_agr_define.AGR_NAME
INNER JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME =
sap_raw_${realm}_agr_agrs.AGR_NAME
INNER JOIN yr_${realm}_roles_descriptions yr_${realm}_roles_descriptions1 ON yr_${realm}_roles_descriptions1.AGR_NAME =
sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN sap_raw_${realm}_agr_1252 ON sap_raw_${realm}_agr_1252.AGR_NAME = sap_raw_${realm}_agr_agrs.CHILD_AGR
LEFT JOIN sap_raw_${realm}_usorg_db ON sap_raw_${realm}_usorg_db.VARBL = sap_raw_${realm}_agr_1252.VARBL
where
sap_raw_${realm}_usorg_db.LANGU = $1 AND
group by
sap_raw_${realm}_agr_agrs.AGR_NAME,
yr_${realm}_roles_descriptions1.TEXT,
sap_raw_${realm}_agr_agrs.CHILD_AGR,
yr_${realm}_roles_descriptions.TEXT,
sap_raw_${realm}_agr_1252.VARBL,
sap_raw_${realm}_agr_1252.LOW,
sap_raw_${realm}_agr_1252.HIGH,
sap_raw_${realm}_usorg_db.VTEXT
          `, [fistCharProjectLang]);
        }

        return {
          success: true,
          message: 'ROLE04 report executed successfully',
          reportType: 'ROLE04',
          tableName: `yreport_${realm}_role04`,
          pattern: pattern || '(all)'
        };
      }
      case 'ROLE05': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role05"`);
        await client.query(`
    CREATE TABLE yreport_${realm}_role05 AS
SELECT
sap_raw_${realm}_agr_1251.AGR_NAME,
yr_${realm}_roles_descriptions.TEXT as AGR_DESCRIPTION,
sap_raw_${realm}_agr_1251.OBJECT,
sap_raw_${realm}_agr_1251.AUTH,
sap_raw_${realm}_agr_1251.LOW,
sap_raw_${realm}_agr_1251.HIGH
FROM
sap_raw_${realm}_agr_1251
LEFT JOIN yr_${realm}_roles_descriptions ON yr_${realm}_roles_descriptions.AGR_NAME =
sap_raw_${realm}_agr_1251.AGR_NAME
where
sap_raw_${realm}_agr_1251.OBJECT = 'S_TCODE' AND
(sap_raw_${realm}_agr_1251.LOW = '*' OR sap_raw_${realm}_agr_1251.HIGH is not null OR sap_raw_${realm}_agr_1251.LOW like '%*%' or sap_raw_${realm}_agr_1251.HIGH like '%*%') AND
(sap_raw_${realm}_agr_1251.DELETED <> 'X' or sap_raw_${realm}_agr_1251.DELETED is null)
        `);

        return {
          success: true,
          message: 'ROLE05 report executed successfully',
          reportType: 'ROLE05',
          tableName: `yreport_${realm}_role05`
        };
      }
            case 'ROLE06': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role06"`);
        await client.query(`
          CREATE TABLE "yreport_${realm}_role06" AS
SELECT
yr_${realm}_user_complete_info.BNAME as USERID,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
yr_${realm}_user_complete_info.USTYP,
yr_${realm}_user_complete_info.CLASS as USER_GROUP,
yr_${realm}_user_complete_info.USER_VALID,
sap_raw_${realm}_agr_users.AGR_NAME,
yr_${realm}_roles_infos.TEXT as AGR_DESCRIPTION,
sap_raw_${realm}_agr_users.FROM_DAT,
sap_raw_${realm}_agr_users.TO_DAT,
sap_raw_${realm}_agr_users.ORG_FLAG,
sap_raw_${realm}_agr_users.COL_FLAG,
yr_${realm}_roles_infos.ROLE_TYPE,
CASE
WHEN sap_raw_${realm}_agr_users.FROM_DAT <= $1
AND (sap_raw_${realm}_agr_users.TO_DAT >= $1 or sap_raw_${realm}_agr_users.TO_DAT is null)
THEN 1
ELSE 0
END as ROLE_VALID
FROM
yr_${realm}_user_complete_info
LEFT JOIN sap_raw_${realm}_agr_users ON sap_raw_${realm}_agr_users.UNAME = yr_${realm}_user_complete_info.BNAME
LEFT JOIN yr_${realm}_roles_infos ON yr_${realm}_roles_infos.AGR_NAME = sap_raw_${realm}_agr_users.AGR_NAME
        `, [sProjectDate]);

        return {
          success: true,
          message: 'ROLE06 report executed successfully',
          reportType: 'ROLE06',
          tableName: `yreport_${realm}_role06`
        };
      }
            case 'ROLE07': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role07"`);

        if (pattern && pattern.trim() !== '') {
          // With WHERE clause using pattern
          //ho modificato l'opzione in fondo, era: [`%${pattern}%`]
          await client.query(`
CREATE TABLE "yreport_${realm}_role07" AS
SELECT sap_raw_${realm}_agr_agrs.AGR_NAME as COMPOSITE_ROLE,
yr_${realm}_roles_descriptions.TEXT as COMPOSITE_DESCRIPTION,
sap_raw_${realm}_agr_agrs.CHILD_AGR as SINGLE_ROLE,
yr_${realm}_roles_descriptions_1.TEXT AS SINGLE_DESCRIPTION,
sap_raw_${realm}_agr_tcodes.TCODE,
yr_${realm}_tcodes_description.TTEXT as TCODE_DESCRIPTION
 FROM sap_raw_${realm}_agr_agrs INNER JOIN
yr_${realm}_roles_descriptions ON sap_raw_${realm}_agr_agrs.AGR_NAME = yr_${realm}_roles_descriptions.AGR_NAME INNER JOIN
sap_raw_${realm}_agr_tcodes ON sap_raw_${realm}_agr_agrs.CHILD_AGR = sap_raw_${realm}_agr_tcodes.AGR_NAME INNER JOIN
yr_${realm}_roles_descriptions AS yr_${realm}_roles_descriptions_1 ON sap_raw_${realm}_agr_tcodes.AGR_NAME = yr_${realm}_roles_descriptions_1.AGR_NAME INNER JOIN
yr_${realm}_tcodes_description ON sap_raw_${realm}_agr_tcodes.TCODE = yr_${realm}_tcodes_description.TCODE
 WHERE sap_raw_${realm}_agr_agrs.AGR_NAME like $1
UNION
SELECT sap_raw_${realm}_agr_agrs.AGR_NAME as COMPOSITE_ROLE,
yr_${realm}_roles_descriptions.TEXT as COMPOSITE_DESCRIPTION,
sap_raw_${realm}_agr_define.AGR_NAME as SINGLE_ROLE,
yr_${realm}_roles_descriptions_1.TEXT AS SINGLE_DESCRIPTION,
sap_raw_${realm}_agr_tcodes.TCODE,
yr_${realm}_tcodes_description.TTEXT  as TCODE_DESCRIPTION
FROM sap_raw_${realm}_agr_agrs INNER JOIN
yr_${realm}_roles_descriptions ON sap_raw_${realm}_agr_agrs.AGR_NAME = yr_${realm}_roles_descriptions.AGR_NAME INNER JOIN
sap_raw_${realm}_agr_define ON sap_raw_${realm}_agr_agrs.CHILD_AGR = sap_raw_${realm}_agr_define.AGR_NAME INNER JOIN
yr_${realm}_roles_descriptions AS yr_${realm}_roles_descriptions_1 ON sap_raw_${realm}_agr_define.AGR_NAME = yr_${realm}_roles_descriptions_1.AGR_NAME INNER JOIN
sap_raw_${realm}_agr_tcodes ON sap_raw_${realm}_agr_define.PARENT_AGR = sap_raw_${realm}_agr_tcodes.AGR_NAME INNER JOIN
yr_${realm}_tcodes_description ON sap_raw_${realm}_agr_tcodes.TCODE = yr_${realm}_tcodes_description.TCODE
WHERE sap_raw_${realm}_agr_agrs.AGR_NAME like $1
          `, [pattern]);
        } else {
          // No WHERE clause - select all
          await client.query(`
CREATE TABLE "yreport_${realm}_role07" AS
SELECT sap_raw_${realm}_agr_agrs.AGR_NAME as COMPOSITE_ROLE,
yr_${realm}_roles_descriptions.TEXT as COMPOSITE_DESCRIPTION,
sap_raw_${realm}_agr_agrs.CHILD_AGR as SINGLE_ROLE,
yr_${realm}_roles_descriptions_1.TEXT AS SINGLE_DESCRIPTION,
sap_raw_${realm}_agr_tcodes.TCODE,
yr_${realm}_tcodes_description.TTEXT as TCODE_DESCRIPTION
 FROM sap_raw_${realm}_agr_agrs INNER JOIN
yr_${realm}_roles_descriptions ON sap_raw_${realm}_agr_agrs.AGR_NAME = yr_${realm}_roles_descriptions.AGR_NAME INNER JOIN
sap_raw_${realm}_agr_tcodes ON sap_raw_${realm}_agr_agrs.CHILD_AGR = sap_raw_${realm}_agr_tcodes.AGR_NAME INNER JOIN
yr_${realm}_roles_descriptions AS yr_${realm}_roles_descriptions_1 ON sap_raw_${realm}_agr_tcodes.AGR_NAME = yr_${realm}_roles_descriptions_1.AGR_NAME INNER JOIN
yr_${realm}_tcodes_description ON sap_raw_${realm}_agr_tcodes.TCODE = yr_${realm}_tcodes_description.TCODE
UNION
SELECT sap_raw_${realm}_agr_agrs.AGR_NAME as COMPOSITE_ROLE,
yr_${realm}_roles_descriptions.TEXT as COMPOSITE_DESCRIPTION,
sap_raw_${realm}_agr_define.AGR_NAME as SINGLE_ROLE,
yr_${realm}_roles_descriptions_1.TEXT AS SINGLE_DESCRIPTION,
sap_raw_${realm}_agr_tcodes.TCODE,
yr_${realm}_tcodes_description.TTEXT  as TCODE_DESCRIPTION
FROM sap_raw_${realm}_agr_agrs INNER JOIN
yr_${realm}_roles_descriptions ON sap_raw_${realm}_agr_agrs.AGR_NAME = yr_${realm}_roles_descriptions.AGR_NAME INNER JOIN
sap_raw_${realm}_agr_define ON sap_raw_${realm}_agr_agrs.CHILD_AGR = sap_raw_${realm}_agr_define.AGR_NAME INNER JOIN
yr_${realm}_roles_descriptions AS yr_${realm}_roles_descriptions_1 ON sap_raw_${realm}_agr_define.AGR_NAME = yr_${realm}_roles_descriptions_1.AGR_NAME INNER JOIN
sap_raw_${realm}_agr_tcodes ON sap_raw_${realm}_agr_define.PARENT_AGR = sap_raw_${realm}_agr_tcodes.AGR_NAME INNER JOIN
yr_${realm}_tcodes_description ON sap_raw_${realm}_agr_tcodes.TCODE = yr_${realm}_tcodes_description.TCODE
          `);
        }

        return {
          success: true,
          message: 'ROLE07 report executed successfully',
          reportType: 'ROLE07',
          tableName: `yreport_${realm}_role07`,
          pattern: pattern || '(all)'
        };
      }
        case 'ROLE08': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_role08"`);
        await client.query(`
          CREATE TABLE "yreport_${realm}_role08" AS
SELECT
yr_${realm}_user_complete_info.BNAME as USERID,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
yr_${realm}_user_complete_info.USTYP,
yr_${realm}_user_complete_info.CLASS as USER_GROUP,
yr_${realm}_user_complete_info.USER_VALID,
sap_raw_${realm}_agr_agrs.child_agr as role,
yr_${realm}_roles_infos.TEXT as roledescription,
sap_raw_${realm}_agr_users.FROM_DAT,
sap_raw_${realm}_agr_users.TO_DAT,
sap_raw_${realm}_agr_users.ORG_FLAG,
'X' as COL_FLAG,
yr_${realm}_roles_infos.ROLE_TYPE,
sap_raw_${realm}_agr_agrs.agr_name as rolesource,
CASE
WHEN sap_raw_${realm}_agr_users.FROM_DAT <= $1
AND (sap_raw_${realm}_agr_users.TO_DAT >= $1 or sap_raw_${realm}_agr_users.TO_DAT is null)
THEN 1
ELSE 0
END as ROLE_VALID
FROM
yr_${realm}_user_complete_info
LEFT JOIN sap_raw_${realm}_agr_users ON sap_raw_${realm}_agr_users.UNAME = yr_${realm}_user_complete_info.BNAME
join sap_raw_${realm}_agr_agrs on sap_raw_${realm}_agr_users.AGR_NAME = sap_raw_${realm}_agr_agrs.agr_name
JOIN yr_${realm}_roles_infos ON yr_${realm}_roles_infos.AGR_NAME = sap_raw_${realm}_agr_agrs.child_agr
union
SELECT
yr_${realm}_user_complete_info.BNAME as USERID,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
yr_${realm}_user_complete_info.USTYP,
yr_${realm}_user_complete_info.CLASS as USER_GROUP,
yr_${realm}_user_complete_info.USER_VALID,
sap_raw_${realm}_agr_users.AGR_NAME as role,
yr_${realm}_roles_infos.TEXT as roledescription,
sap_raw_${realm}_agr_users.FROM_DAT,
sap_raw_${realm}_agr_users.TO_DAT,
sap_raw_${realm}_agr_users.ORG_FLAG,
sap_raw_${realm}_agr_users.COL_FLAG,
yr_${realm}_roles_infos.ROLE_TYPE,
NULL as rolesource,
CASE
WHEN sap_raw_${realm}_agr_users.FROM_DAT <= $1
AND (sap_raw_${realm}_agr_users.TO_DAT >= $1 or sap_raw_${realm}_agr_users.TO_DAT is null)
THEN 1
ELSE 0
END as ROLE_VALID
FROM
yr_${realm}_user_complete_info
LEFT JOIN sap_raw_${realm}_agr_users ON sap_raw_${realm}_agr_users.UNAME = yr_${realm}_user_complete_info.BNAME
LEFT JOIN yr_${realm}_roles_infos ON yr_${realm}_roles_infos.AGR_NAME = sap_raw_${realm}_agr_users.AGR_NAME
where sap_raw_${realm}_agr_users.col_flag is null
        `, [sProjectDate]);

        return {
          success: true,
          message: 'ROLE08 report executed successfully',
          reportType: 'ROLE08',
          tableName: `yreport_${realm}_role08`
        };
      }

      case 'STAT01': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_stat01"`);
        await client.query(`
          CREATE TABLE "yreport_${realm}_stat01" AS
SELECT
yr_${realm}_statistic_slim.ACCOUNT as USERID,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
yr_${realm}_user_complete_info.function_col,
yr_${realm}_user_complete_info.DEPARTMENT,
yr_${realm}_user_complete_info.CLASS as USER_GROUP,
yr_${realm}_statistic_slim.action as TCODE,
yr_${realm}_tcodes_description.TTEXT AS TCODE_DESCRIPTION,
yr_${realm}_statistic_slim.nexec
FROM
yr_${realm}_statistic_slim
LEFT JOIN yr_${realm}_tcodes_description ON yr_${realm}_tcodes_description.TCODE = yr_${realm}_statistic_slim.action
LEFT JOIN yr_${realm}_user_complete_info ON yr_${realm}_user_complete_info.BNAME =
yr_${realm}_statistic_slim.ACCOUNT
WHERE
yr_${realm}_statistic_slim.actiontype = 'T'
GROUP BY
yr_${realm}_statistic_slim.ACCOUNT,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
yr_${realm}_user_complete_info.function_col,
yr_${realm}_user_complete_info.DEPARTMENT,
yr_${realm}_user_complete_info.CLASS,
yr_${realm}_statistic_slim.action,
yr_${realm}_tcodes_description.TTEXT,
yr_${realm}_statistic_slim.nexec
        `);

        return {
          success: true,
          message: 'STAT01 report executed successfully',
          reportType: 'STAT01',
          tableName: `yreport_${realm}_stat01`
        };
      }

      case 'STAT02': {
        await client.query(`DROP TABLE IF EXISTS "yreport_${realm}_stat02"`);
        await client.query(`
          CREATE TABLE "yreport_${realm}_stat02" AS
SELECT
sap_raw_user_stats.ACCOUNT as USERID,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
sap_raw_user_stats.action as TCODE,
yr_${realm}_tcodes_description.TTEXT as TCODE_DESCRIPTION,
MAX(sap_raw_user_stats.count) as SCREEN_COUNTER,
sap_raw_user_stats.selected_at,
sap_raw_user_stats.period_type
FROM
sap_raw_user_stats
LEFT JOIN yr_${realm}_tcodes_description ON yr_${realm}_tcodes_description.TCODE = sap_raw_user_stats.action
LEFT JOIN yr_${realm}_user_complete_info ON yr_${realm}_user_complete_info.BNAME = sap_raw_user_stats.ACCOUNT
WHERE
sap_raw_user_stats.actiontype = 'T'
AND realm = '${realm}'
GROUP BY
sap_raw_user_stats.ACCOUNT,
yr_${realm}_user_complete_info.NAME_FIRST,
yr_${realm}_user_complete_info.NAME_LAST,
sap_raw_user_stats.action,
yr_${realm}_tcodes_description.TTEXT,
sap_raw_user_stats.selected_at,
sap_raw_user_stats.period_type
        `);

        return {
          success: true,
          message: 'STAT02 report executed successfully',
          reportType: 'STAT02',
          tableName: `yreport_${realm}_stat02`
        };
      }


      // Add more report types here in the future
      // case 'USER02': { ... }

      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  } catch (err) {
    throw err;
  } finally {
    client.release();
  }
}

export async function getReportRows(realm, tableName, limit = 100, offset = 0) {
  try {
    const countResult = await pool.query(
      `SELECT COUNT(*) as total FROM "${tableName}"`,
    );
    const total = Number(countResult.rows[0]?.total || 0);
    const result = await pool.query(
      `SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`,
      [limit, offset]
    );

    const mappedRows = result.rows.map(row => {
      return { row_data: JSON.stringify(row), imported_at: new Date().toISOString() };
    });

    return { rows: mappedRows, total };
  } catch (err) {
        if (err.message.includes('does not exist')) {
      const error = new Error('REPORT_NOT_EXECUTED');
      error.code = 'REPORT_NOT_EXECUTED';
      throw error;
    }
    throw err;
  }
}
