// ─────────────────────────────────────────────────────────────────────────────
// updater.js — self-update support for ZSecTools
//
// Features:
//   1. GitHub release check with optional TLS inspection bypass (Zscaler):
//        ALLOW_INSECURE_TLS=true  ->  self-signed corporate certificates are
//        accepted for the outbound HTTPS calls made by this module ONLY
//        (GitHub API + release download). Set it in the .env file.
//   2. Native (dependency-free) download + zip extraction.
//   3. Platform-aware apply:
//        - Windows : a generated apply-update.cmd waits for the backend to
//                    stop, copies the new files (preserving .env, node-bin,
//                    postgres, CodeSecurity, node_modules, ...), rebuilds the
//                    frontend and restarts the WinSW service
//                    (ZSecTools_Backend) or a standalone node window.
//        - Linux   : in-place copy + npm install + frontend rebuild while the
//                    old process is still running, then exit(0); systemd
//                    (Restart=always) or run.sh brings the new version up.
//        - Docker  : the project root is expected on /host/project (bind
//                    mount "- .:/host/project" in docker-compose.yml). Files
//                    are replaced on the host, npm install runs inside /app
//                    (so dependencies land in the persistent node_modules
//                    volume) and the container restarts automatically
//                    (restart: unless-stopped). The frontend container runs
//                    the vite dev server and hot-reloads the new sources.
// ─────────────────────────────────────────────────────────────────────────────

import https from 'https';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'path';
import { execFile, spawn } from 'child_process';

const GITHUB_API_LATEST = 'https://api.github.com/repos/va87git/zsectools/releases/latest';

// Hosts the apply-update endpoint is allowed to download from
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com',
  'raw.githubusercontent.com'
]);

// Directories that must NEVER be touched by an update (runtime/user data)
const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'temp_update',
  'CodeSecurity',
  'postgres',
  'node-bin',
  'TABLES-EXPORT',
  'logs',
  'dist_old',
  'dist_new'
]);

// Files that must NEVER be overwritten/deleted by an update (local config/data)
const EXCLUDED_FILES = new Set([
  '.env',
  'pwfile.txt',
  'SAP-TABLE-LIST.txt',
  'update.log',
  'apply-update.cmd',
  'apply-update.sh',
  'installation_log.txt',
  'node.zip',
  'postgres.zip'
]);

// ── TLS / Zscaler helpers ────────────────────────────────────────────────────

export function isInsecureTlsAllowed() {
  return ['true', '1', 'yes'].includes(String(process.env.ALLOW_INSECURE_TLS || '').trim().toLowerCase());
}

function makeHttpsAgent() {
  const allowInsecure = isInsecureTlsAllowed();
  return {
    agent: new https.Agent({ rejectUnauthorized: !allowInsecure, keepAlive: false }),
    allowInsecure
  };
}

// Single https request, following up to 6 redirects (GitHub asset URLs redirect)
function httpsGet(url, headers = {}, redirectsLeft = 6) {
  return new Promise((resolve, reject) => {
    const { agent } = makeHttpsAgent();
    const req = https.get(url, { agent, headers }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume(); // drain
        const next = new URL(res.headers.location, url).toString();
        return resolve(httpsGet(next, headers, redirectsLeft - 1));
      }
      resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Connection timed out (30s)')));
    req.on('error', reject);
  });
}

export async function fetchGithubJson(url) {
  const res = await httpsGet(url, {
    'User-Agent': 'ZSecTools-Update-Check',
    'Accept': 'application/vnd.github.v3+json'
  });
  if (res.statusCode === 404) return { notFound: true };
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`GitHub API HTTP error: ${res.statusCode}`);
  }
  let data = '';
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

async function downloadToFile(url, destPath) {
  const res = await httpsGet(url, { 'User-Agent': 'ZSecTools-Update-Download' });
  if (res.statusCode !== 200) {
    res.resume();
    throw new Error(`Download failed with HTTP status ${res.statusCode}`);
  }
  const file = fss.createWriteStream(destPath);
  await new Promise((resolve, reject) => {
    res.pipe(file);
    file.on('finish', () => file.close(resolve));
    file.on('error', reject);
    res.on('error', reject);
  });
}

