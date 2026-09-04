import { pool } from './client.js';
import { tableExists } from './utils.js';

// Mapper Analysis: elements, roles, tcodes and results
async function ensureMapperTables() {
  await pool.query(`CREATE TABLE IF NOT EXISTS map_elements (elementid TEXT PRIMARY KEY, element_description TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS map_element_tcodes (elementid TEXT, tcode TEXT, tcode_description TEXT, n_exec INTEGER DEFAULT 0, PRIMARY KEY (elementid, tcode))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS map_roles (agr_name TEXT PRIMARY KEY, agr_description TEXT, role_type TEXT)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS map_role_tcodes (agr_name TEXT, tcode TEXT, tcode_description TEXT, PRIMARY KEY (agr_name, tcode))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS map_results (elementid TEXT, element_description TEXT, tcode TEXT, tcode_description TEXT, n_exec INTEGER DEFAULT 0, agr_name TEXT, agr_description TEXT, status TEXT)`);
}

export async function searchAndAddMapperElements(realm, pattern) {
  const src = `yr_${realm}_user_complete_info`;
  if (!(await tableExists(src))) throw new Error('You must run the build additional infos function first');
  await ensureMapperTables();
  const res = await pool.query(
    `SELECT bname, name_first, name_last FROM "${src}" WHERE bname ILIKE $1 AND (user_valid IS NULL OR user_valid != 0)`,
    [pattern]
  );
  for (const r of res.rows) {
    const desc = `${r.name_first || ''} ${r.name_last || ''}`.trim();
    await pool.query(
      `INSERT INTO map_elements (elementid, element_description) VALUES ($1,$2)
       ON CONFLICT (elementid) DO UPDATE SET element_description=EXCLUDED.element_description`,
      [r.bname, desc]
    );
  }
  return { added: res.rows.length };
}

