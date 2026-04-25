# Thread Context Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user types in Claude.ai's main chat input, silently summarize unsummarized thread exchanges via Haiku and prepend the summary to the outgoing message, with a badge indicator and per-thread exclusion toggle.

**Architecture:** A summary queue in `chrome.storage.local` accumulates Haiku-generated summaries keyed by conversation ID. A high-water mark per thread tracks which turns have been queued, preventing re-summarization. `fetch-watcher.js` intercepts the outgoing completion POST and rewrites the body to prepend all queued summaries.

**Tech Stack:** Vanilla JS, Chrome MV3, `chrome.storage.local`, `node:test` for pure-function unit tests.

---

## File Structure

| File | Changes |
|---|---|
| `content.js` | New: `isDirtyThread`, `getDirtyTurns`, `getParagraphSnippet`, `buildSummaryPrompt`, `loadSummaryData`, `saveSummaryData`, `toggleExclusion`, `updateSummaryIcon`, `ensureBadge`, `setBadgeState`, `buildSummaryRequest`, `runSummarization`, input watcher. Modify: `saveThread`, `ensureSidebar`, `openThread`, `handleSend`, `onNavigation`, message handler. |
| `fetch-watcher.js` | Add `stagedSummaries` variable, `THR_STAGE_SUMMARY` listener, body rewrite on completion POST, `THR_SUMMARY_INJECTED` postMessage. |
| `sidebar.css` | Add badge styles, exclusion icon styles. |
| `tests/utils.test.js` | Add 8 new tests for pure utility functions. |

---

### Task 1: Pure utility functions + tests

**Files:**
- Modify: `content.js`
- Modify: `tests/utils.test.js`

- [ ] **Step 1: Write failing tests**

Add to `tests/utils.test.js` after the existing tests:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/utils.test.js
```

Expected: 5 existing tests pass, 8 new tests FAIL with "isDirtyThread is not defined".

- [ ] **Step 3: Add the four pure functions to content.js**

Add after the `// ── DOM selectors` section (after line 85, before `// ── Storage`):

```js
// ── Summary utilities ─────────────────────────────────────────────────

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
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
node --test tests/utils.test.js
```

Expected: 13 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add content.js tests/utils.test.js
git commit -m "feat: add summary utility functions with tests (isDirtyThread, getDirtyTurns, getParagraphSnippet, buildSummaryPrompt)"
```

---

### Task 2: Summary storage + saveThread exclusion preservation

**Files:**
- Modify: `content.js`

- [ ] **Step 1: Add summary storage functions**

Add after the existing `loadThread` function (after line ~120):

```js
async function loadSummaryData(convId) {
  const key = `summary:${convId}`;
  try {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? { highWaterMark: {}, queue: [] };
  } catch (err) {
    console.warn('[Thread] summary storage read failed:', err.message);
    return { highWaterMark: {}, queue: [] };
  }
}

async function saveSummaryData(convId, data) {
  const key = `summary:${convId}`;
  try {
    await chrome.storage.local.set({ [key]: data });
  } catch (err) {
    console.warn('[Thread] summary storage write failed:', err.message);
  }
}
```

- [ ] **Step 2: Update saveThread to preserve excluded flag**

Replace the existing `saveThread` function:

```js
async function saveThread(convId, msgIdx, paragraphHash, turns) {
  const key = storageKey(convId, msgIdx, paragraphHash);
  try {
    const existing = await chrome.storage.local.get(key);
    const current = existing[key] ?? {};
    await chrome.storage.local.set({ [key]: { ...current, paragraphHash, turns } });
  } catch (err) {
    console.warn('[Thread] storage write failed:', err.message);
  }
}
```

The spread `{ ...current, paragraphHash, turns }` preserves `excluded` (and any future fields) while updating turns.

- [ ] **Step 3: Run existing tests to confirm no regression**

```bash
node --test tests/utils.test.js
```

Expected: 13 tests pass.

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat: add summary storage functions, preserve excluded field in saveThread"
```

---

