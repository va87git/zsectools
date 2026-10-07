// ─────────────────────────────────────────────────────────────────────────────
// updater.js — self-update support for ZSecTools
//
// Update flow (deliberately simple — 3 steps, 1 optional extra):
//   1. DOWNLOAD  : the release zip is fetched (GitHub asset, with automatic
//                  mirror fallback: codeload -> github archive -> api zipball)
//                  and extracted into temp_update/staged. Behind TLS-inspecting
//                  proxies (Zscaler): set ALLOW_INSECURE_TLS=true in .env;
//                  optional GITHUB_TOKEN raises the GitHub API rate limit.
//   2. OVERWRITE : the new files are copied over the project folder. Runtime
//                  data is NEVER touched (.env, pwfile.txt, SAP-TABLE-LIST.txt,
//                  postgres, node-bin, node_modules, CodeSecurity, temp_update,
//                  logs, ...). On Windows robocopy /R:1 /W:1 is used, so a
//                  locked file (e.g. run.bat being executed) can never stall
//                  the update: the file is skipped after 1 retry and reported
//                  in temp_update/update.log.
//   3. MESSAGE   : the UI shows the completion message with the restart
//                  instructions for the current platform. Nothing is killed,
//                  no console is closed, the backend keeps running.
//   4. WINDOWS ONLY: setup.bat is launched automatically in ONE new console
//                  window to recompile everything (npm install backend +
//                  frontend, vite build). The window ends with
//                  "Setup completed successfully!" and stays open.
//                  Docker/Linux just refresh the npm dependencies in the
//                  background; the user restarts the container / the app as
//                  instructed by the message.
//   5. CLEANUP   : when the flow is over (setup window closed on Windows /
//                  dependency refresh done on Docker/Linux) the whole
//                  temp_update folder is deleted. The same cleanup also runs
//                  at every backend start, as a safety net for updates that
//                  never completed.
// ─────────────────────────────────────────────────────────────────────────────

import https from 'https';
import fs from 'node:fs/promises';
import fss from 'node:fs';
import path from 'path';
import { execFile, spawn } from 'child_process';

const GITHUB_API_LATEST = 'https://api.github.com/repos/va87git/zsectools/releases/latest';

