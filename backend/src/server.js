// VERY FIRST LINE OF SRC/SERVER.JS
if (typeof process.pkg !== 'undefined') {
  // Force Node not to crash with precompiled native modules (such as node-rfc)
  process.jsFlags = "--no-freeze-flags-after-init";
}
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs/promises';
import {
  checkDbHealth,
  ensureAppSettingsTable,
  ensureSapImportTables,
  ensureSapRealmTable,
  getAppSetting,
  getImportedTableRows,
  getSapRealm,
  getUserStats,
  getUserStatsCount,
  listSapRealms,
  replaceImportedTableRows,
  setAppSetting,
  saveUserStats,
  upsertSapRealm,
  deleteSapRealm,
  exportTablesToTxt,
  exportStatisticsToTxt,
  importTablesFromTxt,
  importSodTableFromTxt,
  SOD_EXPECTED_TABLES,
  getSodRulesets,
  exportSodTablesForRuleset,
  deleteSodRuleset,
  deleteAllSodTables,
  searchAndAddSodRaElements,
  getSodRaElements,
  clearSodRaElements,
  runSodAnalysis,
  importStatisticsFromTxt,
  getAggregatedUserStats,
  deleteUserStatsBatch,
  buildAdditionalInfos,
  executeReport,
  getReportRows,
  pool
} from './db.js';
import {
  fetchUserStatistics,
  mapRealmToSapConnection,
  pingSapWithConfig,
  readSapTable,
  executeBapiBatch,
  getRfcSchema,
  listAvailableRfcs
} from './sap.js';

import path from 'path';

// Compute the frontend path based on the execution folder (App)
import { fileURLToPath } from 'url'; // Keep this if needed for development, otherwise it can stay

// This single line covers both development mode and the portable release
const frontendPath = path.resolve(process.cwd(), 'frontend', 'dist');
//console.log(`[STG] Frontend path configured in: ${frontendPath}`);


const app = express();

// ... after initializing 'app = express()' ...

// Serve the frontend static files
// Assuming the built frontend is in a folder named 'dist' or 'public'
/*
app.use(express.static(path.join(__dirname, '../../frontend/dist')));

// Handle frontend routing (required for React/Vite/Vue apps)
app.get('/*', (req, res) => {
  res.sendFile(path.join(frontendPath, 'index.html'));
});
*/

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173'
}));
app.use(express.json({ limit: '500mb' }));
app.use(express.text({ limit: '500mb' }));



// 1. Serve static files BEFORE anything else
// Make sure frontendPath is correctly defined above
app.use(express.static(frontendPath));

// 2. API routes
//app.use('/api/health', (req, res) => { /* ... */ });
// ... all other app.get('/api/...') routes ...








app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'backend', timestamp: new Date().toISOString() });
});

// New endpoint: return the list of SAP tables to download (read from file on each request)
app.get('/api/tables', async (req, res) => {
  try {

// path.join automatically uses the correct slashes ( \ for Windows, / for Linux)
    // process.cwd() points to the main folder of your project
    const tableFile = path.join(process.cwd(), 'SAP-TABLE-LIST.txt');

    const content = await fs.readFile(tableFile, 'utf8');
    const tables = content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const result = await checkDbHealth();
    res.json({ ok: result.ok, latencyMs: result.latencyMs });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Database health check failed'
    });
  }
});

app.get('/api/health/sap', async (req, res) => {
  const realm = String(req.query?.realm || '').trim();
  if (!realm) {
    res.status(400).json({ ok: false, error: 'realm is required' });
    return;
  }
  const realmConfig = await getSapRealm(realm);
  if (!realmConfig) {
    res.status(404).json({ ok: false, error: `Realm not found: ${realm}` });
    return;
  }
  const sapConfig = mapRealmToSapConnection(realmConfig);
  const result = await pingSapWithConfig(sapConfig);

  if (result.ok) {
    res.json(result);
    return;
  }

  res.status(500).json(result);
});

