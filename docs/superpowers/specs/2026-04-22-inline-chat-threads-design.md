# Inline Chat Threads — Design Spec
*2026-04-22*

## Overview

A Chrome extension that lets users reply to specific paragraphs in Claude.ai's responses. Inspired by Google Docs' highlight-and-comment model: instead of stacking all follow-up questions into a single linear message, users can open a threaded sub-conversation anchored to any paragraph in Claude's response.

## Problem

Claude's responses are often long and multi-topic. A user reading through them typically wants to follow up on paragraph 1, then paragraph 2, then paragraph 3 — but the linear chat UI forces them to either: (a) bundle all questions into one message after reading everything, losing the immediacy of each question, or (b) send questions piecemeal and scroll repeatedly, with each reply spawning a new top-level response.

## Solution

A paragraph-level comment icon (💬) appears on hover next to each paragraph after a response finishes streaming. Clicking it opens a right sidebar showing a threaded sub-conversation anchored to that paragraph. Threads persist across page refreshes. The main chat stays clean.

---

## Architecture

Three components, no backend:

| Component | Responsibility |
|---|---|
| Content Script (`content.js`) | DOM observation, icon injection, sidebar render, fetch interception (MAIN world) |
| Background Service Worker (`background.js`) | Message relay between content script and extension APIs |
| Chrome Storage | Thread persistence (`chrome.storage.local`) |

No framework. Vanilla JS and CSS to avoid conflicts with Claude.ai's React and keep the extension auditable and fast-loading.

**Permissions:**
```json
"permissions": ["storage"],
"host_permissions": ["https://claude.ai/*"]
```

---

## File Structure

```
thread-1/
├── manifest.json
├── background.js
├── content.js
├── sidebar.css
└── icons/
    └── icon-48.png
```

---

## DOM Integration

**Response completion detection:** A `MutationObserver` watches Claude.ai's message container. Claude.ai renders a stop button while streaming and removes it on completion — the extension uses that removal as its signal.

**Paragraph injection:** After each completed response, the extension walks its DOM and wraps each `<p>` and heading block in a relative-positioned container. A `💬` icon is injected to the right, visible on hover only.

**Sidebar:** A single `<div>` appended to `document.body`, fixed to the right side (400px wide). The main content area's right margin is nudged to make room. All CSS is scoped under the `thr-` prefix to avoid collisions with Claude.ai's styles.

**Active thread indicators:**
- Paragraphs with existing threads show a count badge on the icon (e.g. `💬 2`)
- The currently-open thread's paragraph gets a left purple border highlight

---

## Fetch Interception

The content script runs in the `MAIN` world (via `"world": "MAIN"` in the manifest) and wraps `window.fetch` on page load, watching for calls to Claude.ai's completion endpoint (pattern: `/api/organizations/.../chat_conversations/.../completion`). On first capture, it stores the URL shape and request body format. Auth cookies are already in the browser and travel automatically.

**Thread request construction:**
1. Read all message bubbles from the DOM to reconstruct conversation history
2. Append a user turn:
   > *"Focusing on this specific part of your response: '[paragraph text]'\n\nUser's question"*
3. POST to the captured endpoint with the same request shape Claude.ai uses

**Streaming:** Claude.ai returns `text/event-stream`. The extension reads it with a `ReadableStream` reader and appends tokens to the sidebar in real time.

**Failure handling:** If the endpoint shape changes, thread sends fail with an inline error: *"Unable to reach Claude — the extension may need an update."*

---

## Thread Data Model

Threads are stored in `chrome.storage.local`. Each thread is identified by:

```
threads:{conversationId}:{messageIndex}:{paragraphHash}
```

- `conversationId` — extracted from the page URL (`/chat/{id}`)
- `messageIndex` — zero-based position of Claude's response in the DOM
- `paragraphHash` — SHA-256 of the paragraph's full text, truncated to 16 hex chars

**Storage value:**
```json
{
  "paragraphHash": "a3f9c1d2e4b78f01",
  "turns": [
    { "role": "user", "content": "What does self-attention mean here?" },
    { "role": "assistant", "content": "Self-attention lets each token..." }
  ]
}
```

**Re-attachment on page load:** The content script reads all stored threads for the current conversation ID, hashes each rendered paragraph, and matches them to stored threads. Falls back to index-based lookup if no hash match is found.

**Why hash over text prefix:** Fixed size, collision-resistant, no truncation edge cases. All-or-nothing match is acceptable because Claude's generated text doesn't change after rendering.

---

## UX Behaviour

| Scenario | Behaviour |
|---|---|
| Hover over paragraph | 💬 icon fades in to the right |
| Click 💬 (no thread yet) | Sidebar opens with empty thread, reply input focused |
| Click 💬 (thread exists) | Sidebar opens showing existing thread history |
| Click 💬 on different paragraph | Sidebar switches to that paragraph's thread |
| Send reply in sidebar | Request fires, response streams into sidebar, turn saved to storage |
| Page refresh | Threads re-attached via hash matching; badges restored |
| Response still streaming | Icons not injected until streaming completes |

---

## Out of Scope

- Support for ChatGPT, Gemini, or other chatbot UIs
- Text-selection-based triggering (paragraph-level only)
- Merging threads back into the main chat
- Multi-device thread sync
- Firefox support (can be a follow-up port)
