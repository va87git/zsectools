import { PAGE_SIZE } from '../constants.js';

export default function CoverageSection({ ctx }) {
  const {
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
  } = ctx;

    const panelStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, marginBottom: 24 };
    const labelStyle = { display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 4, color: 'var(--text-muted)' };
    const inputStyle = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 4, fontSize: 13, width: '100%', boxSizing: 'border-box' };
    const btnStyle = (bg) => ({ padding: '6px 14px', background: bg, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' });

    return (
      <div style={{ maxWidth: 1100 }}>
        <h1>Coverage</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Analyze role coverage against actual user transaction usage.</p>

        {/* Users panel */}
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Users to Analyze</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12 }}>
            <div style={{ flex: 2 }}>
              <label style={labelStyle}>User ID (wildcards % and _ supported)</label>
              <input style={inputStyle} value={covUserPattern} onChange={e => setCovUserPattern(e.target.value)}
                placeholder="e.g. ZTEST%" onKeyDown={e => e.key === 'Enter' && covAddUser()} />
            </div>
            <button style={btnStyle('var(--success)')} onClick={covAddUser} disabled={covUserLoading}>
              {covUserLoading ? 'Adding...' : 'Add user'}
            </button>
            <button style={btnStyle('var(--accent)')} onClick={covBuildUserStats} disabled={covStatLoading}>
              {covStatLoading ? 'Loading...' : 'Get Users Statistic'}
            </button>
            <div style={{
              marginLeft: 'auto',
              display: 'grid',
              gridTemplateColumns: 'auto auto auto',
              gap: '6px 8px',
              alignItems: 'center',
              justifyItems: 'end'
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Upload CSV/TSV File</span>
              <input ref={covUsersFileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={covHandleUsersFile} />
              <button style={btnStyle('var(--text-muted)')} onClick={() => covUsersFileRef.current?.click()}>Import users</button>
              <button style={btnStyle('var(--danger)')} onClick={covClearUsers}>Clear</button>

              <span />
              <button style={btnStyle('var(--accent)')} onClick={covExportUsers} disabled={!covUsers.length}>
                Export users
              </button>
              <span />
            </div>
          </div>
          {covUserMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0' }}>{covUserMsg}</p>}
          {covUserErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0' }}>{covUserErr}</p>}
          {covUsers.length > 0 && (
            <div style={{ marginTop: 12, overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>Showing {covUsers.length} of {covUsersTotal} user(s)</p>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-subtle)' }}>
                  {['User ID', 'First Name', 'Last Name'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>{covUsers.map((u, i) => (
                  <tr key={u.userid} style={{ background: covUserDetailFor === u.userid ? 'var(--info-bg)' : (i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)'), cursor: 'pointer' }}
                    onClick={() => covShowUserDetail(u.userid)}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{u.userid}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{u.firstname}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{u.lastname}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        {/* Roles panel */}
        <div style={panelStyle}>
          <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Role Assignments</h2>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <button style={btnStyle('var(--accent)')} onClick={covLoadRolesFromDb} disabled={covRolesLoading}>
              {covRolesLoading ? 'Loading...' : 'Get as-is roles from DB'}
            </button>
            <div style={{
              marginLeft: 'auto',
              display: 'grid',
              gridTemplateColumns: 'auto auto auto',
              gap: '6px 8px',
              alignItems: 'center',
              justifyItems: 'end'
            }}>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Upload CSV/TSV File</span>
              <input ref={covRolesFileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={covHandleRolesFile} />
              <button style={btnStyle('var(--text-muted)')} onClick={() => covRolesFileRef.current?.click()}>Import roles</button>
              <button style={btnStyle('var(--danger)')} onClick={covClearRoles}>Clear</button>

              <span />
              <button style={btnStyle('var(--accent)')} onClick={covExportRoles} disabled={!covRoles.length}>
                Export roles
              </button>
              <span />
            </div>
          </div>
          {covRolesMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0' }}>{covRolesMsg}</p>}
          {covRolesErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0' }}>{covRolesErr}</p>}
          {covRoles.length > 0 && (
            <div style={{ marginTop: 12, overflowX: 'auto', maxHeight: 200, overflowY: 'auto' }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>Showing {covRoles.length} of {covRolesTotal} assignment(s)</p>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-subtle)' }}>
                  {['User ID', 'Role', 'Description'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>{covRoles.map((r, i) => (
                  <tr key={`${r.userid}-${r.agr_name}`} style={{ background: covRoleDetailFor === r.agr_name ? 'var(--info-bg)' : (i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)'), cursor: 'pointer' }}
                    onClick={() => covShowRoleDetail(r.agr_name)}>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.userid}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.agr_name}</td>
                    <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.agr_description}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>

        {/* Transactions drill-down */}
        {(covUserDetailFor || covRoleDetailFor) && (
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>
              Transactions {covUserDetailFor ? `— user ${covUserDetailFor}` : `— role ${covRoleDetailFor}`}
            </h2>
            <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-subtle)' }}>
                  {(covUserDetailFor ? ['Tcode', 'Description', 'N. Exec'] : ['Tcode', 'Description']).map(h =>
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(covUserDetailFor ? covUserDetail : covRoleDetail).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)' }}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{row.tcode}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{row.tcode_description}</td>
                      {covUserDetailFor && <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{row.n_exec}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Run & Results panel */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Results</h2>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={btnStyle('var(--text-muted)')} onClick={() => covLoadResults(0)}>Refresh</button>
              <button style={btnStyle('var(--success)')} onClick={covExportResults} disabled={!covResultsTotal}>Export CSV</button>
              <button style={btnStyle('var(--accent)')} onClick={covRun} disabled={covRunLoading}>
                {covRunLoading ? 'Running...' : 'Run Coverage Analysis'}
              </button>
            </div>
          </div>
          {covRunMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '0 0 8px' }}>{covRunMsg}</p>}
          {covRunErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 8px' }}>{covRunErr}</p>}
          {covRunLoading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Running analysis...</p>
          ) : covResults.length > 0 ? (
            <>
              <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {Object.keys(covResults[0]).map(k => (
                        <th key={k} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {covResults.map((row, i) => {
                      const bg = row.coverage === '01-COVERED' ? 'var(--success-bg)'
                               : row.coverage === '02-MISSING' ? 'var(--danger-bg)'
                               : row.coverage === '03-EXTRA'   ? 'var(--warn-bg)'
                               : 'var(--pink-bg)';
                      return (
                        <tr key={i} style={{ background: bg }}>
                          {Object.values(row).map((v, j) => (
                            <td key={j} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                              {v === null || v === undefined ? '' : String(v)}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>Showing {covResultsPage * PAGE_SIZE + 1}–{Math.min((covResultsPage + 1) * PAGE_SIZE, covResultsTotal)} of {covResultsTotal}</span>
                <span>
                  <button onClick={() => covLoadResults(0)} disabled={covResultsPage === 0} style={{ marginRight: 4 }}>First</button>
                  <button onClick={() => covLoadResults(covResultsPage - 1)} disabled={covResultsPage === 0} style={{ marginRight: 4 }}>Prev</button>
                  <button onClick={() => covLoadResults(covResultsPage + 1)} disabled={covResultsPage >= Math.ceil(covResultsTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                  <button onClick={() => covLoadResults(Math.ceil(covResultsTotal / PAGE_SIZE) - 1)} disabled={covResultsPage >= Math.ceil(covResultsTotal / PAGE_SIZE) - 1}>Last</button>
                </span>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No results yet. Add users, load roles, then click Run Coverage Analysis.
            </p>
          )}
        </div>
      </div>
    );

}

