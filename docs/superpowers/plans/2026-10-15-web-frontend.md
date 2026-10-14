# Browser Front-End (Screenshot Drop Page) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone browser page in `web/` where the user can drop, choose, or paste a screenshot of their X audience page and see it previewed, styled like the supplied mockup. UI only: no backend, nothing leaves the browser. The Chrome extension is untouched.

**Architecture:** Plain HTML/CSS/JS, no build step, no dependencies. Pure logic (`validateImage`, `formatBytes`) lives in `web/helpers.js` (browser global `WebHelpers` + `module.exports`) and is unit-tested in Node. DOM behaviour lives in `web/app.js` and is verified by a committed real-browser script, `tests/browser-check.mjs`, that serves `web/`, drives headless Chrome over CDP (pipe transport), simulates drop / choose / paste, and saves screenshots.

**Tech Stack:** HTML, CSS, vanilla JS; Node 22 (`node:test`, `node:http`); Chrome headless for the browser check; `python3 -m http.server` to view the page.

**Spec:** `docs/superpowers/specs/2026-10-15-web-frontend-design.md`

## Global Constraints

- Files live under `web/` (`index.html`, `styles.css`, `app.js`, `helpers.js`) plus `tests/web-helpers.test.js` and `tests/browser-check.mjs`. Do not modify any extension file (`manifest.json`, `background.js`, `lib.js`, `popup.*`).
- No build step, no npm dependencies, no network requests carrying the image (object URLs only).
- Accepted types: `image/png`, `image/jpeg`, `image/webp`. Max size `10 * 1024 * 1024` bytes (exactly that size is accepted; one byte more is rejected). Zero-byte files rejected.
- Error copy, verbatim: `That file isn't a PNG, JPEG or WebP image.` / `That image is over 10 MB. Try a smaller screenshot.` / `That file is empty.`
- Lead line copy, verbatim: `No screenshot yet. Screenshot your X audience page and drop it here.`; after accepting an image: `Screenshot ready.`
- Banner link: `https://x.com/i/account_analytics/audience`, `target="_blank" rel="noopener"`.
- The drop zone is a `<button>`; status/errors live in an `aria-live="polite"` region; focus returns to the drop zone after Remove.
- Revoke the previous object URL whenever the image is replaced or removed.
- Run unit tests with bare `node --test` (a directory argument fails on Node 22). Run the browser check with `node tests/browser-check.mjs` (needs `google-chrome`, or set `CHROME=`).
- Commit messages end with the trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Rejected file while a preview exists** (wrong type, over 10 MB, empty): expect the error message and the existing preview left untouched. *(Task 3 browser check.)*
2. **Plain-text paste**: expect it ignored (default not prevented, state unchanged) so pasting text elsewhere still works; an image paste with an empty file name falls back to "Pasted image". *(Task 3 browser check.)*
3. **File dropped outside the drop target**: expect the browser not to navigate away (event default prevented) and the image ignored. *(Task 3 browser check.)*
4. **Several files dropped at once**: expect only the first used. *(Task 3 browser check.)*
5. **Object-URL leaks and re-choosing the same file**: expect `revokeObjectURL` on every replace/remove and the file input cleared after each selection so choosing the same file again fires `change`. *(Task 3 browser check.)*

---

## File Structure

| File | Responsibility |
|---|---|
| `web/helpers.js` | Pure helpers: `ALLOWED_TYPES`, `MAX_BYTES`, `MESSAGES`, `validateImage`, `formatBytes`. No DOM. |
| `web/index.html` | Markup for the card, banner, drop zone, preview, hidden file input. |
| `web/styles.css` | Visual design matching the mockup; responsive. |
| `web/app.js` | Drop / choose / paste handling, preview, replace/remove, errors, cleanup. |
| `tests/web-helpers.test.js` | Node unit tests for `helpers.js`. |
| `tests/browser-check.mjs` | Real-browser checks + screenshots (static in Task 2, behaviour in Task 3). |
| `README.md` | Modify: add "Web front-end" section. |

---

### Task 1: Pure helpers in `web/helpers.js` (TDD)

