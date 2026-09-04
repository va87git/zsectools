import { pool } from './client.js';

// SAP Users statistics: save, read, import/export, group.
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
  const legacyTableName = 'sap_user_stats';
  const result = await pool.query(
    `DELETE FROM "${sanitizedTableName}"
     WHERE realm = $1 AND period_type = $2 AND selected_at = $3::timestamptz`,
    [realm, periodType, selectedAt]
  );
  const legacyResult = await pool.query(
    `DELETE FROM "${legacyTableName}"
     WHERE realm = $1 AND period_type = $2 AND selected_at = $3::timestamptz`,
    [realm, periodType, selectedAt]
  );
  return result.rowCount;
}

/* //old function:
export async function saveUserStatistics(realm, selectedAtIso, payload) {
  const result = await pool.query(
    `INSERT INTO sap_user_statistics (realm, selected_at, payload)
     VALUES ($1, $2::timestamptz, $3::jsonb)
     RETURNING id, realm, selected_at, imported_at`,
    [realm, selectedAtIso, JSON.stringify(payload)]
  );
  return result.rows[0];
}
*/
