# Handoff: Threads — Inline Chat Extension

## Overview

"Threads" is a UI extension for AI chat interfaces (modeled on Claude's UI) that lets users open a focused sub-conversation on any individual paragraph in an assistant response. Threads are modeled after Google Docs inline comments: they float in the right margin, anchored to their source paragraph, and can be chatted in independently. Thread context can optionally be summarized back into the main chat.

---

## About the Design Files

The files in this bundle (`Threads.html`) are **high-fidelity HTML prototypes** — fully interactive, pixel-close references showing intended look and behavior. They are **not** production code to copy directly.

Your task is to **recreate these designs in your existing browser extension codebase**, using your established patterns, component libraries, and build system. The HTML uses React + inline Babel for speed of iteration — your implementation should use whatever stack your extension already uses (React, Vue, vanilla JS with Shadow DOM, etc.).

---

## Fidelity

**High-fidelity.** Colors, typography, spacing, animations, and interaction states are all final and should be matched closely. The prototype uses Claude's dark theme as the base.

---

## Design Tokens

```
Background levels:
  --bg:      #1a1a1a   (page background)
  --bg2:     #212121   (card / panel background)
  --bg3:     #282828   (input fields, user bubbles, hover fill)

Borders:
  --border:  #2c2c2c   (subtle dividers)
  --border2: #363636   (card outlines, button borders)

Text:
  --text:    #e3e3e3   (primary)
  --text2:   #9a9a9a   (secondary / assistant thread replies)
  --text3:   #5e5e5e   (placeholder, labels, muted)

Accent (thread amber):
  --accent:  #c98a52
  --adim:    rgba(201, 138, 82, 0.11)   (accent tinted backgrounds)
  --aborder: rgba(201, 138, 82, 0.22)   (accent tinted borders)

Border radius:
  Panel / card:  10px
  Buttons:       6–8px
  User bubble:   18px 18px 4px 18px (asymmetric)
  Thread bubble: 10px 10px 2px 10px (asymmetric)

Typography:
  Font: Inter (400, 500 italic); fallback: -apple-system, BlinkMacSystemFont, sans-serif
  Base size: 15px / line-height 1.68
  Thread messages: 13px / 1.52
  Labels / tooltips: 11.5px

Shadows:
  Thread panel idle:   0 6px 28px rgba(0,0,0,0.42)
  Thread panel active: 0 6px 28px rgba(0,0,0,0.50), 0 0 0 1px var(--aborder)

Transitions:
  Panel top position:  top 0.28s cubic-bezier(0.4, 0, 0.2, 1)
  Hover/color:         0.12–0.15s ease
  Panel mount:         opacity + translateY(-8px) → (0) over 0.17s ease
```

---

## Layout

The chat view uses a two-column flex layout:

```
┌──────────────────────────────────────────────────────────────────┐
│  Header (44px)                            [chain icon] [N 💬] Share │
├────────────────────────────────────────┬─────────────────────────┤
│  Chat column (580px, centered-ish)     │  Thread zone (308px)    │
│                                        │  (thread panels here)   │
│  - User messages: right-aligned pill   │                         │
│  - AI messages: left, hoverable blocks │                         │
│                                        │                         │
└────────────────────────────────────────┴─────────────────────────┘
│  Fixed input bar (580px centered)                                │
└──────────────────────────────────────────────────────────────────┘
```

- `content-grid`: `display: flex; justify-content: center; gap: 20px; padding: 0 32px 180px`
- `chat-col`: `width: 580px; flex-shrink: 0; position: relative`
- `thread-zone`: `width: 308px; flex-shrink: 0; position: relative`
- Thread panels are `position: absolute` children of `.thread-zone`, with `top` computed dynamically (see Positioning below)

---

## Screens / Views

### 1. Main Chat View

The main chat is a standard Claude-style dark chat. Each **assistant response** is broken into individual paragraph **blocks** (divs), each of which is independently hoverable and thread-able.

**User message bubble:**
- Right-aligned flex row
- Bubble: `background: #282828; border-radius: 18px 18px 4px 18px; padding: 10px 16px; max-width: 76%; font-size: 15px`

**Assistant block (hoverable paragraph):**
- `position: relative; padding: 6px 36px 6px 10px; margin: 0 0 1px -10px; border-radius: 7px; border-left: 2px solid transparent`
- On hover: `background: rgba(255,255,255,0.03)`
- When thread exists (`.lit`): `background: rgba(201,138,82,0.04); border-left-color: #c98a52`
- When thread is active (`.lit.active-thread`): same as `.lit`

**Thread trigger button** (appears on block hover, hidden otherwise):
- `position: absolute; right: 6px; top: 50%; transform: translateY(-50%)`
- `width: 24px; height: 24px; border-radius: 6px`
- `background: #282828; border: 1px solid #363636; color: #5e5e5e`
- On hover: `color: #c98a52; background: rgba(201,138,82,0.11); border-color: rgba(201,138,82,0.22)`
- Icon: speech bubble SVG (12×12)
- `opacity: 0; pointer-events: none` by default; `opacity: 1; pointer-events: all` on parent hover

**Thread dot indicator** (when thread already exists, inline in paragraph text):
- `display: inline-flex; width: 15px; height: 15px; border-radius: 50%`
- `background: rgba(201,138,82,0.11); border: 1px solid rgba(201,138,82,0.22); color: #c98a52`
- Rendered inline after the paragraph text, `vertical-align: middle`
- Clicking it reopens the thread panel

---

### 2. Thread Panel

Floats in the right margin, anchored to a specific block.

**Panel container:**
- `width: 296px; background: #212121; border: 1px solid #363636; border-radius: 10px`
- Box shadow (idle): `0 6px 28px rgba(0,0,0,0.42)`
- Box shadow (active): `0 6px 28px rgba(0,0,0,0.50), 0 0 0 1px rgba(201,138,82,0.22)`
- Border color (active): `rgba(201,138,82,0.22)`
- Active panel: `z-index: 10`; others: `z-index: 1`
- Left-pointing arrow caret (CSS `::before`): `border-right: 9px solid #363636` at `left: -9px; top: 18px`; active state: `border-right-color: rgba(201,138,82,0.22)`

**Mount animation:** `opacity: 0; transform: translateY(-8px)` → `opacity: 1; transform: translateY(0)` over `0.17s ease`

**Header:**
- `padding: 10px 10px 8px 12px; border-bottom: 1px solid #2c2c2c`
- Quoted anchor text: `font-size: 11.5px; color: #5e5e5e; font-style: italic; line-clamp: 2`
- Action buttons (22×22px, border-radius 4px): include/exclude toggle + close

**Include/exclude toggle:**
- Included: chain-link SVG, color `#c98a52`
- Excluded: chain-link SVG with diagonal strikethrough, color `#5e5e5e`
- Tooltip: "Exclude from main chat summary" / "Include in main chat summary"

**Messages list:**
- `padding: 10px 12px 6px; max-height: 230px; overflow-y: auto; gap: 8px`
- User msg: `align-self: flex-end; background: #282828; border-radius: 10px 10px 2px 10px; padding: 6px 10px; max-width: 88%; color: #e3e3e3; font-size: 13px`
- Assistant msg: `color: #9a9a9a; font-size: 13px`
- Typing indicator: 3 dots, bounce animation (5×5px, `#5e5e5e`, stagger 0.2s)

**Input row:**
- `padding: 8px 10px; border-top: 1px solid #2c2c2c; display: flex; gap: 8px`
- Input: `background: none; border: none; color: #e3e3e3; font-size: 13px; placeholder color: #5e5e5e`
- Send button: `width: 26px; height: 26px; border-radius: 6px; background: #c98a52; color: white`
- Send disabled: `background: #363636; opacity: 0.5`

---

### 3. Header Bar

`height: 44px; border-bottom: 1px solid #2c2c2c; padding: 0 20px`

**Thread count button** (comment bubble icon + number):
- Appears when `threads.length > 0`
- `height: 28px; border-radius: 7px; padding: 0 9px; font-size: 12px; font-weight: 500`
- Icon: chat bubble SVG (12×12), then count number
- Hover: `background: #282828; color: #9a9a9a`
- Tooltip: "N open threads"

**Summary status icon** (chain-link, separate from thread count):
- Appears when `includedCount > 0` or `status === 'summarizing'`
- Idle/included: chain-link SVG, `color: #c98a52`
- Summarizing: spinning ring (`border: 1.5px solid rgba(201,138,82,0.3); border-top-color: #c98a52; animation: spin 0.7s linear infinite`)
- Tooltip: "N thread summaries included in context" / "Summarizing threads…"

---

## Interactions & Behavior

### Opening a thread
1. User hovers over an assistant paragraph block → thread trigger button fades in at `opacity: 1`
2. User clicks trigger button → a new thread is created for that block, panel appears in thread zone
3. If a thread already exists for that block (closed), clicking the inline dot reopens it

### Thread panel focus
- Clicking/mousedown on any panel sets it as active (`z-index: 10`, amber border glow)
- Clicking elsewhere in the app deactivates all panels

### Closing a thread
- If thread has **no messages**: removed entirely from state
- If thread has **messages**: `isOpen: false`; panel hides but thread dot stays on the block for reopening

### Thread chat (AI responses)
- On send: add user message, set `isTyping: true`, call AI API
- System prompt for thread AI: *"You are a concise assistant in a threaded discussion. Reply in 1–3 sentences maximum. Do not repeat or quote the passage. Passage being discussed: '[blockText]'"*
- On response: add assistant message, set `isTyping: false`
- Auto-scroll thread messages to bottom on new messages

### Thread panel positioning (collision resolution)
Thread panels are `position: absolute` in the thread zone. Position = `offsetTop` of the anchor block relative to the chat column. When panels would overlap:

1. Sort open panels by natural top position
2. **Pass 1 (greedy push-down):** iterate top-to-bottom; each panel sits at `max(naturalTop, prevBottom + 10px)`
3. **Pass 2 (center groups):** find contiguous groups of displaced panels; for each group, center the stack around the midpoint of the group's natural position range (allows top panel to slide upward)
4. Minimum top: `0`
5. Recompute on every render; animate via CSS `transition: top 0.28s cubic-bezier(0.4, 0, 0.2, 1)`

Panel heights must be measured from live DOM (via ref) to compute positions correctly.

### Main chat + thread summarization
- When user sends a main message and there are `included` threads with messages:
  1. Set `summaryStatus = 'summarizing'` (shows spinning chain icon in header)
  2. Wait ~1.8s (or actual API time)
  3. Set `summaryStatus = 'included'` (shows solid amber chain icon)
- Include/exclude toggle (`isIncluded` boolean per thread) controls which threads are summarized
- Thread context is prepended to the main chat prompt when calling the AI

---

## State Shape

```ts
type Block = {
  id: string;
  text: string;
};

type Message = {
  id: number;
  role: 'user' | 'assistant';
  // user messages have content: string
  // assistant messages have blocks: Block[]
  content?: string;
  blocks?: Block[];
};

type Thread = {
  id: number;
  blockId: string;           // which block this thread is anchored to
  blockText: string;         // truncated (max 130 chars + ellipsis)
  messages: { role: 'user' | 'assistant'; content: string }[];
  included: boolean;         // whether to include in main chat summary
  isTyping: boolean;
  isOpen: boolean;           // false = closed but preserves messages
};

type SummaryStatus = 'idle' | 'summarizing' | 'included';
```

---

## Extension-Specific Implementation Notes

Since this is a **browser extension**, a few things to consider when porting:

1. **Shadow DOM / style isolation** — If your extension injects into existing pages, use Shadow DOM or scoped CSS to avoid conflicts with the host page's styles. The thread panel and block hover styles in particular need to be scoped.

2. **Block segmentation** — In production, you'll need to detect paragraph boundaries in the AI response. The prototype splits on double newlines. In a real implementation, parse the rendered DOM of the response to find block-level elements (`<p>`, `<li>`, etc.) and attach hover listeners to each.

3. **Thread zone injection** — The thread zone is a fixed-width column to the right of the chat. In an extension context, you may need to inject a container div alongside the chat column and shift the chat column leftward to make room. Test across viewport widths.

4. **AI API** — Thread replies use a concise system prompt (1–3 sentences). The main chat summarization prepends thread context to the user's message. The exact prompt is in `Threads.html` → `sendInThread` and `sendMain` functions.

5. **Position updates** — Panel positions must recompute on scroll and on window resize, not just on state changes.

---

## Files in This Package

| File | Description |
|------|-------------|
| `Threads.html` | Full interactive prototype — the design reference. Open in a browser at 1440px+ width. |
| `README.md` | This document. |
