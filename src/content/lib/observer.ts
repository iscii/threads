import type { DOMAdapter } from '@/types'
import type { DOMLayerCallbacks, BlockDescriptor } from './types'
import { hashText } from './hash'

export function createObserver(
  adapter: DOMAdapter,
  callbacks: Pick<DOMLayerCallbacks, 'onBlocksFound' | 'onConversationChanged'>,
  /**
   * Injectable nav listener for testing. Production default uses window.navigation.
   * Accepts a callback to invoke on each navigation event.
   */
  listenNavigation: (handler: () => void) => void = (h) => {
    ;(window as unknown as { navigation?: { addEventListener(e: string, fn: () => void): void } })
      .navigation
      ?.addEventListener('navigate', h)
  },
) {
  let tier2: MutationObserver | null = null
  let instrumented = new WeakSet<Element>()

  function toDescriptor(el: Element): BlockDescriptor {
    const text = (el.textContent ?? '').trim()
    return {
      id: hashText(text),
      element: el as HTMLElement,
      text: text.length > 130 ? text.slice(0, 130) + '…' : text,
    }
  }

  function instrumentTurn(turn: Element): void {
    if (instrumented.has(turn)) return
    if (!adapter.isStreamingComplete(turn)) return
    const blocks = adapter.findBlocks(turn)
    if (blocks.length === 0) return
    instrumented.add(turn)
    callbacks.onBlocksFound(blocks.map(toDescriptor))
  }

  function initTier2(): void {
    tier2?.disconnect()
    const scrollContainer = adapter.findScrollContainer()
    if (!scrollContainer) return

    for (const turn of adapter.findAssistantTurns(scrollContainer)) {
      instrumentTurn(turn)
    }

    tier2 = new MutationObserver((mutations) => {
      const candidates = new Set<Element>()
      for (const m of mutations) {
        if (m.type === 'childList') {
          for (const node of m.addedNodes) {
            if (node.nodeType !== 1) continue
            const el = node as Element
            if (el.hasAttribute('data-is-streaming')) candidates.add(el)
            for (const turn of el.querySelectorAll('[data-is-streaming]')) {
              candidates.add(turn)
            }
          }
        } else if (
          m.type === 'attributes' &&
          m.attributeName === 'data-is-streaming'
        ) {
          candidates.add(m.target as Element)
        }
      }
      for (const turn of candidates) instrumentTurn(turn)
    })

    tier2.observe(scrollContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-is-streaming'],
    })
  }

  function handleNavigation(): void {
    tier2?.disconnect()
    tier2 = null
    instrumented = new WeakSet<Element>()
    callbacks.onConversationChanged()
    initTier2()
  }

  function start(): void {
    listenNavigation(handleNavigation)
    initTier2()
  }

  return { start, handleNavigation }
}
