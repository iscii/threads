# Inline Chat Threads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome MV3 extension that injects paragraph-level comment icons into Claude.ai responses and opens a persistent threaded reply sidebar anchored to each paragraph.

**Architecture:** Two content scripts — `fetch-watcher.js` (MAIN world) intercepts Claude.ai's completion fetch calls and detects stream completion; `content.js` (ISOLATED world) handles all DOM work, sidebar, storage, and thread API calls. They communicate via `window.postMessage`. No backend, no build step.

**Tech Stack:** Vanilla JS (ES2022), Chrome Extension Manifest V3, `chrome.storage.local`, `crypto.subtle` (SHA-256), `ReadableStream` (SSE parsing), Node 18+ built-in `node:test` runner for pure-function unit tests.

---

## File Map

| File | Responsibility |
|------|---------------|
| `manifest.json` | Extension config — two content scripts, storage permission |
| `background.js` | MV3 service worker (required, no active duties) |
| `fetch-watcher.js` | MAIN world — wraps `window.fetch`, posts endpoint info + stream-complete events |
| `content.js` | ISOLATED world — DOM observer, icon injection, sidebar, storage, thread API |
| `sidebar.css` | All extension styles, scoped under `thr-` prefix |
| `icons/icon-48.png` | Extension icon (48×48) |
| `tests/utils.test.js` | Node `node:test` — tests `hashParagraph` and `storageKey` pure functions |

---

### Task 1: Extension scaffold

