import type { DOMLayerCallbacks, DOMLayerAPI, BlockDescriptor } from './types'
import { hashText } from './hash'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('dom')

const TRIGGER_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 1.5h6a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5H4.5L2 11V3a1.5 1.5 0 0 1 1.5-1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`
const ZONE_WIDTH = 308
const PANEL_LEFT = 12
const PANEL_WIDTH = 284
const PANEL_GAP = 8
const MIN_VIEWPORT_PADDING = 8

interface BlockEntry {
  blockEl: HTMLElement
  state?: 'idle' | 'has-thread' | 'active'
}

export function createInjector(
  callbacks: Pick<DOMLayerCallbacks, 'onBlockTriggerClicked'>,
  findScrollContainer: () => Element | null = () => null,
  findHeader: () => Element | null = () => null,
  findChatContainer: () => Element | null = () => null,
): DOMLayerAPI {
  const host = document.createElement('div')
  host.dataset.thrZone = ''
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    bottom: '0',
    width: `${ZONE_WIDTH}px`,
    pointerEvents: 'none',
    zIndex: '2147483600',
    overflow: 'hidden',
    display: 'none',
  })
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const blocks = new Map<string, BlockEntry>()
  let resizeObserver: ResizeObserver | null = null

  function isUsableAnchor(el: HTMLElement): boolean {
    if (!el.isConnected) return false
    if (el.getClientRects().length > 0) return true
    const rect = el.getBoundingClientRect()
    return rect.width > 0 || rect.height > 0
  }

  function attachBlock(id: string, blockEl: HTMLElement, state?: BlockEntry['state']): void {
    blockEl.dataset.thrId = id

    if (!blockEl.querySelector('[data-thr-trigger]')) {
      const btn = document.createElement('button')
      btn.dataset.thrTrigger = ''
      btn.innerHTML = TRIGGER_SVG
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        callbacks.onBlockTriggerClicked(id)
      })
      blockEl.appendChild(btn)
    }

    if (state) blockEl.dataset.thrState = state
    blocks.set(id, { blockEl, state })
  }

  function detachBlock(blockEl: HTMLElement): void {
    delete blockEl.dataset.thrId
    delete blockEl.dataset.thrState
    blockEl.querySelectorAll('[data-thr-trigger]').forEach(b => b.remove())
  }

  function rebindBlock(id: string): BlockEntry | null {
    const root = findScrollContainer() ?? document.body
    const candidates = Array.from(root.querySelectorAll<HTMLElement>('p, li, pre, blockquote'))
    debug.warn('rebind started for stale anchor', () => ({
      id,
      candidateCount: candidates.length,
      root: describeElement(root),
    }))
    for (const candidate of candidates) {
      if (!isUsableAnchor(candidate)) continue
      const text = (candidate.textContent ?? '').trim()
      if (!text || hashText(text) !== id) continue

      const old = blocks.get(id)
      if (old && old.blockEl !== candidate) detachBlock(old.blockEl)
      attachBlock(id, candidate, old?.state)
      debug.log('rebind succeeded', () => ({ id, anchor: describeAnchor(candidate) }))
      return blocks.get(id) ?? null
    }
    debug.warn('rebind failed', () => ({ id }))
    return null
  }

  function updateZoneTop(): void {
    const headerBottom = findHeader()?.getBoundingClientRect().bottom ?? 0
    host.style.top = `${headerBottom}px`
  }

  function updateZoneLeft(): void {
    const container = findChatContainer() ?? findScrollContainer()
    if (container) {
      const rect = container.getBoundingClientRect()
      const normalLeft = rect.right + PANEL_GAP - PANEL_LEFT
      const panelRight = normalLeft + PANEL_LEFT + PANEL_WIDTH
      const overlay = panelRight > window.innerWidth
      const overlayLeft = rect.right - PANEL_WIDTH - PANEL_GAP - PANEL_LEFT
      const maxLeft = Math.max(0, window.innerWidth - ZONE_WIDTH - MIN_VIEWPORT_PADDING)
      const nextLeft = Math.min(
        Math.max(MIN_VIEWPORT_PADDING, overlay ? overlayLeft : normalLeft),
        maxLeft,
      )
      host.dataset.thrOverlay = String(overlay)
      host.style.left = `${nextLeft}px`
      return
    }

    host.dataset.thrOverlay = 'true'
    host.style.left = `${Math.max(MIN_VIEWPORT_PADDING, window.innerWidth - ZONE_WIDTH - MIN_VIEWPORT_PADDING)}px`
    debug.warn('zone left updated without chat container', () => ({
      viewportWidth: window.innerWidth,
      left: host.style.left,
    }))
  }

  function instrumentBlocks(descs: BlockDescriptor[]): void {
    let instrumented = 0
    for (const desc of descs) {
      const existing = blocks.get(desc.id)
      if (existing) {
        if (isUsableAnchor(existing.blockEl)) continue
        debug.warn('instrument replacing unusable anchor', () => ({
          id: desc.id,
          anchor: describeAnchor(existing.blockEl),
        }))
        detachBlock(existing.blockEl)
        blocks.delete(desc.id)
      }

      const p = desc.element as HTMLElement
      if (!p.parentNode) {
        debug.warn('instrument skipped detached descriptor', () => ({ id: desc.id }))
        continue
      }

      // Apply data-thr-id directly to the block element — no reparenting,
      // so React's parent.removeChild(p) continues to work on resize.
      attachBlock(desc.id, p, existing?.state)
      instrumented++
    }

    if (instrumented > 0 && host.style.display === 'none') {
      host.style.display = ''
    }

    updateZoneTop()
    updateZoneLeft()

    if (!resizeObserver) {
      window.addEventListener('resize', updatePosition)
      window.addEventListener('scroll', updatePosition, true)
      resizeObserver = new ResizeObserver(() => { updateZoneTop(); updateZoneLeft() })
      const scrollContainer = findScrollContainer()
      if (scrollContainer) resizeObserver.observe(scrollContainer)
      const header = findHeader()
      if (header) resizeObserver.observe(header)
      const chatContainer = findChatContainer()
      if (chatContainer) resizeObserver.observe(chatContainer)
      debug.log('position observers attached', () => ({
        scrollContainer: scrollContainer ? describeElement(scrollContainer) : null,
        header: header ? describeElement(header) : null,
        chatContainer: chatContainer ? describeElement(chatContainer) : null,
      }))
    }
  }

  return {
    instrumentBlocks,
    getShadowRoot: () => shadow,

    setBlockState(id, state) {
      const current = blocks.get(id)
      const entry = current && isUsableAnchor(current.blockEl)
        ? current
        : rebindBlock(id)
      if (entry) {
        entry.state = state
        entry.blockEl.dataset.thrState = state
      } else {
        debug.warn('block state skipped missing anchor', () => ({ id, state }))
      }
    },

    getBlockTop(id) {
      const current = blocks.get(id)
      const entry = current && isUsableAnchor(current.blockEl)
        ? current
        : rebindBlock(id)
      if (!entry) return 0
      const hostTop = parseFloat(host.style.top) || 0
      const rect = entry.blockEl.getBoundingClientRect()
      const top = rect.top - hostTop
      return top
    },

    destroy() {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      resizeObserver?.disconnect()
      resizeObserver = null
      for (const entry of blocks.values()) {
        detachBlock(entry.blockEl)
      }
      blocks.clear()
      host.remove()
      debug.log('injector destroyed')
    },
  }

  function updatePosition(): void {
    updateZoneTop()
    updateZoneLeft()
  }
}

function describeAnchor(el: HTMLElement, rect = el.getBoundingClientRect()): Record<string, unknown> {
  return {
    tag: el.tagName,
    connected: el.isConnected,
    rects: el.getClientRects().length,
    rect: describeRect(rect),
  }
}

function describeElement(el: Element): Record<string, unknown> {
  return {
    tag: el.tagName,
    className: el.getAttribute('class'),
  }
}

function describeRect(rect: DOMRect): Record<string, number> {
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}
