import { pool } from './client.js';
import { tableExists } from './utils.js';
import { getSapRealm } from './realms.js';

// Reports with buildAddInfos: buildAdditionalInfos, executeReport, getReportRows
export async function buildAdditionalInfos(realm) {
  const realmConfig = await getSapRealm(realm);
  if (!realmConfig) {
    throw new Error(`Realm not found: ${realm}`);
  }

  // ── Check mandatory tables/data — BEFORE opening connection and transaction,
  // and using throw (not return) to align with the convention used in the rest
  // of the file: error = exception caught by the catch block in server.js.
  const mandatoryTables = [
    `sap_raw_${realm}_adr6`,
    `sap_raw_${realm}_usr02`,
    `sap_raw_${realm}_usr21`,
    `sap_raw_${realm}_adrp`,
    `sap_raw_${realm}_agr_1251`,
    `sap_raw_${realm}_tstc`,
    `sap_raw_${realm}_agr_texts`,
    `sap_raw_${realm}_tstct`,
    `sap_raw_${realm}_agr_flags`,
    `sap_raw_${realm}_agr_define`,
    `sap_raw_${realm}_agr_agrs`,
  ];

  for (const tableName of mandatoryTables) {
    if (!(await tableExists(tableName))) {
      throw new Error('Some mandatory tables are missing. Please import them first');
    }
  }
  if (!(await tableExists('sap_raw_user_stats'))) {
    throw new Error('Statistics are missing. Please import them first');
  }
  const statsCheck = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM sap_raw_user_stats WHERE realm = $1) AS has_rows`,
    [realm]
  );
  if (!statsCheck.rows[0].has_rows) {
    throw new Error('Statistics are missing. Please import them first');
  }
  // end check tables/data exist.

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

//****************************users statistics:
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
