# Contributing to WRONG

WRONG is a small art project. PRs are welcome but please open an issue first if the change is more than a one-liner — there's an aesthetic to preserve and not every "fix" lines up with it.

## what i'm interested in

- new glitch effects (especially: GPU shader-based filters, pre-decode mangle for codecs we don't yet support)
- profile presets that look distinct from the existing six
- platform fixes (esp. macOS arm64-vs-x64 quirks, Windows installer behavior)
- performance — the mosh path is hot; smarter motion estimation or WebGL-based warping would be welcome
- typo / docs / link fixes — always
- accessibility on the chrome (keyboard nav, focus states)

## what i'm not interested in

- new "productivity" features (bookmarks sync, password manager, etc.) — WRONG is not a daily driver
- telemetry / analytics of any kind
- bundling third-party services
- code signing setup unless paired with funding to actually buy the certs

## dev setup

```bash
git clone https://github.com/willbearfruits/wrong.git
cd wrong
npm install
npm start
# verbose preload diagnostics:
WRONG_DEBUG=1 npm start
```

`rsvg-convert` must be on PATH for `npm run icons` and any build step:
- Linux: `apt install librsvg2-bin`
- macOS: `brew install librsvg`
- Windows: `choco install rsvg-convert`

## architecture (one paragraph)

`main.js` is the Electron main process — it owns the window, the `WebContentsView` per tab, and the per-partition `protocol.handle('https')` that intercepts every response and runs `glitch/mangle.js` on image/audio/video bodies before they reach the renderer. `preload.js` runs in every tab; it does the DOM-side work — Zalgo via `TreeWalker` + `MutationObserver` (with shadow-DOM piercing), CSS filter overlay injection, the audio worklet bit-flipper, and the `<canvas>`-overlay datamosh. `chrome.html` is the toolbar UI loaded into a separate `WebContentsView`. `newtab.html` is the internal new-tab page. The whole IPC surface is in main.js + chrome-preload.js.

## style

- ES2022 syntax, no transpiler. Node 20+ assumed.
- No comments unless the why is non-obvious. Don't restate what the code does.
- No dependencies in `dependencies` if you can possibly avoid it. The only acceptable runtime dep is electron itself.
- Match existing formatting (no Prettier config; just don't fight what's there).
- Keep PRs small. One concern per PR.

## license

By contributing you agree to license your contribution under MIT — same as the rest of the project.