**Files:**
- Create: `web/helpers.js`
- Test: `tests/web-helpers.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces (browser global `WebHelpers`, and `module.exports` in Node):
  - `ALLOWED_TYPES: string[]` = `['image/png','image/jpeg','image/webp']`
  - `MAX_BYTES: number` = `10485760`
  - `MESSAGES: {notImage: string, tooLarge: string, empty: string}` (the verbatim error copy)
  - `validateImage(file: {type?: string, size?: number} | null | undefined): {ok: true} | {ok: false, error: string}` — checks run in order: type, then empty, then too large; a missing file is reported as `notImage`.
  - `formatBytes(n: number): string` — `"0 B"` for 0/negative/NaN; `"<n> B"` below 1 KB; `"<x.y> KB"` below ~1 MB; otherwise `"<x.y> MB"`.

- [ ] **Step 1: Write the failing tests**

Create `tests/web-helpers.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { ALLOWED_TYPES, MAX_BYTES, MESSAGES, validateImage, formatBytes } = require('../web/helpers.js');

test('constants: allowed types and 10 MB limit', () => {
  assert.deepEqual(ALLOWED_TYPES, ['image/png', 'image/jpeg', 'image/webp']);
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
});

test('validateImage: accepts png, jpeg and webp', () => {
  for (const type of ALLOWED_TYPES) {
    assert.deepEqual(validateImage({ type, size: 1234 }), { ok: true }, type);
  }
});

test('validateImage: size boundary — exactly 10 MB ok, one byte more rejected', () => {
  assert.deepEqual(validateImage({ type: 'image/png', size: MAX_BYTES }), { ok: true });
  assert.deepEqual(validateImage({ type: 'image/png', size: MAX_BYTES + 1 }), { ok: false, error: MESSAGES.tooLarge });
});

test('validateImage: empty file rejected', () => {
  assert.deepEqual(validateImage({ type: 'image/png', size: 0 }), { ok: false, error: MESSAGES.empty });
});

test('validateImage: wrong, empty or missing type is "not an image"', () => {
  assert.deepEqual(validateImage({ type: 'image/gif', size: 10 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ type: 'text/plain', size: 10 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ type: '', size: 10 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ size: 10 }), { ok: false, error: MESSAGES.notImage });
});

test('validateImage: type is checked before size (a huge text file is "not an image")', () => {
  assert.deepEqual(validateImage({ type: 'text/plain', size: MAX_BYTES * 2 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ type: 'text/plain', size: 0 }), { ok: false, error: MESSAGES.notImage });
});

test('validateImage: null / undefined file is "not an image", not a throw', () => {
  assert.deepEqual(validateImage(null), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage(undefined), { ok: false, error: MESSAGES.notImage });
});

test('validateImage: missing or NaN size is treated as empty', () => {
  assert.deepEqual(validateImage({ type: 'image/png' }), { ok: false, error: MESSAGES.empty });
  assert.deepEqual(validateImage({ type: 'image/png', size: NaN }), { ok: false, error: MESSAGES.empty });
});

test('error messages are the verbatim copy from the spec', () => {
  assert.equal(MESSAGES.notImage, "That file isn't a PNG, JPEG or WebP image.");
  assert.equal(MESSAGES.tooLarge, 'That image is over 10 MB. Try a smaller screenshot.');
  assert.equal(MESSAGES.empty, 'That file is empty.');
});

test('formatBytes: zero, negative and junk', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
});

test('formatBytes: bytes, KB and MB', () => {
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(MAX_BYTES), '10.0 MB');
});

