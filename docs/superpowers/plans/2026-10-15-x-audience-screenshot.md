# X Audience Screenshot Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension whose popup has a Capture button that screenshots `https://x.com/i/account_analytics/audience` (using the user's logged-in session) and displays the image in the popup.

**Architecture:** MV3 extension, plain JS, no build step. A service worker (`background.js`) owns the capture: it opens the page in an inactive tab, drives it over `chrome.debugger` (CDP) — navigate, wait for network idle, `Page.captureScreenshot` — then closes the tab and returns a PNG data URL over a `chrome.runtime` port. Pure logic (URL checks, clip math, filenames, error messages) lives in `lib.js`, which is shared by the service worker, the popup, and Node unit tests.

**Tech Stack:** Chrome Extension Manifest V3, vanilla JavaScript, Chrome DevTools Protocol via `chrome.debugger`, Node's built-in `node:test` for unit tests (no dependencies, no `package.json`).

**Spec:** `docs/superpowers/specs/2026-10-15-x-audience-screenshot-design.md`

## Global Constraints

- Manifest V3; plain JavaScript; no build step, no bundler, no npm dependencies.
- Manifest permissions: `tabs`, `debugger`, `storage`; host permission `https://x.com/*`.
- Target URL: `https://x.com/i/account_analytics/audience`.
- Debugger protocol version `1.3`; screenshot format `png`; `captureBeyondViewport: true`.
- Overall page-load timeout 15 s; settle delay ~1.5 s after load.
- Last capture persisted in `chrome.storage.local` under key `lastCapture` as `{dataUrl, capturedAt}` (`capturedAt` is an ISO string).
- Download filename pattern: `x-audience-<ISO timestamp>.png`.
- Error codes: `NOT_LOGGED_IN`, `UNEXPECTED_REDIRECT`, `TIMEOUT`, `ATTACH_FAILED`, `CAPTURE_FAILED`, plus `BUSY` (a second capture while one is running).
- The temporary tab is always closed and the debugger always detached, success or failure.
- Personal use, loaded unpacked; Web Store packaging, scheduling, history and number-scraping are out of scope.

## Review Focus

1. **Logged out / wrong landing page.** X redirects to `/i/flow/login?...` (or `/login`), or to a non-analytics page. Expect a clear `NOT_LOGGED_IN` or `UNEXPECTED_REDIRECT` message — and the analytics URL itself (even with `login` in its query string) must never be classified as a login URL. *(Task 1 tests.)*
2. **Page never reaches `networkIdle`.** X holds connections open. Expect the capture to proceed once `load` fired, not fail with `TIMEOUT`. *(Task 2 manual check.)*
3. **Very tall or zero-sized page metrics.** Expect a capped clip height (no CDP failure) and a sane fallback when metrics are missing or zero. *(Task 1 tests.)*
4. **Double-click, or popup closed mid-capture.** Expect no second concurrent capture (`BUSY`), the tab still closed, and the result still saved so reopening the popup shows it. *(Task 2/3 manual check.)*
5. **Debugger already attached / DevTools open.** Expect `ATTACH_FAILED` with a readable message and the tab closed. *(Task 2 manual check.)*
6. **Popup opened before any capture exists.** Expect an empty state, no broken image. *(Task 3 manual check.)*

---

## File Structure

| File | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest, permissions, popup and service-worker wiring. |
| `lib.js` | Pure helpers + constants: `XLib` global (browser/service worker) and `module.exports` (Node). No `chrome.*` calls. |
| `background.js` | Service worker: port handling, `captureAudience()` CDP flow, persistence. |
| `popup.html`, `popup.css`, `popup.js` | Popup UI and port client. |
| `tests/lib.test.js` | Unit tests for `lib.js`. |
| `README.md` | Install (load unpacked) + manual verification checklist. |

---

### Task 1: Pure helpers in `lib.js` (TDD)

**Files:**
- Create: `lib.js`
- Test: `tests/lib.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (all on `XLib` in the browser, and as `module.exports` in Node):
  - Constants: `ANALYTICS_URL: string`, `VIEWPORT: {width:number,height:number}` (1280×900), `MAX_CAPTURE_HEIGHT: number` (16000), `LOAD_TIMEOUT_MS: number` (15000), `SETTLE_MS: number` (1500), `ERROR_MESSAGES: Record<string,string>`
  - `class CaptureError extends Error` — `new CaptureError(code: string, detail?: string)`, properties `.code`, `.detail`
  - `isLoginUrl(url: string): boolean`
  - `isAnalyticsUrl(url: string): boolean`
  - `computeClip(size: {width:number,height:number}|undefined, viewport: {width,height}): {x:0,y:0,width:number,height:number,scale:1}`
  - `captureFilename(date: Date): string`
  - `errorMessage(code: string, detail?: string): string`

- [ ] **Step 1: Initialise git (the directory is not a repository yet)**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && git init && git add docs && git commit -m "docs: add design spec and implementation plan"`
Expected: repository initialised, one commit created.

