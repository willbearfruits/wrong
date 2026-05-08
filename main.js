const { app, BaseWindow, WebContentsView, session, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { mangle } = require('./glitch/mangle');

const DEBUG = !!process.env.WRONG_DEBUG;

const CHROME_DEFAULT = 80;
const CHROME_EXPANDED = 340;
let chromeHeight = CHROME_DEFAULT;
const PARTITION = 'persist:glitch';

// Persistent settings
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); }
  catch { return null; }
}
function saveSettings(s) {
  try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); }
  catch {}
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2));
}

const defaultSettings = {
  intensity: 0.005,
  enabled: true,
  videoEnabled: false,
  videoFx: 0,
  zalgoIntensity: 0.4,
  zalgoEnabled: true,
  cssFilter: 'none',
  audioGlitch: 0,
  profile: 'custom',
};
const state = Object.assign({}, defaultSettings, loadSettings() || {});
const persist = () => saveSettings(state);

app.setName('WRONG');

if (process.argv.includes('--cpu')) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-compositing');
}

let win, chrome;
const tabs = [];           // { id, view, title, url }
let activeId = null;
let nextTabId = 1;

function activeTab() { return tabs.find(t => t.id === activeId) || null; }

function broadcastGlitch(view) {
  view.webContents.send('zalgo', state.zalgoIntensity, state.zalgoEnabled);
  view.webContents.send('css-filter', state.cssFilter);
  view.webContents.send('audio-glitch', state.audioGlitch);
  view.webContents.send('video-fx', state.videoFx);
}

function sendTabsToChrome() {
  if (!chrome) return;
  chrome.webContents.send('tabs', {
    tabs: tabs.map(t => ({ id: t.id, title: t.title || 'new tab', url: t.url || '' })),
    activeId,
  });
}

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  chrome.setBounds({ x: 0, y: 0, width, height: chromeHeight });
  for (const t of tabs) {
    const visible = t.id === activeId;
    t.view.setBounds({
      x: 0,
      y: visible ? chromeHeight : -10000,
      width,
      height: Math.max(0, height - chromeHeight),
    });
  }
}

const NEWTAB_URL = 'file://' + path.join(__dirname, 'newtab.html');

const PROFILES = {
  off:        { intensity: 0,      enabled: false, zalgoIntensity: 0,    zalgoEnabled: false, audioGlitch: 0,    videoFx: 0,    cssFilter: 'none' },
  subtle:     { intensity: 0.003,  enabled: true,  zalgoIntensity: 0.15, zalgoEnabled: true,  audioGlitch: 0,    videoFx: 0,    cssFilter: 'none' },
  heavy:      { intensity: 0.02,   enabled: true,  zalgoIntensity: 0.6,  zalgoEnabled: true,  audioGlitch: 0.1,  videoFx: 0.5,  cssFilter: 'chromatic' },
  videodrome: { intensity: 0.04,   enabled: true,  zalgoIntensity: 1.0,  zalgoEnabled: true,  audioGlitch: 0.3,  videoFx: 0.75, cssFilter: 'vhs' },
  vaporwave:  { intensity: 0.005,  enabled: true,  zalgoIntensity: 0.2,  zalgoEnabled: true,  audioGlitch: 0,    videoFx: 0.25, cssFilter: 'hue' },
  datamosh:   { intensity: 0.06,   enabled: true,  zalgoIntensity: 0,    zalgoEnabled: false, audioGlitch: 0.05, videoFx: 0.9,  cssFilter: 'scan' },
};

function createTab(initialUrl = NEWTAB_URL) {
  const id = nextTabId++;
  const view = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
    },
  });
  const tab = { id, view, title: 'new tab', url: initialUrl };
  tabs.push(tab);
  win.contentView.addChildView(view);

  const wc = view.webContents;
  wc.on('page-title-updated', (_e, title) => {
    tab.title = title;
    sendTabsToChrome();
  });
  const onNav = (_e, url) => {
    tab.url = url;
    if (tab.id === activeId) chrome.webContents.send('url-changed', url);
    sendTabsToChrome();
  };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('did-finish-load', () => broadcastGlitch(view));
  wc.on('before-input-event', handleShortcut);
  if (DEBUG) {
    wc.on('console-message', (_e, _level, message) => {
      if (message.startsWith('[GB]')) console.log(`[tab ${id}] ${message}`);
    });
  }
  wc.setWindowOpenHandler(({ url }) => {
    createTab(url);
    return { action: 'deny' };
  });
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return;
    tab.title = `[crashed] ${tab.title}`;
    sendTabsToChrome();
    // Auto-reload once after a short delay; if it crashes again leave it.
    if (!tab._reloadedAfterCrash) {
      tab._reloadedAfterCrash = true;
      setTimeout(() => {
        try { wc.reload(); } catch {}
      }, 500);
    }
  });

  wc.loadURL(initialUrl);
  setActiveTab(id);
  return tab;
}

