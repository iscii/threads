# Thread Context Injection — Design Spec
*2026-04-24*

## Overview

When the user begins typing in Claude.ai's main chat input, the extension silently summarizes unsummarized thread exchanges and prepends the summary to the outgoing message. This gives the main conversation full awareness of sidebar thread context without polluting the conversation history on the server.

## Problem

Thread exchanges are invisible to the main chat. If the user clarifies something in a sidebar thread and then continues the main conversation, Claude has no memory of it. The first message after threading goes out without context; subsequent messages suddenly include it — a confusing inconsistency.

## Solution

On first keystroke in the main input:
1. Detect dirty threads (new turns above the high-water mark, not excluded)
2. If dirty threads exist, fire a background Haiku summarization call
3. Show a badge on the input area indicating summarizing → ready
4. When the user sends, fetch-watcher prepends all queued summaries to the outgoing message body

---

## Architecture

Three files modified, no new files:

| File | Change |
|---|---|
| `content.js` | Input watcher, dirty-thread detection, Haiku summarization, summary storage, badge, exclusion toggle, `THR_STAGE_SUMMARY` postMessage |
| `fetch-watcher.js` | Listen for `THR_STAGE_SUMMARY`, rewrite last user message in outgoing body, post `THR_SUMMARY_INJECTED` |
| `sidebar.css` | Badge styles, per-thread icon styles |

### New postMessage types

| Type | Direction | Payload |
|---|---|---|
| `THR_STAGE_SUMMARY` | ISOLATED → MAIN | `{ type, summaryTexts: string[] }` |
| `THR_SUMMARY_INJECTED` | MAIN → ISOLATED | `{ type }` |

---

## The High-Water Mark

A high-water mark is a pointer recording the furthest position ever reached in an ordered sequence — like a flood mark on a wall showing peak water level. It only moves forward; everything below it has been handled.

Thread turns are append-only. New turns always land at the end; nothing is inserted or deleted. This means "unsummarized turns" is always a contiguous tail, which a single integer per thread captures completely.

```js
highWaterMark["threads:abc:0:a3f9..."] = 4
// → first 4 turns have been queued for summarization
```

**Dirty detection:**
```js
const isDirty = !thread.excluded && thread.turns.length > (highWaterMark[key] ?? 0);
```

**Getting only the new turns:**
```js
const newTurns = thread.turns.slice(highWaterMark[key] ?? 0);
```

The mark is advanced *before* the Haiku request fires — not after it completes. This prevents a second keystroke mid-flight from re-queueing the same turns.

---

## Summary Queue

Summaries accumulate in a queue rather than replacing each other. Each item covers only the turns that were dirty at the time it was built.

**Lifecycle:**
1. User threads on para A (2 turns) → types → Haiku summarizes → queue: `["on A, ..."]`
2. User adds turn 3 to para A + threads on para B → types → Haiku summarizes A's turn 3 + all of B → queue: `["on A, ...", "on A (continued), ...; on B, ..."]`
3. User sends → all queue items injected → queue wiped
4. User threads on para C → types → queue: `["on C, ..."]`

**If user sends while a summarization is in flight:**
- Inject all completed queue items → wipe queue
- In-flight result appends to the now-empty queue when it finishes
- Next keystroke: if no new dirty threads, badge shows ready immediately

**Summary format** — each queue item uses concise, keyword-led sentences:
```
on self-attention, the user asked for clarification and learned it applies per-layer.
on positional encoding, confirmed the encoding is additive not concatenated.
```

---

## Storage

### Summary storage

```
summary:{convId} → {
  "highWaterMark": { "threads:abc:0:a3f9...": 4 },
  "queue": [
    {
      "text": "on self-attention, ...",
      "coveredTurnCounts": { "threads:abc:0:a3f9...": 2 },
      "generatedAt": 1714000000000
    }
  ]
}
```

`highWaterMark` persists across SPA navigation — keyed by `convId` so it can't cross-contaminate conversations. Only in-memory state (staged summary in fetch-watcher, in-flight flag in content.js) resets on navigation. The queue also persists; if the user navigates away with items in the queue, they are waiting on return.

