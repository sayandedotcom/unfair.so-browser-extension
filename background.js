importScripts('lib.js');

const {
  ANALYTICS_URL, VIEWPORT, LOAD_TIMEOUT_MS, SETTLE_MS,
  FRONTEND_URL, FRONTEND_MATCH,
  CaptureError, isLoginUrl, isAnalyticsUrl, computeClip, chooseViewport, errorMessage,
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
    const [current] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
    const viewport = chooseViewport(current);
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
      width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false,
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
    const clip = computeClip(metrics.cssContentSize || metrics.contentSize, viewport);
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

// Shows a finished capture in the front-end page: push it to any open front-end tab and bring it to the
// front, or open the page (it asks for the latest capture itself once it loads).
async function showInFrontend(capture) {
  try {
    const tabs = await chrome.tabs.query({ url: FRONTEND_MATCH });
    if (tabs.length === 0) {
      await chrome.tabs.create({ url: FRONTEND_URL });
      return;
    }
    await Promise.all(tabs.map((tab) => chrome.tabs.sendMessage(tab.id, { type: 'capture', capture }).catch(() => {})));
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } catch {
    /* front-end unreachable: the popup still has the capture */
  }
}

let busy = false;

// Lets a popup that opens mid-capture know one is running. Stale state from a
// worker that died mid-capture is cleared on every worker start.
const setCapturing = (value) => chrome.storage.session.set({ capturing: value }).catch(() => {});
setCapturing(false);

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
    await setCapturing(true);
    try {
      const dataUrl = await captureAudience((text) => post(port, { type: 'status', text }));
      const capture = { dataUrl, capturedAt: new Date().toISOString() };
      // A failed save must not discard a capture that succeeded.
      let saved = true;
      try {
        await chrome.storage.local.set({ lastCapture: capture });
      } catch {
        saved = false;
      }
      post(port, { type: 'done', capture, saved });
      await showInFrontend(capture);
    } catch (e) {
      const code = e instanceof CaptureError ? e.code : 'CAPTURE_FAILED';
      const detail = e instanceof CaptureError ? e.detail : e && e.message;
      post(port, { type: 'error', code, message: errorMessage(code, detail) });
    } finally {
      busy = false;
      await setCapturing(false);
    }
  });
});
