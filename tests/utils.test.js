import { test } from 'node:test';
import assert from 'node:assert/strict';

async function hashParagraph(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function storageKey(convId, msgIdx, paragraphHash) {
  return `threads:${convId}:${msgIdx}:${paragraphHash}`;
}

test('hashParagraph returns 16-char lowercase hex', async () => {
  const h = await hashParagraph('The transformer uses self-attention.');
  assert.equal(h.length, 16);
  assert.match(h, /^[0-9a-f]{16}$/);
});

test('hashParagraph is deterministic', async () => {
  assert.equal(await hashParagraph('same text'), await hashParagraph('same text'));
});

test('hashParagraph distinguishes different text', async () => {
  assert.notEqual(await hashParagraph('paragraph one'), await hashParagraph('paragraph two'));
});

test('storageKey correct format', () => {
  assert.equal(storageKey('abc-123', 2, 'a1b2c3d4'), 'threads:abc-123:2:a1b2c3d4');
});

test('storageKey index 0', () => {
  assert.equal(storageKey('x', 0, 'h'), 'threads:x:0:h');
});
