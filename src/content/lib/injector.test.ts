import { createInjector } from './injector'

function makeBlock(text = 'Block text'): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  return p
}

function makeDescriptor(p: HTMLParagraphElement, id = 'abc12345') {
  return { id, element: p, text: p.textContent ?? '' }
}

afterEach(() => { document.body.innerHTML = '' })

describe('thread zone host', () => {
  it('appends a host element to document.body on creation', () => {
    createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    expect(document.body.querySelector('[data-thr-zone]')).not.toBeNull()
  })

  it('starts with display none', () => {
    createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.display).toBe('none')
  })

  it('becomes visible after instrumentBlocks', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    document.body.appendChild(p)
    injector.instrumentBlocks([makeDescriptor(p)])
    const host = document.body.querySelector<HTMLElement>('[data-thr-zone]')!
    expect(host.style.display).not.toBe('none')
  })

  it('getShadowRoot returns the shadow root of the host', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const host = document.body.querySelector('[data-thr-zone]')!
    expect(injector.getShadowRoot()).toBe(host.shadowRoot)
  })
})

describe('block instrumentation', () => {
  it('wraps the block p in a div with data-thr-id', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock('Hello')
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id001')])

    const wrapper = parent.querySelector('[data-thr-id="id001"]')
    expect(wrapper).not.toBeNull()
    expect(wrapper!.contains(p)).toBe(true)
  })

  it('injects a trigger button inside the wrapper', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id002')])

    const wrapper = parent.querySelector('[data-thr-id="id002"]')!
    expect(wrapper.querySelector('[data-thr-trigger]')).not.toBeNull()
  })

  it('is idempotent — calling twice with same block does not double-wrap', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    const desc = makeDescriptor(p, 'id003')
    injector.instrumentBlocks([desc])
    injector.instrumentBlocks([desc])

    expect(parent.querySelectorAll('[data-thr-id="id003"]')).toHaveLength(1)
  })

  it('trigger button click calls onBlockTriggerClicked with block id', () => {
    const onBlockTriggerClicked = vi.fn()
    const injector = createInjector({ onBlockTriggerClicked, onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id004')])

    const btn = parent.querySelector<HTMLButtonElement>('[data-thr-trigger]')!
    btn.click()

    expect(onBlockTriggerClicked).toHaveBeenCalledWith('id004')
  })
})

describe('setBlockState', () => {
  it('sets data-thr-state on the wrapper element', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id005')])
    injector.setBlockState('id005', 'has-thread')

    const wrapper = parent.querySelector('[data-thr-id="id005"]')!
    expect(wrapper.getAttribute('data-thr-state')).toBe('has-thread')
  })

  it('is a no-op for unknown block ids', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    expect(() => injector.setBlockState('unknown', 'active')).not.toThrow()
  })
})

describe('setDotVisible', () => {
  it('adds a dot span after the block when visible=true', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id006')])
    injector.setDotVisible('id006', true)

    expect(parent.querySelector('[data-thr-dot]')).not.toBeNull()
  })

  it('removes the dot span when visible=false', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id007')])
    injector.setDotVisible('id007', true)
    injector.setDotVisible('id007', false)

    expect(parent.querySelector('[data-thr-dot]')).toBeNull()
  })

  it('dot click calls onDotClicked with block id', () => {
    const onDotClicked = vi.fn()
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id008')])
    injector.setDotVisible('id008', true)

    const dot = parent.querySelector<HTMLSpanElement>('[data-thr-dot]')!
    dot.click()

    expect(onDotClicked).toHaveBeenCalledWith('id008')
  })

  it('is a no-op for unknown block ids', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    expect(() => injector.setDotVisible('unknown', true)).not.toThrow()
  })
})

describe('getBlockTop', () => {
  it('returns a number for a known block id', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    const p = makeBlock()
    const parent = document.createElement('div')
    parent.appendChild(p)
    document.body.appendChild(parent)

    injector.instrumentBlocks([makeDescriptor(p, 'id009')])

    expect(typeof injector.getBlockTop('id009')).toBe('number')
  })

  it('returns 0 for an unknown block id', () => {
    const injector = createInjector({ onBlockTriggerClicked: vi.fn(), onDotClicked: vi.fn() })
    expect(injector.getBlockTop('unknown')).toBe(0)
  })
})