- [ ] **Step 2: Write the failing tests**

Create `tests/lib.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANALYTICS_URL, VIEWPORT, MAX_CAPTURE_HEIGHT, ERROR_MESSAGES,
  CaptureError, isLoginUrl, isAnalyticsUrl, computeClip, captureFilename, errorMessage,
} = require('../lib.js');

test('isLoginUrl: recognises X login flows', () => {
  assert.equal(isLoginUrl('https://x.com/i/flow/login'), true);
  assert.equal(
    isLoginUrl('https://x.com/i/flow/login?redirect_after_login=%2Fi%2Faccount_analytics%2Faudience'),
    true,
  );
  assert.equal(isLoginUrl('https://x.com/login'), true);
});

test('isLoginUrl: never flags the analytics page or other pages', () => {
  assert.equal(isLoginUrl(ANALYTICS_URL), false);
  assert.equal(isLoginUrl(ANALYTICS_URL + '?ref=login'), false);
  assert.equal(isLoginUrl('https://x.com/home'), false);
  assert.equal(isLoginUrl('https://x.com/loginfoo'), false);
});

test('isLoginUrl: garbage input is false, not a throw', () => {
  assert.equal(isLoginUrl('not a url'), false);
  assert.equal(isLoginUrl(''), false);
  assert.equal(isLoginUrl(undefined), false);
});

test('isAnalyticsUrl: matches the analytics section on x.com only', () => {
  assert.equal(isAnalyticsUrl(ANALYTICS_URL), true);
  assert.equal(isAnalyticsUrl(ANALYTICS_URL + '?foo=bar#baz'), true);
  assert.equal(isAnalyticsUrl('https://x.com/i/account_analytics'), true);
  assert.equal(isAnalyticsUrl('https://x.com/i/account_analytics_other'), false);
  assert.equal(isAnalyticsUrl('https://x.com/home'), false);
  assert.equal(isAnalyticsUrl('https://evil.example/i/account_analytics/audience'), false);
  assert.equal(isAnalyticsUrl(undefined), false);
});

test('computeClip: uses content size when valid', () => {
  assert.deepEqual(computeClip({ width: 1280, height: 2400 }, VIEWPORT), {
    x: 0, y: 0, width: 1280, height: 2400, scale: 1,
  });
});

test('computeClip: caps very tall pages', () => {
  assert.equal(computeClip({ width: 1280, height: 99999 }, VIEWPORT).height, MAX_CAPTURE_HEIGHT);
});

test('computeClip: falls back to viewport for missing, zero or NaN sizes', () => {
  const expected = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 1 };
  assert.deepEqual(computeClip(undefined, VIEWPORT), expected);
  assert.deepEqual(computeClip({ width: 0, height: 0 }, VIEWPORT), expected);
  assert.deepEqual(computeClip({ width: NaN, height: 'x' }, VIEWPORT), expected);
});

test('computeClip: rounds fractional sizes', () => {
  const clip = computeClip({ width: 1280.4, height: 1000.6 }, VIEWPORT);
  assert.equal(clip.width, 1280);
  assert.equal(clip.height, 1001);
});

test('captureFilename: ISO timestamp without ms or colons', () => {
  assert.equal(
    captureFilename(new Date('2026-10-15T08:09:10.123Z')),
    'x-audience-2026-10-15T08-09-10Z.png',
  );
});

test('captureFilename: invalid date falls back to now instead of throwing', () => {
  assert.match(captureFilename(new Date('nope')), /^x-audience-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.png$/);
});

test('errorMessage: known code, with and without detail', () => {
  assert.equal(errorMessage('NOT_LOGGED_IN'), ERROR_MESSAGES.NOT_LOGGED_IN);
  assert.equal(
    errorMessage('UNEXPECTED_REDIRECT', 'https://x.com/i/premium'),
    ERROR_MESSAGES.UNEXPECTED_REDIRECT + ' (https://x.com/i/premium)',
  );
});

test('errorMessage: unknown code falls back to CAPTURE_FAILED text and keeps detail', () => {
  const msg = errorMessage('WAT', 'boom');
  assert.ok(msg.startsWith(ERROR_MESSAGES.CAPTURE_FAILED));
  assert.ok(msg.includes('boom'));
});

test('every documented error code has a message', () => {
  for (const code of ['NOT_LOGGED_IN', 'UNEXPECTED_REDIRECT', 'TIMEOUT', 'ATTACH_FAILED', 'CAPTURE_FAILED', 'BUSY']) {
    assert.ok(ERROR_MESSAGES[code], code);
  }
});

test('CaptureError carries code and detail', () => {
  const e = new CaptureError('TIMEOUT', 'slow');
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'TIMEOUT');
  assert.equal(e.detail, 'slow');
  assert.equal(new CaptureError('BUSY').detail, '');
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --test tests/`
Expected: FAIL — `Cannot find module '../lib.js'`.

