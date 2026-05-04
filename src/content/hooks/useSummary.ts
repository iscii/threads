import type { NetworkAdapter } from '@/types'
import type { Thread } from '../lib/threads'
import { summaryStatus, endpointInfo } from '../lib/threads'
import {
  dirtyThreads,
  advanceMarks,
  enqueue,
  drainQueue,
  coveredCount,
  threadSummary,
} from '../lib/summaryStore'
import { accumulateSSE } from '../lib/accumulateSSE'
import { sameOriginURL } from '../lib/endpoint'

let _networkAdapter: NetworkAdapter | null = null

export function initSummary(networkAdapter: NetworkAdapter): void {
  _networkAdapter = networkAdapter
  // syncronous custom window event for summary queue draining in fetch watcher
  window.addEventListener('drainSummaries', () => {
    drainQueue()
  })
}

function buildSummarizationPrompt(dirty: Thread[]): string {
  const blocks = dirty.map(t => {
    const previous = threadSummary(t.blockId)
    const start = Math.min(coveredCount(t.blockId), t.messages.length)
    const newMessages = t.messages
      .slice(start)
      .map(m => `${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`)
      .join('\n')

    return [
      `Thread id: ${JSON.stringify(t.blockId)}`,
      `Thread on: ${JSON.stringify(t.blockText)}`,
      previous ? `Existing summary: ${previous}` : 'Existing summary: none',
      `New messages:\n${newMessages}`,
    ].join('\n')
  })

  return [
    'Update summaries for Claude.ai conversation sidebar threads.',
    'Emphasize the new messages while preserving relevant prior summary context.',
    'Return only a JSON object whose keys are thread ids and whose values are one-sentence summaries.',
    '',
    ...blocks,
  ].join('\n')
}

function parseThreadSummaries(text: string, dirty: Thread[]): Record<string, string> | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) return null

  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    const record = parsed as Record<string, unknown>
    const summaries: Record<string, string> = {}
    for (const t of dirty) {
      const summary = record[t.blockId]
      if (typeof summary !== 'string' || summary.trim().length === 0) return null
      summaries[t.blockId] = summary.trim()
    }
    return summaries
  } catch {
    return null
  }
}

export async function triggerSummarization(): Promise<void> {
  const na = _networkAdapter
  const info = endpointInfo.value
  if (!na || !info) return

  const endpointURL = sameOriginURL(info.url)
  if (!endpointURL) return

  const dirty = dirtyThreads()
  if (dirty.length === 0) return

  const prompt = buildSummarizationPrompt(dirty)
  const body = na.buildCompletion(info.body, prompt, 'claude-haiku-4-5-20251001')

  summaryStatus.value = 'summarizing'

  try {
    const res = await fetch(endpointURL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        ...info.headers,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await accumulateSSE(res)
    const summaries = parseThreadSummaries(text, dirty)
    const queueText = summaries ? Object.values(summaries).join('\n') : text
    enqueue({
      text: queueText,
      coveredTurnCounts: Object.fromEntries(dirty.map(t => [t.blockId, t.messages.length])),
      generatedAt: Date.now(),
    })
    window.dispatchEvent(new CustomEvent('summaryEnqueued', { detail: { text: queueText } }))
    advanceMarks(summaries ?? {})
  } catch {
    // swallow — dirty threads remain for next attempt
  } finally {
    summaryStatus.value = 'idle'
  }
}