test('formatBytes: just under 1 MB rolls over to MB instead of "1024.0 KB"', () => {
  assert.equal(formatBytes(1024 * 1024 - 1), '1.0 MB');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --test 2>&1 | grep -E "Cannot find|^# (pass|fail)"`
Expected: FAIL — `Cannot find module '../web/helpers.js'` (the 15 existing `tests/lib.test.js` tests still pass; this file errors).

- [ ] **Step 3: Write the implementation**

Create `web/helpers.js`:

```js
// Pure helpers for the screenshot drop page. No DOM access here.
(function (root) {
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_BYTES = 10 * 1024 * 1024;

  const MESSAGES = {
    notImage: "That file isn't a PNG, JPEG or WebP image.",
    tooLarge: 'That image is over 10 MB. Try a smaller screenshot.',
    empty: 'That file is empty.',
  };

  function validateImage(file) {
    if (!file || !ALLOWED_TYPES.includes(file.type)) return { ok: false, error: MESSAGES.notImage };
    const size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) return { ok: false, error: MESSAGES.empty };
    if (size > MAX_BYTES) return { ok: false, error: MESSAGES.tooLarge };
    return { ok: true };
  }

  function formatBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '0 B';
    if (v < 1024) return `${Math.round(v)} B`;
    const kb = v / 1024;
    if (kb < 1023.9) return `${kb.toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  }

  const api = { ALLOWED_TYPES, MAX_BYTES, MESSAGES, validateImage, formatBytes };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WebHelpers = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --test 2>&1 | grep -E "^# (tests|pass|fail)|not ok"`
Expected: PASS — all tests green (15 extension tests + 12 new), 0 failures.

- [ ] **Step 5: Commit**

```bash
git add web/helpers.js tests/web-helpers.test.js
git commit -m "feat(web): add image validation and byte formatting helpers" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Static page and the browser-check harness

**Files:**
- Create: `tests/browser-check.mjs`
- Create: `web/index.html`
- Create: `web/styles.css`

**Interfaces:**
- Consumes: `WebHelpers` from `web/helpers.js` (loaded by `index.html`; first used in Task 3).
- Produces: DOM contract that Task 3's `app.js` and checks rely on — element ids `status` (`<p class="lead">`, aria-live), `drop` (`<button>`), `file` (`<input type="file" hidden>`), `preview` (`<figure hidden>`), `shot` (`<img>`), `meta` (`<span>`), `replace` and `remove` (`<button class="link">`); CSS class `dragging` (applied to `#drop` / `#preview` during a drag) and `error` (on `#status`).
- Produces: `tests/browser-check.mjs`, a script that exits non-zero if any check fails and saves screenshots to `$SHOT_DIR` (default `<tmpdir>/web-shots`). It defines `staticChecks()` here; Task 3 adds `behaviourChecks()`.

- [ ] **Step 1: Write the harness with static checks (this is the failing test)**

Create `tests/browser-check.mjs`:

```js
// Real-browser checks for web/. Run: node tests/browser-check.mjs
// Needs Chrome (`google-chrome`, or set CHROME=/path). Screenshots go to $SHOT_DIR.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'web');
const SHOTS = process.env.SHOT_DIR || join(tmpdir(), 'web-shots');
mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

// --- static file server for web/ ---------------------------------------
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = resolve(ROOT, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(ROOT + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_UNDER_TEST = `http://127.0.0.1:${server.address().port}/`;

// --- headless Chrome over a CDP pipe ------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'web-check-profile-'));
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-sandbox', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });

let buf = '';
let nextId = 0;
const pending = new Map();
chrome.stdio[4].on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i));
    buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let sessionId;
const cmd = (method, params) => send(method, params, sessionId);
const VIEWPORT = { width: 900, height: 800, deviceScaleFactor: 2, mobile: false };

async function ev(expression, awaitPromise = false) {
  const r = await cmd('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
  }
  return r.result.value;
}

async function shot(name) {
  const h = await ev('document.documentElement.scrollHeight');
  await cmd('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, height: Math.max(h, 400) });
  const { data } = await cmd('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, name), Buffer.from(data, 'base64'));
  await cmd('Emulation.setDeviceMetricsOverride', VIEWPORT);
}

let failed = 0;
function check(name, ok, detail = '') {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
}

// --- checks --------------------------------------------------------------
async function staticChecks() {
  const text = (id) => ev(`document.getElementById('${id}').textContent.trim()`);
  check('lead line', (await text('status')) === 'No screenshot yet. Screenshot your X audience page and drop it here.', await text('status'));
  check('heading', (await ev("document.querySelector('h1').textContent")) === 'Send a screenshot');
  check('banner link',
    (await ev("(() => { const a = document.querySelector('.banner a'); return a && a.href + '|' + a.target + '|' + a.rel; })()"))
      === 'https://x.com/i/account_analytics/audience|_blank|noopener');
  check('drop zone is a visible button',
    (await ev("(() => { const d = document.getElementById('drop'); return d.tagName === 'BUTTON' && !d.hidden && /Drop your screenshot/.test(d.textContent) && /click to choose/.test(d.textContent); })()")) === true);
  check('preview hidden initially', (await ev("document.getElementById('preview').hidden")) === true);
  check('file input accepts png/jpeg/webp',
    (await ev("document.getElementById('file').accept")) === 'image/png,image/jpeg,image/webp');
  check('status is a live region', (await ev("document.getElementById('status').getAttribute('aria-live')")) === 'polite');
  await shot('web-empty.png');
}

// --- run -------------------------------------------------------------------
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await cmd('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await cmd('Page.enable');
  await cmd('Page.navigate', { url: URL_UNDER_TEST });
  for (let i = 0; i < 50 && (await ev('document.readyState')) !== 'complete'; i++) await sleep(100);
  await staticChecks();
} catch (e) {
  failed++;
  console.log('ERROR', e.stack || e.message);
} finally {
  chrome.kill('SIGKILL');
  server.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
console.log('screenshots in', SHOTS);
process.exit(failed ? 1 : 0);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node tests/browser-check.mjs; echo "exit=$?"`
Expected: FAIL — the server answers 404 (`not found`) for `index.html`, so the `FAIL` lines appear (or an `ERROR` for a missing element) and `exit=1`.

- [ ] **Step 3: Write the markup**

Create `web/index.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Send a screenshot</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="card">
    <p id="status" class="lead" role="status" aria-live="polite">No screenshot yet. Screenshot your X audience page and drop it here.</p>

    <h1>Send a screenshot</h1>

    <div class="banner">
      <div class="banner-text">
        <strong>Open your X audience page</strong>
        <span>Only you can see it — screenshot the whole tab and we do the rest.</span>
      </div>
      <a class="open-link" href="https://x.com/i/account_analytics/audience" target="_blank" rel="noopener">
        open
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>
        </svg>
      </a>
    </div>

    <input id="file" type="file" accept="image/png,image/jpeg,image/webp" hidden>

    <button id="drop" type="button" class="drop">
      <svg class="drop-icon" viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.6"/><path d="M21 16l-5-5-8 8"/>
      </svg>
      <span class="drop-title">Drop your screenshot</span>
      <span class="drop-hint">or click to choose — paste works too</span>
    </button>

    <figure id="preview" hidden>
      <div class="frame"><img id="shot" alt="Your X audience screenshot"></div>
      <figcaption>
        <span id="meta"></span>
        <span class="actions">
          <button id="replace" type="button" class="link">Replace</button>
          <button id="remove" type="button" class="link">Remove</button>
        </span>
      </figcaption>
    </figure>
  </main>
  <script src="helpers.js"></script>
</body>
</html>
```

- [ ] **Step 4: Write the styles**

Create `web/styles.css`:

```css
:root {
  --page: #f4f4f5;
  --card: #ffffff;
  --fg: #141414;
  --muted: #6b6b70;
  --faint: #a1a1a8;
  --accent: #1a3cf0;
  --banner: #eaeefd;
  --border: #d9dbe0;
  --error: #c0273d;
}
* { box-sizing: border-box; }
body {
  min-height: 100vh;
  margin: 0;
  padding: 48px 16px;
  background: var(--page);
  color: var(--fg);
  font: 15px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
}
.card {
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
  padding: 32px;
  background: var(--card);
  border-radius: 16px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.lead { margin: 0 0 28px; color: var(--muted); }
.lead.error { color: var(--error); }
h1 { margin: 0 0 12px; font-size: 18px; font-weight: 650; }

.banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 16px;
  padding: 14px 18px;
  background: var(--banner);
  border-radius: 12px;
}
.banner-text { display: flex; flex-direction: column; }
.banner-text strong { color: var(--accent); font-weight: 600; }
.banner-text span { color: var(--muted); font-size: 14px; }
.open-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--accent);
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}
.open-link:hover { text-decoration: underline; }

.drop {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 100%;
  min-height: 160px;
  padding: 24px;
  background: transparent;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
  color: var(--fg);
  font: inherit;
  cursor: pointer;
}
.drop > * { pointer-events: none; }
.drop:hover, .drop:focus-visible, .drop.dragging { border-color: var(--accent); }
.drop.dragging { background: var(--banner); }
.drop-icon { margin-bottom: 8px; color: var(--accent); }
.drop-title { font-weight: 600; }
.drop-hint { color: var(--faint); font-size: 14px; }

figure { margin: 0; }
.frame {
  max-height: 420px;
  overflow: auto;
  border: 1.5px dashed var(--border);
  border-radius: 12px;
}
#preview.dragging .frame { border-color: var(--accent); background: var(--banner); }
.frame img { display: block; width: 100%; height: auto; }
figcaption {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  color: var(--faint);
  font-size: 13px;
}
.actions { display: inline-flex; gap: 14px; }
button.link {
  padding: 0;
  background: none;
  border: 0;
  color: var(--accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
button.link:hover { text-decoration: underline; }
[hidden] { display: none !important; }

@media (max-width: 520px) {
  body { padding: 16px 8px; }
  .card { padding: 20px; }
}
```

- [ ] **Step 5: Run the browser check to verify it passes**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node tests/browser-check.mjs; echo "exit=$?"`
Expected: PASS — 7 `PASS` lines, `all checks passed`, `exit=0`, and `web-empty.png` written to the printed screenshots directory.

- [ ] **Step 6: Compare the screenshot to the mockup**

Run: view `<SHOT_DIR>/web-empty.png` (path printed by the script) with the Read tool.
Expected: a centred white card with the lead line, "Send a screenshot" heading, blue-tinted banner with `open ↗`, and a dashed drop zone with the image icon, "Drop your screenshot", "or click to choose — paste works too". Fix any visible deviation from the mockup before committing.

- [ ] **Step 7: Commit**

```bash
git add tests/browser-check.mjs web/index.html web/styles.css
git commit -m "feat(web): add static screenshot page and real-browser check harness" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Behaviour — drop, choose, paste, preview (browser-verified)

**Files:**
- Create: `web/app.js`
- Modify: `web/index.html` (add `<script src="app.js"></script>` after the `helpers.js` script tag)
- Modify: `tests/browser-check.mjs` (add `behaviourChecks()` and call it after `staticChecks()`)

**Interfaces:**
- Consumes: `WebHelpers.validateImage`, `WebHelpers.formatBytes` (Task 1); DOM ids `status`, `drop`, `file`, `preview`, `shot`, `meta`, `replace`, `remove` and CSS classes `dragging` / `error` (Task 2); harness functions `ev`, `check`, `shot` (Task 2).
- Produces: the finished page behaviour (no further consumers).

- [ ] **Step 1: Write the failing behaviour checks**

In `tests/browser-check.mjs`, insert this function directly above the `// --- run ---` comment:

```js
async function behaviourChecks() {
  // In-page test helpers. Note `status` is a window property, so always look elements up by id.
  await ev(`(() => {
    window.q = (id) => document.getElementById(id);
    window.__t = {
      revoked: 0, picker: 0,
      png: async (name, w = 1000, h = 700) => {
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const g = c.getContext('2d');
        g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
        g.fillStyle = '#eaeefd'; g.fillRect(30, 30, w - 60, 120);
        g.fillStyle = '#1a3cf0';
        for (let i = 0; i < 10; i++) g.fillRect(50 + i * 90, h - 80 - i * 35, 60, 40 + i * 35);
        const b = await new Promise((r) => c.toBlob(r, 'image/png'));
        return new File([b], name, { type: 'image/png' });
      },
      dt: (...files) => { const d = new DataTransfer(); files.forEach((f) => d.items.add(f)); return d; },
      drop: (target, ...files) => {
        const e = new DragEvent('drop', { dataTransfer: window.__t.dt(...files), bubbles: true, cancelable: true });
        target.dispatchEvent(e);
        return e.defaultPrevented;
      },
      paste: (dt) => {
        const e = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        document.dispatchEvent(e);
        return e.defaultPrevented;
      },
    };
    const orig = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => { window.__t.revoked++; orig(u); };
    window.q('file').click = () => { window.__t.picker++; };
    return true;
  })()`);

  const st = async () => JSON.parse(await ev(`JSON.stringify({
    status: q('status').textContent, err: q('status').classList.contains('error'),
    dropHidden: q('drop').hidden, previewHidden: q('preview').hidden,
    src: q('shot').getAttribute('src'), meta: q('meta').textContent,
    input: q('file').value, revoked: __t.revoked, picker: __t.picker,
    active: document.activeElement && document.activeElement.id })`));
  const LEAD = 'No screenshot yet. Screenshot your X audience page and drop it here.';

  // Drag feedback
  await ev(`q('drop').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true }))`);
  check('drag over highlights the drop zone', (await ev(`q('drop').classList.contains('dragging')`)) === true);
  await ev(`q('drop').dispatchEvent(new DragEvent('dragleave', { bubbles: true }))`);
  check('drag leave clears the highlight', (await ev(`q('drop').classList.contains('dragging')`)) === false);

  // Drop a valid PNG -> preview
  let s = await st();
  await ev(`(async () => __t.drop(q('drop'), await __t.png('one.png')))()`, true);
  s = await st();
  check('drop a PNG shows the preview',
    !s.previewHidden && s.dropHidden && s.src.startsWith('blob:') && s.status === 'Screenshot ready.' && !s.err, JSON.stringify(s));
  check('meta shows name and size', /one\.png · \d/.test(s.meta), s.meta);
  check('file input is cleared after accepting', s.input === '');
  await shot('web-preview.png');
  const firstSrc = s.src;

  // Review Focus 1: rejected files leave the existing preview untouched
  await ev(`__t.drop(q('preview'), new File(['hello'], 'notes.txt', { type: 'text/plain' }))`);
  s = await st();
  check('wrong type: error shown, preview kept',
    s.err && s.status === "That file isn't a PNG, JPEG or WebP image." && s.src === firstSrc && !s.previewHidden, s.status);
  await ev(`__t.drop(q('preview'), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }))`);
  s = await st();
  check('over 10 MB: error shown, preview kept',
    s.err && s.status === 'That image is over 10 MB. Try a smaller screenshot.' && s.src === firstSrc, s.status);
  await ev(`__t.drop(q('preview'), new File([], 'empty.png', { type: 'image/png' }))`);
  s = await st();
  check('empty file: error shown, preview kept', s.err && s.status === 'That file is empty.' && s.src === firstSrc, s.status);

  // Review Focus 3: drop outside the target is prevented (no navigation) and ignored
  const outside = await ev(`(async () => __t.drop(document.body, await __t.png('outside.png')))()`, true);
  s = await st();
  check('drop outside the target is default-prevented', outside === true);
  check('drop outside the target is ignored', s.src === firstSrc && /one\.png/.test(s.meta), s.meta);
  check('dragover elsewhere is default-prevented',
    (await ev(`(() => { const e = new DragEvent('dragover', { bubbles: true, cancelable: true }); document.body.dispatchEvent(e); return e.defaultPrevented; })()`)) === true);

  // Review Focus 4 + 5: several files -> first only; replace revokes the old URL
  const before = s.revoked;
  await ev(`(async () => __t.drop(q('preview'), await __t.png('two.png'), await __t.png('three.png')))()`, true);
  s = await st();
  check('several files: only the first is used', /two\.png/.test(s.meta) && !/three\.png/.test(s.meta), s.meta);
  check('replacing revokes the previous object URL', s.revoked === before + 1 && s.src !== firstSrc, `revoked ${before}→${s.revoked}`);

  // Replace opens the picker
  await ev(`q('replace').click()`);
  check('Replace opens the file picker', (await st()).picker === 1);

  // Remove -> empty state
  const beforeRemove = (await st()).revoked;
  await ev(`q('remove').click()`);
  s = await st();
  check('Remove returns to the empty state',
    s.previewHidden && !s.dropHidden && s.src === null && s.status === LEAD && !s.err, JSON.stringify(s));
  check('Remove revokes the object URL', s.revoked === beforeRemove + 1);
  check('Remove returns focus to the drop zone', s.active === 'drop', s.active);

  // Errors from the empty state
  await ev(`__t.drop(q('drop'), new File(['hello'], 'notes.txt', { type: 'text/plain' }))`);
  s = await st();
  check('error from the empty state keeps the drop zone', s.err && !s.dropHidden && s.previewHidden, s.status);
  await shot('web-error.png');

  // Click to choose
  await ev(`q('drop').click()`);
  check('clicking the drop zone opens the file picker', (await st()).picker === 2);
  await ev(`(async () => { const f = await __t.png('chosen.png'); q('file').files = __t.dt(f).files; q('file').dispatchEvent(new Event('change', { bubbles: true })); })()`, true);
  s = await st();
  check('choosing a file shows the preview', !s.previewHidden && /chosen\.png/.test(s.meta), s.meta);
  check('file input cleared so the same file can be chosen again', s.input === '', JSON.stringify(s.input));

  // Review Focus 2: paste
  const metaBefore = s.meta;
  const textPrevented = await ev(`(() => { const d = new DataTransfer(); d.setData('text/plain', 'just text'); return __t.paste(d); })()`);
  s = await st();
  check('plain-text paste is ignored (default not prevented)', textPrevented === false && s.meta === metaBefore, s.meta);
  const imgPrevented = await ev(`(async () => __t.paste(__t.dt(await __t.png(''))))()`, true);
  s = await st();
  check('image paste shows the preview', imgPrevented === true && !s.previewHidden && /Pasted image · \d/.test(s.meta), s.meta);

  // Accessibility
  await ev(`q('remove').click()`);
  check('drop zone is a native button (keyboard operable)', (await ev(`q('drop').tagName`)) === 'BUTTON');
}
```

