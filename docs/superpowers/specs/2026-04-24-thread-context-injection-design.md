# Thread Context Injection — Design Spec
*2026-04-24*

## Overview

When the user begins typing in Claude.ai's main chat input, the extension silently summarizes unsummarized thread exchanges and prepends the summary to the outgoing message. This gives the main conversation full awareness of sidebar thread context without polluting the conversation history on the server.

## Problem

Thread exchanges are invisible to the main chat. If the user clarifies something in a sidebar thread and then continues the main conversation, Claude has no memory of it. The first message after threading goes out without context; subsequent messages suddenly include it — a confusing inconsistency.

## Solution

On first keystroke in the main input:
1. Detect dirty threads (new turns since last summary)
2. If dirty threads exist, fire a background Haiku summarization call
3. Show a badge on the input area indicating summarizing → ready
4. When the user sends, fetch-watcher prepends the summary to the outgoing message body

---

## Architecture

Three files modified, no new files:

| File | Change |
|---|---|
| `content.js` | Input watcher, dirty-thread detection, Haiku summarization, summary storage, badge, `THR_STAGE_SUMMARY` postMessage |
| `fetch-watcher.js` | Listen for `THR_STAGE_SUMMARY`, rewrite last user message in outgoing body, post `THR_SUMMARY_INJECTED` |
| `sidebar.css` | Badge styles |

### New postMessage types

| Type | Direction | Payload |
|---|---|---|
| `THR_STAGE_SUMMARY` | ISOLATED → MAIN | `{ type, summaryText }` |
| `THR_SUMMARY_INJECTED` | MAIN → ISOLATED | `{ type }` |

---

## Input Detection

content.js uses event delegation on `document` listening for `input` events. The handler checks whether the target is Claude.ai's compose box (`div[enterkeyhint="enter"]`). It short-circuits immediately if:
- No threads exist for this conversation
- A summarization is already in flight

---

## Badge

A `<div id="thr-ctx-badge">` injected once into the compose area's parent, absolutely positioned bottom-left of the input. Removed and re-injected on SPA navigation.

| State | Appearance |
|---|---|
| Hidden | `display: none` — no threads, or after send |
| Summarizing | Spinner + "Summarizing threads…" |
| Ready | Checkmark + "Thread context ready" |
| Failed | "⚠ Summarization failed" |
| No endpoint | "Send a message first to enable thread context" |

Badge disappears on `THR_SUMMARY_INJECTED`. Reappears on next keystroke if new dirty threads exist.

---

## Summarization Flow

On first keystroke:

1. Load `summary:{convId}` and all `threads:{convId}:*` keys from storage
2. Find dirty threads: keys where `turns.length > coveredTurnCounts[key]`, or keys absent from `coveredTurnCounts`
3. **No dirty threads + cached summary exists** → post `THR_STAGE_SUMMARY` immediately, show "ready" badge. No API call.
4. **No dirty threads + no cached summary** → badge stays hidden. No API call.
5. **Dirty threads exist** → show "summarizing" badge, fire Haiku request

### Haiku request

Uses `streamThreadReply` with the captured endpoint, overriding `model` to `claude-haiku-4-5-20251001`. Prompt:

```
You are summarizing sidebar thread exchanges from a Claude.ai conversation.
Each thread is a follow-up question the user asked about a specific paragraph.
Be concise — one sentence per thread. Output a single short paragraph.

[If cached summary exists]
Existing summary: "[text]"

New thread exchanges to incorporate:
Thread on: "[first 120 chars of paragraph]"
Q: [user turn]
A: [assistant turn]
[repeat for each dirty thread]
```

### On response

Save updated summary to `summary:{convId}`:
```json
{
  "text": "Thread context: ...",
  "coveredTurnCounts": { "threads:abc:0:a3f9...": 2 },
  "generatedAt": 1714000000000
}
```

If `convIdFromUrl()` still matches the conversation that started the request: show "ready" badge, post `THR_STAGE_SUMMARY` to fetch-watcher.

If `convIdFromUrl()` does not match (user navigated away mid-flight): save the summary to storage for `originalConvId` anyway — it will be waiting when the user returns — but skip badge update and staging.

---

## Fetch-Layer Injection

fetch-watcher.js listens for `THR_STAGE_SUMMARY` and stores `stagedSummary` locally. On the next completion POST:

- If `stagedSummary` is set:
  - **Messages format**: prepend `[Thread context: {text}]\n\n` to the `content` of the last `{ role: 'user' }` entry in `messages`
  - **Prompt format**: prepend context to the last `\n\nHuman:` segment
  - Clear `stagedSummary`
  - Post `THR_SUMMARY_INJECTED` to content.js
- If `stagedSummary` is null: forward request unmodified

If the user sends before the summary is ready, `stagedSummary` is null and the request goes out without context — no blocking, no error.

---

## Storage

```
summary:{convId} → {
  text: string,
  coveredTurnCounts: { [threadStorageKey]: number },
  generatedAt: number (unix ms)
}
```

Persists across SPA navigation — keyed by `convId` so it can't cross-contaminate conversations. On SPA navigation, only in-memory state resets (staged summary in fetch-watcher, in-flight flag in content.js). The stored summary is reused as-is when the user returns; dirty-thread detection via `coveredTurnCounts` still works correctly.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Summarization fails (network / API error) | Show "⚠ Summarization failed" badge; `stagedSummary` stays null; send proceeds without context |
| `endpointInfo` not yet captured | Show "Send a message first to enable thread context" badge; skip summarization |
| SPA nav mid-summarization | Save result to `summary:{originalConvId}`; skip badge update and staging |
| Storage read/write error | Fail silently; badge stays hidden |

---

## Out of Scope

- Showing the injected summary text in the sent message bubble
- Per-thread relevance filtering (all threads for the conversation are included)
- Manual "inject context" button
- Configurable summary verbosity
