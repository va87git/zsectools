import { PAGE_SIZE } from '../constants.js';
import { panelStyle } from '../styles.js';

export default function ImportSection({ ctx }) {
  const {
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
  } = ctx;

  const btnStyle = (bg) => ({ padding: '6px 14px', background: bg, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' });

    return (
      <>
        <h1>Import SAP Tables</h1>
        <p>Import SAP tables and user statistics into local database by selected realm.</p>


        <div style={panelStyle}>
          {importErr ? <p style={{ color: 'var(--danger)' }}>{importErr}</p> : null}
          {importMsg ? <p style={{ color: 'var(--success)' }}>{importMsg}</p> : null}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, maxWidth: 1200 }}>
          <div style={panelStyle}>
            <h3>Tables download</h3>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button style={btnStyle('var(--accent)')} disabled={!selectedRealm || importLoading} onClick={importTables}>Download selected Tables from SAP</button>
              <button style={btnStyle('var(--accent)')} disabled={!selectedRealm || !selectedTables.length || exportLoading} onClick={exportTablesTxt}>Export TXT</button>
              <button style={btnStyle('var(--text-muted)')} disabled={!selectedRealm || importTxtLoading} onClick={importTablesTxt}>Import TXT</button>
            </div>
            {importLoading ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ background: 'var(--border-strong)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    background: 'var(--success)',
                    height: 20,
                    width: `${(importProgress.current / importProgress.total) * 100}%`,
                    transition: 'width 0.3s ease'
                  }} />
                </div>
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Downloading table {importProgress.currentTable} ({importProgress.current}/{importProgress.total})
                </p>
              </div>
            ) : null}
            <div style={{ marginTop: 20, marginBottom: 10 }}>
            <h4 style={{ margin: 0, color: 'var(--text)' }}>Tables selection</h4>
            </div>
            <div style={{ marginBottom: 8, display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                style={btnStyle('var(--text-muted)')}
                onClick={() => setSelectedTables(availableTables)}
                disabled={!availableTables.length}
              >
                Select All
              </button>
              <button
                style={btnStyle('var(--text-muted)')}
                onClick={() => setSelectedTables([])}
                disabled={!selectedTables.length}
              >
                Deselect All
              </button>
              <button
                  style={btnStyle('var(--accent)')}
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
                <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Downloading user statistics...</p>
              </div>
            ) : null}

            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button style={btnStyle('var(--accent)')} disabled={!selectedRealm || statsLoading} onClick={importStatistics}>Download Statistics</button>
              <button style={btnStyle('var(--accent)')} disabled={!selectedRealm || exportLoading} onClick={exportStatisticsTxt}>Export Statistics TXT</button>
              <button style={btnStyle('var(--text-muted)')} disabled={!selectedRealm || importTxtLoading} onClick={importStatisticsTxt}>Import Statistics TXT</button>
            </div>

            <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
              <h4 style={{ marginBottom: 8 }}>Downloaded statistics batches</h4>
              <button style={btnStyle('var(--text-muted)')} disabled={!selectedRealm} onClick={loadAggregatedStats}>Refresh list</button>
              {aggregatedStats.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No statistics downloaded yet.</p>
              ) : (
                <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-subtle)' }}>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Select</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Period</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Date</th>
                        <th style={{ padding: '4px 8px', textAlign: 'left' }}>Rows</th>
                      </tr>
                    </thead>
                    <tbody>
                      {aggregatedStats.map((stat, idx) => (
                        <tr key={idx} style={{ background: selectedStatsBatch === stat ? 'var(--info-bg)' : (idx % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)') }}>
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
                  style={{ marginTop: 8, padding: '6px 12px', cursor: 'pointer', background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)' }}
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
            <div style={{ marginTop: 16 }}>
              <button style={btnStyle('var(--text-muted)')} disabled={!selectedRealm} onClick={() => loadImportedTableRows(0)}>Show data from local DB</button>
            </div>
            {displayError ? <p style={{ color: 'var(--danger)' }}>{displayError}</p> : null}
            {displayRows.length > 0 && tableHeaders.length > 0 ? (
              <div style={{ marginTop: 10 }}>
                <p style={{ color: 'var(--text-muted)', marginBottom: 6 }}>
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
                        {tableHeaders.map((h) => <th key={h} style={{ border: '1px solid var(--border)', padding: '4px 8px', background: 'var(--bg-subtle)', textAlign: 'left', whiteSpace: 'nowrap', position: 'sticky', top: 0 }}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {displayRows.map((rowObj, idx) => {
                        const raw = rowObj?.row_data;
                        const data = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});
                        return (
                          <tr key={idx} style={{ background: idx % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)' }}>
                            {tableHeaders.map((h) => <td key={h} style={{ border: '1px solid var(--border)', padding: '4px 8px', whiteSpace: 'nowrap' }}>{String(data[h] ?? '')}</td>)}
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
