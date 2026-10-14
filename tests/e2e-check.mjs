// End-to-end check: extension capture -> front-end page, in real headless Chrome.
// Run: node tests/e2e-check.mjs   (needs Chrome; serves web/ on http://localhost:5173, or reuses a server already there)
// The screenshot step is stubbed inside the service worker (X needs a login), everything after it is real:
// popup -> service worker -> storage -> content script -> window.postMessage -> page.
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = join(REPO, 'web');
const FRONTEND = 'http://localhost:5173/';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript' };

// --- serve web/ on :5173 ---------------------------------------------------
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname;
  const file = resolve(WEB, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(WEB + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((ok, fail) => {
  server.once('error', (e) => (e.code === 'EADDRINUSE' ? (console.log('port 5173 already in use; reusing that server'), ok()) : fail(e)));
  server.listen(5173, '127.0.0.1', ok);
});

// --- headless Chrome over a CDP pipe --------------------------------------
const profile = mkdtempSync(join(tmpdir(), 'e2e-profile-'));
const chrome = spawn(process.env.CHROME || 'google-chrome', [
  '--headless=new', '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
  `--user-data-dir=${profile}`, '--no-first-run', '--no-sandbox', 'about:blank',
], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
let buf = '', nextId = 0;
const pending = new Map();
chrome.stdio[4].on('data', (d) => {
  buf += d.toString();
  let i;
  while ((i = buf.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  }
});
const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++nextId;
  pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
  chrome.stdio[3].write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function attach(targetId) {
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  return async (expression, awaitPromise = false) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error((r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text);
    return r.result.value;
  };
}
async function waitFor(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch { /* retry */ } await sleep(150); }
  return null;
}
const pageTargets = async () => (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'page');

let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`); };

try {
  const { id: extId } = await send('Extensions.loadUnpacked', { path: REPO });
  const sw = await waitFor(async () => (await send('Target.getTargets')).targetInfos.find((t) => t.type === 'service_worker' && t.url.includes(extId)));
  if (!sw) throw new Error('extension service worker did not start');
  const swEv = await attach(sw.targetId);
  // Stub only the X screenshot step; everything downstream is the real code path.
  await swEv(`captureAudience = async () => '${PNG}'; 'stubbed'`);

  const pressCapture = async () => {
    const { targetId } = await send('Target.createTarget', { url: `chrome-extension://${extId}/popup.html` });
    const popup = await attach(targetId);
    await waitFor(() => popup(`document.readyState === 'complete'`));
    await sleep(300);
    await popup(`(document.getElementById('capture').hidden ? document.getElementById('recapture') : document.getElementById('capture')).click()`);
    const done = await waitFor(() => popup(`/^Done/.test(document.getElementById('status').textContent)`), 5000);
    await send('Target.closeTarget', { targetId }).catch(() => {});
    return done;
  };
  const frontendTab = async () => (await pageTargets()).find((t) => t.url.startsWith(FRONTEND));
  const frontendState = async (targetId) => {
    const ev = await attach(targetId);
    return waitFor(() => ev(`(() => { const i = document.getElementById('shot');
      return !document.getElementById('preview').hidden && i.getAttribute('src') === '${PNG}' && i.naturalWidth > 0; })()`), 5000);
  };

  // A: the front-end is already open -> it receives the capture live and is brought to the front
  const { targetId: openTab } = await send('Target.createTarget', { url: FRONTEND });
  const tabEv = await attach(openTab);
  await waitFor(() => tabEv(`document.readyState === 'complete'`));
  check('front-end starts empty', (await tabEv(`document.getElementById('preview').hidden`)) === true);
  check('capture completes in the popup', await pressCapture());
  check('A: the open front-end page shows the capture', await frontendState(openTab));
  const active = await swEv(`chrome.tabs.query({ active: true }).then((t) => JSON.stringify(t.map((x) => x.url)))`, true);
  check('A: the front-end tab is brought to the front', active.includes('localhost:5173'), active);
  check('A: only one front-end tab (no duplicate opened)', (await pageTargets()).filter((t) => t.url.startsWith(FRONTEND)).length === 1);

  // B: the front-end is closed -> the extension opens it and it pulls the latest capture
  await send('Target.closeTarget', { targetId: openTab });
  await waitFor(async () => !(await frontendTab()), 3000);
  check('B: front-end closed before the capture', !(await frontendTab()));
  check('B: capture completes in the popup', await pressCapture());
  const opened = await waitFor(frontendTab, 6000);
  check('B: the extension opens the front-end', !!opened);
  check('B: the new front-end page shows the capture', opened ? await frontendState(opened.targetId) : false);
} catch (e) {
  failed++;
  console.log('ERROR', e.stack || e.message);
} finally {
  chrome.kill('SIGKILL');
  server.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : '\nall checks passed');
process.exit(failed ? 1 : 0);