app.get('/api/diagnostics/sap-sdk', async (_req, res) => {
  const sapHome = process.env.SAPNWRFC_HOME || '';
  const ldPath = process.env.LD_LIBRARY_PATH || '';
  const pathVar = process.env.PATH || '';

  const candidates = [];
  if (sapHome) {
    candidates.push(
      `${sapHome}`,
      `${sapHome}/include`,
      `${sapHome}/include/sapnwrfc.h`,
      `${sapHome}/inc`,
      `${sapHome}/inc/sapnwrfc.h`,
      `${sapHome}/lib`,
      `${sapHome}/bin`,
      `${sapHome}/lib/libsapnwrfc.so`,
      `${sapHome}/lib/libsapucum.so`,
      `${sapHome}/lib/libsapucum.so.1`,
      `${sapHome}/lib/libsapnwrfc.so.1`,
      `${sapHome}/bin/sapgenpse`
    );
  }

  async function checkPath(p) {
    try {
      const stat = await fs.stat(p);
      return { path: p, exists: true, type: stat.isDirectory() ? 'dir' : 'file' };
    } catch (error) {
      return { path: p, exists: false, error: error?.code || error?.message || 'not found' };
    }
  }

  let nodeRfc = { loadable: false, error: null, exports: [] };
  try {
    const mod = await import('node-rfc');
    nodeRfc = {
      loadable: true,
      error: null,
      exports: Object.keys(mod || {}).slice(0, 20)
    };
  } catch (error) {
    nodeRfc = { loadable: false, error: error?.message || String(error), exports: [] };
  }

  const checks = await Promise.all(candidates.map(checkPath));
  res.json({
    ok: true,
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    env: {
      SAPNWRFC_HOME: sapHome,
      LD_LIBRARY_PATH: ldPath,
      PATH: process.platform === 'win32' ? pathVar : undefined
    },
    nodeRfc,
    filesystem: checks
  });
});

app.get('/api/settings/sap-sdk-path', async (_req, res) => {
  try {
    const row = await getAppSetting('sap_nwrfc_home');
    res.json({
      ok: true,
      value: row?.value || '',
      updatedAt: row?.updated_at || null
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Failed to read setting' });
  }
});

app.put('/api/settings/sap-sdk-path', async (req, res) => {
  try {
    const value = String(req.body?.value || '').trim();
    if (!value) {
      res.status(400).json({ ok: false, error: 'value is required' });
      return;
    }
    const saved = await setAppSetting('sap_nwrfc_home', value);
    res.json({ ok: true, saved });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Failed to save setting' });
  }
});

app.get('/api/sap-realms', async (_req, res) => {
  try {
    const realms = await listSapRealms();
    res.json({ ok: true, realms });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to list SAP realms'
    });
  }
});

app.get('/api/sap-realms/:realm', async (req, res) => {
  try {
    const realm = (req.params.realm || '').trim();
    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    const config = await getSapRealm(realm);
    if (!config) {
      res.status(404).json({ ok: false, error: `Realm not found: ${realm}` });
      return;
    }

    res.json({ ok: true, config });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to load SAP realm'
    });
  }
});

app.put('/api/sap-realms/:realm', async (req, res) => {
  try {
    const realm = (req.params.realm || '').trim();
    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    const fields = ['realm_description', 'sap_user', 'sap_password', 'sap_ashost', 'sap_sysnr', 'sap_client', 'sap_sid', 'sap_language', 'sap_router', 'realm_reference_date'];
    const payload = { realm };
    for (const key of fields) {
      payload[key] = String(req.body?.[key] || '').trim();
    }

    // Validation for realm: only lowercase a-z and 0-9
    if (!/^[a-z0-9]+$/.test(realm)) {
      res.status(400).json({
        ok: false,
        error: 'Invalid realm name. Only lowercase letters (a-z) and numbers (0-9) are allowed.'
      });
      return;
    }

    const missing = fields.filter((k) => k !== 'sap_router' && k !== 'realm_reference_date' && !payload[k]);
    if (missing.length) {
      res.status(400).json({
        ok: false,
        error: `Missing required fields: ${missing.join(', ')}`
      });
      return;
    }

    const saved = await upsertSapRealm(payload);
    res.json({ ok: true, config: saved });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to save SAP realm'
    });
  }
});