**Files:**
- Create: `manifest.json`
- Create: `background.js`
- Create: `icons/icon-48.png`

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Thread",
  "version": "0.1.0",
  "description": "Inline reply threads for Claude.ai responses",
  "permissions": ["storage"],
  "host_permissions": ["https://claude.ai/*"],
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [
    {
      "matches": ["https://claude.ai/*"],
      "js": ["fetch-watcher.js"],
      "world": "MAIN",
      "run_at": "document_start"
    },
    {
      "matches": ["https://claude.ai/*"],
      "js": ["content.js"],
      "css": ["sidebar.css"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "48": "icons/icon-48.png"
  }
}
```

- [ ] **Step 2: Create `background.js`**

```js
// Required by MV3 spec; no active duties.
```

- [ ] **Step 3: Generate `icons/icon-48.png` (purple square)**

```bash
mkdir -p icons && python3 -c "
import struct, zlib, binascii

def chunk(tag, data):
    crc = binascii.crc32(tag + data) & 0xffffffff
    return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', crc)

w, h, r, g, b = 48, 48, 124, 92, 191
raw = b''.join(b'\x00' + bytes([r, g, b] * w) for _ in range(h))
png = (b'\x89PNG\r\n\x1a\n'
    + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    + chunk(b'IDAT', zlib.compress(raw))
    + chunk(b'IEND', b''))
open('icons/icon-48.png', 'wb').write(png)
print('icon written')
"
```

Expected: `icon written`

- [ ] **Step 4: Load extension in Chrome and verify no errors**

1. Go to `chrome://extensions`, enable Developer mode
2. Click "Load unpacked" → select this directory
3. Confirm the "Thread" extension card shows no errors

- [ ] **Step 5: Commit**

```bash
git add manifest.json background.js icons/icon-48.png
git commit -m "feat: extension scaffold — manifest, background service worker, icon"
```

---

### Task 2: Fetch watcher (MAIN world)

**Files:**
- Create: `fetch-watcher.js`

Wraps `window.fetch` in the page's JS context. On each call to Claude.ai's completion endpoint: (a) posts the URL + request body template to the ISOLATED world, (b) tees the response stream to detect when streaming finishes and posts a completion event.

- [ ] **Step 1: Create `fetch-watcher.js`**

```js
(function () {
  const COMPLETION_RE = /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/;
  const _fetch = window.fetch;

  window.fetch = async function (input, init = {}) {
    const url = typeof input === 'string' ? input
              : input instanceof Request ? input.url
              : String(input);
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

    if (COMPLETION_RE.test(url) && method === 'POST') {
      let bodyTemplate = null;
      try { bodyTemplate = JSON.parse(init.body); } catch (_) {}

      window.postMessage({ type: 'THR_ENDPOINT_CAPTURED', url, bodyTemplate }, location.origin);

      const response = await _fetch.apply(this, arguments);
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

- [ ] **Step 2: Reload extension and verify firing**

1. Reload the extension in `chrome://extensions`
2. Open `https://claude.ai`, send any message, wait for response
3. In DevTools → Console (select the "top" frame), look for the `THR_ENDPOINT_CAPTURED` message — content.js in Task 3 will log it; for now temporarily add to the bottom of `fetch-watcher.js`:

```js
// TEMP: remove before commit
window.addEventListener('message', e => {
  if (e.data?.type === 'THR_ENDPOINT_CAPTURED') console.log('[FW] captured:', e.data.url);
  if (e.data?.type === 'THR_STREAM_COMPLETE') console.log('[FW] stream done');
});
```

4. Confirm both log lines appear when Claude responds
5. Remove the temp listener before the next step

- [ ] **Step 3: Commit**

```bash
git add fetch-watcher.js
git commit -m "feat: MAIN world fetch watcher intercepts completion endpoint and detects stream completion"
```

---

### Task 3: Streaming completion detection

**Files:**
- Create: `content.js`

Receives `postMessage` events from `fetch-watcher.js` and kicks off a DOM scan 150ms after each stream completes (giving React time to finish rendering).

- [ ] **Step 1: Create `content.js`**

```js
// ── State ─────────────────────────────────────────────────────────────
let endpointInfo = null;  // { url, bodyTemplate }

// ── Receive fetch-watcher events ──────────────────────────────────────
window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  if (!e.data?.type?.startsWith('THR_')) return;

  if (e.data.type === 'THR_ENDPOINT_CAPTURED') {
    endpointInfo = { url: e.data.url, bodyTemplate: e.data.bodyTemplate };
  }
  if (e.data.type === 'THR_STREAM_COMPLETE') {
    setTimeout(processNewResponse, 150);
  }
});

// ── Placeholder (replaced in Task 4) ─────────────────────────────────
function processNewResponse() {
  console.log('[Thread] stream complete, endpointInfo:', endpointInfo?.url ?? 'none');
}
```

- [ ] **Step 2: Reload and verify**

1. Reload extension, go to Claude.ai, send a message
2. DevTools → Console: after Claude's response finishes, confirm `[Thread] stream complete` appears

- [ ] **Step 3: Commit**

```bash
git add content.js
git commit -m "feat: content script listens for fetch-watcher events, detects stream completion"
```

---

### Task 4: Paragraph icon injection

**Files:**
- Create: `sidebar.css`
- Modify: `content.js`

After each stream completion, find Claude's newest response element, walk its paragraph and heading blocks, and inject a hover-visible `💬` icon to the right of each.

- [ ] **Step 1: Discover Claude.ai's DOM selectors**

Before writing code, verify the selectors on the live site:

1. Go to `https://claude.ai`, send a message, wait for the full response
2. Open DevTools → Console and run these one at a time:

```js
document.querySelectorAll('.font-claude-message').length
document.querySelectorAll('[data-is-streaming]').length
document.querySelectorAll('[class*="prose"]').length
```

3. Note which returns a count > 0 — that selector goes into `RESPONSE_SELECTOR` in the next step
4. Also run: `document.querySelector('.font-claude-message p')` (or whichever selector matched) to confirm it points to a paragraph inside a response

- [ ] **Step 2: Create `sidebar.css`**

```css
/* ── Paragraph icon wrappers ──────────────────────────────────────── */

.thr-para-wrapper {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.thr-icon {
  flex-shrink: 0;
  margin-top: 2px;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  opacity: 0;
  transition: opacity 0.15s;
  padding: 2px 4px;
  border-radius: 4px;
  line-height: 1;
  position: relative;
}

.thr-para-wrapper:hover .thr-icon { opacity: 0.5; }
.thr-para-wrapper:hover .thr-icon:hover { opacity: 1; background: rgba(124, 92, 191, 0.15); }
.thr-icon[data-has-thread="true"] { opacity: 0.7; }

.thr-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #7c5cbf;
  color: white;
  border-radius: 8px;
  font-size: 9px;
  padding: 0 4px;
  min-width: 14px;
  text-align: center;
  pointer-events: none;
}
```

- [ ] **Step 3: Add paragraph injection to `content.js`**

Add these constants at the top (below the state declarations) and replace `processNewResponse`:

```js
// ── DOM selectors ─────────────────────────────────────────────────────
// Update RESPONSE_SELECTOR based on Step 1 inspection results.
const RESPONSE_SELECTOR = '.font-claude-message, [data-is-streaming], [class*="prose"]';
const PARAGRAPH_SELECTOR = 'p, h1, h2, h3, h4, h5, h6';
const INJECTED_ATTR = 'data-thr-injected';

// ── Paragraph icon injection ──────────────────────────────────────────
function processNewResponse() {
  const responses = document.querySelectorAll(RESPONSE_SELECTOR);
  if (!responses.length) return;
  const latest = responses[responses.length - 1];
  if (latest.getAttribute(INJECTED_ATTR)) return;
  latest.setAttribute(INJECTED_ATTR, 'true');
  latest.querySelectorAll(PARAGRAPH_SELECTOR)
    .forEach((para, idx) => injectIcon(para, idx));
}

function injectIcon(para, paragraphIdx) {
  const wrapper = document.createElement('div');
  wrapper.className = 'thr-para-wrapper';
  para.parentNode.insertBefore(wrapper, para);
  wrapper.appendChild(para);

  const icon = document.createElement('button');
  icon.className = 'thr-icon';
  icon.setAttribute('aria-label', 'Open reply thread');
  icon.setAttribute('data-para-idx', paragraphIdx);
  icon.textContent = '💬';
  icon.addEventListener('click', () => openThread(para, paragraphIdx, icon));
  wrapper.appendChild(icon);
}

// Placeholder replaced in Task 5
function openThread(para, paragraphIdx, icon) {
  console.log('[Thread] click para', paragraphIdx, para.textContent.slice(0, 60));
}
```

- [ ] **Step 4: Reload and verify**

1. Reload extension, go to Claude.ai, send a message
2. After response finishes, hover over paragraphs — `💬` should fade in to the right
3. Click one — console should log the paragraph index and first 60 chars of its text
4. If icons don't appear after hover: check that `[Thread] stream complete` fired in console. If it fired but no icons, the `RESPONSE_SELECTOR` didn't match — run the discovery commands from Step 1 and update the constant

- [ ] **Step 5: Commit**

```bash
git add content.js sidebar.css
git commit -m "feat: inject paragraph comment icons into completed Claude responses"
```

---

### Task 5: Sidebar panel

**Files:**
- Modify: `content.js`
- Modify: `sidebar.css`

Inject a right-side panel into Claude.ai. Clicking a paragraph icon opens it showing the thread for that paragraph. Clicking a different icon switches the thread. Closing removes the panel.

- [ ] **Step 1: Add sidebar state and HTML to `content.js`**

Add this section to `content.js` immediately after the state declarations at the top:

```js
// ── Sidebar state ─────────────────────────────────────────────────────
let sidebarEl = null;
let sidebarThreadEl = null;
let sidebarInputEl = null;
let activePara = null;  // { para, paragraphIdx, responseIdx, icon, hash, hashPromise }

function ensureSidebar() {
  if (sidebarEl) return;
  sidebarEl = document.createElement('div');
  sidebarEl.id = 'thr-sidebar';
  sidebarEl.innerHTML = `
    <div id="thr-sidebar-header">
      <span>Thread</span>
      <button id="thr-close" aria-label="Close sidebar">✕</button>
    </div>
    <div id="thr-quote"></div>
    <div id="thr-thread"></div>
    <div id="thr-compose">
      <textarea id="thr-input" placeholder="Reply to this paragraph… (Ctrl+Enter to send)" rows="3"></textarea>
      <button id="thr-send">Send</button>
    </div>
  `;
  document.body.appendChild(sidebarEl);
  document.getElementById('thr-close').addEventListener('click', closeSidebar);
  document.getElementById('thr-send').addEventListener('click', handleSend);
  sidebarThreadEl = document.getElementById('thr-thread');
  sidebarInputEl = document.getElementById('thr-input');
  sidebarInputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleSend();
  });
}

function openSidebar() {
  ensureSidebar();
  sidebarEl.classList.add('thr-open');
  // Dynamically nudge the chat content container
  const chatEl = document.querySelector('main, [class*="conversation"], [class*="chat-content"]');
  if (chatEl && !chatEl.dataset.thrNudged) {
    chatEl.style.transition = 'padding-right 0.25s ease';
    chatEl.style.paddingRight = '420px';
    chatEl.dataset.thrNudged = '1';
    sidebarEl._chatEl = chatEl;
  }
}

function closeSidebar() {
  if (!sidebarEl) return;
  sidebarEl.classList.remove('thr-open');
  if (sidebarEl._chatEl) {
    sidebarEl._chatEl.style.paddingRight = '';
    delete sidebarEl._chatEl.dataset.thrNudged;
    sidebarEl._chatEl = null;
  }
  activePara = null;
}

function renderThread(turns) {
  sidebarThreadEl.innerHTML = '';
  for (const turn of turns) {
    const div = document.createElement('div');
    div.className = `thr-turn thr-turn-${turn.role}`;
    div.textContent = turn.content;
    sidebarThreadEl.appendChild(div);
  }
  sidebarThreadEl.scrollTop = sidebarThreadEl.scrollHeight;
}
```

- [ ] **Step 2: Replace the placeholder `openThread`**

Find and replace:

```js
// Placeholder replaced in Task 5
function openThread(para, paragraphIdx, icon) {
  console.log('[Thread] click para', paragraphIdx, para.textContent.slice(0, 60));
}
```

With:

```js
function openThread(para, paragraphIdx, icon) {
  const allResponses = [...document.querySelectorAll(RESPONSE_SELECTOR)];
  const responseEl = para.closest(RESPONSE_SELECTOR);
  const responseIdx = allResponses.indexOf(responseEl);

  const hashPromise = hashParagraph(para.textContent);
  activePara = { para, paragraphIdx, responseIdx, icon, hash: null, hashPromise };
  hashPromise.then(h => { if (activePara) activePara.hash = h; });

  openSidebar();

  const quoteText = para.textContent;
  document.getElementById('thr-quote').textContent =
    `"${quoteText.slice(0, 140)}${quoteText.length > 140 ? '…' : ''}"`;

  sidebarInputEl.value = '';
  renderThread([]);
  sidebarInputEl.focus();

  // Load existing thread turns once hash resolves
  const convId = convIdFromUrl();
  hashPromise.then(async (hash) => {
    const turns = await loadThread(convId, responseIdx, hash);
    renderThread(turns);
  });
}
```

Note: `hashParagraph`, `loadThread`, `convIdFromUrl` are defined in Task 6. Add a forward-declaration stub now so the file loads:

```js
// ── Storage stubs (implemented in Task 6) ────────────────────────────
function convIdFromUrl() { return location.pathname.match(/\/chat\/([^/]+)/)?.[1] ?? null; }
async function hashParagraph(text) { return 'stub'; }
async function loadThread() { return []; }
```

- [ ] **Step 3: Add placeholder `handleSend` (replaced in Task 7)**

```js
function handleSend() {
  const text = sidebarInputEl.value.trim();
  if (!text) return;
  console.log('[Thread] send (not yet wired):', text);
  sidebarInputEl.value = '';
}
```

- [ ] **Step 4: Add sidebar CSS to `sidebar.css`**

Append:

```css
/* ── Sidebar panel ────────────────────────────────────────────────── */

#thr-sidebar {
  position: fixed;
  top: 0;
  right: -420px;
  width: 400px;
  height: 100vh;
  background: #1a1a2e;
  border-left: 1px solid #2e2e4e;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  transition: right 0.25s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: #e0e0e0;
}

#thr-sidebar.thr-open { right: 0; }

#thr-sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #2e2e4e;
  font-weight: 600;
  color: #a78bfa;
}

#thr-close {
  background: none;
  border: none;
  color: #888;
  cursor: pointer;
  font-size: 16px;
  padding: 4px 6px;
  border-radius: 4px;
}
#thr-close:hover { color: #e0e0e0; }

#thr-quote {
  margin: 12px 16px;
  padding: 8px 12px;
  border-left: 3px solid #7c5cbf;
  font-size: 12px;
  color: #9090c0;
  font-style: italic;
  background: rgba(124, 92, 191, 0.08);
  border-radius: 0 4px 4px 0;
}

#thr-thread {
  flex: 1;
  overflow-y: auto;
  padding: 8px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.thr-turn {
  padding: 10px 12px;
  border-radius: 8px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
}
.thr-turn-user { background: rgba(124, 92, 191, 0.2); align-self: flex-end; max-width: 88%; }
.thr-turn-assistant { background: #242436; align-self: flex-start; max-width: 88%; }

#thr-compose {
  padding: 12px 16px;
  border-top: 1px solid #2e2e4e;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

#thr-input {
  background: #12122a;
  border: 1px solid #3e3e5e;
  border-radius: 8px;
  color: #e0e0e0;
  font-size: 13px;
  padding: 10px 12px;
  resize: vertical;
  font-family: inherit;
  line-height: 1.4;
}
#thr-input:focus { outline: none; border-color: #7c5cbf; }

#thr-send {
  align-self: flex-end;
  background: #7c5cbf;
  border: none;
  border-radius: 8px;
  color: white;
  cursor: pointer;
  font-size: 13px;
  padding: 8px 20px;
}
#thr-send:hover { background: #9370db; }
#thr-send:disabled { background: #4a4a6a; cursor: not-allowed; }
```

- [ ] **Step 5: Reload and verify**

1. Reload extension, go to Claude.ai, send a message
2. After response, hover a paragraph and click `💬`
3. Verify: sidebar slides in from right, shows quoted paragraph text, empty thread, focused input
4. Verify: clicking ✕ closes the sidebar
5. Verify: clicking a different paragraph's icon switches the quote text
6. If main content doesn't nudge: open DevTools → Elements, find the scroll container for the chat, inspect its class name and update the `querySelector` in `openSidebar`

- [ ] **Step 6: Commit**

```bash
git add content.js sidebar.css
git commit -m "feat: sidebar panel — quote display, thread area, compose input, open/close"
```

---

### Task 6: Thread storage

**Files:**
- Modify: `content.js` (replace stubs)
- Create: `tests/utils.test.js`

Implement SHA-256 paragraph hashing and `chrome.storage.local` read/write. Unit-test the pure utility functions with Node's built-in test runner.

- [ ] **Step 1: Write tests first**

Create `tests/utils.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — expect all to pass**

```bash
mkdir -p tests && node --test tests/utils.test.js
```

Expected output:
```
✔ hashParagraph returns 16-char lowercase hex
✔ hashParagraph is deterministic
✔ hashParagraph distinguishes different text
✔ storageKey correct format
✔ storageKey index 0
ℹ tests 5
ℹ pass 5
```

- [ ] **Step 3: Replace storage stubs in `content.js`**

Find and replace the entire `// ── Storage stubs` block:

```js
// ── Storage stubs (implemented in Task 6) ────────────────────────────
function convIdFromUrl() { return location.pathname.match(/\/chat\/([^/]+)/)?.[1] ?? null; }
async function hashParagraph(text) { return 'stub'; }
async function loadThread() { return []; }
```

Replace with:

```js
// ── Storage ───────────────────────────────────────────────────────────

function convIdFromUrl() {
  return location.pathname.match(/\/chat\/([^/]+)/)?.[1] ?? null;
}

async function hashParagraph(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
}

function storageKey(convId, msgIdx, paragraphHash) {
  return `threads:${convId}:${msgIdx}:${paragraphHash}`;
}

async function saveThread(convId, msgIdx, paragraphHash, turns) {
  const key = storageKey(convId, msgIdx, paragraphHash);
  return chrome.storage.local.set({ [key]: { paragraphHash, turns } });
}

async function loadThread(convId, msgIdx, paragraphHash) {
  const key = storageKey(convId, msgIdx, paragraphHash);
  const result = await chrome.storage.local.get(key);
  return result[key]?.turns ?? [];
}
```

- [ ] **Step 4: Reload and verify thread loads**

1. Reload extension, go to Claude.ai
2. Click a paragraph icon — sidebar opens (quote visible, empty thread, no console errors)
3. Confirm no `stub` value errors appear in console

- [ ] **Step 5: Commit**

```bash
git add content.js tests/utils.test.js
git commit -m "feat: SHA-256 paragraph hashing and chrome.storage.local thread persistence"
```

---

### Task 7: Thread API calls

**Files:**
- Modify: `content.js`

Replace `handleSend` with the real implementation: build a request using the intercepted endpoint, stream the response into the sidebar, save the completed turn to storage, and update the paragraph badge.

- [ ] **Step 1: Add thread API helpers to `content.js`** (above `handleSend`)

```js
// ── Thread API ────────────────────────────────────────────────────────

function buildThreadRequest(paraText, userInput, existingTurns) {
  if (!endpointInfo) {
    throw new Error('No Claude.ai endpoint captured yet — send a message in the main chat first.');
  }
  const { url, bodyTemplate } = endpointInfo;
  const contextTurn = `Focusing on this specific part of your response: "${paraText}"\n\n${userInput}`;

  let updatedBody;
  if (Array.isArray(bodyTemplate.messages)) {
    // Messages API format (most likely)
    updatedBody = {
      ...bodyTemplate,
      messages: [
        ...bodyTemplate.messages,
        ...existingTurns,
        { role: 'user', content: contextTurn },
      ],
    };
  } else if (typeof bodyTemplate.prompt === 'string') {
    // Human/Assistant prompt format (older models)
    const threadHistory = existingTurns.map(t =>
      t.role === 'user' ? `\n\nHuman: ${t.content}` : `\n\nAssistant: ${t.content}`
    ).join('');
    updatedBody = {
      ...bodyTemplate,
      prompt: bodyTemplate.prompt + threadHistory + `\n\nHuman: ${contextTurn}\n\nAssistant:`,
    };
  } else {
    throw new Error('Unrecognised Claude.ai request format — inspect console.log(endpointInfo.bodyTemplate)');
  }

  return { url, body: JSON.stringify(updatedBody) };
}

async function streamThreadReply(url, body, onChunk) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body,
  });
  if (!response.ok) throw new Error(`API ${response.status}: ${response.statusText}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const line of decoder.decode(value, { stream: true }).split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') continue;
      try {
        const parsed = JSON.parse(payload);
        const token =
          parsed.completion ??
          parsed.delta?.text ??
          parsed.choices?.[0]?.delta?.content ??
          '';
        if (token) { accumulated += token; onChunk(accumulated); }
      } catch (_) {}
    }
  }
  return accumulated;
}