// ── Version helpers ──────────────────────────────────────────────────────────

// Accepts "1.6.1", "v1.6.1" and compressed tags like "161" (= 1.6.1)
function parseVersionTag(raw) {
  const v = String(raw || '').trim().replace(/^v/i, '');
  const m = v.match(/(\d+[\d.]*)/);
  if (!m) return null;
  if (!m[1].includes('.') && m[1].length === 3) {
    return [Number(m[1][0]), Number(m[1][1]), Number(m[1][2])];
  }
  return m[1].split('.').map(Number);
}

export function isNewerVersion(current, latest) {
  const c = parseVersionTag(current);
  const l = parseVersionTag(latest);
  if (!c || !l) return false;
  const len = Math.max(c.length, l.length);
  for (let i = 0; i < len; i++) {
    const cv = c[i] || 0;
    const lv = l[i] || 0;
    if (lv > cv) return true;
    if (lv < cv) return false;
  }
  return false;
}

export async function getBackendVersion() {
  const pkgRaw = await fs.readFile(new URL('../package.json', import.meta.url), 'utf-8');
  return JSON.parse(pkgRaw).version;
}

// ── Environment detection ────────────────────────────────────────────────────

export function detectEnvironment() {
  const isDocker = fss.existsSync('/.dockerenv');
  const platform = process.platform === 'win32' ? 'windows' : (isDocker ? 'docker' : 'linux');

  // Native modes run with cwd = project root. Anchor on backend/package.json,
  // falling back to the parent folder when started from backend/.
  let rootDir = process.cwd();
  if (!fss.existsSync(path.join(rootDir, 'backend', 'package.json'))) {
    const parent = path.dirname(rootDir);
    if (fss.existsSync(path.join(parent, 'backend', 'package.json'))) rootDir = parent;
  }

  // Inside Docker the project root must be bind-mounted on /host/project
  let projectRoot = rootDir;
  if (platform === 'docker') {
    const hostRoot = '/host/project';
    projectRoot = fss.existsSync(path.join(hostRoot, 'backend')) ? hostRoot : null;
  }

  return {
    platform,
    rootDir,
    projectRoot: projectRoot || rootDir,
    canApply: platform !== 'docker' || Boolean(projectRoot)
  };
}

// ── Zip extraction (no external npm deps) ────────────────────────────────────