app.delete('/api/sap-realms/:realm', async (req, res) => {
  try {
    const realm = (req.params.realm || '').trim();
    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    const deleted = await deleteSapRealm(realm);
    if (deleted) {
      res.json({ ok: true, message: `Realm deleted: ${realm}` });
    } else {
      res.status(404).json({ ok: false, error: `Realm not found: ${realm}` });
    }
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to delete SAP realm'
    });
  }
});

app.post('/api/import-sap/tables', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];
    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }
    if (!tables.length) {
      res.status(400).json({ ok: false, error: 'At least one table is required' });
      return;
    }

    const realmConfig = await getSapRealm(realm);
    if (!realmConfig) {
      res.status(404).json({ ok: false, error: `Realm not found: ${realm}` });
      return;
    }

    const sapConfig = mapRealmToSapConnection(realmConfig);
    const results = [];

    // Specific field selection for USR02 to avoid SAP data length errors
    const TABLE_FIELD_OVERRIDES = {
      'USR02': [
        'BNAME', 'GLTGV', 'GLTGB', 'USTYP', 'CLASS', 'LOCNT', 'UFLAG', 'ACCNT', 'ANAME',
        'ERDAT', 'TRDAT', 'LTIME', 'PWDCHGDATE', 'PWDSTATE', 'RESERVED',
        'PWDHISTORY', 'PWDLGNDATE', 'PWDSETDATE', 'PWDINITIAL', 'PWDLOCKDATE',
        'SECURITY_POLICY'
      ],
      'ADRP': ['PERSNUMBER','DATE_FROM','NATION','DATE_TO','TITLE','NAME_FIRST','NAME_LAST',
      'NAME2','NAMEMIDDLE','NAME_LAST2','NAME_TEXT','CONVERTED','NICKNAME','INITIALS','SORT1',
      'SORT2','MC_NAMEFIR','MC_NAMELAS','MC_NAME2'
      ],
      'PA0002': ['PERNR','BEGDA','ENDDA','NACHN','VORNA','NCHMC','VNAMC'
      ],
      'TDEVC': ['DEVCLASS','AS4USER','COMPONENT','NAMESPACE'
      ],
      'TBTCO': ['JOBNAME','JOBCOUNT','JOBGROUP','INTREPORT','STEPCOUNT','SDLSTRTDT','SDLSTRTTM','BTCSYSTEM',
      'SDLDATE','SDLTIME','SDLUNAME','LASTCHDATE','LASTCHTIME','LASTCHNAME','RELDATE','RELTIME','RELUNAME',
      'STRTDATE','STRTTIME','ENDDATE','ENDTIME','PRDMINS','PRDHOURS','PRDDAYS','PRDWEEKS','PRDMONTHS','PERIODIC',
      'STATUS','NEWFLAG','AUTHCKNAM','AUTHCKMAN','SUCCNUM','PREDNUM','JOBLOG','LASTSTRTTM','EVENTID','EVENTPARM','JOBCLASS','PRIORITY','CHECKSTAT'
      ],
      'TBTCP': ['JOBNAME','JOBCOUNT','STEPCOUNT','PROGNAME','SDLDATE','SDLTIME',
      'SDLUNAME','VARIANT','AUTHCKNAM','LISTIDENT','XPGPID','STATUS','EXITCODE',
      'PDEST','PLIST','PRIMM','PRREL','PRBER','REPORT'
      ],
      'USRACL': ['BNAME','PNAME'
      ]
    };

    for (const tableName of tables) {
      const cleanName = String(tableName || '').trim().toUpperCase();
      if (!cleanName) {
        continue;
      }

      let tableResult = { tableName: cleanName, success: false, rowCount: 0, error: null };

      try {
        const fieldsToSelect = TABLE_FIELD_OVERRIDES[cleanName] || [];

        // Hardcoded filters for specific tables only
        let options = [];
        switch (cleanName) {
          case 'TADIR':
            options = ["PGMID EQ 'R3TR' AND OBJECT EQ 'TRAN'"];
            break;
          case 'AGR_TEXTS':
            options = ["SPRAS EQ 'I' OR SPRAS EQ 'E'"];
            break;
          case 'AGR_HIERT':
            options = ["SPRAS eq 'I' or SPRAS eq 'E' or SPRAS eq 'D'"];
            break;
          case 'TOBJT':
            options = ["LANGU eq 'E' or LANGU eq 'I'"];
            break;
          // Add more table filters here as needed
        }

        // Iterative download with ROWSKIPS and ROWCOUNT
        let totalRowsImported = 0;
        let rowSkips = 0;
        const rowCount = 100000;
        let hasMore = true;
        let firstBatch = true;

        while (hasMore) {
          const { fields, rows } = await readSapTable(sapConfig, cleanName, fieldsToSelect, rowSkips, rowCount, options);

          if (rows.length === 0) {
            hasMore = false;
            break;
          }

          // Save batch to DB (truncate only on first batch, then append)
          await replaceImportedTableRows(realm, cleanName, fields, rows, !firstBatch);

          totalRowsImported += rows.length;
          rowSkips += rowCount; // Increment by the requested count per SAP spec
          firstBatch = false;

          // If we got fewer rows than requested, we've reached the end
          if (rows.length < rowCount) {
            hasMore = false;
          }
        }

        tableResult.success = true;
        tableResult.rowCount = totalRowsImported;
      } catch (err) {
        tableResult.error = err.message;
      } finally {
        results.push(tableResult);
      }
    }

    res.json({ ok: true, imported: results });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to import SAP tables'
    });
  }
});