Then change the run block so it calls the new function:

```js
// old
  await staticChecks();
} catch (e) {
// new
  await staticChecks();
  await behaviourChecks();
} catch (e) {
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node tests/browser-check.mjs; echo "exit=$?"`
Expected: FAIL — static checks pass; behaviour checks print `FAIL` (e.g. "drag over highlights the drop zone", "drop a PNG shows the preview") because `app.js` does not exist yet; final `exit=1`. They must fail on assertions, not crash on a missing helper.

- [ ] **Step 3: Write the implementation**

Create `web/app.js`:

```js
(function () {
  const { validateImage, formatBytes } = window.WebHelpers;
  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'), drop: $('drop'), file: $('file'), preview: $('preview'),
    shot: $('shot'), meta: $('meta'), replace: $('replace'), remove: $('remove'),
  };
  const LEAD = 'No screenshot yet. Screenshot your X audience page and drop it here.';
  let objectUrl = null;

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
  }

  function releaseImage() {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function showImage(file) {
    releaseImage();
    objectUrl = URL.createObjectURL(file);
    els.shot.src = objectUrl;
    els.meta.textContent = `${file.name || 'Pasted image'} · ${formatBytes(file.size)}`;
    els.preview.hidden = false;
    els.drop.hidden = true;
    setStatus('Screenshot ready.');
  }

  function reset() {
    releaseImage();
    els.shot.removeAttribute('src');
    els.meta.textContent = '';
    els.preview.hidden = true;
    els.drop.hidden = false;
    els.file.value = '';
    setStatus(LEAD);
    els.drop.focus();
  }

  function accept(file) {
    const result = validateImage(file);
    if (!result.ok) {
      setStatus(result.error, true);
      return;
    }
    showImage(file);
  }

  const firstFile = (dt) => (dt && dt.files && dt.files[0]) || null;

  function bindDropTarget(el) {
    const over = (e) => { e.preventDefault(); el.classList.add('dragging'); };
    el.addEventListener('dragenter', over);
    el.addEventListener('dragover', over);
    el.addEventListener('dragleave', (e) => {
      if (e.relatedTarget && el.contains(e.relatedTarget)) return;
      el.classList.remove('dragging');
    });
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('dragging');
      const file = firstFile(e.dataTransfer);
      if (file) accept(file);
    });
  }
  bindDropTarget(els.drop);
  bindDropTarget(els.preview);

  // A file dropped anywhere else must not make the browser navigate to it.
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  els.drop.addEventListener('click', () => els.file.click());
  els.replace.addEventListener('click', () => els.file.click());
  els.remove.addEventListener('click', reset);

  els.file.addEventListener('change', () => {
    const file = els.file.files && els.file.files[0];
    if (file) accept(file);
    els.file.value = ''; // lets the same file be chosen again
  });

  document.addEventListener('paste', (e) => {
    const file = firstFile(e.clipboardData);
    if (!file) return; // plain-text paste keeps working
    e.preventDefault();
    accept(file);
  });
})();
```

