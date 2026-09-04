import { PAGE_SIZE } from '../constants.js';

export default function SodSection({ ctx }) {
  const {
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
  } = ctx;

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
        {/* Ruleset */}
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Ruleset</h2>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Ruleset ID</label>
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
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={sodIncludeInvalid}
                  onChange={(e) => setSodIncludeInvalid(e.target.checked)}
                />
                consider also invalid/locked users
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
                <span style={labelStyle}>Upload CSV/TSV File</span>
                <input
                  ref={sodElementsFileInputRef}
                  type="file"
                  accept=".csv,.tsv,.txt"
                  onChange={handleSodElementsFileUpload}
                  style={{ display: 'none' }}
                />
                <button
                  style={btnStyle('#555')}
                  onClick={() => sodElementsFileInputRef.current && sodElementsFileInputRef.current.click()}
                  disabled={sodImportElementsLoading}
                >{sodImportElementsLoading ? 'Importing...' : 'Import elements'}</button>
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

