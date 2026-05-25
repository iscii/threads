import { vi, beforeEach } from 'vitest'
import { createFetchWatcher } from './core'
import { claudeAdapter } from '@/platforms/claude/network'
import { MSG } from '@/messaging'

const COMPLETION_URL =
  'https://claude.ai/api/organizations/org1/chat_conversations/conv1/completion'
const OTHER_URL = 'https://claude.ai/api/other'

const MSG_TYPES = {
  endpointCaptured: 'TEST_ENDPOINT_CAPTURED',
  summaryInjected: 'TEST_SUMMARY_INJECTED',
  streamComplete: 'TEST_STREAM_COMPLETE',
}

function makeAdapter() {
  return {
    urlPattern: claudeAdapter.urlPattern,
    messages: MSG_TYPES,
    inject: vi.fn().mockReturnValue({ body: { messages: [{ role: 'user', content: 'injected' }] }, injected: true }),
    buildCompletion: vi.fn(),
  }
}

function makeStream(text = 'chunk') {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

function makeResponse(stream = makeStream()) {
  return new Response(stream, { status: 200, statusText: 'OK' })
}

function collectMessages() {
  const msgs: MessageEvent['data'][] = []
  const handler = (e: MessageEvent) => { msgs.push(e.data as MessageEvent['data']) }
  window.addEventListener('message', handler)
  return {
    get: () => [...msgs],
    cleanup: () => window.removeEventListener('message', handler),
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('passthrough', () => {
  it('passes through non-POST requests unchanged', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)

    await interceptFetch(OTHER_URL, { method: 'GET' })

    expect(originalFetch).toHaveBeenCalledWith(OTHER_URL, { method: 'GET' })
    expect(adapter.inject).not.toHaveBeenCalled()
  })

  it('passes through POST requests that do not match urlPattern', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const body = JSON.stringify({ data: 1 })

    await interceptFetch(OTHER_URL, { method: 'POST', body })

    expect(originalFetch).toHaveBeenCalledWith(OTHER_URL, { method: 'POST', body })
    expect(adapter.inject).not.toHaveBeenCalled()
  })

  it('defaults method to GET when not specified', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)

    await interceptFetch(OTHER_URL)

    expect(originalFetch).toHaveBeenCalledWith(OTHER_URL, {})
    expect(adapter.inject).not.toHaveBeenCalled()
  })
})

describe('endpoint captured', () => {
  it('emits on every matching POST regardless of staged summaries', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const captured = messages.get().find(
      (m) => m.type === MSG_TYPES.endpointCaptured,
    )
    expect(captured).toBeDefined()
    expect(captured.url).toBe(COMPLETION_URL)
    expect(captured.body).toEqual(body)

    messages.cleanup()
  })

  it('emits storable request headers', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'token1',
        authorization: 'Bearer private',
      },
      body: JSON.stringify({ prompt: 'Hello' }),
    })
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const captured = messages.get().find(
      (m) => m.type === MSG_TYPES.endpointCaptured,
    )
    expect(captured.headers).toEqual({
      'content-type': 'application/json',
      'x-csrf-token': 'token1',
    })

    messages.cleanup()
  })

  it('reads body from Request input when init has none', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()
    const body = { prompt: 'Hello' }

    await interceptFetch(new Request(COMPLETION_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }))
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const captured = messages.get().find(
      (m) => m.type === MSG_TYPES.endpointCaptured,
    )
    expect(captured.body).toEqual(body)

    messages.cleanup()
  })
})