function updateBadge(icon, userTurnCount) {
  icon.setAttribute('data-has-thread', 'true');
  let badge = icon.querySelector('.thr-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'thr-badge';
    icon.appendChild(badge);
  }
  badge.textContent = userTurnCount;
}
```

- [ ] **Step 2: Replace `handleSend` with full implementation**

Find and replace:

```js
function handleSend() {
  const text = sidebarInputEl.value.trim();
  if (!text) return;
  console.log('[Thread] send (not yet wired):', text);
  sidebarInputEl.value = '';
}
```

With:

```js
async function handleSend() {
  const text = sidebarInputEl.value.trim();
  if (!text || !activePara) return;

  const sendBtn = document.getElementById('thr-send');
  sendBtn.disabled = true;
  sidebarInputEl.disabled = true;

  // Ensure hash is computed before proceeding
  const hash = activePara.hash ?? await activePara.hashPromise;
  const convId = convIdFromUrl();
  const { para, responseIdx, icon } = activePara;

  const existingTurns = await loadThread(convId, responseIdx, hash);
  const userTurn = { role: 'user', content: text };

  renderThread([...existingTurns, userTurn]);
  sidebarInputEl.value = '';

  const streamingDiv = document.createElement('div');
  streamingDiv.className = 'thr-turn thr-turn-assistant';
  streamingDiv.textContent = '…';
  sidebarThreadEl.appendChild(streamingDiv);
  sidebarThreadEl.scrollTop = sidebarThreadEl.scrollHeight;

  try {
    const { url, body } = buildThreadRequest(para.textContent, text, existingTurns);
    const finalText = await streamThreadReply(url, body, (partial) => {
      streamingDiv.textContent = partial;
      sidebarThreadEl.scrollTop = sidebarThreadEl.scrollHeight;
    });

    const updatedTurns = [...existingTurns, userTurn, { role: 'assistant', content: finalText }];
    await saveThread(convId, responseIdx, hash, updatedTurns);
    if (icon) updateBadge(icon, updatedTurns.filter(t => t.role === 'user').length);
  } catch (err) {
    streamingDiv.textContent = `Error: ${err.message}`;
    streamingDiv.style.color = '#f87171';
  } finally {
    sendBtn.disabled = false;
    sidebarInputEl.disabled = false;
    sidebarInputEl.focus();
  }
}
```

- [ ] **Step 3: Reload and test the full thread flow**

1. Reload extension, go to Claude.ai
2. Send a message in the main chat (primes `endpointInfo`)
3. Click `💬` on a paragraph, type a follow-up question, hit Send
4. Verify: question appears in thread, `…` placeholder appears, Claude's answer streams in
5. Verify: `💬` icon shows a badge with count `1`
6. If the send fails with an error message in the sidebar:
   - Open DevTools → Console and run `console.log(endpointInfo.bodyTemplate)` to inspect the request shape
   - If you see a `prompt` field (not `messages`), the `prompt`-format branch in `buildThreadRequest` will handle it — but check the prompt string format matches Claude.ai's convention (`\n\nHuman:` / `\n\nAssistant:`)
   - If you see neither `messages` nor `prompt`, add a `console.log` in `buildThreadRequest` to identify the field name and update accordingly

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat: thread API call with streaming SSE response and badge update"
```

