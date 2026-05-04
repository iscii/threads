import { effect } from '@preact/signals'
import { createObserver } from './observer'
import { createInjector } from './injector'
import { threads, activeId, endpointInfo, openThread, closeThread, setActive, loadThreadsForConv } from './threads'
import { loadSummaryForConv } from './summaryStore'
import type { DOMAdapter } from '@/types'
import type { BlockDescriptor } from './types'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('dom')

export type Coordinator = ReturnType<typeof createCoordinator>

export function createCoordinator(domAdapter: DOMAdapter) {
  const blockRegistry = new Map<string, BlockDescriptor>()
  let onReset: ((shadow: ShadowRoot) => void) | null = null
  let started = false

  let injector = createInjector(
    { onBlockTriggerClicked },
    () => domAdapter.findScrollContainer(),
    () => domAdapter.findHeader(),
    () => domAdapter.findChatContainer(),
  )

  const observer = createObserver(domAdapter, { onBlocksFound, onConversationChanged })

  // Keep injector DOM state in sync with thread signals
  let prevBlockIds = new Set<string>()
  const disposeEffect = effect(() => {
    const currentBlockIds = new Set(threads.value.map(t => t.blockId))
    for (const id of prevBlockIds) {
      if (!currentBlockIds.has(id)) injector.setBlockState(id, 'idle')
    }
    prevBlockIds = currentBlockIds
    for (const t of threads.value) {
      const state = t.isOpen ? 'active' : t.messages.length > 0 ? 'has-thread' : 'idle'
      injector.setBlockState(t.blockId, state)
    }
  })

  function onBlocksFound(blocks: BlockDescriptor[]): void {
    for (const b of blocks) blockRegistry.set(b.id, b)
    injector.instrumentBlocks(blocks)
  }

  function onBlockTriggerClicked(blockId: string): void {
    const t = threads.value.find(th => th.blockId === blockId)
    if (t?.isOpen) {
      debug.log('closing open thread from trigger', () => ({ blockId, threadId: t.id }))
      closeThread(t.id)
      setActive(null)
      return
    }
    const block = blockRegistry.get(blockId)
    if (!block) debug.warn('opening thread without registered block text', () => ({ blockId }))
    openThread(blockId, block?.text ?? t?.blockText ?? '')
    const updated = threads.value.find(th => th.blockId === blockId)
    if (updated) {
      debug.log('thread opened from trigger', () => ({ blockId, threadId: updated.id }))
      setActive(updated.id)
    } else {
      debug.warn('thread open did not produce thread entry', () => ({ blockId }))
    }
  }

  function onConversationChanged(): void {
    debug.log('conversation changed; resetting coordinator')
    injector.destroy()
    blockRegistry.clear()
    threads.value = []
    activeId.value = null
    endpointInfo.value = null

    injector = createInjector(
      { onBlockTriggerClicked },
      () => domAdapter.findScrollContainer(),
      () => domAdapter.findHeader(),
      () => domAdapter.findChatContainer(),
    )

    const shadow = injector.getShadowRoot()
    onReset?.(shadow)
    void Promise.all([loadThreadsForConv(), loadSummaryForConv()])
  }

  function start(): void {
    if (started) return
    started = true
    debug.log('coordinator started')
    observer.start()
    void Promise.all([loadThreadsForConv(), loadSummaryForConv()])
  }

  function stop(): void {
    disposeEffect()
    observer.stop()
    started = false
    debug.log('coordinator stopped')
  }

  return {
    start,
    stop,
    getBlockTop: (blockId: string) => injector.getBlockTop(blockId),
    getShadowRoot: () => injector.getShadowRoot(),
    setOnReset: (cb: (shadow: ShadowRoot) => void) => { onReset = cb },
  }
}