describe('injection pipeline', () => {
  it('fires original request when buffer is empty', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(adapter.inject).not.toHaveBeenCalled()
    expect(originalFetch).toHaveBeenCalledWith(
      COMPLETION_URL,
      expect.objectContaining({ body: JSON.stringify(body) }),
    )
    expect(
      messages.get().find((m) => m.type === MSG_TYPES.summaryInjected),
    ).toBeUndefined()

    messages.cleanup()
  })

  it('injects summaries and emits summaryInjected when buffer has summaries', async () => {
    const modifiedBody = {
      messages: [{ role: 'user', content: '<threads-context>\nSummary\n</threads-context>\n\nHello' }],
    }
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    adapter.inject.mockReturnValue({ body: modifiedBody, injected: true })
    const { interceptFetch, handleMessage } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    handleMessage(
      new MessageEvent('message', {
        data: { type: MSG.STAGE_SUMMARY, summaryTexts: ['Summary'] },
        source: window,
      }),
    )

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(adapter.inject).toHaveBeenCalledWith(body, ['Summary'])
    expect(originalFetch).toHaveBeenCalledWith(
      COMPLETION_URL,
      expect.objectContaining({ body: JSON.stringify(modifiedBody) }),
    )
    expect(
      messages.get().find((m) => m.type === MSG_TYPES.summaryInjected),
    ).toBeDefined()

    messages.cleanup()
  })

  it('clears buffer after successful injection', async () => {
    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch, handleMessage } = createFetchWatcher(adapter, originalFetch)

    handleMessage(
      new MessageEvent('message', {
        data: { type: MSG.STAGE_SUMMARY, summaryTexts: ['Summary'] },
        source: window,
      }),
    )

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify(body) })
    expect(adapter.inject).toHaveBeenCalledTimes(1)

    await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify(body) })
    expect(adapter.inject).toHaveBeenCalledTimes(1)
    await new Promise<void>(resolve => setTimeout(resolve, 0))
  })

  it('keeps buffer and fires original request when inject returns injected: false', async () => {
    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(makeResponse())
    const adapter = makeAdapter()
    adapter.inject.mockReturnValue({ body: {}, injected: false })
    const { interceptFetch, handleMessage } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    handleMessage(
      new MessageEvent('message', {
        data: { type: MSG.STAGE_SUMMARY, summaryTexts: ['Summary'] },
        source: window,
      }),
    )

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify(body) })
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(originalFetch).toHaveBeenCalledWith(
      COMPLETION_URL,
      expect.objectContaining({ body: JSON.stringify(body) }),
    )
    expect(
      messages.get().find((m) => m.type === MSG_TYPES.summaryInjected),
    ).toBeUndefined()

    await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify(body) })
    expect(adapter.inject).toHaveBeenCalledTimes(2)

    messages.cleanup()
  })
})

describe('stream monitoring', () => {
  it('emits streamComplete after response stream drains', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    const response = await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    await response.text()

    await vi.waitFor(() => {
      expect(
        messages.get().find((m) => m.type === MSG_TYPES.streamComplete),
      ).toBeDefined()
    }, { timeout: 200 })

    messages.cleanup()
  })

  it('emits streamComplete even when summaries were injected', async () => {
    const modifiedBody = {
      messages: [{ role: 'user', content: '<threads-context>\nSummary\n</threads-context>\n\nHello' }],
    }
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    adapter.inject.mockReturnValue({ body: modifiedBody, injected: true })
    const { interceptFetch, handleMessage } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    handleMessage(
      new MessageEvent('message', {
        data: { type: MSG.STAGE_SUMMARY, summaryTexts: ['Summary'] },
        source: window,
      }),
    )

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    const response = await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    await response.text()

    await vi.waitFor(() => {
      expect(
        messages.get().find((m) => m.type === MSG_TYPES.streamComplete),
      ).toBeDefined()
    }, { timeout: 200 })

    messages.cleanup()
  })

  it('emits streamComplete early when isStreamDone returns true', async () => {
    const originalFetch = vi.fn().mockResolvedValue(
      makeResponse(makeStream('data: [DONE]')),
    )
    const adapter = {
      ...makeAdapter(),
      isStreamDone: vi.fn().mockReturnValue(true),
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    const response = await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    await response.text()

    await vi.waitFor(() => {
      expect(
        messages.get().find((m) => m.type === MSG_TYPES.streamComplete),
      ).toBeDefined()
    }, { timeout: 200 })

    expect(adapter.isStreamDone).toHaveBeenCalledWith('data: [DONE]')

    messages.cleanup()
  })

  it('emits streamComplete for responses with no body', async () => {
    const originalFetch = vi.fn().mockResolvedValue(
      new Response(null, { status: 200 }),
    )
    const adapter = makeAdapter()
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify(body),
    })

    await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(
      messages.get().find((m) => m.type === MSG_TYPES.streamComplete),
    ).toBeDefined()

    messages.cleanup()
  })
})

