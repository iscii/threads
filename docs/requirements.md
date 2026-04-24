# Thread — Extension Requirements

## What It Is

A Chrome extension for Claude.ai that lets users reply to individual paragraphs in Claude's responses, similar to Google Docs comments. Threads are anchored to paragraphs, persist across page refreshes, and live in a sidebar without touching the main chat.

## Current Behavior

**Paragraph icons**
- A `💬` icon appears on hover beside each paragraph after a response finishes streaming
- Icons are not injected while a response is still streaming
- Paragraphs with existing threads show a count badge (e.g. `💬 2`)

**Sidebar**
- Clicking `💬` opens a right sidebar showing the thread for that paragraph
- The referenced paragraph is quoted at the top of the sidebar
- Thread turns stream in real time; user and assistant turns are visually distinct
- Clicking a different paragraph switches the sidebar to that thread
- Closing the sidebar restores the page layout

**Thread replies**
- Replies are sent to Claude using the same API endpoint Claude.ai uses (captured via `window.fetch` interception)
- Each request includes the full main conversation history plus the thread's prior turns, framed with: *"Focusing on this specific part of your response: '[paragraph text]'"*
- Fresh `turn_message_uuids` are generated per request to avoid 409 conflicts

**Persistence**
- Threads are stored in `chrome.storage.local` keyed by `threads:{convId}:{responseIdx}:{paragraphHash}`
- Paragraph identity uses SHA-256 of the paragraph text (16-char hex)
- On page load and SPA navigation, badges are restored by matching stored hashes to rendered paragraphs
- SPA navigation is detected by patching `history.pushState/replaceState`

## Planned Feature: Thread Context Injection

**Problem:** Thread exchanges are invisible to the main chat. If a user clarifies something in a thread then continues the main conversation, Claude has no memory of the thread exchange.

**Solution:** When the user begins typing in the main chat input, the extension silently generates a summary of unsummarized thread exchanges and prepends it to the user's outgoing message.

**Behavior**
- On first keystroke in the main input, collect all threads with turns added since the last summary
- Fire a background summarization request (Haiku, same authenticated session) with existing summary + new thread content
- If summary is ready when user hits Send, prepend it to the outgoing message body via fetch interception; if not ready, send without it
- Summary is persisted in storage as `summary:{convId}` with the turn counts that were covered
- On subsequent keystrokes, only dirty threads (new turns since last summary) trigger a new summarization call; clean threads reuse the cached summary text
- If the user abandons a draft and returns, the cached summary is reused — no redundant API call unless new thread turns exist

**Summary storage shape**
```json
{
  "text": "...",
  "coveredTurnCounts": { "threads:abc:0:a3f9...": 2 },
  "generatedAt": 1714000000000
}
```
