import { threads, activeId, openThread, closeThread, addMessage } from './threads'

beforeAll(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        set: vi.fn(),
        get: vi.fn((_, cb) => cb && cb({})),
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
  it('creates a new thread and sets activeId', () => {
    openThread('block1', 'Hello world')
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].blockId).toBe('block1')
    expect(threads.value[0].blockText).toBe('Hello world')
    expect(threads.value[0].isOpen).toBe(true)
    expect(activeId.value).toBe(threads.value[0].id)
  })

  it('reopens existing thread instead of creating a duplicate', () => {
    openThread('block1', 'Hello')
    const id1 = threads.value[0].id
    threads.value = threads.value.map(t => ({ ...t, isOpen: false }))
    openThread('block1', 'Hello')
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].isOpen).toBe(true)
    expect(activeId.value).toBe(id1)
  })
})

describe('closeThread', () => {
  it('removes thread with no messages', () => {
    openThread('b1', 'text')
    const id = threads.value[0].id
    closeThread(id)
    expect(threads.value).toHaveLength(0)
  })

  it('keeps thread with messages and sets isOpen false', () => {
    openThread('b1', 'text')
    const id = threads.value[0].id
    addMessage(id, { role: 'user', content: 'Q' })
    closeThread(id)
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].isOpen).toBe(false)
  })
})

describe('addMessage', () => {
  it('appends messages in order', () => {
    openThread('b1', 'text')
    const id = threads.value[0].id
    addMessage(id, { role: 'user', content: 'Q' })
    addMessage(id, { role: 'assistant', content: 'A' })
    expect(threads.value[0].messages).toHaveLength(2)
    expect(threads.value[0].messages[0].content).toBe('Q')
    expect(threads.value[0].messages[1].content).toBe('A')
  })
})
