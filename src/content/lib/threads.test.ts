import {
  threads,
  activeId,
  endpointInfo,
  openThread,
  closeThread,
  addMessage,
  initEndpointInfo,
  setEndpointShape,
  setEndpointVars,
  updateEndpointHeaders,
  loadThreadsForConv,
} from './threads'

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
    value: { hostname: 'claude.ai', pathname: '/chat/test-conv' },
    configurable: true,
  })
})

beforeEach(() => {
  threads.value = []
  activeId.value = null
  endpointInfo.value = null
  vi.mocked(chrome.storage.local.set).mockClear()
  vi.mocked(chrome.storage.local.get).mockReset()
  vi.mocked(chrome.storage.local.get).mockImplementation((_, cb) => {
    cb?.({})
    return Promise.resolve({})
  })
  vi.mocked(chrome.storage.local.remove).mockClear()
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

describe('endpoint storage', () => {
  it('stores only shape and variables, never headers', () => {
    initEndpointInfo({
      urlPattern: /completion/,
      messages: {
        endpointCaptured: 'endpoint',
        summaryInjected: 'summary',
        streamComplete: 'stream',
      },
      inject: vi.fn(),
      buildCompletion: vi.fn(),
      buildEndpoint: vi.fn((shape, vars) => ({
        url: shape.url.replace('{conversationUuid}', vars.conversationUuid),
        body: { ...(shape.body as object), parent_message_uuid: vars.parentMessageUuid },
      })),
    })

    setEndpointShape({
      url: '/chat_conversations/{conversationUuid}/completion',
      body: { prompt: '', model: 'claude-sonnet-4-6' },
    })
    setEndpointVars({
      organizationUuid: 'org1',
      conversationUuid: 'conv1',
      parentMessageUuid: 'parent1',
    })
    vi.mocked(chrome.storage.local.set).mockClear()

    updateEndpointHeaders({
      authorization: 'Bearer secret',
      'anthropic-device-id': 'device-id',
      traceparent: 'trace',
    })

    expect(chrome.storage.local.set).not.toHaveBeenCalled()
    expect(endpointInfo.value?.headers).toEqual({
      authorization: 'Bearer secret',
      'anthropic-device-id': 'device-id',
      traceparent: 'trace',
    })
  })

  it('removes legacy per-chat endpoint records on load', async () => {
    const stored = {
      'end:claude.ai:old-conv': {
        url: '/completion',
        headers: { authorization: 'Bearer secret' },
      },
      'end:claude.ai:shape': {
        url: '/chat_conversations/{conversationUuid}/completion',
        body: { prompt: '' },
      },
      'end:claude.ai:test-conv:vars': {
        organizationUuid: 'org1',
        conversationUuid: 'test-conv',
      },
    }
    vi.mocked(chrome.storage.local.get).mockImplementation((_, cb) => {
      cb?.(stored)
      return Promise.resolve(stored)
    })

    await loadThreadsForConv()

    expect(chrome.storage.local.remove).toHaveBeenCalledWith(['end:claude.ai:old-conv'])
  })
})
