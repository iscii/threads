import { useRef, useEffect } from 'preact/hooks'
import { useComputed } from '@preact/signals'
import { activeId, setActive, setIncluded, closeThread } from '../lib/threads'
import { ThreadExchange } from './ThreadExchange'
import type { Thread } from '../lib/threads'

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
          />
          <button
            class="tp-btn tp-close"
            title="Close thread"
            aria-label="Close thread"
            onClick={() => closeThread(thread.id)}
          />
        </div>
      </div>
      <ThreadExchange thread={thread} />
    </div>
  )
}
