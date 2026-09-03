import pg from 'pg';
import copyStreams from 'pg-copy-streams';
import { pool } from './client.js';
import { tableExists } from './utils.js';

// Import SAP Tables: types conversion and bulk COPY (sap_imported_tables)
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
