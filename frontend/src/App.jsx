import { useState, useEffect, useRef } from 'react';
import { fetchJson, API_BASE } from './api.js';
import { PAGE_SIZE } from './constants.js';
import brandBanner from '../assets/brand/zsectools-banner-v2.png';
import SettingsSection from './sections/SettingsSection.jsx';
import RealmSection from './sections/RealmSection.jsx';
import ReportsSection from './sections/ReportsSection.jsx';
import ImportSection from './sections/ImportSection.jsx';
import RfcSection from './sections/RfcSection.jsx';
import SodSection from './sections/SodSection.jsx';
import CoverageSection from './sections/CoverageSection.jsx';
import MapperSection from './sections/MapperSection.jsx';

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
  height: '100vh',
  display: 'grid',
  gridTemplateColumns: '220px 1fr',
  overflow: 'hidden'
};

const sideNavStyle = {
  borderRight: '1px solid #ddd',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  boxSizing: 'border-box'
};

const contentStyle = {
  padding: '1.5rem 2rem',
  height: '100vh',
  overflowY: 'auto',
  boxSizing: 'border-box'
};

const allowedPeriodTypes = ['M', 'D', 'W'];

export default function App() {
  const [section, setSection] = useState('sap-realms');
  const [selectedRealm, setSelectedRealm] = useState('');
  const [settingsTab, setSettingsTab] = useState('general'); // 'general' | 'health'
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
  const [sodIncludeInvalid, setSodIncludeInvalid] = useState(false);
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
  const sodElementsFileInputRef = useRef(null);
  const [sodImportElementsLoading, setSodImportElementsLoading] = useState(false);

  // Coverage section state
  const [covUserPattern, setCovUserPattern] = useState('');
  const [covUserLoading, setCovUserLoading] = useState(false);
  const [covUserMsg, setCovUserMsg] = useState('');
  const [covUserErr, setCovUserErr] = useState('');
  const [covUsers, setCovUsers] = useState([]);
  const [covUsersTotal, setCovUsersTotal] = useState(0);
  const [covUserDetail, setCovUserDetail] = useState([]);
  const [covUserDetailFor, setCovUserDetailFor] = useState('');
  const [covStatLoading, setCovStatLoading] = useState(false);

  const [covRoles, setCovRoles] = useState([]);
  const [covRolesTotal, setCovRolesTotal] = useState(0);
  const [covRolesLoading, setCovRolesLoading] = useState(false);
  const [covRolesMsg, setCovRolesMsg] = useState('');
  const [covRolesErr, setCovRolesErr] = useState('');
  const [covRoleDetail, setCovRoleDetail] = useState([]);
  const [covRoleDetailFor, setCovRoleDetailFor] = useState('');

  const [covRunLoading, setCovRunLoading] = useState(false);
  const [covRunMsg, setCovRunMsg] = useState('');
  const [covRunErr, setCovRunErr] = useState('');
  const [covResults, setCovResults] = useState([]);
  const [covResultsTotal, setCovResultsTotal] = useState(0);
  const [covResultsPage, setCovResultsPage] = useState(0);
  const covUsersFileRef = useRef(null);
  const covRolesFileRef = useRef(null);

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

  //states for update check:
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState('');

  // Mapper section state
  const [mapElementPattern, setMapElementPattern] = useState('');
  const [mapElementLoading, setMapElementLoading] = useState(false);
  const [mapElementMsg, setMapElementMsg] = useState('');
  const [mapElementErr, setMapElementErr] = useState('');
  const [mapElements, setMapElements] = useState([]);
  const [mapElementsTotal, setMapElementsTotal] = useState(0);
  const [mapElementsSelected, setMapElementsSelected] = useState(new Set());
  const [mapElementDetail, setMapElementDetail] = useState([]);
  const [mapElementDetailFor, setMapElementDetailFor] = useState('');
  const [mapStatLoading, setMapStatLoading] = useState(false);

  const [mapRolePattern, setMapRolePattern] = useState('');
  const [mapRoleLoading, setMapRoleLoading] = useState(false);
  const [mapRoleMsg, setMapRoleMsg] = useState('');
  const [mapRoleErr, setMapRoleErr] = useState('');
  const [mapRoles, setMapRoles] = useState([]);
  const [mapRolesTotal, setMapRolesTotal] = useState(0);
  const [mapRolesSelected, setMapRolesSelected] = useState(new Set());
  const [mapRoleDetail, setMapRoleDetail] = useState([]);
  const [mapRoleDetailFor, setMapRoleDetailFor] = useState('');

  const [mapCalculateExtra, setMapCalculateExtra] = useState(true);
  const [mapRunLoading, setMapRunLoading] = useState(false);
  const [mapRunMsg, setMapRunMsg] = useState('');
  const [mapRunErr, setMapRunErr] = useState('');
  const [mapResults, setMapResults] = useState([]);
  const [mapResultsTotal, setMapResultsTotal] = useState(0);
  const [mapResultsPage, setMapResultsPage] = useState(0);

  const mapElementsFileRef = useRef(null);
  const mapRolesFileRef = useRef(null);

  function navBtnStyle(active) {
    return {
      padding: sidebarCollapsed ? '8px 0' : '8px 12px',
      cursor: 'pointer',
      textAlign: 'left',
      background: active ? '#eee' : 'transparent',
      border: '1px solid #ccc',
      display: 'flex',
      alignItems: 'center',
      justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
      gap: 8
    };
  }

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
    else if (section === 'coverage') {
      covLoadResults(0);
      covLoadRoles();
      covLoadUsers();
    }
    else if (section === 'sap-realms') {
      loadRealmList();
    }
    else if (section === 'mapper') {
      mapLoadElements();
      mapLoadRoles();
      mapLoadResults(0);
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

  const loadSdkPath = async () => {
    setSdkPathError('');
    setSdkPathInfo('');
    try {
        const data = await fetchJson('/api/settings/sap-sdk-path');

        if (data && data.sapnwrfcHome) {
          setSdkPath(data.sapnwrfcHome);
          setSdkPathInfo('SDK path successfully loaded from backend .env environment variable.');
        } else {
          setSdkPath('');
          setSdkPathError('SAPNWRFC_HOME variable is not defined in the backend .env file.');
        }
      } catch (err) {
        console.error(err);
        setSdkPathError('Failed to load SDK path from backend environment.');
      }
  };

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

  const checkForUpdates = async () => {
    setUpdateLoading(true);
    setUpdateError('');
    setUpdateInfo(null);
    try {
      const data = await fetchJson('/api/settings/check-update');
      if (data && data.ok) {
        setUpdateInfo(data);
      } else {
        setUpdateError(data?.error || 'Could not verify updates.');
      }
    } catch (err) {
      console.error(err);
      setUpdateError('Failed to contact backend for update check.');
    } finally {
      setUpdateLoading(false);
    }
  };

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
    //const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
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
        setRfcError(`Schema mismatch: Mandatory columns are missing: ${missing.join(', ')}`);
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
    //fix #32
    const errors = [];
    let successCount = 0;

    try {
      if (typeof window.showDirectoryPicker === 'function') {
        const dirHandle = await window.showDirectoryPicker();

        for (const tableName of selectedTables) {
          try {
            const response = await fetch(`${API_BASE}/api/export-sap/tables-txt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ realm: selectedRealm.trim(), tables: [tableName] })
            });

            if (!response.ok) {
              const text = await response.text();
              let errorMessage = `Failed to export ${tableName}`;
              try {
                const errJson = JSON.parse(text);
                errorMessage = errJson.error || errorMessage;
              } catch (e) {
                errorMessage = text || errorMessage;
              }
              // Save error. Next item.
              errors.push(`${tableName}: ${errorMessage}`);
              continue;
            }

            const blob = await response.blob();
            const fileName = `sap_table_${tableName}_${selectedRealm.trim()}_${new Date().toISOString().split('T')[0]}.txt`;
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            successCount++;
          } catch (singleErr) {
            errors.push(`${tableName}: ${singleErr.message}`);
          }
        }
      } else {
        // Fallback for standard download
        for (const tableName of selectedTables) {
          try {
            const response = await fetch(`${API_BASE}/api/export-sap/tables-txt`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ realm: selectedRealm.trim(), tables: [tableName] })
            });

            if (!response.ok) {
              const text = await response.text();
              let errorMessage = `Failed to export ${tableName}`;
              try {
                const errJson = JSON.parse(text);
                errorMessage = errJson.error || errorMessage;
              } catch (e) {
                errorMessage = text || errorMessage;
              }
              errors.push(`${tableName}: ${errorMessage}`);
              continue;
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            const defaultFilename = `sap_table_${tableName}_${selectedRealm.trim()}_${new Date().toISOString().split('T')[0]}.txt`;
            a.download = defaultFilename;
            a.click();
            window.URL.revokeObjectURL(url);
            await new Promise(resolve => setTimeout(resolve, 100));
            successCount++;
          } catch (singleErr) {
            errors.push(`${tableName}: ${singleErr.message}`);
          }
        }
      }

      // Results
      if (successCount > 0) {
        setImportMsg(`Exported ${successCount} of ${selectedTables.length} table(s) successfully.`);
      }
      if (errors.length > 0) {
        setImportErr(`Some tables failed:\n` + errors.join('\n'));
      }

    } catch (err) {
      // catch general errors (eg. void selected folder)
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
      //const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
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
      const url = `${API_BASE}/api/reports/export-csv?realm=${encodeURIComponent(selectedRealm.trim())}&tableName=${encodeURIComponent(reportTableName)}`;
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
          pattern: sodElementId.trim(),
          includeInvalid: sodIncludeInvalid
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

  async function handleSodElementsFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSodAddElementErr('');
    setSodAddElementMsg('');
    setSodImportElementsLoading(true);
    try {
      const txtContent = await file.text();
      const result = await fetchJson('/api/sod/import-ra-elements-txt', {
        method: 'POST',
        body: JSON.stringify({
          realm: selectedRealm.trim(),
          txtContent,
          includeInvalid: sodIncludeInvalid
        })
      });
      setSodAddElementMsg(`Imported ${result.imported} element(s) from file: ${file.name}`);
      loadSodRaElements();
    } catch (err) {
      setSodAddElementErr(err.message);
    } finally {
      setSodImportElementsLoading(false);
      e.target.value = ''; // reset per poter ricaricare lo stesso file
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
      alert('No data to export.');
      return;
    }
    try {
      const url = `${API_BASE}/api/sod/ra-results?format=csv`;
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

      const params = new URLSearchParams({
        realm: selectedRealm.trim(),
        rulesetId: sodRuleset,
        elementType: sodElementType,
        analysisLevel: sodAnalysisLevel,
        realmLanguage
      });
      const evtSource = new EventSource(`${API_BASE}/api/sod/run-analysis-stream?${params}`);

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

  // ── COVERAGE FUNCTIONS ────────────────────────────────────────────────────

  async function covLoadUsers() {
    try {
      const data = await fetchJson(`/api/coverage/users?limit=200&offset=0`);
      setCovUsers(data.rows || []);
      setCovUsersTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }

  async function covLoadRoles() {
    try {
      const data = await fetchJson(`/api/coverage/roles?limit=200&offset=0`);
      setCovRoles(data.rows || []);
      setCovRolesTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }

  async function covLoadResults(page = 0) {
    setCovResultsPage(page);
    try {
      const data = await fetchJson(`/api/coverage/results?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
      setCovResults(data.rows || []);
      setCovResultsTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }

  async function covAddUser() {
    setCovUserErr(''); setCovUserMsg('');
    if (!covUserPattern.trim()) { setCovUserErr('Enter a user pattern'); return; }
    setCovUserLoading(true);
    try {
      const r = await fetchJson('/api/coverage/add-user', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim(), pattern: covUserPattern.trim() }) });
      setCovUserMsg(`Added ${r.added} user(s)`);
      covLoadUsers();
    } catch (e) { setCovUserErr(e.message); }
    finally { setCovUserLoading(false); }
  }

  async function covClearUsers() {
    if (!window.confirm('Clear all coverage users?')) return;
    await fetchJson('/api/coverage/clear', { method: 'POST', body: JSON.stringify({ target: 'users' }) });
    setCovUsers([]); setCovUsersTotal(0);
    setCovUserDetail([]); setCovUserDetailFor('');
    setCovUserMsg('Users cleared.');
  }

  function covHandleUsersFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return;
      const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(l => {
        const vals = l.split('\t');
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
      });
      setCovUserLoading(true);
      try {
        const r = await fetchJson('/api/coverage/import-users-tsv', { method: 'POST', body: JSON.stringify({ rows }) });
        setCovUserMsg(`Imported ${r.inserted} row(s) from file`);
        covLoadUsers();
      } catch (ex) { setCovUserErr(ex.message); }
      finally { setCovUserLoading(false); if (covUsersFileRef.current) covUsersFileRef.current.value = ''; }
    };
    reader.readAsText(file);
  }

  async function covExportUsers() {
    if (!covUsers || covUsers.length === 0) { alert('No data to export.'); return; }
    try {
      const url = `${API_BASE}/api/coverage/users?format=csv`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = `cov_users.csv`; a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) { console.error('Export failed', err); alert('Export failed: ' + err.message); }
  }

  async function covBuildUserStats() {
    setCovUserErr(''); setCovUserMsg('');
    if (!selectedRealm) { setCovUserErr('Select an active SAP realm first'); return; }
    setCovStatLoading(true);
    try {
      const r = await fetchJson('/api/coverage/build-user-tcodes', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim() }) });
      setCovUserMsg(`Loaded ${r.inserted} transaction usage row(s)`);
    } catch (e) { setCovUserErr(e.message); }
    finally { setCovStatLoading(false); }
  }

  async function covShowUserDetail(userid) {
    setCovRoleDetailFor('');   // mutually exclusive with roles view
    setCovUserDetailFor(userid);
    try {
      const data = await fetchJson(`/api/coverage/users/${encodeURIComponent(userid)}/tcodes`);
      setCovUserDetail(data.rows || []);
    } catch (e) { console.error(e); }
  }

  async function covExportRoles() {
    if (!covRoles || covRoles.length === 0) { alert('No data to export.'); return; }
    try {
      const url = `${API_BASE}/api/coverage/roles?format=csv`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = `cov_roles.csv`; a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) { console.error('Export failed', err); alert('Export failed: ' + err.message); }
  }

  function covHandleRolesFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return;
      const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(l => {
        const vals = l.split('\t');
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
      });
      setCovRolesLoading(true);
      try {
        const r = await fetchJson('/api/coverage/import-roles-tsv', { method: 'POST', body: JSON.stringify({ rows }) });
        setCovRolesMsg(`Imported ${r.inserted} row(s) from file`);
        covLoadRoles();
      } catch (ex) { setCovRolesErr(ex.message); }
      finally { setCovRolesLoading(false); if (covRolesFileRef.current) covRolesFileRef.current.value = ''; }
    };
    reader.readAsText(file);
  }

  async function covLoadRolesFromDb() {
    setCovRolesErr(''); setCovRolesMsg('');
    setCovRolesLoading(true);
    try {
      const r = await fetchJson('/api/coverage/load-roles-from-db', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim() }) });
      setCovRolesMsg(`Loaded ${r.inserted} role assignment(s) from DB`);
      covLoadRoles();
    } catch (e) { setCovRolesErr(e.message); }
    finally { setCovRolesLoading(false); }
  }

  async function covClearRoles() {
    if (!window.confirm('Clear all coverage roles?')) return;
    await fetchJson('/api/coverage/clear', { method: 'POST', body: JSON.stringify({ target: 'roles' }) });
    setCovRoles([]); setCovRolesTotal(0);
    setCovRoleDetail([]); setCovRoleDetailFor('');
    setCovRolesMsg('Roles cleared.');
  }

  async function covShowRoleDetail(agrName) {
    setCovUserDetailFor('');   // mutually exclusive with user view
    setCovRoleDetailFor(agrName);
    try {
      const data = await fetchJson(`/api/coverage/roles/${encodeURIComponent(agrName)}/tcodes`);
      setCovRoleDetail(data.rows || []);
    } catch (e) { console.error(e); }
  }

  async function covRun() {
    setCovRunErr(''); setCovRunMsg('');
    if (!selectedRealm) { setCovRunErr('Select an active SAP realm first'); return; }
    setCovRunLoading(true);
    try {
      const r = await fetchJson('/api/coverage/run', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim() }) });
      setCovRunMsg(`Analysis complete: ${r.total} result(s)`);
      setCovResults(r.rows || []);
      setCovResultsTotal(r.total || 0);
      setCovResultsPage(0);
    } catch (e) { setCovRunErr(e.message); }
    finally { setCovRunLoading(false); }
  }

  async function covExportResults() {
    if (!covResultsTotal) return;
    const resp = await fetch(`${API_BASE}/api/coverage/results/export-csv`);
    if (!resp.ok) { alert('Export failed'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `coverage_results_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ── MAPPER FUNCTIONS ────────────────────────────────────────────────────────

  async function mapLoadElements() {
    try {
      const data = await fetchJson(`/api/mapper/elements?limit=200&offset=0`);
      setMapElements(data.rows || []);
      setMapElementsTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }

  async function mapLoadRoles() {
    try {
      const data = await fetchJson(`/api/mapper/roles?limit=200&offset=0`);
      setMapRoles(data.rows || []);
      setMapRolesTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }

  async function mapLoadResults(page = 0) {
    setMapResultsPage(page);
    try {
      const data = await fetchJson(`/api/mapper/results?limit=${PAGE_SIZE}&offset=${page * PAGE_SIZE}`);
      setMapResults(data.rows || []);
      setMapResultsTotal(data.total || 0);
    } catch (e) { console.error(e); }
  }

  async function mapAddElement() {
    setMapElementErr(''); setMapElementMsg('');
    if (!mapElementPattern.trim()) { setMapElementErr('Enter an element pattern'); return; }
    setMapElementLoading(true);
    try {
      const r = await fetchJson('/api/mapper/add-element', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim(), pattern: mapElementPattern.trim() }) });
      setMapElementMsg(`Added ${r.added} element(s)`);
      mapLoadElements();
    } catch (e) { setMapElementErr(e.message); }
    finally { setMapElementLoading(false); }
  }

  async function mapClearElements() {
    if (!window.confirm('Clear all elements to map?')) return;
    await fetchJson('/api/mapper/clear', { method: 'POST', body: JSON.stringify({ target: 'elements' }) });
    setMapElements([]); setMapElementsTotal(0); setMapElementsSelected(new Set());
    setMapElementDetail([]); setMapElementDetailFor('');
    setMapElementMsg('Elements cleared.');
  }

  async function mapClearResults() {
    if (!window.confirm('Clear mapper results?')) return;
    await fetchJson('/api/mapper/clear', { method: 'POST', body: JSON.stringify({ target: 'results' }) });
    setMapResults([]); setMapResultsTotal(0); setMapResultsPage(0);
    setMapRunMsg(`Results cleared`);
  }

  function mapHandleElementsFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return;
      const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(l => {
        const vals = l.split('\t');
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
      });
      setMapElementLoading(true);
      try {
        const r = await fetchJson('/api/mapper/elements/import-tsv', { method: 'POST', body: JSON.stringify({ rows }) });
        setMapElementMsg(`Imported ${r.inserted} row(s) from file`);
        mapLoadElements();
      } catch (ex) { setMapElementErr(ex.message); }
      finally { setMapElementLoading(false); if (mapElementsFileRef.current) mapElementsFileRef.current.value = ''; }
    };
    reader.readAsText(file);
  }

  async function mapExportElements() {
    if (!mapElements.length) { alert('No data to export.'); return; }
    try {
      const url = `${API_BASE}/api/mapper/elements?format=csv`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = `map_elements.csv`; a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) { console.error('Export failed', err); alert('Export failed: ' + err.message); }
  }

  async function mapRemoveSelectedElements() {
    if (!mapElementsSelected.size) { alert('Select at least one element to remove'); return; }
    await fetchJson('/api/mapper/elements/remove', { method: 'POST', body: JSON.stringify({ elementIds: Array.from(mapElementsSelected) }) });
    setMapElementsSelected(new Set());
    setMapElementDetail([]); setMapElementDetailFor('');
    mapLoadElements();
  }

  async function mapShowElementDetail(elementid) {
    setMapRoleDetailFor('');   // closing view "role":drill-down show last selection
    setMapElementDetailFor(elementid);
    try {
      const data = await fetchJson(`/api/mapper/elements/${encodeURIComponent(elementid)}/tcodes`);
      setMapElementDetail(data.rows || []);
    } catch (e) { console.error(e); }
  }

  async function mapBuildElementStats() {
    setMapElementErr(''); setMapElementMsg('');
    if (!selectedRealm) { setMapElementErr('Select an active SAP realm first'); return; }
    setMapStatLoading(true);
    try {
      const r = await fetchJson('/api/mapper/build-element-tcodes', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim() }) });
      setMapElementMsg(`Loaded ${r.inserted} transaction usage row(s)`);
    } catch (e) { setMapElementErr(e.message); }
    finally { setMapStatLoading(false); }
  }

  async function mapAddRole() {
    setMapRoleErr(''); setMapRoleMsg('');
    if (!mapRolePattern.trim()) { setMapRoleErr('Enter a role pattern'); return; }
    setMapRoleLoading(true);
    try {
      const r = await fetchJson('/api/mapper/add-role', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim(), pattern: mapRolePattern.trim() }) });
      setMapRoleMsg(`Added ${r.added} role(s)`);
      mapLoadRoles();
    } catch (e) { setMapRoleErr(e.message); }
    finally { setMapRoleLoading(false); }
  }

  async function mapClearRoles() {
    if (!window.confirm('Clear all mapping roles?')) return;
    await fetchJson('/api/mapper/clear', { method: 'POST', body: JSON.stringify({ target: 'roles' }) });
    setMapRoles([]); setMapRolesTotal(0); setMapRolesSelected(new Set());
    setMapRoleDetail([]); setMapRoleDetailFor('');
    setMapRoleMsg('Roles cleared.');
  }

  function mapHandleRolesFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const lines = ev.target.result.split(/\r?\n/).filter(l => l.trim());
      if (!lines.length) return;
      const headers = lines[0].split('\t').map(h => h.trim().toLowerCase());
      const rows = lines.slice(1).map(l => {
        const vals = l.split('\t');
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
      });
      setMapRoleLoading(true);
      try {
        const r = await fetchJson('/api/mapper/roles/import-tsv', { method: 'POST', body: JSON.stringify({ rows }) });
        setMapRoleMsg(`Imported ${r.inserted} row(s) from file`);
        mapLoadRoles();
      } catch (ex) { setMapRoleErr(ex.message); }
      finally { setMapRoleLoading(false); if (mapRolesFileRef.current) mapRolesFileRef.current.value = ''; }
    };
    reader.readAsText(file);
  }

  async function mapExportRoles() {
    if (!mapRoles.length) { alert('No data to export.'); return; }
    try {
      const url = `${API_BASE}/api/mapper/roles?format=csv`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Export failed: ${response.statusText}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl; a.download = `map_roles.csv`; a.click();
      URL.revokeObjectURL(objectUrl);
    } catch (err) { console.error('Export failed', err); alert('Export failed: ' + err.message); }
  }

  async function mapLoadRoleTcodesFromDb() {
    setMapRoleErr(''); setMapRoleMsg('');
    if (!selectedRealm) { setMapRoleErr('Select an active SAP realm first'); return; }
    setMapRoleLoading(true);
    try {
      const r = await fetchJson('/api/mapper/roles/load-tcodes-from-db', { method: 'POST', body: JSON.stringify({ realm: selectedRealm.trim() }) });
      setMapRoleMsg(`Loaded ${r.inserted} role/tcode row(s) from DB`);
    } catch (e) { setMapRoleErr(e.message); }
    finally { setMapRoleLoading(false); }
  }

  async function mapRemoveSelectedRoles() {
    if (!mapRolesSelected.size) { alert('Select at least one role to remove'); return; }
    await fetchJson('/api/mapper/roles/remove', { method: 'POST', body: JSON.stringify({ agrNames: Array.from(mapRolesSelected) }) });
    setMapRolesSelected(new Set());
    setMapRoleDetail([]); setMapRoleDetailFor('');
    mapLoadRoles();
  }

  async function mapShowRoleDetail(agrName) {
    setMapElementDetailFor('');   // closing view "element":drill-down show last selection
    setMapRoleDetailFor(agrName);
    try {
      const data = await fetchJson(`/api/mapper/roles/${encodeURIComponent(agrName)}/tcodes`);
      setMapRoleDetail(data.rows || []);
    } catch (e) { console.error(e); }
  }

  async function mapRun() {
    setMapRunErr(''); setMapRunMsg('');
    if (!window.confirm("This will overwrite previous mapping results. Proceed?")) return;
    setMapRunLoading(true);
    try {
      const r = await fetchJson('/api/mapper/run', { method: 'POST', body: JSON.stringify({ calculateExtra: mapCalculateExtra }) });
      setMapRunMsg(`Mapping complete: ${r.total} result(s)`);
      setMapResults(r.rows || []);
      setMapResultsTotal(r.total || 0);
      setMapResultsPage(0);
    } catch (e) { setMapRunErr(e.message); }
    finally { setMapRunLoading(false); }
  }

  async function mapExportResults() {
    if (!mapResultsTotal) return;
    const resp = await fetch(`${API_BASE}/api/mapper/results/export-csv`);
    if (!resp.ok) { alert('Export failed'); return; }
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `mapper_results_${new Date().toISOString().split('T')[0]}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function mapToggleSelected(setFn, set, key) {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    setFn(next);
  }

  // ── contesti per le sezioni: dipendenze esplicite di ciascuna vista ──
  const settingsCtx = {
    appHealth, checkForUpdates, dbHealth, errors,
    loadSdkPath, runCheck, runSapCheck, runSdkDiagnostics,
    sapHealth, sdkDiag, sdkDiagError, sdkPath,
    sdkPathError, sdkPathInfo, selectedRealm, setAppHealth,
    setDbHealth, setSettingsTab, settingsTab, updateError,
    updateInfo, updateLoading
  };

  const realmCtx = {
    errors, form, loadRealm, loadRealmList,
    realms, runSapCheck, sapHealth, sapRealmError,
    sapRealmInfo, saveRealm, selectedRealm, setSapRealmError,
    setSapRealmInfo, setSelectedRealm, updateForm
  };

  const reportsCtx = {
    executeReport, exportReport, loadReportRows, reportDays,
    reportError, reportHeaders, reportPage, reportPattern,
    reportRows, reportTotal, selectedRealm, selectedReport,
    setReportDays, setReportError, setReportHeaders, setReportPage,
    setReportPattern, setReportRows, setReportTableName, setReportTotal,
    setSelectedReport
  };

  const importCtx = {
    aggregatedStats, availableTables, buildAdditionalInfos, deleteSelectedStatsBatch,
    displayError, displayPage, displayRows, displayTableName,
    displayTotal, exportLoading, exportStatisticsTxt, exportTablesTxt,
    importErr, importLoading, importMsg, importProgress,
    importStatistics, importStatisticsTxt, importTables, importTablesTxt,
    importTxtLoading, loadAggregatedStats, loadImportedTableRows, selectedRealm,
    selectedStatsBatch, selectedTables, setDisplayPage, setDisplayRows,
    setDisplayTableName, setDisplayTotal, setSelectedStatsBatch, setSelectedTables,
    setStatsDatetime, setStatsMode, setStatsPeriodType, setTableHeaders,
    statsDatetime, statsLoading, statsMode, statsPeriodType,
    tableHeaders, toggleTable
  };

  const rfcCtx = {
    availableRfcs, executeRfcBatch, handleRfcFileUpload, handleRfcSelection,
    rfcError, rfcExecuting, rfcFileInputRef, rfcMsg,
    rfcPreviewRows, rfcProgress, rfcResults, rfcSchema,
    selectedRealm, selectedRfc, setRfcError, setRfcFile,
    setRfcMsg, setRfcPreviewRows, setRfcResults, setRfcSchema,
    setSelectedRfc
  };

  const sodCtx = {
    addSodElement, clearSodElements, deleteAllSodAction, deleteSodRulesetAction,
    exportSodResults, exportSodTables, handleSodElementsFileUpload, importSodTables,
    loadSodRaElements, loadSodRaResults, runSodAnalysisAction, setSodAnalysisLevel,
    setSodElementId, setSodElementType, setSodIncludeInvalid, setSodRuleset,
    sodAddElementErr, sodAddElementLoading, sodAddElementMsg, sodAnalysisErr,
    sodAnalysisLevel, sodAnalysisMsg, sodAnalysisProgress, sodAnalysisRunning,
    sodClearErr, sodClearLoading, sodClearMsg, sodDeleteErr,
    sodDeleteLoading, sodDeleteMsg, sodElementId, sodElementType,
    sodElementsFileInputRef, sodExportErr, sodExportLoading, sodExportMsg,
    sodImportElementsLoading, sodImportErr, sodImportLoading, sodImportMsg,
    sodImportProgress, sodIncludeInvalid, sodMissingTables, sodRaElements,
    sodRaElementsLoading, sodRaElementsPage, sodRaElementsTotal, sodRaResults,
    sodRaResultsPage, sodRaResultsTotal, sodResults, sodRuleset,
    sodRulesets, sodRulesetsLoading
  };

  const coverageCtx = {
    covAddUser, covBuildUserStats, covClearRoles, covClearUsers,
    covExportResults, covExportRoles, covExportUsers, covHandleRolesFile,
    covHandleUsersFile, covLoadResults, covLoadRolesFromDb, covResults,
    covResultsPage, covResultsTotal, covRoleDetail, covRoleDetailFor,
    covRoles, covRolesErr, covRolesFileRef, covRolesLoading,
    covRolesMsg, covRolesTotal, covRun, covRunErr,
    covRunLoading, covRunMsg, covShowRoleDetail, covShowUserDetail,
    covStatLoading, covUserDetail, covUserDetailFor, covUserErr,
    covUserLoading, covUserMsg, covUserPattern, covUsers,
    covUsersFileRef, covUsersTotal, setCovUserPattern
  };

  const mapperCtx = {
    mapAddElement, mapAddRole, mapBuildElementStats, mapCalculateExtra,
    mapClearElements, mapClearResults, mapClearRoles, mapElementDetail,
    mapElementDetailFor, mapElementErr, mapElementLoading, mapElementMsg,
    mapElementPattern, mapElements, mapElementsFileRef, mapElementsSelected,
    mapElementsTotal, mapExportElements, mapExportResults, mapExportRoles,
    mapHandleElementsFile, mapHandleRolesFile, mapLoadResults, mapLoadRoleTcodesFromDb,
    mapRemoveSelectedElements, mapRemoveSelectedRoles, mapResults, mapResultsPage,
    mapResultsTotal, mapRoleDetail, mapRoleDetailFor, mapRoleErr,
    mapRoleLoading, mapRoleMsg, mapRolePattern, mapRoles,
    mapRolesFileRef, mapRolesSelected, mapRolesTotal, mapRun,
    mapRunErr, mapRunLoading, mapRunMsg, mapShowElementDetail,
    mapShowRoleDetail, mapStatLoading, mapToggleSelected, setMapCalculateExtra,
    setMapElementPattern, setMapElementsSelected, setMapRolePattern, setMapRolesSelected
  };

  return (
    <main style={{
      ...layoutStyle,
      gridTemplateColumns: `${sidebarCollapsed ? 64 : 220}px 1fr`
    }}>
      <aside style={{
        ...sideNavStyle,
        padding: sidebarCollapsed ? 8 : 16,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        height: '100vh',
        boxSizing: 'border-box'
      }}>
        <div>
          {/* Burger toggle */}
          <button
            onClick={() => setSidebarCollapsed(v => !v)}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, padding: 8, alignSelf: 'flex-start' }}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>

          {/* Banner */}
          {!sidebarCollapsed && (
            <div style={{ marginBottom: '16px', textAlign: 'center' }}>
              <img src={brandBanner} alt="Brand Banner" style={{ maxWidth: '100%', height: 'auto', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', backgroundColor: '#000' }} />
            </div>
          )}

          {!sidebarCollapsed && <h3>Sections</h3>}

          <div style={{ display: 'grid', gap: 8 }}>
            <button style={navBtnStyle(section === 'sap-realms')} onClick={() => setSection('sap-realms')} title="SAP Realms">
              <span style={{ fontSize: 16 }}>🗄️</span>
              {!sidebarCollapsed && <span>SAP Realms</span>}
            </button>

            <button style={navBtnStyle(section === 'sap-import')} disabled={!selectedRealm} onClick={() => setSection('sap-import')} title="Import SAP Tables">
              <span style={{ fontSize: 16 }}>📥</span>
              {!sidebarCollapsed && <span>Import SAP Tables</span>}
            </button>

            <button style={navBtnStyle(section === 'reports')} disabled={!selectedRealm} onClick={() => setSection('reports')} title="Reports">
              <span style={{ fontSize: 16 }}>📊</span>
              {!sidebarCollapsed && <span>Reports</span>}
            </button>

            <button style={navBtnStyle(section === 'rfc')} disabled={!selectedRealm} onClick={() => setSection('rfc')} title="RFC Execution">
              <span style={{ fontSize: 16 }}>⚡</span>
              {!sidebarCollapsed && <span>RFC Execution</span>}
            </button>

            <button style={navBtnStyle(section === 'sod')} disabled={!selectedRealm} onClick={() => setSection('sod')} title="SOD & Audit">
              <span style={{ fontSize: 16 }}>🛡️</span>
              {!sidebarCollapsed && <span>SOD & Audit</span>}
            </button>
            <button style={navBtnStyle(section === 'coverage')} disabled={!selectedRealm} onClick={() => setSection('coverage')} title="Coverage">
              <span style={{ fontSize: 16 }}>⚖️</span>
              {!sidebarCollapsed && <span>Coverage</span>}
            </button>
            <button style={navBtnStyle(section === 'mapper')} disabled={!selectedRealm} onClick={() => setSection('mapper')} title="Mapper">
              <span style={{ fontSize: 16 }}>🧩</span>
              {!sidebarCollapsed && <span>Mapper</span>}
            </button>
          </div>
        </div>

        {/* bottom group: Settings + realm */}
        <div>
          <div style={{ display: 'grid', gap: 8, marginBottom: '12px' }}>
            <button style={navBtnStyle(section === 'settings')} onClick={() => setSection('settings')} title="Settings">
              <span style={{ fontSize: 16 }}>⚙️</span>
              {!sidebarCollapsed && <span>Settings</span>}
            </button>
          </div>

          {!sidebarCollapsed && (
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
          )}
        </div>
      </aside>

      <section style={contentStyle}>
        {section === 'settings' ? <SettingsSection ctx={settingsCtx} /> : null}
        {section === 'sap-realms' ? <RealmSection ctx={realmCtx} /> : null}
        {section === 'sap-import' ? <ImportSection ctx={importCtx} /> : null}
        {section === 'reports' ? <ReportsSection ctx={reportsCtx} /> : null}
        {section === 'rfc' ? <RfcSection ctx={rfcCtx} /> : null}
        {section === 'sod' ? <SodSection ctx={sodCtx} /> : null}
        {section === 'coverage' ? <CoverageSection ctx={coverageCtx} /> : null}
        {section === 'mapper' ? <MapperSection ctx={mapperCtx} /> : null}
      </section>
    </main>
  );
}
