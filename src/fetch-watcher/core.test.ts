import { vi, beforeEach } from 'vitest'
import { createFetchWatcher } from './core'
import { claudeAdapter } from '@/platforms/claude/network'

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