Then in `web/index.html`, add the script tag after the existing one:

```html
  <script src="helpers.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 4: Run the browser check to verify it passes**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node tests/browser-check.mjs; echo "exit=$?"`
Expected: PASS — every line `PASS` (7 static + 24 behaviour), `all checks passed`, `exit=0`. If a check fails, use superpowers:systematic-debugging — fix the code, not the check, unless the check itself is wrong.

- [ ] **Step 5: Look at the preview and error screenshots**

Run: view `<SHOT_DIR>/web-preview.png` and `<SHOT_DIR>/web-error.png` with the Read tool.
Expected: the preview shows the framed drawn image with `one.png · <size>` on the left and **Replace** / **Remove** on the right, lead line "Screenshot ready."; the error shot shows the lead line in red ("That file isn't a PNG, JPEG or WebP image.") with the drop zone still visible.

- [ ] **Step 6: Run the whole unit suite**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: all unit tests pass, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add web/app.js web/index.html tests/browser-check.mjs
git commit -m "feat(web): drop, choose and paste a screenshot with preview, replace and remove" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: README and a real-server smoke test

**Files:**
- Modify: `README.md` (append a "Web front-end" section)

**Interfaces:**
- Consumes: the finished page from Tasks 1–3.
- Produces: run instructions (no further consumers).

