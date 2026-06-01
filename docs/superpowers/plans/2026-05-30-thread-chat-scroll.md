# Thread Chat Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add autoscroll, a floating scroll-to-bottom button, and scrollbar-gutter fix to the thread chat panel.

**Architecture:** All scroll state (`atBottom`, `atBottomRef`, `msgsRef`) lives in `ThreadExchange`, which owns the scrollable message area. The floating button renders inside `.tp-body` as an absolutely-positioned overlay just above the input row. CSS gains `scrollbar-gutter: stable` on `.tp-msgs` to prevent layout shift. `ThreadInput` receives a `onSubmitScroll` callback to trigger unconditional scroll on prompt send.

**Tech Stack:** Preact, TypeScript, CSS custom properties (existing shadow DOM vars)

---

## File Map

| File | Change |
|------|--------|
| `src/styles/content.css` | Add `scrollbar-gutter: stable` to `.tp-msgs`; add `position: relative` to `.tp-body`; add `.tp-scroll-btn` styles |
| `src/content/components/ThreadExchange.tsx` | Add `ChevronDownIcon`, scroll state/refs/effects, `onSubmitScroll` prop to `ThreadInput`, floating button render |

---

### Task 1: CSS foundations — scrollbar-gutter and scroll button styles

**Files:**
- Modify: `src/styles/content.css`

- [ ] **Step 1: Add `scrollbar-gutter: stable` to `.tp-msgs` and `position: relative` to `.tp-body`**

Open `src/styles/content.css`. Find the `.tp-body` block (currently lines 128–133) and add `position: relative`:

```css
.tp-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
  position: relative;
}
```

Find the `.tp-msgs` block (currently lines 135–144) and add `scrollbar-gutter: stable` as the last property:

```css
.tp-msgs {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--border2) transparent;
  scrollbar-gutter: stable;
}
```

- [ ] **Step 2: Add `.tp-scroll-btn` styles**

Append the following block after the `.tp-input` section in `src/styles/content.css` (after the `.tp-send:disabled` rule):

```css
/* ── Scroll-to-bottom button ──────────────────────────────────────── */
.tp-scroll-btn {
  position: absolute;
  bottom: 44px;
  left: 50%;
  transform: translateX(-50%);
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--bg3);
  border: 1px solid var(--border2);
  color: var(--text3);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  pointer-events: all;
  z-index: 1;
  transition: color 0.1s ease, background 0.1s ease;
}

.tp-scroll-btn:hover {
  color: var(--text2);
  background: var(--border2);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/styles/content.css
git commit -m "style: add scrollbar-gutter and scroll-to-bottom button styles"
```

---

### Task 2: `ThreadExchange` — scroll state, effects, and floating button

**Files:**
- Modify: `src/content/components/ThreadExchange.tsx`

- [ ] **Step 1: Replace the entire file with the updated implementation**

The full updated file (every existing component preserved, new additions in place):

```tsx
import type { RefObject } from 'preact'
import { useState, useEffect, useRef } from 'preact/hooks'
import { sendThreadReply } from '../hooks/useQueue'
import type { Thread } from '../lib/threads'

function TypingIndicator() {
  return (
    <div class="tp-typing">
      <span />
      <span />
      <span />
    </div>
  )
}

function ChevronDownIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 4l4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function ThreadInput({
  thread,
  inputRef,
  onSubmitScroll,
}: {
  thread: Thread
  inputRef?: RefObject<HTMLInputElement>
  onSubmitScroll?: () => void
}) {
  const [text, setText] = useState('')

  const submit = () => {
    const content = text.trim()
    if (!content || thread.isTyping) return
    setText('')
    void sendThreadReply(thread.id, content)
    onSubmitScroll?.()
  }

  return (
    <div class="tp-input-row">
      <input
        ref={inputRef}
        class="tp-input"
        placeholder="Reply…"
        value={text}
        onInput={e => {
          e.stopPropagation()
          setText((e.target as HTMLInputElement).value)
        }}
        onKeyDown={e => {
          e.stopPropagation()
          if (e.key === 'Enter') submit()
        }}
        onKeyUp={e => e.stopPropagation()}
      />
      <button
        class="tp-send"
        disabled={!text.trim() || thread.isTyping}
        onClick={submit}
        aria-label="Send"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path
            d="M6 1v10M1 6l5-5 5 5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}

export function ThreadExchange({
  thread,
  inputRef,
}: {
  thread: Thread
  inputRef?: RefObject<HTMLInputElement>
}) {
  const msgsRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)

  const scrollToBottom = () => {
    const el = msgsRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // Track whether the user is at/near the bottom of the message list.
  // atBottomRef is kept in sync so scroll effects can read the current
  // value without a stale closure.
  useEffect(() => {
    const el = msgsRef.current
    if (!el) return
    const onScroll = () => {
      const val = el.scrollHeight - el.scrollTop - el.clientHeight < 8
      atBottomRef.current = val
      setAtBottom(val)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [])

  // Autoscroll on response/streaming updates — only if already at bottom.
  useEffect(() => {
    if (atBottomRef.current) scrollToBottom()
  }, [thread.messages.length, thread.isTyping])

  return (
    <div class="tp-body">
      <div class="tp-msgs" ref={msgsRef}>
        {thread.messages.map((m, i) => (
          <div key={i} class={`tp-msg tp-msg--${m.role}`}>
            {m.content}
          </div>
        ))}
        {thread.isTyping && <TypingIndicator />}
      </div>
      {!atBottom && (
        <button
          class="tp-scroll-btn"
          onClick={() => {
            scrollToBottom()
            atBottomRef.current = true
            setAtBottom(true)
          }}
          aria-label="Scroll to bottom"
        >
          <ChevronDownIcon />
        </button>
      )}
      <ThreadInput
        thread={thread}
        inputRef={inputRef}
        onSubmitScroll={scrollToBottom}
      />
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run existing tests to confirm nothing broke**

```bash
npx vitest run
```

Expected: all tests pass (the changed component has no existing unit tests — the test suite covers hooks and lib utilities).

- [ ] **Step 4: Commit**

```bash
git add src/content/components/ThreadExchange.tsx
git commit -m "feat: autoscroll thread chat and add scroll-to-bottom button"
```

---

### Task 3: Manual verification in the browser

**Files:** none (verification only)

Build and load the extension, then open Claude.ai and open a thread panel with several messages so the message area overflows.

- [ ] **Step 1: Build the extension**

```bash
npm run build
```

Expected: `dist/` updated with no build errors.

- [ ] **Step 2: Load in Chrome**

Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select the `dist/` folder (or reload if already loaded).

- [ ] **Step 3: Verify scrollbar-gutter fix**

Open a thread with enough messages to show a scrollbar. Scroll up so the scrollbar appears. Scroll back down so it disappears. The message content width must **not** shift when the scrollbar appears or disappears.

- [ ] **Step 4: Verify floating scroll button**

Scroll up past the bottom of the messages. A small circle button with a chevron-down icon must appear centered above the input row. Clicking it must scroll the message list to the bottom and the button must disappear.

- [ ] **Step 5: Verify autoscroll on response**

With the message list scrolled to the bottom, send a prompt. The view must stay at the bottom as the response streams in.

Scroll up while a response is streaming. The view must **not** jump back to the bottom mid-stream.

- [ ] **Step 6: Verify always-scroll on prompt send**

Scroll up to read earlier messages. Type a new prompt and hit Enter. The view must immediately scroll to the bottom (showing your sent message) regardless of prior scroll position.
