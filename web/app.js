(function () {
  const { isCapturePayload, formatCapturedAt } = window.WebHelpers;
  const $ = (id) => document.getElementById(id);
  const els = {
    status: $('status'), placeholder: $('placeholder'), preview: $('preview'),
    shot: $('shot'), shotScrolled: $('shotScrolled'), scrolledWrap: $('scrolledWrap'), meta: $('meta'), capture: $('placeholder'), recapture: $('recapture'), clear: $('clear'),
  };
  const ORIGIN = window.location.origin;
  const EMPTY_TEXT = 'Waiting for your capture. Press Capture, or use the extension icon.';
  let busy = false;
  let timer = null;

  function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
  }

  function setBusy(value) {
    busy = value;
    els.capture.disabled = value;
    els.recapture.disabled = value;
    els.clear.disabled = value;
  }

  // Asks the extension (through its content script) to capture the X audience page.
  function startCapture() {
    if (busy) return;
    setBusy(true);
    setStatus('Starting…');
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!busy) return;
      setBusy(false);
      setStatus("Can't reach the extension. Reload it on chrome://extensions, refresh this page, and try again.", true);
    }, 4000);
    window.postMessage({ source: 'x-audience-page', type: 'start-capture' }, ORIGIN);
  }

  // Back to the empty state, and forget the saved capture so a refresh doesn't bring it back.
  function clearCapture() {
    if (busy) return;
    els.shot.removeAttribute('src');
    els.shotScrolled.removeAttribute('src');
    els.scrolledWrap.hidden = true;
    els.meta.textContent = '';
    els.preview.hidden = true;
    els.placeholder.hidden = false;
    setStatus(EMPTY_TEXT);
    window.postMessage({ source: 'x-audience-page', type: 'clear-capture' }, ORIGIN);
    els.capture.focus();
  }

  function onProgress(message) {
    clearTimeout(timer);
    if (message.type === 'status') {
      setStatus(String(message.text));
    } else if (message.type === 'done') {
      if (isCapturePayload(message.capture)) show(message.capture);
      setBusy(false);
    } else if (message.type === 'error') {
      setStatus(String(message.message), true);
      setBusy(false);
    }
  }

  function show(capture) {
    els.shot.src = capture.dataUrl;
    els.scrolledWrap.hidden = !capture.scrolledDataUrl;
    if (capture.scrolledDataUrl) els.shotScrolled.src = capture.scrolledDataUrl;
    else els.shotScrolled.removeAttribute('src');
    els.meta.textContent = 'Captured ' + formatCapturedAt(capture.capturedAt);
    els.placeholder.hidden = true;
    els.preview.hidden = false;
    setStatus('Latest capture from your X audience page.');
  }

  // The extension's content script posts captures into this window. Only accept messages
  // from this same window and origin, and only well-formed PNG data URLs.
  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'x-audience-extension') return;
    if (data.type === 'capture' && isCapturePayload(data.capture)) show(data.capture);
    else if (data.type === 'progress' && data.message) onProgress(data.message);
  });

  els.capture.addEventListener('click', startCapture);
  els.recapture.addEventListener('click', startCapture);
  els.clear.addEventListener('click', clearCapture);

  // Ask the extension for the most recent capture, so a page opened after a capture still shows it.
  window.postMessage({ source: 'x-audience-page', type: 'request-capture' }, ORIGIN);
})();
