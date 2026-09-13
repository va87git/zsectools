import { PAGE_SIZE } from '../constants.js';

export default function CodeSecuritySection({ ctx }) {
  const {
  selectedRealm, csProgramPattern, setCsProgramPattern,
  csSearchLoading, csPrograms, csProgramsLimited, csSearchMsg, csSearchErr, csDoSearch,
  csImportLoading, csImportFileRef, csDoImportCsv,
  csDownloadLoading, csDownloadMsg, csDownloadErr, csDownloadProgress, csDoDownload,
  csChecks, csChecksLoading, csChecksErr, csLoadChecks,
  csSelectedChecks, csToggleCheck, csSelectAllChecks, csDeselectAllChecks, csSemaphores,
  csRunLoading, csRunCheck, csRunAllChecks, csRunSelectedChecks, csRunMsg, csRunErr,
  csResults, csResultsTotal, csResultsPage, csLoadResults, csExportResults, csClearResults
  } = ctx;

  const panelStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, marginBottom: 24 };
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 4, color: 'var(--text-muted)' };
  const inputStyle = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 4, fontSize: 13, width: '100%', boxSizing: 'border-box' };
  const btnStyle = (bg) => ({ padding: '6px 14px', background: bg, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' });

  // traffic light: RED / GREEN / not run yet (grey)
  const semaphoreColor = (state) => state === 'RED' ? 'var(--danger)' : state === 'GREEN' ? 'var(--success)' : 'var(--border-strong)';

  return (
    <div style={{ maxWidth: 1300 }}>
      <h1>Code security</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>
        Search ABAP programs, download their source (with all their includes) and run security checks on them.
        <strong> Download Source</strong> processes every program listed in the results table, creating one sub-folder per program under <code>CodeSecurity/</code>.
      </p>

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Left: program name + search + download */}
        <div style={{ ...panelStyle, flex: 1 }}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Program source</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <label style={labelStyle}>Program name (wildcards * and + supported)</label>
              <input style={inputStyle} value={csProgramPattern} onChange={e => setCsProgramPattern(e.target.value)}
                placeholder="e.g. Z* or SAPL+ABC" onKeyDown={e => e.key === 'Enter' && csDoSearch()} />
            </div>
            <button style={btnStyle('var(--success)')} onClick={csDoSearch} disabled={csSearchLoading}>
              {csSearchLoading ? 'Searching...' : 'Search program'}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <input ref={csImportFileRef} type="file" accept=".csv,.txt" style={{ display: 'none' }} onChange={csDoImportCsv} />
            <button style={btnStyle('var(--text-muted)')} onClick={() => csImportFileRef.current?.click()}
              disabled={csImportLoading}
              title="Load a one-column CSV (first row = header) with the list of programs to verify in TADIR">
              {csImportLoading ? 'Importing...' : 'Import CSV'}
            </button>
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
              Load a one-column CSV (first row = header) with the programs to check in TADIR: found ones fill the table on the right.
            </span>
          </div>
          <div style={{ marginBottom: 12 }}>
            <button style={btnStyle('var(--accent)')}
              onClick={csDoDownload}
              disabled={csDownloadLoading || csPrograms.length === 0}
              title={csPrograms.length === 0 ? 'Run "Search program" first: the download processes every program listed in the results table' : `Download the source of all ${csPrograms.length} program(s) listed on the right`}>
              {csDownloadLoading ? 'Downloading...' : 'Download Source'}
            </button>
            <p style={{ fontSize: 12, color: 'var(--text-faint)', margin: '6px 0 0' }}>
              {csPrograms.length > 0
                ? `Will download the source of all ${csPrograms.length} program(s) listed on the right (one sub-folder per program under CodeSecurity/).`
                : 'Run a search first: the download processes every program listed in the results table on the right.'}
            </p>
          </div>
          {csSearchMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0' }}>{csSearchMsg}</p>}
          {csSearchErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0' }}>{csSearchErr}</p>}
          {csDownloadLoading && (
            <div>
              <div style={{ background: 'var(--border-strong)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  background: 'var(--accent)', height: 20,
                  width: `${csDownloadProgress?.totalPrograms ? Math.max(4, Math.round((csDownloadProgress.programIndex / csDownloadProgress.totalPrograms) * 100)) : 100}%`,
                  opacity: 0.4, transition: 'width 0.3s ease'
                }} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
                Program {csDownloadProgress?.programIndex ?? '…'} / {csDownloadProgress?.totalPrograms ?? '…'}
                {csDownloadProgress?.rootProgram ? <> — <strong>{csDownloadProgress.rootProgram}</strong></> : ''}
                {csDownloadProgress?.program && csDownloadProgress.program !== csDownloadProgress.rootProgram ? ` (include ${csDownloadProgress.program})` : ''}
                {typeof csDownloadProgress?.batchDownloaded === 'number' ? ` — ${csDownloadProgress.batchDownloaded} file(s) written so far` : ''}
              </p>
            </div>
          )}
          {csDownloadMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0' }}>{csDownloadMsg}</p>}
          {csDownloadErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0' }}>{csDownloadErr}</p>}
        </div>

        {/* Right: TADIR search results */}
        <div style={{ ...panelStyle, flex: 1 }}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Found programs</h2>
          {csPrograms.length > 0 ? (
            <div style={{ overflowX: 'auto', maxHeight: 300, overflowY: 'auto' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>
                Showing {csPrograms.length} program(s){csProgramsLimited ? ' (limit reached — refine the pattern)' : ''}
              </p>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    {Object.keys(csPrograms[0]).map(k => (
                      <th key={k} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csPrograms.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)' }}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          {v === null || v === undefined ? '' : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No programs found. Enter a program name (wildcards * and + allowed) and click Search program.
            </p>
          )}
        </div>
      </div>

      {/* Security checks */}
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Security Checks</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnStyle('var(--text-muted)')} onClick={csLoadChecks} disabled={csChecksLoading}>Reload checks</button>
            <button style={btnStyle('var(--accent)')} onClick={csSelectAllChecks}
              disabled={csChecksLoading || !csChecks.length}
              title="Tick every check">Select all</button>
            <button style={btnStyle('var(--text-muted)')} onClick={csDeselectAllChecks}
              disabled={csChecksLoading || csSelectedChecks.size === 0}
              title="Untick every check">Deselect all</button>
            <button style={btnStyle('var(--success)')} onClick={csRunSelectedChecks}
              disabled={!!csRunLoading || csSelectedChecks.size === 0}
              title="Run only the ticked checks">
              {csRunLoading === 'selected' ? 'Running...' : `Run selected checks (${csSelectedChecks.size})`}
            </button>
            <button style={btnStyle('var(--success)')} onClick={csRunAllChecks} disabled={csRunLoading === 'all' || !csChecks.length}>
              {csRunLoading === 'all' ? 'Running...' : 'Run all checks'}
            </button>
          </div>
        </div>
        {csChecksErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 8px' }}>{csChecksErr}</p>}
        {csRunMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '0 0 8px' }}>{csRunMsg}</p>}
        {csRunErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 8px' }}>{csRunErr}</p>}

        {csChecksLoading ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Loading checks...</p>
        ) : csChecks.length === 0 ? (
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
            No checks defined. Create the file CodeSecurity/codeSecurityChecks.txt (ID / TEXT / SEARCH_STRING / IS_DEFECTIVE rows).
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 6 }}>
            {csChecks.map((check) => (
              <div key={check.id}
                style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-subtle)', flexWrap: 'wrap' }}>
                <input type="checkbox"
                  checked={csSelectedChecks.has(check.id)}
                  onChange={() => csToggleCheck(check.id)} />
                <span style={{ fontSize: 13, flex: 1, minWidth: 200 }}>
                  <strong>{check.id}</strong>{check.text ? `-${check.text}` : ''}
                </span>
                <span title={csSemaphores[check.id] ? `Result: ${csSemaphores[check.id]}` : 'Not run yet'}
                  style={{ width: 16, height: 16, borderRadius: '50%', background: semaphoreColor(csSemaphores[check.id]), border: '1px solid var(--border-strong)', display: 'inline-block', flexShrink: 0 }} />
                <button style={btnStyle('var(--accent)')} onClick={() => csRunCheck(check.id)} disabled={!!csRunLoading}>
                  {csRunLoading === check.id ? 'Running...' : 'run this check'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Results table */}
      <div style={panelStyle}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Check results</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button style={btnStyle('var(--text-muted)')} onClick={() => csLoadResults(0)}>Refresh</button>
            <button style={btnStyle('var(--accent)')} onClick={csExportResults} disabled={!csResultsTotal}
              title="Export the full results table as CSV">Export results</button>
            <button style={btnStyle('var(--danger)')} onClick={csClearResults} disabled={!csResultsTotal}
              title="Delete all stored results">Clear results</button>
          </div>
        </div>
        {csResults.length > 0 ? (
          <>
            <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    {Object.keys(csResults[0]).map(k => (
                      <th key={k} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {csResults.map((row, i) => (
                    <tr key={i} style={{ background: row.result === 'RED' ? 'var(--danger-bg)' : 'var(--success-bg)' }}>
                      {Object.values(row).map((v, j) => (
                        <td key={j} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                          {v === null || v === undefined ? '' : String(v)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>Showing {csResultsPage * PAGE_SIZE + 1}–{Math.min((csResultsPage + 1) * PAGE_SIZE, csResultsTotal)} of {csResultsTotal}</span>
              <span>
                <button onClick={() => csLoadResults(0)} disabled={csResultsPage === 0} style={{ marginRight: 4 }}>First</button>
                <button onClick={() => csLoadResults(csResultsPage - 1)} disabled={csResultsPage === 0} style={{ marginRight: 4 }}>Prev</button>
                <button onClick={() => csLoadResults(csResultsPage + 1)} disabled={csResultsPage >= Math.ceil(csResultsTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                <button onClick={() => csLoadResults(Math.ceil(csResultsTotal / PAGE_SIZE) - 1)} disabled={csResultsPage >= Math.ceil(csResultsTotal / PAGE_SIZE) - 1}>Last</button>
              </span>
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
            No results yet. Download some program sources, then run a check.
          </p>
        )}
      </div>
    </div>
  );
}
