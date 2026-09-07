import { PAGE_SIZE } from '../constants.js';

export default function MapperSection({ ctx }) {
  const {
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
  } = ctx;

    const panelStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, marginBottom: 24 };
    const labelStyle = { display: 'block', fontSize: 12, fontWeight: 'bold', marginBottom: 4, color: 'var(--text-muted)' };
    const inputStyle = { padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 4, fontSize: 13, width: '100%', boxSizing: 'border-box' };
    const btnStyle = (bg) => ({ padding: '6px 14px', background: bg, color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13, fontWeight: 'bold' });

    return (
      <div style={{ maxWidth: 1300 }}>
        <h1>Mapper</h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Map elements' transactions onto a set of candidate roles (greedy set-cover).</p>

        <div style={{ display: 'flex', gap: 24 }}>
          {/* Element to Map panel */}
          <div style={{ ...panelStyle, flex: 1 }}>
            <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Element to Map</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={labelStyle}>Element ID (wildcards % and _ supported)</label>
                <input style={inputStyle} value={mapElementPattern} onChange={e => setMapElementPattern(e.target.value)}
                  placeholder="e.g. ZTEST%" onKeyDown={e => e.key === 'Enter' && mapAddElement()} />
              </div>
              <button style={btnStyle('var(--success)')} onClick={mapAddElement} disabled={mapElementLoading}>
                {mapElementLoading ? 'Adding...' : 'Add Users'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input ref={mapElementsFileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={mapHandleElementsFile} />
              <button style={btnStyle('var(--text-muted)')} onClick={() => mapElementsFileRef.current?.click()}>Import Element to Map</button>
              <button style={btnStyle('var(--accent)')} onClick={mapExportElements} disabled={!mapElements.length}>Export Element to Map</button>
              <button style={btnStyle('var(--accent)')} onClick={mapBuildElementStats} disabled={mapStatLoading}>
                {mapStatLoading ? 'Loading...' : 'Get Users Statistic'}
              </button>
              <button style={btnStyle('var(--warn-text)')} onClick={mapRemoveSelectedElements} disabled={!mapElementsSelected.size}>Remove Users</button>
              <button style={btnStyle('var(--danger)')} onClick={mapClearElements}>Clear ElementID</button>
            </div>
            {mapElementMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0' }}>{mapElementMsg}</p>}
            {mapElementErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0' }}>{mapElementErr}</p>}
            {mapElements.length > 0 && (
              <div style={{ marginTop: 12, overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>Showing {mapElements.length} of {mapElementsTotal} element(s)</p>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg-subtle)' }}>
                    <th style={{ padding: '4px 8px' }}></th>
                    {['Element ID', 'Description'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{mapElements.map((el, i) => (
                    <tr key={el.elementid} style={{ background: mapElementDetailFor === el.elementid ? 'var(--info-bg)' : (i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)'), cursor: 'pointer' }}
                      onClick={() => mapShowElementDetail(el.elementid)}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={mapElementsSelected.has(el.elementid)}
                          onChange={() => mapToggleSelected(setMapElementsSelected, mapElementsSelected, el.elementid)} />
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{el.elementid}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{el.element_description}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
          {/* Mapping Item panel */}
          <div style={{ ...panelStyle, flex: 1 }}>
            <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>Mapping Item</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 160 }}>
                <label style={labelStyle}>Role name (wildcards % and _ supported)</label>
                <input style={inputStyle} value={mapRolePattern} onChange={e => setMapRolePattern(e.target.value)}
                  placeholder="e.g. Z_ROLE%" onKeyDown={e => e.key === 'Enter' && mapAddRole()} />
              </div>
              <button style={btnStyle('var(--success)')} onClick={mapAddRole} disabled={mapRoleLoading}>
                {mapRoleLoading ? 'Adding...' : 'Add Mapping item'}
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input ref={mapRolesFileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={mapHandleRolesFile} />
              <button style={btnStyle('var(--text-muted)')} onClick={() => mapRolesFileRef.current?.click()}>Import Mapping Roles</button>
              <button style={btnStyle('var(--accent)')} onClick={mapExportRoles} disabled={!mapRoles.length}>Export Mapping Roles</button>
              <button style={btnStyle('var(--accent)')} onClick={mapLoadRoleTcodesFromDb} disabled={mapRoleLoading}>Get tcodes from DB</button>
              <button style={btnStyle('var(--warn-text)')} onClick={mapRemoveSelectedRoles} disabled={!mapRolesSelected.size}>Remove item</button>
              <button style={btnStyle('var(--danger)')} onClick={mapClearRoles}>Clear Roles</button>
            </div>
            {mapRoleMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '4px 0' }}>{mapRoleMsg}</p>}
            {mapRoleErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '4px 0' }}>{mapRoleErr}</p>}
            {mapRoles.length > 0 && (
              <div style={{ marginTop: 12, overflowX: 'auto', maxHeight: 220, overflowY: 'auto' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 6px' }}>Showing {mapRoles.length} of {mapRolesTotal} role(s)</p>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: 'var(--bg-subtle)' }}>
                    <th style={{ padding: '4px 8px' }}></th>
                    {['Role', 'Description', 'Type'].map(h => <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>{mapRoles.map((r, i) => (
                    <tr key={r.agr_name} style={{ background: mapRoleDetailFor === r.agr_name ? 'var(--info-bg)' : (i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)'), cursor: 'pointer' }}
                      onClick={() => mapShowRoleDetail(r.agr_name)}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={mapRolesSelected.has(r.agr_name)}
                          onChange={() => mapToggleSelected(setMapRolesSelected, mapRolesSelected, r.agr_name)} />
                      </td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.agr_name}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.agr_description}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{r.role_type}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </div>
        </div>
        {/* Transactions drill-down */}
        {(mapElementDetailFor || mapRoleDetailFor) && (
          <div style={panelStyle}>
            <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 16 }}>
              Transactions {mapElementDetailFor ? `— element ${mapElementDetailFor}` : `— role ${mapRoleDetailFor}`}
            </h2>
            <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: 'var(--bg-subtle)' }}>
                  {(mapElementDetailFor ? ['Tcode', 'Description', 'N. Exec'] : ['Tcode', 'Description']).map(h =>
                    <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {(mapElementDetailFor ? mapElementDetail : mapRoleDetail).map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)' }}>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{row.tcode}</td>
                      <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{row.tcode_description}</td>
                      {mapElementDetailFor && <td style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>{row.n_exec}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Run & Results panel */}
        <div style={panelStyle}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ margin: 0, fontSize: 16 }}>Results</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={mapCalculateExtra} onChange={e => setMapCalculateExtra(e.target.checked)} />
                Calculate Extra
              </label>
              <button style={btnStyle('var(--danger)')} onClick={mapClearResults}>Clear Results</button>
              <button style={btnStyle('var(--text-muted)')} onClick={() => mapLoadResults(0)}>Refresh</button>
              <button style={btnStyle('var(--success)')} onClick={mapExportResults} disabled={!mapResultsTotal}>Export Results</button>
              <button style={btnStyle('var(--accent)')} onClick={mapRun} disabled={mapRunLoading}>
                {mapRunLoading ? 'Running...' : 'Run mapping'}
              </button>
            </div>
          </div>
          {mapRunMsg && <p style={{ color: 'var(--success)', fontSize: 13, margin: '0 0 8px' }}>{mapRunMsg}</p>}
          {mapRunErr && <p style={{ color: 'var(--danger)', fontSize: 13, margin: '0 0 8px' }}>{mapRunErr}</p>}
          {mapRunLoading ? (
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>Running mapping...</p>
          ) : mapResults.length > 0 ? (
            <>
              <div style={{ overflowX: 'auto', maxHeight: 380, overflowY: 'auto' }}>
                <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {Object.keys(mapResults[0]).map(k => (
                        <th key={k} style={{ padding: '5px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mapResults.map((row, i) => {
                      const bg = row.status === '01-COVERED' ? 'var(--success-bg)'
                               : row.status === '02-MISSING' ? 'var(--danger-bg)'
                               : row.status === '03-EXTRA'   ? 'var(--warn-bg)'
                               : 'var(--bg-elevated)';
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
                <span>Showing {mapResultsPage * PAGE_SIZE + 1}–{Math.min((mapResultsPage + 1) * PAGE_SIZE, mapResultsTotal)} of {mapResultsTotal}</span>
                <span>
                  <button onClick={() => mapLoadResults(0)} disabled={mapResultsPage === 0} style={{ marginRight: 4 }}>First</button>
                  <button onClick={() => mapLoadResults(mapResultsPage - 1)} disabled={mapResultsPage === 0} style={{ marginRight: 4 }}>Prev</button>
                  <button onClick={() => mapLoadResults(mapResultsPage + 1)} disabled={mapResultsPage >= Math.ceil(mapResultsTotal / PAGE_SIZE) - 1} style={{ marginRight: 4 }}>Next</button>
                  <button onClick={() => mapLoadResults(Math.ceil(mapResultsTotal / PAGE_SIZE) - 1)} disabled={mapResultsPage >= Math.ceil(mapResultsTotal / PAGE_SIZE) - 1}>Last</button>
                </span>
              </div>
            </>
          ) : (
            <p style={{ color: 'var(--text-faint)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
              No results yet. Add elements, load role tcodes, then click Run mapping.
            </p>
          )}
        </div>
      </div>
    );

}