- [ ] **Step 4: Write the implementation**

Create `lib.js`:

```js
// Pure helpers shared by the service worker, the popup, and Node tests.
// No chrome.* calls here.
(function (root) {
  const ANALYTICS_URL = 'https://x.com/i/account_analytics/audience';
  const VIEWPORT = { width: 1280, height: 900 };
  const MAX_CAPTURE_HEIGHT = 16000;
  const LOAD_TIMEOUT_MS = 15000;
  const SETTLE_MS = 1500;

  const ERROR_MESSAGES = {
    NOT_LOGGED_IN: 'Log in to X in this browser, then try again.',
    UNEXPECTED_REDIRECT: 'X sent the tab somewhere other than the analytics page (it may need a Premium account).',
    TIMEOUT: 'The page did not finish loading within 15 seconds. Try again.',
    ATTACH_FAILED: 'Could not attach the Chrome debugger to the capture tab.',
    CAPTURE_FAILED: 'The screenshot failed.',
    BUSY: 'A capture is already running.',
  };

  class CaptureError extends Error {
    constructor(code, detail) {
      super(detail || code);
      this.name = 'CaptureError';
      this.code = code;
      this.detail = detail || '';
    }
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  function isLoginUrl(url) {
    const u = parseUrl(url);
    return !!u && /^\/(i\/flow\/login|login)(\/|$)/.test(u.pathname);
  }

  function isAnalyticsUrl(url) {
    const u = parseUrl(url);
    return (
      !!u &&
      (u.hostname === 'x.com' || u.hostname === 'www.x.com') &&
      /^\/i\/account_analytics(\/|$)/.test(u.pathname)
    );
  }

  function positive(n) {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }

  function computeClip(size, viewport) {
    const width = positive(size && size.width) || viewport.width;
    const height = Math.min(positive(size && size.height) || viewport.height, MAX_CAPTURE_HEIGHT);
    return { x: 0, y: 0, width, height, scale: 1 };
  }

  function captureFilename(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const stamp = d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
    return `x-audience-${stamp}.png`;
  }

  function errorMessage(code, detail) {
    const base = ERROR_MESSAGES[code] || ERROR_MESSAGES.CAPTURE_FAILED;
    return detail ? `${base} (${detail})` : base;
  }

  const api = {
    ANALYTICS_URL, VIEWPORT, MAX_CAPTURE_HEIGHT, LOAD_TIMEOUT_MS, SETTLE_MS,
    ERROR_MESSAGES, CaptureError,
    isLoginUrl, isAnalyticsUrl, computeClip, captureFilename, errorMessage,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.XLib = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --test tests/`
Expected: PASS — all tests green, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add lib.js tests/lib.test.js
git commit -m "feat: add pure helpers (URL checks, clip math, filenames, errors)"
```

---

### Task 2: Manifest and service-worker capture flow

**Files:**
- Create: `manifest.json`
- Create: `background.js`

**Interfaces:**
- Consumes: `XLib` from `lib.js` (`ANALYTICS_URL`, `VIEWPORT`, `LOAD_TIMEOUT_MS`, `SETTLE_MS`, `CaptureError`, `isLoginUrl`, `isAnalyticsUrl`, `computeClip`, `errorMessage`).
- Produces: a `chrome.runtime` port protocol named `"capture"`.
  - Popup → worker: `{type: "start"}`
  - Worker → popup: `{type: "status", text: string}` (zero or more), then exactly one of
    `{type: "done", capture: {dataUrl: string, capturedAt: string}}` or
    `{type: "error", code: string, message: string}`.
  - Side effect: on success, `chrome.storage.local` key `lastCapture` = `capture`.

- [ ] **Step 1: Create the manifest**

Create `manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "X Audience Screenshot",
  "version": "0.1.0",
  "description": "Screenshot your X audience analytics page and view it in the popup.",
  "permissions": ["tabs", "debugger", "storage"],
  "host_permissions": ["https://x.com/*"],
  "background": { "service_worker": "background.js" },
  "action": {
    "default_popup": "popup.html",
    "default_title": "Capture X audience analytics"
  }
}
```

- [ ] **Step 2: Write the service worker**

Create `background.js`:

```js
importScripts('lib.js');

