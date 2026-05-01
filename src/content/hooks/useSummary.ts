import type { NetworkAdapter } from '@/types'
import type { Thread } from '../lib/threads'
import { summaryStatus, endpointInfo } from '../lib/threads'
import { dirtyThreads, advanceMarks, enqueue, drainQueue } from '../lib/summaryStore'
import { accumulateSSE } from '../lib/accumulateSSE'
import { MSG } from '@/messaging'

let _networkAdapter: NetworkAdapter | null = null

export function initSummary(networkAdapter: NetworkAdapter): void {
  _networkAdapter = networkAdapter
}

function buildSummarizationPrompt(dirty: Thread[]): string {
  const blocks = dirty.map(t => {
    const exchanges: string[] = []
    for (let i = 0; i + 1 < t.messages.length; i += 2) {
      exchanges.push(`Q: ${t.messages[i].content}\nA: ${t.messages[i + 1].content}`)
    }
    return `Thread on: "${t.blockText}"\nNew exchanges:\n${exchanges.join('\n')}`
  })

  return [
    'Summarize the following thread exchanges from a Claude.ai conversation sidebar.',
    'For each thread, write one sentence: "on [topic], [summary]."',
    'Output only the sentences, no preamble.',
    '',
    ...blocks,
  ].join('\n')
}

export async function triggerSummarization(): Promise<void> {
  const na = _networkAdapter
  const info = endpointInfo.value
  if (!na || !info) return

  const dirty = dirtyThreads()
  if (dirty.length === 0) return

  const prompt = buildSummarizationPrompt(dirty)
  const body = na.buildCompletion(info.body, prompt, 'claude-haiku-4-5-20251001')

  summaryStatus.value = 'summarizing'

  try {
    const res = await fetch(info.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const text = await accumulateSSE(res)
    enqueue({
      text,
      coveredTurnCounts: Object.fromEntries(dirty.map(t => [t.blockId, t.messages.length])),
      generatedAt: Date.now(),
    })
    advanceMarks()
    window.postMessage(
      { type: MSG.STAGE_SUMMARY, summaryTexts: drainQueue().map(i => i.text) },
      location.origin,
    )
    summaryStatus.value = 'included'
  } catch {
    summaryStatus.value = 'idle'
  }
}
