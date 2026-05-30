import { createObserver } from './observer'
import type { DOMAdapter } from '@/types'
import type { BlockDescriptor } from './types'

// Minimal adapter that uses a provided container as the scroll root
function makeAdapter(container: Element, overrides: Partial<DOMAdapter> = {}): DOMAdapter {
  return {
    findScrollContainer: () => container,
    findAssistantTurns: (root) => Array.from(root.querySelectorAll('[data-is-streaming]')),
    isStreamingComplete: (el) => el.getAttribute('data-is-streaming') === 'false',
    findBlocks: (turn) => Array.from(turn.querySelectorAll('p.thr-blk')),
    findInput: () => null,
    findHeader: () => null,
    findChatContainer: () => null,
    findHeaderActions: () => null,
    ...overrides,
  }
}

function makeTurn(streaming: boolean, texts: string[] = ['Block text']): HTMLDivElement {
  const turn = document.createElement('div')
  turn.setAttribute('data-is-streaming', String(streaming))
  for (const text of texts) {
    const p = document.createElement('p')
    p.className = 'thr-blk'
    p.textContent = text
    turn.appendChild(p)
  }
  return turn
}

afterEach(() => { document.body.innerHTML = '' })

describe('init scan', () => {
  it('instruments already-complete turns on start', () => {
    const container = document.createElement('div')
    container.appendChild(makeTurn(false, ['Hello world']))
    document.body.appendChild(container)

    const onBlocksFound = vi.fn<[BlockDescriptor[]], void>()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    expect(onBlocksFound).toHaveBeenCalledOnce()
    expect(onBlocksFound.mock.calls[0][0]).toHaveLength(1)
    expect(onBlocksFound.mock.calls[0][0][0].text).toBe('Hello world')
  })

  it('skips still-streaming turns on start', () => {
    const container = document.createElement('div')
    container.appendChild(makeTurn(true, ['In progress']))
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    expect(onBlocksFound).not.toHaveBeenCalled()
  })

  it('instruments multiple turns with multiple blocks each', () => {
    const container = document.createElement('div')
    container.appendChild(makeTurn(false, ['P1', 'P2']))
    container.appendChild(makeTurn(false, ['P3']))
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    expect(onBlocksFound).toHaveBeenCalledTimes(2)
    expect(onBlocksFound.mock.calls[0][0]).toHaveLength(2)
    expect(onBlocksFound.mock.calls[1][0]).toHaveLength(1)
  })
})

describe('mutation handling', () => {
  it('instruments a turn when data-is-streaming flips to false', async () => {
    const container = document.createElement('div')
    const turn = makeTurn(true, ['Streamed block'])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()
    expect(onBlocksFound).not.toHaveBeenCalled()

    turn.setAttribute('data-is-streaming', 'false')
    await Promise.resolve()

    expect(onBlocksFound).toHaveBeenCalledOnce()
    expect(onBlocksFound.mock.calls[0][0][0].text).toBe('Streamed block')
  })

  it('does not instrument the same turn twice', async () => {
    const container = document.createElement('div')
    const turn = makeTurn(false, ['Block'])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    // Trigger attribute mutation again on already-instrumented turn
    turn.setAttribute('data-is-streaming', 'false')
    await Promise.resolve()

    expect(onBlocksFound).toHaveBeenCalledOnce()
  })

  it('instruments a newly added turn that is already complete', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    const turn = makeTurn(false, ['Late block'])
    container.appendChild(turn)
    await Promise.resolve()

    expect(onBlocksFound).toHaveBeenCalledOnce()
    expect(onBlocksFound.mock.calls[0][0][0].text).toBe('Late block')
  })
})

describe('block descriptor', () => {
  it('truncates text longer than 130 chars', () => {
    const container = document.createElement('div')
    const turn = makeTurn(false, ['x'.repeat(200)])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    const desc = onBlocksFound.mock.calls[0][0][0] as BlockDescriptor
    expect(desc.text.length).toBe(131) // 130 + ellipsis char
    expect(desc.text.endsWith('…')).toBe(true)
  })

  it('does not truncate text of 130 chars or fewer', () => {
    const container = document.createElement('div')
    const turn = makeTurn(false, ['x'.repeat(130)])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    const desc = onBlocksFound.mock.calls[0][0][0] as BlockDescriptor
    expect(desc.text).toBe('x'.repeat(130))
  })

  it('assigns a stable id from the block text', () => {
    const container = document.createElement('div')
    container.appendChild(makeTurn(false, ['Stable text']))
    document.body.appendChild(container)

    const calls: BlockDescriptor[][] = []
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound: (b) => calls.push(b), onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    // Same text on a second observer should produce same id
    const container2 = document.createElement('div')
    container2.appendChild(makeTurn(false, ['Stable text']))
    document.body.appendChild(container2)

    const obs2 = createObserver(
      makeAdapter(container2),
      { onBlocksFound: (b) => calls.push(b), onConversationChanged: vi.fn() },
      () => {},
    )
    obs2.start()

    expect(calls[0][0].id).toBe(calls[1][0].id)
  })
})

describe('navigation', () => {
  it('calls onConversationChanged on handleNavigation', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const onConversationChanged = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound: vi.fn(), onConversationChanged },
      () => {},
    )
    obs.start()
    obs.handleNavigation()

    expect(onConversationChanged).toHaveBeenCalledOnce()
  })

  it('stop() calls the cleanup returned by listenNavigation', () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const cleanup = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound: vi.fn(), onConversationChanged: vi.fn() },
      () => cleanup,
    )
    obs.start()
    obs.stop()

    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('re-instruments turns from the new conversation after handleNavigation', () => {
    const container = document.createElement('div')
    container.appendChild(makeTurn(false, ['Old turn']))
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()
    expect(onBlocksFound).toHaveBeenCalledTimes(1)

    // Simulate new conversation: remove old turn, add new one
    container.innerHTML = ''
    container.appendChild(makeTurn(false, ['New turn']))
    obs.handleNavigation()

    expect(onBlocksFound).toHaveBeenCalledTimes(2)
    expect(onBlocksFound.mock.calls[1][0][0].text).toBe('New turn')
  })
})

describe('tagged turn removal', () => {
  it('removes a complete turn containing the ext marker on init scan', () => {
    const container = document.createElement('div')
    const turn = makeTurn(false, ['<x/>\nSummarize this.'])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    expect(onBlocksFound).not.toHaveBeenCalled()
    expect(document.contains(turn)).toBe(false)
  })

  it('removes a tagged turn added via childList mutation without instrumenting it', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    const turn = makeTurn(false, ['<x/>\nSummarize this.'])
    container.appendChild(turn)
    await Promise.resolve()

    expect(onBlocksFound).not.toHaveBeenCalled()
    expect(document.contains(turn)).toBe(false)
  })

  it('removes a tagged turn when data-is-streaming flips to false', async () => {
    const container = document.createElement('div')
    const turn = makeTurn(true, ['<x/>\nSummarize this.'])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()
    expect(onBlocksFound).not.toHaveBeenCalled()

    turn.setAttribute('data-is-streaming', 'false')
    await Promise.resolve()

    expect(onBlocksFound).not.toHaveBeenCalled()
    expect(document.contains(turn)).toBe(false)
  })
})
