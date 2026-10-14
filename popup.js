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
      setStatus(msg.saved === false ? 'Done, but this capture could not be saved for later.' : 'Done.');
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

// A popup opened mid-capture has no port to the running capture, so it follows
// the worker's `capturing` flag and picks up the result from storage.
async function syncCapturing() {
  try {
    const { capturing } = await chrome.storage.session.get('capturing');
    if (capturing && !port) {
      els.capture.disabled = true;
      setStatus('A capture is in progress…');
    }
  } catch {
    /* session storage unavailable: behave as if idle */
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  const latest = area === 'local' && changes.lastCapture && changes.lastCapture.newValue;
  if (latest && latest.dataUrl) {
    show(latest);
    if (!port) setStatus('Showing your latest capture.');
  }
  if (area === 'session' && changes.capturing && !changes.capturing.newValue && !port) {
    els.capture.disabled = false;
  }
});

els.capture.addEventListener('click', startCapture);
els.download.addEventListener('click', download);
loadLastCapture().then(syncCapturing);
