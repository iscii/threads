import { signal } from '@preact/signals'
import { threads, type Thread } from './threads'
import { summaryKey } from './keys'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('summary')

export type SummaryItem = {
  text: string
  coveredTurnCounts: Record<string, number>
  generatedAt: number
}

export type ThreadCoverage = {
  highWaterMark: number
  summary?: string
  summaryUpdatedAt?: number
}

export const threadCoverage = signal<Record<string, ThreadCoverage>>({})
export const summaryQueue = signal<SummaryItem[]>([])

function persistSummaryData(): void {
  debug.log('persisting summary data', () => ({
    coverageCount: Object.keys(threadCoverage.value).length,
    queueLength: summaryQueue.value.length,
  }))
  chrome.storage.local.set({
    [summaryKey()]: {
      threadCoverage: threadCoverage.value,
      summaryQueue: summaryQueue.value,
    },
  })
}

export function coveredCount(blockId: string): number {
  return threadCoverage.value[blockId]?.highWaterMark ?? 0
}

export function dirtyThreads(): Thread[] {
  return threads.value.filter(
    t => t.included && t.messages.length > coveredCount(t.blockId),
  )
}

export function advanceMarks(
  summaries: Record<string, string> = {},
  coveredThreads = dirtyThreads(),
): void {
  const now = Date.now()
  const updates: Record<string, ThreadCoverage> = {}
  for (const t of coveredThreads) {
    const current = threadCoverage.value[t.blockId]
    const summary = summaries[t.blockId] ?? current?.summary
    updates[t.blockId] = {
      highWaterMark: t.messages.length,
      ...(summary ? {
        summary,
        summaryUpdatedAt: summaries[t.blockId] ? now : current?.summaryUpdatedAt,
      } : {}),
    }
  }
  threadCoverage.value = { ...threadCoverage.value, ...updates }
  debug.log('coverage advanced', () => ({
    threadCount: coveredThreads.length,
    summaryCount: Object.keys(summaries).length,
  }))
  persistSummaryData()
}

export function threadSummary(blockId: string): string | undefined {
  return threadCoverage.value[blockId]?.summary
}

export function enqueue(item: SummaryItem): void {
  summaryQueue.value = [...summaryQueue.value, item]
  debug.log('summary enqueued', () => ({
    queueLength: summaryQueue.value.length,
    coveredThreadCount: Object.keys(item.coveredTurnCounts).length,
  }))
  persistSummaryData()
}

export function drainQueue(): SummaryItem[] {
  const items = summaryQueue.value
  summaryQueue.value = []
  debug.log('summary queue drained', () => ({ count: items.length }))
  persistSummaryData()
  return items
}

export async function loadSummaryForConv(): Promise<void> {
  const key = summaryKey()
  const result = await chrome.storage.local.get(key) as Record<string, unknown>
  const data = result[key] as
    | {
      threadCoverage?: Record<string, ThreadCoverage>
      summaryQueue?: SummaryItem[]
    }
    | undefined

  threadCoverage.value = isRecord(data?.threadCoverage)
    ? data.threadCoverage as Record<string, ThreadCoverage>
    : {}
  summaryQueue.value = Array.isArray(data?.summaryQueue) ? data.summaryQueue as SummaryItem[] : []
  debug.log('loaded summary data', () => ({
    coverageCount: Object.keys(threadCoverage.value).length,
    queueLength: summaryQueue.value.length,
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
