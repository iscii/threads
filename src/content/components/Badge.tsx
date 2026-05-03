import { useComputed } from '@preact/signals'
import { threads, summaryStatus } from '../lib/threads'
import { highWaterMarks } from '../lib/summaryStore'

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

function BookmarkIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 11 11" fill="none">
      <path
        d="M2 1h7v9.5l-3.5-2.5L2 10.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

export function Badge() {
  const count = useComputed(() => threads.value.filter(t => t.messages.length > 0).length)
  const dirtyCount = useComputed(() =>
    threads.value.filter(
      t => t.included && t.messages.length > (highWaterMarks.value[t.blockId] ?? 0),
    ).length,
  )
  const isSummarizing = useComputed(() => summaryStatus.value === 'summarizing')
  const bookmarkState = useComputed<'loading' | 'dirty' | 'ready'>(() => {
    if (isSummarizing.value) return 'loading'
    if (dirtyCount.value > 0) return 'dirty'
    return 'ready'
  })

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
      <div
        class={`thr-chain-btn ${bookmarkState.value}`}
        title={
          bookmarkState.value === 'loading'
            ? 'Summarizing threads…'
            : bookmarkState.value === 'dirty'
            ? `${dirtyCount.value} thread${dirtyCount.value !== 1 ? 's' : ''} pending summary`
            : 'Thread summaries ready'
        }
      >
        {bookmarkState.value === 'loading'
          ? <span class="thr-spinner" />
          : <BookmarkIcon filled={bookmarkState.value === 'ready'} />
        }
      </div>
    </div>
  )
}
