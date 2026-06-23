// Secure bridge between the sandboxed UI and the Electron main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ifasy', {
  // auth + game
  login: (id, pw) => ipcRenderer.invoke('login', id, pw),
  gameVersion: (channel) => ipcRenderer.invoke('game-version', channel),
  downloadGame: (channel) => ipcRenderer.invoke('download-game', channel),
  // launcher self-update
  launcherVersion: () => ipcRenderer.invoke('launcher:version'),
  checkLauncherUpdate: () => ipcRenderer.invoke('launcher:check-update'),
  installLauncherUpdate: () => ipcRenderer.send('launcher:install-update'),
  onUpdate: (event, cb) => ipcRenderer.on('upd:' + event, (_e, v) => cb(v)),
  // window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
});
