// Pure helpers for the front-end page. No DOM access here.
(function (root) {
  const PNG_PREFIX = 'data:image/png;base64,';

  // A capture sent by the extension: { dataUrl, capturedAt }. Only base64 PNG data URLs are trusted.
  function isCapturePayload(capture) {
    return (
      !!capture &&
      typeof capture === 'object' &&
      typeof capture.dataUrl === 'string' &&
      capture.dataUrl.startsWith(PNG_PREFIX) &&
      capture.dataUrl.length > PNG_PREFIX.length &&
      typeof capture.capturedAt === 'string' &&
      !Number.isNaN(new Date(capture.capturedAt).getTime())
    );
  }

  function formatCapturedAt(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
  }

  const api = { isCapturePayload, formatCapturedAt };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WebHelpers = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
