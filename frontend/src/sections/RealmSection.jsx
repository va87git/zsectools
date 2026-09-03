import { fetchJson } from '../api.js';
import { panelStyle } from '../styles.js';

export default function RealmSection({ ctx }) {
  const {
  errors, form, loadRealm, loadRealmList,
  realms, runSapCheck, sapHealth, sapRealmError,
  sapRealmInfo, saveRealm, selectedRealm, setSapRealmError,
  setSapRealmInfo, setSelectedRealm, updateForm
  } = ctx;

      return (
        <>
          <h1>SAP Connection Realms</h1>
          <p>Save multiple SAP connection configurations with a unique <code>realm</code>.</p>


          <div style={panelStyle}>
            <div style={{ marginBottom: 12 }}>
              <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={loadRealmList}>Refresh Realm List</button>
              <button style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={saveRealm}>Save / Update Realm</button>
              <button
                style={{ marginRight: 8, padding: '8px 12px', cursor: 'pointer' }}
                disabled={!selectedRealm && !form.realm}
                onClick={runSapCheck}
              >
                Test Connection (RFCPING)
              </button>
            </div>

            {sapRealmError ? <p style={{ color: 'crimson' }}>{sapRealmError}</p> : null}
            {sapRealmInfo ? <p style={{ color: 'green' }}>{sapRealmInfo}</p> : null}

            {/* RFCPING result */}
            {sapHealth?.ok ? (
              <p style={{ color: 'green' }}>
                RFCPING OK — {sapHealth.latencyMs}ms — {sapHealth.destination?.ashost}/{sapHealth.destination?.client}
              </p>
            ) : errors?.sap ? (
              <p style={{ color: 'crimson' }}>
                RFCPING Failed: {typeof errors.sap === 'string' ? errors.sap : JSON.stringify(errors.sap)}
              </p>
            ) : null}

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
                    <button style={{ marginRight: 8, cursor: 'pointer' }} onClick={() => loadRealm(item.realm)}>Select</button>
                    {/*<button style={{ marginRight: 8, cursor: 'pointer' }} onClick={() => setSelectedRealm(item.realm)}>Select</button>*/}
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

