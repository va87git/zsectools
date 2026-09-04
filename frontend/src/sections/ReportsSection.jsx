import { PAGE_SIZE } from '../constants.js';
import { panelStyle } from '../styles.js';

// catalogo report spostato da App.jsx (usato solo qui)
  const availableReports = [
    { id: 'USER01', name: 'USER01 - Users never logged on in the last XX days' },
    { id: 'USER02', name: 'USER02 - Active users with SAP_ALL and SAP_NEW' },
    { id: 'USER03', name: 'USER03 - Active users with manually assigned profiles' },
    { id: 'USER04', name: 'USER04 - All users' },
    { id: 'ROLE01', name: 'ROLE01 - Role Composite-Single-Transactions' },
    { id: 'ROLE02', name: 'ROLE02 - Role Single - Transactions in menu (task library)' },
    { id: 'ROLE03', name: 'ROLE03 - Roles with organizational levels entered manually' },
    { id: 'ROLE04', name: 'ROLE04 - Roles Composite-Single-Organizational levels' },
    { id: 'ROLE05', name: 'ROLE05 - Roles with a range or * for S_TCODE' },
    { id: 'ROLE06', name: 'ROLE06 - Roles assigned to users' },
    { id: 'ROLE07', name: 'ROLE07 - Roles Composite-Single-Tcd (Menu)' },
    { id: 'ROLE08', name: 'ROLE08 - Roles assigned to users (hierarchical)' },
    //{ id: 'ROLE09', name: 'ROLE09 - TODO: SU25 step 2C simulation' },
    { id: 'STAT01', name: 'STAT01 - Statistics users-low details' },
    { id: 'STAT02', name: 'STAT02 - Statistics users-high details' }
  ];

export default function ReportsSection({ ctx }) {
  const {
  executeReport, exportReport, loadReportRows, reportDays,
  reportError, reportHeaders, reportPage, reportPattern,
  reportRows, reportTotal, selectedRealm, selectedReport,
  setReportDays, setReportError, setReportHeaders, setReportPage,
  setReportPattern, setReportRows, setReportTableName, setReportTotal,
  setSelectedReport
  } = ctx;

    return (
      <>
        <h1>Reports</h1>
        <p>Generate and view predefined SAP reports.</p>


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

