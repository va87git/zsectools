import { pool } from './client.js';
import { tableExists } from './utils.js';
import { getSapRealm } from './realms.js';

// Coverage Analysis: users, roles, tcodes and results
async function ensureCoverageTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS cov_users (userid TEXT PRIMARY KEY, firstname TEXT, lastname TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cov_users_tcodes (userid TEXT, tcode TEXT, tcode_description TEXT, n_exec INTEGER DEFAULT 0, PRIMARY KEY (userid, tcode))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cov_roles (userid TEXT, agr_name TEXT, agr_description TEXT, PRIMARY KEY (userid, agr_name))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cov_roles_tcodes (agr_name TEXT, tcode TEXT, tcode_description TEXT, PRIMARY KEY (agr_name, tcode))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS cov_results (userid TEXT, firstname TEXT, lastname TEXT, agr_name TEXT, agr_description TEXT, tcode TEXT, tcode_description TEXT, coverage TEXT, n_exec INTEGER DEFAULT 0)`);
}

export async function searchAndAddCoverageUsers(realm, pattern) {
  const src = `yr_${realm}_user_complete_info`;
  if (!(await tableExists(src))) throw new Error('You must run the build additional infos function first');
  await ensureCoverageTables();
  const res = await pool.query(
    `SELECT bname, name_first, name_last FROM "${src}" WHERE bname ILIKE $1 AND (user_valid IS NULL OR user_valid != 0)`,
    [pattern]
  );
  for (const r of res.rows) {
    await pool.query(
      `INSERT INTO cov_users (userid, firstname, lastname) VALUES ($1,$2,$3) ON CONFLICT (userid) DO UPDATE SET firstname=EXCLUDED.firstname, lastname=EXCLUDED.lastname`,
      [r.bname, r.name_first || '', r.name_last || '']
    );
  }
  return { added: res.rows.length };
}

export async function getCoverageUsers(limit = 200, offset = 0) {
  if (!(await tableExists('cov_users'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM cov_users`)).rows[0].c);
  const res = await pool.query(`SELECT userid, firstname, lastname FROM cov_users ORDER BY userid LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: res.rows, total };
}

export async function clearCoverageData(target) {
  if (!target || target === 'all') {
    await pool.query(`DROP TABLE IF EXISTS cov_users`);
    await pool.query(`DROP TABLE IF EXISTS cov_users_tcodes`);
    await pool.query(`DROP TABLE IF EXISTS cov_roles`);
    await pool.query(`DROP TABLE IF EXISTS cov_roles_tcodes`);
    await pool.query(`DROP TABLE IF EXISTS cov_results`);
  } else if (target === 'users') {
    await pool.query(`TRUNCATE cov_users`);
    await pool.query(`TRUNCATE cov_users_tcodes`);
  } else if (target === 'roles') {
    await pool.query(`TRUNCATE cov_roles`);
    await pool.query(`TRUNCATE cov_roles_tcodes`);
  } else if (target === 'results') {
    await pool.query(`TRUNCATE cov_results`);
  }
  return { ok: true };
}

export async function importCoverageUsersFromTsv(rows) {
  await ensureCoverageTables();
  let inserted = 0;
  for (const row of rows) {
    const userid = String(row.userid || row.USERID || '').trim();
    if (!userid) continue;
    await pool.query(
      `INSERT INTO cov_users (userid,firstname,lastname) VALUES ($1,$2,$3) ON CONFLICT (userid) DO UPDATE SET firstname=EXCLUDED.firstname,lastname=EXCLUDED.lastname`,
      [userid, String(row.firstname || row.FIRSTNAME || '').trim(), String(row.lastname || row.LASTNAME || '').trim()]
    );
    const tcode = String(row.tcode || row.TCODE || '').trim();
    if (tcode) {
      const tcodeDesc = String(row.tcode_description || row.TCODE_DESCRIPTION || '').trim();
      const nExec = Number(row.n_exec || row.N_EXEC || 0) || 0;
      await pool.query(
        `INSERT INTO cov_users_tcodes (userid,tcode,tcode_description,n_exec) VALUES ($1,$2,$3,$4)
         ON CONFLICT (userid,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description, n_exec=EXCLUDED.n_exec`,
        [userid, tcode, tcodeDesc, nExec]
      );
    }
    inserted++;
  }
  return { inserted };
}

export async function buildCoverageUserTcodes(realm) {
  await ensureCoverageTables();
  const statsTable = `yr_${realm}_statistic_slim`;
  const tcdDescTable = `yr_${realm}_tcodes_description`;
  if (!(await tableExists(statsTable))) throw new Error(`Required table '${statsTable}' not found. Run buildAdditionalInfos first.`);

  const users = (await pool.query(`SELECT userid FROM cov_users`)).rows;
  if (!users.length) return { inserted: 0 };
  const userIds = users.map(r => r.userid);

  const hasDesc = await tableExists(tcdDescTable);
  await pool.query(`DELETE FROM cov_users_tcodes WHERE userid = ANY($1)`, [userIds]);

  const query = hasDesc
    ? `SELECT s.account AS userid, s.action AS tcode, COALESCE(d.ttext,'') AS tcode_description, SUM(s.nexec) AS n_exec
       FROM "${statsTable}" s
       LEFT JOIN "${tcdDescTable}" d ON d.tcode = s.action
       WHERE s.account = ANY($1) AND s.actiontype = 'T'
       GROUP BY s.account, s.action, d.ttext`
    : `SELECT account AS userid, action AS tcode, '' AS tcode_description, SUM(nexec) AS n_exec
       FROM "${statsTable}"
       WHERE account = ANY($1) AND actiontype = 'T'
       GROUP BY account, action`;

  const res = await pool.query(query, [userIds]);
  let inserted = 0;
  for (const r of res.rows) {
    await pool.query(
      `INSERT INTO cov_users_tcodes (userid,tcode,tcode_description,n_exec) VALUES ($1,$2,$3,$4)
       ON CONFLICT (userid,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description, n_exec=EXCLUDED.n_exec`,
      [r.userid, r.tcode, r.tcode_description, Number(r.n_exec)]
    );
    inserted++;
  }
  return { inserted };
}

export async function getCoverageUserTcodes(userId) {
  if (!(await tableExists('cov_users_tcodes'))) return { rows: [] };
  const res = await pool.query(
    `SELECT userid, tcode, tcode_description, n_exec FROM cov_users_tcodes WHERE userid=$1 ORDER BY tcode`,
    [userId]
  );
  return { rows: res.rows };
}

export async function importCoverageRolesFromTsv(rows) {
  await ensureCoverageTables();
  let inserted = 0;
  for (const row of rows) {
    const userid   = String(row.userid || row.USERID || '').trim();
    const agr_name = String(row.agr_name || row.AGR_NAME || '').trim();
    if (!userid || !agr_name) continue;
    await pool.query(
      `INSERT INTO cov_roles (userid,agr_name,agr_description) VALUES ($1,$2,$3) ON CONFLICT (userid,agr_name) DO UPDATE SET agr_description=EXCLUDED.agr_description`,
      [userid, agr_name, String(row.agr_description || row.AGR_DESCRIPTION || '').trim()]
    );
    const tcode = String(row.tcode || row.TCODE || '').trim();
    if (tcode) {
      const tcodeDesc = String(row.tcode_description || row.TCODE_DESCRIPTION || '').trim();
      await pool.query(
        `INSERT INTO cov_roles_tcodes (agr_name,tcode,tcode_description) VALUES ($1,$2,$3)
         ON CONFLICT (agr_name,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description`,
        [agr_name, tcode, tcodeDesc]
      );
    }
    inserted++;
  }
  return { inserted };
}

export async function loadCoverageRolesFromDb(realm) {
  await ensureCoverageTables();
  const realmConfig = await getSapRealm(realm);
  let refDate = realmConfig?.realm_reference_date;
  if (!refDate) refDate = new Date().toISOString().split('T')[0];
  else refDate = refDate instanceof Date ? refDate.toISOString().split('T')[0] : String(refDate);

  const agrUsers = `sap_raw_${realm}_agr_users`;
  const agrAgrs = `sap_raw_${realm}_agr_agrs`;
  const rolesInfo = `yr_${realm}_roles_infos`;
  const roleStcodeExpl = `yr_${realm}_role_stcode_exploded`;
  if (!(await tableExists(agrUsers))) throw new Error(`SAP table agr_users not found. Import SAP tables first.`);
  if (!(await tableExists(roleStcodeExpl))) throw new Error(`Internal SAP table yr_${realm}_role_stcode_exploded not found. Build additional info first.`);

  const users = (await pool.query(`SELECT userid FROM cov_users`)).rows;
  if (!users.length) return { inserted: 0 };
  const userIds = users.map(r => r.userid);

  const hasRI = await tableExists(rolesInfo);
  let rolesRes;
  if (hasRI) {
    rolesRes = await pool.query(
      `SELECT au.uname AS userid, au.agr_name, COALESCE(ri.text,'') AS agr_description
       FROM "${agrUsers}" au LEFT JOIN "${rolesInfo}" ri ON ri.agr_name=au.agr_name
       WHERE au.uname=ANY($1) AND au.from_dat<=$2 AND (au.to_dat IS NULL OR au.to_dat>=$2)`,
      [userIds, refDate]
    );
  } else {
    rolesRes = await pool.query(
      `SELECT uname AS userid, agr_name, '' AS agr_description FROM "${agrUsers}"
       WHERE uname=ANY($1) AND from_dat<=$2 AND (to_dat IS NULL OR to_dat>=$2)`,
      [userIds, refDate]
    );
  }

  await pool.query(`DELETE FROM cov_roles`);
  let inserted = 0;
  const agrNamesSeen = new Set();
  for (const r of rolesRes.rows) {
    await pool.query(
      `INSERT INTO cov_roles (userid,agr_name,agr_description) VALUES ($1,$2,$3) ON CONFLICT (userid,agr_name) DO UPDATE SET agr_description=EXCLUDED.agr_description`,
      [r.userid, r.agr_name, r.agr_description]
    );
    agrNamesSeen.add(r.agr_name);
    inserted++;
  }

  if (agrNamesSeen.size) {
    const agrNames = Array.from(agrNamesSeen);
    const hasAgrAgrs = await tableExists(agrAgrs);
    await pool.query(`DELETE FROM cov_roles_tcodes WHERE agr_name = ANY($1)`, [agrNames]);

    const tcodeQuery = hasAgrAgrs
      ? `SELECT at.agr_name, at.tcodetotal AS tcode, COALESCE(d.ttext,'') AS tcode_description
         FROM "${roleStcodeExpl}" at
         LEFT JOIN "yr_${realm}_tcodes_description" d ON d.tcode = at.tcodetotal
         WHERE at.agr_name = ANY($1) AND at.tcodetotal IS NOT NULL AND at.tcodetotal NOT IN ('','*')
         GROUP BY at.agr_name, at.tcodetotal, d.ttext

         UNION

         SELECT agrs.agr_name, at2.tcodetotal AS tcode, COALESCE(d2.ttext,'') AS tcode_description
         FROM "${agrAgrs}" agrs
         INNER JOIN "${roleStcodeExpl}" at2 ON agrs.child_agr = at2.agr_name
         LEFT JOIN "yr_${realm}_tcodes_description" d2 ON d2.tcode = at2.tcodetotal
         WHERE agrs.agr_name = ANY($1) AND at2.tcodetotal IS NOT NULL AND at2.tcodetotal NOT IN ('','*')
         GROUP BY agrs.agr_name, at2.tcodetotal, d2.ttext`
      : `SELECT at.agr_name, at.tcodetotal AS tcode, COALESCE(d.ttext,'') AS tcode_description
         FROM "${roleStcodeExpl}" at
         LEFT JOIN "yr_${realm}_tcodes_description" d ON d.tcode = at.tcodetotal
         WHERE at.agr_name = ANY($1) AND at.tcodetotal IS NOT NULL AND at.tcodetotal NOT IN ('','*')
         GROUP BY at.agr_name, at.tcodetotal, d.ttext`;

    const tRes = await pool.query(tcodeQuery, [agrNames]);
    for (const r of tRes.rows) {
      await pool.query(
        `INSERT INTO cov_roles_tcodes (agr_name,tcode,tcode_description) VALUES ($1,$2,$3)
         ON CONFLICT (agr_name,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description`,
        [r.agr_name, r.tcode, r.tcode_description]
      );
    }
  }

  return { inserted };
}

export async function getCoverageRoles(limit = 200, offset = 0) {
  if (!(await tableExists('cov_roles'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM cov_roles`)).rows[0].c);
  const res = await pool.query(`SELECT userid, agr_name, agr_description FROM cov_roles ORDER BY userid, agr_name LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: res.rows, total };
}

export async function getCoverageRoleTcodes(agrName) {
  if (!(await tableExists('cov_roles_tcodes'))) return { rows: [] };
  const res = await pool.query(
    `SELECT agr_name, tcode, tcode_description FROM cov_roles_tcodes WHERE agr_name=$1 ORDER BY tcode`,
    [agrName]
  );
  return { rows: res.rows };
}

export async function runCoverageAnalysis(realm) {
  await ensureCoverageTables();
  const realmConfig = await getSapRealm(realm);
  let refDate = realmConfig?.realm_reference_date;
  if (!refDate) refDate = new Date().toISOString().split('T')[0];
  else refDate = refDate instanceof Date ? refDate.toISOString().split('T')[0] : String(refDate);

  const agrUsers = `sap_raw_${realm}_agr_users`;
  const agrAgrs = `sap_raw_${realm}_agr_agrs`;
  const roleStcodeExpl = `yr_${realm}_role_stcode_exploded`;

  if (!(await tableExists(agrUsers))) throw new Error(`Required table '${agrUsers}' not found. Please import missing tables or run buildAdditionalInfos first.`);
  if (!(await tableExists(roleStcodeExpl))) throw new Error(`Internal SAP table yr_${realm}_role_stcode_exploded not found. Build additional info first.`);
  const hasAgrAgrs = await tableExists(agrAgrs);

  await pool.query(`DELETE FROM cov_results`);
  const users = (await pool.query(`SELECT userid, firstname, lastname FROM cov_users`)).rows;

  for (const user of users) {
    const uid = user.userid;

    // Tcodes from roles assigned from panel "Role Assignments" (cov_roles),
    // found from persisted table cov_roles_tcodes
    const roleTcodeRes = await pool.query(
      `SELECT cr.agr_name, cr.agr_description, rt.tcode AS tcode, rt.tcode_description
       FROM cov_roles cr
       INNER JOIN cov_roles_tcodes rt ON rt.agr_name = cr.agr_name
       WHERE cr.userid=$1 AND rt.tcode IS NOT NULL AND rt.tcode NOT IN ('','*')`,
      [uid]
    );
    const roleTcodeMap = {}; // tcode -> {agr_name, agr_description, tcode_description}
    for (const r of roleTcodeRes.rows) {
      if (!roleTcodeMap[r.tcode]) roleTcodeMap[r.tcode] = { agr_name: r.agr_name, agr_description: r.agr_description, tcode_description: r.tcode_description || '' };
    }

    // Actual tcode used, from persisted table cov_users_tcodes (feeded from "Get Users Statistic")
    const usedMap = {}; // tcode -> {n_exec, tcode_description}
    const uRes = await pool.query(`SELECT tcode, tcode_description, n_exec FROM cov_users_tcodes WHERE userid=$1`, [uid]);
    for (const r of uRes.rows) usedMap[r.tcode] = { n_exec: Number(r.n_exec) || 0, tcode_description: r.tcode_description || '' };

    // Actual tcode assigned to users (needed for ALREADY_MISSING),
    const currentTcodes = new Set();
    const curQuery = hasAgrAgrs
      ? `SELECT at.tcodetotal AS tcode
         FROM "${agrUsers}" au
         INNER JOIN "${roleStcodeExpl}" at ON at.agr_name = au.agr_name
         WHERE au.uname=$1 AND au.from_dat<=$2 AND (au.to_dat IS NULL OR au.to_dat>=$2)
           AND at.tcodetotal IS NOT NULL AND at.tcodetotal NOT IN ('','*')
         UNION
         SELECT at2.tcodetotal AS tcode
         FROM "${agrUsers}" au
         INNER JOIN "${agrAgrs}" agrs ON agrs.agr_name = au.agr_name
         INNER JOIN "${roleStcodeExpl}" at2 ON at2.agr_name = agrs.child_agr
         WHERE au.uname=$1 AND au.from_dat<=$2 AND (au.to_dat IS NULL OR au.to_dat>=$2)
           AND at2.tcodetotal IS NOT NULL AND at2.tcodetotal NOT IN ('','*')`
      : `SELECT at.tcodetotal AS tcode
         FROM "${agrUsers}" au
         INNER JOIN "${roleStcodeExpl}" at ON at.agr_name = au.agr_name
         WHERE au.uname=$1 AND au.from_dat<=$2 AND (au.to_dat IS NULL OR au.to_dat>=$2)
           AND at.tcodetotal IS NOT NULL AND at.tcodetotal NOT IN ('','*')`;
    const cRes = await pool.query(curQuery, [uid, refDate]);
    for (const r of cRes.rows) currentTcodes.add(r.tcode);

    const allTcodes = new Set([...Object.keys(roleTcodeMap), ...Object.keys(usedMap)]);
    for (const tcode of allTcodes) {
      const inRole = !!roleTcodeMap[tcode];
      const nExec  = usedMap[tcode]?.n_exec || 0;
      const used   = nExec > 0;
      let coverage;
      if (inRole && used)                                    coverage = '01-COVERED';
      else if (!inRole && used && !currentTcodes.has(tcode))  coverage = '04-ALREADY_MISSING';
      else if (!inRole && used)                              coverage = '02-MISSING';
      else                                                   coverage = '03-EXTRA';
      const ri = roleTcodeMap[tcode] || { agr_name: '', agr_description: '', tcode_description: '' };
      const tcodeDesc = ri.tcode_description || usedMap[tcode]?.tcode_description || '';
      await pool.query(
        `INSERT INTO cov_results (userid,firstname,lastname,agr_name,agr_description,tcode,tcode_description,coverage,n_exec) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [uid, user.firstname, user.lastname, ri.agr_name, ri.agr_description, tcode, tcodeDesc, coverage, nExec]
      );
    }
  }

  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM cov_results`)).rows[0].c);
  const preview = (await pool.query(`SELECT * FROM cov_results ORDER BY userid, coverage, tcode LIMIT 100`)).rows;
  return { total, rows: preview };
}

export async function getCoverageResults(limit = 100, offset = 0) {
  if (!(await tableExists('cov_results'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM cov_results`)).rows[0].c);
  const res = await pool.query(`SELECT * FROM cov_results ORDER BY userid, coverage, tcode LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: res.rows, total };
}
