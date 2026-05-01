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

function persist(t: Thread): void {
  chrome.storage.local.set({ [threadKey(t.blockId)]: t })
}

export function openThread(blockId: string, blockText: string): string {
  const existing = threads.value.find(t => t.blockId === blockId)
  if (existing) {
    threads.value = threads.value.map(t =>
      t.blockId === blockId ? { ...t, isOpen: true } : t
    )
    persist({ ...existing, isOpen: true })
    return existing.id
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
  persist(t)
  return t.id
}

export function closeThread(id: string): void {
  const t = threads.value.find(t => t.id === id)
  if (!t) return
  if (t.messages.length === 0) {
    threads.value = threads.value.filter(t => t.id !== id)
    chrome.storage.local.remove(threadKey(t.blockId))
  } else {
    const updated = { ...t, isOpen: false }
    threads.value = threads.value.map(t => t.id === id ? updated : t)
    persist(updated)
  }
}

export function addMessage(id: string, msg: ThreadMsg): void {
  threads.value = threads.value.map(t => {
    if (t.id !== id) return t
    const updated = { ...t, messages: [...t.messages, msg] }
    persist(updated)
    return updated
  })
}

export function setTyping(id: string, v: boolean): void {
  threads.value = threads.value.map(t => t.id === id ? { ...t, isTyping: v } : t)
}

export function setIncluded(id: string, v: boolean): void {
  threads.value = threads.value.map(t => {
    if (t.id !== id) return t
    const updated = { ...t, included: v }
    persist(updated)
    return updated
  })
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
}
