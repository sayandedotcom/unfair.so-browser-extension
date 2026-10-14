// Runs only on the front-end page (see manifest content_scripts). Bridges the extension and the page:
//  - pushes a new capture from the service worker into the page, and
//  - answers the page's request for the latest capture (so a page opened after a capture still shows it).
// Messages are posted to this window only, tagged so the page can tell them apart from anything else.
const FROM_EXTENSION = 'x-audience-extension';
const FROM_PAGE = 'x-audience-page';

function postCapture(capture) {
  window.postMessage({ source: FROM_EXTENSION, type: 'capture', capture }, window.location.origin);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message && message.type === 'capture' && message.capture) postCapture(message.capture);
});

// The page's Capture / Recapture button: run a capture in the service worker and relay its progress back.
function startCapture() {
  let finished = false;
  const relay = (message) => window.postMessage({ source: FROM_EXTENSION, type: 'progress', message }, window.location.origin);
  try {
    const port = chrome.runtime.connect({ name: 'capture' });
    port.onMessage.addListener((message) => {
      relay(message);
      if (message.type === 'done' || message.type === 'error') {
        finished = true;
        port.disconnect();
      }
    });
    port.onDisconnect.addListener(() => {
      if (!finished) relay({ type: 'error', message: 'Lost connection to the extension. Try again.' });
    });
    port.postMessage({ type: 'start' });
  } catch {
    relay({ type: 'error', message: 'Extension was reloaded. Refresh this page and try again.' });
  }
}

window.addEventListener('message', async (event) => {
  const data = event.data;
  if (event.source !== window || !data || data.source !== FROM_PAGE) return;
  if (data.type === 'start-capture') {
    startCapture();
    return;
  }
  if (data.type === 'clear-capture') {
    chrome.storage.local.remove('lastCapture').catch(() => {});
    return;
  }
  if (data.type !== 'request-capture') return;
  try {
    const { lastCapture } = await chrome.storage.local.get('lastCapture');
    if (lastCapture && lastCapture.dataUrl) postCapture(lastCapture);
  } catch {
    /* extension was reloaded under this tab; nothing to send */
  }
});