---

### Task 8: Thread persistence on page load + SPA navigation

**Files:**
- Modify: `content.js`

On page load, scan all existing responses for stored threads and restore their badges. Watch for SPA URL changes so state resets cleanly when the user navigates between conversations.

- [ ] **Step 1: Add persistence and navigation to `content.js`**

Add at the bottom of `content.js`:

```js
// ── Persistence & SPA navigation ─────────────────────────────────────

async function restoreThreadBadges() {
  const convId = convIdFromUrl();
  if (!convId) return;

  const allKeys = await chrome.storage.local.get(null);
  const prefix = `threads:${convId}:`;
  const matching = Object.entries(allKeys).filter(([k]) => k.startsWith(prefix));
  if (!matching.length) return;

  // Build map: responseIdx → [{ paragraphHash, turns }]
  const byResponse = {};
  for (const [key, val] of matching) {
    const rest = key.slice(prefix.length);            // "responseIdx:paragraphHash"
    const colon = rest.indexOf(':');
    const responseIdx = parseInt(rest.slice(0, colon), 10);
    const paragraphHash = rest.slice(colon + 1);
    if (!byResponse[responseIdx]) byResponse[responseIdx] = [];
    byResponse[responseIdx].push({ paragraphHash, turns: val.turns });
  }

  const allResponses = document.querySelectorAll(RESPONSE_SELECTOR);

  for (const [idxStr, threads] of Object.entries(byResponse)) {
    const responseEl = allResponses[parseInt(idxStr, 10)];
    if (!responseEl) continue;

    if (!responseEl.getAttribute(INJECTED_ATTR)) {
      responseEl.setAttribute(INJECTED_ATTR, 'true');
      responseEl.querySelectorAll(PARAGRAPH_SELECTOR).forEach((p, i) => injectIcon(p, i));
    }

    const paragraphs = [...responseEl.querySelectorAll(PARAGRAPH_SELECTOR)];

    for (const { paragraphHash, turns } of threads) {
      if (!turns?.length) continue;
      for (let i = 0; i < paragraphs.length; i++) {
        const h = await hashParagraph(paragraphs[i].textContent);
        if (h !== paragraphHash) continue;
        const icon = paragraphs[i].parentElement?.querySelector('.thr-icon');
        if (icon) updateBadge(icon, turns.filter(t => t.role === 'user').length);
        break;
      }
    }
  }
}

// SPA navigation watcher
let lastPathname = location.pathname;
new MutationObserver(() => {
  if (location.pathname === lastPathname) return;
  lastPathname = location.pathname;
  endpointInfo = null;
  closeSidebar();
  setTimeout(restoreThreadBadges, 500);
}).observe(document.body, { childList: true, subtree: false });

// Initial load
restoreThreadBadges();
```

