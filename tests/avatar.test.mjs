import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAvatar, validateAvatarFile, avatarDimensions } from '../src/avatar.mjs';

test('local avatar accepts bounded raster data only, never URLs or SVG', () => {
  assert.equal(normalizeAvatar('data:image/webp;base64,YWJjZA=='), 'data:image/webp;base64,YWJjZA==');
  for (const value of [null, {}, 'https://example.com/x.png', 'data:image/svg+xml;base64,YWJjZA==', 'data:image/jpeg;base64,a" onerror="alert(1)', 'data:image/png;base64,' + 'a'.repeat(180000)]) assert.equal(normalizeAvatar(value), '');
});

test('avatar file has a narrow MIME and size allowlist and a bounded central crop', () => {
  validateAvatarFile({ type: 'image/jpeg', size: 2048 });
  for (const file of [{ type: 'image/gif', size: 10 }, { type: 'image/svg+xml', size: 20 }, { type: 'image/png', size: 2097153 }, { type: 'image/jpeg', size: 0 }]) assert.throws(() => validateAvatarFile(file));
  assert.deepEqual(avatarDimensions(1200, 800), { size: 256, side: 800, left: 200, top: 0 });
  assert.deepEqual(avatarDimensions(100, 160), { size: 100, side: 100, left: 0, top: 30 });
  for (const pair of [[0, 100], [Infinity, 5], [10000, 10000]]) assert.throws(() => avatarDimensions(...pair));
});
