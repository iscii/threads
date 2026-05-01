import { signal } from '@preact/signals'
import { threads, type Thread } from './threads'
import { summaryKey } from './keys'

export type SummaryItem = {
  text: string
  coveredTurnCounts: Record<string, number>
  generatedAt: number
}

export const highWaterMarks = signal<Record<string, number>>({})
export const summaryQueue = signal<SummaryItem[]>([])

function persistSummaryData(): void {
  chrome.storage.local.set({
    [summaryKey()]: {
      highWaterMarks: highWaterMarks.value,
      summaryQueue: summaryQueue.value,
    },
  })
}

export function dirtyThreads(): Thread[] {
  return threads.value.filter(
    t => t.included && t.messages.length > (highWaterMarks.value[t.blockId] ?? 0),
  )
}

export function advanceMarks(): void {
  const updates: Record<string, number> = {}
  for (const t of dirtyThreads()) {
    updates[t.blockId] = t.messages.length
  }
  highWaterMarks.value = { ...highWaterMarks.value, ...updates }
  persistSummaryData()
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
    | { highWaterMarks?: Record<string, number>; summaryQueue?: SummaryItem[] }
    | undefined
  highWaterMarks.value = (data?.highWaterMarks && typeof data.highWaterMarks === 'object' && !Array.isArray(data.highWaterMarks))
    ? data.highWaterMarks as Record<string, number>
    : {}
  summaryQueue.value = Array.isArray(data?.summaryQueue) ? data.summaryQueue as SummaryItem[] : []
}