describe('history filtering', () => {
  const HISTORY_URL = 'https://claude.ai/api/organizations/org1/chat_conversations/conv1?tree=True'

  it('filters GET response through history.filter and returns modified body', async () => {
    const rawBody = {
      chat_messages: [{
        sender: 'human',
        content: [{ type: 'text', text: '<threads-context>\nSummary\n</threads-context>\n\nHello' }],
      }],
    }
    const filteredBody = {
      chat_messages: [{
        sender: 'human',
        content: [{ type: 'text', text: 'Hello' }],
      }],
    }
    const originalFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(rawBody), { status: 200 })
    )
    const filter = vi.fn().mockReturnValue(filteredBody)
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter,
      },
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)

    const response = await interceptFetch(HISTORY_URL, { method: 'GET' })
    const json = await response.json()

    expect(filter).toHaveBeenCalledWith(rawBody, null)
    expect(json).toEqual(filteredBody)
  })

  it('emits conversation GET body and headers for endpoint variable capture', async () => {
    const originalFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ chat_messages: [] }), { status: 200 })
    )
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter: vi.fn((body: unknown) => body),
      },
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    await interceptFetch(HISTORY_URL, {
      method: 'GET',
      headers: { 'x-csrf-token': 'fresh' },
    })
    await new Promise<void>(resolve => setTimeout(resolve, 0))

    const captured = messages.get().reverse().find(
      (m) => m.type === MSG_TYPES.endpointCaptured && m.url === HISTORY_URL,
    )
    expect(captured).toEqual({
      type: MSG_TYPES.endpointCaptured,
      url: HISTORY_URL,
      body: { chat_messages: [] },
      headers: { 'x-csrf-token': 'fresh' },
    })

    messages.cleanup()
  })

  it('passes through GET response unchanged when response is not ok', async () => {
    const originalFetch = vi.fn().mockResolvedValue(new Response('', { status: 404 }))
    const filter = vi.fn()
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter,
      },
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)

    const response = await interceptFetch(HISTORY_URL, { method: 'GET' })

    expect(filter).not.toHaveBeenCalled()
    expect(response.status).toBe(404)
  })

  it('passes through GET when no history set', async () => {
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const { interceptFetch } = createFetchWatcher(makeAdapter(), originalFetch)

    await interceptFetch(HISTORY_URL, { method: 'GET' })

    expect(originalFetch).toHaveBeenCalledWith(HISTORY_URL, { method: 'GET' })
  })
})