export async function getMapperElements(limit = 200, offset = 0) {
  if (!(await tableExists('map_elements'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM map_elements`)).rows[0].c);
  const res = await pool.query(`SELECT elementid, element_description FROM map_elements ORDER BY elementid LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: res.rows, total };
}

// ELEMENTID / ELEMENT_DESCRIPTION [/ TCODE / TCODE_DESCRIPTION / N_EXEC]
export async function importMapperElementsFromTsv(rows) {
  await ensureMapperTables();
  let inserted = 0;
  const elementsSeen = new Map();
  for (const row of rows) {
    const elementid = String(row.elementid || row.ELEMENTID || '').trim();
    if (!elementid) continue;
    const description = String(row.element_description || row.ELEMENT_DESCRIPTION || '').trim();
    elementsSeen.set(elementid, description);

    const tcode = String(row.tcode || row.TCODE || '').trim();
    if (tcode) {
      const tcodeDesc = String(row.tcode_description || row.TCODE_DESCRIPTION || '').trim();
      const nExec = Number(row.n_exec || row.N_EXEC || 0) || 0;
      await pool.query(
        `INSERT INTO map_element_tcodes (elementid,tcode,tcode_description,n_exec) VALUES ($1,$2,$3,$4)
         ON CONFLICT (elementid,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description, n_exec=EXCLUDED.n_exec`,
        [elementid, tcode, tcodeDesc, nExec]
      );
    }
    inserted++;
  }
  for (const [elementid, description] of elementsSeen) {
    await pool.query(
      `INSERT INTO map_elements (elementid, element_description) VALUES ($1,$2)
       ON CONFLICT (elementid) DO UPDATE SET element_description=EXCLUDED.element_description`,
      [elementid, description]
    );
  }
  return { inserted };
}

export async function buildMapperElementTcodes(realm) {
  await ensureMapperTables();
  const statsTable = `yr_${realm}_statistic_slim`;
  const tcdDescTable = `yr_${realm}_tcodes_description`;
  if (!(await tableExists(statsTable))) throw new Error(`Required table '${statsTable}' not found. Run buildAdditionalInfos first.`);

  const elements = (await pool.query(`SELECT elementid FROM map_elements`)).rows;
  if (!elements.length) return { inserted: 0 };
  const elementIds = elements.map(r => r.elementid);

  const hasDesc = await tableExists(tcdDescTable);
  await pool.query(`DELETE FROM map_element_tcodes WHERE elementid = ANY($1)`, [elementIds]);

  const query = hasDesc
    ? `SELECT s.account AS elementid, s.action AS tcode, COALESCE(d.ttext,'') AS tcode_description, SUM(s.nexec) AS n_exec
       FROM "${statsTable}" s
       LEFT JOIN "${tcdDescTable}" d ON d.tcode = s.action
       WHERE s.account = ANY($1) AND s.actiontype = 'T'
       GROUP BY s.account, s.action, d.ttext`
    : `SELECT account AS elementid, action AS tcode, '' AS tcode_description, SUM(nexec) AS n_exec
       FROM "${statsTable}"
       WHERE account = ANY($1) AND actiontype = 'T'
       GROUP BY account, action`;

  const res = await pool.query(query, [elementIds]);
  let inserted = 0;
  for (const r of res.rows) {
    await pool.query(
      `INSERT INTO map_element_tcodes (elementid,tcode,tcode_description,n_exec) VALUES ($1,$2,$3,$4)
       ON CONFLICT (elementid,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description, n_exec=EXCLUDED.n_exec`,
      [r.elementid, r.tcode, r.tcode_description, Number(r.n_exec)]
    );
    inserted++;
  }
  return { inserted };
}

// drill-down tcode for an element
export async function getMapperElementTcodes(elementId) {
  if (!(await tableExists('map_element_tcodes'))) return { rows: [] };
  const res = await pool.query(
    `SELECT elementid, tcode, tcode_description, n_exec FROM map_element_tcodes WHERE elementid=$1 ORDER BY tcode`,
    [elementId]
  );
  return { rows: res.rows };
}

export async function removeMapperElements(elementIds) {
  if (!elementIds.length) return { removed: 0 };
  await pool.query(`DELETE FROM map_elements WHERE elementid = ANY($1)`, [elementIds]);
  await pool.query(`DELETE FROM map_element_tcodes WHERE elementid = ANY($1)`, [elementIds]);
  return { removed: elementIds.length };
}

export async function searchAndAddMapperRoles(realm, pattern) {
  const src = `yr_${realm}_roles_infos`;
  if (!(await tableExists(src))) throw new Error('You must run the build additional infos function first');
  await ensureMapperTables();
  const res = await pool.query(
    `SELECT agr_name, text, role_type FROM "${src}" WHERE agr_name ILIKE $1`,
    [pattern]
  );
  for (const r of res.rows) {
    await pool.query(
      `INSERT INTO map_roles (agr_name, agr_description, role_type) VALUES ($1,$2,$3)
       ON CONFLICT (agr_name) DO UPDATE SET agr_description=EXCLUDED.agr_description, role_type=EXCLUDED.role_type`,
      [r.agr_name, r.text || '', r.role_type || '']
    );
  }
  return { added: res.rows.length };
}

export async function getMapperRoles(limit = 200, offset = 0) {
  if (!(await tableExists('map_roles'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM map_roles`)).rows[0].c);
  const res = await pool.query(`SELECT agr_name, agr_description, role_type FROM map_roles ORDER BY agr_name LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: res.rows, total };
}

// Equivalent of "Import Mapping Roles" (Excel): AGR_NAME / TEXT / TCODETOTAL / TTEXT
// (typically "simulated" roles not yet present in SAP)
// Expected fields: agr_name, agr_description, role_type, tcode, tcode_description
// (same fields from export "Export Mapping Roles" — round-trip).
export async function importMapperRolesFromTsv(rows) {
  await ensureMapperTables();
  let inserted = 0;
  const rolesSeen = new Map(); // agr_name -> { agr_description, role_type }
  for (const row of rows) {
    const agr_name = String(row.agr_name || row.AGR_NAME || '').trim();
    if (!agr_name) continue;
    const agr_description = String(row.agr_description || row.AGR_DESCRIPTION || row.text || row.TEXT || '').trim();
    const role_type = String(row.role_type || row.ROLE_TYPE || 'SIMULAZ').trim() || 'SIMULAZ';
    rolesSeen.set(agr_name, { agr_description, role_type });

    const tcode = String(row.tcode || row.TCODE || row.tcodetotal || row.TCODETOTAL || '').trim();
    if (tcode) {
      const tcode_description = String(row.tcode_description || row.TCODE_DESCRIPTION || row.ttext || row.TTEXT || '').trim();
      await pool.query(
        `INSERT INTO map_role_tcodes (agr_name,tcode,tcode_description) VALUES ($1,$2,$3)
         ON CONFLICT (agr_name,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description`,
        [agr_name, tcode, tcode_description]
      );
    }
    inserted++;
  }
  for (const [agr_name, { agr_description, role_type }] of rolesSeen) {
    await pool.query(
      `INSERT INTO map_roles (agr_name, agr_description, role_type) VALUES ($1,$2,$3)
       ON CONFLICT (agr_name) DO UPDATE SET agr_description=EXCLUDED.agr_description, role_type=EXCLUDED.role_type`,
      [agr_name, agr_description, role_type]
    );
  }
  return { inserted };
}

// "From DB" alternative for roles already existing in SAP: loads real tcodes
// of roles already cataloged in map_roles from sap_raw_<realm>_agr_tcodes.
export async function loadMapperRoleTcodesFromDb(realm) {
  await ensureMapperTables();
  const agrTcodes = `sap_raw_${realm}_agr_tcodes`;
  const roleStcodeExpl = `yr_${realm}_role_stcode_exploded`;
  if (!(await tableExists(agrTcodes))) throw new Error(`SAP table agr_tcodes not found. Import SAP tables first.`);
  if (!(await tableExists(roleStcodeExpl))) throw new Error(`Internal SAP table yr_${realm}_role_stcode_exploded not found. Build additional info first.`);

  const roles = (await pool.query(`SELECT agr_name FROM map_roles`)).rows;
  if (!roles.length) return { inserted: 0 };
  const agrNames = roles.map(r => r.agr_name);

  await pool.query(`DELETE FROM map_role_tcodes WHERE agr_name = ANY($1)`, [agrNames]);

  // NB: alias esplicito "AS tcode" — la riga risultante viene poi inserita
  // usando r.tcode, quindi il nome colonna deve combaciare.
  const query = `
    SELECT at.agr_name, at.tcodetotal AS tcode, COALESCE(d.ttext,'') AS tcode_description
    FROM "${roleStcodeExpl}" at
    LEFT JOIN "yr_${realm}_tcodes_description" d ON d.tcode = at.tcodetotal
    WHERE at.agr_name = ANY($1) AND at.tcodetotal IS NOT NULL AND at.tcodetotal NOT IN ('','*')
    GROUP BY at.agr_name, at.tcodetotal, d.ttext

    UNION

    SELECT agrs.agr_name, at2.tcodetotal AS tcode, COALESCE(d2.ttext,'') AS tcode_description
    FROM "sap_raw_${realm}_agr_agrs" agrs
    INNER JOIN "${roleStcodeExpl}" at2 ON agrs.child_agr = at2.agr_name
    LEFT JOIN "yr_${realm}_tcodes_description" d2 ON d2.tcode = at2.tcodetotal
    WHERE agrs.agr_name = ANY($1) AND at2.tcodetotal IS NOT NULL AND at2.tcodetotal NOT IN ('','*')
    GROUP BY agrs.agr_name, at2.tcodetotal, d2.ttext`;

  const res = await pool.query(query, [agrNames]);
  let inserted = 0;
  for (const r of res.rows) {
    await pool.query(
      `INSERT INTO map_role_tcodes (agr_name,tcode,tcode_description) VALUES ($1,$2,$3)
       ON CONFLICT (agr_name,tcode) DO UPDATE SET tcode_description=EXCLUDED.tcode_description`,
      [r.agr_name, r.tcode, r.tcode_description]
    );
    inserted++;
  }
  return { inserted };
}

// drill-down tcode for a role
export async function getMapperRoleTcodes(agrName) {
  if (!(await tableExists('map_role_tcodes'))) return { rows: [] };
  const res = await pool.query(
    `SELECT agr_name, tcode, tcode_description FROM map_role_tcodes WHERE agr_name=$1 ORDER BY tcode`,
    [agrName]
  );
  return { rows: res.rows };
}

export async function removeMapperRoles(agrNames) {
  if (!agrNames.length) return { removed: 0 };
  await pool.query(`DELETE FROM map_roles WHERE agr_name = ANY($1)`, [agrNames]);
  await pool.query(`DELETE FROM map_role_tcodes WHERE agr_name = ANY($1)`, [agrNames]);
  return { removed: agrNames.length };
}

export async function clearMapperData(target) {
  if (!target || target === 'all') {
    await pool.query(`DROP TABLE IF EXISTS map_elements`);
    await pool.query(`DROP TABLE IF EXISTS map_element_tcodes`);
    await pool.query(`DROP TABLE IF EXISTS map_roles`);
    await pool.query(`DROP TABLE IF EXISTS map_role_tcodes`);
    await pool.query(`DROP TABLE IF EXISTS map_results`);
    //following commands were TRUNCATE. Changed to DROP for future fields/schema compatibility.
  } else if (target === 'elements') {
    await pool.query(`DROP TABLE IF EXISTS map_elements`);
    await pool.query(`DROP TABLE IF EXISTS map_element_tcodes`);
  } else if (target === 'roles') {
    await pool.query(`DROP TABLE IF EXISTS map_roles`);
    await pool.query(`DROP TABLE IF EXISTS map_role_tcodes`);
  } else if (target === 'results') {
    await pool.query(`DROP TABLE IF EXISTS map_results`);
  }
  return { ok: true };
}

export async function runMapperAnalysis(calculateExtra = true) {
  await ensureMapperTables();
  await pool.query(`DELETE FROM map_results`);

  const elements = (await pool.query(`SELECT elementid, element_description FROM map_elements`)).rows;
  const roles = (await pool.query(`SELECT agr_name, agr_description FROM map_roles`)).rows;
  const roleDescMap = {};
  for (const r of roles) roleDescMap[r.agr_name] = r.agr_description || '';

  const roleTcodeRows = (await pool.query(`SELECT agr_name, tcode, tcode_description FROM map_role_tcodes`)).rows;
  const roleTcodeMap = {}; // agr_name -> Map(tcode -> tcode_description)
  for (const r of roleTcodeRows) {
    if (!roleTcodeMap[r.agr_name]) roleTcodeMap[r.agr_name] = new Map();
    roleTcodeMap[r.agr_name].set(r.tcode, r.tcode_description || '');
  }
  const roleNames = Object.keys(roleTcodeMap).sort();

  let totalResults = 0;

  for (const el of elements) {
    const elTcodeRows = (await pool.query(
      `SELECT tcode, tcode_description, n_exec FROM map_element_tcodes WHERE elementid=$1`,
      [el.elementid]
    )).rows;

    const originalTcodes = new Map(); // tcode -> { tcode_description, n_exec }
    for (const t of elTcodeRows) originalTcodes.set(t.tcode, { tcode_description: t.tcode_description || '', n_exec: t.n_exec || 0 });
    const remaining = new Set(originalTcodes.keys());

    const resultsBuffer = [];
    let mapAtLeast = true;

    while (mapAtLeast && remaining.size > 0) {
      let winner = null, winnerCovered = 0, winnerDelta = Infinity;

      for (const roleName of roleNames) {
        const roleTcodes = roleTcodeMap[roleName];
        let covered = 0;
        for (const t of remaining) if (roleTcodes.has(t)) covered++;
        if (covered === 0) continue;

        const total = roleTcodes.size;
        const delta = total - covered;

        if (
          covered > winnerCovered ||
          (covered === winnerCovered && delta < winnerDelta) ||
          (covered === winnerCovered && delta === winnerDelta && (winner === null || roleName < winner))
        ) {
          winner = roleName; winnerCovered = covered; winnerDelta = delta;
        }
      }

      if (!winner) { mapAtLeast = false; break; }

      const roleTcodes = roleTcodeMap[winner];
      for (const t of Array.from(remaining)) {
        if (roleTcodes.has(t)) {
          const info = originalTcodes.get(t);
          resultsBuffer.push([el.elementid, el.element_description, t, info.tcode_description, info.n_exec, winner, roleDescMap[winner] || '', '01-COVERED']);
          remaining.delete(t);
        }
      }

      if (calculateExtra) {
        for (const [t, desc] of roleTcodes) {
          if (!originalTcodes.has(t)) {
            resultsBuffer.push([el.elementid, el.element_description, t, desc, 0, winner, roleDescMap[winner] || '', '03-EXTRA']);
          }
        }
      }
    }

    for (const t of remaining) {
      const info = originalTcodes.get(t);
      resultsBuffer.push([el.elementid, el.element_description, t, info.tcode_description, info.n_exec, '', '', '02-MISSING']);
    }

    for (const row of resultsBuffer) {
      await pool.query(
        `INSERT INTO map_results (elementid,element_description,tcode,tcode_description,n_exec,agr_name,agr_description,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        row
      );
      totalResults++;
    }
  }

  const preview = (await pool.query(`SELECT * FROM map_results ORDER BY elementid, status, tcode LIMIT 100`)).rows;
  return { total: totalResults, rows: preview };
}

export async function getMapperResults(limit = 100, offset = 0) {
  if (!(await tableExists('map_results'))) return { rows: [], total: 0 };
  const total = Number((await pool.query(`SELECT COUNT(*) AS c FROM map_results`)).rows[0].c);
  const res = await pool.query(`SELECT * FROM map_results ORDER BY elementid, status, tcode LIMIT $1 OFFSET $2`, [limit, offset]);
  return { rows: res.rows, total };
}
