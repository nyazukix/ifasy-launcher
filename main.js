// IFASY Launcher — Electron main process
// Login, two channels (LIVE/PTB), game download/install with progress+throttle,
// self-update, persisted auto-login, friends/messaging bridge, tray + window controls.
const { app, BrowserWindow, ipcMain, shell, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { autoUpdater } = require('electron-updater');

const API_BASE = 'https://app.ifasy.com'; // backend: login, update manifest, social API

// ---- persisted store (zero-dep JSON file in userData) ----
const STORE_PATH = path.join(app.getPath('userData'), 'ifasy-launcher.json');
function readStore() {
  try { return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8')); } catch (e) { return {}; }
}
function writeStore(obj) {
  try { fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true }); fs.writeFileSync(STORE_PATH, JSON.stringify(obj, null, 2)); return true; }
  catch (e) { return false; }
}
function patchStore(patch) { const s = readStore(); const n = { ...s, ...patch }; writeStore(n); return n; }

let win;
let tray = null;
let isQuiting = false; // true only when the user really wants to quit (tray -> Quit)

function iconPath() {
  // packaged: build/icon.ico ends up next to resources; use the source path in dev/build
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(process.resourcesPath || '', 'icon.ico'),
  ];
  for (const c of candidates) { try { if (c && fs.existsSync(c)) return c; } catch (e) {} }
  return candidates[0];
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 1040,
    minHeight: 640,
    frame: false,
    backgroundColor: '#06080d',
    show: false,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });

  // X -> minimize to tray instead of quitting
  win.on('close', (e) => {
    if (!isQuiting) { e.preventDefault(); win.hide(); }
  });
  // keep the renderer in sync with the maximize state
  win.on('maximize', () => win.webContents.send('win:state', { maximized: true }));
  win.on('unmaximize', () => win.webContents.send('win:state', { maximized: false }));
}

function createTray() {
  let img;
  try { img = nativeImage.createFromPath(iconPath()); } catch (e) { img = nativeImage.createEmpty(); }
  tray = new Tray(img);
  tray.setToolTip('IFASY Launcher');
  const menu = Menu.buildFromTemplate([
    { label: 'IFASY Launcher öffnen', click: () => showWindow() },
    { type: 'separator' },
    { label: 'Beenden', click: () => { isQuiting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}
function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---- window controls (custom titlebar) ----
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:maximize', () => {
  if (!win) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.handle('win:is-maximized', () => !!(win && win.isMaximized()));
// X -> hide to tray (does not quit)
ipcMain.on('win:close', () => { if (win) win.hide(); });

// ---- login against existing backend ----
ipcMain.handle('login', async (_e, identifier, password) => {
  try {
    const res = await fetch(API_BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: identifier, email: identifier, password }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
    if (data && data.ok && data.token) patchStore({ token: data.token, user: data.user || null });
    return { status: res.status, data };
  } catch (e) {
    return { status: 0, data: { ok: false, error: 'network_error' } };
  }
});

// ---- auto-login: validate the persisted token on launch ----
ipcMain.handle('session:restore', async () => {
  const s = readStore();
  if (!s.token) return { ok: false, error: 'no_session' };
  try {
    const res = await fetch(API_BASE + '/api/me?token=' + encodeURIComponent(s.token), { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({ ok: false }));
    if (res.ok && data && data.ok) { patchStore({ user: data.user }); return { ok: true, user: data.user, token: s.token }; }
    patchStore({ token: null, user: null });
    return { ok: false, error: 'expired' };
  } catch (e) {
    return { ok: false, error: 'network_error', offline: true };
  }
});
ipcMain.handle('session:token', () => readStore().token || null);
ipcMain.handle('session:logout', () => { patchStore({ token: null, user: null }); return { ok: true }; });

// ---- social API proxy (friends + messages) ----
async function socialFetch(method, endpoint, payload) {
  const token = readStore().token;
  if (!token) return { ok: false, error: 'no_session' };
  try {
    if (method === 'GET') {
      const url = API_BASE + endpoint + (endpoint.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      return await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
    }
    const res = await fetch(API_BASE + endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...(payload || {}), token }),
    });
    return await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
  } catch (e) {
    return { ok: false, error: 'network_error' };
  }
}
ipcMain.handle('social:overview', () => socialFetch('GET', '/api/social/overview'));
ipcMain.handle('social:request', (_e, who) => socialFetch('POST', '/api/social/request', who));
ipcMain.handle('social:accept', (_e, user_id) => socialFetch('POST', '/api/social/accept', { user_id }));
ipcMain.handle('social:decline', (_e, user_id) => socialFetch('POST', '/api/social/decline', { user_id }));
ipcMain.handle('social:remove', (_e, user_id) => socialFetch('POST', '/api/social/remove', { user_id }));
ipcMain.handle('social:messages', (_e, withId, after) => socialFetch('GET', '/api/social/messages?with=' + encodeURIComponent(withId) + (after ? '&after=' + encodeURIComponent(after) : '')));
ipcMain.handle('social:send', (_e, to, body) => socialFetch('POST', '/api/social/messages', { to, body }));

// ---- game version per channel (live | ptb) ----
ipcMain.handle('game-version', async (_e, channel) => {
  try {
    const url = API_BASE + '/api/update' + (channel === 'ptb' ? '?channel=ptb' : '');
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return await res.json();
  } catch (e) {
    return { available: false, error: 'network_error' };
  }
});

// ---- install location helpers ----
function defaultBasePath() { return path.join(app.getPath('documents'), 'IFASY-LAUNCHER'); }
function ensureBaseSuffix(p) {
  const norm = path.normalize(p);
  if (path.basename(norm).toUpperCase() === 'IFASY-LAUNCHER') return norm;
  return path.join(norm, 'IFASY-LAUNCHER');
}
function clientPath(base, channel) { return path.join(base, 'client', channel === 'ptb' ? 'ptb' : 'live'); }

ipcMain.handle('install:get-base', () => {
  const s = readStore();
  const base = ensureBaseSuffix(s.installBase || defaultBasePath());
  return { base, default: defaultBasePath() };
});
ipcMain.handle('install:pick-folder', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'IFASY Installationsordner wählen',
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Hier installieren',
  });
  if (res.canceled || !res.filePaths || !res.filePaths[0]) return { ok: false, canceled: true };
  const base = ensureBaseSuffix(res.filePaths[0]);
  patchStore({ installBase: base });
  return { ok: true, base };
});
ipcMain.handle('install:use-default', () => {
  const base = defaultBasePath();
  patchStore({ installBase: base });
  return { ok: true, base };
});

