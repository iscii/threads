# Design: Fix Extension Branch Pollution (Bug #15)

**Date:** 2026-05-24
**Status:** Approved

## Problem

Every extension-originated fetch to Claude.ai's `/completion` endpoint (thread replies via `sendThreadReply`, summarization via `triggerSummarization`) creates a real branch in the server-side conversation tree. Claude.ai's React app GETs `?tree=True&consistency=eventual` after each streaming completion and re-renders based on `current_leaf_message_uuid`. Because the extension's branch is the last completed branch, the server returns it as `current_leaf`, replacing the real user conversation in the UI.

Root cause: extension requests use native `fetch` (isolated world), bypassing the fetch watcher, so they create real conversation branches with no mechanism to suppress them from the UI.

## Approach: Tag + Strip + Track

All extension prompts are tagged at the source. The fetch watcher's `history.filter` strips tagged message pairs from the conversation response and overrides a stale `current_leaf`. The SSE reader tracks the real `lastKnownRealLeaf` UUID from `message_start` events. DOM cleanup removes any tagged content that slips through.

## Section 1: Tagging Scheme

A new constant `THR_EXT_MARKER = '<threads-ext-marker/>'` is added to `src/messaging.ts`.

All extension-originated prompts prepend this marker:

```
<threads-ext-marker/>

You are a summarization assistant...
```

Applies to:
- `buildSummarizationPrompt()` in `src/content/hooks/useSummary.ts`
- Thread reply prompt construction in `src/content/hooks/useQueue.ts`

The marker is placed at the very start of the prompt string so detection is a cheap `startsWith` check. The server stores the raw prompt in its conversation tree, making the tag available to `history.filter` via the GET response.

## Section 2: `history.filter` — Strip Tagged Messages + Fix `current_leaf`

`claudeAdapter.history.filter()` in `src/platforms/claude/network.ts` is extended:

1. **Identify tagged pairs**: Walk `chat_messages` looking for human messages whose `content[].text` starts with `<threads-ext-marker/>`. For each, collect its UUID and the UUID of the immediately following assistant message in the same branch (the message whose `parent_message_uuid` equals the tagged human message's UUID).

2. **Strip pairs**: Filter both the tagged human message and its paired assistant message out of `chat_messages` before returning to Claude.ai.

3. **Fix `current_leaf`**: If `current_leaf_message_uuid` points to any stripped message UUID, override it with `lastKnownRealLeaf` from the fetch watcher. `lastKnownRealLeaf` is passed into `history.filter` as a parameter (or via a getter closure — implementation detail resolved at plan time).

Edge cases:
- Tagged human message with no paired assistant (mid-stream stop): strip the human message only; don't crash.
- Multiple tagged pairs in one response: strip all of them.
- `current_leaf` points to a non-stripped message: leave it unchanged.

## Section 3: Tracking `lastKnownRealLeaf` via SSE `message_start`

`lastKnownRealLeaf` is a module-level variable in `src/fetch-watcher/core.ts`, initialized to `null`.

Before teeing the response body, a flag is set:

```ts
const isExtensionRequest = typeof body?.prompt === 'string' &&
  body.prompt.startsWith('<threads-ext-marker/>')
```

The `s2` reader loop (already scanning for `[DONE]`) is extended to parse SSE events. The first `data:` line is parsed as JSON. If `parsed.type === 'message_start'` and `!isExtensionRequest`, `lastKnownRealLeaf` is updated with `parsed.message.uuid`.

Extension requests (`isExtensionRequest === true`) do NOT update `lastKnownRealLeaf`, ensuring the variable always holds the UUID of the last real assistant message.

`lastKnownRealLeaf` is accessible to `history.filter` because both live in the same `createFetchWatcher` closure.

## Section 4: DOM Cleanup (Defense-in-Depth)

In `src/content/lib/observer.ts`, before normal instrumentation:

- In `instrumentTurn()`: check `element.textContent?.includes('<threads-ext-marker/>')`. If true, call `element.remove()` and return — do not add to `instrumented`.
- In the `data-is-streaming` attribute mutation handler (turn finished streaming): same check + remove.

This catches any tagged content that renders during the window between a summarization completing and the next filtered GET response arriving. No new MutationObserver needed.

## Section 5: Testing

**Unit: `src/platforms/claude/network.test.ts`**
- `history.filter` strips tagged human+assistant pairs from `chat_messages`
- `history.filter` overrides `current_leaf_message_uuid` when pointing to a stripped message
- `history.filter` leaves `current_leaf_message_uuid` unchanged when pointing to a real message
- Tagged message with no paired assistant (mid-stream stop) does not crash the filter
- Multiple tagged pairs are all stripped

**Unit: `src/fetch-watcher/core.test.ts`**
- `lastKnownRealLeaf` updates on `message_start` for non-extension requests
- `lastKnownRealLeaf` does NOT update on `message_start` for extension requests (marker present)
- `isExtensionRequest` correctly detected from prompt prefix

**Integration (Playwright)**
- Send a thread reply, then a main chat message — verify `current_leaf` in the filtered GET response matches the main chat assistant UUID
- Verify no `<threads-ext-marker/>` text is visible anywhere in the rendered DOM after summarization completes

## Files Changed

| File | Change |
|------|--------|
| `src/messaging.ts` | Add `THR_EXT_MARKER` constant |
| `src/content/hooks/useSummary.ts` | Prepend marker in `buildSummarizationPrompt()` |
| `src/content/hooks/useQueue.ts` | Prepend marker in thread reply prompt |
| `src/fetch-watcher/core.ts` | Track `lastKnownRealLeaf` from `message_start`; set `isExtensionRequest` flag |
| `src/platforms/claude/network.ts` | Extend `history.filter` to strip tagged pairs + fix `current_leaf` |
| `src/content/lib/observer.ts` | DOM cleanup check before instrumentation |
| `src/platforms/claude/network.test.ts` | Unit tests for filter logic |
| `src/fetch-watcher/core.test.ts` | Unit tests for `lastKnownRealLeaf` tracking |
