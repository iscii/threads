import { signal, batch } from '@preact/signals'
import type { EndpointShape, EndpointVars, NetworkAdapter } from '@/types'
import { convId, endpointShapeKey, endpointVarsKey, threadKey } from './keys'

export type ThreadMsg = { role: 'user' | 'assistant'; content: string }
export type EndpointInfo = {
  url: string
  body: unknown
  headers?: Record<string, string>
  persisted?: boolean
}

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
export const summaryStatus = signal<'idle' | 'summarizing'>('idle')
export const endpointInfo = signal<EndpointInfo | null>(null)

let endpointAdapter: NetworkAdapter | null = null
let endpointShape: EndpointShape | null = null
let endpointVars: EndpointVars | null = null
let endpointHeaders: Record<string, string> | undefined

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
  batch(() => {
    if (t.messages.length === 0) {
      threads.value = threads.value.filter(t => t.id !== id)
    } else {
      threads.value = threads.value.map(t => t.id === id ? { ...t, isOpen: false } : t)
    }
    if (activeId.value === id) activeId.value = null
  })
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

export function initEndpointInfo(adapter: NetworkAdapter): void {
  endpointAdapter = adapter
  rebuildEndpointInfo(endpointInfo.value?.persisted)
}

export function setEndpointShape(shape: EndpointShape): void {
  endpointShape = shape
  chrome.storage.local.set({ [endpointShapeKey()]: shape })
  rebuildEndpointInfo(false)
}

export function setEndpointVars(vars: EndpointVars): void {
  endpointVars = vars
  chrome.storage.local.set({ [endpointVarsKey()]: vars })
  rebuildEndpointInfo(false)
}

export function updateEndpointHeaders(headers: Record<string, string>): void {
  endpointHeaders = { ...endpointHeaders, ...headers }
  rebuildEndpointInfo(endpointInfo.value?.persisted)
}

export function clearStoredEndpointInfo(): void {
  endpointVars = null
  endpointInfo.value = null
  chrome.storage.local.remove(endpointVarsKey())
}

function rebuildEndpointInfo(persisted = false): void {
  if (!endpointAdapter?.buildEndpoint || !endpointShape || !endpointVars) {
    endpointInfo.value = null
    return
  }

  const resolved = endpointAdapter.buildEndpoint(endpointShape, endpointVars)
  endpointInfo.value = resolved
    ? {
        url: resolved.url,
        body: resolved.body,
        headers: endpointHeaders,
        persisted,
      }
    : null
}

export async function loadThreadsForConv(): Promise<void> {
  const prefix = `thr:${convId()}:`
  const all = await chrome.storage.local.get(null) as Record<string, unknown>
  const endpointPrefix = `end:${location.hostname}:`
  const legacyEndpointKeys = Object.keys(all).filter(k =>
    k.startsWith(endpointPrefix) &&
    k !== endpointShapeKey() &&
    !k.endsWith(':vars')
  )
  if (legacyEndpointKeys.length) chrome.storage.local.remove(legacyEndpointKeys)

  threads.value = Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v as Thread)
  activeId.value = null
  summaryStatus.value = 'idle'
  endpointShape = (all[endpointShapeKey()] as EndpointShape | undefined) ?? null
  endpointVars = (all[endpointVarsKey()] as EndpointVars | undefined) ?? null
  rebuildEndpointInfo(true)
}
