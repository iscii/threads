import { threads, activeId, openThread, closeThread, addMessage } from './threads'

beforeAll(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        set: vi.fn(),
        get: vi.fn().mockResolvedValue({}),
        remove: vi.fn(),
      },
    },
  })
  Object.defineProperty(window, 'location', {
    value: { pathname: '/chat/test-conv' },
    configurable: true,
  })
})

beforeEach(() => {
  threads.value = []
  activeId.value = null
})

describe('openThread', () => {
  it('creates a new thread and returns its id', () => {
    const id = openThread('block1', 'Hello world')
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].blockId).toBe('block1')
    expect(threads.value[0].blockText).toBe('Hello world')
    expect(threads.value[0].isOpen).toBe(true)
    expect(id).toBe(threads.value[0].id)
  })

  it('reopens existing thread instead of creating a duplicate', () => {
    const id1 = openThread('block1', 'Hello')
    threads.value = threads.value.map(t => ({ ...t, isOpen: false }))
    const id2 = openThread('block1', 'Hello')
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].isOpen).toBe(true)
    expect(id2).toBe(id1)
  })
})

describe('closeThread', () => {
  it('removes thread with no messages', () => {
    const id = openThread('b1', 'text')
    closeThread(id)
    expect(threads.value).toHaveLength(0)
  })

  it('keeps thread with messages and sets isOpen false', () => {
    const id = openThread('b1', 'text')
    addMessage(id, { role: 'user', content: 'Q' })
    closeThread(id)
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].isOpen).toBe(false)
  })
})

describe('addMessage', () => {
  it('appends messages in order', () => {
    const id = openThread('b1', 'text')
    addMessage(id, { role: 'user', content: 'Q' })
    addMessage(id, { role: 'assistant', content: 'A' })
    expect(threads.value[0].messages).toHaveLength(2)
    expect(threads.value[0].messages[0].content).toBe('Q')
    expect(threads.value[0].messages[1].content).toBe('A')
  })
})
