import { panelStyle } from '../styles.js';
import StatusBlock from '../components/StatusBlock.jsx';
import brandBanner from '../../assets/brand/zsectools-banner-v2.png';
import { useTheme } from '../theme.jsx';

/* global __APP_VERSION__ */

export default function SettingsSection({ ctx }) {
  const { theme, toggleTheme } = useTheme();
  const isDarkTheme = theme === 'dark';
  function renderHealthSection() {
    return (
      <>
        <h1>Quality and prerequisites check</h1>
        <p>Use this section for backend/API health checks.</p>


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
                <p style={{ color: 'var(--success)' }}>RFCPING OK — {sapHealth.latencyMs}ms — {sapHealth.destination?.ashost}/{sapHealth.destination?.client}</p>
              </div>
            ) : (
              <StatusBlock title="SAP RFC Health" data={sapHealth} error={errors.sap} />
            )}

        <div style={panelStyle}>
          <h3>SAP NW RFC SDK Path (Environment)</h3>
          <p style={{ marginTop: 0 }}>Check the SDK base path configured in the backend <code>.env</code> file.</p>
          <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 8, alignItems: 'center' }}>
            <label>SDK path</label>
            <input
              value={sdkPath}
              readOnly
              placeholder="Click 'Load' to read SAPNWRFC_HOME from .env"
            />
          </div>
          <div style={{ marginTop: 10 }}>
            <button style={{ padding: '8px 12px', cursor: 'pointer' }} onClick={loadSdkPath}>
              Load
            </button>
            <button style={{ marginLeft: 8, padding: '8px 12px', cursor: 'pointer' }} onClick={runSdkDiagnostics}>
              Run diagnostics
            </button>
          </div>

          {sdkPathError ? <p style={{ color: 'var(--danger)' }}>{sdkPathError}</p> : null}
          {sdkPathInfo ? <p style={{ color: 'var(--success)' }}>{sdkPathInfo}</p> : null}
          {sdkDiagError ? <p style={{ color: 'var(--danger)' }}>{sdkDiagError}</p> : null}
          {sdkDiag ? <pre style={{ marginTop: 10, maxHeight: 260, overflow: 'auto' }}>{JSON.stringify(sdkDiag, null, 2)}</pre> : null}
        </div>
      </>
    );
  }

  function renderSettingsGeneral() {
    return (
      <div style={{ maxWidth: 520 }}>
        <div style={panelStyle}>
          <h3 style={{ marginTop: 0 }}>Appearance</h3>
          <p style={{ color: 'var(--text-faint)', fontSize: 13, marginBottom: 16 }}>
            Choose between light and dark theme for the interface.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 'bold' }}>Dark theme</div>
              <div style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
                {isDarkTheme ? 'Enabled' : 'Disabled'}
              </div>
            </div>
            <button
              onClick={toggleTheme}
              role="switch"
              aria-checked={isDarkTheme}
              aria-label="Toggle dark theme"
              style={{
                width: 52,
                height: 28,
                borderRadius: 999,
                border: '1px solid var(--border-strong)',
                background: isDarkTheme ? 'var(--accent)' : 'var(--bg-subtle)',
                position: 'relative',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 2,
                  left: isDarkTheme ? 26 : 2,
                  width: 22,
                  height: 22,
                  borderRadius: '50%',
                  background: '#fff',
                  transition: 'left 0.15s ease',
                  boxShadow: '0 1px 3px var(--shadow)'
                }}
              />
            </button>
          </div>
        </div>
      </div>
    );
  }

  function renderAboutSection() {
    return (
      <div style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* Panel 1: Branding & Version Info */}
        <div
          style={{
            ...panelStyle,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '24px',
          }}
        >
          {/* Section Header */}
          <h4 style={{ margin: '0 0 20px 0', fontSize: '16px', fontWeight: '600', color: 'var(--text)' }}>
            App Version
          </h4>

          {/* Brand Logo Container */}
          <div
            style={{
              width: '180px',
              borderRadius: '12px',
              overflow: 'hidden',
              boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              marginBottom: '20px',
              backgroundColor: '#000',
            }}
          >
            <img
              src={brandBanner}
              alt="Brand Banner"
              style={{ width: '100%', display: 'block' }}
            />
          </div>

          {/* Application Title & Description */}
          <h3 style={{ margin: '0 0 6px 0', fontSize: '20px', color: 'var(--text)' }}>
            ZSecTools
          </h3>

          <p style={{ margin: '0 0 16px 0', color: 'var(--text-muted)', fontSize: '14px' }}>
            SAP Security & Authorization Suite
          </p>

          {/* Application Version Badge */}
          <span
            style={{
              display: 'inline-block',
              backgroundColor: 'var(--accent-bg)',
              color: 'var(--link)',
              fontSize: '12px',
              fontWeight: '600',
              padding: '4px 12px',
              borderRadius: '16px',
              border: '1px solid var(--border)',
            }}
          >
            v{__APP_VERSION__}
          </span>
        </div>

        {/* Panel 2: License & Repository Links & Docs */}
        <div
          style={{
            ...panelStyle,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '24px',
            gap: '8px',
          }}
        >
          {/* Section Header */}
          <h4 style={{ margin: '0 0 12px 0', fontSize: '16px', fontWeight: '600', color: 'var(--text)' }}>
            License and Docs
          </h4>

          {/* License Info */}
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            Released under{' '}
            <a
              href="https://github.com/va87git/zsectools/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--link)', textDecoration: 'underline', fontWeight: '500' }}
            >
              MIT License, with No-Sale Clause
            </a>
          </span>

          {/* Repository Link */}
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            GitHub:{' '}
            <a
              href="https://github.com/va87git/zsectools"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--link)', textDecoration: 'underline', fontWeight: '500' }}
            >
              ZSecTools
            </a>
          </span>

          {/* User Guide Link */}
          <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}>
            User Guide (found also in root folder):{' '}
            <a
              href="https://github.com/va87git/zsectools/blob/main/userguide.md"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--link)', textDecoration: 'underline', fontWeight: '500' }}
            >
              userguide.md
            </a>
          </span>
        </div>
        {/* Panel 3: updates check */}
        <div style={panelStyle}>
          <h3>Software Updates</h3>
          <p style={{ marginTop: 0 }}>Check if a newer release of ZSecTools is available on GitHub.</p>

          <button
            style={{ padding: '8px 12px', cursor: updateLoading ? 'not-allowed' : 'pointer' }}
            onClick={checkForUpdates}
            disabled={updateLoading}
          >
            {updateLoading ? 'Checking...' : 'Check for updates'}
          </button>

          {updateError ? (
            <p style={{ color: 'var(--danger)', marginTop: 10 }}>{updateError}</p>
          ) : null}

          {updateInfo ? (
            <div style={{ marginTop: 12 }}>
              {updateInfo.hasUpdate ? (
                <div style={{ padding: 10, backgroundColor: 'var(--warn-bg)', border: '1px solid var(--warn-border)', borderRadius: 4 }}>
                  <p style={{ margin: 0, fontWeight: 'bold', color: 'var(--warn-text)' }}>
                    🚀 A new version is available: v{updateInfo.latestVersion} (Current: v{updateInfo.currentVersion})
                  </p>
                  <p style={{ margin: '6px 0 0 0' }}>
                    <a href={updateInfo.releaseUrl} target="_blank" rel="noreferrer">
                      View release on GitHub
                    </a>
                  </p>
                </div>
              ) : (
                <p style={{ color: 'var(--success)', margin: 0 }}>
                  ✓ You are running the latest version (v{updateInfo.currentVersion}).
                </p>
              )}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  const {
  appHealth, checkForUpdates, dbHealth, errors,
  loadSdkPath, runCheck, runSapCheck, runSdkDiagnostics,
  sapHealth, sdkDiag, sdkDiagError, sdkPath,
  sdkPathError, sdkPathInfo, selectedRealm, setAppHealth,
  setDbHealth, setSettingsTab, settingsTab, updateError,
  updateInfo, updateLoading
  } = ctx;

    const tabBtn = (active) => ({
      padding: '8px 16px',
      border: 'none',
      borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
      background: 'transparent',
      cursor: 'pointer',
      fontWeight: active ? 'bold' : 'normal',
      color: active ? 'var(--accent)' : 'var(--text-muted)'
    });

    return (
      <>
        <h1>Settings</h1>
        <p style={{ marginTop: 0, color: 'var(--text-muted)' }}>Application settings and diagnostics.</p>

        {/* Internal tabs */}
        <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
          <button style={tabBtn(settingsTab === 'general')} onClick={() => setSettingsTab('general')}>
            General
          </button>
          <button style={tabBtn(settingsTab === 'health')} onClick={() => setSettingsTab('health')}>
            Health Checks
          </button>
          <button style={tabBtn(settingsTab === 'about')} onClick={() => setSettingsTab('about')}>
            About
          </button>
        </div>

        {/* Selected tab content */}
        {settingsTab === 'general' && renderSettingsGeneral()}
        {settingsTab === 'health' && renderHealthSection()}
        {settingsTab === 'about' && renderAboutSection()}
      </>
    );

}

