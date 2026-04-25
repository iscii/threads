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

// ── Inline definitions for testing (mirrors content.js) ───────────────

function isDirtyThread(turns, excluded, highWaterMark, key) {
  if (excluded) return false;
  return turns.length > (highWaterMark[key] ?? 0);
}

function getDirtyTurns(turns, highWaterMark, key) {
  return turns.slice(highWaterMark[key] ?? 0);
}

function getParagraphSnippet(turns) {
  const firstUserContent = turns.find(t => t.role === 'user')?.content ?? '';
  const match = firstUserContent.match(/^Focusing on this specific part of your response: "([^"]{1,120})/);
  return match ? match[1] : firstUserContent.slice(0, 120);
}

function buildSummaryPrompt(dirtyItems) {
  const blocks = dirtyItems.map(({ paragraphSnippet, newTurns }) => {
    const lines = newTurns.map(t => `${t.role === 'user' ? 'Q' : 'A'}: ${t.content}`);
    return `Thread on: "${paragraphSnippet}"\nNew exchanges:\n${lines.join('\n')}`;
  }).join('\n\n');
  return [
    'Summarize the following thread exchanges from a Claude.ai conversation sidebar.',
    'Each thread is a follow-up question the user asked about a specific paragraph.',
    'For each thread, write one sentence in the format: "on [topic keyword], [summary]."',
    'Output only the sentences, no preamble.',
    '',
    blocks,
  ].join('\n');
}

// ── Tests ─────────────────────────────────────────────────────────────

test('isDirtyThread: excluded thread is never dirty', () => {
  assert.strictEqual(isDirtyThread([{}, {}], true, { k: 0 }, 'k'), false);
});

test('isDirtyThread: thread with turns above hwm is dirty', () => {
  assert.strictEqual(isDirtyThread([{}, {}, {}], false, { k: 2 }, 'k'), true);
});

test('isDirtyThread: thread with turns at hwm is not dirty', () => {
  assert.strictEqual(isDirtyThread([{}, {}], false, { k: 2 }, 'k'), false);
});

test('isDirtyThread: thread with no hwm entry is dirty when has turns', () => {
  assert.strictEqual(isDirtyThread([{}], false, {}, 'k'), true);
});

test('getDirtyTurns: returns only turns above hwm', () => {
  const turns = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'b' },
    { role: 'user', content: 'c' },
  ];
  assert.deepStrictEqual(getDirtyTurns(turns, { k: 2 }, 'k'), [{ role: 'user', content: 'c' }]);
});

test('getDirtyTurns: returns all turns when no hwm entry', () => {
  const turns = [{ role: 'user', content: 'a' }];
  assert.deepStrictEqual(getDirtyTurns(turns, {}, 'k'), turns);
});

test('getParagraphSnippet: extracts paragraph from thread framing', () => {
  const turns = [{
    role: 'user',
    content: 'Focusing on this specific part of your response: "The transformer architecture"\n\nWhat does this mean?',
  }];
  assert.strictEqual(getParagraphSnippet(turns), 'The transformer architecture');
});

test('buildSummaryPrompt: includes paragraph snippet and exchanges', () => {
  const prompt = buildSummaryPrompt([{
    paragraphSnippet: 'self-attention',
    newTurns: [{ role: 'user', content: 'Q1' }, { role: 'assistant', content: 'A1' }],
  }]);
  assert.ok(prompt.includes('self-attention'));
  assert.ok(prompt.includes('Q: Q1'));
  assert.ok(prompt.includes('A: A1'));
  assert.ok(prompt.includes('on [topic keyword]'));
});