app.get('/api/import-sap/tables/:tableName', async (req, res) => {
  try {
    const realm = String(req.query?.realm || '').trim();
    const tableName = String(req.params.tableName || '').trim().toUpperCase();
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);

    if (!realm || !tableName) {
      res.status(400).json({ ok: false, error: 'realm and tableName are required' });
      return;
    }

    const rowsResult = await getImportedTableRows(realm, tableName, limit, offset);
    res.json({ ok: true, tableName, realm, rows: rowsResult.rows, limit, offset, total: rowsResult.total });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to load imported table rows'
    });
  }
});

app.post('/api/import-sap/user-statistics', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const datetime = String(req.body?.datetime || '').trim();
    const periodType = String(req.body?.periodType || '').trim().toUpperCase();
    const mode = String(req.body?.mode || 'overwrite').toLowerCase(); // 'append' or 'overwrite'
    if (!realm || !datetime || !periodType) {
      res.status(400).json({ ok: false, error: 'realm, datetime and periodType are required' });
      return;
    }
    if (!['M', 'D', 'W'].includes(periodType)) {
      res.status(400).json({ ok: false, error: 'periodType must be one of: M, D, W' });
      return;
    }
    if (!['append', 'overwrite'].includes(mode)) {
      res.status(400).json({ ok: false, error: 'mode must be one of: append, overwrite' });
      return;
    }

    const realmConfig = await getSapRealm(realm);
    if (!realmConfig) {
      res.status(404).json({ ok: false, error: `Realm not found: ${realm}` });
      return;
    }

    const sapConfig = mapRealmToSapConnection(realmConfig);
    const result = await fetchUserStatistics(sapConfig, datetime, periodType);

    // Extract USERTCODE table from the RFC result and save to local DB.
    const usertcodeTable = result?.USERTCODE || [];
    await saveUserStats(realm, periodType, datetime, usertcodeTable, mode);

    res.json({ ok: true, usertcodeRowCount: usertcodeTable.length });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to import SAP user statistics'
    });
  }
});

app.get('/api/import-sap/user-statistics', async (req, res) => {
  try {
    const realm = String(req.query?.realm || '').trim();
    const periodType = String(req.query?.periodType || '').trim().toUpperCase();
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);

    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    const rows = await getUserStats(realm, periodType || null, limit, offset);
    const total = await getUserStatsCount(realm, periodType || null);
    res.json({ ok: true, realm, periodType: periodType || null, rows, limit, offset, total });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to load user statistics'
    });
  }
});

app.get('/api/import-sap/user-statistics/aggregated', async (req, res) => {
  try {
    const realm = String(req.query?.realm || '').trim();
    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }
    const stats = await getAggregatedUserStats(realm);
    res.json({ ok: true, stats });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Failed to load aggregated stats' });
  }
});