- [ ] **Step 1: Add the README section**

Append to `README.md`:

````markdown

## Web front-end

A standalone browser page (separate from the extension) where you drop, choose, or paste a screenshot of your X audience page and see it previewed. Nothing is uploaded; it all stays in your browser.

```
python3 -m http.server 5173 -d web
```

Then open <http://localhost:5173>.

- Drop an image on the dashed box, click it to choose a file, or paste with Ctrl/Cmd+V. PNG, JPEG and WebP up to 10 MB.
- **Replace** and **Remove** appear under the preview.

Checks:

```
node --test                      # unit tests
node tests/browser-check.mjs     # real-browser checks (needs Chrome); screenshots go to $SHOT_DIR
```
````

- [ ] **Step 2: Smoke-test the documented command**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && (python3 -m http.server 5173 -d web >/dev/null 2>&1 & echo $! > /tmp/webserver.pid); sleep 1; curl -s -o /dev/null -w "%{http_code} " http://localhost:5173/; curl -s -o /dev/null -w "%{http_code} " http://localhost:5173/app.js; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5173/helpers.js; kill $(cat /tmp/webserver.pid)`
Expected: `200 200 200`, and the server is stopped afterwards.

- [ ] **Step 3: Final verification**

Run: `cd /home/sayan/Desktop/unfair.so-chrome-extension && node --test 2>&1 | grep -E "^# (tests|pass|fail)" && node tests/browser-check.mjs | tail -3`
Expected: unit tests all pass; the browser check ends with `all checks passed`.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document the web front-end" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage:** goal/UI-only → all tasks; files table → Tasks 1–3 (README in Task 4); layout and copy (lead, heading, banner, drop zone) → Task 2 markup + `staticChecks`; accepting input (drop / click / paste) and drag feedback → Task 3 `app.js` + checks; page-level drop prevention → Task 3 (`window` listeners, "drop outside" checks); validation (types, 10 MB boundary, empty, first of several files) → Task 1 tests + Task 3 checks; preview/Replace/Remove/cleanup → Task 3; accessibility (button, live region, focus after Remove) → Task 2 checks + Task 3 focus check; privacy (object URLs only) → no network code in `app.js`; error messages → Task 1 tests (verbatim) + Task 3 checks; running (`python3 -m http.server`) → Task 4; testing (unit + real-browser + mockup comparison) → Tasks 1–3. No gaps.
- **Placeholders:** none; every code step is complete.
- **Type consistency:** `validateImage` / `formatBytes` / `MESSAGES` / `MAX_BYTES` / `ALLOWED_TYPES` names match between Task 1 and `app.js`; DOM ids (`status`, `drop`, `file`, `preview`, `shot`, `meta`, `replace`, `remove`) match between Task 2 markup, Task 3 `app.js`, and the browser checks; `LEAD` text matches the HTML default and the Global Constraints copy.
- **Review Focus:** items 1–5 each have named checks in Task 3 (rejected files with preview kept; text paste ignored and "Pasted image" fallback; outside drop prevented and ignored; first-of-several; revoke on replace/remove and input cleared).
