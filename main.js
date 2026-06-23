// IFASY Launcher — Electron main process
// Real desktop launcher: login, two channels (LIVE/PTB), game download, self-update.
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const API_BASE = 'https://app.ifasy.com'; // login + game version manifest

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1120,
    height: 700,
    minWidth: 1000,
    minHeight: 620,
    frame: false,                 // custom titlebar (Gameforge look)
    backgroundColor: '#0b0d13',
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
    return { status: res.status, data: await res.json().catch(() => ({ ok: false, error: 'bad_response' })) };
  } catch (e) {
    return { status: 0, data: { ok: false, error: 'network_error' } };
  }
});

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

// ---- open the game download (coded downloads.ifasy.com URL later; /download for now) ----
ipcMain.handle('download-game', async (_e, channel) => {
  // Phase 4 will stream+extract+launch in-app. For now open the official download.
  const url = API_BASE + '/download' + (channel === 'ptb' ? '?channel=ptb' : '');
  await shell.openExternal(url);
  return { ok: true };
});

// ---- launcher self-update (⚙️) ----
autoUpdater.autoDownload = true;
autoUpdater.on('update-available', (i) => win && win.webContents.send('upd:available', i.version));
autoUpdater.on('update-downloaded', (i) => win && win.webContents.send('upd:downloaded', i.version));
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
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