// Owner/repo derived from the API URL above (used to build the mirror URLs)
const GITHUB_REPO = (() => {
  try {
    const m = new URL(GITHUB_API_LATEST).pathname.match(/^\/repos\/([^/]+)\/([^/]+)\//);
    return m ? { owner: m[1], repo: m[2] } : { owner: 'va87git', repo: 'zsectools' };
  } catch {
    return { owner: 'va87git', repo: 'zsectools' };
  }
})();

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

// Optional GITHUB_TOKEN (.env): sent ONLY to api.github.com, never to other
// hosts (it is stripped automatically when a redirect leaves api.github.com).
function authHeadersFor(urlString) {
  try {
    const u = new URL(urlString);
    if (process.env.GITHUB_TOKEN && u.hostname === 'api.github.com') {
      return { Authorization: `Bearer ${String(process.env.GITHUB_TOKEN).trim()}` };
    }
  } catch { /* ignore malformed urls */ }
  return {};
}

// Reads (and drains) at most maxBytes of a response body: used to surface the
// first bytes of proxy block pages / GitHub error JSON inside the exception.
async function consumeBodyPeek(res, maxBytes = 600) {
  const chunks = [];
  let total = 0;
  await new Promise((resolve) => {
    res.on('data', (c) => { total += c.length; if (total <= maxBytes) chunks.push(c); });
    res.on('end', resolve);
    res.on('error', resolve);
  });
  return Buffer.concat(chunks).toString('utf8').replace(/\s+/g, ' ').trim().slice(0, maxBytes);
}

// Single https request, following up to 8 redirects (GitHub asset URLs redirect)
function httpsGet(url, headers = {}, redirectsLeft = 8) {
  return new Promise((resolve, reject) => {
    const { agent } = makeHttpsAgent();
    const req = https.get(url, { agent, headers }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && redirectsLeft > 0) {
        res.resume(); // drain
        const next = new URL(res.headers.location, url).toString();
        let nextHeaders = headers;
        try {
          // Never forward credentials to a different host
          // (e.g. api.github.com -> codeload.github.com)
          if (new URL(next).host !== new URL(url).host) {
            nextHeaders = { ...headers };
            delete nextHeaders.Authorization;
          }
        } catch { /* keep original headers */ }
        return resolve(httpsGet(next, nextHeaders, redirectsLeft - 1));
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
    'Accept': 'application/vnd.github.v3+json',
    ...authHeadersFor(url)
  });
  if (res.statusCode === 404) return { notFound: true };
  if (res.statusCode !== 200) {
    const peek = await consumeBodyPeek(res, 300);
    throw new Error(`GitHub API HTTP error: ${res.statusCode} body: "${peek}"`);
  }
  let data = '';
  for await (const chunk of res) data += chunk;
  return JSON.parse(data);
}

async function downloadToFile(url, destPath) {
  const res = await httpsGet(url, {
    'User-Agent': 'ZSecTools-Update-Download',
    'Accept': '*/*',
    ...authHeadersFor(url)
  });

  if (res.statusCode !== 200) {
    // Capture WHO refused the download: a Zscaler block page (text/html) and a
    // GitHub rate-limit JSON look completely different and need different fixes.
    const peek = await consumeBodyPeek(res);
    const ctype = String(res.headers['content-type'] || 'unknown');
    let hint = '';
    if (ctype.includes('text/html') && /zscaler|blocked|block\s?page|cloud\s?security|access\s?denied|url\s?categor/i.test(peek)) {
      hint = ' This looks like a corporate proxy BLOCK PAGE (Zscaler): the download host must be whitelisted by IT. ALLOW_INSECURE_TLS cannot bypass a policy block (TLS was not the problem here).';
    } else if (/rate limit/i.test(peek)) {
      hint = ' GitHub API rate limit exceeded for the shared corporate IP: set GITHUB_TOKEN in the .env file or retry later.';
    }
    const err = new Error(
      `Download failed with HTTP status ${res.statusCode} from ${url} ` +
      `[content-type: ${ctype}] body: "${peek}"${hint}`
    );
    err.status = res.statusCode;
    throw err;
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

// Builds the ordered list of download mirrors for a release. The first URL is
// the one chosen by the update check; the others are alternates that bypass
// api.github.com / github.com release assets, because a corporate proxy often
// blocks only some of these hosts.
function buildDownloadCandidates(primaryUrl) {
  const candidates = [];
  const push = (u) => {
    if (u && !candidates.includes(u) && isAllowedDownloadUrl(u)) candidates.push(u);
  };

  push(primaryUrl);

  try {
    const u = new URL(primaryUrl);
    // https://github.com/<owner>/<repo>/releases/download/<tag>/<file>
    const asset = u.pathname.match(/^\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(?:.*)$/);
    // https://api.github.com/repos/<owner>/<repo>/zipball/<tag>
    const zipball = u.pathname.match(/^\/repos\/([^/]+)\/([^/]+)\/zipball\/(.+)$/);
    // https://github.com/<owner>/<repo>/archive/refs/tags/<tag>.zip
    const archive = u.pathname.match(/^\/([^/]+)\/([^/]+)\/archive\/refs\/tags\/(.+?)(\.zip)?$/);

    const owner = (asset && asset[1]) || (zipball && zipball[1]) || (archive && archive[1]) || GITHUB_REPO.owner;
    const repo = (asset && asset[2]) || (zipball && zipball[2]) || (archive && archive[2]) || GITHUB_REPO.repo;
    const tag = (asset && asset[3]) || (zipball && zipball[3]) || (archive && archive[3]);

    if (tag) {
      const t = encodeURIComponent(decodeURIComponent(tag));
      // codeload serves the tag zip directly: no API, no rate limit, and it is
      // a different hostname from github.com (so a Zscaler category block on
      // one host does not necessarily apply to the other).
      push(`https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${t}`);
      push(`https://github.com/${owner}/${repo}/archive/refs/tags/${t}.zip`);
      push(`https://api.github.com/repos/${owner}/${repo}/zipball/${t}`);
    }
  } catch { /* primary URL only */ }

  return candidates;
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

  // Try every mirror until one succeeds: each attempt (including the failure
  // reason) is recorded in update.log for diagnostics.
  const candidates = buildDownloadCandidates(downloadUrl);
  await appendLog(logFile, `download mirrors: ${candidates.join(' | ')}`);

  await appendLog(logFile, 'downloading release zip...');
  let lastError = null;
  let usedUrl = null;
  for (const candidate of candidates) {
    try {
      await downloadToFile(candidate, zipPath);
      usedUrl = candidate;
      break;
    } catch (err) {
      lastError = err;
      await appendLog(logFile, `mirror failed [${candidate}]: ${err.message}`);
    }
  }

  if (!usedUrl) {
    throw new Error(
      `All download mirrors failed (${candidates.length} tried). ` +
      `Last error: ${lastError ? lastError.message : 'unknown'}`
    );
  }
  await appendLog(logFile, `release zip downloaded from ${usedUrl}`);

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
    downloadUrl: usedUrl,
    requestedUrl: downloadUrl,
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

// ── Step 2: overwrite the project files ──────────────────────────────────────

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

// Windows: one hidden robocopy run. /E copies the whole tree (no deletion of
// extra files), /R:1 /W:1 means a locked file (e.g. run.bat held open by its
// console) is retried once and then SKIPPED with a log entry — the update can
// never hang, no window is killed, nothing else is opened. Exit codes 0-7 are
// success for robocopy (1 = "files copied", which is the normal case).
async function overwriteFilesOnWindows(stage) {
  await appendLog(stage.logFile, `overwriting files (robocopy): ${stage.stagedDir} -> ${stage.projectRoot}`);
  const args = [
    stage.stagedDir, stage.projectRoot,
    '/E', '/R:1', '/W:1', '/NP',
    '/XD', ...EXCLUDED_DIRS,
    '/XF', ...EXCLUDED_FILES
  ];
  const res = await runLogged('robocopy', args, stage.projectRoot, stage.logFile);
  await appendLog(stage.logFile, `robocopy exit code: ${res.code}`);
  if (res.code >= 8) {
    throw new Error(`File copy failed (robocopy exit code ${res.code}). Details in temp_update/update.log`);
  }
}

export async function applyStagedUpdate(stage) {
  if (stage.platform === 'windows') {
    await overwriteFilesOnWindows(stage);
    return { restartMode: 'manual+setup' };
  }
  await copyTree(stage.stagedDir, stage.projectRoot, stage.logFile);
  return { restartMode: 'manual' };
}

// ── Step 4: Windows only — launch setup.bat to recompile everything ─────────

// Opens ONE new console window running setup.bat (npm install backend +
// frontend, vite build, postgres init if ever needed). The window is
// detached, so it survives this backend process, shows its own output and
// stays open on "Setup completed successfully!" (pause at the end of the
// script). Note: when the backend runs as a Windows service the window lives
// in session 0 (not visible on the desktop) — the service is simply restarted
// after the recompilation, as stated in the UI message.
export function launchWindowsSetup(stage) {
  const child = spawn('cmd.exe', ['/d', '/c', 'setup.bat'], {
    cwd: stage.projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: false
  });
  child.unref();
  appendLog(stage.logFile, `setup.bat launched in a new window (pid ${child.pid}).`);
  // When the setup window closes, the update flow is over: delete temp_update.
  // If this backend exits first (e.g. the service is restarted while setup is
  // still running), the next backend start deletes the folder anyway.
  const onSetupDone = () => { cleanupStagedArtifacts(); };
  child.on('exit', onSetupDone);
  child.on('error', onSetupDone);
  return child.pid;
}

// ── Step 4 (Docker/Linux): silent dependency refresh in the background ──────

// Keeps the container/app restart safe: without it, a restart with a stale
// node_modules volume would run new code against old dependencies.
// Docker: npm runs in /app so packages land in the persistent node_modules
// volume. Linux native: npm install backend + frontend build (dist swap).
// Windows does nothing here: setup.bat already did everything, visibly.
export async function refreshDependencies(stage) {
  if (stage.platform === 'windows') return; // cleaned when the setup window closes
  try {
    await npmInstallBackend(stage);
    if (stage.platform === 'linux') {
      await buildFrontend(stage);
    }
    await appendLog(stage.logFile, 'background dependency refresh completed.');
  } catch (err) {
    await appendLog(stage.logFile, `background dependency refresh error: ${err?.stack || err}`);
  } finally {
    // Update flow fully over: remove the transient temp_update folder.
    await cleanupStagedArtifacts();
  }
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

// Removes the whole transient temp_update folder (staged copy, release.zip,
// update-info.json, update.log). Called when the update flow is fully over
// (setup window closed on Windows / dependency refresh done on Linux-Docker)
// and once at every backend start as a safety net for updates that never
// completed. Best effort: a still-locked folder is simply retried at the next
// backend start.
export async function cleanupStagedArtifacts() {
  try {
    const env = detectEnvironment();
    await fs.rm(path.join(env.projectRoot, 'temp_update'), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 500
    });
  } catch {
    /* never block startup or the update flow */
  }
}

// ── Release resolution (used by /api/settings/check-update) ─────────────────

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