app.delete('/api/import-sap/user-statistics/batch', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const periodType = String(req.body?.periodType || '').trim();
    const selectedAt = String(req.body?.selectedAt || '').trim();

    if (!realm || !periodType || !selectedAt) {
      res.status(400).json({ ok: false, error: 'realm, periodType and selectedAt are required' });
      return;
    }

    const deletedCount = await deleteUserStatsBatch(realm, periodType, selectedAt);
    res.json({ ok: true, deletedCount });
  } catch (error) {
    res.status(500).json({ ok: false, error: error?.message || 'Failed to delete stats batch' });
  }
});

// Export/Import TXT endpoints
app.post('/api/export-sap/tables-txt', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const tables = Array.isArray(req.body?.tables) ? req.body.tables : [];
    if (!realm || tables.length === 0) {
      res.status(400).json({ ok: false, error: 'realm and at least one table are required' });
      return;
    }

    // Since we now export one by one from frontend, this will typically have 1 table
    const results = await exportTablesToTxt(realm, tables);
    const first = results[0];

    if (first.error) {
      res.status(500).json({ ok: false, error: first.error });
      return;
    }

    //const txtContent = `# Table: ${first.tableName}\n${first.header}\n${first.rows.join('\n')}`;

	  // NEW LOGIC: Also include the type comment we added in db.js
    // The correct order is: Table Comment, Types Comment, Header, Data
    const txtContent = [
      first.tableComment,
      first.typeComment,
      first.header,
      ...first.rows
    ].join('\n');

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="sap_table_${first.tableName}_${realm}_${new Date().toISOString().split('T')[0]}.txt"`);
    res.send(txtContent);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to export tables'
    });
  }
});

app.post('/api/export-sap/statistics-txt', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const selectedAt = req.body?.selectedAt ? String(req.body.selectedAt).trim() : null;
    const periodType = req.body?.periodType ? String(req.body.periodType).trim().toUpperCase() : 'D';

    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    const result = await exportStatisticsToTxt(realm, selectedAt, periodType);
    if (result.error) {
      res.status(500).json({ ok: false, error: result.error });
      return;
    }

    // Include period_type in the file header
    const txtContent = result.rowCount === 0
      ? `# PERIOD_TYPE: ${result.periodType}\n# No data`
      : `# PERIOD_TYPE: ${result.periodType}\n${result.header}\n${result.rows.join('\n')}`;

    const dateSuffix = selectedAt ? selectedAt.split('T')[0] : new Date().toISOString().split('T')[0];
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="sap_statistics_${realm}_${result.periodType}_${dateSuffix}.txt"`);
    res.send(txtContent);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to export statistics'
    });
  }
});

app.post('/api/import-sap/tables-txt', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const tableName = String(req.body?.tableName || '').trim().toUpperCase();
    const txtContent = String(req.body?.txtContent || '').trim();

    if (!realm || !tableName || !txtContent) {
      res.status(400).json({ ok: false, error: 'realm, tableName and txtContent are required' });
      return;
    }

    const result = await importTablesFromTxt(realm, tableName, txtContent);
    res.json({ ok: true, imported: result.imported });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to import tables from TXT'
    });
  }
});

app.post('/api/sod/import-tables-txt', async (req, res) => {
  try {
    const files = Array.isArray(req.body?.files) ? req.body.files : [];
    if (files.length === 0) {
      res.status(400).json({ ok: false, error: 'No files provided' });
      return;
    }

    const importedTables = [];
    const errors = [];

    for (const f of files) {
      const fileName = String(f?.fileName || 'unknown');
      const txtContent = String(f?.txtContent || '');
      try {
        const result = await importSodTableFromTxt(txtContent);
        importedTables.push({ fileName, ...result });
      } catch (fileErr) {
        errors.push({ fileName, error: fileErr.message });
      }
    }

    const importedLogicalNames = new Set(importedTables.map(t => t.logicalName));
    const missingTables = SOD_EXPECTED_TABLES.filter(t => !importedLogicalNames.has(t));

    res.json({
      ok: true,
      importedTables,
      errors,
      missingTables
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to import SOD tables'
    });
  }
});

app.get('/api/sod/rulesets', async (req, res) => {
  try {
    const rulesets = await getSodRulesets();
    res.json({ ok: true, rulesets });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to load SOD rulesets'
    });
  }
});

app.post('/api/sod/export-tables-txt', async (req, res) => {
  try {
    const rulesetId = String(req.body?.rulesetId || '').trim();
    if (!rulesetId) {
      res.status(400).json({ ok: false, error: 'rulesetId is required' });
      return;
    }

    const files = await exportSodTablesForRuleset(rulesetId);
    res.json({ ok: true, files });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to export SOD tables'
    });
  }
});

app.post('/api/sod/delete-ruleset', async (req, res) => {
  try {
    const rulesetId = String(req.body?.rulesetId || '').trim();
    if (!rulesetId) {
      res.status(400).json({ ok: false, error: 'rulesetId is required' });
      return;
    }

    const result = await deleteSodRuleset(rulesetId);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to delete SOD ruleset'
    });
  }
});

app.post('/api/sod/delete-all', async (req, res) => {
  try {
    const result = await deleteAllSodTables();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to delete all SOD tables'
    });
  }
});

app.post('/api/sod/add-element', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const elementType = String(req.body?.elementType || '').trim();
    const pattern = String(req.body?.pattern || '').trim();

    if (!realm || !elementType || !pattern) {
      res.status(400).json({ ok: false, error: 'realm, elementType and pattern are required' });
      return;
    }
    if (!['Users', 'Roles'].includes(elementType)) {
      res.status(400).json({ ok: false, error: 'elementType must be Users or Roles' });
      return;
    }

    const result = await searchAndAddSodRaElements(realm, elementType, pattern);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to add SOD element'
    });
  }
});

app.get('/api/sod/ra-elements', async (req, res) => {
  try {
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);
    const result = await getSodRaElements(limit, offset);
    res.json({ ok: true, elements: result.rows, total: result.total, limit, offset });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to load SOD RA elements'
    });
  }
});

app.post('/api/sod/clear-elements', async (req, res) => {
  try {
    const result = await clearSodRaElements();
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to clear SOD RA elements'
    });
  }
});

app.post('/api/sod/run-analysis', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const rulesetId = String(req.body?.rulesetId || '').trim();
    const elementType = String(req.body?.elementType || 'Users').trim();
    const analysisLevel = String(req.body?.analysisLevel || 'Action').trim();
    const realmLanguage = String(req.body?.realmLanguage || 'EN').trim();

    if (!realm || !rulesetId) {
      res.status(400).json({ ok: false, error: 'realm and rulesetId are required' });
      return;
    }

    const result = await runSodAnalysis(realm, rulesetId, elementType, analysisLevel, realmLanguage);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'SOD analysis failed'
    });
  }
});

// SSE endpoint: sends real-time progress updates during the SOD analysis
app.get('/api/sod/run-analysis-stream', async (req, res) => {
  const realm = String(req.query?.realm || '').trim();
  const rulesetId = String(req.query?.rulesetId || '').trim();
  const elementType = String(req.query?.elementType || 'Users').trim();
  const analysisLevel = String(req.query?.analysisLevel || 'Action').trim();
  const realmLanguage = String(req.query?.realmLanguage || 'EN').trim();

  if (!realm || !rulesetId) {
    res.status(400).json({ ok: false, error: 'realm and rulesetId are required' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const result = await runSodAnalysis(
      realm, rulesetId, elementType, analysisLevel, realmLanguage,
      (progress) => send({ type: 'progress', ...progress })
    );
    send({ type: 'done', total: result.total, rows: result.rows });
  } catch (error) {
    send({ type: 'error', error: error?.message || 'SOD analysis failed' });
  } finally {
    res.end();
  }
});


app.get('/api/sod/ra-results', async (req, res) => {
  try {
    const format = req.query?.format || 'json';
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);

    const tableCheck = await pool.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'sod_ra_results')`
    );
    if (!tableCheck.rows[0].exists) {
      return res.json({ ok: true, rows: [], total: 0 });
    }

    if (format === 'csv') {
      const client = await pool.connect();
      try {
        res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="sod_ra_results.csv"');
        const BATCH = 500;
        let batchOffset = 0;
        let headerWritten = false;
        while (true) {
          const batch = await client.query(
            `SELECT * FROM sod_ra_results LIMIT $1 OFFSET $2`,
            [BATCH, batchOffset]
          );
          if (batch.rows.length === 0) break;
          if (!headerWritten) {
            res.write(Object.keys(batch.rows[0]).join('\t') + '\n');
            headerWritten = true;
          }
          for (const row of batch.rows) {
            res.write(Object.values(row).map(v => v === null || v === undefined ? '' : String(v)).join('\t') + '\n');
          }
          if (batch.rows.length < BATCH) break;
          batchOffset += BATCH;
        }
        res.end();
      } finally {
        client.release();
      }
      return;
    }

    const totalRes = await pool.query(`SELECT COUNT(*) AS count FROM sod_ra_results`);
    const total = Number(totalRes.rows[0].count);
    const dataRes = await pool.query(`SELECT * FROM sod_ra_results LIMIT $1 OFFSET $2`, [limit, offset]);
    res.json({ ok: true, rows: dataRes.rows, total });
  } catch (error) {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: error?.message || 'Failed to load SOD results' });
    }
  }
});