const {
  ANALYTICS_URL, VIEWPORT, LOAD_TIMEOUT_MS, SETTLE_MS,
  CaptureError, isLoginUrl, isAnalyticsUrl, computeClip, errorMessage,
} = self.XLib;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate, timeoutMs, intervalMs = 100) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(intervalMs);
  }
  return predicate();
}

// Opens the analytics page in an inactive tab, screenshots it over CDP,
// and returns a PNG data URL. Always closes the tab and detaches the debugger.
async function captureAudience(report) {
  let tab = null;
  let target = null;
  let attached = false;
  let onEvent = null;
  const send = (method, params) => chrome.debugger.sendCommand(target, method, params);

  try {
    report('Opening X analytics page…');
    tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    target = { tabId: tab.id };

    try {
      await chrome.debugger.attach(target, '1.3');
      attached = true;
    } catch (e) {
      throw new CaptureError('ATTACH_FAILED', e && e.message);
    }

    const idle = new Set();
    const loaded = new Set();
    onEvent = (source, method, params) => {
      if (source.tabId !== tab.id || method !== 'Page.lifecycleEvent') return;
      if (params.name === 'networkIdle') idle.add(params.loaderId);
      if (params.name === 'load') loaded.add(params.loaderId);
    };
    chrome.debugger.onEvent.addListener(onEvent);

    await send('Page.enable');
    await send('Page.setLifecycleEventsEnabled', { enabled: true });
    await send('Emulation.setDeviceMetricsOverride', {
      width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: 1, mobile: false,
    });
    await send('Emulation.setFocusEmulationEnabled', { enabled: true });

    report('Waiting for the page to load…');
    const nav = await send('Page.navigate', { url: ANALYTICS_URL });
    if (nav.errorText) throw new CaptureError('CAPTURE_FAILED', nav.errorText);
    if (!nav.loaderId) throw new CaptureError('CAPTURE_FAILED', 'navigation did not start');

    // X keeps connections open, so networkIdle may never fire; `load` is enough.
    const idleSeen = await waitUntil(() => idle.has(nav.loaderId), LOAD_TIMEOUT_MS);
    if (!idleSeen && !loaded.has(nav.loaderId)) throw new CaptureError('TIMEOUT');
    await sleep(SETTLE_MS);

    const { url } = await chrome.tabs.get(tab.id);
    if (isLoginUrl(url)) throw new CaptureError('NOT_LOGGED_IN');
    if (!isAnalyticsUrl(url)) throw new CaptureError('UNEXPECTED_REDIRECT', url);

    report('Capturing screenshot…');
    const metrics = await send('Page.getLayoutMetrics');
    const clip = computeClip(metrics.cssContentSize || metrics.contentSize, VIEWPORT);
    const shot = await send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, clip,
    });
    return 'data:image/png;base64,' + shot.data;
  } catch (e) {
    if (e instanceof CaptureError) throw e;
    throw new CaptureError('CAPTURE_FAILED', e && e.message);
  } finally {
    if (onEvent) chrome.debugger.onEvent.removeListener(onEvent);
    if (attached) {
      try { await chrome.debugger.detach(target); } catch { /* already detached */ }
    }
    if (tab) {
      try { await chrome.tabs.remove(tab.id); } catch { /* already closed */ }
    }
  }
}

let busy = false;

