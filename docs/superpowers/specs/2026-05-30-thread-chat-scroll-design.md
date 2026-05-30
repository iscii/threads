# Thread Chat Scroll — Design Spec
**Date:** 2026-05-30

## Overview

Three related improvements to the thread panel's message area:
1. Autoscroll on new messages/responses (with different rules per sender)
2. A floating "scroll to bottom" arrow button above the input row
3. `scrollbar-gutter: stable` on the message container to prevent layout shift

All changes are confined to `ThreadExchange.tsx` and `content.css`.

---

## Behavior

### Autoscroll rules
- **User sends a prompt:** always scroll to bottom, regardless of current scroll position. Triggered directly in `submit()` before enqueueing the message.
- **Response arrives / streaming update:** scroll to bottom only if `atBottom` is `true` (user is within ~8px of the bottom).

### "Scroll to bottom" button
- Visible only when `atBottom` is `false`.
- Positioned absolutely inside `.tp-body`, centered horizontally, just above the `.tp-input-row` top border.
- Clicking it scrolls to the bottom and immediately sets `atBottom` back to `true`.
- Small circle button with a chevron-down SVG icon, styled to match the existing `tp-btn` system (same background, border, hover states).

---

## Implementation — `ThreadExchange.tsx`

### New state & refs (in `ThreadExchange`)
```ts
const msgsRef = useRef<HTMLDivElement>(null)
const [atBottom, setAtBottom] = useState(true)
const atBottomRef = useRef(true)   // ref kept in sync so effects read current value without stale closure
```

### Scroll helper
```ts
const scrollToBottom = () => {
  const el = msgsRef.current
  if (el) el.scrollTop = el.scrollHeight
}
```

### Scroll listener
```ts
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
```

### Autoscroll effect (responses + streaming)
Uses `atBottomRef.current` (not state) to avoid stale closure — the effect runs on message/typing changes, not scroll changes.
```ts
useEffect(() => {
  if (atBottomRef.current) scrollToBottom()
}, [thread.messages.length, thread.isTyping])
```

### `submit()` change
Call `scrollToBottom()` unconditionally after enqueueing:
```ts
const submit = () => {
  const content = text.trim()
  if (!content || thread.isTyping) return
  setText('')
  void sendThreadReply(thread.id, content)
  scrollToBottom()
}
```

### Floating button render (inside `.tp-body`, before `<ThreadInput>`)
```tsx
{!atBottom && (
  <button
    class="tp-scroll-btn"
    onClick={() => { scrollToBottom(); setAtBottom(true) }}
    aria-label="Scroll to bottom"
  >
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5"
            strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  </button>
)}
```

---

## Implementation — `content.css`

### `.tp-msgs` — prevent scrollbar layout shift
```css
scrollbar-gutter: stable;
```

### `.tp-body` — enable absolute positioning of button
```css
position: relative;
```

### `.tp-scroll-btn` — floating chevron button
```css
.tp-scroll-btn {
  position: absolute;
  bottom: 44px;        /* sits above the ~44px input row */
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

---

## Files changed
- `src/content/components/ThreadExchange.tsx` — scroll state, effects, button render
- `src/styles/content.css` — `.tp-msgs` gutter, `.tp-body` position, `.tp-scroll-btn`

## Files NOT changed
- `Thread.tsx`, `App.tsx`, signals, hooks — scroll state is fully local to `ThreadExchange`
- No new files needed
