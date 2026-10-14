const test = require('node:test');
const assert = require('node:assert/strict');
const { isCapturePayload, formatCapturedAt } = require('../web/helpers.js');

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const good = { dataUrl: PNG, capturedAt: '2026-10-15T08:09:10.123Z' };

test('isCapturePayload: accepts a PNG data URL with a valid timestamp', () => {
  assert.equal(isCapturePayload(good), true);
});

test('isCapturePayload: rejects anything that is not a base64 PNG data URL', () => {
  for (const dataUrl of [
    'data:image/svg+xml;base64,PHN2Zy8+',
    'data:text/html;base64,PGgxPg==',
    'data:image/png,not-base64',
    'javascript:alert(1)',
    'https://example.com/x.png',
    '',
    undefined,
    42,
  ]) {
    assert.equal(isCapturePayload({ ...good, dataUrl }), false, String(dataUrl));
  }
});

test('isCapturePayload: rejects missing payloads and bad timestamps', () => {
  assert.equal(isCapturePayload(undefined), false);
  assert.equal(isCapturePayload(null), false);
  assert.equal(isCapturePayload('str'), false);
  assert.equal(isCapturePayload({ dataUrl: PNG }), false);
  assert.equal(isCapturePayload({ dataUrl: PNG, capturedAt: 'not a date' }), false);
});

test('formatCapturedAt: formats a valid ISO time and survives junk', () => {
  assert.match(formatCapturedAt('2026-10-15T08:09:10.123Z'), /2026/);
  assert.equal(formatCapturedAt('nope'), '');
  assert.equal(formatCapturedAt(undefined), '');
});