function post(port, message) {
  try { port.postMessage(message); } catch { /* popup closed; result is still saved */ }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'capture') return;
  port.onMessage.addListener(async (msg) => {
    if (!msg || msg.type !== 'start') return;
    if (busy) {
      post(port, { type: 'error', code: 'BUSY', message: errorMessage('BUSY') });
      return;
    }
    busy = true;
    try {
      const dataUrl = await captureAudience((text) => post(port, { type: 'status', text }));
      const capture = { dataUrl, capturedAt: new Date().toISOString() };
      await chrome.storage.local.set({ lastCapture: capture });
      post(port, { type: 'done', capture });
    } catch (e) {
      const code = e instanceof CaptureError ? e.code : 'CAPTURE_FAILED';
      const detail = e instanceof CaptureError ? e.detail : e && e.message;
      post(port, { type: 'error', code, message: errorMessage(code, detail) });
    } finally {
      busy = false;
    }
  });
});
```

- [ ] **Step 3: Syntax-check and re-run unit tests**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --check background.js && python3 -c "import json;json.load(open('manifest.json'))" && node --test tests/`
Expected: no output from the checks, tests still PASS.

- [ ] **Step 4: Commit**

```bash
git add manifest.json background.js
git commit -m "feat: add manifest and debugger-based capture service worker"
```

---

### Task 3: Popup UI

**Files:**
- Create: `popup.html`
- Create: `popup.css`
- Create: `popup.js`

**Interfaces:**
- Consumes: the `"capture"` port protocol from Task 2; `chrome.storage.local` key `lastCapture`; `XLib.captureFilename` from `lib.js` (loaded via `<script src="lib.js">`).
- Produces: the user-facing popup (no further consumers).

- [ ] **Step 1: Create the markup**

Create `popup.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>X Audience Screenshot</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <h1>X audience analytics</h1>
  <button id="capture" type="button">Capture</button>
  <p id="status" role="status" aria-live="polite">No capture yet.</p>
  <figure id="result" hidden>
    <div class="frame"><img id="shot" alt="Screenshot of the X audience analytics page"></div>
    <figcaption id="meta"></figcaption>
  </figure>
  <button id="download" type="button" class="secondary" hidden>Download PNG</button>
  <script src="lib.js"></script>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Create the styles**

Create `popup.css`:

```css
:root {
  --bg: #ffffff;
  --fg: #0f1419;
  --muted: #536471;
  --accent: #1d9bf0;
  --accent-fg: #ffffff;
  --border: #cfd9de;
  --error: #c0273d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15202b;
    --fg: #e7e9ea;
    --muted: #8b98a5;
    --border: #38444d;
    --error: #ff6b81;
  }
}
* { box-sizing: border-box; }
body {
  width: 420px;
  margin: 0;
  padding: 16px;
  background: var(--bg);
  color: var(--fg);
  font: 14px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
}
h1 { margin: 0 0 12px; font-size: 16px; }
button {
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-fg);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button.secondary { margin-top: 12px; background: transparent; color: var(--fg); border: 1px solid var(--border); }
button:disabled { opacity: 0.6; cursor: progress; }
#status { margin: 10px 0; color: var(--muted); }
#status.error { color: var(--error); }
figure { margin: 0; }
.frame { max-height: 480px; overflow: auto; border: 1px solid var(--border); border-radius: 8px; }
.frame img { display: block; width: 100%; height: auto; }
figcaption { margin-top: 6px; font-size: 12px; color: var(--muted); }
[hidden] { display: none !important; }
```

- [ ] **Step 3: Create the popup logic**

Create `popup.js`:

```js
const els = {
  capture: document.getElementById('capture'),
  status: document.getElementById('status'),
  result: document.getElementById('result'),
  shot: document.getElementById('shot'),
  meta: document.getElementById('meta'),
  download: document.getElementById('download'),
};

let current = null;
let port = null;

function setStatus(text, isError = false) {
  els.status.textContent = text;
  els.status.classList.toggle('error', isError);
}

function show(capture) {
  current = capture;
  els.shot.src = capture.dataUrl;
  els.meta.textContent = 'Captured ' + new Date(capture.capturedAt).toLocaleString();
  els.result.hidden = false;
  els.download.hidden = false;
}

function finish() {
  els.capture.disabled = false;
  const p = port;
  port = null;
  try { p && p.disconnect(); } catch { /* already closed */ }
}

function startCapture() {
  if (port) return;
  els.capture.disabled = true;
  setStatus('Starting…');
  port = chrome.runtime.connect({ name: 'capture' });
  port.onMessage.addListener((msg) => {
    if (msg.type === 'status') {
      setStatus(msg.text);
    } else if (msg.type === 'done') {
      show(msg.capture);
      setStatus('Done.');
      finish();
    } else if (msg.type === 'error') {
      setStatus(msg.message, true);
      finish();
    }
  });
  port.onDisconnect.addListener(() => {
    if (!port) return;
    setStatus('Lost connection to the extension. Try again.', true);
    finish();
  });
  port.postMessage({ type: 'start' });
}

