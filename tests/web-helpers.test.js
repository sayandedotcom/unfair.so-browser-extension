const test = require('node:test');
const assert = require('node:assert/strict');
const { ALLOWED_TYPES, MAX_BYTES, MESSAGES, validateImage, formatBytes } = require('../web/helpers.js');

test('constants: allowed types and 10 MB limit', () => {
  assert.deepEqual(ALLOWED_TYPES, ['image/png', 'image/jpeg', 'image/webp']);
  assert.equal(MAX_BYTES, 10 * 1024 * 1024);
});

test('validateImage: accepts png, jpeg and webp', () => {
  for (const type of ALLOWED_TYPES) {
    assert.deepEqual(validateImage({ type, size: 1234 }), { ok: true }, type);
  }
});

test('validateImage: size boundary — exactly 10 MB ok, one byte more rejected', () => {
  assert.deepEqual(validateImage({ type: 'image/png', size: MAX_BYTES }), { ok: true });
  assert.deepEqual(validateImage({ type: 'image/png', size: MAX_BYTES + 1 }), { ok: false, error: MESSAGES.tooLarge });
});

test('validateImage: empty file rejected', () => {
  assert.deepEqual(validateImage({ type: 'image/png', size: 0 }), { ok: false, error: MESSAGES.empty });
});

test('validateImage: wrong, empty or missing type is "not an image"', () => {
  assert.deepEqual(validateImage({ type: 'image/gif', size: 10 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ type: 'text/plain', size: 10 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ type: '', size: 10 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ size: 10 }), { ok: false, error: MESSAGES.notImage });
});

test('validateImage: type is checked before size (a huge text file is "not an image")', () => {
  assert.deepEqual(validateImage({ type: 'text/plain', size: MAX_BYTES * 2 }), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage({ type: 'text/plain', size: 0 }), { ok: false, error: MESSAGES.notImage });
});

test('validateImage: null / undefined file is "not an image", not a throw', () => {
  assert.deepEqual(validateImage(null), { ok: false, error: MESSAGES.notImage });
  assert.deepEqual(validateImage(undefined), { ok: false, error: MESSAGES.notImage });
});

test('validateImage: missing or NaN size is treated as empty', () => {
  assert.deepEqual(validateImage({ type: 'image/png' }), { ok: false, error: MESSAGES.empty });
  assert.deepEqual(validateImage({ type: 'image/png', size: NaN }), { ok: false, error: MESSAGES.empty });
});

test('error messages are the verbatim copy from the spec', () => {
  assert.equal(MESSAGES.notImage, "That file isn't a PNG, JPEG or WebP image.");
  assert.equal(MESSAGES.tooLarge, 'That image is over 10 MB. Try a smaller screenshot.');
  assert.equal(MESSAGES.empty, 'That file is empty.');
});

test('formatBytes: zero, negative and junk', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(-5), '0 B');
  assert.equal(formatBytes(NaN), '0 B');
  assert.equal(formatBytes(undefined), '0 B');
});

test('formatBytes: bytes, KB and MB', () => {
  assert.equal(formatBytes(1), '1 B');
  assert.equal(formatBytes(1023), '1023 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(MAX_BYTES), '10.0 MB');
});

test('formatBytes: just under 1 MB rolls over to MB instead of "1024.0 KB"', () => {
  assert.equal(formatBytes(1024 * 1024 - 1), '1.0 MB');
});
