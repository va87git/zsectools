import { pool } from './client.js';
import { tableExists } from './utils.js';

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
