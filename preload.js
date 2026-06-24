// Secure bridge between the sandboxed UI and the Electron main process.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ifasy', {
  // auth + session
  login: (id, pw) => ipcRenderer.invoke('login', id, pw),
  register: (username, hashtag, password) => ipcRenderer.invoke('register', username, hashtag, password),
  checkTag: (username, hashtag) => ipcRenderer.invoke('check-tag', username, hashtag),
  genTag: (username) => ipcRenderer.invoke('gen-tag', username),
  restoreSession: () => ipcRenderer.invoke('session:restore'),
  logoutSession: () => ipcRenderer.invoke('session:logout'),

  // game version
  gameVersion: (channel) => ipcRenderer.invoke('game-version', channel),
  downloadGame: (channel) => ipcRenderer.invoke('download-game', channel),

  // install location + status
  installGetBase: () => ipcRenderer.invoke('install:get-base'),
  installPickFolder: () => ipcRenderer.invoke('install:pick-folder'),
  installUseDefault: () => ipcRenderer.invoke('install:use-default'),
  installStatus: (channel) => ipcRenderer.invoke('install:status', channel),
  // download / install / update / uninstall
  installStart: (channel, version) => ipcRenderer.invoke('install:start', channel, version),
  installCancel: () => ipcRenderer.invoke('install:cancel'),
  installUninstall: (channel) => ipcRenderer.invoke('install:uninstall', channel),
  installLaunch: (channel) => ipcRenderer.invoke('install:launch', channel),
  onDownload: (event, cb) => ipcRenderer.on('dl:' + event, (_e, v) => cb(v)),

  // download throttle settings
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setDownloadRate: (mbps) => ipcRenderer.invoke('settings:set-rate', mbps),

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
  launcherUpdateAvailable: () => ipcRenderer.invoke('launcher:update-available'),
  launcherUpdateState: () => ipcRenderer.invoke('launcher:update-state'),
  onUpdate: (event, cb) => ipcRenderer.on('upd:' + event, (_e, v) => cb(v)),

  // window controls
  minimize: () => ipcRenderer.send('win:minimize'),
  maximize: () => ipcRenderer.send('win:maximize'),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onWinState: (cb) => ipcRenderer.on('win:state', (_e, v) => cb(v)),
  close: () => ipcRenderer.send('win:close'),
});
