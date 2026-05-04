import type { DOMAdapter } from '@/types'
import type { DOMLayerCallbacks, BlockDescriptor } from './types'
import { hashText } from './hash'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('dom')

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
    if (!adapter.isStreamingComplete(turn)) return
    const blocks = adapter.findBlocks(turn)
    if (blocks.length === 0) {
      debug.warn('turn skipped no blocks found', () => describeElement(turn))
      return
    }
    instrumented.add(turn)
    callbacks.onBlocksFound(blocks.map(toDescriptor))
  }

  function initTier2(): void {
    tier2?.disconnect()
    const scrollContainer = adapter.findScrollContainer()
    if (!scrollContainer) {
      debug.warn('observer init skipped missing scroll container')
      return
    }

    const initialTurns = adapter.findAssistantTurns(scrollContainer)
    debug.log('observer init', () => ({
      scrollContainer: describeElement(scrollContainer),
      initialTurnCount: initialTurns.length,
    }))
    for (const turn of initialTurns) {
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
    debug.log('navigation observed')
    tier2?.disconnect()
    tier2 = null
    instrumented = new WeakSet<Element>()
    callbacks.onConversationChanged()
    initTier2()
  }

  function start(): void {
    stopNavigation = listenNavigation(handleNavigation)
    debug.log('observer started')
    initTier2()
  }

  function stop(): void {
    stopNavigation?.()
    stopNavigation = undefined
    tier2?.disconnect()
    tier2 = null
    debug.log('observer stopped')
  }

  return { start, handleNavigation, stop }
}

function describeElement(el: Element): Record<string, unknown> {
  return {
    tag: el.tagName,
    className: el.getAttribute('class'),
    streaming: el.getAttribute('data-is-streaming'),
  }
}