app.post('/api/import-sap/statistics-txt', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const txtContent = String(req.body?.txtContent || '').trim();

    if (!realm || !txtContent) {
      res.status(400).json({ ok: false, error: 'realm and txtContent are required' });
      return;
    }

    const result = await importStatisticsFromTxt(realm, txtContent);
    res.json({ ok: true, imported: result.imported });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to import statistics from TXT'
    });
  }
});

app.post('/api/reports/build-additional-infos', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    const result = await buildAdditionalInfos(realm);
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to build additional infos'
    });
  }
});

app.post('/api/reports/execute', async (req, res) => {
  try {
    const realm = String(req.body?.realm || '').trim();
    const reportType = String(req.body?.reportType || '').trim().toUpperCase();
    const days = Number(req.body?.days || 0);
    const pattern = String(req.body?.rolePattern || '').trim().toUpperCase();

    if (!realm) {
      res.status(400).json({ ok: false, error: 'realm is required' });
      return;
    }

    if (!reportType) {
      res.status(400).json({ ok: false, error: 'reportType is required' });
      return;
    }
    const result = await executeReport(realm, reportType, { days, pattern });
    res.json({ ok: true, ...result });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to execute report'
    });
  }
});

app.get('/api/reports/results', async (req, res) => {
  try {
    const realm = String(req.query?.realm || '').trim();
    const tableName = String(req.query?.tableName || '').trim();
    const limit = Number(req.query?.limit || 100);
    const offset = Number(req.query?.offset || 0);

    if (!realm || !tableName) {
      res.status(400).json({ ok: false, error: 'realm and tableName are required' });
      return;
    }

    const result = await getReportRows(realm, tableName, limit, offset);
    res.json({ ok: true, rows: result.rows, total: result.total });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error?.message || 'Failed to load report results'
    });
  }
});

