import { signal } from '@preact/signals'
import { threads, type Thread } from './threads'
import { summaryKey } from './keys'

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

export const highWaterMarks = signal<Record<string, number>>({})
export const threadCoverage = signal<Record<string, ThreadCoverage>>({})
export const summaryQueue = signal<SummaryItem[]>([])

function persistSummaryData(): void {
  chrome.storage.local.set({
    [summaryKey()]: {
      threadCoverage: threadCoverage.value,
      highWaterMarks: highWaterMarks.value,
      summaryQueue: summaryQueue.value,
    },
  })
}

function syncHighWaterMarks(): void {
  highWaterMarks.value = Object.fromEntries(
    Object.entries(threadCoverage.value).map(
      ([blockId, coverage]) => [blockId, coverage.highWaterMark],
    ),
  )
}

export function coveredCount(blockId: string): number {
  return threadCoverage.value[blockId]?.highWaterMark ?? highWaterMarks.value[blockId] ?? 0
}

export function dirtyThreads(): Thread[] {
  return threads.value.filter(
    t => t.included && t.messages.length > coveredCount(t.blockId),
  )
}

export function advanceMarks(summaries: Record<string, string> = {}): void {
  const now = Date.now()
  const updates: Record<string, ThreadCoverage> = {}
  for (const t of dirtyThreads()) {
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
  syncHighWaterMarks()
  persistSummaryData()
}

export function threadSummary(blockId: string): string | undefined {
  return threadCoverage.value[blockId]?.summary
}

export function enqueue(item: SummaryItem): void {
  summaryQueue.value = [...summaryQueue.value, item]
  persistSummaryData()
}

export function drainQueue(): SummaryItem[] {
  const items = summaryQueue.value
  summaryQueue.value = []
  persistSummaryData()
  return items
}

export async function loadSummaryForConv(): Promise<void> {
  const key = summaryKey()
  const result = await chrome.storage.local.get(key) as Record<string, unknown>
  const data = result[key] as
    | {
      threadCoverage?: Record<string, ThreadCoverage>
      highWaterMarks?: Record<string, number>
      summaryQueue?: SummaryItem[]
    }
    | undefined

  const loadedCoverage = isRecord(data?.threadCoverage)
    ? data.threadCoverage as Record<string, ThreadCoverage>
    : {}
  const legacyMarks = isRecord(data?.highWaterMarks)
    ? data.highWaterMarks as Record<string, number>
    : {}

  threadCoverage.value = {
    ...Object.fromEntries(
      Object.entries(legacyMarks)
        .filter(([, count]) => typeof count === 'number')
        .map(([blockId, count]) => [blockId, { highWaterMark: count }]),
    ),
    ...loadedCoverage,
  }
  syncHighWaterMarks()
  summaryQueue.value = Array.isArray(data?.summaryQueue) ? data.summaryQueue as SummaryItem[] : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
