const { contextBridge, ipcRenderer } = require('electron');

const DEBUG = !!process.env.WRONG_DEBUG;
const dlog = DEBUG ? (...a) => console.log('[GB]', ...a) : () => {};

// Internal page API. Lets the new-tab page apply glitch profiles by name
// without needing the chrome's IPC machinery.
try {
  contextBridge.exposeInMainWorld('wrong', {
    applyProfile: (name) => ipcRenderer.send('apply-profile-by-name', String(name || '')),
  });
} catch {}

// ─── Zalgo ──────────────────────────────────────────────────────────────
const ZALGO_UP = ['̍','̎','̄','̅','̿','̑','̆','̐','͒','͗','͑','̇','̈','̊','͂','̓','̈́','͊','͋','͌','̃','̂','̌','͐','̀','́','̋','̏','̒','̓','̔','̽','̉','ͣ','ͤ','ͥ','ͦ','ͧ','ͨ','ͩ','ͪ','ͫ','ͬ','ͭ','ͮ','ͯ','̾','͛','͆','̚'];
const ZALGO_DOWN = ['̖','̗','̘','̙','̜','̝','̞','̟','̠','̤','̥','̦','̩','̪','̫','̬','̭','̮','̯','̰','̱','̲','̳','̹','̺','̻','̼','ͅ','͇','͈','͉','͍','͎','͓','͔','͕','͖','͙','͚','̣'];
const ZALGO_MID = ['̕','̛','̀','́','͘','̡','̢','̧','̨','̴','̵','̶','͏','͡','҉'];
const ZALGO_MARK = '​⁣';

let zalgoEnabled = true;
let zalgoIntensity = 0.4;

function zalgoize(s) {
  if (!zalgoEnabled || zalgoIntensity <= 0) return s;
  let out = '';
  for (const ch of s) {
    out += ch;
    if (!ch.trim()) continue;
    const n = (Math.random() * zalgoIntensity * 12) | 0;
    for (let i = 0; i < n; i++) {
      const r = Math.random();
      const pool = r < 0.45 ? ZALGO_UP : r < 0.9 ? ZALGO_DOWN : ZALGO_MID;
      out += pool[(Math.random() * pool.length) | 0];
    }
  }
  return out;
}

function processNode(node) {
  if (!node || node.nodeType !== 3) return;
  const v = node.nodeValue;
  if (!v || !v.trim()) return;
  if (v.startsWith(ZALGO_MARK)) return;
  const parent = node.parentElement;
  if (parent && /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parent.tagName)) return;
  if (parent && parent.isContentEditable) return;
  node.nodeValue = ZALGO_MARK + zalgoize(v);
}

function walkText(root) {
  if (!root) return;
  if (root.nodeType === 3) { processNode(root); return; }
  // Accept Element (1) and DocumentFragment / ShadowRoot (11)
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const batch = [];
  while (w.nextNode()) batch.push(w.currentNode);
  for (const n of batch) processNode(n);
}

// Shadow-DOM-piercing walker. YouTube and other custom-element-heavy sites
// put almost all visible text inside open shadow roots, which TreeWalker
// won't traverse on its own.
const observedRoots = new WeakSet();
function observeRoot(root) {
  if (!root || observedRoots.has(root)) return;
  observedRoots.add(root);
  new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) {
        if (n.nodeType === 1) walkAll(n);
        else if (n.nodeType === 3) processNode(n);
      }
      if (m.type === 'characterData') processNode(m.target);
    }
  }).observe(root, { childList: true, subtree: true, characterData: true });
}
function walkAll(root) {
  if (!root) return;
  walkText(root);
  scanMedia(root);
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.shadowRoot) {
    observeRoot(root.shadowRoot);
    walkAll(root.shadowRoot);
  }
  // Iterate descendants for their own shadow roots
  const all = root.querySelectorAll?.('*');
  if (all) for (const el of all) {
    if (el.shadowRoot && !observedRoots.has(el.shadowRoot)) {
      observeRoot(el.shadowRoot);
      walkAll(el.shadowRoot);
    }
  }
}

