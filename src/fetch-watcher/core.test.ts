import { vi, beforeEach } from 'vitest'
import { createFetchWatcher } from './core'
import { claudeAdapter } from '@/platforms/claude/network'
import { MSG } from '@/messaging'
import { CLAUDE_MSG } from '@/platforms/claude/messaging'

const COMPLETION_URL =
  'https://claude.ai/api/organizations/org1/chat_conversations/conv1/completion'
const OTHER_URL = 'https://claude.ai/api/other'

function makeAdapter() {
  return {
    urlPattern: claudeAdapter.urlPattern,
    inject: vi.fn().mockReturnValue({ messages: [{ role: 'user', content: 'injected' }] }),
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

describe('CLAUDE_ENDPOINT_CAPTURED', () => {
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
      (m) => m.type === CLAUDE_MSG.ENDPOINT_CAPTURED,
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
      messages.get().find((m) => m.type === CLAUDE_MSG.SUMMARY_INJECTED),
    ).toBeUndefined()

    messages.cleanup()
  })

  it('injects summaries and emits CLAUDE_SUMMARY_INJECTED when buffer has summaries', async () => {
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
      messages.get().find((m) => m.type === CLAUDE_MSG.SUMMARY_INJECTED),
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

  it('keeps buffer and fires original request when inject returns null', async () => {
    const originalFetch = vi.fn()
      .mockResolvedValueOnce(makeResponse())
      .mockResolvedValueOnce(makeResponse())
    const adapter = makeAdapter()
    adapter.inject.mockReturnValue(null)
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
      messages.get().find((m) => m.type === CLAUDE_MSG.SUMMARY_INJECTED),
    ).toBeUndefined()

    await interceptFetch(COMPLETION_URL, { method: 'POST', body: JSON.stringify(body) })
    expect(adapter.inject).toHaveBeenCalledTimes(2)

    messages.cleanup()
  })
})
