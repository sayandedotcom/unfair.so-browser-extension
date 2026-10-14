// Real-browser checks for web/ (the page that shows the extension's capture). Run: node tests/browser-check.mjs
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
const LEAD_EMPTY = 'Waiting for your capture. Click the extension icon and press Capture.';
const LEAD_READY = 'Latest capture from your X audience page.';

async function pageChecks() {
  const text = (id) => ev(`document.getElementById('${id}').textContent.trim()`);
  const hidden = (id) => ev(`document.getElementById('${id}').hidden`);

  // --- empty state ---
  check('lead line', (await text('status')) === LEAD_EMPTY, await text('status'));
  check('heading', (await ev("document.querySelector('h1').textContent")) === 'Screenshot');
  check('banner link',
    (await ev("(() => { const a = document.querySelector('.banner a'); return a && a.href + '|' + a.target + '|' + a.rel; })()"))
      === 'https://x.com/i/account_analytics/audience|_blank|noopener');
  check('placeholder shown, preview hidden', (await hidden('placeholder')) === false && (await hidden('preview')) === true);
  check('placeholder tells the user how to capture', /extension icon/.test(await text('placeholder')), await text('placeholder'));
  check('there is no drop zone, file input or paste target any more',
    (await ev(`!document.getElementById('drop') && !document.getElementById('file') && !document.querySelector('input[type=file], button#drop')`)) === true);
  check('status is a live region', (await ev("document.getElementById('status').getAttribute('aria-live')")) === 'polite');
  check('page asks the extension for the latest capture on load',
    (await ev(`window.__posted.some((m) => m && m.source === 'x-audience-page' && m.type === 'request-capture')`)) === true);
  await shot('web-empty.png');

  // --- helpers for simulated extension messages ---
  await ev(`(() => {
    window.png = (w, h, color) => { const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.fillStyle = '#eaeefd'; g.fillRect(30, 30, w - 60, 120);
      g.fillStyle = color; for (let i = 0; i < 10; i++) g.fillRect(50 + i * 90, h - 80 - i * 35, 60, 40 + i * 35);
      return c.toDataURL('image/png'); };
    window.fromExtension = (capture, extra = {}) => window.postMessage({ source: 'x-audience-extension', type: 'capture', capture, ...extra }, location.origin);
    window.state = () => JSON.stringify({ src: document.getElementById('shot').getAttribute('src'),
      previewHidden: document.getElementById('preview').hidden, status: document.getElementById('status').textContent,
      meta: document.getElementById('meta').textContent });
    return true; })()`);
  const state = async () => JSON.parse(await ev('state()'));
  const FIRST = await ev(`png(1000, 700, '#1a3cf0')`);
  const SECOND = await ev(`png(1200, 800, '#0a8a4a')`);

  // --- a capture from the extension is shown ---
  await ev(`fromExtension({ dataUrl: ${JSON.stringify(FIRST)}, capturedAt: new Date().toISOString() })`);
  await sleep(250);
  let s = await state();
  check('a capture from the extension is shown', !s.previewHidden && s.src === FIRST, s.status);
  check('placeholder hidden once an image is shown', (await hidden('placeholder')) === true);
  check('lead line says it is the latest capture', s.status === LEAD_READY, s.status);
  check('caption shows when it was captured', /^Captured .*2026|^Captured \S/.test(s.meta), s.meta);
  check('the image actually renders', (await ev(`document.getElementById('shot').complete && document.getElementById('shot').naturalWidth > 0`)) === true);
  await shot('web-capture.png');

  // --- things that must be ignored ---
  const ignored = async (name, fn) => {
    await ev(fn);
    await sleep(150);
    const t = await state();
    check(`ignored: ${name}`, t.src === FIRST && t.status === LEAD_READY, t.src && t.src.slice(0, 40));
  };
  const now = `new Date().toISOString()`;
  await ignored('wrong message source', `window.postMessage({ source: 'someone-else', type: 'capture', capture: { dataUrl: ${JSON.stringify(SECOND)}, capturedAt: ${now} } }, location.origin)`);
  await ignored('wrong message type', `window.postMessage({ source: 'x-audience-extension', type: 'other', capture: { dataUrl: ${JSON.stringify(SECOND)}, capturedAt: ${now} } }, location.origin)`);
  await ignored('SVG data URL', `fromExtension({ dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+', capturedAt: ${now} })`);
  await ignored('javascript: URL', `fromExtension({ dataUrl: 'javascript:alert(1)', capturedAt: ${now} })`);
  await ignored('missing capture', `fromExtension(undefined)`);
  await ignored('capture without a timestamp', `fromExtension({ dataUrl: ${JSON.stringify(SECOND)} })`);
  // Run the postMessage inside the iframe's own realm so the sender really is the iframe, not this page.
  await ignored('message posted from an iframe', `(() => { const f = document.createElement('iframe'); document.body.append(f);
      const msg = { source: 'x-audience-extension', type: 'capture', capture: { dataUrl: ${JSON.stringify(SECOND)}, capturedAt: ${now} } };
      f.contentWindow.eval('parent.postMessage(' + JSON.stringify(msg) + ", '*')"); })()`);

  // --- a newer capture replaces the old one ---
  await ev(`fromExtension({ dataUrl: ${JSON.stringify(SECOND)}, capturedAt: new Date().toISOString() })`);
  await sleep(250);
  s = await state();
  check('a newer capture replaces the previous one', s.src === SECOND && !s.previewHidden, s.src && s.src.slice(0, 40));
}

// --- run -------------------------------------------------------------------
try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }));
  await cmd('Emulation.setDeviceMetricsOverride', VIEWPORT);
  await cmd('Page.enable');
  // Record every window message from the very start, including the page's own request for a capture.
  await cmd('Page.addScriptToEvaluateOnNewDocument', { source: "window.__posted = []; window.addEventListener('message', (e) => window.__posted.push(e.data));" });
  await cmd('Page.navigate', { url: URL_UNDER_TEST });
  for (let i = 0; i < 50 && (await ev('document.readyState')) !== 'complete'; i++) await sleep(100);
  await pageChecks();
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
