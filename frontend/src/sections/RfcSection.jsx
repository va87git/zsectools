import { panelStyle } from '../styles.js';

export default function RfcSection({ ctx }) {
  const {
  availableRfcs, executeRfcBatch, handleRfcFileUpload, handleRfcSelection,
  rfcError, rfcExecuting, rfcFileInputRef, rfcMsg,
  rfcPreviewRows, rfcProgress, rfcResults, rfcSchema,
  selectedRealm, selectedRfc, setRfcError, setRfcFile,
  setRfcMsg, setRfcPreviewRows, setRfcResults, setRfcSchema,
  setSelectedRfc
  } = ctx;

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
        {rfcError ? <p style={{ color: 'var(--danger)' }}>{rfcError}</p> : null}
        {rfcMsg ? <p style={{ color: 'var(--success)' }}>{rfcMsg}</p> : null}
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
            <div style={{ background: 'var(--bg-subtle)', padding: 12, borderRadius: 4, marginBottom: 12 }}>
              <p><strong>Required Fields:</strong> {rfcSchema.requiredFields.join(', ')}</p>
              {rfcSchema.optionalFields.length > 0 && (
                <p><strong>Optional Fields:</strong> {rfcSchema.optionalFields.join(', ')}</p>
              )}
            </div>
          )}

          {rfcSchema && rfcSchema.examples && (
                      <div style={{ background: 'var(--info-bg)', padding: 12, borderRadius: 4, marginBottom: 12, border: '1px solid var(--info-border)' }}>
                        <p style={{ marginTop: 0 }}><strong>Examples</strong></p>
                        {rfcSchema.examples.note && (
                          <p style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-line' }}>{rfcSchema.examples.note}</p>
                        )}
                        {Array.isArray(rfcSchema.examples.header) && Array.isArray(rfcSchema.examples.rows) && (
                          <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
                              <thead>
                                <tr style={{ background: 'var(--info-border)' }}>
                                  {rfcSchema.examples.header.map((h) => (
                                    <th key={h} style={{ border: '1px solid var(--info-border)', padding: '4px 8px', textAlign: 'left' }}>{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rfcSchema.examples.rows.map((row, idx) => (
                                  <tr key={idx} style={{ background: idx % 2 === 0 ? 'var(--bg-elevated)' : 'var(--info-bg)' }}>
                                    {row.map((val, vidx) => (
                                      <td key={vidx} style={{ border: '1px solid var(--info-border)', padding: '4px 8px' }}>{val}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
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
              // muted background if disabled, otherwise success color
              background: (!selectedRealm || !selectedRfc || rfcPreviewRows.length === 0 || rfcExecuting) ? 'var(--border-strong)' : 'var(--success)',
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
        <button
          onClick={handleRfcReset}
          style={{
            padding: '6px 10px',
            cursor: 'pointer',
            background: 'var(--bg-subtle)',
            color: 'var(--text)',
            border: '1px solid var(--border-strong)',
            borderRadius: '4px',
            fontSize: '12px',
            width: '100%',
            marginBottom: 12
          }}
        >
          Input reset
        </button>
          {rfcPreviewRows.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Rows to execute: {rfcPreviewRows.length} {rfcSchema && rfcSchema.bapi ? `(${rfcSchema.bapi})` : `(${selectedRfc})`}
              </p>
              <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: 'var(--bg-subtle)' }}>
                      {Object.keys(rfcPreviewRows[0] || {}).map(key => (
                        <th key={key} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                          {key}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rfcPreviewRows.map((row, idx) => (
                      <tr key={idx} style={{ background: idx % 2 === 0 ? 'var(--bg-elevated)' : 'var(--bg-subtle)' }}>
                        {Object.values(row).map((val, vidx) => (
                          <td key={vidx} style={{ padding: '4px 8px', borderBottom: '1px solid var(--border)' }}>
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
              <div style={{ background: 'var(--border-strong)', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{
                  background: 'var(--success)',
                  height: 20,
                  width: `${(rfcProgress.current / rfcProgress.total) * 100}%`,
                  transition: 'width 0.3s ease'
                }} />
              </div>
              <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Executing {rfcProgress.current}/{rfcProgress.total}
              </p>
            </div>
          )}

          {displayResults.length > 0 && (
  <div>
    <h4>Results</h4>
    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
      <thead>
        <tr style={{ background: 'var(--bg-subtle)' }}>
          <th style={{ padding: '4px', textAlign: 'left' }}>Status</th>
          <th style={{ padding: '4px', textAlign: 'left' }}>Message</th>
        </tr>
      </thead>
      <tbody>
        {displayResults.map((res, idx) => (
          <tr key={idx} style={{ background: res.status === 'success' ? 'var(--success-bg)' : 'var(--danger-bg)' }}>
            <td style={{ padding: '4px', color: res.status === 'success' ? 'var(--success)' : 'var(--danger)', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
              {res.status}
            </td>
            <td style={{ padding: '4px', fontSize: 10 }}>
              {res.status === 'success'
                ? <>{res.message} <span style={{ color: 'var(--text-faint)' }}>({res.count})</span></>
                : <>{res.rowIndex != null ? <span style={{ color: 'var(--text-faint)', marginRight: 4 }}>[row {res.rowIndex}]</span> : null}{res.message}</>
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

