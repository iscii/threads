import { useComputed } from '@preact/signals'
import { threads, summaryStatus } from '../lib/threads'

function ChatBubbleIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none">
      <path
        d="M3 1.5h6a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5H4.5L2 11V3a1.5 1.5 0 0 1 1.5-1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

function BookmarkIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
      <path
        d="M2 1h7v9.5l-3.5-2.5L2 10.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Badge() {
  const count = useComputed(() => threads.value.filter(t => t.messages.length > 0).length)
  const includedCount = useComputed(
    () => threads.value.filter(t => t.included && t.messages.length > 0).length,
  )

  return (
    <div class="thr-badge-zone">
      {count.value > 0 && (
        <button
          class="thr-count-btn"
          title={`${count.value} thread${count.value !== 1 ? 's' : ''} with messages`}
        >
          <ChatBubbleIcon />
          <span>{count.value}</span>
        </button>
      )}
      {(includedCount.value > 0 || summaryStatus.value !== 'idle') && (
        <button
          class={`thr-chain-btn ${summaryStatus.value}`}
          title={
            summaryStatus.value === 'summarizing'
              ? 'Summarizing threads…'
              : `${includedCount.value} thread summaries included`
          }
        >
          <BookmarkIcon />
        </button>
      )}
    </div>
  )
}
