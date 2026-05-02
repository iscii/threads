import { signal } from '@preact/signals'
import { convId, threadKey } from './keys'

export type ThreadMsg = { role: 'user' | 'assistant'; content: string }

export type Thread = {
  id: string
  blockId: string
  blockText: string
  messages: ThreadMsg[]
  included: boolean
  isTyping: boolean
  isOpen: boolean
}

export const threads = signal<Thread[]>([])
export const activeId = signal<string | null>(null)
export const summaryStatus = signal<'idle' | 'summarizing' | 'included'>('idle')
export const endpointInfo = signal<{ url: string; body: unknown } | null>(null)

function persist(): void {
  const current = threads.value
  const validKeys = new Set(current.map(t => threadKey(t.id)))
  const entries: Record<string, Thread> = {}
  for (const t of current) entries[threadKey(t.id)] = t
  chrome.storage.local.set(entries)
  chrome.storage.local.get(null, (all) => {
    const prefix = `thr:${convId()}:`
    const stale = Object.keys(all).filter(k => k.startsWith(prefix) && !validKeys.has(k))
    if (stale.length) chrome.storage.local.remove(stale)
  })
}

export function openThread(blockId: string, blockText: string): void {
  const existing = threads.value.find(t => t.blockId === blockId)
  if (existing) {
    threads.value = threads.value.map(t =>
      t.blockId === blockId ? { ...t, isOpen: true } : t
    )
    activeId.value = existing.id
    persist()
    return
  }
  const t: Thread = {
    id: crypto.randomUUID(),
    blockId,
    blockText,
    messages: [],
    included: true,
    isTyping: false,
    isOpen: true,
  }
  threads.value = [...threads.value, t]
  activeId.value = t.id
  persist()
}

export function closeThread(id: string): void {
  const t = threads.value.find(t => t.id === id)
  if (!t) return
  if (t.messages.length === 0) {
    threads.value = threads.value.filter(t => t.id !== id)
  } else {
    threads.value = threads.value.map(t => t.id === id ? { ...t, isOpen: false } : t)
  }
  if (activeId.value === id) activeId.value = null
  persist()
}

export function addMessage(id: string, msg: ThreadMsg): void {
  threads.value = threads.value.map(t => {
    if (t.id !== id) return t
    return { ...t, messages: [...t.messages, msg] }
  })
  persist()
}

export function setTyping(id: string, v: boolean): void {
  threads.value = threads.value.map(t => t.id === id ? { ...t, isTyping: v } : t)
  persist()
}

export function setIncluded(id: string, v: boolean): void {
  threads.value = threads.value.map(t => {
    if (t.id !== id) return t
    return { ...t, included: v }
  })
  persist()
}

export function setActive(id: string | null): void {
  activeId.value = id
}

export async function loadThreadsForConv(): Promise<void> {
  const prefix = `thr:${convId()}:`
  const all = await chrome.storage.local.get(null) as Record<string, unknown>
  threads.value = Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v as Thread)
  activeId.value = null
  summaryStatus.value = 'idle'
  endpointInfo.value = null
}
