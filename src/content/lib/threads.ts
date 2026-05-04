import { signal, batch } from '@preact/signals'
import type { EndpointShape, EndpointVars, NetworkAdapter } from '@/types'
import { convId, endpointShapeKey, endpointVarsKey, threadKey } from './keys'
import { createDebugLogger } from '@/debug'

const debugThreads = createDebugLogger('threads')
const debugEndpoint = createDebugLogger('endpoint')

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
    if (stale.length) {
      debugThreads.log('removing stale thread records', () => ({ count: stale.length }))
      chrome.storage.local.remove(stale)
    }
  })
}

export function openThread(blockId: string, blockText: string): void {
  const existing = threads.value.find(t => t.blockId === blockId)
  if (existing) {
    debugThreads.log('opening existing thread', () => ({
      threadId: existing.id,
      blockId,
      messageCount: existing.messages.length,
    }))
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
  debugThreads.log('creating thread', () => ({ threadId: t.id, blockId, hasBlockText: blockText.length > 0 }))
  threads.value = [...threads.value, t]
  activeId.value = t.id
  persist()
}

export function closeThread(id: string): void {
  const t = threads.value.find(t => t.id === id)
  if (!t) {
    debugThreads.warn('close skipped missing thread', () => ({ threadId: id }))
    return
  }
  debugThreads.log('closing thread', () => ({
    threadId: id,
    blockId: t.blockId,
    messageCount: t.messages.length,
    willDelete: t.messages.length === 0,
  }))
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
  const existed = threads.value.some(t => t.id === id)
  debugThreads.log('adding message', () => ({ threadId: id, role: msg.role, threadExists: existed }))
  threads.value = threads.value.map(t => {
    if (t.id !== id) return t
    return { ...t, messages: [...t.messages, msg] }
  })
  persist()
}

export function setTyping(id: string, v: boolean): void {
  debugThreads.log('typing state updated', () => ({ threadId: id, isTyping: v }))
  threads.value = threads.value.map(t => t.id === id ? { ...t, isTyping: v } : t)
  persist()
}

export function setIncluded(id: string, v: boolean): void {
  debugThreads.log('summary inclusion updated', () => ({ threadId: id, included: v }))
  threads.value = threads.value.map(t => {
    if (t.id !== id) return t
    return { ...t, included: v }
  })
  persist()
}

export function setActive(id: string | null): void {
  debugThreads.log('active thread updated', () => ({ threadId: id }))
  activeId.value = id
}

export function initEndpointInfo(adapter: NetworkAdapter): void {
  endpointAdapter = adapter
  debugEndpoint.log('endpoint adapter initialized', () => ({
    hasBuildEndpoint: Boolean(adapter.buildEndpoint),
    hasCaptureCompletion: Boolean(adapter.captureCompletion),
    hasCaptureEndpointVars: Boolean(adapter.captureEndpointVars),
  }))
  rebuildEndpointInfo(endpointInfo.value?.persisted)
}

export function setEndpointShape(shape: EndpointShape): void {
  endpointShape = shape
  debugEndpoint.log('endpoint shape stored', () => ({
    urlTemplate: shape.url,
    body: describeValue(shape.body),
  }))
  chrome.storage.local.set({ [endpointShapeKey()]: shape })
  rebuildEndpointInfo(false)
}

export function setEndpointVars(vars: EndpointVars): void {
  endpointVars = vars
  debugEndpoint.log('endpoint vars stored', () => ({
    hasOrganizationUuid: Boolean(vars.organizationUuid),
    hasConversationUuid: Boolean(vars.conversationUuid),
    hasParentMessageUuid: Boolean(vars.parentMessageUuid),
  }))
  chrome.storage.local.set({ [endpointVarsKey()]: vars })
  rebuildEndpointInfo(false)
}

export function updateEndpointHeaders(headers: Record<string, string>): void {
  endpointHeaders = { ...endpointHeaders, ...headers }
  debugEndpoint.log('endpoint headers updated', () => ({
    headerKeys: Object.keys(headers),
    totalHeaderKeys: Object.keys(endpointHeaders ?? {}),
  }))
  rebuildEndpointInfo(endpointInfo.value?.persisted)
}

export function clearStoredEndpointInfo(): void {
  endpointVars = null
  endpointInfo.value = null
  debugEndpoint.warn('endpoint vars cleared')
  chrome.storage.local.remove(endpointVarsKey())
}

function rebuildEndpointInfo(persisted = false): void {
  if (!endpointAdapter?.buildEndpoint || !endpointShape || !endpointVars) {
    endpointInfo.value = null
    debugEndpoint.warn('endpoint rebuild skipped missing pieces', () => ({
      hasAdapter: Boolean(endpointAdapter?.buildEndpoint),
      hasShape: Boolean(endpointShape),
      hasVars: Boolean(endpointVars),
    }))
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
  debugEndpoint.log('endpoint rebuilt', () => ({
    success: Boolean(resolved),
    persisted,
    hasHeaders: Boolean(endpointHeaders),
    body: resolved ? describeValue(resolved.body) : null,
  }))
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
  if (legacyEndpointKeys.length) {
    debugEndpoint.log('removing legacy endpoint records', () => ({ count: legacyEndpointKeys.length }))
    chrome.storage.local.remove(legacyEndpointKeys)
  }

  threads.value = Object.entries(all)
    .filter(([k]) => k.startsWith(prefix))
    .map(([, v]) => v as Thread)
  activeId.value = null
  summaryStatus.value = 'idle'
  endpointShape = (all[endpointShapeKey()] as EndpointShape | undefined) ?? null
  endpointVars = (all[endpointVarsKey()] as EndpointVars | undefined) ?? null
  debugThreads.log('loaded conversation threads', () => ({
    count: threads.value.length,
    messageCount: threads.value.reduce((sum, t) => sum + t.messages.length, 0),
  }))
  debugEndpoint.log('loaded endpoint records', () => ({
    hasShape: Boolean(endpointShape),
    hasVars: Boolean(endpointVars),
  }))
  rebuildEndpointInfo(true)
}

function describeValue(value: unknown): unknown {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value as Record<string, unknown>) }
  }
  return { type: typeof value }
}
