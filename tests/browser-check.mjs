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
  await sleep(250); // accepting is async: the image is decoded before it is shown
  s = await st();
  check('drop a PNG shows the preview',
    !s.previewHidden && s.dropHidden && s.src && s.src.startsWith('blob:') && s.status === 'Screenshot ready.' && !s.err, JSON.stringify(s));
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
  // A file that claims to be a PNG but cannot be decoded is rejected like any other bad file
  await ev(`__t.drop(q('preview'), new File(['this is not really a png'], 'fake.png', { type: 'image/png' }))`);
  await sleep(250);
  s = await st();
  check('corrupt image: error shown, preview kept',
    s.err && s.status === "That image couldn't be read." && s.src === firstSrc && !s.previewHidden, s.status);
  check('corrupt image: the kept preview still renders',
    (await ev(`q('shot').complete && q('shot').naturalWidth > 0`)) === true);

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
  await sleep(250);
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
  await sleep(250);
  s = await st();
  check('choosing a file shows the preview', !s.previewHidden && /chosen\.png/.test(s.meta), s.meta);
  check('file input cleared so the same file can be chosen again', s.input === '', JSON.stringify(s.input));

  // Review Focus 2: paste
  const metaBefore = s.meta;
  const textPrevented = await ev(`(() => { const d = new DataTransfer(); d.setData('text/plain', 'just text'); return __t.paste(d); })()`);
  s = await st();
  check('plain-text paste is ignored (default not prevented)', textPrevented === false && s.meta === metaBefore, s.meta);
  const imgPrevented = await ev(`(async () => __t.paste(__t.dt(await __t.png(''))))()`, true);
  await sleep(250);
  s = await st();
  check('image paste shows the preview', imgPrevented === true && !s.previewHidden && /Pasted image · \d/.test(s.meta), s.meta);

  // Accessibility
  await ev(`q('remove').click()`);
  check('drop zone is a native button (keyboard operable)', (await ev(`q('drop').tagName`)) === 'BUTTON');

  // Corrupt image from the empty state keeps the empty state
  await ev(`__t.drop(q('drop'), new File(['this is not really a png'], 'fake.png', { type: 'image/png' }))`);
  await sleep(250);
  s = await st();
  check('corrupt image from the empty state: error shown, still empty',
    s.err && s.status === "That image couldn't be read." && s.previewHidden && !s.dropHidden, s.status);

  // Phone width: a long, space-free file name must not widen the page or push the actions off-screen
  await cmd('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: 375 });
  await ev(`(async () => __t.drop(q('drop'), await __t.png('Screenshot_2026-10-15_at_02.33.12_X_audience_analytics_followers_full_page_capture.png')))()`, true);
  await sleep(250);
  const fit = JSON.parse(await ev(`JSON.stringify({ scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
    removeRight: q('remove').getBoundingClientRect().right })`));
  check('long file name does not cause horizontal scroll at 375px', fit.scrollW <= fit.innerW, JSON.stringify(fit));
  check('Replace/Remove stay inside the viewport at 375px', fit.removeRight <= fit.innerW, JSON.stringify(fit));
  await shot('web-mobile-long.png');
  await cmd('Emulation.setDeviceMetricsOverride', VIEWPORT);
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
  await behaviourChecks();
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