### Thread storage (updated)

```json
{
  "paragraphHash": "a3f9c1d2e4b78f01",
  "excluded": false,
  "turns": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

`excluded` defaults to `false` (absent = not excluded). Exclusion only affects future summarizations — turns already in a queued summary are not retroactively removed.

---

## Input Detection

content.js uses event delegation — `document.addEventListener('input', handler)` — checking if the event target is Claude.ai's compose box (`div[enterkeyhint="enter"]`). The handler short-circuits if:
- No threads exist for this conversation
- A summarization is already in flight
- All dirty threads are excluded

---

## Badge

A `<div id="thr-ctx-badge">` injected once into the compose area's parent, absolutely positioned bottom-left of the input.

| State | Appearance |
|---|---|
| Hidden | Queue empty, no dirty threads, or all dirty threads excluded |
| Summarizing | Spinner + "Summarizing threads…" |
| Ready | ✓ "Thread context ready" |
| Ready + summarizing | ✓ + spinner + hover: "New thread activity being summarized" |
| Failed | ⚠ "Summarization failed" |
| No endpoint | "Send a message first to enable thread context" |

Badge disappears on `THR_SUMMARY_INJECTED`. Reappears on next keystroke if new dirty threads exist.

---

## Per-Thread Summary Icon

A small icon at the bottom of each thread in the sidebar showing its summary state. Clicking toggles exclusion.

| State | Condition | Icon |
|---|---|---|
| Pending | `turns.length > highWaterMark[key]` and not excluded | Clock / pending |
| Summarized | `turns.length <= highWaterMark[key]` and not excluded | Checkmark |
| Excluded | `excluded: true` | Circle-slash |

**Clicking:**
- Pending or summarized → excluded (sets `excluded: true` in storage, icon updates)
- Excluded → re-included (clears `excluded`, recalculates state from highWaterMark)

Re-inclusion waits for the next main-chat keystroke to trigger summarization — it does not fire immediately.

When a thread is excluded, its `highWaterMark` entry stays unchanged. If new turns are added while excluded and the thread is later re-included, it will show as pending.

---

## Fetch-Layer Injection

fetch-watcher.js listens for `THR_STAGE_SUMMARY` and stores `stagedSummaries: string[]` locally. On the next completion POST:

- If `stagedSummaries` is non-empty:
  - **Messages format**: prepend all summaries (newline-separated) to the `content` of the last `{ role: 'user' }` entry
  - **Prompt format**: prepend to the last `\n\nHuman:` segment
  - Clear `stagedSummaries`
  - Post `THR_SUMMARY_INJECTED` to content.js
- If `stagedSummaries` is empty: forward request unmodified

If the user sends before any summary is ready, `stagedSummaries` is empty and the request goes out without context — no blocking, no error.

---

## Haiku Summarization Prompt

Uses `streamThreadReply` with the captured endpoint, overriding `model` to `claude-haiku-4-5-20251001`.

```
Summarize the following thread exchanges from a Claude.ai conversation sidebar.
Each thread is a follow-up question the user asked about a specific paragraph.
For each thread, write one sentence in the format: "on [topic keyword], [summary]."
Output only the sentences, no preamble.

Thread on: "[first 120 chars of paragraph]"
New exchanges:
Q: [user turn]
A: [assistant turn]
[repeat for each new turn pair]

[repeat block for each dirty thread]
```

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Summarization fails (network / API error) | Show "⚠ Summarization failed" badge; queue unchanged; send proceeds without new context |
| `endpointInfo` not yet captured | Show "Send a message first to enable thread context" badge; skip summarization |
| SPA nav mid-summarization | Save completed result to `summary:{originalConvId}` queue; skip badge update and staging if user has navigated away |
| Storage read/write error | Fail silently; badge stays hidden |
| User sends while in-flight | Inject existing queue; wipe queue; in-flight result appends to empty queue on completion |

---

## Out of Scope

- Showing injected summary text in the sent message bubble
- Manual "inject context now" button
- Configurable summary verbosity
- Per-turn exclusion (exclusion is per-thread only)