### Task 3: Thread exclusion toggle + sidebar icon

**Files:**
- Modify: `content.js`
- Modify: `sidebar.css`

- [ ] **Step 1: Add toggleExclusion and updateSummaryIcon to content.js**

Add after `saveSummaryData`:

```js
async function toggleExclusion(convId, responseIdx, paragraphHash) {
  const key = storageKey(convId, responseIdx, paragraphHash);
  try {
    const result = await chrome.storage.local.get(key);
    const current = result[key] ?? { paragraphHash, turns: [] };
    current.excluded = !current.excluded;
    await chrome.storage.local.set({ [key]: current });
    return current.excluded;
  } catch (err) {
    console.warn('[Thread] exclusion toggle failed:', err.message);
    return null;
  }
}

async function updateSummaryIcon() {
  const btn = document.getElementById('thr-exclude-btn');
  if (!btn || !activePara) return;
  const convId = convIdFromUrl();
  if (!convId || !activePara.hash) return;

  const { responseIdx, hash } = activePara;
  const key = storageKey(convId, responseIdx, hash);

  let thread, summaryData;
  try {
    [{ [key]: thread }, summaryData] = await Promise.all([
      chrome.storage.local.get(key),
      loadSummaryData(convId),
    ]);
  } catch (_) { return; }

  const turns = thread?.turns ?? [];
  if (turns.length === 0) { btn.style.display = 'none'; return; }
  btn.style.display = '';

  const excluded = thread?.excluded ?? false;
  const hwmVal = summaryData.highWaterMark[key] ?? 0;

  if (excluded) {
    btn.textContent = '⊘';
    btn.title = 'Excluded from summary — click to re-include';
    btn.dataset.thrState = 'excluded';
  } else if (turns.length > hwmVal) {
    btn.textContent = '◷';
    btn.title = 'Will be included in next summary — click to exclude';
    btn.dataset.thrState = 'pending';
  } else {
    btn.textContent = '✓';
    btn.title = 'Already summarized — click to exclude';
    btn.dataset.thrState = 'summarized';
  }
}
```

- [ ] **Step 2: Update ensureSidebar to include the icon element**

Replace the `sidebarEl.innerHTML` template inside `ensureSidebar`:

```js
  sidebarEl.innerHTML = `
    <div id="thr-sidebar-header">
      <span>Thread</span>
      <button id="thr-close" aria-label="Close sidebar">✕</button>
    </div>
    <div id="thr-quote"></div>
    <div id="thr-thread"></div>
    <div id="thr-summary-state">
      <button id="thr-exclude-btn" style="display:none"></button>
    </div>
    <div id="thr-compose">
      <textarea id="thr-input" placeholder="Reply to this paragraph… (Ctrl+Enter to send)" rows="3"></textarea>
      <button id="thr-send">Send</button>
    </div>
  `;
```

After the existing `document.getElementById('thr-send').addEventListener(...)` line in `ensureSidebar`, add:

```js
  document.getElementById('thr-exclude-btn').addEventListener('click', async () => {
    if (!activePara?.hash) return;
    const convId = convIdFromUrl();
    if (!convId) return;
    await toggleExclusion(convId, activePara.responseIdx, activePara.hash);
    await updateSummaryIcon();
  });
```

- [ ] **Step 3: Call updateSummaryIcon after turns load in openThread**

In `openThread`, update the `hashPromise.then(async (hash) => {...})` block:

```js
  hashPromise.then(async (hash) => {
    if (activePara?._token !== token) return;
    const turns = await loadThread(convId, responseIdx, hash);
    if (activePara?._token !== token) return;
    renderThread(turns);
    await updateSummaryIcon();
  });
```

- [ ] **Step 4: Call updateSummaryIcon after handleSend saves**

In `handleSend`, after the `if (finalText)` block saves the thread, add `await updateSummaryIcon()`:

```js
    if (finalText) {
      const updatedTurns = [...existingTurns, userTurn, { role: 'assistant', content: finalText }];
      await saveThread(convId, responseIdx, hash, updatedTurns);
      if (icon) updateBadge(icon, updatedTurns.filter(t => t.role === 'user').length);
      streamingDiv.textContent = finalText;
      await updateSummaryIcon();
    }
```

- [ ] **Step 5: Add CSS for the exclusion icon**

Add to `sidebar.css`:

```css
/* ── Thread summary state icon ────────────────────────────────────── */

#thr-summary-state {
  padding: 0 16px 4px;
  min-height: 20px;
}

#thr-exclude-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 13px;
  color: #606080;
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
}
#thr-exclude-btn:hover { color: #a78bfa; background: rgba(124, 92, 191, 0.1); }
#thr-exclude-btn[data-thr-state="excluded"] { color: #f87171; }
#thr-exclude-btn[data-thr-state="summarized"] { color: #4ade80; }
#thr-exclude-btn[data-thr-state="pending"] { color: #9090c0; }
```

- [ ] **Step 6: Run tests**

```bash
node --test tests/utils.test.js
```

Expected: 13 tests pass.

- [ ] **Step 7: Commit**

```bash
git add content.js sidebar.css
git commit -m "feat: thread exclusion toggle and summary state icon in sidebar"
```

---

### Task 4: Badge + input watcher + summarization engine

**Files:**
- Modify: `content.js`
- Modify: `sidebar.css`

- [ ] **Step 1: Add badge state constants and functions to content.js**

Add after the `// ── Summary utilities` section (after `buildSummaryPrompt`):

```js
// ── Context badge ─────────────────────────────────────────────────────

const BADGE_STATES = {
  HIDDEN: 'hidden',
  SUMMARIZING: 'summarizing',
  READY: 'ready',
  READY_SUMMARIZING: 'ready-summarizing',
  FAILED: 'failed',
  NO_ENDPOINT: 'no-endpoint',
};

function ensureBadge() {
  const existing = document.getElementById('thr-ctx-badge');
  if (existing && document.body.contains(existing)) return;
  const container = document.querySelector('div[enterkeyhint="enter"]')?.parentElement;
  if (!container) return;
  const badge = document.createElement('div');
  badge.id = 'thr-ctx-badge';
  badge.dataset.state = BADGE_STATES.HIDDEN;
  badge.style.display = 'none';
  container.appendChild(badge);
}

function setBadgeState(state) {
  ensureBadge();
  const badge = document.getElementById('thr-ctx-badge');
  if (!badge) return;
  badge.dataset.state = state;

  const configs = {
    [BADGE_STATES.HIDDEN]:            { text: '',                                            visible: false },
    [BADGE_STATES.SUMMARIZING]:       { text: '⟳ Summarizing threads…',                    visible: true  },
    [BADGE_STATES.READY]:             { text: '✓ Thread context ready',                     visible: true  },
    [BADGE_STATES.READY_SUMMARIZING]: { text: '✓ Thread context ready',                     visible: true, title: 'New thread activity being summarized' },
    [BADGE_STATES.FAILED]:            { text: '⚠ Summarization failed',                     visible: true  },
    [BADGE_STATES.NO_ENDPOINT]:       { text: 'Send a message first to enable thread context', visible: true },
  };

  const cfg = configs[state] ?? configs[BADGE_STATES.HIDDEN];
  badge.style.display = cfg.visible ? '' : 'none';
  badge.textContent = cfg.text;
  badge.title = cfg.title ?? '';
}
```

- [ ] **Step 2: Add summarization state variables and buildSummaryRequest**

Add immediately after the badge functions:

```js
// ── Summarization ─────────────────────────────────────────────────────

let summarizationInFlight = false;
let inputDebounceTimer = null;

function buildSummaryRequest(promptText) {
  if (!endpointInfo?.bodyTemplate) return null;
  const { url, bodyTemplate } = endpointInfo;
  const freshUuids = bodyTemplate.turn_message_uuids ? {
    turn_message_uuids: {
      human_message_uuid: crypto.randomUUID(),
      assistant_message_uuid: crypto.randomUUID(),
    },
  } : {};

  let body;
  if (Array.isArray(bodyTemplate.messages)) {
    body = {
      ...bodyTemplate,
      ...freshUuids,
      model: 'claude-haiku-4-5-20251001',
      messages: [{ role: 'user', content: promptText }],
    };
  } else {
    body = {
      ...bodyTemplate,
      ...freshUuids,
      model: 'claude-haiku-4-5-20251001',
      prompt: `\n\nHuman: ${promptText}\n\nAssistant:`,
    };
  }
  return { url, body: JSON.stringify(body) };
}
```

- [ ] **Step 3: Add runSummarization**

Add after `buildSummaryRequest`:

```js
async function runSummarization(convId, dirtyThreads, summaryData) {
  summarizationInFlight = true;

  // Advance highWaterMark before firing — prevents re-queuing same turns on next keystroke
  const updatedHwm = { ...summaryData.highWaterMark };
  const dirtyItems = dirtyThreads.map(t => {
    const newTurns = getDirtyTurns(t.turns ?? [], summaryData.highWaterMark, t.key);
    updatedHwm[t.key] = (t.turns ?? []).length;
    return { paragraphSnippet: getParagraphSnippet(t.turns ?? []), newTurns };
  });

  await saveSummaryData(convId, { ...summaryData, highWaterMark: updatedHwm });

  try {
    const prompt = buildSummaryPrompt(dirtyItems);
    const req = buildSummaryRequest(prompt);
    if (!req) throw new Error('No endpoint available');

    const summaryText = await streamThreadReply(req.url, req.body, () => {});

    // Reload in case storage changed while we awaited (e.g. another tab)
    const latestData = await loadSummaryData(convId);
    const queueItem = {
      text: summaryText.trim(),
      coveredTurnCounts: Object.fromEntries(
        dirtyThreads.map(t => [t.key, (t.turns ?? []).length])
      ),
      generatedAt: Date.now(),
    };
    const updatedData = {
      highWaterMark: { ...latestData.highWaterMark, ...updatedHwm },
      queue: [...latestData.queue, queueItem],
    };
    await saveSummaryData(convId, updatedData);

    if (convIdFromUrl() === convId) {
      window.postMessage(
        { type: 'THR_STAGE_SUMMARY', summaryTexts: updatedData.queue.map(q => q.text) },
        location.origin
      );
      setBadgeState(BADGE_STATES.READY);
    }
  } catch (err) {
    console.warn('[Thread] summarization failed:', err.message);
    if (convIdFromUrl() === convId) setBadgeState(BADGE_STATES.FAILED);
  } finally {
    summarizationInFlight = false;
  }
}
```

- [ ] **Step 4: Add the input watcher**

Add after `runSummarization`:

```js
async function handleMainInputDebounced() {
  const convId = convIdFromUrl();
  if (!convId) return;

  if (!endpointInfo) {
    setBadgeState(BADGE_STATES.NO_ENDPOINT);
    return;
  }

  let summaryData, allStorage;
  try {
    [summaryData, allStorage] = await Promise.all([
      loadSummaryData(convId),
      chrome.storage.local.get(null),
    ]);
  } catch (_) { return; }

  const prefix = `threads:${convId}:`;
  const threads = Object.entries(allStorage)
    .filter(([k]) => k.startsWith(prefix))
    .map(([k, v]) => ({ key: k, ...(v ?? {}) }));

  const dirtyThreads = threads.filter(t =>
    isDirtyThread(t.turns ?? [], t.excluded ?? false, summaryData.highWaterMark, t.key)
  );

  const hasQueue = summaryData.queue.length > 0;

  if (hasQueue) {
    window.postMessage(
      { type: 'THR_STAGE_SUMMARY', summaryTexts: summaryData.queue.map(q => q.text) },
      location.origin
    );
  }

  if (dirtyThreads.length === 0) {
    setBadgeState(hasQueue ? BADGE_STATES.READY : BADGE_STATES.HIDDEN);
    return;
  }

  if (summarizationInFlight) {
    setBadgeState(hasQueue ? BADGE_STATES.READY_SUMMARIZING : BADGE_STATES.SUMMARIZING);
    return;
  }

  setBadgeState(hasQueue ? BADGE_STATES.READY_SUMMARIZING : BADGE_STATES.SUMMARIZING);
  runSummarization(convId, dirtyThreads, summaryData);
}

document.addEventListener('input', (e) => {
  const compose = document.querySelector('div[enterkeyhint="enter"]');
  if (!compose || !compose.contains(e.target)) return;
  clearTimeout(inputDebounceTimer);
  inputDebounceTimer = setTimeout(handleMainInputDebounced, 300);
});
```