app.get('/api/reports/export-csv', async (req, res) => {
  const realm = String(req.query?.realm || '').trim();
  const tableName = String(req.query?.tableName || '').trim();
  const dateStr = new Date().toISOString().split('T')[0];

  if (!realm || !tableName) {
    res.status(400).json({ ok: false, error: 'realm and tableName are required' });
    return;
  }

  const client = await pool.connect();
  try {
    const tableCheck = await client.query(
      `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
      [tableName]
    );
    if (!tableCheck.rows[0].exists) {
      res.status(404).json({ ok: false, error: 'REPORT_NOT_EXECUTED' });
      return;
    }

    res.setHeader('Content-Type', 'text/tab-separated-values; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report_${tableName}_${dateStr}.csv"`);

    const BATCH = 500;
    let offset = 0;
    let headerWritten = false;

    while (true) {
      const batch = await client.query(
        `SELECT * FROM "${tableName}" LIMIT $1 OFFSET $2`,
        [BATCH, offset]
      );
      if (batch.rows.length === 0) break;

      if (!headerWritten) {
        res.write(Object.keys(batch.rows[0]).join('\t') + '\n');
        headerWritten = true;
      }

      for (const row of batch.rows) {
        res.write(Object.values(row).map(v => v === null || v === undefined ? '' : String(v)).join('\t') + '\n');
      }

      if (batch.rows.length < BATCH) break;
      offset += BATCH;
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ ok: false, error: err.message });
    }
  } finally {
    client.release();
  }
});


