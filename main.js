// IFASY Launcher — Electron main process
// Login, two channels (LIVE/PTB), game download/install, self-update,
// persisted auto-login session, friends/messaging bridge.
const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
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
function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 1040,
    minHeight: 640,
    frame: false,
    backgroundColor: '#06080d',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

// ---- window controls (custom titlebar) ----
ipcMain.on('win:minimize', () => win && win.minimize());
ipcMain.on('win:close', () => win && win.close());

// ---- login against existing backend ----
ipcMain.handle('login', async (_e, identifier, password) => {
  try {
    const res = await fetch(API_BASE + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: identifier, email: identifier, password }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'bad_response' }));
    // persist session for auto-login on next launch
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
    // expired / invalid -> clear and fall back to login
    patchStore({ token: null, user: null });
    return { ok: false, error: 'expired' };
  } catch (e) {
    // offline: keep token, but report so UI can decide (show login)
    return { ok: false, error: 'network_error', offline: true };
  }
});
ipcMain.handle('session:token', () => readStore().token || null);
ipcMain.handle('session:logout', () => { patchStore({ token: null, user: null }); return { ok: true }; });

// ---- social API proxy (friends + messages) — keeps token in main, CSP clean ----
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

// ---- open the game download (in-app stream+extract comes later) ----
ipcMain.handle('download-game', async (_e, channel) => {
  const url = API_BASE + '/download' + (channel === 'ptb' ? '?channel=ptb' : '');
  await shell.openExternal(url);
  return { ok: true };
});

// ---- install location: get / pick / compute target path ----
function defaultBasePath() {
  // <Documents>/IFASY-LAUNCHER/  (always ends in IFASY-LAUNCHER)
  return path.join(app.getPath('documents'), 'IFASY-LAUNCHER');
}
function ensureBaseSuffix(p) {
  // base path ALWAYS ends in IFASY-LAUNCHER
  const norm = path.normalize(p);
  if (path.basename(norm).toUpperCase() === 'IFASY-LAUNCHER') return norm;
  return path.join(norm, 'IFASY-LAUNCHER');
}
function clientPath(base, channel) {
  return path.join(base, 'client', channel === 'ptb' ? 'ptb' : 'live');
}
ipcMain.handle('install:get-base', () => {
  const s = readStore();
  const base = s.installBase || defaultBasePath();
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
// First-version install: prepare the target dir and open the official download.
// (Full in-launcher stream+extract is a later phase; this lays the path foundation.)
ipcMain.handle('install:start', async (_e, channel) => {
  const s = readStore();
  const base = ensureBaseSuffix(s.installBase || defaultBasePath());
  const target = clientPath(base, channel);
  try { fs.mkdirSync(target, { recursive: true }); } catch (e) { return { ok: false, error: 'mkdir_failed', detail: String(e && e.message || e) }; }
  patchStore({ installBase: base });
  const url = API_BASE + '/download' + (channel === 'ptb' ? '?channel=ptb' : '');
  await shell.openExternal(url);
  return { ok: true, base, target };
});

// ---- launcher self-update ----
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('checking-for-update', () => win && win.webContents.send('upd:checking'));
autoUpdater.on('update-available', (i) => win && win.webContents.send('upd:available', i.version));
autoUpdater.on('update-downloaded', (i) => win && win.webContents.send('upd:downloaded', i.version));
autoUpdater.on('download-progress', (p) => win && win.webContents.send('upd:progress', Math.round(p.percent || 0)));
autoUpdater.on('error', (e) => win && win.webContents.send('upd:error', String(e && e.message || e)));
autoUpdater.on('update-not-available', () => win && win.webContents.send('upd:none'));

ipcMain.handle('launcher:check-update', async () => {
  try { const r = await autoUpdater.checkForUpdates(); return { ok: true, version: r && r.updateInfo && r.updateInfo.version }; }
  catch (e) { return { ok: false, error: String(e && e.message || e) }; }
});
ipcMain.on('launcher:install-update', () => autoUpdater.quitAndInstall());
ipcMain.handle('launcher:version', () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  // Robust update: also run an automatic check shortly after launch (works on
  // both the login screen and after auto-login). Errors are reported to the UI.
  setTimeout(() => { autoUpdater.checkForUpdates().catch((e) => { win && win.webContents.send('upd:error', String(e && e.message || e)); }); }, 4000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
