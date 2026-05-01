import { effect } from '@preact/signals'
import { createObserver } from './observer'
import { createInjector } from './injector'
import { threads, activeId, endpointInfo, openThread, setActive, loadThreadsForConv } from './threads'
import { loadSummaryForConv } from './summaryStore'
import type { DOMAdapter } from '@/types'
import type { BlockDescriptor } from './types'

export type Coordinator = ReturnType<typeof createCoordinator>

export function createCoordinator(domAdapter: DOMAdapter) {
  const blockRegistry = new Map<string, BlockDescriptor>()
  let onReset: ((shadow: ShadowRoot) => void) | null = null
  let started = false

  let injector = createInjector(
    { onBlockTriggerClicked, onDotClicked },
    () => domAdapter.findScrollContainer(),
  )

  const observer = createObserver(domAdapter, { onBlocksFound, onConversationChanged })

  // Keep injector DOM state in sync with thread signals
  const disposeEffect = effect(() => {
    for (const t of threads.value) {
      const state = t.isOpen ? 'active' : t.messages.length > 0 ? 'has-thread' : 'idle'
      injector.setBlockState(t.blockId, state)
      injector.setDotVisible(t.blockId, !t.isOpen && t.messages.length > 0)
    }
  })

  function onBlocksFound(blocks: BlockDescriptor[]): void {
    for (const b of blocks) blockRegistry.set(b.id, b)
    injector.instrumentBlocks(blocks)
  }

  function onBlockTriggerClicked(blockId: string): void {
    const block = blockRegistry.get(blockId)
    openThread(blockId, block?.text ?? '')
    const t = threads.value.find(th => th.blockId === blockId)
    if (t) setActive(t.id)
  }

  function onDotClicked(blockId: string): void {
    const text =
      blockRegistry.get(blockId)?.text ??
      threads.value.find(t => t.blockId === blockId)?.blockText ??
      ''
    openThread(blockId, text)
    const t = threads.value.find(th => th.blockId === blockId)
    if (t) setActive(t.id)
  }

  function onConversationChanged(): void {
    injector.destroy()
    blockRegistry.clear()
    threads.value = []
    activeId.value = null
    endpointInfo.value = null

    injector = createInjector(
      { onBlockTriggerClicked, onDotClicked },
      () => domAdapter.findScrollContainer(),
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
