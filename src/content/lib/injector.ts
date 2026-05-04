import type { DOMLayerCallbacks, DOMLayerAPI, BlockDescriptor } from './types'

const TRIGGER_SVG = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3 1.5h6a1.5 1.5 0 0 1 1.5 1.5v4.5a1.5 1.5 0 0 1-1.5 1.5H4.5L2 11V3a1.5 1.5 0 0 1 1.5-1.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round"/></svg>`
const ZONE_WIDTH = 308
const PANEL_LEFT = 12
const PANEL_WIDTH = 284
const PANEL_GAP = 8

interface BlockEntry {
  blockEl: HTMLElement
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

  function updateZoneTop(): void {
    const headerBottom = findHeader()?.getBoundingClientRect().bottom ?? 0
    host.style.top = `${headerBottom}px`
  }

  function updateZoneLeft(): void {
    const container = findChatContainer() ?? findScrollContainer()
    if (container) {
      const rect = container.getBoundingClientRect()
      const normalLeft = rect.right + PANEL_GAP - PANEL_LEFT
      const panelWouldOverflow = normalLeft + PANEL_LEFT + PANEL_WIDTH > window.innerWidth
      const overlayLeft = rect.right - PANEL_WIDTH - PANEL_GAP - PANEL_LEFT
      host.style.left = `${Math.max(0, panelWouldOverflow ? overlayLeft : normalLeft)}px`
    }
  }

  function instrumentBlocks(descs: BlockDescriptor[]): void {
    let instrumented = 0
    for (const desc of descs) {
      if (blocks.has(desc.id)) continue

      const p = desc.element as HTMLElement
      if (!p.parentNode) continue

      // Apply data-thr-id directly to the block element — no reparenting,
      // so React's parent.removeChild(p) continues to work on resize.
      p.dataset.thrId = desc.id

      const btn = document.createElement('button')
      btn.dataset.thrTrigger = ''
      btn.innerHTML = TRIGGER_SVG
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        callbacks.onBlockTriggerClicked(desc.id)
      })
      p.appendChild(btn)

      blocks.set(desc.id, { blockEl: p })
      instrumented++
    }

    if (instrumented > 0 && host.style.display === 'none') {
      host.style.display = ''
    }

    updateZoneTop()
    updateZoneLeft()

    if (!resizeObserver) {
      window.addEventListener('resize', updatePosition)
      resizeObserver = new ResizeObserver(() => { updateZoneTop(); updateZoneLeft() })
      const scrollContainer = findScrollContainer()
      if (scrollContainer) resizeObserver.observe(scrollContainer)
      const header = findHeader()
      if (header) resizeObserver.observe(header)
      const chatContainer = findChatContainer()
      if (chatContainer) resizeObserver.observe(chatContainer)
    }
  }

  return {
    instrumentBlocks,
    getShadowRoot: () => shadow,

    setBlockState(id, state) {
      const entry = blocks.get(id)
      if (entry) entry.blockEl.dataset.thrState = state
    },

    getBlockTop(id) {
      const entry = blocks.get(id)
      if (!entry) return 0
      const hostTop = parseFloat(host.style.top) || 0
      return entry.blockEl.getBoundingClientRect().top - hostTop
    },

    destroy() {
      window.removeEventListener('resize', updatePosition)
      resizeObserver?.disconnect()
      resizeObserver = null
      for (const entry of blocks.values()) {
        delete entry.blockEl.dataset.thrId
        delete entry.blockEl.dataset.thrState
        entry.blockEl.querySelectorAll('[data-thr-trigger]').forEach(b => b.remove())
      }
      blocks.clear()
      host.remove()
    },
  }

  function updatePosition(): void {
    updateZoneTop()
    updateZoneLeft()
  }
}