- [ ] **Step 2: Verify persistence across refresh**

1. Reload extension, go to Claude.ai, send a message
2. Click a paragraph `💬`, send a thread reply, verify badge shows `1`
3. Refresh the page (F5)
4. After reload: badge should reappear on the same paragraph without any click
5. Click the icon — sidebar opens with the previous thread history intact

- [ ] **Step 3: Verify SPA navigation**

1. In an existing conversation, create a thread reply
2. Click "New chat" in Claude.ai's sidebar
3. Verify: the thread sidebar closes automatically
4. Navigate back to the original conversation
5. Verify: the badge reappears on the paragraph

- [ ] **Step 4: Commit**

```bash
git add content.js
git commit -m "feat: restore thread badges on page load and reset state on SPA navigation"
```

---

## Self-Review Notes

**Spec coverage verified:**
- ✅ Chrome extension, Claude.ai only
- ✅ Icons appear after streaming completes (not during)
- ✅ Paragraph-level hover trigger
- ✅ Right sidebar panel
- ✅ Full conversation context + flagged paragraph sent to AI
- ✅ Threads persist with badge count across refresh
- ✅ Clicking different paragraph switches sidebar thread
- ✅ SPA navigation resets state

**Type/name consistency verified:**
- `hashParagraph`, `storageKey`, `saveThread`, `loadThread` defined in Task 6, referenced in Tasks 7 & 8 ✓
- `activePara.hash` and `activePara.hashPromise` set in Task 5's `openThread`, awaited in Task 7's `handleSend` ✓
- `RESPONSE_SELECTOR`, `PARAGRAPH_SELECTOR`, `INJECTED_ATTR` defined in Task 4, used in Tasks 4, 5, 7, 8 ✓
- `sidebarThreadEl`, `sidebarInputEl` set in Task 5's `ensureSidebar`, used in Tasks 5 & 7 ✓
- `updateBadge(icon, count)` defined in Task 7, called in Tasks 7 & 8 ✓
- `endpointInfo` set in Task 3, read in Task 7's `buildThreadRequest` ✓