function setActiveTab(id) {
  if (!tabs.find(t => t.id === id)) return;
  activeId = id;
  layout();
  const t = activeTab();
  if (t) chrome.webContents.send('url-changed', t.url || '');
  sendTabsToChrome();
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  const tab = tabs[idx];
  win.contentView.removeChildView(tab.view);
  tab.view.webContents.close();
  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    createTab(NEWTAB_URL);
    return;
  }
  if (activeId === id) {
    setActiveTab(tabs[Math.min(idx, tabs.length - 1)].id);
  } else {
    sendTabsToChrome();
  }
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex(t => t.id === activeId);
  const next = (idx + dir + tabs.length) % tabs.length;
  setActiveTab(tabs[next].id);
}

function handleShortcut(event, input) {
  if (input.type !== 'keyDown') return;
  const key = input.key.toLowerCase();
  if (input.key === 'F11') {
    win.setFullScreen(!win.isFullScreen());
    event.preventDefault();
  } else if (input.key === 'Escape' && win.isFullScreen()) {
    win.setFullScreen(false);
    event.preventDefault();
  } else if (input.control && key === 'l') {
    chrome.webContents.focus();
    chrome.webContents.send('focus-url');
    event.preventDefault();
  } else if (input.control && key === 'r') {
    activeTab()?.view.webContents.reload();
    event.preventDefault();
  } else if (input.control && key === 't') {
    createTab(NEWTAB_URL);
    chrome.webContents.send('focus-url');
    event.preventDefault();
  } else if (input.control && key === 'w') {
    if (activeId) closeTab(activeId);
    event.preventDefault();
  } else if (input.control && input.key === 'Tab') {
    cycleTab(input.shift ? -1 : 1);
    event.preventDefault();
  } else if (input.control && key === 'f') {
    chrome.webContents.send('open-find');
    event.preventDefault();
  } else if (input.control && input.shift && key === 'i') {
    activeTab()?.view.webContents.openDevTools({ mode: 'detach' });
    event.preventDefault();
  } else if (input.alt && input.key === 'ArrowLeft') {
    const t = activeTab();
    if (t && t.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack();
    event.preventDefault();
  } else if (input.alt && input.key === 'ArrowRight') {
    const t = activeTab();
    if (t && t.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward();
    event.preventDefault();
  } else if (input.control && /^[1-9]$/.test(input.key)) {
    const n = parseInt(input.key, 10) - 1;
    if (tabs[n]) setActiveTab(tabs[n].id);
    event.preventDefault();
  }
}

app.whenReady().then(() => {
  const ses = session.fromPartition(PARTITION);

  const handle = async (request) => {
    const upstream = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    if (!state.enabled || state.intensity <= 0) return upstream;
    // Null-body statuses (1xx, 204, 205, 304) can't be wrapped in a Response
    // with bytes — Response constructor throws. Pass through unchanged.
    const s = upstream.status;
    if (s === 204 || s === 205 || s === 304 || (s >= 100 && s < 200)) return upstream;
    const ct = upstream.headers.get('content-type') ?? '';
    const isImage = /^image\//.test(ct);
    const isAV = /^(audio|video)\//.test(ct);
    if (!isImage && !isAV) return upstream;
    // Video/audio byte mangling crashes decoders too easily; opt-in only.
    if (isAV && !state.videoEnabled) return upstream;
    // Cap the in-memory buffer. Anything bigger streams through unchanged
    // — large media chunks aren't worth ballooning main process memory for.
    const MAX_BYTES = isImage ? 12 * 1024 * 1024 : 4 * 1024 * 1024;
    const lenHeader = upstream.headers.get('content-length');
    if (lenHeader && parseInt(lenHeader, 10) > MAX_BYTES) return upstream;
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length === 0 || bytes.length > MAX_BYTES) return upstream;
    mangle(bytes, ct, state.intensity);
    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    return new Response(bytes, { status: s, headers });
  };
  ses.protocol.handle('https', handle);
  ses.protocol.handle('http', handle);

  win = new BaseWindow({
    width: 1280,
    height: 800,
    title: 'WRONG',
    backgroundColor: '#000',
    show: false,
    icon: path.join(__dirname, 'build/icon.png'),
  });
  win.maximize();
  win.show();

  chrome = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'chrome-preload.js') },
  });
  win.contentView.addChildView(chrome);
  chrome.webContents.loadFile('chrome.html');
  chrome.webContents.on('before-input-event', handleShortcut);

  chrome.webContents.once('did-finish-load', () => {
    chrome.webContents.send('init-state', state);
    createTab(NEWTAB_URL);
  });

  win.on('resize', layout);
  win.on('maximize', layout);
  win.on('unmaximize', layout);
  win.on('enter-full-screen', layout);
  win.on('leave-full-screen', layout);

  // IPC
  ipcMain.on('navigate', (_e, url) => {
    if (!/^[a-z]+:\/\//i.test(url)) {
      // crude: contains a dot and no spaces -> url, else search
      if (/^\S+\.\S+/.test(url)) url = 'https://' + url;
      else url = 'https://duckduckgo.com/?q=' + encodeURIComponent(url);
    }
    activeTab()?.view.webContents.loadURL(url);
  });
  ipcMain.on('back', () => {
    const t = activeTab();
    if (t?.view.webContents.navigationHistory.canGoBack()) t.view.webContents.navigationHistory.goBack();
  });
  ipcMain.on('forward', () => {
    const t = activeTab();
    if (t?.view.webContents.navigationHistory.canGoForward()) t.view.webContents.navigationHistory.goForward();
  });
  ipcMain.on('reload', () => activeTab()?.view.webContents.reload());

  ipcMain.on('tab:new', (_e, url) => createTab(url || NEWTAB_URL));
  ipcMain.on('tab:close', (_e, id) => closeTab(id));
  ipcMain.on('tab:activate', (_e, id) => setActiveTab(id));

  ipcMain.on('find', (_e, text) => {
    const t = activeTab();
    if (!t) return;
    if (text) t.view.webContents.findInPage(text);
    else t.view.webContents.stopFindInPage('clearSelection');
  });
  ipcMain.on('find-stop', () => {
    activeTab()?.view.webContents.stopFindInPage('clearSelection');
  });

  const broadcastAll = () => { for (const t of tabs) broadcastGlitch(t.view); };

  ipcMain.on('set-intensity', (_e, v) => { state.intensity = Math.max(0, Math.min(0.2, v)); persist(); });
  ipcMain.on('toggle-enabled', (_e, v) => { state.enabled = !!v; persist(); });
  ipcMain.on('toggle-video', (_e, v) => { state.videoEnabled = !!v; persist(); });
  ipcMain.on('set-zalgo', (_e, v) => { state.zalgoIntensity = Math.max(0, Math.min(1, v)); broadcastAll(); persist(); });
  ipcMain.on('toggle-zalgo', (_e, v) => { state.zalgoEnabled = !!v; broadcastAll(); persist(); });
  ipcMain.on('set-css-filter', (_e, name) => { state.cssFilter = name; broadcastAll(); persist(); });
  ipcMain.on('set-audio-glitch', (_e, v) => { state.audioGlitch = Math.max(0, Math.min(1, v)); broadcastAll(); persist(); });
  ipcMain.on('set-video-fx', (_e, v) => { state.videoFx = Math.max(0, Math.min(1, v)); broadcastAll(); persist(); });
  ipcMain.on('apply-profile', (_e, p) => {
    Object.assign(state, p, { profile: p.name || 'custom' });
    broadcastAll();
    persist();
    chrome.webContents.send('init-state', state);
  });
  ipcMain.on('apply-profile-by-name', (_e, name) => {
    const p = PROFILES[name];
    if (!p) return;
    Object.assign(state, p, { profile: name });
    broadcastAll();
    persist();
    chrome.webContents.send('init-state', state);
  });
  ipcMain.on('relaunch', (_e, mode) => {
    persist();
    const cpuFlag = mode === 'cpu' ? ['--cpu'] : [];
    // AppImage / portable .exe both extract to a temp dir that dies when
    // the parent process exits — so relaunching against process.execPath
    // points at a path that no longer exists by the time the child spawns.
    // electron-builder sets these env vars to the persistent launcher path.
    const launcher = process.env.APPIMAGE || process.env.PORTABLE_EXECUTABLE_FILE;
    let opts;
    if (launcher) {
      opts = { execPath: launcher, args: cpuFlag };
    } else {
      // Dev / installed: process.argv = [electron-bin, app-path, ...flags]
      const base = process.argv.slice(1).filter(a => a !== '--cpu');
      opts = { args: [...base, ...cpuFlag] };
    }
    try { app.relaunch(opts); } catch (e) { if (DEBUG) console.warn('[GB] relaunch failed:', e); }
    app.quit();
  });
  ipcMain.handle('get-mode', () => process.argv.includes('--cpu') ? 'cpu' : 'gpu');

  ipcMain.on('chrome-expanded', (_e, expanded) => {
    chromeHeight = expanded ? CHROME_EXPANDED : CHROME_DEFAULT;
    layout();
  });
});

app.on('window-all-closed', () => app.quit());
