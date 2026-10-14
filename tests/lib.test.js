const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANALYTICS_URL, VIEWPORT, MAX_CAPTURE_HEIGHT, ERROR_MESSAGES,
  CaptureError, isLoginUrl, isAnalyticsUrl, computeClip, captureFilename, errorMessage,
} = require('../lib.js');

test('isLoginUrl: recognises X login flows', () => {
  assert.equal(isLoginUrl('https://x.com/i/flow/login'), true);
  assert.equal(
    isLoginUrl('https://x.com/i/flow/login?redirect_after_login=%2Fi%2Faccount_analytics%2Faudience'),
    true,
  );
  assert.equal(isLoginUrl('https://x.com/login'), true);
});

test('isLoginUrl: never flags the analytics page or other pages', () => {
  assert.equal(isLoginUrl(ANALYTICS_URL), false);
  assert.equal(isLoginUrl(ANALYTICS_URL + '?ref=login'), false);
  assert.equal(isLoginUrl('https://x.com/home'), false);
  assert.equal(isLoginUrl('https://x.com/loginfoo'), false);
});

test('isLoginUrl: garbage input is false, not a throw', () => {
  assert.equal(isLoginUrl('not a url'), false);
  assert.equal(isLoginUrl(''), false);
  assert.equal(isLoginUrl(undefined), false);
});

test('isAnalyticsUrl: matches the analytics section on x.com only', () => {
  assert.equal(isAnalyticsUrl(ANALYTICS_URL), true);
  assert.equal(isAnalyticsUrl(ANALYTICS_URL + '?foo=bar#baz'), true);
  assert.equal(isAnalyticsUrl('https://x.com/i/account_analytics'), true);
  assert.equal(isAnalyticsUrl('https://x.com/i/account_analytics_other'), false);
  assert.equal(isAnalyticsUrl('https://x.com/home'), false);
  assert.equal(isAnalyticsUrl('https://evil.example/i/account_analytics/audience'), false);
  assert.equal(isAnalyticsUrl(undefined), false);
});

test('computeClip: uses content size when valid', () => {
  assert.deepEqual(computeClip({ width: 1280, height: 2400 }, VIEWPORT), {
    x: 0, y: 0, width: 1280, height: 2400, scale: 1,
  });
});

test('computeClip: caps very tall pages', () => {
  assert.equal(computeClip({ width: 1280, height: 99999 }, VIEWPORT).height, MAX_CAPTURE_HEIGHT);
});

test('computeClip: falls back to viewport for missing, zero or NaN sizes', () => {
  const expected = { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 1 };
  assert.deepEqual(computeClip(undefined, VIEWPORT), expected);
  assert.deepEqual(computeClip({ width: 0, height: 0 }, VIEWPORT), expected);
  assert.deepEqual(computeClip({ width: NaN, height: 'x' }, VIEWPORT), expected);
});

test('computeClip: rounds fractional sizes', () => {
  const clip = computeClip({ width: 1280.4, height: 1000.6 }, VIEWPORT);
  assert.equal(clip.width, 1280);
  assert.equal(clip.height, 1001);
});

test('captureFilename: ISO timestamp without ms or colons', () => {
  assert.equal(
    captureFilename(new Date('2026-10-15T08:09:10.123Z')),
    'x-audience-2026-10-15T08-09-10Z.png',
  );
});

test('captureFilename: invalid date falls back to now instead of throwing', () => {
  assert.match(captureFilename(new Date('nope')), /^x-audience-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.png$/);
});

test('errorMessage: known code, with and without detail', () => {
  assert.equal(errorMessage('NOT_LOGGED_IN'), ERROR_MESSAGES.NOT_LOGGED_IN);
  assert.equal(
    errorMessage('UNEXPECTED_REDIRECT', 'https://x.com/i/premium'),
    ERROR_MESSAGES.UNEXPECTED_REDIRECT + ' (https://x.com/i/premium)',
  );
});

test('errorMessage: unknown code falls back to CAPTURE_FAILED text and keeps detail', () => {
  const msg = errorMessage('WAT', 'boom');
  assert.ok(msg.startsWith(ERROR_MESSAGES.CAPTURE_FAILED));
  assert.ok(msg.includes('boom'));
});

test('every documented error code has a message', () => {
  for (const code of ['NOT_LOGGED_IN', 'UNEXPECTED_REDIRECT', 'TIMEOUT', 'ATTACH_FAILED', 'CAPTURE_FAILED', 'BUSY']) {
    assert.ok(ERROR_MESSAGES[code], code);
  }
});

test('CaptureError carries code and detail', () => {
  const e = new CaptureError('TIMEOUT', 'slow');
  assert.ok(e instanceof Error);
  assert.equal(e.code, 'TIMEOUT');
  assert.equal(e.detail, 'slow');
  assert.equal(new CaptureError('BUSY').detail, '');
});