export async function extractZipNative(zipPath, targetDir) {
  if (process.platform === 'win32') {
    const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`;
    const cmd =
      `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(targetDir)} -Force`;
    await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', cmd]);
    return 'powershell';
  }
  // Linux / Docker: try unzip first, then python3 (present in the backend image)
  try {
    await execFileP('unzip', ['-o', zipPath, '-d', targetDir]);
    return 'unzip';
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      await execFileP('python3', ['-m', 'zipfile', '-e', zipPath, targetDir]);
      return 'python3';
    }
    throw err;
  }
}

function execFileP(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: 10 * 60 * 1000, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

// ── Staging: download + extract the release ──────────────────────────────────

export function isAllowedDownloadUrl(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === 'https:' && ALLOWED_DOWNLOAD_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

export async function stageUpdate(downloadUrl) {
  const env = detectEnvironment();
  if (!env.canApply) {
    throw new Error(
      'Docker update not available: bind-mount the project root by adding ' +
      '"- .:/host/project" to the backend volumes in docker-compose.yml.'
    );
  }

  const tempDir = path.join(env.projectRoot, 'temp_update');
  const stagedRoot = path.join(tempDir, 'staged');
  const zipPath = path.join(tempDir, 'release.zip');
  const logFile = path.join(tempDir, 'update.log');

  await appendLog(logFile, `── staging update from ${downloadUrl} ──`);
  await fs.mkdir(stagedRoot, { recursive: true });

  // Clean any previous staged content
  await fs.rm(stagedRoot, { recursive: true, force: true });
  await fs.rm(zipPath, { force: true });
  await fs.mkdir(stagedRoot, { recursive: true });

  await appendLog(logFile, 'downloading release zip...');
  await downloadToFile(downloadUrl, zipPath);

  await appendLog(logFile, 'extracting release zip...');
  const extractor = await extractZipNative(zipPath, stagedRoot);
  await appendLog(logFile, `extraction done via ${extractor}`);

  // GitHub zips wrap content in a single top folder (e.g. zsectools-main-v161/)
  const entries = await fs.readdir(stagedRoot, { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const files = entries.filter((e) => e.isFile()).map((e) => e.name);
  const stagedDir = dirs.length === 1 && files.length === 0
    ? path.join(stagedRoot, dirs[0])
    : stagedRoot;

  // Persist staging metadata (used for diagnostics)
  const info = {
    downloadUrl,
    stagedDir,
    rootDir: env.projectRoot,
    platform: env.platform,
    stagedAt: new Date().toISOString(),
    pid: process.pid
  };
  await fs.writeFile(path.join(tempDir, 'update-info.json'), JSON.stringify(info, null, 2), 'utf-8');

  return { ...env, tempDir, stagedDir, logFile };
}

// ── Logging + process helpers ────────────────────────────────────────────────

async function appendLog(logFile, message) {
  try {
    await fs.appendFile(logFile, `[${new Date().toISOString()}] ${message}\n`, 'utf-8');
  } catch {
    /* logging must never break the update */
  }
}

function runLogged(cmd, args, cwd, logFile, timeoutMs = 10 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, windowsHide: true, shell: process.platform === 'win32' && cmd.endsWith('.cmd') });
    let out = '';
    const collect = (buf) => { out += buf.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ code: -1, timedOut: true, output: out });
    }, timeoutMs);
    child.on('error', async (err) => {
      clearTimeout(timer);
      await appendLog(logFile, `${cmd} spawn error: ${err.message}`);
      resolve({ code: -1, spawnError: true, output: out });
    });
    child.on('close', async (code) => {
      clearTimeout(timer);
      if (out.trim()) await appendLog(logFile, out.trim());
      resolve({ code, timedOut: false, output: out });
    });
  });
}

// ── Apply: shared filesystem steps ───────────────────────────────────────────

function copyFilter(src) {
  const base = path.basename(src);
  if (fss.statSync(src).isDirectory()) return !EXCLUDED_DIRS.has(base);
  return !EXCLUDED_FILES.has(base);
}

async function copyTree(srcDir, destDir, logFile) {
  await appendLog(logFile, `copying files: ${srcDir} -> ${destDir}`);
  await fs.cp(srcDir, destDir, {
    recursive: true,
    force: true,
    filter: copyFilter
  });
  // Restore the executable bit on shell scripts (zip does not preserve it)
  if (process.platform !== 'win32') {
    const candidates = ['run.sh', 'setup.sh', 'install-services.sh'];
    for (const rel of candidates) {
      const p = path.join(destDir, rel);
      if (fss.existsSync(p)) await fs.chmod(p, 0o755).catch(() => {});
    }
    const be = path.join(destDir, 'backend', 'docker-entrypoint.sh');
    if (fss.existsSync(be)) await fs.chmod(be, 0o755).catch(() => {});
  }
  await appendLog(logFile, 'copy done');
}

async function npmInstallBackend(stage) {
  const logFile = stage.logFile;
  // In Docker, npm must run in /app so that dependencies land in the
  // persistent node_modules volume (not on the host folder).
  const backendDir = stage.platform === 'docker' ? '/app' : path.join(stage.projectRoot, 'backend');
  await appendLog(logFile, 'npm install (backend)...');
  const res = await runLogged('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], backendDir, logFile);
  await appendLog(logFile, `backend npm install exit code: ${res.code}${res.timedOut ? ' (TIMEOUT)' : ''}`);
  return res.code === 0;
}

async function buildFrontend(stage) {
  const logFile = stage.logFile;
  const frontendDir = path.join(stage.projectRoot, 'frontend');

  if (stage.platform === 'docker') {
    await appendLog(logFile, 'docker mode: frontend is served by the vite dev container, skipping build.');
    return true;
  }

  await appendLog(logFile, 'npm install (frontend)...');
  await runLogged('npm', ['install', '--no-audit', '--no-fund'], frontendDir, logFile);

  // Build to dist_new first and swap only on success, so a failed build
  // never leaves the application with a wiped frontend.
  await appendLog(logFile, 'building frontend (vite -> dist_new)...');
  const build = await runLogged(
    'npx', ['vite', 'build', '--outDir', 'dist_new', '--emptyOutDir'],
    frontendDir, logFile
  );
  await appendLog(logFile, `frontend build exit code: ${build.code}${build.timedOut ? ' (TIMEOUT)' : ''}`);

  const dist = path.join(frontendDir, 'dist');
  const distNew = path.join(frontendDir, 'dist_new');
  if (build.code === 0 && fss.existsSync(distNew)) {
    try {
      if (fss.existsSync(dist)) await fs.rm(dist, { recursive: true, force: true });
      await fs.rename(distNew, dist);
      await appendLog(logFile, 'frontend dist swapped.');
      return true;
    } catch (err) {
      await appendLog(logFile, `dist swap failed: ${err.message}`);
      return false;
    }
  }
  await appendLog(logFile, 'frontend build failed or missing output: previous dist kept.');
  return false;
}

// ── Apply: Windows (WinSW service or standalone) ─────────────────────────────

export function buildWindowsApplyScript(stage) {
  const root = stage.projectRoot;
  const src = stage.stagedDir;
  const log = stage.logFile;
  const pid = process.pid;

  // NOTE: written with CRLF line endings; the wait loop intentionally avoids
  // parenthesized blocks so no delayed expansion is required.
  return [
    '@echo off',
    'setlocal EnableExtensions',
    `set "ROOT=${root}"`,
    `set "SRC=${src}"`,
    `set "LOG=${log}"`,
    `set "OLDPID=${pid}"`,
    'set "NODEBIN=%ROOT%\\node-bin"',
    'set "PATH=%NODEBIN%;%PATH%"',
    'set /a TRIES=0',
    '',
    `echo [%date% %time%] updater: waiting for backend process %OLDPID% to exit...> "%LOG%"`,
    ':waitloop',
    'tasklist /FI "PID eq %OLDPID%" 2>nul | find /I "%OLDPID%" >nul',
    'if not %errorlevel%==0 goto waited',
    'set /a TRIES+=1',
    'if %TRIES% GEQ 60 goto waited',
    'ping -n 2 127.0.0.1 >nul',
    'goto waitloop',
    ':waited',
    'echo [%date% %time%] updater: backend stopped.>> "%LOG%"',
    '',
    'sc query ZSecTools_Backend >nul 2>&1',
    'if %errorlevel%==0 net stop ZSecTools_Backend >> "%LOG%" 2>&1',
    '',
    'echo [%date% %time%] updater: copying new files...>> "%LOG%"',
    'robocopy "%SRC%" "%ROOT%" /E ^',
    '  /XD node_modules .git temp_update CodeSecurity postgres node-bin TABLES-EXPORT logs dist_old dist_new ^',
    '  /XF .env pwfile.txt SAP-TABLE-LIST.txt update.log apply-update.cmd installation_log.txt node.zip postgres.zip >> "%LOG%" 2>&1',
    'echo robocopy exit code: %errorlevel% >> "%LOG%"',
    '',
    'echo [%date% %time%] updater: installing backend dependencies...>> "%LOG%"',
    'pushd "%ROOT%\\backend"',
    'if exist "%NODEBIN%\\npm.cmd" (',
    '  call "%NODEBIN%\\npm.cmd" install --ignore-scripts --no-audit --no-fund >> "%LOG%" 2>&1',
    ') else (',
    '  call npm install --ignore-scripts --no-audit --no-fund >> "%LOG%" 2>&1',
    ')',
    'echo backend npm install exit code: %errorlevel% >> "%LOG%"',
    'popd',
    '',
    'echo [%date% %time%] updater: rebuilding frontend...>> "%LOG%"',
    'pushd "%ROOT%\\frontend"',
    'if exist "%NODEBIN%\\npm.cmd" (',
    '  call "%NODEBIN%\\npm.cmd" install --no-audit --no-fund >> "%LOG%" 2>&1',
    '  call "%NODEBIN%\\npm.cmd" run build -- --outDir dist_new --emptyOutDir >> "%LOG%" 2>&1',
    ') else (',
    '  call npm install --no-audit --no-fund >> "%LOG%" 2>&1',
    '  call npm run build -- --outDir dist_new --emptyOutDir >> "%LOG%" 2>&1',
    ')',
    'echo frontend build exit code: %errorlevel% >> "%LOG%"',
    'if exist "%ROOT%\\frontend\\dist_new" (',
    '  if exist "%ROOT%\\frontend\\dist" ren "%ROOT%\\frontend\\dist" "dist_old"',
    '  ren "%ROOT%\\frontend\\dist_new" "dist"',
    '  if exist "%ROOT%\\frontend\\dist_old" rmdir /s /q "%ROOT%\\frontend\\dist_old"',
    ')',
    'popd',
    '',
    'echo [%date% %time%] updater: restarting backend...>> "%LOG%"',
    'sc query ZSecTools_Backend >nul 2>&1',
    'if %errorlevel%==0 (',
    '  net start ZSecTools_Backend >> "%LOG%" 2>&1',
    ') else (',
    '  start "ZSecTools Backend" /D "%ROOT%" "%NODEBIN%\\node.exe" ".\\backend\\src\\server.js"',
    ')',
    'echo [%date% %time%] updater: done.>> "%LOG%"',
    'exit /b 0',
    ''
  ].join('\r\n');
}

async function applyOnWindows(stage) {
  const tempDir = path.dirname(stage.logFile);
  const scriptPath = path.join(tempDir, 'apply-update.cmd');
  await fs.writeFile(scriptPath, buildWindowsApplyScript(stage), 'utf-8');

  // Detached: must survive the death of this node process
  const child = spawn('cmd.exe', ['/d', '/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    cwd: tempDir,
    windowsHide: true
  });
  child.unref();
  await appendLog(stage.logFile, `apply-update.cmd spawned (pid ${child.pid}).`);
  return { restartMode: 'script' };
}

// ── Apply: Linux / Docker (in-place, then exit) ──────────────────────────────

async function applyOnUnix(stage) {
  await copyTree(stage.stagedDir, stage.projectRoot, stage.logFile);
  await npmInstallBackend(stage);
  await buildFrontend(stage);
  await appendLog(stage.logFile, 'in-place apply completed.');
  return { restartMode: 'in-process' };
}

export async function applyStagedUpdate(stage) {
  if (stage.platform === 'windows') return applyOnWindows(stage);
  return applyOnUnix(stage);
}

// Called once at backend startup: removes the bulky staged copy of the last
// update while keeping update-info.json / update.log for diagnostics.
export async function cleanupStagedArtifacts() {
  try {
    const env = detectEnvironment();
    const stagedRoot = path.join(env.projectRoot, 'temp_update', 'staged');
    const zipPath = path.join(env.projectRoot, 'temp_update', 'release.zip');
    await fs.rm(stagedRoot, { recursive: true, force: true });
    await fs.rm(zipPath, { force: true });
  } catch {
    /* never block startup */
  }
}

// ── Release resolution (used by /api/settings/check-update) ──────────────────

export async function resolveLatestRelease() {
  const currentVersion = await getBackendVersion();
  const release = await fetchGithubJson(GITHUB_API_LATEST);

  if (release.notFound) {
    return {
      currentVersion,
      latestVersion: currentVersion,
      latestTag: null,
      hasUpdate: false,
      downloadUrl: null,
      releaseUrl: null,
      releaseNotes: null,
      message: 'No published releases found on GitHub.'
    };
  }

  const latestTag = release.tag_name || '';
  const latestVersion = (parseVersionTag(latestTag) || []).join('.') || currentVersion;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const zipAsset = assets.find((a) => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip'));
  const downloadUrl = zipAsset ? zipAsset.browser_download_url : release.zipball_url || null;
  const hasUpdate = isNewerVersion(currentVersion, latestVersion);

  return {
    currentVersion,
    latestVersion,
    latestTag,
    hasUpdate,
    downloadUrl,
    releaseUrl: release.html_url || null,
    releaseNotes: release.body || null
  };
}
