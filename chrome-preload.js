const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gb', {
  navigate: (url) => ipcRenderer.send('navigate', url),
  back: () => ipcRenderer.send('back'),
  forward: () => ipcRenderer.send('forward'),
  reload: () => ipcRenderer.send('reload'),

  tabNew: (url) => ipcRenderer.send('tab:new', url),
  tabClose: (id) => ipcRenderer.send('tab:close', id),
  tabActivate: (id) => ipcRenderer.send('tab:activate', id),

  find: (text) => ipcRenderer.send('find', text),
  findStop: () => ipcRenderer.send('find-stop'),

  setIntensity: (v) => ipcRenderer.send('set-intensity', v),
  toggleEnabled: (v) => ipcRenderer.send('toggle-enabled', v),
  toggleVideo: (v) => ipcRenderer.send('toggle-video', v),
  setZalgo: (v) => ipcRenderer.send('set-zalgo', v),
  toggleZalgo: (v) => ipcRenderer.send('toggle-zalgo', v),
  setCssFilter: (name) => ipcRenderer.send('set-css-filter', name),
  setAudioGlitch: (v) => ipcRenderer.send('set-audio-glitch', v),
  setVideoFx: (v) => ipcRenderer.send('set-video-fx', v),
  applyProfile: (p) => ipcRenderer.send('apply-profile', p),
  relaunch: (mode) => ipcRenderer.send('relaunch', mode),
  getMode: () => ipcRenderer.invoke('get-mode'),
  chromeExpanded: (expanded) => ipcRenderer.send('chrome-expanded', expanded),

  onUrl: (cb) => ipcRenderer.on('url-changed', (_e, url) => cb(url)),
  onFocusUrl: (cb) => ipcRenderer.on('focus-url', () => cb()),
  onTabs: (cb) => ipcRenderer.on('tabs', (_e, payload) => cb(payload)),
  onOpenFind: (cb) => ipcRenderer.on('open-find', () => cb()),
  onInitState: (cb) => ipcRenderer.on('init-state', (_e, s) => cb(s)),
});
