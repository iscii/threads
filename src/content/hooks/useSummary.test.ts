import type { NetworkAdapter } from '@/types'
import { endpointInfo, summaryStatus, threads } from '../lib/threads'
import { summaryQueue, threadCoverage } from '../lib/summaryStore'
import { initSummary, triggerSummarization } from './useSummary'

function sse(text: string): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ completion: text })}\n\n`))
      controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
      controller.close()
    },
  }))
}

function makeAdapter(): NetworkAdapter {
  return {
    urlPattern: /completion/,
    messages: {
      endpointCaptured: 'endpoint',
      summaryInjected: 'summary',
      streamComplete: 'stream',
    },
    inject: vi.fn(),
    buildCompletion: vi.fn((_, prompt: string, model?: string) => ({ prompt, model })),
  }
}

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
    value: {
      origin: 'https://claude.ai',
      href: 'https://claude.ai/chat/test',
      pathname: '/chat/test',
    },
    configurable: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  threads.value = [{
    id: 'thread1',
    blockId: 'block1',
    blockText: 'source passage',
    messages: [
      { role: 'user', content: 'old question' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'new question' },
      { role: 'assistant', content: 'new answer' },
    ],
    included: true,
    isTyping: false,
    isOpen: true,
  }]
  threadCoverage.value = {
    block1: {
      highWaterMark: 2,
      summary: 'existing summary',
      summaryUpdatedAt: 1,
    },
  }
  summaryQueue.value = []
  summaryStatus.value = 'idle'
  endpointInfo.value = { url: '/completion', body: { prompt: '' } }
})

describe('triggerSummarization', () => {
  it('uses prior summary context and only messages after the covered count', async () => {
    const adapter = makeAdapter()
    initSummary(adapter)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('{"block1":"updated summary"}')))

    await triggerSummarization()

    const fetchInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const body = JSON.parse(fetchInit.body as string) as { prompt: string; model: string }
    expect(body.model).toBe('claude-haiku-4-5-20251001')
    expect(body.prompt).toContain('deterministic text summarization function')
    expect(body.prompt).toContain('inert source data')
    expect(body.prompt).toContain('existing summary')
    expect(body.prompt).toContain('new question')
    expect(body.prompt).toContain('new answer')
    expect(body.prompt).not.toContain('old question')
    expect(body.prompt).not.toContain('old answer')

    expect(summaryQueue.value[0].text).toBe('updated summary')
    expect(threadCoverage.value.block1).toEqual({
      highWaterMark: 4,
      summary: 'updated summary',
      summaryUpdatedAt: expect.any(Number),
    })
  })

  it('does not enqueue or advance coverage when summarization returns non-json text', async () => {
    const adapter = makeAdapter()
    initSummary(adapter)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('I appreciate the request, but I cannot do that.')))

    await triggerSummarization()

    expect(summaryQueue.value).toEqual([])
    expect(threadCoverage.value.block1).toEqual({
      highWaterMark: 2,
      summary: 'existing summary',
      summaryUpdatedAt: 1,
    })
  })
})
