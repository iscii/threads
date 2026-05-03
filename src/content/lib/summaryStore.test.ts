import { highWaterMarks, summaryQueue, dirtyThreads, advanceMarks, enqueue, drainQueue, loadSummaryForConv } from './summaryStore'
import { summaryKey } from './keys'
import { threads } from './threads'
import type { Thread } from './threads'

function makeThread(blockId: string, msgCount: number, included = true): Thread {
  return {
    id: crypto.randomUUID(),
    blockId,
    blockText: 'text',
    messages: Array.from({ length: msgCount }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `msg${i}`,
    })),
    included,
    isTyping: false,
    isOpen: true,
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
    value: { pathname: '/chat/test' },
    configurable: true,
  })
})

beforeEach(() => {
  vi.clearAllMocks()
  threads.value = []
  highWaterMarks.value = {}
  summaryQueue.value = []
})

describe('dirtyThreads', () => {
  it('returns only included threads with messages beyond HWM', () => {
    threads.value = [
      makeThread('a', 2, true),
      makeThread('b', 0, true),
      makeThread('c', 2, false),
    ]
    const dirty = dirtyThreads()
    expect(dirty).toHaveLength(1)
    expect(dirty[0].blockId).toBe('a')
  })

  it('excludes threads at or below high-water mark', () => {
    threads.value = [makeThread('a', 2, true)]
    highWaterMarks.value = { a: 2 }
    expect(dirtyThreads()).toHaveLength(0)
  })
})

describe('advanceMarks', () => {
  it('sets HWM for each dirty thread to its current message count', () => {
    threads.value = [makeThread('a', 3, true), makeThread('b', 1, false)]
    advanceMarks()
    expect(highWaterMarks.value['a']).toBe(3)
    expect(highWaterMarks.value['b']).toBeUndefined()
    expect(chrome.storage.local.set).toHaveBeenCalled()
  })
})

describe('drainQueue', () => {
  it('returns all enqueued items and clears the queue', () => {
    enqueue({ text: 'sum1', coveredTurnCounts: {}, generatedAt: 0 })
    enqueue({ text: 'sum2', coveredTurnCounts: {}, generatedAt: 1 })
    const drained = drainQueue()
    expect(drained).toHaveLength(2)
    expect(drained[0].text).toBe('sum1')
    expect(summaryQueue.value).toHaveLength(0)
    expect(chrome.storage.local.set).toHaveBeenCalled()
  })
})

describe('loadSummaryForConv', () => {
  it('leaves signals at defaults when storage returns empty object', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({})
    await loadSummaryForConv()
    expect(highWaterMarks.value).toEqual({})
    expect(summaryQueue.value).toEqual([])
  })

  it('populates signals from stored data', async () => {
    const key = summaryKey()
    vi.mocked(chrome.storage.local.get).mockResolvedValueOnce({
      [key]: {
        highWaterMarks: { a: 2 },
        summaryQueue: [{ text: 'x', coveredTurnCounts: {}, generatedAt: 0 }],
      },
    })
    await loadSummaryForConv()
    expect(highWaterMarks.value).toEqual({ a: 2 })
    expect(summaryQueue.value).toEqual([{ text: 'x', coveredTurnCounts: {}, generatedAt: 0 }])
  })
})