function download() {
  if (!current) return;
  const a = document.createElement('a');
  a.href = current.dataUrl;
  a.download = XLib.captureFilename(new Date(current.capturedAt));
  a.click();
}

async function loadLastCapture() {
  try {
    const { lastCapture } = await chrome.storage.local.get('lastCapture');
    if (lastCapture && lastCapture.dataUrl) {
      show(lastCapture);
      setStatus('Showing your last capture.');
    }
  } catch {
    /* storage unavailable: stay on the empty state */
  }
}

els.capture.addEventListener('click', startCapture);
els.download.addEventListener('click', download);
loadLastCapture();
```

- [ ] **Step 4: Syntax-check**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --check popup.js && node --test tests/`
Expected: no output from the check, tests still PASS.

- [ ] **Step 5: Commit**

```bash
git add popup.html popup.css popup.js
git commit -m "feat: add popup UI with capture, preview and download"
```

---

### Task 4: README and manual verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: the finished extension from Tasks 1–3.
- Produces: install instructions and the manual verification checklist.

- [ ] **Step 1: Write the README**

Create `README.md`:

````markdown
# X Audience Screenshot

Chrome extension (MV3) that screenshots `https://x.com/i/account_analytics/audience` using your logged-in X session and shows it in the popup.

## Install (unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Log in to x.com in this Chrome profile.
4. Click the extension icon, then **Capture**.

While capturing, Chrome shows a "started debugging this browser" banner on a temporary background tab. That is expected — the extension uses the Chrome debugger to take screenshots of background tabs. The tab closes when the capture finishes.

## Tests

```
node --test tests/
```

## Manual verification checklist

- [ ] Logged in: Capture → status steps through Opening → Waiting → Capturing → Done; the audience page appears in the popup; the temp tab is gone afterwards.
- [ ] Download PNG saves `x-audience-<timestamp>.png` and the image opens correctly.
- [ ] Close and reopen the popup: the last capture is shown with its timestamp.
- [ ] Logged out (e.g. in a profile with no X session): message "Log in to X in this browser, then try again."
- [ ] Double-click Capture: only one capture runs; no leftover tabs.
- [ ] Close the popup mid-capture, wait ~10 s, reopen: the finished capture is shown; no leftover tabs.
- [ ] Open DevTools on another tab and capture: still works. (To test `ATTACH_FAILED`, it's enough to confirm the error text is readable if it ever occurs.)
- [ ] Charts blank in the screenshot? Increase `SETTLE_MS` in `lib.js` (default 1500).
- [ ] Popup opened for the first time (clear storage via `chrome.storage.local.clear()` in the service-worker console): shows "No capture yet." and no broken image.
````

- [ ] **Step 2: Load the extension and run the checklist**

Run: load the folder unpacked at `chrome://extensions` and work through every checkbox in `README.md`. Record any failure as a bug and fix it before continuing (use superpowers:systematic-debugging).
Expected: every checkbox passes. This step needs the user's logged-in Chrome — ask the user to perform the logged-in checks and report results.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README with install and manual verification checklist"
```

---

## Self-Review

- **Spec coverage:** manifest and permissions → Task 2; capture flow steps 1–7 → Task 2 (`captureAudience` plus port handler); `lib.js` helpers → Task 1; popup behaviour (last capture on open, disabled button, status steps, download filename) → Task 3; error handling (including the added `UNEXPECTED_REDIRECT` and the `networkIdle` → `load` fallback) → Tasks 1–2; testing (unit tests for `lib.js` plus a manual checklist) → Tasks 1 and 4. No gaps.
- **Placeholders:** none; every code step has complete code.
- **Type consistency:** `XLib` names in `background.js` and `popup.js` match the Task 1 exports (`ANALYTICS_URL`, `VIEWPORT`, `LOAD_TIMEOUT_MS`, `SETTLE_MS`, `CaptureError`, `isLoginUrl`, `isAnalyticsUrl`, `computeClip`, `errorMessage`, `captureFilename`). Port message shapes match between Task 2 and Task 3.
- **Review Focus:** items 1 and 3 are pinned by Task 1 tests; 2, 4, 5 and 6 are covered by the manual checklist in Task 4 (they depend on real Chrome and X behaviour and can't run in Node).
