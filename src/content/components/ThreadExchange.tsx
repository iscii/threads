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

  // Autoscroll when a message is added or the typing indicator changes — only if already at bottom.
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
