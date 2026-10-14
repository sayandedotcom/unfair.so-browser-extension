// Pure helpers shared by the service worker, the popup, and Node tests.
// No chrome.* calls here.
(function (root) {
  const ANALYTICS_URL = 'https://x.com/i/account_analytics/audience';
  const VIEWPORT = { width: 1280, height: 900 };
  const MAX_CAPTURE_HEIGHT = 16000;
  const LOAD_TIMEOUT_MS = 15000;
  const SETTLE_MS = 1500;
  // The front-end page that displays captures (see web/). The manifest content script must match the same origins.
  const FRONTEND_URL = 'http://localhost:5173/';
  const FRONTEND_MATCH = ['http://localhost:5173/*', 'http://127.0.0.1:5173/*'];

  const ERROR_MESSAGES = {
    NOT_LOGGED_IN: 'Log in to X in this browser, then try again.',
    UNEXPECTED_REDIRECT: 'X sent the tab somewhere other than the analytics page (it may need a Premium account).',
    TIMEOUT: 'The page did not finish loading within 15 seconds. Try again.',
    ATTACH_FAILED: 'Could not attach the Chrome debugger to the capture tab.',
    CAPTURE_FAILED: 'The screenshot failed.',
    BUSY: 'A capture is already running.',
  };

  class CaptureError extends Error {
    constructor(code, detail) {
      super(detail || code);
      this.name = 'CaptureError';
      this.code = code;
      this.detail = detail || '';
    }
  }

  function parseUrl(url) {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  }

  function isLoginUrl(url) {
    const u = parseUrl(url);
    return (
      !!u &&
      (/^\/(i\/flow\/login|i\/jf\/onboarding|login)(\/|$)/.test(u.pathname) ||
        u.searchParams.has('redirect_after_login'))
    );
  }

  function isAnalyticsUrl(url) {
    const u = parseUrl(url);
    return (
      !!u &&
      (u.hostname === 'x.com' || u.hostname === 'www.x.com') &&
      /^\/i\/account_analytics(\/|$)/.test(u.pathname)
    );
  }

  function positive(n) {
    const v = Number(n);
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
  }

  function computeClip(size, viewport) {
    const width = positive(size && size.width) || viewport.width;
    const height = Math.min(positive(size && size.height) || viewport.height, MAX_CAPTURE_HEIGHT);
    return { x: 0, y: 0, width, height, scale: 1 };
  }

  // Capture at the size of the user's current tab so X renders the same layout they see
  // (X switches to a compact layout on narrower viewports). Falls back to VIEWPORT.
  function chooseViewport(tab) {
    const pick = (n, lo, hi, fallback) => {
      const v = Number(n);
      return Number.isFinite(v) && v > 0 ? Math.min(hi, Math.max(lo, Math.round(v))) : fallback;
    };
    return {
      width: pick(tab && tab.width, 1280, 2560, VIEWPORT.width),
      height: pick(tab && tab.height, 600, 1600, VIEWPORT.height),
    };
  }

  function captureFilename(date) {
    const d = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const stamp = d.toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-');
    return `x-audience-${stamp}.png`;
  }

  function errorMessage(code, detail) {
    const base = ERROR_MESSAGES[code] || ERROR_MESSAGES.CAPTURE_FAILED;
    return detail ? `${base} (${detail})` : base;
  }

  const api = {
    ANALYTICS_URL, VIEWPORT, MAX_CAPTURE_HEIGHT, LOAD_TIMEOUT_MS, SETTLE_MS,
    FRONTEND_URL, FRONTEND_MATCH, ERROR_MESSAGES, CaptureError,
    isLoginUrl, isAnalyticsUrl, computeClip, chooseViewport, captureFilename, errorMessage,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.XLib = api;
  }
})(typeof self !== 'undefined' ? self : globalThis);
