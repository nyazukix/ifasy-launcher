// Secure bridge between the sandboxed UI and the Electron main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ifasy', {
  // auth + session
  login: (id, pw) => ipcRenderer.invoke('login', id, pw),
  restoreSession: () => ipcRenderer.invoke('session:restore'),
  logoutSession: () => ipcRenderer.invoke('session:logout'),

  // game
  gameVersion: (channel) => ipcRenderer.invoke('game-version', channel),
  downloadGame: (channel) => ipcRenderer.invoke('download-game', channel),

  // install location + flow
  installGetBase: () => ipcRenderer.invoke('install:get-base'),
  installPickFolder: () => ipcRenderer.invoke('install:pick-folder'),
  installUseDefault: () => ipcRenderer.invoke('install:use-default'),
  installStart: (channel) => ipcRenderer.invoke('install:start', channel),

  // social: friends + messages
  socialOverview: () => ipcRenderer.invoke('social:overview'),
  socialRequest: (who) => ipcRenderer.invoke('social:request', who),
  socialAccept: (userId) => ipcRenderer.invoke('social:accept', userId),
  socialDecline: (userId) => ipcRenderer.invoke('social:decline', userId),
  socialRemove: (userId) => ipcRenderer.invoke('social:remove', userId),
  socialMessages: (withId, after) => ipcRenderer.invoke('social:messages', withId, after),
  socialSend: (to, body) => ipcRenderer.invoke('social:send', to, body),

  // launcher self-update
  launcherVersion: () => ipcRenderer.invoke('launcher:version'),
  checkLauncherUpdate: () => ipcRenderer.invoke('launcher:check-update'),
  installLauncherUpdate: () => ipcRenderer.send('launcher:install-update'),
  onUpdate: (event, cb) => ipcRenderer.on('upd:' + event, (_e, v) => cb(v)),

  // window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  close: () => ipcRenderer.send('win:close'),
});
