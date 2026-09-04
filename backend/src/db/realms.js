import { pool } from './client.js';

// CRUD operations for SAP realms (sap_realms)
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
  await pool.query(`DROP TABLE IF EXISTS sap_user_statistics`); //old legacy table. Fix #30
  await pool.query(`DELETE FROM sap_user_stats WHERE realm = $1`, [realm]);
  await pool.query(`DELETE FROM sap_raw_user_stats WHERE realm = $1`, [realm]);

  // Delete all dynamically created raw tables for this realm (sap_raw_<tablename>)

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