// installed-version bookkeeping per channel
function getInstalled() { return readStore().installed || {}; }
ipcMain.handle('install:status', (_e, channel) => {
  const s = readStore();
  const installed = (s.installed || {})[channel] || null;
  const base = ensureBaseSuffix(s.installBase || defaultBasePath());
  const target = clientPath(base, channel);
  // onDisk = real installed payload present, IGNORING incomplete *.download partials
  // (a cancelled/failed download must not look "installed").
  let onDisk = false;
  try {
    if (fs.existsSync(target)) {
      const real = fs.readdirSync(target).filter((f) => !f.endsWith('.download'));
      onDisk = real.length > 0;
    }
  } catch (e) {}
  // Authoritative: installed only when the store recorded a completed install.
  return { installedVersion: installed, base, target, onDisk: onDisk && !!installed };
});

// ---- download settings (throttle) ----
ipcMain.handle('settings:get', () => {
  const s = readStore();
  return { maxRateMBps: s.maxRateMBps || 0 }; // 0 = unlimited
});
ipcMain.handle('settings:set-rate', (_e, mbps) => {
  const v = Math.max(0, Number(mbps) || 0);
  patchStore({ maxRateMBps: v });
  return { ok: true, maxRateMBps: v };
});

// ---- game download with progress / ETA / speed / throttle ----
let activeDownload = null; // { abort, filePath, channel }
function fmtSend(ch, payload) { win && win.webContents.send('dl:' + ch, payload); }
function cleanupPartial(filePath) { try { if (filePath && fs.existsSync(filePath)) fs.rmSync(filePath, { force: true }); } catch (e) {} }

ipcMain.handle('install:cancel', () => {
  if (activeDownload && activeDownload.abort) { try { activeDownload.abort.abort(); } catch (e) {} }
  return { ok: true };
});