// GET list RFC available
app.get('/api/rfc/available', (req, res) => {
  try {
    const rfcs = listAvailableRfcs();
    res.json({ rfcs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET schema of an RFC
app.get('/api/rfc/schema/:rfcCommand', (req, res) => {
  try {
    const schema = getRfcSchema(req.params.rfcCommand);
    if (!schema) {
      return res.status(404).json({ error: 'RFC not found' });
    }
    res.json({ schema });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST execution RFC batch
app.post('/api/rfc/execute-batch', async (req, res) => {
    try {
    const { realm, rfcCommand, rows } = req.body;

    if (!realm || !rfcCommand || !rows) {
      return res.status(400).json({ error: 'Missing parameters' });
    }

    // --- Standardization ---
    // 1. Fetch the data from the DB
    const realmConfig = await getSapRealm(realm);
    if (!realmConfig) {
      return res.status(404).json({ error: `Realm not found: ${realm}` });
    }
    // 2. Transform data in configuration SAP
    const sapConfig = mapRealmToSapConnection(realmConfig);
    // -------------------------

    // 3. Pass the already-prepared configuration to sap.js
    const results = await executeBapiBatch(sapConfig, rfcCommand, rows);
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const port = Number(process.env.PORT || 3000);

async function applySapSdkPathFromSettings() {
  const row = await getAppSetting('sap_nwrfc_home');
  const sdkPath = String(row?.value || '').trim();
  if (!sdkPath) {
    return;
  }

  process.env.SAPNWRFC_HOME = sdkPath;

  // Best-effort: make native libs discoverable for dlopen().
  // Linux uses LD_LIBRARY_PATH, Windows uses PATH.
  if (process.platform === 'win32') {
    const current = process.env.PATH || '';
	// change: on windows .dll needed inside folder bin!
  const libPath = `${sdkPath}\\lib`;
  //was: if (!current.includes(sdkPath))
    if (!current.includes(libPath)) {
      process.env.PATH = `${libPath};${sdkPath};${current}`;
    }

	//Force Node.js to accept DLLs from this folder
    try {
      if (typeof process.addDllDirectory === 'function') {
        process.addDllDirectory(binPath);
        // console.log(`[SAP SDK] DLL directory added successfully: ${binPath}`);
      }
    } catch (dllError) {
      console.error("[SAP SDK] Impossibile aggiungere la DLL directory:", dllError);
    }

  } else {
    const libPath = `${sdkPath}/lib`;
    const current = process.env.LD_LIBRARY_PATH || '';
    if (!current.includes(libPath)) {
      process.env.LD_LIBRARY_PATH = `${libPath}:${current}`;
    }
  }
}


// 3. Middleware finale "Catch-all" correct
app.use((req, res, next) => {
  // If the request is for an API that does not exist, respond 404
  if (req.url.startsWith('/api')) {
    return res.status(404).json({ error: "API route not found" });
  }

  // For everything else (frontend navigation), send index.html
  // IMPORTANT: use path.join when sending the file
  const indexPath = path.join(frontendPath, 'index.html');

  res.sendFile(indexPath, (err) => {
    if (err) {
      // If index.html is not found either, there is a path error
      console.error("Fatal error: index.html not found at:", indexPath);
      res.status(500).send("Frontend not available. Check the paths.");
    }
  });
});


Promise.all([ensureSapRealmTable(), ensureSapImportTables(), ensureAppSettingsTable()])
  .then(applySapSdkPathFromSettings)
  .then(() => {
    app.listen(port, () => {
      console.log(`[backend] listening on http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('[backend] failed to initialize database tables', error);
    process.exit(1);
  });
