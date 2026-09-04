import { pool } from './client.js';
import { tableExists } from './utils.js';
import { getSapRealm } from './realms.js';

// SOD Analysis Engine: RA elements, descriptions, runSodAnalysis, authorization checks
/**
 * Searches for elements (Users or Roles) using a SQL wildcard pattern and inserts them
 * (or updates) into the sod_ra_elements table. Creates the table if it does not exist.
 * Returns the found/inserted elements, or throws an error if the source tables
 * source tables (yr_<realm>_user_complete_info / yr_<realm>_roles_infos) do not exist.
 */
 export async function searchAndAddSodRaElements(realm, elementType, pattern, includeInvalid = false) {
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
     const validityClause = includeInvalid ? '' : 'AND user_valid != 0';
     const result = await pool.query(
       `SELECT bname AS elementid,
               TRIM(CONCAT(COALESCE(name_first, ''), ' ', COALESCE(name_last, ''))) AS elementdescription
        FROM "${sourceTable}"
        WHERE bname ILIKE $1
          ${validityClause}`,
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
 * Import lines (elementtype, elementid, elementdescription) to table sod_ra_elements
 * from a TSV file. Create table if does not exist.
 */
 export async function importSodRaElementsFromTxt(realm, txtContent, includeInvalid = false) {
   const lines = txtContent.split(/\r?\n/).filter(l => l.trim().length > 0);
   if (lines.length === 0) return { imported: 0, skipped: 0 };

   await pool.query(`
     CREATE TABLE IF NOT EXISTS sod_ra_elements (
       elementtype TEXT,
       elementid TEXT PRIMARY KEY,
       elementdescription TEXT
     )
   `);
   await pool.query(`ALTER TABLE sod_ra_elements ADD COLUMN IF NOT EXISTS elementtype TEXT`);

   const header = lines[0].split('\t').map(h => h.trim().toLowerCase());
   const idxType = header.indexOf('elementtype');
   const idxId = header.indexOf('elementid');
   const idxDesc = header.indexOf('elementdescription');
   if (idxId === -1) throw new Error('Missing required column: elementid');

   // validity check, as in searchAndAddSodRaElements, on yr_<realm>_user_complete_info table
   const userTable = `yr_${realm}_user_complete_info`;
   const userTableAvailable = !includeInvalid && await tableExists(userTable);

   let imported = 0;
   let skipped = 0;

   for (let i = 1; i < lines.length; i++) {
     const values = lines[i].split('\t');
     const elementid = (values[idxId] || '').trim();
     if (!elementid) continue;
     const elementtype = idxType !== -1 ? (values[idxType] || '').trim() : '';
     const elementdescription = idxDesc !== -1 ? (values[idxDesc] || '').trim() : '';

     // same criteria of searchAndAddSodRaElements: Users only, filter user_valid != 0
     if (!includeInvalid && elementtype === 'Users' && userTableAvailable) {
       const check = await pool.query(
         `SELECT 1 FROM "${userTable}" WHERE bname = $1 AND user_valid != 0 LIMIT 1`,
         [elementid]
       );
       if (check.rows.length === 0) { skipped++; continue; }
     }

     try {
       await pool.query(
         `INSERT INTO sod_ra_elements (elementtype, elementid, elementdescription)
          VALUES ($1, $2, $3)
          ON CONFLICT (elementid) DO UPDATE SET elementtype = EXCLUDED.elementtype, elementdescription = EXCLUDED.elementdescription`,
         [elementtype, elementid, elementdescription]
       );
       imported++;
     } catch (dbErr) {
       console.error('[SOD RA Import] SQL error on row:', dbErr.message);
     }
   }

   return { imported, skipped };
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
      id BIGSERIAL PRIMARY KEY,
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

  // Adding index for faster queries
  await q(`
    CREATE INDEX idx_sod_ra_results_element_risk_function
    ON sod_ra_results(elementid, riskid, functionid)
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

  // Extract all unique function IDs across all risks to analyze each function only once per element
  const allFunctionIds = [...new Set(risks.flatMap(r =>
    ['fun1','fun2','fun3','fun4','fun5']
      .map(f => r[f]).filter(f => f && f.trim() !== '')
  ))];

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

      // SAP_ALL check (SAP_ALL users must be skipped for performance and out of scope)
      // Check both the user itself and its reference user.
      const bnamesToCheck = [elementId];
      if (refUser) bnamesToCheck.push(refUser);

      const sapAllRes = await q(
        `SELECT 1 FROM sap_raw_${realm}_ust04
         WHERE bname = ANY($1) AND profile = 'SAP_ALL'
         LIMIT 1`,
        [bnamesToCheck]
      ).catch(() => ({ rows: [] }));

      if (sapAllRes.rows.length > 0) {
        await q(`
          INSERT INTO sod_ra_results
          (elementtype,elementid,elementdescription,riskid,riskdescription,risklevel,risktype,
           functionid,functiondescription,action,authobject,authfield,
           searchfrom,searchto,foundvaluefrom,foundvalueto,
           authorizationID,profilesingle,profilecomposite,rolesingle,rolecomposite)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
        `, [
          elementType, elementId, elementDesc,
          'SAP_ALL', 'SAP_ALL User, skipping', 'CRITICAL', '',
          '', '', '', '', '',
          '', '', '', '',
          '', '', '', '', ''
        ]);

        continue; // skip STEP 1 buffer build, STEP 2 and STEP 3 for this element
      }
      // --- END SAP_ALL check --------------------------------------------------

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

    // STEP 2: Analyze each unique function once per element.
    // Permissions are checked per-auth using authorizationCheck logic:
    // - Different objects can come from different auths ("autorizzazioni si sommano")
    // - All fields of the SAME object must come from the SAME auth
    const foundByFunction = {};

    for (const functId of allFunctionIds) {
      const actionsRes = await q(
        `SELECT action FROM sod_function_actions
         WHERE rulesetid = $1 AND functid = $2
           AND (inactive IS NULL OR inactive = '0' OR inactive = '')`,
        [rulesetId, functId]
      );

      const foundRows = [];

      if (actionsRes.rows.length > 0) {
        //console.log("checking functionID: " + functId);
        // ========================================================================
        // SCENARIO A: function has actions
        // ========================================================================

        // Pre-load all permissions for this function (used if analysisLevel === 'Permission')
        let allPermRows = [];
        if (analysisLevel === 'Permission') {
          const permsRes = await q(
            `SELECT resourceid, resourceextn, fromval, toval, searchtype, action
             FROM sod_function_permissions
             WHERE rulesetid = $1 AND functid = $2
               AND COALESCE(inactive::TEXT, '0') != '1'`,
            [rulesetId, functId]
          );
          allPermRows = permsRes.rows;
        }

        for (const actionRow of actionsRes.rows) {
          const action = actionRow.action;
          let objectToSearch, actionValue;
          //enhance: services starts with [SVC] or [SRV]. Fiori Apps starts with [FAPP]
          if (action.startsWith('[SVC]')) {
            objectToSearch = 'S_SERVICE';
            const serviceName = action.replace('[SVC]', '').trim();
            const hashRes = await q(
              `SELECT name FROM sap_raw_${realm}_usobhash
                 WHERE RTRIM(LEFT(obj_name, GREATEST(0, LENGTH(obj_name) - 4))) = $1
                    OR RTRIM(obj_name) = $1
                 LIMIT 1`,
              [serviceName],).catch(() => ({ rows: [] }));

            //if no service is found, jump to next action (it is not relevant)
            if (!hashRes.rows[0]?.name) {
              continue;
            }

            actionValue = hashRes.rows[0]?.name || '';

          } else {
            objectToSearch = 'S_TCODE';
            actionValue = action;
          }

          // Search in the entire user authorization buffer
          const authsRes = await q(
            `SELECT DISTINCT objct, auth, field, von, bis, profile_s, profile_c, role_single, role_composite
             FROM tmp_sod_element_auth
             WHERE elementid = $1 AND UPPER(objct) = UPPER($2)`,
            [elementId, objectToSearch]
          );

          // Group by auth ID for authorizationCheck
          const authMap = {};
          for (const row of authsRes.rows) {
            const key = row.auth;
            if (!authMap[key]) authMap[key] = { auth: row.auth, profile_s: row.profile_s, profile_c: row.profile_c, role_single: row.role_single || '', role_composite: row.role_composite || '', fields: [], froms: [], tos: [] };
            authMap[key].fields.push(row.field);
            authMap[key].froms.push(row.von);
            authMap[key].tos.push(row.bis);
          }

          // Check if any auth matches the action
          let actionMatched = false;
          // Collect ALL auths that match the action (not just the first one)
          // fieldsToSearch: array used for search (eg. ['TCD'] for S_TCODE)
          // fieldsToSearch is now hard-coded as ['TCD']
          // needs at least a review for services (S_SERVICE: SRV_NAME-SRV_TYPE).
          const searchFields = objectToSearch === 'S_SERVICE' ? ['SRV_NAME'] : ['TCD'];

          const actionMatchingAuths = [];
          for (const authEntry of Object.values(authMap)) {
            let mi = -1;
            let matched = false;

            // Fast path: search single-field -> directly use checkAuthorizationField to find index
            if (searchFields.length === 1) {
              const searchField = searchFields[0];
              mi = authEntry.fields.findIndex((f, i) =>
                checkAuthorizationField(searchField, actionValue, actionValue, f, authEntry.froms[i], authEntry.tos[i])
              );
              if (mi >= 0) {
                matched = true;
              }
            } else {
              // General case: use authorizationCheck (AND across fields)
              matched = authorizationCheck(
                authEntry.auth,
                objectToSearch, authEntry.fields, authEntry.froms, authEntry.tos,
                objectToSearch, searchFields, [actionValue], [actionValue]
              );
              if (matched) {
                // find single index for report (if necessary)
                mi = authEntry.fields.findIndex((f, i) =>
                  checkAuthorizationField(searchFields[0], actionValue, actionValue, f, authEntry.froms[i], authEntry.tos[i])
                );
              }
            }

            if (matched) {
              actionMatched = true;
              actionMatchingAuths.push({
                authEntry,
                field: mi >= 0 ? authEntry.fields[mi] : (authEntry.fields[0] || null),
                foundFrom: mi >= 0 ? authEntry.froms[mi] : (authEntry.froms[0] || ''),
                foundTo: mi >= 0 ? authEntry.tos[mi] : (authEntry.tos[0] || '')
              });
            }
          }

          if (!actionMatched) continue; // Action not found, skip

          // If analysisLevel === 'Permission', verify using per-auth authorizationCheck logic
          let permMatchRows = [];
          if (analysisLevel === 'Permission' && allPermRows.length > 0) {
            // Filter permissions for this specific action
            const actionPermRows = allPermRows.filter(pr => pr.action === action);

            if (actionPermRows.length > 0) {
              // Group permissions by object, then by field
              const permByObj = {};
              for (const pr of actionPermRows) {
                const obj = pr.resourceid.toUpperCase();
                const fld = pr.resourceextn;
                if (!permByObj[obj]) permByObj[obj] = {};
                if (!permByObj[obj][fld]) permByObj[obj][fld] = [];
                const fromEmpty = !pr.fromval || pr.fromval.trim() === '';
                const toEmpty   = !pr.toval   || pr.toval.trim()   === '';
                // FIX: empty from means start of range (''), empty to means end of range ('{')
                const fromval = fromEmpty ? '' : pr.fromval;
                const toval   = (fromEmpty && toEmpty) ? '{' : (toEmpty ? fromval : pr.toval);
                permByObj[obj][fld].push({ fromval, toval, searchtype: (pr.searchtype || 'AND').toUpperCase() });
              }

              // Query ALL auths of the element for the permission objects
              const permObjects = Object.keys(permByObj);
              const allAuthRes = await q(
                `SELECT DISTINCT objct, field, von, bis, auth, profile_s, profile_c, role_single, role_composite
                 FROM tmp_sod_element_auth
                 WHERE elementid = $1 AND UPPER(objct) = ANY($2)`,
                [elementId, permObjects]
              );

              // Group auth rows by auth ID and object
              const authByIdAndObj = {};
              for (const ar of allAuthRes.rows) {
                const key = `${ar.auth}|${ar.objct.toUpperCase()}`;
                if (!authByIdAndObj[key]) {
                  authByIdAndObj[key] = {
                    auth: ar.auth, objct: ar.objct.toUpperCase(),
                    profile_s: ar.profile_s, profile_c: ar.profile_c,
                    role_single: ar.role_single || '', role_composite: ar.role_composite || '',
                    fields: [], froms: [], tos: []
                  };
                }
                authByIdAndObj[key].fields.push(ar.field);
                authByIdAndObj[key].froms.push(ar.von);
                authByIdAndObj[key].tos.push(ar.bis);
              }

              // For each permission object, check if ANY auth satisfies ALL required fields
              let allObjectsPassed = true;
              const objectMatchResults = {}; // { object: [passing auth entries] }

              for (const [objName, fieldMap] of Object.entries(permByObj)) {
                const authEntriesForObj = Object.values(authByIdAndObj).filter(e => e.objct === objName);
                if (authEntriesForObj.length === 0) {
                  allObjectsPassed = false;
                  break;
                }

                const passingAuths = [];
                for (const authEntry of authEntriesForObj) {
                  let authPassed = true;

                  for (const [fieldName, valueRows] of Object.entries(fieldMap)) {
                    const andRows = valueRows.filter(v => v.searchtype === 'AND');
                    const orRows  = valueRows.filter(v => v.searchtype === 'OR');

                    for (const av of andRows) {
                      const anyMatch = authEntry.fields.some((f, i) =>
                        checkAuthorizationField(fieldName, av.fromval, av.toval, f, authEntry.froms[i], authEntry.tos[i])
                      );
                      if (!anyMatch) { authPassed = false; break; }
                    }
                    if (!authPassed) break;

                    if (orRows.length > 0) {
                      const anyOrMatch = orRows.some(ov =>
                        authEntry.fields.some((f, i) =>
                          checkAuthorizationField(fieldName, ov.fromval, ov.toval, f, authEntry.froms[i], authEntry.tos[i])
                        )
                      );
                      if (!anyOrMatch) { authPassed = false; break; }
                    }
                  }

                  if (authPassed) {
                    passingAuths.push(authEntry);
                  }
                }

                if (passingAuths.length === 0) {
                  allObjectsPassed = false;
                  break;
                }

                objectMatchResults[objName] = passingAuths;
              }

              if (!allObjectsPassed) continue; // Permissions not satisfied, skip this action

              // Build permission match rows for ALL passing auths.
              // For each permission object, create rows for EACH passing auth.
              permMatchRows = [];
              for (const [objName, fieldMap] of Object.entries(permByObj)) {
                const passingAuths = objectMatchResults[objName];

                for (const passingAuth of passingAuths) {
                  for (const [fieldName, valueRows] of Object.entries(fieldMap)) {
                    for (const pv of valueRows) {
                      const matchIdx = passingAuth.fields.findIndex((f, i) =>
                        checkAuthorizationField(fieldName, pv.fromval, pv.toval, f, passingAuth.froms[i], passingAuth.tos[i])
                      );
                      if (matchIdx >= 0) {
                        permMatchRows.push({
                          action, objectToSearch: objName, field: fieldName,
                          searchFrom: pv.fromval === '{' ? '' : pv.fromval,
                          searchTo: pv.toval === '{' ? '' : pv.toval,
                          foundFrom: passingAuth.froms[matchIdx], foundTo: passingAuth.tos[matchIdx],
                          auth: passingAuth.auth,
                          profileS: passingAuth.profile_s || '',
                          profileC: passingAuth.profile_c || '',
                          roleSingle: passingAuth.role_single || '',
                          roleComposite: passingAuth.role_composite || ''
                        });
                      }
                    }
                  }
                }
              }
            }
          }

          // Action matched (and permissions if required): add a row for EACH matching auth
          for (const { authEntry: aEntry, field: aField, foundFrom: aFrom, foundTo: aTo } of actionMatchingAuths) {
            foundRows.push({
              action, objectToSearch,
              field: aField,
              searchFrom: actionValue, searchTo: actionValue,
              foundFrom: aFrom,
              foundTo: aTo,
              auth: aEntry.auth, profileS: aEntry.profile_s, profileC: aEntry.profile_c,
              roleSingle: aEntry.role_single || '', roleComposite: aEntry.role_composite || ''
            });
          }

          if (analysisLevel === 'Permission' && permMatchRows.length > 0) {
            foundRows.push(...permMatchRows);
          }
        }
      } else if (analysisLevel === 'Permission') {
        // ========================================================================
        // SCENARIO B: PERMISSION-ONLY (e.g. S_DEVELOP - without actions)
        // ========================================================================

        // 1. Get permissions
        const permsRes = await q(
          `SELECT resourceid, resourceextn, fromval, toval, searchtype
           FROM sod_function_permissions
           WHERE rulesetid = $1 AND functid = $2
             AND COALESCE(inactive::TEXT, '0') != '1'`,
          [rulesetId, functId]
        );
        const permRows = permsRes.rows;

        if (permRows.length > 0) {
          // Group permissions by object, then by field
          const permByObj = {};
          for (const pr of permRows) {
            const obj = pr.resourceid.toUpperCase();
            const fld = pr.resourceextn;
            if (!permByObj[obj]) permByObj[obj] = {};
            if (!permByObj[obj][fld]) permByObj[obj][fld] = [];
            const fromEmpty = !pr.fromval || pr.fromval.trim() === '';
            const toEmpty   = !pr.toval   || pr.toval.trim()   === '';
            // FIX: empty from means start of range (''), empty to means end of range ('{')
            const fromval = fromEmpty ? '' : pr.fromval;
            const toval   = (fromEmpty && toEmpty) ? '{' : (toEmpty ? fromval : pr.toval);
            permByObj[obj][fld].push({ fromval, toval, searchtype: (pr.searchtype || 'AND').toUpperCase() });
          }

          // 2. Get all auths of the element for the permission objects
          const permObjects = Object.keys(permByObj);
          const userAuthsRes = await q(
            `SELECT DISTINCT auth, objct, field, von, bis, profile_s, profile_c, role_single, role_composite
             FROM tmp_sod_element_auth
             WHERE elementid = $1 AND UPPER(objct) = ANY($2)`,
            [elementId, permObjects]
          );

          // Group by auth ID and object
          const authByIdAndObj = {};
          for (const row of userAuthsRes.rows) {
            const key = `${row.auth}|${row.objct.toUpperCase()}`;
            if (!authByIdAndObj[key]) {
              authByIdAndObj[key] = {
                auth: row.auth, objct: row.objct.toUpperCase(),
                profile_s: row.profile_s, profile_c: row.profile_c,
                role_single: row.role_single || '', role_composite: row.role_composite || '',
                fields: [], froms: [], tos: []
              };
            }
            authByIdAndObj[key].fields.push(row.field);
            authByIdAndObj[key].froms.push(row.von);
            authByIdAndObj[key].tos.push(row.bis);
          }

          // 3. For each permission object, check if ANY auth satisfies ALL required fields
          let allObjectsPassed = true;
          const objectMatchResults = {};

          for (const [objName, fieldMap] of Object.entries(permByObj)) {
            const authEntriesForObj = Object.values(authByIdAndObj).filter(e => e.objct === objName);
            if (authEntriesForObj.length === 0) {
              allObjectsPassed = false;
              break;
            }

            const passingAuths = [];
            for (const authEntry of authEntriesForObj) {
              let authPassed = true;

              for (const [fieldName, valueRows] of Object.entries(fieldMap)) {
                const andRows = valueRows.filter(v => v.searchtype === 'AND');
                const orRows  = valueRows.filter(v => v.searchtype === 'OR');

                for (const av of andRows) {
                  const anyMatch = authEntry.fields.some((f, i) =>
                    checkAuthorizationField(fieldName, av.fromval, av.toval, f, authEntry.froms[i], authEntry.tos[i])
                  );
                  if (!anyMatch) { authPassed = false; break; }
                }
                if (!authPassed) break;

                if (orRows.length > 0) {
                  const anyOrMatch = orRows.some(ov =>
                    authEntry.fields.some((f, i) =>
                      checkAuthorizationField(fieldName, ov.fromval, ov.toval, f, authEntry.froms[i], authEntry.tos[i])
                    )
                  );
                  if (!anyOrMatch) { authPassed = false; break; }
                }
              }

              if (authPassed) {
                passingAuths.push(authEntry);
              }
            }

            if (passingAuths.length === 0) {
              allObjectsPassed = false;
              break;
            }

            objectMatchResults[objName] = passingAuths;
          }

          // If all objects have at least one passing auth, build result rows for ALL passing auths
          if (allObjectsPassed) {
            for (const [objName, fieldMap] of Object.entries(permByObj)) {
              const passingAuths = objectMatchResults[objName];

              for (const passingAuth of passingAuths) {
                for (const [fieldName, valueRows] of Object.entries(fieldMap)) {
                  for (const pv of valueRows) {
                    const matchIdx = passingAuth.fields.findIndex((f, i) =>
                      checkAuthorizationField(fieldName, pv.fromval, pv.toval, f, passingAuth.froms[i], passingAuth.tos[i])
                    );
                    if (matchIdx >= 0) {
                      foundRows.push({
                        action: '', objectToSearch: objName, field: fieldName,
                        searchFrom: pv.fromval === '{' ? '' : pv.fromval, searchTo: pv.toval === '{' ? '' : pv.toval,
                        foundFrom: passingAuth.froms[matchIdx], foundTo: passingAuth.tos[matchIdx],
                        auth: passingAuth.auth, profileS: passingAuth.profile_s, profileC: passingAuth.profile_c,
                        roleSingle: passingAuth.role_single || '', roleComposite: passingAuth.role_composite || ''
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }

      if (foundRows.length > 0) foundByFunction[functId] = foundRows;
    }

    // STEP 3: For each risk, confirm only if ALL functions have at least one match
    for (const risk of risks) {
      const riskId = risk.riskid;
      const riskFunctionIds = ['fun1','fun2','fun3','fun4','fun5']
        .map(f => risk[f]).filter(f => f && f.trim() !== '');
      if (riskFunctionIds.length === 0) continue;

      if (!riskFunctionIds.every(f => foundByFunction[f] && foundByFunction[f].length > 0)) continue;

      // Risk confirmed: write all found rows for all functions of this risk
      const riskDesc = await getSodRiskDescription(realmLanguage, rulesetId, riskId);
      const riskMetaRes = await q(
        `SELECT risklevel, risktype FROM sod_risks WHERE rulesetid = $1 AND riskid = $2 LIMIT 1`,
        [rulesetId, riskId]
      );
      const riskLevelRaw = riskMetaRes.rows[0]?.risklevel ?? '';
      const riskTypeRaw  = riskMetaRes.rows[0]?.risktype  ?? '';
      const riskLevel = translateRiskLevel(riskLevelRaw);
      const riskType  = translateRiskType(riskTypeRaw);

      for (const functId of riskFunctionIds) {
        const functDesc = await getSodFunctionDescription(realmLanguage, rulesetId, functId);
        for (const row of foundByFunction[functId]) {

          // Lookup rolesingle and rolecomposite
          let roleSingle = '';
          let roleComposite = '';

          if (elementType === 'Roles') {
            roleSingle = row.roleSingle || elementId;
            roleComposite = row.roleComposite || '';
          } else {
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
    }

    await q(`DROP TABLE IF EXISTS tmp_sod_element_auth`);
  }

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
