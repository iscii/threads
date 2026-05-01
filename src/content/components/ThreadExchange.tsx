import { useRef, useState } from 'preact/hooks'
import { useSignalEffect } from '@preact/signals'
import { threads } from '../lib/threads'
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

function ThreadInput({ thread }: { thread: Thread }) {
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
        class="tp-input"
        placeholder="Reply…"
        value={text}
        onInput={e => setText((e.target as HTMLInputElement).value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
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

export function ThreadExchange({ thread }: { thread: Thread }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useSignalEffect(() => {
    threads.value
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  })

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
      <ThreadInput thread={thread} />
    </div>
  )
}
