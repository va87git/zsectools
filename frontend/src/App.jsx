import { useState, useEffect, useRef } from 'react';
import { fetchJson } from './api.js';
import brandBanner from '../assets/brand/zsectools-banner-v2.png';

const SOD_EXPECTED_TABLES_FRONTEND = [
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


const layoutStyle = {
  fontFamily: 'system-ui, sans-serif',
  minHeight: '100vh',
  display: 'grid',
  gridTemplateColumns: '220px 1fr'
};

const sideNavStyle = {
  borderRight: '1px solid #ddd',
  padding: 16
};

const contentStyle = {
  padding: '1.5rem 2rem'
};

const panelStyle = {
  border: '1px solid #ddd',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  maxWidth: 980
};

const allowedPeriodTypes = ['M', 'D', 'W'];

function StatusBlock({ title, data, error }) {
  return (
    <div style={panelStyle}>
      <h3>{title}</h3>
      {error ? <p style={{ color: 'crimson' }}>{error}</p> : null}
      {data ? <pre>{JSON.stringify(data, null, 2)}</pre> : <p>Not checked yet.</p>}
    </div>
  );
}

export default function App() {
  const [section, setSection] = useState('health');
  const [selectedRealm, setSelectedRealm] = useState('');

  const [appHealth, setAppHealth] = useState(null);
  const [dbHealth, setDbHealth] = useState(null);
  const [sapHealth, setSapHealth] = useState(null);
  const [errors, setErrors] = useState({ app: '', db: '', sap: '' });

  const [sdkPath, setSdkPath] = useState('');
  const [sdkPathInfo, setSdkPathInfo] = useState('');
  const [sdkPathError, setSdkPathError] = useState('');
  const [sdkDiag, setSdkDiag] = useState(null);
  const [sdkDiagError, setSdkDiagError] = useState('');

  const [sapRealmError, setSapRealmError] = useState('');
  const [sapRealmInfo, setSapRealmInfo] = useState('');
  const [realms, setRealms] = useState([]);
  const [form, setForm] = useState({
    realm: '',
    realm_description: '',
    sap_user: '',
    sap_password: '',
    sap_ashost: '',
    sap_sysnr: '',
    sap_client: '',
    sap_sid: '',
    sap_language: 'EN',
    sap_router: '',
    realm_reference_date: ''
  });

  const [availableTables, setAvailableTables] = useState([]);
  const [selectedTables, setSelectedTables] = useState([]);
  const [tablesLoading, setTablesLoading] = useState(false);
  const [tablesError, setTablesError] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importErr, setImportErr] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentTable: '' });
  const [statsDatetime, setStatsDatetime] = useState('');
  const [statsPeriodType, setStatsPeriodType] = useState('M');
  const [statsMode, setStatsMode] = useState('append');
  const [statsLoading, setStatsLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [importTxtLoading, setImportTxtLoading] = useState(false);
  const [aggregatedStats, setAggregatedStats] = useState([]);
  const [selectedStatsBatch, setSelectedStatsBatch] = useState(null);
  const [displayTableName, setDisplayTableName] = useState('');
  const [displayRows, setDisplayRows] = useState([]);
  const [displayError, setDisplayError] = useState('');
  const [tableHeaders, setTableHeaders] = useState([]);
  const [displayPage, setDisplayPage] = useState(0);
  const [displayTotal, setDisplayTotal] = useState(0);

  // SOD & Audit section state
  const [sodRuleset, setSodRuleset] = useState('');
  const [sodRulesets, setSodRulesets] = useState([]);
  const [sodElementType, setSodElementType] = useState('Users');
  const [sodElementId, setSodElementId] = useState('');
  const [sodAnalysisLevel, setSodAnalysisLevel] = useState('Action');
  const [sodResults, setSodResults] = useState([]);
  const [sodLoading, setSodLoading] = useState(false);
  const [sodAnalysisRunning, setSodAnalysisRunning] = useState(false);
  const [sodAnalysisMsg, setSodAnalysisMsg] = useState('');
  const [sodAnalysisErr, setSodAnalysisErr] = useState('');
  const [sodAnalysisProgress, setSodAnalysisProgress] = useState({ current: 0, total: 0, elementId: '' });
  const [sodRaResults, setSodRaResults] = useState([]);
  const [sodRaResultsTotal, setSodRaResultsTotal] = useState(0);
  const [sodRaResultsPage, setSodRaResultsPage] = useState(0);
  const [sodAddElementLoading, setSodAddElementLoading] = useState(false);
  const [sodAddElementMsg, setSodAddElementMsg] = useState('');
  const [sodAddElementErr, setSodAddElementErr] = useState('');
  const [sodRaElements, setSodRaElements] = useState([]);
  const [sodRaElementsLoading, setSodRaElementsLoading] = useState(false);
  const [sodRaElementsPage, setSodRaElementsPage] = useState(0);
  const [sodRaElementsTotal, setSodRaElementsTotal] = useState(0);
  const [sodClearLoading, setSodClearLoading] = useState(false);
  const [sodClearMsg, setSodClearMsg] = useState('');
  const [sodClearErr, setSodClearErr] = useState('');
  const [sodImportLoading, setSodImportLoading] = useState(false);
  const [sodImportMsg, setSodImportMsg] = useState('');
  const [sodImportErr, setSodImportErr] = useState('');
  const [sodMissingTables, setSodMissingTables] = useState([]);
  const [sodImportProgress, setSodImportProgress] = useState({ current: 0, total: 0 });
  const [sodRulesetsLoading, setSodRulesetsLoading] = useState(false);
  const [sodExportLoading, setSodExportLoading] = useState(false);
  const [sodExportErr, setSodExportErr] = useState('');
  const [sodExportMsg, setSodExportMsg] = useState('');
  const [sodDeleteLoading, setSodDeleteLoading] = useState(false);
  const [sodDeleteMsg, setSodDeleteMsg] = useState('');
  const [sodDeleteErr, setSodDeleteErr] = useState('');

  // Reports section state
  const [selectedReport, setSelectedReport] = useState('');
  const [reportDays, setReportDays] = useState(120);
  const [reportPattern, setReportPattern] = useState('');
  const [reportRows, setReportRows] = useState([]);
  const [reportHeaders, setReportHeaders] = useState([]);
  const [reportError, setReportError] = useState('');
  const [reportPage, setReportPage] = useState(0);
  const [reportTotal, setReportTotal] = useState(0);
  const [reportTableName, setReportTableName] = useState('');

  const availableReports = [
    { id: 'USER01', name: 'USER01 - Users never logged on in the last XX days' },
    { id: 'USER02', name: 'USER02 - Active users with SAP_ALL and SAP_NEW' },
    { id: 'USER03', name: 'USER03 - Active users with manually assigned profiles' },
    { id: 'USER04', name: 'USER04 - List of system users (active or not)' },
    { id: 'ROLE01', name: 'ROLE01 - Role Composite-Single-Transactions' },
    { id: 'ROLE02', name: 'ROLE02 - Role Single - Transactions in menu (task library)' },
    { id: 'ROLE03', name: 'ROLE03 - Roles with organizational levels entered manually' },
    { id: 'ROLE04', name: 'ROLE04 - Roles Composite-Single-Organizational levels' },
    { id: 'ROLE05', name: 'ROLE05 - Roles with a range or * for S_TCODE' },
    { id: 'ROLE06', name: 'ROLE06 - Roles assigned to users' },
    { id: 'ROLE07', name: 'ROLE07 - Roles Composite-Single-Tcd (Menu)' },
    { id: 'ROLE08', name: 'ROLE08 - Roles assigned to users (hierarchical)' },
    { id: 'ROLE09', name: 'ROLE09 - TODO: SU25 step 2C simulation' },
    { id: 'STAT01', name: 'STAT01 - Statistics users-low details' },
    { id: 'STAT02', name: 'STAT02 - Statistics users-high details' }
  ];

  //states for RFC
const [availableRfcs, setAvailableRfcs] = useState([]);
const [selectedRfc, setSelectedRfc] = useState('');
const [rfcSchema, setRfcSchema] = useState(null);
const [rfcFile, setRfcFile] = useState(null);
const [rfcPreviewRows, setRfcPreviewRows] = useState([]);
const [rfcExecuting, setRfcExecuting] = useState(false);
const [rfcProgress, setRfcProgress] = useState({ current: 0, total: 0, currentRow: '' });
const [rfcResults, setRfcResults] = useState([]);
const [rfcError, setRfcError] = useState('');
const [rfcMsg, setRfcMsg] = useState('');
const rfcFileInputRef = useRef(null); // <--- Added to reset the RFC file input

  const PAGE_SIZE = 100;

  useEffect(() => {
    async function loadAvailableTables() {
      setTablesLoading(true);
      setTablesError('');
      try {
        const data = await fetchJson('/api/tables');
        const tables = data.tables || [];
        setAvailableTables(tables);
        if (tables.length > 0) {
          setSelectedTables(tables);
          setDisplayTableName(tables[0]);
        }
      } catch (err) {
        setTablesError(err.message);
      } finally {
        setTablesLoading(false);
      }
    }
    loadAvailableTables();
  }, []);

  useEffect(() => {
  loadAvailableRfcs();
}, []);

  async function loadSodRulesets() {
    setSodRulesetsLoading(true);
    try {
      const data = await fetchJson('/api/sod/rulesets');
      setSodRulesets(data.rulesets || []);
    } catch (err) {
      console.error('Failed to load SOD rulesets:', err.message);
    } finally {
      setSodRulesetsLoading(false);
    }
  }

  async function loadSodRaElements(page = 0) {
    setSodRaElementsLoading(true);
    setSodRaElementsPage(page);
    try {
      const offset = page * PAGE_SIZE;
      const data = await fetchJson(`/api/sod/ra-elements?limit=${PAGE_SIZE}&offset=${offset}`);
      setSodRaElements(data.elements || []);
      setSodRaElementsTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load SOD RA elements:', err.message);
    } finally {
      setSodRaElementsLoading(false);
    }
  }

  useEffect(() => {
    if (section === 'sod') {
      loadSodRulesets();
      loadSodRaElements();
      loadSodRaResults(0);
    }
  }, [section]);

  async function runCheck(key, path, setter) {
    setErrors((old) => ({ ...old, [key]: '' }));
    try {
      const data = await fetchJson(path);
      setter(data);
    } catch (err) {
      setErrors((old) => ({ ...old, [key]: err.message }));
    }
  }

  async function runSapCheck() {
    if (!selectedRealm) {
      setErrors((old) => ({ ...old, sap: 'Select a realm first' }));
      return;
    }
    await runCheck('sap', `/api/health/sap?realm=${encodeURIComponent(selectedRealm)}`, setSapHealth);
  }

  async function loadSdkPath() {
    setSdkPathError('');
    setSdkPathInfo('');
    try {
      const result = await fetchJson('/api/settings/sap-sdk-path');
      setSdkPath(result.value || '');
      if (result.updatedAt) {
        setSdkPathInfo(`Loaded (updated: ${result.updatedAt})`);
      }
    } catch (err) {
      setSdkPathError(err.message);
    }
  }

  async function saveSdkPath() {
    setSdkPathError('');
    setSdkPathInfo('');
    try {
      const result = await fetchJson('/api/settings/sap-sdk-path', {
        method: 'PUT',
        body: JSON.stringify({ value: sdkPath })
      });
      setSdkPathInfo(`Saved (updated: ${result.saved.updated_at})`);
    } catch (err) {
      setSdkPathError(err.message);
    }
  }

  async function runSdkDiagnostics() {
    setSdkDiag(null);
    setSdkDiagError('');
    try {
      const result = await fetchJson('/api/diagnostics/sap-sdk');
      setSdkDiag(result);
    } catch (err) {
      setSdkDiagError(err.message);
    }
  }

  function updateForm(key, value) {
    setForm((old) => ({ ...old, [key]: value }));
  }

  async function loadRealmList() {
    setSapRealmError('');
    try {
      const result = await fetchJson('/api/sap-realms');
      const loadedRealms = result.realms || [];
      setRealms(loadedRealms);
      
      // Removed: automatic selection of the first realm.
      // Now the user must explicitly select it from the sidebar.
    } catch (err) {
      setSapRealmError(err.message);
    }
  }

  async function loadRealm(realm) {
    if (!realm) {
      setSapRealmError('Realm is required');
      return;
    }

    setSapRealmError('');
    setSapRealmInfo('');
    try {
      const result = await fetchJson(`/api/sap-realms/${encodeURIComponent(realm)}`);
      const cfg = result.config;
      
      // Format realm_reference_date to YYYY-MM-DD for date input
      let formattedDate = '';
      if (cfg.realm_reference_date) {
        const date = new Date(cfg.realm_reference_date);
        if (!isNaN(date.getTime())) {
          formattedDate = date.toISOString().split('T')[0];
        }
      }
      
      setForm({
        realm: cfg.realm || '',
        realm_description: cfg.realm_description || '',
        sap_user: cfg.sap_user || '',
        sap_password: cfg.sap_password || '',
        sap_ashost: cfg.sap_ashost || '',
        sap_sysnr: cfg.sap_sysnr || '',
        sap_client: cfg.sap_client || '',
        sap_sid: cfg.sap_sid || '',
        sap_language: cfg.sap_language || 'EN',
        sap_router: cfg.sap_router || '',
        realm_reference_date: formattedDate
      });
      setSelectedRealm(cfg.realm || '');
      setSapRealmInfo(`Realm loaded: ${cfg.realm}`);
    } catch (err) {
      setSapRealmError(err.message);
    }
  }

  async function saveRealm() {
    setSapRealmError('');
    setSapRealmInfo('');
    if (!form.realm.trim()) {
      setSapRealmError('Realm is required');
      return;
    }

    try {
      const payload = {
        realm_description: form.realm_description,
        sap_user: form.sap_user,
        sap_password: form.sap_password,
        sap_ashost: form.sap_ashost,
        sap_sysnr: form.sap_sysnr,
        sap_client: form.sap_client,
        sap_sid: form.sap_sid,
        sap_language: form.sap_language,
        sap_router: form.sap_router,
        realm_reference_date: form.realm_reference_date
      };

      const result = await fetchJson(`/api/sap-realms/${encodeURIComponent(form.realm.trim())}`, {
        method: 'PUT',
        body: JSON.stringify(payload)
      });
      setSapRealmInfo(`Realm saved: ${result.config.realm}`);
      setSelectedRealm(result.config.realm);
      await loadRealmList();
    } catch (err) {
      setSapRealmError(err.message);
    }
  }

  function toggleTable(tableName) {
    setSelectedTables((old) => (old.includes(tableName) ? old.filter((t) => t !== tableName) : [...old, tableName]));
  }

  async function importTables() {
    setImportErr('');
    setImportMsg('');
    if (!selectedRealm.trim()) {
      setImportErr('Select a realm first');
      return;
    }
    if (!selectedTables.length) {
      setImportErr('Select at least one SAP table');
      return;
    }

    setImportLoading(true);
    setImportProgress({ current: 0, total: selectedTables.length, currentTable: '' });

    const results = [];

    try {
      for (let i = 0; i < selectedTables.length; i++) {
        const tableName = selectedTables[i];
        setImportProgress({ current: i + 1, total: selectedTables.length, currentTable: tableName });
        
        try {
          const result = await fetchJson('/api/import-sap/tables', {
            method: 'POST',
            body: JSON.stringify({ realm: selectedRealm.trim(), tables: [tableName] })
          });
          results.push(...(result.imported || []));
        } catch (err) {
          results.push({ tableName, success: false, rowCount: 0, error: err.message });
        }
      }
      
      const successes = results.filter(r => r.success);
      const failures = results.filter(r => !r.success);

      let msg = '';
      if (successes.length > 0) {
        msg += `Success: ${successes.map(s => `${s.tableName} (${s.rowCount} rows)`).join(', ')}. `;
      }
      if (failures.length > 0) {
        msg += `Failed: ${failures.map(f => `${f.tableName} (${f.error})`).join(', ')}. `;
      }
      
      setImportMsg(msg || 'Import completed with no results.');
    } catch (err) {
      setImportErr(err.message);
    } finally {
      setImportLoading(false);
      setImportProgress({ current: 0, total: 0, currentTable: '' });
    }
  }

  async function buildAdditionalInfos() {
  if (!selectedRealm.trim()) {
    setImportErr('Select a realm first');
    return;
  }

  setImportLoading(true);
  setImportErr('');
  setImportMsg('');
  
  // Array of query names
  const queryNames = [
    'Dropping tables',
    'Building user complete info',
    'Building role stcode exploded',
    'Building roles descriptions',
    'Building tcodes description',
    'Building statistics slim and roles infos'
  ];

  // Simulate progress every 500ms (no events to check)
  let currentStep = 0;
  const progressInterval = setInterval(() => {
    if (currentStep < queryNames.length) {
      setImportProgress({ 
        current: currentStep, 
        total: queryNames.length, 
        currentTable: queryNames[currentStep] 
      });
      currentStep++;
    }
  }, 500);

  try {
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
    const response = await fetch(`${API_BASE}/api/reports/build-additional-infos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ realm: selectedRealm.trim() })
    });
    
    clearInterval(progressInterval);
    
    const result = await response.json();
    if (result.ok) {
      setImportProgress({ 
        current: queryNames.length, 
        total: queryNames.length, 
        currentTable: 'Completed!' 
      });
      setImportMsg('Additional infos built successfully!');
    } else {
      setImportErr('Error: ' + (result.error || 'Failed to build additional infos'));
    }
  } catch (err) {
    clearInterval(progressInterval);
    setImportErr('Error: ' + err.message);
  } finally {
    setImportLoading(false);
    setTimeout(() => setImportProgress({ current: 0, total: 0, currentTable: '' }), 2000);
  }
}

  async function loadAvailableRfcs() {
  try {
    const data = await fetchJson('/api/rfc/available');
    setAvailableRfcs(data.rfcs || []);
  } catch (err) {
    setRfcError(err.message);
  }
}

async function handleRfcSelection(rfcCommand) {
  setSelectedRfc(rfcCommand);
  setRfcPreviewRows([]);
  setRfcSchema(null);
  setRfcError('');

  //check if default (empty) value is selected (do nothing)
  if (!rfcCommand) {
    return; 
  }
  
  try {
    const data = await fetchJson(`/api/rfc/schema/${rfcCommand}`);
    setRfcSchema(data.schema);
  } catch (err) {
    setRfcError(err.message);
  }
}

async function handleRfcFileUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  setRfcError('');
  setRfcMsg('');
  
  try {
    const text = await file.text();
    const lines = text.split('\n');
    const rows = [];
    
    // Assume the first row is the header
    const headers = lines[0].split('\t').map(h => h.trim());
    
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim()) {
        const values = lines[i].split('\t');
        const row = {};
        headers.forEach((header, idx) => {
          row[header] = values[idx] || '';
        });
        rows.push(row);
      }
    }
    
    setRfcPreviewRows(rows);

        // --- ADDED BLOCK: VERIFIES BAPI SCHEMA AGAINST THE CSV ---
    if (rfcSchema) {
      const required = rfcSchema.requiredFields || [];
      const missing = required.filter(field => !headers.includes(field));
      
      if (missing.length > 0) {
        setRfcError(`Schema mismatch: Mancano le colonne obbligatorie: ${missing.join(', ')}`);
        setRfcPreviewRows([]); // Clear the preview if it is not valid
        return; 
      }
    }
    // --- END ADDING ---

    e.target.value = ''; //added this line to reset the file input so it can be re-read if the same file is reselected
    
    setRfcMsg(`Loaded ${rows.length} rows from file: ${file.name}`);
  } catch (err) {
    setRfcError(`File upload error: ${err.message}`);
  }
}

async function executeRfcBatch() {
  if (!selectedRealm.trim()) {
    setRfcError('Select a realm first');
    return;
  }
  
  if (!selectedRfc) {
    setRfcError('Select an RFC command first');
    return;
  }
  
  if (rfcPreviewRows.length === 0) {
    setRfcError('No rows to execute');
    return;
  }
  
  setRfcExecuting(true);
  setRfcError('');
  setRfcMsg('');
  setRfcResults([]);
  setRfcProgress({ current: 0, total: rfcPreviewRows.length, currentRow: '' });
  
  try {
    const result = await fetchJson('/api/rfc/execute-batch', {
      method: 'POST',
      body: JSON.stringify({
        realm: selectedRealm.trim(),
        rfcCommand: selectedRfc,
        rows: rfcPreviewRows
      })
    });
    
    setRfcResults(result.results || []);
    
    const successes = result.results.filter(r => r.status === 'success').length;
    const failures = result.results.filter(r => r.status === 'error').length;
    
    setRfcMsg(`Execution completed: ${successes} success, ${failures} failed`);
  } catch (err) {
    setRfcError(err.message);
  } finally {
    setRfcExecuting(false);
    setRfcProgress({ current: 0, total: 0, currentRow: '' });
  }
}

  async function loadAggregatedStats() {
    if (!selectedRealm.trim()) return;
    try {
      const result = await fetchJson('/api/import-sap/user-statistics/aggregated?realm=' + encodeURIComponent(selectedRealm.trim()));
      setAggregatedStats(result.stats || []);
    } catch (err) {
      console.error('Failed to load aggregated stats:', err);
    }
  }

  async function deleteSelectedStatsBatch() {
    if (!selectedStatsBatch || !selectedRealm.trim()) return;
    if (!confirm(`Delete statistics batch?\nPeriod: ${selectedStatsBatch.period_type}\nDate: ${selectedStatsBatch.selected_at}\nRows: ${selectedStatsBatch.row_count}`)) return;
    
    try {
      const result = await fetchJson('/api/import-sap/user-statistics/batch', {
        method: 'DELETE',
        body: JSON.stringify({
          realm: selectedRealm.trim(),
          periodType: selectedStatsBatch.period_type,
          selectedAt: selectedStatsBatch.selected_at
        })
      });
      setImportMsg(`Deleted ${result.deletedCount} statistics rows`);
      setSelectedStatsBatch(null);
      await loadAggregatedStats();
      await loadImportedTableRows(0);
    } catch (err) {
      setImportErr(err.message);
    }
  }

  async function importStatistics() {
    setImportErr('');
    setImportMsg('');
    if (!selectedRealm.trim()) {
      setImportErr('Select a realm first');
      return;
    }
    if (!statsDatetime) {
      setImportErr('Select a date for statistics import');
      return;
    }

    setStatsLoading(true);

    try {
      const result = await fetchJson('/api/import-sap/user-statistics', {
        method: 'POST',
        body: JSON.stringify({ realm: selectedRealm.trim(), datetime: statsDatetime, periodType: statsPeriodType, mode: statsMode })
      });
      const modeLabel = statsMode === 'overwrite' ? '(overwrite)' : '(append)';
      setImportMsg(`OK - ${result.usertcodeRowCount} statistics for period ${statsDatetime} with PERIODTYPE=${statsPeriodType} downloaded successfully ${modeLabel}`);
      await loadAggregatedStats();
    } catch (err) {
      setImportErr(err.message);
    } finally {
      setStatsLoading(false);
    }
  }

  async function exportTablesTxt() {
    setImportErr('');
    setImportMsg('');
    if (!selectedRealm.trim()) {
      setImportErr('Select a realm first');
      return;
    }
    if (!selectedTables.length) {
      setImportErr('Select at least one table');
      return;
    }

    setExportLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
      // Try to use the File System Access API to pick a folder and write all files there
      if (typeof window.showDirectoryPicker === 'function') {
        const dirHandle = await window.showDirectoryPicker();
        for (const tableName of selectedTables) {
          const response = await fetch(`${API_BASE}/api/export-sap/tables-txt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ realm: selectedRealm.trim(), tables: [tableName] })
          });
          if (!response.ok) {
            const text = await response.text();
            let errorMessage = 'Export failed';
            try {
              const errJson = JSON.parse(text);
              errorMessage = errJson.error || errorMessage;
            } catch (e) {
              errorMessage = text || errorMessage;
            }
            throw new Error(errorMessage);
          }
          const blob = await response.blob();
          const fileName = `sap_table_${tableName}_${selectedRealm.trim()}_${new Date().toISOString().split('T')[0]}.txt`;
          const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(blob);
          await writable.close();
        }
        setImportMsg(`Exported ${selectedTables.length} table(s) to selected folder.`);
      } else {
        // Fallback to separate downloads if directory picker unavailable
        for (const tableName of selectedTables) {
          const response = await fetch(`${API_BASE}/api/export-sap/tables-txt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ realm: selectedRealm.trim(), tables: [tableName] })
          });
          if (!response.ok) {
            const text = await response.text();
            let errorMessage = 'Export failed';
            try {
              const errJson = JSON.parse(text);
              errorMessage = errJson.error || errorMessage;
            } catch (e) {
              errorMessage = text || errorMessage;
            }
            throw new Error(errorMessage);
          }
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const defaultFilename = `sap_table_${tableName}_${selectedRealm.trim()}_${new Date().toISOString().split('T')[0]}.txt`;
          a.download = defaultFilename;
          a.click();
          window.URL.revokeObjectURL(url);
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
        }
        setImportMsg(`Exported ${selectedTables.length} table(s) successfully (check your downloads folder)`);
      }
    } catch (err) {
      setImportErr(`Export Error: ${err.message}`);
    } finally {
      setExportLoading(false);
    }
  }

  async function exportStatisticsTxt() {
    setImportErr('');
    setImportMsg('');
    if (!selectedRealm.trim()) {
      setImportErr('Select a realm first');
      return;
    }

    setExportLoading(true);
    try {
      const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
      // Export each selected batch individually
      if (selectedStatsBatch) {
        // Export only the selected batch
        const response = await fetch(`${API_BASE}/api/export-sap/statistics-txt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            realm: selectedRealm.trim(), 
            selectedAt: selectedStatsBatch.selected_at,
            periodType: selectedStatsBatch.period_type
          })
        });

        if (!response.ok) {
          const text = await response.text();
          let errorMessage = 'Export failed';
          try {
            const errJson = JSON.parse(text);
            errorMessage = errJson.error || errorMessage;
          } catch (e) {
            errorMessage = text || errorMessage;
          }
          throw new Error(errorMessage);
        }

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const dateSuffix = selectedStatsBatch.selected_at.split('T')[0];
        const periodType = selectedStatsBatch.period_type;
        const defaultFilename = `sap_statistics_${selectedRealm.trim()}_${periodType}_${dateSuffix}.txt`;
        a.download = defaultFilename;
        a.click();
        window.URL.revokeObjectURL(url);
        setImportMsg(`Statistics batch exported successfully (check your downloads folder)`);
      } else {
        // Export all batches if none selected - get aggregated list first
        const aggResult = await fetchJson('/api/import-sap/user-statistics/aggregated?realm=' + encodeURIComponent(selectedRealm.trim()));
        const batches = aggResult.stats || [];
        
        for (const batch of batches) {
          const response = await fetch(`${API_BASE}/api/export-sap/statistics-txt`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              realm: selectedRealm.trim(), 
              selectedAt: batch.selected_at,
              periodType: batch.period_type
            })
          });

          if (!response.ok) {
            const text = await response.text();
            let errorMessage = 'Export failed';
            try {
              const errJson = JSON.parse(text);
              errorMessage = errJson.error || errorMessage;
            } catch (e) {
              errorMessage = text || errorMessage;
            }
            throw new Error(errorMessage);
          }

          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          const dateSuffix = batch.selected_at.split('T')[0];
          const periodType = batch.period_type;
          const defaultFilename = `sap_statistics_${selectedRealm.trim()}_${periodType}_${dateSuffix}.txt`;
          a.download = defaultFilename;
          a.click();
          window.URL.revokeObjectURL(url);
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay between downloads
        }
        setImportMsg(`Exported ${batches.length} statistics batch(es) successfully (check your downloads folder)`);
      }
    } catch (err) {
      setImportErr(`Export Error: ${err.message}`);
    } finally {
      setExportLoading(false);
    }
  }

  async function importTablesTxt() {
  setImportErr('');
  setImportMsg('');
  if (!selectedRealm.trim()) {
    setImportErr('Select a realm first');
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.txt';
  input.onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    setImportTxtLoading(true);
    try {
      const text = await file.text();
      
      // DO NOT filter rows here! Send whole file to backend.
      // The backend already knows how to extract the table name and types from the comments.
      
      // Extract the table name from the file (optional, if you want to use it for the API)
      const lines = text.split(/\r?\n/);
      let tableName = null;
      for (const line of lines) {
        if (line.startsWith('# Table:')) {
          tableName = line.replace('# Table:', '').trim();
          break; // Found, exit
        }
      }

      if (!tableName) {
        throw new Error('Invalid TXT format: missing # Table: header');
      }

      const result = await fetchJson('/api/import-sap/tables-txt', {
        method: 'POST',
        // Send whole original text ('text')
        body: JSON.stringify({ realm: selectedRealm.trim(), tableName, txtContent: text })
      });
      
      setImportMsg(`Imported ${result.imported} rows from ${tableName}`);
    } catch (err) {
      setImportErr(err.message);
    } finally {
      setImportTxtLoading(false);
    }
  };
  input.click();
}

  async function importStatisticsTxt() {
    setImportErr('');
    setImportMsg('');
    if (!selectedRealm.trim()) {
      setImportErr('Select a realm first');
      return;
    }

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.txt';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      setImportTxtLoading(true);
      try {
        const text = await file.text();
        // Filter out comment lines
        //const dataLines = text.split('\n').filter(line => !line.startsWith('#') && line.trim());
        const dataLines = text.split('\n');
        
        if (dataLines.length < 1) {
          throw new Error('Invalid TXT format: no data found');
        }

        const txtContent = dataLines.join('\n');
        const result = await fetchJson('/api/import-sap/statistics-txt', {
          method: 'POST',
          body: JSON.stringify({ realm: selectedRealm.trim(), txtContent })
        });
        setImportMsg(`Imported ${result.imported} statistics rows`);
      } catch (err) {
        setImportErr(err.message);
      } finally {
        setImportTxtLoading(false);
      }
    };
    input.click();
  }

  async function loadReportRows(page = 0, overrideTableName = null, reportCode = null) {
  setReportError('');
  setReportRows([]);
  setReportHeaders([]);
  setReportPage(page);
  if (!selectedRealm.trim()) {
    setReportError('Select a realm first');
    return;
  }
  
  const tableNameToUse = overrideTableName || reportTableName;
  if (!tableNameToUse) {
    setReportError('No report table available. Execute a report first.');
    return;
  }

  try {
    const offset = page * PAGE_SIZE;
    const result = await fetchJson(
      `/api/reports/results?realm=${encodeURIComponent(selectedRealm.trim())}&tableName=${encodeURIComponent(tableNameToUse)}&limit=${PAGE_SIZE}&offset=${offset}`
    );
    const rows = result.rows || [];
    setReportRows(rows);
    setReportTotal(result.total || rows.length);
    if (rows.length > 0) {
      const first = rows[0];
      const raw = first?.row_data;
      const rowObj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
      const keys = typeof rowObj === 'object' && rowObj !== null ? Object.keys(rowObj) : [];
      setReportHeaders(keys);
    }
  } catch (err) {
    if (err.message.includes('REPORT_NOT_EXECUTED')) {
      // Use reportCode if available, otherwise selectedReport
      const reportCodeToShow = reportCode || selectedReport;
      setReportError(`Report ${reportCodeToShow} has not been executed yet`);
    } else {
      setReportError(err.message);
    }
  }
}

  async function executeReport() {
    setReportError('');
    setReportRows([]);
    setReportHeaders([]);
    
    if (!selectedRealm.trim()) {
      setReportError('Select a realm first');
      return;
    }
    if (!selectedReport) {
      setReportError('Select a report first');
      return;
    }
    
    try {
      const result = await fetchJson('/api/reports/execute', {
        method: 'POST',
        body: JSON.stringify({
          realm: selectedRealm.trim(),
          reportType: selectedReport,
          //added by me: to roll back, remove rolePattern and the comma after reportDays
          days: reportDays,
          rolePattern: reportPattern
        })
      });
      
      if (result.ok) {
        setReportError('');
        setReportTableName(result.tableName || result.table);
        alert(`Report ${selectedReport} executed successfully! Table created: ${result.tableName || result.table}`);
        await loadReportRows(0);
      } else {
        setReportError(result.error || 'Failed to execute report');
      }
    } catch (err) {
      setReportError(err?.message || 'Failed to execute report');
    }
  }

  async function exportReport() {
    if (!reportTableName || !selectedRealm) return;
    try {
      const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
      const url = `${apiBase}/api/reports/export-csv?realm=${encodeURIComponent(selectedRealm.trim())}&tableName=${encodeURIComponent(reportTableName)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `report_${reportTableName}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed: ' + err.message);
    }
  }

  async function loadImportedTableRows(page = 0) {
    setDisplayError('');
    setDisplayRows([]);
    setTableHeaders([]);
    setDisplayPage(page);
    if (!selectedRealm.trim()) {
      setDisplayError('Select a realm first');
      return;
    }

    try {
      const offset = page * PAGE_SIZE;
      let result;
      if (displayTableName === '01-USER-STATISTICS') {
        result = await fetchJson(
          `/api/import-sap/user-statistics?realm=${encodeURIComponent(selectedRealm.trim())}&limit=${PAGE_SIZE}&offset=${offset}`
        );
      } else {
        result = await fetchJson(
          `/api/import-sap/tables/${encodeURIComponent(displayTableName)}?realm=${encodeURIComponent(selectedRealm.trim())}&limit=${PAGE_SIZE}&offset=${offset}`
        );
      }
      const rows = result.rows || [];
      setDisplayRows(rows);
      setDisplayTotal(result.total || rows.length);
      if (rows.length > 0) {
        const first = rows[0];
        const raw = first?.row_data;
        const rowObj = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
        const keys = typeof rowObj === 'object' && rowObj !== null ? Object.keys(rowObj) : [];
        setTableHeaders(keys);
      }
    } catch (err) {
      setDisplayError(err.message);
    }
  }

  function renderRealmSelector() {
    return null; // Realm selector removed from individual sections
  }

  function renderHealthSection() {
    return (
      <>
        <h1>Quality and prerequisites check</h1>
        <p style={{ marginTop: 0, color: '#666' }}>build V1.01(TEST OK 20260610. Verificare database collation)</p>
        <p>Use this section for backend/API health checks.</p>

        {renderRealmSelector()}

        <div style={{ marginBottom: 12 }}>
          <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={() => runCheck('app', '/api/health', setAppHealth)}>Check API</button>
          <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={() => runCheck('db', '/api/health/db', setDbHealth)}>Check Database</button>
          <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm} onClick={runSapCheck}>Run RFCPING</button>
        </div>
        <StatusBlock title="API Health" data={appHealth} error={errors.app} />
        <StatusBlock title="Database Health" data={dbHealth} error={errors.db} />
        {sapHealth?.ok ? (
              <div style={panelStyle}>
                <h3>SAP RFC Health</h3>
                <p style={{ color: 'green' }}>RFCPING OK — {sapHealth.latencyMs}ms — {sapHealth.destination?.ashost}/{sapHealth.destination?.client}</p>
              </div>
            ) : (
              <StatusBlock title="SAP RFC Health" data={sapHealth} error={errors.sap} />
            )}

        <div style={panelStyle}>
          <h3>SAP NW RFC SDK path (persisted)</h3>
          <p style={{ marginTop: 0 }}>Save the SDK base path so the backend applies it at startup.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, alignItems: 'center' }}>
            <label>SDK path</label>
            <input value={sdkPath} onChange={(e) => setSdkPath(e.target.value)} placeholder="/opt/sap/nwrfcsdk (Linux) or C:\\nwrfcsdk (Windows)" />
          </div>
          <div style={{ marginTop: 10 }}>
            <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={loadSdkPath}>Load</button>
            <button style={{ padding: '8px 12px', cursor: 'pointer' }} onClick={saveSdkPath}>Save</button>
            <button style={{ marginLeft: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={runSdkDiagnostics}>Run diagnostics</button>
          </div>
          {sdkPathError ? <p style={{ color: 'crimson' }}>{sdkPathError}</p> : null}
          {sdkPathInfo ? <p style={{ color: 'green' }}>{sdkPathInfo}</p> : null}
          {sdkDiagError ? <p style={{ color: 'crimson' }}>{sdkDiagError}</p> : null}
          {sdkDiag ? <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(sdkDiag, null, 2)}</pre> : null}
        </div>
      </>
    );
  }

  function renderRealmSection() {
    return (
      <>
        <h1>SAP Connection Realms</h1>
        <p>Save multiple SAP connection configurations with a unique <code>realm</code>.</p>

        {renderRealmSelector()}

        <div style={panelStyle}>
          <div style={{ marginBottom: 12 }}>
            <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={loadRealmList}>Refresh Realm List</button>
            <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={saveRealm}>Save / Update Realm</button>
          </div>

          {sapRealmError ? <p style={{ color: 'crimson' }}>{sapRealmError}</p> : null}
          {sapRealmInfo ? <p style={{ color: 'green' }}>{sapRealmInfo}</p> : null}

          <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr', gap: 8, alignItems: 'center' }}>
            <label>realm (a-z, 0-9 only)</label><input value={form.realm} onChange={(e) => updateForm('realm', e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))} />
            <label>realm description</label><input value={form.realm_description} onChange={(e) => updateForm('realm_description', e.target.value)} />
            <label>SAP_USER</label><input value={form.sap_user} onChange={(e) => updateForm('sap_user', e.target.value)} />
            <label>SAP_PASSWORD</label><input type="password" value={form.sap_password} onChange={(e) => updateForm('sap_password', e.target.value)} />
            <label>SAP_ASHOST</label><input value={form.sap_ashost} onChange={(e) => updateForm('sap_ashost', e.target.value)} />
            <label>SAP_SYSNR</label><input value={form.sap_sysnr} onChange={(e) => updateForm('sap_sysnr', e.target.value)} />
            <label>SAP_CLIENT</label><input value={form.sap_client} onChange={(e) => updateForm('sap_client', e.target.value)} />
            <label>SAP_SID</label><input value={form.sap_sid} onChange={(e) => updateForm('sap_sid', e.target.value)} />
            <label>SAP_LANGUAGE</label><select value={form.sap_language} onChange={(e) => updateForm('sap_language', e.target.value)} style={{ height: '30px' }}>
                <option value="EN">EN</option>
                <option value="IT">IT</option>
              </select>
            <label>SAP_ROUTER</label><input value={form.sap_router} onChange={(e) => updateForm('sap_router', e.target.value)} />
            <label>Realm reference date</label><input type="date" value={form.realm_reference_date} onChange={(e) => updateForm('realm_reference_date', e.target.value)} />
          </div>
        </div>

        <div style={panelStyle}>
          <h3>Saved realms</h3>
          {realms.length === 0 ? <p>No saved realms loaded.</p> : (
            <ul>
              {realms.map((item) => (
                <li key={item.realm} style={{ marginBottom: '8px' }}>
                  <button style={{ marginRight: 8, cursor: 'pointer' }} onClick={() => loadRealm(item.realm)}>Load</button>
                  <button style={{ marginRight: 8, cursor: 'pointer' }} onClick={() => setSelectedRealm(item.realm)}>Select</button>
                  <button 
                    style={{ marginRight: 8, cursor: 'pointer', color: 'crimson', border: '1px solid crimson' }} 
                    onClick={async () => {
                      if (!confirm(`Delete realm "${item.realm}"? This cannot be undone.`)) return;
                      try {
                        await fetchJson(`/api/sap-realms/${encodeURIComponent(item.realm)}`, { method: 'DELETE' });
                        setSapRealmInfo(`Realm deleted: ${item.realm}`);
                        await loadRealmList();
                        if (selectedRealm === item.realm) setSelectedRealm('');
                      } catch (err) {
                        setSapRealmError(err.message);
                      }
                    }}
                  >Delete</button>
                  {item.realm} {item.realm_description ? `(${item.realm_description})` : ''} — ({item.sap_ashost}/{item.sap_client})
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  function renderReportsSection() {
    return (
      <>
        <h1>Reports</h1>
        <p>Generate and view predefined SAP reports.</p>

        {renderRealmSelector()}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, maxWidth: 1200 }}>
          <div style={panelStyle}>
            <h3>Select Report</h3>
            <label style={{ display: 'block', marginBottom: 6 }}>Report</label>
            <select 
  value={selectedReport} 
  onChange={async (e) => { 
    const val = e.target.value;
    setSelectedReport(val);  // Update state
    setReportRows([]); 
    setReportHeaders([]); 
    setReportPage(0); 
    setReportTotal(0); 
    setReportError('');
    setReportTableName('');
    
    if (val && selectedRealm) {
  const tableName = `yreport_${selectedRealm.toLowerCase()}_${val.toLowerCase()}`;
  setReportTableName(tableName);
  await loadReportRows(0, tableName, val);  // Also pass `val` as reportCode
}
  }}
  style={{ width: '100%', marginBottom: 12 }}
>
              <option value="">-- Select a report --</option>
              {availableReports.map((report) => (
                <option key={report.id} value={report.id}>{report.name}</option>
              ))}
            </select>
            
            {selectedReport === 'USER01' && (
              <>
                <label style={{ display: 'block', marginBottom: 6 }}>Days</label>
                <input 
                  type="number" 
                  value={reportDays} 
                  onChange={(e) => setReportDays(Number(e.target.value))} 
                  min="1" 
                  max="365"
                  style={{ width: '100%', marginBottom: 12 }}
                />
              </>
            )}
            {selectedReport === 'ROLE01' && (
              <>
                <label style={{ display: 'block', marginBottom: 6 }}>Pattern (LIKE) - you can use the wildcard characters supported by the database, which are:
                      <br />
                      <br />
                      • <strong>%</strong>: like * in SAP, represents a sequence of zero, one, or more characters.
                      <br />
                      <br />
                      • <strong>_ (underscore)</strong>: like + in SAP, represents a single character.
                      </label>
                <input 
                  type="text" 
                  value={reportPattern}
                  onChange={(e) => setReportPattern(e.target.value.toUpperCase())} //uppercase by default because it is a LIKE statement
                  style={{ width: '100%', marginBottom: 12 }}
                  placeholder="es. ZAGRT%"
                />
              </>
            )}
            {selectedReport === 'ROLE02' && (
              <>
                <label style={{ display: 'block', marginBottom: 6 }}>Pattern (LIKE) - you can use the wildcard characters supported by the database, which are:
                      <br />
                      <br />
                      • <strong>%</strong>: like * in SAP, represents a sequence of zero, one, or more characters.
                      <br />
                      <br />
                      • <strong>_ (underscore)</strong>: like + in SAP, represents a single character.
                      </label>
                <input 
                  type="text" 
                  value={reportPattern}
                  onChange={(e) => setReportPattern(e.target.value.toUpperCase())} //uppercase by default because it is a LIKE statement
                  style={{ width: '100%', marginBottom: 12 }}
                  placeholder="es. ZAGRT%"
                />
              </>
            )}
             {selectedReport === 'ROLE04' && (
              <>
                <label style={{ display: 'block', marginBottom: 6 }}>Pattern (LIKE) - you can use the wildcard characters supported by the database, which are:
                      <br />
                      <br />
                      • <strong>%</strong>: like * in SAP, represents a sequence of zero, one, or more characters.
                      <br />
                      <br />
                      • <strong>_ (underscore)</strong>: like + in SAP, represents a single character.
                      </label>
                <input 
                  type="text" 
                  value={reportPattern}
                  onChange={(e) => setReportPattern(e.target.value.toUpperCase())} //uppercase by default because it is a LIKE statement
                  style={{ width: '100%', marginBottom: 12 }}
                  placeholder="es. ZAGRT%"
                />
              </>
            )}
            {selectedReport === 'ROLE07' && (
              <>
                <label style={{ display: 'block', marginBottom: 6 }}>Pattern (LIKE) - you can use the wildcard characters supported by the database, which are:
                      <br />
                      <br />
                      • <strong>%</strong>: like * in SAP, represents a sequence of zero, one, or more characters.
                      <br />
                      <br />
                      • <strong>_ (underscore)</strong>: like + in SAP, represents a single character.
                      </label>
                <input 
                  type="text" 
                  value={reportPattern}
                  onChange={(e) => setReportPattern(e.target.value.toUpperCase())} //uppercase by default because it is a LIKE statement
                  style={{ width: '100%', marginBottom: 12 }}
                  placeholder="es. ZAGRT%"
                />
              </>
            )}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button 
                style={{ padding: '8px 12px', cursor: 'pointer' }} 
                disabled={!selectedRealm || !selectedReport}
                onClick={executeReport}
              >
                Execute query
              </button>
            </div>
          </div>

          <div style={panelStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Report Results</h3>
              <button 
                style={{ 
                  padding: '8px 12px', 
                  cursor: 'pointer', 
                  background: '#4caf50', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '4px'
                }} 
                onClick={exportReport}
                disabled={reportRows.length === 0}
              >
                Export Report
              </button>
            </div>
            
            {reportError ? <p style={{ color: 'crimson' }}>{reportError}</p> : null}
            {reportRows.length > 0 && reportHeaders.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ color: '#666', marginBottom: 6 }}>
                  Showing {reportPage * PAGE_SIZE + 1}-{Math.min((reportPage + 1) * PAGE_SIZE, reportTotal)} of {reportTotal} rows
                </p>
                <div style={{ marginBottom: 8 }}>
                  <button onClick={() => loadReportRows(0)} disabled={reportPage === 0}>First</button>
                  <button onClick={() => loadReportRows(reportPage - 1)} disabled={reportPage === 0} style={{ marginLeft: 4 }}>Prev</button>
                  <span style={{ margin: '0 8px' }}>Page {reportPage + 1} of {Math.ceil(reportTotal / PAGE_SIZE)}</span>
                  <button onClick={() => loadReportRows(reportPage + 1)} disabled={reportPage >= Math.ceil(reportTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                  <button onClick={() => loadReportRows(Math.ceil(reportTotal / PAGE_SIZE) - 1)} disabled={reportPage >= Math.ceil(reportTotal / PAGE_SIZE) - 1}>Last</button>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {reportHeaders.map((h) => <th key={h} style={{ border: '1px solid #ddd', padding: '4px 8px', background: '#f0f0f0', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {reportRows.map((rowObj, idx) => {
                        const raw = rowObj?.row_data;
                        const data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                        return (
                          <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                            {reportHeaders.map((h) => <td key={h} style={{ border: '1px solid #ddd', padding: '4px 8px', whiteSpace: 'nowrap' }}>{String(data[h] ?? '')}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>{reportRows.length ? JSON.stringify(reportRows, null, 2) : 'No data loaded. Select a report and execute query.'}</pre>
            )}
          </div>
        </div>
      </>
    );
  }

  function renderImportSection() {
    return (
      <>
        <h1>Import SAP Tables</h1>
        <p>Import SAP tables and user statistics into local database by selected realm.</p>

        {renderRealmSelector()}

        <div style={panelStyle}>
          {importErr ? <p style={{ color: 'crimson' }}>{importErr}</p> : null}
          {importMsg ? <p style={{ color: 'green' }}>{importMsg}</p> : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, maxWidth: 1200 }}>
          <div style={panelStyle}>
            <h3>Tables download</h3>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button style={{ padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm || importLoading} onClick={importTables}>Download selected Tables from SAP</button>
              <button style={{ padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm || !selectedTables.length || exportLoading} onClick={exportTablesTxt}>Export TXT</button>
              <button style={{ padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm || importTxtLoading} onClick={importTablesTxt}>Import TXT</button>
            </div>
            {importLoading ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ background: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    background: '#4caf50',
                    height: 20,
                    width: `${(importProgress.current / importProgress.total) * 100}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                <p style={{ fontSize: 13, color: '#666' }}>
                  Downloading table {importProgress.currentTable} ({importProgress.current}/{importProgress.total})
                </p>
              </div>
            ) : null}
            <div style={{ marginTop: 20, marginBottom: 10 }}>
            <h4 style={{ margin: 0, color: '#333' }}>Tables selection</h4>
            </div>
            <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <button 
                style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12 }} 
                onClick={() => setSelectedTables(availableTables)}
                disabled={!availableTables.length}
              >
                Select All
              </button>
              <button 
                style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12 }} 
                onClick={() => setSelectedTables([])}
                disabled={!selectedTables.length}
              >
                Deselect All
              </button>
              <button 
  style={{ padding: '6px 10px', cursor: 'pointer', fontSize: 12, background: '#e3f2fd', border: '1px solid #2196f3' }} 
  onClick={buildAdditionalInfos}
  disabled={!selectedRealm || importLoading}
>
  Build additional infos
</button>
            </div>
            {availableTables.map((tableName) => (
              <label key={tableName} style={{ display: 'block', marginBottom: 6 }}>
                <input type="checkbox" checked={selectedTables.includes(tableName)} onChange={() => toggleTable(tableName)} /> {tableName}
              </label>
            ))}
            
            
          </div>

          <div style={panelStyle}>
            <h3>Users statistics</h3>
            <label style={{ display: 'block', marginBottom: 6 }}>Date selector</label>
            <input type="date" value={statsDatetime} onChange={(e) => setStatsDatetime(e.target.value)} style={{ marginBottom: 10 }} />

            <label style={{ display: 'block', marginBottom: 6 }}>PERIODTYPE</label>
            <select value={statsPeriodType} onChange={(e) => setStatsPeriodType(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="M">M (Monthly)</option>
              <option value="D">D (Daily)</option>
              <option value="W">W (Weekly)</option>
            </select>

            <label style={{ display: 'block', marginBottom: 6 }}>Download Mode</label>
            <select value={statsMode} onChange={(e) => setStatsMode(e.target.value)} style={{ marginBottom: 10 }}>
              <option value="overwrite">Overwrite (delete existing for this realm)</option>
              <option value="append">Append (keep all downloads)</option>
            </select>

            {statsLoading ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ fontSize: 13, color: '#666' }}>Downloading user statistics...</p>
              </div>
            ) : null}

            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button style={{ padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm || statsLoading} onClick={importStatistics}>Download Statistics</button>
              <button style={{ padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm || exportLoading} onClick={exportStatisticsTxt}>Export Statistics TXT</button>
              <button style={{ padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm || importTxtLoading} onClick={importStatisticsTxt}>Import Statistics TXT</button>
            </div>

            <div style={{ marginTop: 16, borderTop: '1px solid #ddd', paddingTop: 12 }}>
              <h4 style={{ marginBottom: 8 }}>Downloaded statistics batches</h4>
              <button style={{ marginBottom: 8, padding: '6px 12px', cursor: 'pointer' }} disabled={!selectedRealm} onClick={loadAggregatedStats}>Refresh list</button>
              {aggregatedStats.length === 0 ? (
                <p style={{ color: '#666', fontSize: 13 }}>No statistics downloaded yet.</p>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: '#f0f0f0' }}>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Select</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Period</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedStats.map((stat, idx) => (
                        <tr key={idx} style={{ background: selectedStatsBatch === stat ? '#e3f2fd' : (idx % 2 === 0 ? '#fff' : '#f9f9f9') }}>
                          <td style={{ padding: '4px 8px' }}>
                            <input type="radio" name="statsBatch" checked={selectedStatsBatch === stat} onChange={() => setSelectedStatsBatch(stat)} />
                          </td>
                          <td style={{ padding: '4px 8px' }}>{stat.period_type}</td>
                          <td style={{ padding: '4px 8px' }}>{stat.selected_at}</td>
                          <td style={{ padding: '4px 8px' }}>{stat.row_count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {selectedStatsBatch && (
                <button 
                  style={{ marginTop: 8, padding: '6px 12px', cursor: 'pointer', background: '#ffebee', border: '1px solid #c62828', color: '#c62828' }}
                  onClick={deleteSelectedStatsBatch}
                >
                  Delete selected batch ({selectedStatsBatch.row_count} rows)
                </button>
              )}
            </div>
          </div>

          <div style={panelStyle}>
            <h3>Display imported table</h3>
            <label style={{ display: 'block', marginBottom: 6 }}>Table</label>
            <select value={displayTableName} onChange={(e) => { setDisplayTableName(e.target.value); setDisplayRows([]); setTableHeaders([]); setDisplayPage(0); setDisplayTotal(0); }}>
              <optgroup label="SAP Tables">
                {availableTables.map((tableName) => <option key={tableName} value={tableName}>{tableName}</option>)}
              </optgroup>
              <optgroup label="Statistics">
                <option value="01-USER-STATISTICS">01-USER-STATISTICS</option>
              </optgroup>
            </select>
            <div>
              <button style={{ marginTop: 8, padding: '8px 12px', cursor: 'pointer' }} disabled={!selectedRealm} onClick={() => loadImportedTableRows(0)}>Show data from local DB</button>
            </div>
            {displayError ? <p style={{ color: 'crimson' }}>{displayError}</p> : null}
            {displayRows.length > 0 && tableHeaders.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ color: '#666', marginBottom: 6 }}>
                  Showing {displayPage * PAGE_SIZE + 1}-{Math.min((displayPage + 1) * PAGE_SIZE, displayTotal)} of {displayTotal} rows
                </p>
                <div style={{ marginBottom: 8 }}>
                  <button onClick={() => loadImportedTableRows(0)} disabled={displayPage === 0}>First</button>
                  <button onClick={() => loadImportedTableRows(displayPage - 1)} disabled={displayPage === 0} style={{ marginLeft: 4 }}>Prev</button>
                  <span style={{ margin: '0 8px' }}>Page {displayPage + 1} of {Math.ceil(displayTotal / PAGE_SIZE)}</span>
                  <button onClick={() => loadImportedTableRows(displayPage + 1)} disabled={displayPage >= Math.ceil(displayTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                  <button onClick={() => loadImportedTableRows(Math.ceil(displayTotal / PAGE_SIZE) - 1)} disabled={displayPage >= Math.ceil(displayTotal / PAGE_SIZE) - 1}>Last</button>
                </div>
                <div style={{ overflowX: 'auto', maxHeight: 400, overflowY: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {tableHeaders.map((h) => <th key={h} style={{ border: '1px solid #ddd', padding: '4px 8px', background: '#f0f0f0', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((rowObj, idx) => {
                        const raw = rowObj?.row_data;
                        const data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                        return (
                          <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                            {tableHeaders.map((h) => <td key={h} style={{ border: '1px solid #ddd', padding: '4px 8px', whiteSpace: 'nowrap' }}>{String(data[h] ?? '')}</td>)}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>{displayRows.length ? JSON.stringify(displayRows, null, 2) : 'No rows loaded.'}</pre>
            )}
          </div>
        </div>
      </>
    );
  }

  function renderRfcSection() {
    const handleRfcReset = () => {
  setSelectedRfc('');       // Reset BAPI selection
  setRfcSchema(null);       // Remove displayed schema
  setRfcPreviewRows([]);    // empty left preview
  setRfcResults([]);        // empty results
  setRfcError('');          // empty errors
  setRfcMsg('');            // Empty success messages
  setRfcFile(null);         // Reset file reference
  
  // Note: the <input type="file"> element in the HTML will keep showing the old file name,
  // but since rfcPreviewRows is empty, the app will behave as if nothing was selected.

        if (rfcFileInputRef.current) {
    rfcFileInputRef.current.value = '';
  }
};
      // Use a safety check to make sure rfcResults is an array
  const displayResults = Array.isArray(rfcResults) 
    ? (() => {
        const rows = [];

        // Aggregate ALL successes into a single row, regardless of the message
        const successCount = rfcResults.filter(r => r && r.status === 'success').length;
        if (successCount > 0) {
          rows.push({ status: 'success', message: 'Executed successfully', count: successCount });
        }

        // ERRORS are shown individually with the full message
        rfcResults.forEach(res => {
          if (!res) return;
          if (res.status !== 'success') {
            rows.push({ status: res.status || 'error', message: res.message || '(empty response)', count: null, rowIndex: res.rowIndex });
          }
        });

        return rows;
      })()
    : [];
  // --- END ADDING ---
  return (
    <>
      <h1>RFC Execution</h1>
      <p>Execute massive RFC commands for SAP user and role management.</p>

      <div style={panelStyle}>
        {rfcError ? <p style={{ color: 'crimson' }}>{rfcError}</p> : null}
        {rfcMsg ? <p style={{ color: 'green' }}>{rfcMsg}</p> : null}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, maxWidth: 1200 }}>
        
        {/* Left: RFC Selection and upload */}
        <div style={panelStyle}>
          <h3>RFC Configuration</h3>
          
          <label style={{ display: 'block', marginBottom: 6 }}>Select RFC Command</label>
          <select 
            value={selectedRfc}
            onChange={(e) => handleRfcSelection(e.target.value)}
            style={{ width: '100%', marginBottom: 12 }}
            disabled={rfcPreviewRows.length > 0} // <--- ADDED TO LOCK THE DROPDOWN AFTER UPLOAD
          >
            <option value="">-- Select RFC --</option>
            {availableRfcs.map(rfc => (
              <option key={rfc.id} value={rfc.id}>{rfc.name}</option>
            ))}
          </select>
          
          {rfcSchema && (
            <div style={{ background: '#f5f5f5', padding: 12, borderRadius: 4, marginBottom: 12 }}>
              <p><strong>Required Fields:</strong> {rfcSchema.requiredFields.join(', ')}</p>
              {rfcSchema.optionalFields.length > 0 && (
                <p><strong>Optional Fields:</strong> {rfcSchema.optionalFields.join(', ')}</p>
              )}
            </div>
          )}
          
          <label style={{ display: 'block', marginBottom: 6 }}>Upload CSV/TSV File</label>
          <input 
            ref={rfcFileInputRef} // Added to reset the input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={handleRfcFileUpload}
            disabled={!selectedRfc}
            style={{ 
            marginBottom: 12,
            width: '100px',        
            overflow: 'hidden',    
            color: 'transparent'   // Makes the remaining text transparent for safety across browsers
            }}
          />
          
          <button
            onClick={executeRfcBatch}
            disabled={!selectedRealm || !selectedRfc || rfcPreviewRows.length === 0 || rfcExecuting}
            style={{
              padding: '8px 12px',
              cursor: 'pointer',
              //gray background (#ccc) if disabled, otherwise green (#4caf50)
              background: (!selectedRealm || !selectedRfc || rfcPreviewRows.length === 0 || rfcExecuting) ? '#ccc' : '#4caf50',
              color: 'white',
              border: 'none',
              borderRadius: '4px'
            }}
          >
            {rfcExecuting ? 'Executing...' : 'Execute RFC Batch'}
          </button>
        </div>
        
        {/* Right: Preview and results */}
        <div style={panelStyle}>
          <h3>Preview & Results</h3>

                  {/* --- ADDED THIS BUTTON --- */}
        <button
          onClick={handleRfcReset}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            background: '#f0f0f0',
            color: '#333',
            border: '1px solid #ccc',
            borderRadius: '4px',
            fontSize: '12px',
            width: '100%',
            marginBottom: 12
          }}
        >
          Input reset
        </button>
        {/* --- END BLOCK ADDED --- */}
          
          {rfcPreviewRows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: '#666', fontSize: 13 }}>
                Rows to execute: {rfcPreviewRows.length} {rfcSchema && rfcSchema.bapi ? `(${rfcSchema.bapi})` : `(${selectedRfc})`}
              </p>
              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                      {Object.keys(rfcPreviewRows[0] || {}).map(key => (
                        <th key={key} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rfcPreviewRows.map((row, idx) => (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? '#fff' : '#f9f9f9' }}>
                        {Object.values(row).map((val, vidx) => (
                          <td key={vidx} style={{ padding: '4px 8px', borderBottom: '1px solid #ddd' }}>
                            {val}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          
          {rfcExecuting && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ background: '#e0e0e0', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  background: '#4caf50',
                  height: 20,
                  width: `${(rfcProgress.current / rfcProgress.total) * 100}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <p style={{ fontSize: 13, color: '#666' }}>
                Executing {rfcProgress.current}/{rfcProgress.total}
              </p>
            </div>
          )}
          
          {displayResults.length > 0 && (
  <div>
    <h4>Results</h4>
    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: '#f0f0f0' }}>
          <th style={{ padding: '4px', textAlign: 'left' }}>Status</th>
          <th style={{ padding: '4px', textAlign: 'left' }}>Message</th>
        </tr>
      </thead>
      <tbody>
        {displayResults.map((res, idx) => (
          <tr key={idx} style={{ background: res.status === 'success' ? '#e8f5e9' : '#ffebee' }}>
            <td style={{ padding: '4px', color: res.status === 'success' ? 'green' : 'crimson', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
              {res.status}
            </td>
            <td style={{ padding: '4px', fontSize: 10 }}>
              {res.status === 'success'
                ? <>{res.message} <span style={{ color: '#888' }}>({res.count})</span></>
                : <>{res.rowIndex != null ? <span style={{ color: '#888', marginRight: 4 }}>[row {res.rowIndex}]</span> : null}{res.message}</>
              }
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)}
        </div>
        
      </div>
    </>
  );
}

  async function importSodTables() {
    setSodImportErr('');
    setSodImportMsg('');
    setSodMissingTables([]);
    setSodImportProgress({ current: 0, total: 0 });

    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.multiple = true;
    input.onchange = async (e) => {
      const allFiles = Array.from(e.target.files || []);
      const txtFiles = allFiles.filter(f => f.name.toLowerCase().endsWith('.txt'));

      if (txtFiles.length === 0) {
        setSodImportErr('No .txt files found in the selected folder');
        return;
      }

      // PHASE 1: pre-validation - reads only the "#sod_table:" header of each file,
      // without writing anything to the DB, to verify that all expected tables are present.
      setSodImportLoading(true);
      try {
        const fileContents = await Promise.all(txtFiles.map(async f => ({
          fileName: f.name,
          txtContent: await f.text()
        })));

        const detectedLogicalNames = new Set();
        for (const fc of fileContents) {
          const firstLine = fc.txtContent.split(/\r?\n/).find(l => l.trim().toLowerCase().startsWith('#sod_table:'));
          if (firstLine) {
            const name = firstLine.split(':')[1]?.trim().toLowerCase();
            if (name) detectedLogicalNames.add(`sod_${name.replace(/^sod_/, '')}`);
          }
        }

        const missingTables = SOD_EXPECTED_TABLES_FRONTEND.filter(t => !detectedLogicalNames.has(t));

        if (missingTables.length > 0) {
          setSodMissingTables(missingTables);
          setSodImportErr('Import aborted: one or more expected tables/files are missing. The database was not modified.');
          setSodImportLoading(false);
          return;
        }

        // PHASE 2: all tables are present, proceed with the actual import file by file.
        setSodImportProgress({ current: 0, total: fileContents.length });

        const importedTables = [];
        const errors = [];

        for (let i = 0; i < fileContents.length; i++) {
          const fc = fileContents[i];
          try {
            const result = await fetchJson('/api/sod/import-tables-txt', {
              method: 'POST',
              body: JSON.stringify({ files: [fc] })
            });
            importedTables.push(...result.importedTables);
            errors.push(...result.errors);
          } catch (fileErr) {
            errors.push({ fileName: fc.fileName, error: fileErr.message });
          }
          setSodImportProgress({ current: i + 1, total: fileContents.length });
        }

        const importedCount = importedTables.length;
        const totalRows = importedTables.reduce((sum, t) => sum + (t.imported || 0), 0);
        let msg = `Imported ${importedCount} table(s), ${totalRows} row(s) total.`;
        if (errors.length > 0) {
          msg += ` ${errors.length} file(s) failed: ${errors.map(e => `${e.fileName} (${e.error})`).join(', ')}`;
        }
        setSodImportMsg(msg);
        loadSodRulesets();
      } catch (err) {
        setSodImportErr(err.message);
      } finally {
        setSodImportLoading(false);
      }
    };
    input.click();

  }

  async function exportSodTables() {
    setSodExportErr('');
    setSodExportMsg('');
    if (!sodRuleset) {
      setSodExportErr('Select a ruleset first');
      return;
    }

    setSodExportLoading(true);
    try {
      const result = await fetchJson('/api/sod/export-tables-txt', {
        method: 'POST',
        body: JSON.stringify({ rulesetId: sodRuleset })
      });

      const files = result.files || [];
      if (files.length === 0) {
        setSodExportErr(`No data found for ruleset "${sodRuleset}"`);
        return;
      }

      if (window.showDirectoryPicker) {
        // File System Access API: writes directly to the chosen folder, overwriting without confirmation prompts
        let dirHandle;
        try {
          dirHandle = await window.showDirectoryPicker();
        } catch (pickerErr) {
          // The user cancelled the folder selection
          return;
        }
        for (const f of files) {
          const fileHandle = await dirHandle.getFileHandle(f.fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(f.content);
          await writable.close();
        }
        setSodExportMsg(`Exported ${files.length} file(s) for ruleset "${sodRuleset}" successfully.`);
      } else {
        // Fallback for browsers without the File System Access API (e.g. Firefox): individual downloads
        files.forEach(f => {
          const blob = new Blob([f.content], { type: 'text/plain' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = f.fileName;
          a.click();
          URL.revokeObjectURL(url);
        });
        setSodExportMsg(`Exported ${files.length} file(s) for ruleset "${sodRuleset}" successfully.`);
      }
    } catch (err) {
      setSodExportErr(err.message);
    } finally {
      setSodExportLoading(false);
    }
  }

  async function deleteSodRulesetAction() {
    setSodDeleteErr('');
    setSodDeleteMsg('');
    if (!sodRuleset) {
      setSodDeleteErr('Select a ruleset first');
      return;
    }

    const confirmed = window.confirm(
      `Are you sure you want to delete all occurrences of ruleset "${sodRuleset}" from every sod_ table? This cannot be undone.`
    );
    if (!confirmed) return;

    setSodDeleteLoading(true);
    try {
      const result = await fetchJson('/api/sod/delete-ruleset', {
        method: 'POST',
        body: JSON.stringify({ rulesetId: sodRuleset })
      });
      setSodDeleteMsg(`Deleted ${result.totalDeleted} row(s) for ruleset "${sodRuleset}" across ${result.deletedByTable.length} table(s).`);
      setSodRuleset('');
      loadSodRulesets();
    } catch (err) {
      setSodDeleteErr(err.message);
    } finally {
      setSodDeleteLoading(false);
    }
  }

  async function deleteAllSodAction() {
    setSodDeleteErr('');
    setSodDeleteMsg('');

    const confirmed = window.confirm(
      'Are you sure you want to delete ALL SOD tables (every table starting with sod_)? This cannot be undone.'
    );
    if (!confirmed) return;

    setSodDeleteLoading(true);
    try {
      const result = await fetchJson('/api/sod/delete-all', {
        method: 'POST'
      });
      setSodDeleteMsg(`Dropped ${result.droppedTables.length} table(s): ${result.droppedTables.join(', ')}`);
      setSodRuleset('');
      setSodRulesets([]);
    } catch (err) {
      setSodDeleteErr(err.message);
    } finally {
      setSodDeleteLoading(false);
    }
  }

  async function addSodElement() {
    setSodAddElementErr('');
    setSodAddElementMsg('');

    if (!sodElementId.trim()) {
      setSodAddElementErr('Enter an Element ID (wildcards % and _ are supported)');
      return;
    }
    if (!selectedRealm) {
      setSodAddElementErr('Select an active SAP realm first');
      return;
    }

    setSodAddElementLoading(true);
    try {
      const result = await fetchJson('/api/sod/add-element', {
        method: 'POST',
        body: JSON.stringify({
          realm: selectedRealm.trim(),
          elementType: sodElementType,
          pattern: sodElementId.trim()
        })
      });
      setSodAddElementMsg(`Added/updated ${result.added} element(s) matching "${sodElementId.trim()}"`);
      loadSodRaElements();
    } catch (err) {
      setSodAddElementErr(err.message);
    } finally {
      setSodAddElementLoading(false);
    }
  }

  async function clearSodElements() {
    setSodClearErr('');
    setSodClearMsg('');

    const confirmed = window.confirm('Are you sure you want to clear all selected elements? This cannot be undone.');
    if (!confirmed) return;

    setSodClearLoading(true);
    try {
      const result = await fetchJson('/api/sod/clear-elements', { method: 'POST' });
      setSodClearMsg(`Cleared ${result.cleared} element(s).`);
      loadSodRaElements();
    } catch (err) {
      setSodClearErr(err.message);
    } finally {
      setSodClearLoading(false);
    }
  }

  async function loadSodRaResults(page = 0) {
    setSodRaResultsPage(page);
    try {
      const offset = page * PAGE_SIZE;
      const data = await fetchJson(`/api/sod/ra-results?limit=${PAGE_SIZE}&offset=${offset}`);
      setSodRaResults(data.rows || []);
      setSodRaResultsTotal(data.total || 0);
    } catch (err) {
      console.error('Failed to load SOD results:', err.message);
    }
  }

  async function exportSodResults() {
    if (sodRaResultsTotal === 0) {
      alert('Nessun risultato da esportare.');
      return;
    }
    try {
      const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
      const url = `${apiBase}/api/sod/ra-results?format=csv`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = `sod_ra_results_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error('Export failed', err);
      alert('Export failed: ' + err.message);
    }
  }

  async function runSodAnalysisAction() {
    setSodAnalysisErr('');
    setSodAnalysisMsg('');
    setSodAnalysisProgress({ current: 0, total: 0, elementId: '' });
    if (!sodRuleset) {
      setSodAnalysisErr('Select a ruleset first');
      return;
    }
    if (!selectedRealm) {
      setSodAnalysisErr('Select an active SAP realm first');
      return;
    }

    setSodAnalysisRunning(true);
    try {
      const realmData = await fetchJson(`/api/sap-realms?realm=${encodeURIComponent(selectedRealm.trim())}`);
      const realmLanguage = realmData?.realm?.sap_language || 'EN';

      const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
      const params = new URLSearchParams({
        realm: selectedRealm.trim(),
        rulesetId: sodRuleset,
        elementType: sodElementType,
        analysisLevel: sodAnalysisLevel,
        realmLanguage
      });
      const evtSource = new EventSource(`${apiBase}/api/sod/run-analysis-stream?${params}`);

      await new Promise((resolve, reject) => {
        evtSource.onmessage = (e) => {
          const msg = JSON.parse(e.data);
          if (msg.type === 'progress') {
            setSodAnalysisProgress({ current: msg.current, total: msg.total, elementId: msg.elementId });
          } else if (msg.type === 'done') {
            setSodAnalysisMsg(`Analysis complete: ${msg.total} result(s) found.`);
            setSodRaResults(msg.rows || []);
            setSodRaResultsTotal(msg.total || 0);
            setSodRaResultsPage(0);
            evtSource.close();
            resolve();
          } else if (msg.type === 'error') {
            evtSource.close();
            reject(new Error(msg.error));
          }
        };
        evtSource.onerror = () => {
          evtSource.close();
          reject(new Error('Connection to analysis stream lost'));
        };
      });
    } catch (err) {
      setSodAnalysisErr(err.message);
    } finally {
      setSodAnalysisRunning(false);
      setSodAnalysisProgress({ current: 0, total: 0, elementId: '' });
    }
  }

  function renderSodSection() {
    const panelStyle = { background: 'white', border: '1px solid #ddd', borderRadius: 8, padding: 24, marginBottom: 24 };
    const labelStyle = { display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 4, color: '#555' };
    const inputStyle = { padding: '6px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13, width: '100%', boxSizing: 'border-box' };
    const btnStyle = (color) => ({ padding: '6px 16px', background: color, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' });

    const handleExportResults = () => {
  // Check that there is data
  if (!sodResults || sodResults.length === 0) {
    alert("Nessun dato da esportare");
    return;
  }

  try {
    // 1. Prepare the CSV content (using tab separator for safety)
    const headers = Object.keys(sodResults[0]);
    const csvRows = [
      headers.join('\t'), // Header
      ...sodResults.map(row => 
        headers.map(fieldName => {
          const val = row[fieldName] ?? '';
          return `"${String(val).replace(/"/g, '""')}"`;
        }).join('\t')
      )
    ].join('\r\n');

    // 2. Create BLOB (file in memory)
    const blob = new Blob(['\uFEFF', csvRows], { type: 'text/csv;charset=utf-8;' });
    
    // 3. Create temporary link and click
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'sod_ra_results.csv');
    
    // Add to document, click and remove
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    // Free memory
    window.URL.revokeObjectURL(url);
    
  } catch (err) {
    console.error("Export error:", err);
    alert("Error while creating the file.");
  }
};

    return (
      <div style={{ maxWidth: 1300 }}>
        <h1>SOD &amp; Audit</h1>
        <p style={{ color: '#666', marginBottom: 24 }}>Segregation of Duties analysis and audit tools.</p>

        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0, maxWidth: 900 }}>
        {/* Rule Matrix */}
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Rule Matrix</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Ruleset</label>
              <select
                value={sodRuleset}
                onChange={e => setSodRuleset(e.target.value)}
                style={{ ...inputStyle, width: '100%' }}
                disabled={sodRulesetsLoading}
              >
                <option value="">{sodRulesetsLoading ? 'Loading...' : '— Select ruleset —'}</option>
                {sodRulesets.map(r => (
                  <option key={r.rulesetId} value={r.rulesetId}>
                    {r.rulesetId} - {r.description}
                  </option>
                ))}
              </select>
            </div>
            <button
              style={btnStyle('#555')}
              onClick={importSodTables}
              disabled={sodImportLoading}
            >{sodImportLoading ? 'Importing...' : 'Import'}</button>
            <button
              style={btnStyle('#1a73e8')}
              onClick={exportSodTables}
              disabled={sodExportLoading || !sodRuleset}
            >{sodExportLoading ? 'Exporting...' : 'Export'}</button>
            <button
              style={btnStyle('#c62828')}
              onClick={deleteSodRulesetAction}
              disabled={sodDeleteLoading || !sodRuleset}
            >Delete Ruleset</button>
            <button
              style={btnStyle('#7b1fa2')}
              onClick={deleteAllSodAction}
              disabled={sodDeleteLoading}
            >Delete SOD (All)</button>
          </div>
          {sodImportLoading && (
            <div style={{ marginTop: 12 }}>
              <div style={{ background: '#eee', borderRadius: 4, overflow: 'hidden', height: 8 }}>
                <div style={{
                  background: '#1a73e8',
                  height: 8,
                  width: `${sodImportProgress.total > 0 ? (sodImportProgress.current / sodImportProgress.total) * 100 : 0}%`,
                  transition: 'width 0.2s ease'
                }} />
              </div>
              <p style={{ fontSize: 12, color: '#666', marginTop: 4, marginBottom: 0 }}>
                Importing file {sodImportProgress.current}/{sodImportProgress.total}
              </p>
            </div>
          )}
          {sodImportMsg && (
            <p style={{ color: 'green', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodImportMsg}</p>
          )}
          {sodImportErr && (
            <p style={{ color: 'crimson', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodImportErr}</p>
          )}
          {sodExportMsg && (
            <p style={{ color: 'green', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodExportMsg}</p>
          )}
          {sodExportErr && (
            <p style={{ color: 'crimson', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodExportErr}</p>
          )}
          {sodDeleteMsg && (
            <p style={{ color: 'green', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodDeleteMsg}</p>
          )}
          {sodDeleteErr && (
            <p style={{ color: 'crimson', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodDeleteErr}</p>
          )}
          {sodMissingTables.length > 0 && (
            <div style={{ marginTop: 12, padding: 10, background: '#fff3e0', border: '1px solid #ffcc80', borderRadius: 4 }}>
              <strong style={{ fontSize: 13, color: '#e65100' }}>Missing tables/files:</strong>
              <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: 12, color: '#e65100' }}>
                {sodMissingTables.map(t => <li key={t}>{t}</li>)}
              </ul>
            </div>
          )}
        </div>

        {/* Analysis Selection and Run */}
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Analysis Selection and Run</h2>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Element Type</label>
              <select
                value={sodElementType}
                onChange={e => setSodElementType(e.target.value)}
                style={{ ...inputStyle }}
              >
                <option value="Users">Users</option>
                <option value="Roles">Roles</option>
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>Element ID</label>
              <input
                type="text"
                value={sodElementId}
                onChange={e => setSodElementId(e.target.value)}
                placeholder="Enter element ID (% and _ wildcards supported)..."
                style={inputStyle}
              />
            </div>
            <button
              style={btnStyle('#2e7d32')}
              onClick={addSodElement}
              disabled={sodAddElementLoading}
            >{sodAddElementLoading ? 'Adding...' : 'Add element'}</button>
          </div>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', marginTop: 16 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Analysis Level</label>
              <select
                value={sodAnalysisLevel}
                onChange={e => setSodAnalysisLevel(e.target.value)}
                style={{ ...inputStyle }}
              >
                <option value="Action">Action</option>
                <option value="Permission">Permission</option>
              </select>
            </div>
            <div style={{ flex: 2, alignSelf: 'center' }}>
              {sodAnalysisRunning && sodAnalysisProgress.total > 0 && (
                <div>
                  <div style={{ background: '#eee', borderRadius: 4, overflow: 'hidden', height: 8 }}>
                    <div style={{
                      background: '#1a73e8',
                      height: 8,
                      width: `${(sodAnalysisProgress.current / sodAnalysisProgress.total) * 100}%`,
                      transition: 'width 0.2s ease'
                    }} />
                  </div>
                  <p style={{ fontSize: 11, color: '#666', margin: '4px 0 0', textAlign: 'center' }}>
                    {sodAnalysisProgress.current}/{sodAnalysisProgress.total} — {sodAnalysisProgress.elementId}
                  </p>
                </div>
              )}
            </div>
            <button
              style={btnStyle('#1a73e8')}
              onClick={runSodAnalysisAction}
              disabled={sodAnalysisRunning}
            >{sodAnalysisRunning ? 'Running...' : 'Run Analysis'}</button>
          </div>
          {sodAddElementMsg && (
            <p style={{ color: 'green', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodAddElementMsg}</p>
          )}
          {sodAddElementErr && (
            <p style={{ color: 'crimson', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodAddElementErr}</p>
          )}
          {sodAnalysisMsg && (
            <p style={{ color: 'green', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodAnalysisMsg}</p>
          )}
          {sodAnalysisErr && (
            <p style={{ color: 'crimson', fontSize: 13, marginTop: 12, marginBottom: 0 }}>{sodAnalysisErr}</p>
          )}
        </div>

        {/* Results Preview & Export */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Results Preview &amp; Export</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                style={btnStyle('#555')}
                onClick={() => loadSodRaResults(0)}
              >Refresh</button>
              <button
                style={btnStyle('#2e7d32')}
                onClick={exportSodResults}
                disabled={sodRaResultsTotal === 0}
              >Export results</button>
            </div>
          </div>
          {sodAnalysisRunning ? (
            <p style={{ color: '#888', fontSize: 13 }}>Running analysis...</p>
          ) : sodRaResults.length > 0 ? (
            <>
              <div style={{ overflowX: 'auto', maxHeight: 340, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f5f5f5' }}>
                      {Object.keys(sodRaResults[0]).map(k => (
                        <th key={k} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid #ddd', whiteSpace: 'nowrap' }}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sodRaResults.map((row, i) => (
                      <tr key={i} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        {Object.values(row).map((v, j) => (
                          <td key={j} style={{ padding: '4px 8px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{v === null || v === undefined ? '' : String(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: '#666', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Showing {sodRaResultsPage * PAGE_SIZE + 1}-{Math.min((sodRaResultsPage + 1) * PAGE_SIZE, sodRaResultsTotal)} of {sodRaResultsTotal}</span>
                <span>
                  <button onClick={() => loadSodRaResults(0)} disabled={sodRaResultsPage === 0} style={{ marginRight: 4 }}>First</button>
                  <button onClick={() => loadSodRaResults(sodRaResultsPage - 1)} disabled={sodRaResultsPage === 0} style={{ marginRight: 4 }}>Prev</button>
                  <button onClick={() => loadSodRaResults(sodRaResultsPage + 1)} disabled={sodRaResultsPage >= Math.ceil(sodRaResultsTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                  <button onClick={() => loadSodRaResults(Math.ceil(sodRaResultsTotal / PAGE_SIZE) - 1)} disabled={sodRaResultsPage >= Math.ceil(sodRaResultsTotal / PAGE_SIZE) - 1}>Last</button>
                </span>
              </div>
            </>
          ) : (
            <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No results to display. Run the analysis to see results.</p>
          )}
        </div>
          </div>

          {/* Selected elements - right column */}
          <div style={{ flex: '0 0 340px' }}>
            <div style={panelStyle}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h2 style={{ margin: 0, fontSize: 16 }}>Selected elements</h2>
                <button
                  style={btnStyle('#c62828')}
                  onClick={clearSodElements}
                  disabled={sodClearLoading || sodRaElementsTotal === 0}
                >Clear elements</button>
              </div>
              {sodClearMsg && (
                <p style={{ color: 'green', fontSize: 12, marginBottom: 8 }}>{sodClearMsg}</p>
              )}
              {sodClearErr && (
                <p style={{ color: 'crimson', fontSize: 12, marginBottom: 8 }}>{sodClearErr}</p>
              )}
              {sodRaElementsLoading ? (
                <p style={{ color: '#888', fontSize: 13 }}>Loading...</p>
              ) : sodRaElements.length > 0 ? (
                <>
                  <div style={{ overflowX: 'auto', maxHeight: 440, overflowY: 'auto' }}>
                    <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: '#f5f5f5' }}>
                          <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Type</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Element ID</th>
                          <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #ddd' }}>Description</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sodRaElements.map((el, i) => (
                          <tr key={el.elementid} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                            <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{el.elementtype}</td>
                            <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee', whiteSpace: 'nowrap' }}>{el.elementid}</td>
                            <td style={{ padding: '5px 8px', borderBottom: '1px solid #eee' }}>{el.elementdescription}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 11, color: '#666', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>
                      Showing {sodRaElementsPage * PAGE_SIZE + 1}-{Math.min((sodRaElementsPage + 1) * PAGE_SIZE, sodRaElementsTotal)} of {sodRaElementsTotal}
                    </span>
                    <span>
                      <button onClick={() => loadSodRaElements(0)} disabled={sodRaElementsPage === 0} style={{ marginRight: 4 }}>First</button>
                      <button onClick={() => loadSodRaElements(sodRaElementsPage - 1)} disabled={sodRaElementsPage === 0} style={{ marginRight: 4 }}>Prev</button>
                      <button onClick={() => loadSodRaElements(sodRaElementsPage + 1)} disabled={sodRaElementsPage >= Math.ceil(sodRaElementsTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                      <button onClick={() => loadSodRaElements(Math.ceil(sodRaElementsTotal / PAGE_SIZE) - 1)} disabled={sodRaElementsPage >= Math.ceil(sodRaElementsTotal / PAGE_SIZE) - 1}>Last</button>
                    </span>
                  </div>
                </>
              ) : (
                <p style={{ color: '#aaa', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>No elements selected yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={layoutStyle}>
      <aside style={{ ...sideNavStyle, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <div>
              {/* Aggiungi il banner qui */}
    <div style={{ marginBottom: '16px', textAlign: 'center' }}>
      <img 
        src={brandBanner}
        alt="Brand Banner" 
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
          <h3>Sections</h3>
          <div style={{ display: 'grid', gap: 8 }}>
            <button style={{ padding: '8px 12px', cursor: 'pointer', textAlign: 'left', background: section === 'health' ? '#eee' : 'transparent', border: '1px solid #ccc' }} onClick={() => setSection('health')}>Health Checks</button>
            <button style={{ padding: '8px 12px', cursor: 'pointer', textAlign: 'left', background: section === 'sap-realms' ? '#eee' : 'transparent', border: '1px solid #ccc' }} onClick={() => setSection('sap-realms')}>SAP Realms</button>
            <button style={{ padding: '8px 12px', cursor: 'pointer', textAlign: 'left', background: section === 'sap-import' ? '#eee' : 'transparent', border: '1px solid #ccc' }} disabled={!selectedRealm} onClick={() => setSection('sap-import')}>Import SAP Tables</button>
            <button style={{ padding: '8px 12px', cursor: 'pointer', textAlign: 'left', background: section === 'reports' ? '#eee' : 'transparent', border: '1px solid #ccc' }} disabled={!selectedRealm} onClick={() => setSection('reports')}>Reports</button>
            <button style={{ padding: '8px 12px', cursor: 'pointer', textAlign: 'left', background: section === 'rfc' ? '#eee' : 'transparent', border: '1px solid #ccc' }} disabled={!selectedRealm} onClick={() => setSection('rfc')}>RFC Execution</button>
            <button style={{ padding: '8px 12px', cursor: 'pointer', textAlign: 'left', background: section === 'sod' ? '#eee' : 'transparent', border: '1px solid #ccc' }} disabled={!selectedRealm} onClick={() => setSection('sod')}>SOD & Audit</button>
          </div>
        </div>
        
        <div style={{ padding: '12px', borderTop: '1px solid #ddd', fontSize: '14px' }}>
          <div style={{ marginBottom: '8px' }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '4px' }}>Active SAP Realm:</label>
            <div style={{ padding: '4px 8px', background: '#f5f5f5', border: '1px solid #ddd', borderRadius: '4px' }}>
              {selectedRealm || <span style={{ color: '#999' }}>None selected</span>}
            </div>
          </div>
          <div style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
            {selectedRealm ? (
              <span>Manage realms in <strong>SAP Realms</strong> section</span>
            ) : (
              <span>Go to <strong>SAP Realms</strong> to configure</span>
            )}
          </div>
        </div>
      </aside>

      <section style={contentStyle}>
        {section === 'health' ? renderHealthSection() : null}
        {section === 'sap-realms' ? renderRealmSection() : null}
        {section === 'sap-import' ? renderImportSection() : null}
        {section === 'reports' ? renderReportsSection() : null}
        {section === 'rfc' ? renderRfcSection() : null}
        {section === 'sod' ? renderSodSection() : null}
      </section>
    </main>
  );
}