// ─── CSS filter overlay ─────────────────────────────────────────────────
const FILTER_CSS = {
  none:      ``,
  chromatic: `html { filter: url(#gb-chromatic); }`,
  scan:      `html::before { content:""; position:fixed; inset:0; pointer-events:none;
                background: repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 3px);
                z-index: 2147483647; }`,
  invert:    `html { filter: invert(1) hue-rotate(180deg); }`,
  hue:       `html { filter: hue-rotate(90deg) saturate(1.5); }`,
  vhs:       `html { filter: contrast(1.1) saturate(1.4) url(#gb-vhs); }
              html::before { content:""; position:fixed; inset:0; pointer-events:none;
                background: repeating-linear-gradient(0deg, rgba(255,0,80,0.06) 0 2px, rgba(0,255,200,0.05) 2px 4px);
                z-index: 2147483647; mix-blend-mode: screen; }`,
};

// Build the SVG filter <defs> via DOM API (not innerHTML) so it survives
// pages with strict Trusted Types policies (notably YouTube).
function buildFilterDefs() {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  Object.assign(svg.style, {
    position: 'fixed', width: '0', height: '0', pointerEvents: 'none', zIndex: '-1',
  });
  const defs = document.createElementNS(NS, 'defs');

  // chromatic
  const c = document.createElementNS(NS, 'filter');
  c.id = 'gb-chromatic';
  const make = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    return el;
  };
  c.appendChild(make('feColorMatrix', { type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'r' }));
  c.appendChild(make('feOffset', { in: 'r', dx: '-3', dy: '0', result: 'r2' }));
  c.appendChild(make('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'b' }));
  c.appendChild(make('feOffset', { in: 'b', dx: '3', dy: '0', result: 'b2' }));
  c.appendChild(make('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'g' }));
  c.appendChild(make('feBlend', { in: 'r2', in2: 'g', mode: 'screen', result: 'rg' }));
  c.appendChild(make('feBlend', { in: 'rg', in2: 'b2', mode: 'screen' }));
  defs.appendChild(c);

  // vhs
  const v = document.createElementNS(NS, 'filter');
  v.id = 'gb-vhs';
  v.appendChild(make('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.9 0.02', numOctaves: '2', result: 'n' }));
  v.appendChild(make('feDisplacementMap', { in: 'SourceGraphic', in2: 'n', scale: '6' }));
  defs.appendChild(v);

  svg.appendChild(defs);
  return svg;
}

function applyFilter(name) {
  let style = document.getElementById('__gb_filter');
  if (!style) {
    style = document.createElement('style');
    style.id = '__gb_filter';
    document.documentElement.appendChild(style);
  }
  style.textContent = FILTER_CSS[name] || '';
  if (!document.getElementById('__gb_defs')) {
    const svg = buildFilterDefs();
    svg.id = '__gb_defs';
    document.documentElement.appendChild(svg);
  }
}

// ─── Audio bit-flip ─────────────────────────────────────────────────────
const WORKLET_CODE = `
class BitFlipProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'intensity', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' }];
  }
  process(inputs, outputs, params) {
    const input = inputs[0]; const output = outputs[0];
    const k = params.intensity[0] || 0;
    for (let ch = 0; ch < output.length; ch++) {
      const inp = input[ch]; const out = output[ch];
      if (!inp) { out.fill(0); continue; }
      if (k <= 0) { out.set(inp); continue; }
      const rate = k * 0.08;
      for (let i = 0; i < out.length; i++) {
        if (Math.random() < rate) {
          const s = inp[i] < -1 ? -1 : inp[i] > 1 ? 1 : inp[i];
          const v = (s * 32767) | 0;
          out[i] = ((v ^ (1 << ((Math.random() * 16) | 0))) << 16 >> 16) / 32767;
        } else out[i] = inp[i];
      }
    }
    return true;
  }
}
registerProcessor('bit-flip', BitFlipProcessor);
`;

let audioCtx = null;
let bitFlipNode = null;
let intensityParam = null;
let audioGlitch = 0;

async function ensureAudio() {
  if (audioCtx) return audioCtx;
  const ctx = new AudioContext();
  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  await ctx.audioWorklet.addModule(URL.createObjectURL(blob));
  bitFlipNode = new AudioWorkletNode(ctx, 'bit-flip');
  intensityParam = bitFlipNode.parameters.get('intensity');
  intensityParam.value = audioGlitch;
  bitFlipNode.connect(ctx.destination);
  audioCtx = ctx;
  return ctx;
}

// Audio attach is GATED on audioGlitch > 0. Setting crossOrigin or routing
// through Web Audio on a fresh <video> before the page assigns src breaks
// playback on cross-origin CDNs (notably googlevideo, dailymotion). When the
// slider is at zero we don't touch any media element at all.
const attached = new WeakSet();

async function attemptAttach(el) {
  if (attached.has(el)) return;
  if (audioGlitch <= 0) return;
  const src = el.currentSrc || el.src || '';
  if (src.startsWith('blob:')) return;            // MSE/EME — won't work
  if (el.readyState !== 0 || src) return;          // already loading — would mute
  // Don't override crossOrigin. Routing only works on same-origin or
  // CORS-already-enabled sources; for everything else we just skip.
  attached.add(el);
  try {
    const ctx = await ensureAudio();
    if (ctx.state === 'suspended') {
      const resume = () => { ctx.resume().catch(() => {}); };
      el.addEventListener('play', resume, { once: true });
      document.addEventListener('click', resume, { once: true, capture: true });
    }
    const node = ctx.createMediaElementSource(el);
    node.connect(bitFlipNode);
  } catch {
    attached.delete(el);
  }
}

function attachMedia(el) {
  if (el.tagName === 'VIDEO') attachVideoFx(el);
  if (audioGlitch <= 0) return;
  attemptAttach(el);
}

// ─── Video frame-level glitch (canvas overlay) ──────────────────────────
// We cannot safely corrupt encoded video bytes without crashing decoders.
// Instead we let the codec produce clean frames, then read them via
// drawImage/getImageData and re-paint the mangled version on a canvas
// stacked on top of the <video>. The video element keeps producing audio
// untouched, the codec never sees corruption, and we get true frame-level
// glitch effects.
let videoFx = 0;
const videoAttached = new WeakSet();

function ensureCanvasOver(videoEl) {
  let canvas = videoEl._gbCanvas;
  if (canvas && canvas.isConnected) return canvas;
  canvas = document.createElement('canvas');
  Object.assign(canvas.style, {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: '1',
    display: 'none',
  });
  canvas.dataset.gbCanvas = '1';
  const parent = videoEl.parentElement;
  if (!parent) return null;
  if (getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  parent.appendChild(canvas);
  videoEl._gbCanvas = canvas;

  // The canvas must mirror the <video>'s rendered box exactly. Setting
  // height: 100% on the parent doesn't work because the parent's height is
  // implicit (driven by the video child). Instead, sync explicit pixel
  // dimensions whenever the video resizes.
  const sync = () => {
    if (!videoEl.isConnected || !canvas.isConnected) return;
    canvas.style.left   = videoEl.offsetLeft   + 'px';
    canvas.style.top    = videoEl.offsetTop    + 'px';
    canvas.style.width  = videoEl.offsetWidth  + 'px';
    canvas.style.height = videoEl.offsetHeight + 'px';
  };
  sync();
  if (window.ResizeObserver && !videoEl._gbResizeObs) {
    const ro = new ResizeObserver(sync);
    ro.observe(videoEl);
    videoEl._gbResizeObs = ro;
  }
  if (!videoEl._gbSyncInterval) {
    videoEl._gbSyncInterval = setInterval(sync, 1000);
  }
  return canvas;
}

// Datamosh approximation. The signature of true datamosh is "old pixels
// get pushed along the NEW frame's motion vectors". To reproduce:
//  1) keep a carrier image (what we display)
//  2) estimate motion between previous and current raw video frames
//  3) warp the carrier by that motion field
//  4) refresh a small fraction of carrier from current frame so it doesn't
//     drift to garbage entirely
// The slider controls how much the carrier persists vs refreshes.
const MOSH_BLOCK = 32;
const MOSH_SEARCH = 6;
const MOSH_SUBSAMPLE = 8;

// Pre-allocated motion-vector field; resized only on canvas dim change.
let mvX = null, mvY = null, mvCols = 0, mvRows = 0;

function moshFrame(carrier, prev, cur, warped, w, h, intensity) {
  // Motion estimation (block-matching, sub-sampled, ±SEARCH px).
  const cols = Math.ceil(w / MOSH_BLOCK);
  const rows = Math.ceil(h / MOSH_BLOCK);
  if (cols !== mvCols || rows !== mvRows) {
    mvX = new Int8Array(cols * rows);
    mvY = new Int8Array(cols * rows);
    mvCols = cols; mvRows = rows;
  } else {
    mvX.fill(0); mvY.fill(0);
  }

  for (let by = 0; by < rows; by++) {
    for (let bx = 0; bx < cols; bx++) {
      const x0 = bx * MOSH_BLOCK;
      const y0 = by * MOSH_BLOCK;
      const blkW = Math.min(MOSH_BLOCK, w - x0);
      const blkH = Math.min(MOSH_BLOCK, h - y0);
      let bestDx = 0, bestDy = 0, bestSAD = Infinity;
      for (let dy = -MOSH_SEARCH; dy <= MOSH_SEARCH; dy += 2) {
        for (let dx = -MOSH_SEARCH; dx <= MOSH_SEARCH; dx += 2) {
          const sx = x0 + dx, sy = y0 + dy;
          if (sx < 0 || sy < 0 || sx + blkW > w || sy + blkH > h) continue;
          let sad = 0;
          for (let py = 0; py < blkH; py += MOSH_SUBSAMPLE) {
            for (let px = 0; px < blkW; px += MOSH_SUBSAMPLE) {
              const i = ((y0 + py) * w + (x0 + px)) * 4;
              const j = ((sy + py) * w + (sx + px)) * 4;
              sad += Math.abs(cur[i] - prev[j])
                   + Math.abs(cur[i + 1] - prev[j + 1])
                   + Math.abs(cur[i + 2] - prev[j + 2]);
            }
          }
          if (sad < bestSAD) { bestSAD = sad; bestDx = dx; bestDy = dy; }
        }
      }
      mvX[by * cols + bx] = bestDx;
      mvY[by * cols + bx] = bestDy;
    }
  }

  // Warp carrier into the caller-provided buffer using the motion field.
  for (let y = 0; y < h; y++) {
    const by = (y / MOSH_BLOCK) | 0;
    const rowMV = by * cols;
    for (let x = 0; x < w; x++) {
      const bx = (x / MOSH_BLOCK) | 0;
      const mvi = rowMV + bx;
      const sx = x - mvX[mvi];
      const sy = y - mvY[mvi];
      const di = (y * w + x) * 4;
      let si;
      if (sx >= 0 && sy >= 0 && sx < w && sy < h) {
        si = (sy * w + sx) * 4;
      } else {
        si = di;
      }
      warped[di]     = carrier[si];
      warped[di + 1] = carrier[si + 1];
      warped[di + 2] = carrier[si + 2];
      warped[di + 3] = 255;
    }
  }

  // Refresh a small fraction from current frame to prevent total drift.
  // intensity 1.0 = ~2% refresh (heavy mosh), 0.0 = 100% refresh (no mosh).
  const refreshRate = Math.max(0.02, 1 - intensity);
  for (let i = 0; i < warped.length; i += 4) {
    if (Math.random() < refreshRate) {
      warped[i]     = cur[i];
      warped[i + 1] = cur[i + 1];
      warped[i + 2] = cur[i + 2];
    }
  }
}

function attachVideoFx(videoEl) {
  if (videoAttached.has(videoEl)) return;
  videoAttached.add(videoEl);
  dlog('attachVideoFx', (videoEl.currentSrc || videoEl.src || '').slice(0, 60), 'parent=', videoEl.parentElement?.tagName);

  let tainted = false;
  let ctx = null;
  let carrier = null;
  let prevSrc = null;
  let warpBuf = null;
  let canvasW = 0, canvasH = 0;
  let seeded = false;

  const tick = () => {
    if (tainted) return;
    if (!videoEl.isConnected) return;

    const canvas = ensureCanvasOver(videoEl);
    if (!canvas) {
      videoEl.requestVideoFrameCallback?.(tick);
      return;
    }
    if (videoFx <= 0) {
      canvas.style.display = 'none';
      // Reset mosh state so a fresh start on re-enable doesn't carry forward
      // pixels from the previous video.
      seeded = false;
    } else if (videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      canvas.style.display = '';
      const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
      // Cap working resolution: motion estimation + warp is O(w*h), so we
      // run mosh at 480p max regardless of source size. CSS scales it back up.
      const maxDim = 480;
      const scale = Math.min(1, maxDim / Math.max(vw, vh));
      const w = Math.max(1, (vw * scale) | 0);
      const h = Math.max(1, (vh * scale) | 0);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
      if (canvasW !== w || canvasH !== h) {
        const sz = w * h * 4;
        carrier = new Uint8ClampedArray(sz);
        prevSrc = new Uint8ClampedArray(sz);
        warpBuf = new Uint8ClampedArray(sz);
        canvasW = w; canvasH = h;
        seeded = false;
      }
      if (!ctx) ctx = canvas.getContext('2d', { willReadFrequently: true });
      try {
        ctx.drawImage(videoEl, 0, 0, w, h);
        const cur = ctx.getImageData(0, 0, w, h);
        const curData = cur.data;
        if (!seeded) {
          carrier.set(curData);
          prevSrc.set(curData);
          ctx.putImageData(cur, 0, 0);
          seeded = true;
        } else {
          moshFrame(carrier, prevSrc, curData, warpBuf, w, h, videoFx);
          // Swap carrier <-> warpBuf for zero-alloc rotation.
          const tmp = carrier; carrier = warpBuf; warpBuf = tmp;
          prevSrc.set(curData);
          ctx.putImageData(new ImageData(carrier, w, h), 0, 0);
        }
      } catch (e) {
        tainted = true;
        canvas.remove();
        return;
      }
    }

    if (videoEl.requestVideoFrameCallback) {
      videoEl.requestVideoFrameCallback(tick);
    } else {
      requestAnimationFrame(tick);
    }
  };

  if (videoEl.requestVideoFrameCallback) {
    videoEl.requestVideoFrameCallback(tick);
  } else {
    requestAnimationFrame(tick);
  }
}

function scanMedia(root) {
  if (!root) return;
  if (root.nodeType === 1 || root.nodeType === 11) {
    if (root.nodeType === 1 && (root.tagName === 'AUDIO' || root.tagName === 'VIDEO')) attachMedia(root);
    root.querySelectorAll?.('audio, video').forEach(attachMedia);
  }
}

// ─── Boot + observers ───────────────────────────────────────────────────
function safe(label, fn) {
  try { fn(); } catch (e) { dlog(`${label} failed:`, e?.message || e); }
}

function periodicScan() {
  // Walk light DOM from documentElement (not just body — covers <head> text
  // and elements that may be hoisted out of body by the framework).
  safe('walkAll(documentElement)', () => walkAll(document.documentElement));
  // Pick up shadow roots on already-existing elements (attachShadow doesn't
  // fire MutationObserver, so we have to poll).
  safe('shadow-scan', () => {
    const all = document.querySelectorAll('*');
    let found = 0;
    for (const el of all) {
      try {
        const sr = el.shadowRoot;
        if (sr && !observedRoots.has(sr)) {
          observeRoot(sr);
          walkAll(sr);
          found++;
        }
      } catch {}
    }
    if (found) dlog(`picked up ${found} new shadow root(s)`);
  });
}

function start() {
  dlog('preload start', location.href);
  safe('applyFilter', () => applyFilter('none'));
  safe('walkAll initial', () => walkAll(document.documentElement || document.body));
  safe('observeRoot doc', () => observeRoot(document.body || document.documentElement));
  // Two cadences: fast for the first 10s while a SPA is hydrating, then slow.
  let ticks = 0;
  const fast = setInterval(() => {
    periodicScan();
    if (++ticks >= 20) {
      clearInterval(fast);
      setInterval(periodicScan, 2000);
    }
  }, 500);
}

console.log('[GB] preload loaded');
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}

// ─── IPC ────────────────────────────────────────────────────────────────
ipcRenderer.on('zalgo', (_e, intensity, enabled) => {
  zalgoIntensity = intensity;
  zalgoEnabled = enabled;
});
ipcRenderer.on('css-filter', (_e, name) => {
  applyFilter(name);
});
ipcRenderer.on('audio-glitch', (_e, v) => {
  audioGlitch = v;
  if (intensityParam) intensityParam.value = v;
});
ipcRenderer.on('video-fx', (_e, v) => {
  console.log('[GB] video-fx ipc:', v);
  videoFx = v;
});
