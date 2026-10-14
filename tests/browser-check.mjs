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