// Streams the game build to <base>/client/<channel>/ with live progress + optional throttle.
// NOTE: the game build is not published yet; this path is fully wired and gated by the UI
// (which only enables it when /api/update reports available=true).
ipcMain.handle('install:start', async (_e, channel, version) => {
  const s = readStore();
  const base = ensureBaseSuffix(s.installBase || defaultBasePath());
  const target = clientPath(base, channel);
  try { fs.mkdirSync(target, { recursive: true }); } catch (e) { return { ok: false, error: 'mkdir_failed', detail: String(e && e.message || e) }; }
  patchStore({ installBase: base });

  if (activeDownload) { return { ok: false, error: 'download_in_progress' }; }
  const url = API_BASE + '/download' + (channel === 'ptb' ? '?channel=ptb' : '');
  const maxRate = (readStore().maxRateMBps || 0) * 1024 * 1024; // bytes/sec, 0 = unlimited
  const abort = new AbortController();
  const filePath = path.join(target, 'ifasy-game-' + channel + '.download');
  activeDownload = { abort, filePath, channel };
  let out = null;

  try {
    const res = await fetch(url, { signal: abort.signal, redirect: 'follow' });
    if (!res.ok || !res.body) { activeDownload = null; cleanupPartial(filePath); return { ok: false, error: 'download_unavailable', status: res.status }; }
    const total = Number(res.headers.get('content-length') || 0);
    out = fs.createWriteStream(filePath);

    let received = 0;
    const startedAt = Date.now();
    let lastTick = startedAt;
    let lastBytes = 0;

    const reader = res.body.getReader();
    // simple token-bucket throttle: cap bytes per second
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.length;
      out.write(Buffer.from(value));

      // progress / speed / ETA (throttle UI updates to ~4/sec)
      const now = Date.now();
      if (now - lastTick >= 250) {
        const speed = (received - lastBytes) / ((now - lastTick) / 1000); // bytes/sec
        const pct = total ? Math.min(100, (received / total) * 100) : 0;
        const remaining = total && speed > 0 ? (total - received) / speed : 0;
        fmtSend('progress', {
          channel, received, total,
          percent: Math.round(pct * 10) / 10,
          speedMBps: Math.round((speed / 1048576) * 100) / 100,
          etaSec: Math.round(remaining),
        });
        lastTick = now; lastBytes = received;
      }

      // throttle: keep the cumulative average under maxRate (bytes/sec) by
      // sleeping whenever we're ahead of the allowed byte budget for the
      // elapsed time. Sleep is capped at 1s per chunk so the UI stays live.
      if (maxRate > 0) {
        const overallElapsed = (now - startedAt) / 1000;
        const overallAllowed = maxRate * Math.max(overallElapsed, 0.001);
        if (received > overallAllowed) {
          const sleepMs = ((received - overallAllowed) / maxRate) * 1000;
          if (sleepMs > 0) await new Promise((r) => setTimeout(r, Math.min(sleepMs, 1000)));
        }
      }
    }
    await new Promise((r) => out.end(r));
    activeDownload = null;

    // mark installed (in a later phase we extract; for now we record the version + keep the file)
    const installed = getInstalled();
    installed[channel] = version || true;
    patchStore({ installed });
    fmtSend('done', { channel, target, file: filePath, version: version || null });
    return { ok: true, base, target, file: filePath };
  } catch (e) {
    activeDownload = null;
    // close the stream then remove the partial file so it never looks "installed"
    try { if (out) out.destroy(); } catch (_) {}
    cleanupPartial(filePath);
    if (e && e.name === 'AbortError') { fmtSend('cancelled', { channel }); return { ok: false, error: 'cancelled' }; }
    fmtSend('error', { channel, message: String(e && e.message || e) });
    return { ok: false, error: 'download_failed', detail: String(e && e.message || e) };
  }
});

