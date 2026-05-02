import type { RefObject } from 'preact'
import { useRef, useState } from 'preact/hooks'
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

function ThreadInput({ thread, inputRef }: { thread: Thread; inputRef?: RefObject<HTMLInputElement> }) {
  const [text, setText] = useState('')

  const submit = () => {
    const content = text.trim()
    if (!content || thread.isTyping) return
    setText('')
    void sendThreadReply(thread.id, content)
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

export function ThreadExchange({ thread, inputRef }: { thread: Thread; inputRef?: RefObject<HTMLInputElement> }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  return (
    <div class="tp-body">
      <div class="tp-msgs">
        {thread.messages.map((m, i) => (
          <div key={i} class={`tp-msg tp-msg--${m.role}`}>
            {m.content}
          </div>
        ))}
        {thread.isTyping && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>
      <ThreadInput thread={thread} inputRef={inputRef} />
    </div>
  )
}
