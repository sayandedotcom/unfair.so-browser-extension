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

window.addEventListener('message', async (event) => {
  const data = event.data;
  if (event.source !== window || !data || data.source !== FROM_PAGE || data.type !== 'request-capture') return;
  try {
    const { lastCapture } = await chrome.storage.local.get('lastCapture');
    if (lastCapture && lastCapture.dataUrl) postCapture(lastCapture);
  } catch {
    /* extension was reloaded under this tab; nothing to send */
  }
});
