import { effect } from '@preact/signals'
import { createObserver } from './observer'
import { createInjector } from './injector'
import { threads, activeId, endpointInfo, openThread, closeThread, setActive, loadThreadsForConv } from './threads'
import { loadSummaryForConv } from './summaryStore'
import type { DOMAdapter } from '@/types'
import type { BlockDescriptor } from './types'

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
      closeThread(t.id)
      setActive(null)
      return
    }
    const block = blockRegistry.get(blockId)
    openThread(blockId, block?.text ?? t?.blockText ?? '')
    const updated = threads.value.find(th => th.blockId === blockId)
    if (updated) setActive(updated.id)
  }

  function onConversationChanged(): void {
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
    observer.start()
    void Promise.all([loadThreadsForConv(), loadSummaryForConv()])
  }

  function stop(): void {
    disposeEffect()
    observer.stop()
    started = false
  }

  return {
    start,
    stop,
    getBlockTop: (blockId: string) => injector.getBlockTop(blockId),
    getShadowRoot: () => injector.getShadowRoot(),
    setOnReset: (cb: (shadow: ShadowRoot) => void) => { onReset = cb },
  }
}
