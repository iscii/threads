import { createInjector } from './injector'

function makeBlock(text = 'Block text'): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  return p
}

function makeDescriptor(p: HTMLParagraphElement, id = 'abc12345') {
  return { id, element: p, text: p.textContent ?? '' }
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('thread zone host', () => {
  it('appends a host element to document.body on creation', () => {
    createInjector({ onBlockTriggerClicked: vi.fn() })
    expect(document.body.querySelector('[data-thr-zone]')).not.toBeNull()
  })

  it('starts with display none', () => {
    createInjector({ onBlockTriggerClicked: vi.fn() })
    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.display).toBe('none')
  })

  it('becomes visible after instrumentBlocks', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    document.body.appendChild(p)
    injector.instrumentBlocks([makeDescriptor(p)])
    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.display).not.toBe('none')
  })

  it('getShadowRoot returns the shadow root of the host', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const host = document.body.querySelector('[data-thr-zone]')!
    expect(injector.getShadowRoot()).toBe(host.shadowRoot)
  })

  it('places the thread panel just to the right of the chat when space allows', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200)
    const chat = document.createElement('div')
    vi.spyOn(chat, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 700,
      top: 0,
      bottom: 500,
      width: 600,
      height: 500,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() }, () => null, () => null, () => chat)
    const p = makeBlock()
    document.body.appendChild(p)

    injector.instrumentBlocks([makeDescriptor(p)])

    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.left).toBe('696px')
    expect(host.dataset.thrOverlay).toBe('false')
  })

  it('overlays the thread panel inside the chat when the viewport is narrow', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(760)
    const chat = document.createElement('div')
    vi.spyOn(chat, 'getBoundingClientRect').mockReturnValue({
      left: 100,
      right: 700,
      top: 0,
      bottom: 500,
      width: 600,
      height: 500,
      x: 100,
      y: 0,
      toJSON: () => ({}),
    })
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() }, () => null, () => null, () => chat)
    const p = makeBlock()
    document.body.appendChild(p)

    injector.instrumentBlocks([makeDescriptor(p)])

    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.left).toBe('396px')
    expect(host.dataset.thrOverlay).toBe('true')
  })

  it('keeps the thread zone inside the viewport when no chat container is available', () => {
    vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(260)
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    document.body.appendChild(p)

    injector.instrumentBlocks([makeDescriptor(p)])

    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.left).toBe('8px')
    expect(host.dataset.thrOverlay).toBe('true')
  })
})

describe('block instrumentation', () => {
  it('applies data-thr-id directly to the block p without reparenting', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock('Hello')
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id001')])

    expect(p.dataset.thrId).toBe('id001')
    expect(p.parentNode).toBe(parent)
  })

  it('injects a trigger button inside the block p', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id002')])

    expect(p.querySelector('[data-thr-trigger]')).not.toBeNull()
  })

  it('is idempotent — calling twice with same block does not double-instrument', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    const desc = makeDescriptor(p, 'id003')
    injector.instrumentBlocks([desc])
    injector.instrumentBlocks([desc])

    expect(p.querySelectorAll('[data-thr-trigger]')).toHaveLength(1)
  })

  it('replaces stale block entries after responsive DOM re-render', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const oldBlock = makeBlock()
    const oldParent = document.createElement('div')
    oldParent.appendChild(oldBlock)
    document.body.appendChild(oldParent)

    const desc = makeDescriptor(oldBlock, 'same-id')
    injector.instrumentBlocks([desc])
    oldParent.remove()

    const newBlock = makeBlock()
    const newParent = document.createElement('div')
    newParent.appendChild(newBlock)
    document.body.appendChild(newParent)
    vi.spyOn(newBlock, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      right: 100,
      top: 250,
      bottom: 270,
      width: 100,
      height: 20,
      x: 0,
      y: 250,
      toJSON: () => ({}),
    })

    injector.instrumentBlocks([makeDescriptor(newBlock, 'same-id')])

    expect(oldBlock.dataset.thrId).toBeUndefined()
    expect(newBlock.dataset.thrId).toBe('same-id')
    expect(newBlock.querySelectorAll('[data-thr-trigger]')).toHaveLength(1)
    expect(injector.getBlockTop('same-id')).toBe(250)
  })

  it('trigger button click calls onBlockTriggerClicked with block id', () => {
    const onBlockTriggerClicked = vi.fn()
    const injector = createInjector({ onBlockTriggerClicked })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id004')])

    const btn = p.querySelector<HTMLButtonElement>('[data-thr-trigger]')!
    btn.click()

    expect(onBlockTriggerClicked).toHaveBeenCalledWith('id004')
  })
})

describe('setBlockState', () => {
  it('sets data-thr-state on the block p', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id005')])
    injector.setBlockState('id005', 'has-thread')

    expect(p.getAttribute('data-thr-state')).toBe('has-thread')
  })

  it('is a no-op for unknown block ids', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    expect(() => injector.setBlockState('unknown', 'active')).not.toThrow()
  })
})

describe('getBlockTop', () => {
  it('returns a number for a known block id', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id009')])

    expect(typeof injector.getBlockTop('id009')).toBe('number')
  })

  it('returns 0 for an unknown block id', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    expect(injector.getBlockTop('unknown')).toBe(0)
  })
})

describe('instrumentBlocks edge cases', () => {
  it('skips detached block elements without throwing', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock('Detached')
    // p is not appended to any parent — parentNode is null
    expect(() => injector.instrumentBlocks([makeDescriptor(p, 'detached')])).not.toThrow()
  })

  it('does not show zone when all descriptors are detached', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    const p = makeBlock()
    injector.instrumentBlocks([makeDescriptor(p, 'detached2')])
    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.display).toBe('none')
  })

  it('does not show zone when instrumentBlocks called with empty array', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    injector.instrumentBlocks([])
    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.display).toBe('none')
  })
})

describe('destroy', () => {
  it('removes the host from document.body', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    expect(document.body.querySelector('[data-thr-zone]')).not.toBeNull()
    injector.destroy()
    expect(document.body.querySelector('[data-thr-zone]')).toBeNull()
  })

  it('is safe to call multiple times', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn() })
    expect(() => { injector.destroy(); injector.destroy() }).not.toThrow()
  })
})