// ---- launch the game (passes the session token + username to the UE client) ----
// The UE game's UIFASYBackend subsystem reads the logged-in account from CLI args:
//   <game>.exe -ifasytoken=<JWT> -ifasyuser=<username>
// so the in-game hub (friends/lobby/clan/outfit) uses the SAME session as the launcher.
// The game build does not exist yet — when present at client/<channel>/IFASY.exe this
// spawns it; until then it reports game_missing (UI keeps the install/play state sane).
function findGameExe(target) {
  // recommended: client/<ch>/IFASY.exe ; fall back to the first *.exe in the dir
  const preferred = path.join(target, 'IFASY.exe');
  try { if (fs.existsSync(preferred)) return preferred; } catch (e) {}
  try {
    const exe = fs.readdirSync(target).find((f) => f.toLowerCase().endsWith('.exe'));
    if (exe) return path.join(target, exe);
  } catch (e) {}
  return null;
}
ipcMain.handle('install:launch', async (_e, channel) => {
  const s = readStore();
  const base = ensureBaseSuffix(s.installBase || defaultBasePath());
  const target = clientPath(base, channel);
  const exe = findGameExe(target);
  if (!exe) return { ok: false, error: 'game_missing' };
  const token = s.token || '';
  const username = (s.user && (s.user.username || s.user.email)) || '';
  // MUST pass the auth token + username so the in-game backend bridge is logged in.
  const args = [];
  if (token) args.push('-ifasytoken=' + token);
  if (username) args.push('-ifasyuser=' + username);
  if (channel === 'ptb') args.push('-ptb');
  try {
    const child = spawn(exe, args, { cwd: path.dirname(exe), detached: true, stdio: 'ignore' });
    child.unref();
    return { ok: true, launched: true };
  } catch (e) {
    return { ok: false, error: 'launch_failed', detail: String(e && e.message || e) };
  }
});

// ---- uninstall: remove the client dir for a channel ----
ipcMain.handle('install:uninstall', async (_e, channel) => {
  const s = readStore();
  const base = ensureBaseSuffix(s.installBase || defaultBasePath());
  const target = clientPath(base, channel);
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) { return { ok: false, error: 'rm_failed', detail: String(e && e.message || e) }; }
  const installed = getInstalled();
  delete installed[channel];
  patchStore({ installed });
  return { ok: true };
});

// fallback: open the official download in the browser
ipcMain.handle('download-game', async (_e, channel) => {
  const url = API_BASE + '/download' + (channel === 'ptb' ? '?channel=ptb' : '');
  await shell.openExternal(url);
  return { ok: true };
});

// ---- launcher self-update ----
let updateAvailableVersion = null;
let updateDownloaded = false;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => win && win.webContents.send('upd:checking'));
autoUpdater.on('update-available', (i) => { updateAvailableVersion = i.version; updateDownloaded = false; win && win.webContents.send('upd:available', i.version); });
autoUpdater.on('update-downloaded', (i) => { updateAvailableVersion = i.version; updateDownloaded = true; win && win.webContents.send('upd:downloaded', i.version); });
autoUpdater.on('download-progress', (p) => win && win.webContents.send('upd:progress', Math.round(p.percent || 0)));
autoUpdater.on('error', (e) => win && win.webContents.send('upd:error', String(e && e.message || e)));
autoUpdater.on('update-not-available', () => win && win.webContents.send('upd:none'));

ipcMain.handle('launcher:check-update', async () => {
  try {
    const r = await autoUpdater.checkForUpdates();
    const remote = r && r.updateInfo && r.updateInfo.version;
    const current = app.getVersion();
    // checkForUpdates resolves even mid-download; report a definitive state so the
    // UI never dead-ends on "wird geladen…".
    const hasUpdate = !!(remote && remote !== current);
    return { ok: true, version: remote, current, hasUpdate, downloaded: !!updateDownloaded };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
});
ipcMain.on('launcher:install-update', () => { isQuiting = true; autoUpdater.quitAndInstall(); });
ipcMain.handle('launcher:version', () => app.getVersion());
ipcMain.handle('launcher:update-available', () => updateAvailableVersion);
ipcMain.handle('launcher:update-state', () => ({ version: updateAvailableVersion, downloaded: updateDownloaded, current: app.getVersion() }));

app.whenReady().then(() => {
  createWindow();
  createTray();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); else showWindow(); });
  // Robust update: auto-check shortly after launch (works on login screen + after auto-login).
  setTimeout(() => { autoUpdater.checkForUpdates().catch((e) => { win && win.webContents.send('upd:error', String(e && e.message || e)); }); }, 4000);
});
// Closing all windows must NOT quit (we live in the tray). Real quit is via tray -> Beenden.
app.on('window-all-closed', () => { /* stay alive in tray */ });
app.on('before-quit', () => { isQuiting = true; });