describe('lastKnownRealLeaf tracking', () => {
  const HISTORY_URL = 'https://claude.ai/api/organizations/org1/chat_conversations/conv1?tree=True'
  const MESSAGE_START_SSE = [
    'data: {"type":"message_start","message":{"uuid":"real-leaf-uuid"}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')

  it('passes lastKnownRealLeaf to history.filter after non-extension POST', async () => {
    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(makeStream(MESSAGE_START_SSE)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chat_messages: [] }), { status: 200 }))
    const filter = vi.fn((body: unknown) => body)
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter,
      },
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    const postResponse = await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello' }), // no marker
    })
    await postResponse.text()

    await vi.waitFor(() => {
      expect(messages.get().find(m => m.type === MSG_TYPES.streamComplete)).toBeDefined()
    }, { timeout: 200 })

    await interceptFetch(HISTORY_URL, { method: 'GET' })

    expect(filter).toHaveBeenCalledWith(expect.anything(), 'real-leaf-uuid')
    messages.cleanup()
  })

  it('does NOT update lastKnownRealLeaf for extension requests', async () => {
    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(makeStream(MESSAGE_START_SSE)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chat_messages: [] }), { status: 200 }))
    const filter = vi.fn((body: unknown) => body)
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter,
      },
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    // Extension POST — prompt starts with marker
    const extBody = JSON.stringify({ prompt: '<threads-ext-marker/>\nSummarize.' })
    const postResponse = await interceptFetch(COMPLETION_URL, { method: 'POST', body: extBody })
    await postResponse.text()

    await vi.waitFor(() => {
      expect(messages.get().find(m => m.type === MSG_TYPES.streamComplete)).toBeDefined()
    }, { timeout: 200 })

    await interceptFetch(HISTORY_URL, { method: 'GET' })

    expect(filter).toHaveBeenCalledWith(expect.anything(), null)
    messages.cleanup()
  })

  it('retains lastKnownRealLeaf across requests — extension POST does not clobber it', async () => {
    const realSSE = [
      'data: {"type":"message_start","message":{"uuid":"real-leaf"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const extSSE = [
      'data: {"type":"message_start","message":{"uuid":"ext-leaf"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')

    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(makeStream(realSSE)))   // real POST
      .mockResolvedValueOnce(makeResponse(makeStream(extSSE)))    // extension POST
      .mockResolvedValueOnce(new Response(JSON.stringify({ chat_messages: [] }), { status: 200 })) // GET
    const filter = vi.fn((body: unknown) => body)
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter,
      },
    }
    const { interceptFetch } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    // Real POST
    const r1 = await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify({ prompt: 'Hello' }) })
    await r1.text()
    await vi.waitFor(() => {
      expect(messages.get().filter(m => m.type === MSG_TYPES.streamComplete).length).toBeGreaterThanOrEqual(1)
    }, { timeout: 200 })

    // Extension POST
    const r2 = await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify({ prompt: '<threads-ext-marker/>\nSummarize.' }) })
    await r2.text()
    await vi.waitFor(() => {
      expect(messages.get().filter(m => m.type === MSG_TYPES.streamComplete).length).toBeGreaterThanOrEqual(2)
    }, { timeout: 200 })

    // GET — filter should still see the real leaf, not the extension leaf
    await interceptFetch(HISTORY_URL, { method: 'GET' })

    expect(filter).toHaveBeenCalledWith(expect.anything(), 'real-leaf')
    messages.cleanup()
  })

  it('resets lastKnownRealLeaf to null on resetLeaf call', async () => {
    const realSSE = [
      'data: {"type":"message_start","message":{"uuid":"conv-a-leaf"}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n')
    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse(makeStream(realSSE)))
      .mockResolvedValueOnce(new Response(JSON.stringify({ chat_messages: [] }), { status: 200 }))
    const filter = vi.fn((body: unknown) => body)
    const adapter = {
      ...makeAdapter(),
      history: {
        urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,
        filter,
      },
    }
    const { interceptFetch, resetLeaf } = createFetchWatcher(adapter, originalFetch)
    const messages = collectMessages()

    // Establish a known real leaf
    const postResponse = await interceptFetch(COMPLETION_URL, {
      method: 'POST',
      body: JSON.stringify({ prompt: 'Hello' }),
    })
    await postResponse.text()
    await vi.waitFor(() => {
      expect(messages.get().find(m => m.type === MSG_TYPES.streamComplete)).toBeDefined()
    }, { timeout: 200 })

    // Simulate SPA navigation
    resetLeaf()

    // GET after navigation — lastKnownRealLeaf should be null
    await interceptFetch(HISTORY_URL, { method: 'GET' })

    expect(filter).toHaveBeenCalledWith(expect.anything(), null)
    messages.cleanup()
  })
})
