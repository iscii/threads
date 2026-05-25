import type { DOMAdapter } from '@/types'
import type { DOMLayerCallbacks, BlockDescriptor } from './types'
import { hashText } from './hash'
import { THR_EXT_MARKER } from '@/messaging'

export function createObserver(
  adapter: DOMAdapter,
  callbacks: Pick<DOMLayerCallbacks, 'onBlocksFound' | 'onConversationChanged'>,
  listenNavigation: (handler: () => void) => (() => void) | void = (h) => {
    const nav = (
      window as unknown as {
        navigation?: {
          addEventListener(e: string, fn: () => void): void
          removeEventListener(e: string, fn: () => void): void
        }
      }
    ).navigation
    nav?.addEventListener('navigate', h)
    return () => nav?.removeEventListener('navigate', h)
  },
) {
  let tier2: MutationObserver | null = null
  let stopNavigation: (() => void) | void
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
    // Use includes (not startsWith) — rendered textContent may have surrounding DOM structure
    if (turn.textContent?.includes(THR_EXT_MARKER)) {
      turn.remove()
      return
    }
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
    stopNavigation = listenNavigation(handleNavigation)
    initTier2()
  }

  function stop(): void {
    stopNavigation?.()
    stopNavigation = undefined
    tier2?.disconnect()
    tier2 = null
  }

  return { start, handleNavigation, stop }
}
