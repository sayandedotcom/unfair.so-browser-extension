(function () {
  const { isCapturePayload, formatCapturedAt } = window.WebHelpers;
  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'), placeholder: $('placeholder'), preview: $('preview'),
    shot: $('shot'), meta: $('meta'),
  };

  function show(capture) {
    els.shot.src = capture.dataUrl;
    els.meta.textContent = 'Captured ' + formatCapturedAt(capture.capturedAt);
    els.placeholder.hidden = true;
    els.preview.hidden = false;
    els.status.textContent = 'Latest capture from your X audience page.';
  }

  // The extension's content script posts captures into this window. Only accept messages
  // from this same window and origin, and only well-formed PNG data URLs.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'x-audience-extension' || data.type !== 'capture') return;
    if (isCapturePayload(data.capture)) show(data.capture);
  });

  // Ask the extension for the most recent capture, so a page opened after a capture still shows it.
  window.postMessage({ source: 'x-audience-page', type: 'request-capture' }, window.location.origin);
})();
