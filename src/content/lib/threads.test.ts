import {
  threads,
  activeId,
  endpointInfo,
  openThread,
  closeThread,
  addMessage,
  loadThreadsForConv,
  setEndpointInfo,
} from './threads'

beforeAll(() => {
  vi.stubGlobal('chrome', {
    storage: {
      local: {
        set: vi.fn(),
        get: vi.fn((_, cb) => {
          cb?.({})
          return Promise.resolve({})
        }),
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
  endpointInfo.value = null
  localStorage.clear()
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
    expect(activeId.value).toBeNull()
  })

  it('keeps thread with messages and sets isOpen false', () => {
    openThread('b1', 'text')
    const id = threads.value[0].id
    addMessage(id, { role: 'user', content: 'Q' })
    closeThread(id)
    expect(threads.value).toHaveLength(1)
    expect(threads.value[0].isOpen).toBe(false)
    expect(activeId.value).toBeNull()
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

describe('endpointInfo persistence', () => {
  it('saves captured endpoint info in localStorage for the current conversation', () => {
    setEndpointInfo({
      url: '/api/organizations/org/chat_conversations/test-conv/completion',
      body: { prompt: 'hello', model: 'claude-sonnet-4-5' },
    })

    const raw = localStorage.getItem('endpoint:test-conv')
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!)).toEqual({
      url: '/api/organizations/org/chat_conversations/test-conv/completion',
      body: { prompt: 'hello', model: 'claude-sonnet-4-5' },
    })
  })

  it('loads persisted endpoint info when loading a conversation', async () => {
    localStorage.setItem('endpoint:test-conv', JSON.stringify({
      url: '/api/organizations/org/chat_conversations/test-conv/completion',
      body: { prompt: 'old prompt', turn_message_uuids: { human_message_uuid: 'h', assistant_message_uuid: 'a' } },
    }))

    await loadThreadsForConv()

    expect(endpointInfo.value).toEqual({
      url: '/api/organizations/org/chat_conversations/test-conv/completion',
      body: { prompt: 'old prompt', turn_message_uuids: { human_message_uuid: 'h', assistant_message_uuid: 'a' } },
    })
  })

  it('ignores invalid persisted endpoint info', async () => {
    localStorage.setItem('endpoint:test-conv', JSON.stringify({ url: 42, body: {} }))

    await loadThreadsForConv()

    expect(endpointInfo.value).toBeNull()
  })
})
