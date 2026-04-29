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
      messages: [{ role: 'user', content: '<context>\nSummary\n</context>\n\nHello' }],
    }
    const originalFetch = vi.fn().mockResolvedValue(makeResponse())
    const adapter = makeAdapter()
    adapter.inject.mockReturnValue(modifiedBody)
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

    expect(filter).toHaveBeenCalledWith(rawBody)
    expect(json).toEqual(filteredBody)
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
