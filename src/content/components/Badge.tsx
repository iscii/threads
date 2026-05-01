import { useComputed } from '@preact/signals'
import { threads, summaryStatus } from '../lib/threads'

function ChatBubbleIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M7 1C3.686 1 1 3.239 1 6c0 1.48.67 2.814 1.75 3.75L2 12l2.5-1.25C5.269 11.222 6.118 11.4 7 11.4c3.314 0 6-2.239 6-5S10.314 1 7 1z"
        fill="currentColor"
      />
    </svg>
  )
}

function ChainIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      style={spinning ? { animation: 'spin 1s linear infinite' } : undefined}
    >
      <path
        d="M5 7a2 2 0 0 0 2 2h2a2 2 0 1 0 0-4H8m-1 0H5a2 2 0 1 0 0 4h1"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

export function Badge() {
  const count = useComputed(() => threads.value.length)
  const includedCount = useComputed(
    () => threads.value.filter(t => t.included && t.messages.length > 0).length,
  )

  return (
    <div class="thr-badge-zone">
      {count.value > 0 && (
        <button
          class="thr-count-btn"
          title={`${count.value} open thread${count.value !== 1 ? 's' : ''}`}
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
          <ChainIcon spinning={summaryStatus.value === 'summarizing'} />
        </button>
      )}
    </div>
  )
}