- [ ] **Step 5: Reset badge and in-flight state on SPA navigation**

Replace the existing `onNavigation` function:

```js
function onNavigation() {
  if (location.pathname === lastPathname) return;
  lastPathname = location.pathname;
  endpointInfo = null;
  summarizationInFlight = false;
  clearTimeout(inputDebounceTimer);
  setBadgeState(BADGE_STATES.HIDDEN);
  closeSidebar();
  clearTimeout(restoreTimerId);
  restoreTimerId = setTimeout(restoreThreadBadges, 500);
}
```

- [ ] **Step 6: Add badge CSS**

Add to `sidebar.css`:

```css
/* ── Context injection badge ──────────────────────────────────────── */

#thr-ctx-badge {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 4px;
  color: #9090c0;
  background: rgba(124, 92, 191, 0.08);
  border: 1px solid rgba(124, 92, 191, 0.15);
  margin-top: 4px;
  display: inline-block;
}

#thr-ctx-badge[data-state="ready"],
#thr-ctx-badge[data-state="ready-summarizing"] {
  color: #a78bfa;
  background: rgba(124, 92, 191, 0.15);
  border-color: rgba(124, 92, 191, 0.4);
}

#thr-ctx-badge[data-state="failed"] {
  color: #f87171;
  background: rgba(248, 113, 113, 0.08);
  border-color: rgba(248, 113, 113, 0.3);
}
```

- [ ] **Step 7: Run tests**

```bash
node --test tests/utils.test.js
```

Expected: 13 tests pass.

- [ ] **Step 8: Commit**

```bash
git add content.js sidebar.css
git commit -m "feat: context badge, input watcher, and summarization engine"
```

---

### Task 5: Fetch-watcher injection + THR_SUMMARY_INJECTED handler

**Files:**
- Modify: `fetch-watcher.js`
- Modify: `content.js`

- [ ] **Step 1: Update fetch-watcher.js**

Replace the entire contents of `fetch-watcher.js`:

```js
(function () {
  const COMPLETION_RE = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/;
  const _fetch = window.fetch;
  let stagedSummaries = [];

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    if (e.data?.type === 'THR_STAGE_SUMMARY') {
      stagedSummaries = e.data.summaryTexts ?? [];
    }
  });

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input
              : input instanceof Request ? input.url
              : String(input);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (COMPLETION_RE.test(url) && method === 'POST') {
      let bodyTemplate = null;
      try { bodyTemplate = JSON.parse(init.body); } catch (_) {}

      // Post original body as template (before summary injection)
      window.postMessage({ type: 'THR_ENDPOINT_CAPTURED', url, bodyTemplate }, location.origin);

      // Inject staged summaries if present
      let modifiedInit = init;
      if (stagedSummaries.length > 0 && bodyTemplate) {
        const contextPrefix = stagedSummaries.join('\n') + '\n\n';
        const freshUuids = bodyTemplate.turn_message_uuids ? {
          turn_message_uuids: {
            human_message_uuid: crypto.randomUUID(),
            assistant_message_uuid: crypto.randomUUID(),
          },
        } : {};

        let updatedBody;
        if (Array.isArray(bodyTemplate.messages)) {
          const msgs = [...bodyTemplate.messages];
          const lastUserIdx = msgs.map(m => m.role).lastIndexOf('user');
          if (lastUserIdx !== -1) {
            msgs[lastUserIdx] = { ...msgs[lastUserIdx], content: contextPrefix + msgs[lastUserIdx].content };
          }
          updatedBody = { ...bodyTemplate, ...freshUuids, messages: msgs };
        } else if (typeof bodyTemplate.prompt === 'string') {
          const marker = '\n\nHuman: ';
          const lastHuman = bodyTemplate.prompt.lastIndexOf(marker);
          updatedBody = lastHuman !== -1
            ? { ...bodyTemplate, ...freshUuids, prompt:
                bodyTemplate.prompt.slice(0, lastHuman) + marker + contextPrefix +
                bodyTemplate.prompt.slice(lastHuman + marker.length) }
            : { ...bodyTemplate, ...freshUuids };
        } else {
          updatedBody = { ...bodyTemplate, ...freshUuids };
        }

        modifiedInit = { ...init, body: JSON.stringify(updatedBody) };
        stagedSummaries = [];
        window.postMessage({ type: 'THR_SUMMARY_INJECTED' }, location.origin);
      }

      const response = await _fetch.call(this, input, modifiedInit);
      const [s1, s2] = response.body.tee();

      (async () => {
        const reader = s2.getReader();
        try { while (!(await reader.read()).done) {} } finally {
          reader.releaseLock();
          window.postMessage({ type: 'THR_STREAM_COMPLETE' }, location.origin);
        }
      })();

      return new Response(s1, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    }

    return _fetch.apply(this, arguments);
  };
})();
```

- [ ] **Step 2: Handle THR_SUMMARY_INJECTED in content.js**

In the existing `window.addEventListener('message', ...)` handler, add inside the handler body:

```js
  if (e.data.type === 'THR_SUMMARY_INJECTED') {
    const convId = convIdFromUrl();
    if (convId) {
      loadSummaryData(convId).then(data =>
        saveSummaryData(convId, { ...data, queue: [] })
      );
    }
    setBadgeState(BADGE_STATES.HIDDEN);
  }
```

The full updated handler:

```js
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (!e.data?.type?.startsWith('THR_')) return;

  if (e.data.type === 'THR_ENDPOINT_CAPTURED') {
    endpointInfo = { url: e.data.url, bodyTemplate: e.data.bodyTemplate };
  }
  if (e.data.type === 'THR_STREAM_COMPLETE') {
    setTimeout(processNewResponse, 150);
  }
  if (e.data.type === 'THR_SUMMARY_INJECTED') {
    const convId = convIdFromUrl();
    if (convId) {
      loadSummaryData(convId).then(data =>
        saveSummaryData(convId, { ...data, queue: [] })
      );
    }
    setBadgeState(BADGE_STATES.HIDDEN);
  }
});
```

- [ ] **Step 3: Run tests**

```bash
node --test tests/utils.test.js
```

Expected: 13 tests pass.

- [ ] **Step 4: Load extension in Chrome and end-to-end test**

1. Open `chrome://extensions`, click Reload on the Thread extension
2. Open Claude.ai, send a message to get a response
3. Click `💬` on a paragraph, send a thread reply
4. Click `💬` on another paragraph, send a thread reply
5. Click into the main chat input — badge should appear: "⟳ Summarizing threads…" then "✓ Thread context ready"
6. Send a main chat message — the next Claude response should reflect awareness of the thread context
7. Badge should disappear after send
8. Click `💬` on either paragraph — the exclusion icon (`◷`) should appear at bottom of sidebar
9. Click the icon — it should toggle to `⊘` (excluded)
10. Type in main chat again — badge should appear (only non-excluded thread is dirty)
11. Refresh the page — thread badges should restore correctly

- [ ] **Step 5: Commit**

```bash
git add fetch-watcher.js content.js
git commit -m "feat: fetch-watcher summary injection, THR_SUMMARY_INJECTED handler, queue wipe on send"
```
