// Capture WRONG screenshots for README + landing page.
// Boots a windowed Electron with the actual chrome + content layout, sets
// glitch state programmatically per shot, captures the WHOLE window
// (chrome + content) so the wordmark + tabs are visible in the screenshots.
const { app, BaseWindow, WebContentsView, session, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { mangle } = require('../glitch/mangle');

const SHOTS_DIR = path.join(__dirname, '..', 'docs', 'screenshots');
fs.mkdirSync(SHOTS_DIR, { recursive: true });

const W = 1600, H = 1000;
const CHROME_H = 80;
const PARTITION = 'persist:wrong-capture';

const state = {
  intensity: 0.005, enabled: true,
  zalgoIntensity: 0.4, zalgoEnabled: true,
  cssFilter: 'none', audioGlitch: 0, videoFx: 0, videoEnabled: false,
  profile: 'subtle',
};

const NEWTAB = 'file://' + path.join(__dirname, '..', 'newtab.html');

const shots = [
  { name: 'newtab',         url: NEWTAB,                                                        wait: 600,  state: { profile: 'subtle' } },
  { name: 'wiki-subtle',    url: 'https://en.wikipedia.org/wiki/Datamoshing',                   wait: 3500, state: { intensity: 0.004, zalgoIntensity: 0.25 } },
  { name: 'wiki-heavy',     url: 'https://en.wikipedia.org/wiki/Glitch_art',                    wait: 3500, state: { intensity: 0.018, zalgoIntensity: 0.7 } },
  { name: 'hn',             url: 'https://news.ycombinator.com',                                wait: 2500, state: { intensity: 0, zalgoIntensity: 0.5 } },
];

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const ses = session.fromPartition(PARTITION);
  const handle = async (request) => {
    const upstream = await net.fetch(request, { bypassCustomProtocolHandlers: true });
    if (!state.enabled || state.intensity <= 0) return upstream;
    const s = upstream.status;
    if (s === 204 || s === 205 || s === 304 || (s >= 100 && s < 200)) return upstream;
    const ct = upstream.headers.get('content-type') ?? '';
    const isImage = /^image\//.test(ct);
    if (!isImage) return upstream;
    const lenH = upstream.headers.get('content-length');
    if (lenH && parseInt(lenH, 10) > 12 * 1024 * 1024) return upstream;
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.length === 0 || bytes.length > 12 * 1024 * 1024) return upstream;
    mangle(bytes, ct, state.intensity);
    const headers = new Headers(upstream.headers);
    headers.delete('content-length');
    return new Response(bytes, { status: s, headers });
  };
  ses.protocol.handle('https', handle);
  ses.protocol.handle('http', handle);

  const win = new BaseWindow({ width: W, height: H, backgroundColor: '#0a0a0a', show: true });

  const chrome = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, '..', 'chrome-preload.js') },
  });
  win.contentView.addChildView(chrome);
  chrome.setBounds({ x: 0, y: 0, width: W, height: CHROME_H });
  chrome.webContents.loadFile(path.join(__dirname, '..', 'chrome.html'));

  const content = new WebContentsView({
    webPreferences: { partition: PARTITION, preload: path.join(__dirname, '..', 'preload.js'), sandbox: false },
  });
  win.contentView.addChildView(content);
  content.setBounds({ x: 0, y: CHROME_H, width: W, height: H - CHROME_H });

  // Stub IPC the chrome wants
  ipcMain.handle('get-mode', () => 'cpu');
  ipcMain.on('navigate', () => {});
  ipcMain.on('back', () => {});
  ipcMain.on('forward', () => {});
  ipcMain.on('reload', () => {});
  ipcMain.on('tab:new', () => {});
  ipcMain.on('tab:close', () => {});
  ipcMain.on('tab:activate', () => {});
  ipcMain.on('find', () => {});
  ipcMain.on('find-stop', () => {});
  ipcMain.on('apply-profile-by-name', () => {});
  ipcMain.on('apply-profile', () => {});
  ipcMain.on('chrome-expanded', () => {});
  ipcMain.on('relaunch', () => {});
  ipcMain.on('set-intensity', () => {});
  ipcMain.on('toggle-enabled', () => {});
  ipcMain.on('toggle-video', () => {});
  ipcMain.on('set-zalgo', () => {});
  ipcMain.on('toggle-zalgo', () => {});
  ipcMain.on('set-css-filter', () => {});
  ipcMain.on('set-audio-glitch', () => {});
  ipcMain.on('set-video-fx', () => {});

  // Fake "tab" listing for the chrome
  await new Promise(r => chrome.webContents.once('did-finish-load', r));
  chrome.webContents.send('init-state', state);
  chrome.webContents.send('tabs', { tabs: [{ id: 1, title: 'WRONG', url: NEWTAB }], activeId: 1 });

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const waitNav = (wc, timeout = 15000) => new Promise(res => {
    const t = setTimeout(() => res('timeout'), timeout);
    wc.once('did-finish-load', () => { clearTimeout(t); res('ok'); });
  });

  for (const shot of shots) {
    Object.assign(state, shot.state);
    content.webContents.send('zalgo', state.zalgoIntensity, state.zalgoEnabled);
    content.webContents.send('css-filter', state.cssFilter);
    content.webContents.send('audio-glitch', state.audioGlitch);
    content.webContents.send('video-fx', state.videoFx);
    chrome.webContents.send('init-state', state);
    chrome.webContents.send('tabs', { tabs: [{ id: 1, title: shot.name, url: shot.url }], activeId: 1 });
    chrome.webContents.send('url-changed', shot.url);

    console.log(`[capture] ${shot.name} → ${shot.url}`);
    content.webContents.loadURL(shot.url);
    await waitNav(content.webContents);
    content.webContents.send('zalgo', state.zalgoIntensity, state.zalgoEnabled);
    await sleep(shot.wait);

    // Capture full window: assemble chrome + content captures
    try {
      const chromeImg = await chrome.webContents.capturePage();
      const contentImg = await content.webContents.capturePage();
      // Stitch via off-screen canvas in main process is complex; instead
      // just save them paired. We'll combine vertically in post.
      fs.writeFileSync(path.join(SHOTS_DIR, `${shot.name}-chrome.png`), chromeImg.toPNG());
      fs.writeFileSync(path.join(SHOTS_DIR, `${shot.name}-content.png`), contentImg.toPNG());
      console.log(`  saved ${shot.name}-{chrome,content}.png`);
    } catch (e) {
      console.log(`  capture failed: ${e.message}`);
    }
  }

  console.log('done');
  app.quit();
});
app.on('window-all-closed', () => app.quit());
