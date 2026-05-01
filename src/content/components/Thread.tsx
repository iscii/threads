import { useRef, useEffect } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import { activeId, setActive, setIncluded, closeThread } from '../lib/threads'
import { ThreadExchange } from './ThreadExchange'
import type { Thread } from '../lib/threads'

function BookmarkIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path d="M2 1h7v9.5l-3.5-2.5L2 10.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  )
}

interface ThreadPanelProps {
  thread: Thread
  top: number
  registerRef: (id: string, el: HTMLElement) => void
}

export function ThreadPanel({ thread, top, registerRef }: ThreadPanelProps) {
  const isActive = useComputed(() => activeId.value === thread.id)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current) registerRef(thread.id, ref.current)
  }, [])

  return (
    <div
      ref={ref}
      class="tp"
      data-active={String(isActive.value)}
      style={{ top: `${top}px` }}
      onMouseDown={e => {
        e.stopPropagation()
        setActive(thread.id)
      }}
    >
      <div class="tp-head">
        <span class="tp-quote">"{thread.blockText}"</span>
        <div class="tp-actions">
          <button
            class={`tp-btn${thread.included ? ' on' : ''}`}
            title={thread.included ? 'Exclude from summary' : 'Include in summary'}
            aria-label={thread.included ? 'Exclude from summary' : 'Include in summary'}
            onClick={() => setIncluded(thread.id, !thread.included)}
          >
            <BookmarkIcon />
          </button>
          <button
            class="tp-btn tp-close"
            title="Close thread"
            aria-label="Close thread"
            onClick={() => closeThread(thread.id)}
          >
            <CloseIcon />
          </button>
        </div>
      </div>
      <ThreadExchange thread={thread} />
    </div>
  )
}
