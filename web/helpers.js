// Pure helpers for the screenshot drop page. No DOM access here.
(function (root) {
  const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const MAX_BYTES = 10 * 1024 * 1024;

  const MESSAGES = {
    notImage: "That file isn't a PNG, JPEG or WebP image.",
    tooLarge: 'That image is over 10 MB. Try a smaller screenshot.',
    empty: 'That file is empty.',
  };

  function validateImage(file) {
    if (!file || !ALLOWED_TYPES.includes(file.type)) return { ok: false, error: MESSAGES.notImage };
    const size = Number(file.size);
    if (!Number.isFinite(size) || size <= 0) return { ok: false, error: MESSAGES.empty };
    if (size > MAX_BYTES) return { ok: false, error: MESSAGES.tooLarge };
    return { ok: true };
  }

  function formatBytes(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return '0 B';
    if (v < 1024) return `${Math.round(v)} B`;
    const kb = v / 1024;
    if (kb < 1023.9) return `${kb.toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(1)} MB`;
  }

  const api = { ALLOWED_TYPES, MAX_BYTES, MESSAGES, validateImage, formatBytes };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.WebHelpers = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
