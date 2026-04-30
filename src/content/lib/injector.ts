import type { DOMLayerCallbacks, DOMLayerAPI, BlockDescriptor } from './types'

interface BlockEntry {
  wrapper: HTMLElement
  blockEl: HTMLElement
}

export function createInjector(
  callbacks: Pick<DOMLayerCallbacks, 'onBlockTriggerClicked' | 'onDotClicked'>,
): DOMLayerAPI {
  const host = document.createElement('div')
  host.dataset.thrZone = ''
  Object.assign(host.style, {
    position: 'fixed',
    top: '0',
    bottom: '0',
    width: '308px',
    pointerEvents: 'none',
    zIndex: '2147483600',
    overflow: 'visible',
    display: 'none',
  })
  document.body.appendChild(host)
  const shadow = host.attachShadow({ mode: 'open' })

  const blocks = new Map<string, BlockEntry>()
  let resizeObserver: ResizeObserver | null = null

  function updateZoneLeft(): void {
    let rightmost = 0
    for (const { blockEl } of blocks.values()) {
      const r = blockEl.getBoundingClientRect().right
      if (r > rightmost) rightmost = r
    }
    if (rightmost > 0) {
      host.style.left = `${rightmost + 20}px`
    }
  }

  function instrumentBlocks(descs: BlockDescriptor[]): void {
    for (const desc of descs) {
      if (blocks.has(desc.id)) continue

      const p = desc.element
      const wrapper = document.createElement('div')
      wrapper.dataset.thrId = desc.id
      p.parentNode!.insertBefore(wrapper, p)
      wrapper.appendChild(p)

      const btn = document.createElement('button')
      btn.dataset.thrTrigger = ''
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        callbacks.onBlockTriggerClicked(desc.id)
      })
      wrapper.appendChild(btn)

      blocks.set(desc.id, { wrapper, blockEl: p })
    }

    if (host.style.display === 'none') {
      host.style.display = ''
    }

    updateZoneLeft()

    if (!resizeObserver) {
      const scrollContainer = document.querySelector(
        'div[class*="overflow-y-auto"][class*="pt-6"]',
      )
      if (scrollContainer) {
        resizeObserver = new ResizeObserver(updateZoneLeft)
        resizeObserver.observe(scrollContainer)
      }
    }
  }

  return {
    instrumentBlocks,
    getShadowRoot: () => shadow,

    setBlockState(id, state) {
      const entry = blocks.get(id)
      if (entry) entry.wrapper.dataset.thrState = state
    },

    setDotVisible(id, visible) {
      const entry = blocks.get(id)
      if (!entry) return
      const existing = entry.wrapper.querySelector('[data-thr-dot]')
      if (visible && !existing) {
        const dot = document.createElement('span')
        dot.dataset.thrDot = ''
        dot.addEventListener('click', () => callbacks.onDotClicked(id))
        entry.blockEl.after(dot)
      } else if (!visible && existing) {
        existing.remove()
      }
    },

    getBlockTop(id) {
      const entry = blocks.get(id)
      if (!entry) return 0
      return entry.wrapper.getBoundingClientRect().top
    },
  }
}
