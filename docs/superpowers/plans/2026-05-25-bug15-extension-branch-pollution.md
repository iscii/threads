# Bug #15: Extension Branch Pollution — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent extension-originated `/completion` requests (thread replies + summarization) from polluting Claude.ai's conversation tree and corrupting the main chat UI.

**Architecture:** All extension prompts are tagged with a marker constant. The fetch watcher's `history.filter` strips tagged message pairs from GET responses and corrects `current_leaf_message_uuid` using `lastKnownRealLeaf`, which is extracted from SSE `message_start` events in real (non-extension) POST responses. DOM cleanup removes any tagged content that renders before the filter can hide it.

**Tech Stack:** TypeScript, Vitest, Preact signals, Chrome MV3 content scripts, SSE/ReadableStream

---

## File Map

| File | Change |
|------|--------|
| `src/messaging.ts` | Add `THR_EXT_MARKER` constant |
| `src/types.ts` | Extend `NetworkAdapter.history.filter` signature to accept `lastKnownRealLeaf` |
| `src/platforms/claude/network.ts` | Extend `history.filter`: strip tagged pairs, fix `current_leaf` |
| `src/platforms/claude/network.test.ts` | Tests for new filter behavior |
| `src/fetch-watcher/core.ts` | Add `lastKnownRealLeaf` tracking from SSE; pass to filter |
| `src/fetch-watcher/core.test.ts` | Tests for `lastKnownRealLeaf` tracking |
| `src/content/hooks/useSummary.ts` | Prepend marker in `buildSummarizationPrompt` |
| `src/content/hooks/useSummary.test.ts` | Assert prompt starts with marker |
| `src/content/hooks/useQueue.ts` | Prepend marker in thread reply prompt |
| `src/content/hooks/useQueue.test.ts` | Assert prompt starts with marker (new file) |
| `src/content/lib/observer.ts` | Remove tagged turns before instrumenting |
| `src/content/lib/observer.test.ts` | Tests for tagged turn removal |

---

### Task 1: Add `THR_EXT_MARKER` constant

**Files:**
- Modify: `src/messaging.ts`

- [ ] **Step 1: Add the constant**

Open `src/messaging.ts`. After the existing `THR_CONTEXT_STRIP_RE` export, add:

```ts
export const THR_EXT_MARKER = '<threads-ext-marker/>'
```

Full file after edit:

```ts
export const MSG = {
  STAGE_SUMMARY: 'THR_STAGE_SUMMARY',
} as const

export const THR_CONTEXT_TAG = 'threads-context'
export const THR_CONTEXT_STRIP_RE = new RegExp(
  `^<${THR_CONTEXT_TAG}>\\n[\\s\\S]*?\\n<\\/${THR_CONTEXT_TAG}>\\n\\n`,
)

export const THR_EXT_MARKER = '<threads-ext-marker/>'

export interface StageSummaryMsg {
  type: typeof MSG.STAGE_SUMMARY
  summaryTexts: string[]
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/messaging.ts
git commit -m "feat: add THR_EXT_MARKER constant to messaging"
```

---

### Task 2: Update `NetworkAdapter.history.filter` signature

**Files:**
- Modify: `src/types.ts:25-28`

- [ ] **Step 1: Update the type**

In `src/types.ts`, change the `history` block from:

```ts
  history?: {
    urlPattern: RegExp
    filter(body: unknown): unknown
  }
```

to:

```ts
  history?: {
    urlPattern: RegExp
    filter(body: unknown, lastKnownRealLeaf?: string | null): unknown
  }
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```

Expected: no errors (the parameter is optional, so existing callers still compile).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: extend history.filter signature to accept lastKnownRealLeaf"
```

---

### Task 3: Extend `history.filter` to strip tagged pairs and fix `current_leaf`

**Files:**
- Modify: `src/platforms/claude/network.test.ts`
- Modify: `src/platforms/claude/network.ts`

- [ ] **Step 1: Write the failing tests**

Append a new describe block at the bottom of `src/platforms/claude/network.test.ts`:

```ts
describe('history.filter (tagged message stripping)', () => {
  function makeHistory(messages: unknown[], currentLeaf?: string): unknown {
    return {
      chat_messages: messages,
      ...(currentLeaf !== undefined ? { current_leaf_message_uuid: currentLeaf } : {}),
    }
  }

  const taggedHuman = {
    uuid: 'h-ext',
    sender: 'human',
    content: [{ type: 'text', text: '<threads-ext-marker/>\nSummarize this.' }],
  }
  const pairedAssistant = {
    uuid: 'a-ext',
    sender: 'assistant',
    parent_message_uuid: 'h-ext',
    content: [{ type: 'text', text: 'Summary result.' }],
  }
  const realHuman = {
    uuid: 'h-real',
    sender: 'human',
    content: [{ type: 'text', text: 'Hello' }],
  }
  const realAssistant = {
    uuid: 'a-real',
    sender: 'assistant',
    parent_message_uuid: 'h-real',
    content: [{ type: 'text', text: 'Hi there.' }],
  }

  it('strips tagged human+assistant pair, keeps real messages', () => {
    const body = makeHistory([realHuman, realAssistant, taggedHuman, pairedAssistant])
    const result = claudeAdapter.history!.filter(body) as { chat_messages: { uuid: string }[] }
    expect(result.chat_messages).toHaveLength(2)
    expect(result.chat_messages.map(m => m.uuid)).toEqual(['h-real', 'a-real'])
  })

  it('strips tagged human with no paired assistant (mid-stream stop)', () => {
    const body = makeHistory([realHuman, realAssistant, taggedHuman])
    const result = claudeAdapter.history!.filter(body) as { chat_messages: { uuid: string }[] }
    expect(result.chat_messages).toHaveLength(2)
    expect(result.chat_messages.map(m => m.uuid)).toEqual(['h-real', 'a-real'])
  })

  it('strips multiple tagged pairs', () => {
    const taggedHuman2 = {
      uuid: 'h-ext2',
      sender: 'human',
      content: [{ type: 'text', text: '<threads-ext-marker/>\nOther prompt.' }],
    }
    const pairedAssistant2 = {
      uuid: 'a-ext2',
      sender: 'assistant',
      parent_message_uuid: 'h-ext2',
      content: [{ type: 'text', text: 'Other result.' }],
    }
    const body = makeHistory([taggedHuman, pairedAssistant, taggedHuman2, pairedAssistant2, realHuman, realAssistant])
    const result = claudeAdapter.history!.filter(body) as { chat_messages: { uuid: string }[] }
    expect(result.chat_messages).toHaveLength(2)
    expect(result.chat_messages.map(m => m.uuid)).toEqual(['h-real', 'a-real'])
  })

  it('overrides current_leaf_message_uuid when it points to a stripped message', () => {
    const body = makeHistory([realHuman, realAssistant, taggedHuman, pairedAssistant], 'a-ext')
    const result = claudeAdapter.history!.filter(body, 'a-real') as { current_leaf_message_uuid: string }
    expect(result.current_leaf_message_uuid).toBe('a-real')
  })

  it('leaves current_leaf_message_uuid when it points to a real message', () => {
    const body = makeHistory([realHuman, realAssistant, taggedHuman, pairedAssistant], 'a-real')
    const result = claudeAdapter.history!.filter(body, 'a-real') as { current_leaf_message_uuid: string }
    expect(result.current_leaf_message_uuid).toBe('a-real')
  })

  it('leaves current_leaf_message_uuid unchanged when lastKnownRealLeaf is not available', () => {
    const body = makeHistory([taggedHuman, pairedAssistant], 'a-ext')
    const result = claudeAdapter.history!.filter(body, null) as { current_leaf_message_uuid: string }
    expect(result.current_leaf_message_uuid).toBe('a-ext')
  })

  it('still strips threads-context from regular human message text', () => {
    const body = makeHistory([{
      uuid: 'h1',
      sender: 'human',
      content: [{ type: 'text', text: '<threads-context>\nSummary\n</threads-context>\n\nHello' }],
    }])
    const result = claudeAdapter.history!.filter(body) as { chat_messages: { content: { text: string }[] }[] }
    expect(result.chat_messages[0].content[0].text).toBe('Hello')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose src/platforms/claude/network.test.ts
```

Expected: the new `history.filter (tagged message stripping)` tests FAIL. Existing tests should still pass.

- [ ] **Step 3: Implement the extended filter in `network.ts`**

Add this import at the top of `src/platforms/claude/network.ts`:

```ts
import { THR_CONTEXT_TAG, THR_CONTEXT_STRIP_RE, THR_EXT_MARKER } from '@/messaging'
```

Replace the existing `history` block in `claudeAdapter`:

```ts
  history: {
    urlPattern: /\/api\/organizations\/[^/]+\/chat_conversations\/[^/?]+/,

    filter(body: unknown, lastKnownRealLeaf?: string | null): unknown {
      if (!isConversationBody(body)) return body

      // Collect UUIDs of tagged human messages
      const taggedHumanUUIDs = new Set<string>()
      for (const msg of body.chat_messages) {
        if (msg.sender === 'human') {
          const firstText = msg.content.find(b => b.type === 'text')?.text
          if (typeof firstText === 'string' && firstText.startsWith(THR_EXT_MARKER)) {
            const uuid = stringValue(msg.uuid)
            if (uuid) taggedHumanUUIDs.add(uuid)
          }
        }
      }

      // Collect UUIDs of their paired assistant responses
      const strippedUUIDs = new Set<string>(taggedHumanUUIDs)
      for (const msg of body.chat_messages) {
        if (msg.sender === 'assistant') {
          const parent = stringValue(msg.parent_message_uuid)
          if (parent && taggedHumanUUIDs.has(parent)) {
            const uuid = stringValue(msg.uuid)
            if (uuid) strippedUUIDs.add(uuid)
          }
        }
      }

      const chat_messages = body.chat_messages
        .filter(msg => {
          const uuid = stringValue(msg.uuid)
          return !uuid || !strippedUUIDs.has(uuid)
        })
        .map(msg => {
          if (msg.sender !== 'human') return msg
          return {
            ...msg,
            content: msg.content.map(block =>
              block.type === 'text'
                ? { ...block, text: block.text.replace(THR_CONTEXT_STRIP_RE, '') }
                : block
            ),
          }
        })

      const bodyAny = body as Record<string, unknown>
      const currentLeaf = stringValue(bodyAny.current_leaf_message_uuid)
      const fixedLeaf =
        currentLeaf && strippedUUIDs.has(currentLeaf) && lastKnownRealLeaf
          ? lastKnownRealLeaf
          : currentLeaf

      return {
        ...body,
        chat_messages,
        ...(fixedLeaf !== undefined ? { current_leaf_message_uuid: fixedLeaf } : {}),
      }
    },
  },
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/platforms/claude/network.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platforms/claude/network.ts src/platforms/claude/network.test.ts
git commit -m "feat: strip tagged extension messages from history.filter and fix current_leaf"
```

---

### Task 4: Track `lastKnownRealLeaf` from SSE `message_start` in fetch watcher

**Files:**
- Modify: `src/fetch-watcher/core.test.ts`
- Modify: `src/fetch-watcher/core.ts`

- [ ] **Step 1: Write the failing tests**

Append a new describe block at the bottom of `src/fetch-watcher/core.test.ts`:

```ts
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
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --reporter=verbose src/fetch-watcher/core.test.ts
```

Expected: the three new `lastKnownRealLeaf tracking` tests FAIL. Existing tests still pass.

- [ ] **Step 3: Implement in `core.ts`**

In `src/fetch-watcher/core.ts`, make these changes:

**a) Add `lastKnownRealLeaf` to the `createFetchWatcher` closure** (after `let stagedSummaries`):

```ts
  let stagedSummaries: string[] = []
  let lastKnownRealLeaf: string | null = null
```

**b) In `interceptFetch`, before the `tee()` call, compute `isExtensionRequest`:**

Find the block that starts with `const [s1, s2] = response.body.tee()` and add the flag before it. The full updated section looks like:

```ts
    const response = await originalFetch(input, modifiedInit)
    if (!response.body) {
      if (injected) {
        window.postMessage({ type: adapter.messages.summaryInjected }, location.origin)
      }
      window.postMessage({ type: adapter.messages.streamComplete }, location.origin)
      return response
    }

    const isExtensionRequest =
      typeof (body as { prompt?: unknown })?.prompt === 'string' &&
      (body as { prompt: string }).prompt.startsWith('<threads-ext-marker/>')

    const [s1, s2] = response.body.tee()
```

**c) Replace the `s2` reader IIFE** with this version that parses `message_start`:

```ts
    void (async () => {
      const reader = s2.getReader()
      const decoder = new TextDecoder()
      let leafExtracted = false
      let sseBuffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = value !== undefined ? decoder.decode(value) : ''
          if (!isExtensionRequest && !leafExtracted && chunk) {
            sseBuffer += chunk
            const dataLine = sseBuffer.split('\n').find(l => l.startsWith('data:'))
            if (dataLine) {
              leafExtracted = true
              try {
                const parsed = JSON.parse(dataLine.slice(5).trim()) as {
                  type?: string
                  message?: { uuid?: string }
                }
                if (
                  parsed.type === 'message_start' &&
                  typeof parsed.message?.uuid === 'string'
                ) {
                  lastKnownRealLeaf = parsed.message.uuid
                }
              } catch {
                // non-JSON data line — ignore
              }
            }
          }
          if (chunk && adapter.isStreamDone?.(chunk)) break
        }
      } finally {
        reader.releaseLock()
        window.postMessage({ type: adapter.messages.streamComplete }, location.origin)
      }
    })()
```

**d) Update the GET history handler** to pass `lastKnownRealLeaf` to `filter`:

Find this line in the GET branch:

```ts
      return new Response(JSON.stringify(adapter.history.filter(json)), {
```

Change it to:

```ts
      return new Response(JSON.stringify(adapter.history.filter(json, lastKnownRealLeaf)), {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --reporter=verbose src/fetch-watcher/core.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/fetch-watcher/core.ts src/fetch-watcher/core.test.ts
git commit -m "feat: track lastKnownRealLeaf from SSE message_start in fetch watcher"
```

---

### Task 5: Tag extension prompts with `THR_EXT_MARKER`

**Files:**
- Modify: `src/content/hooks/useSummary.ts`
- Modify: `src/content/hooks/useSummary.test.ts`
- Modify: `src/content/hooks/useQueue.ts`
- Create: `src/content/hooks/useQueue.test.ts`

#### Part A — `useSummary.ts`

- [ ] **Step 1: Add a failing test to `useSummary.test.ts`**

In the existing `triggerSummarization` describe block, add this test after the last `it(...)`:

```ts
  it('prefixes the summarization prompt with threads-ext-marker', async () => {
    const adapter = makeAdapter()
    initSummary(adapter)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('{"block1":"updated summary"}')))

    await triggerSummarization()

    const fetchInit = vi.mocked(fetch).mock.calls[0][1] as RequestInit
    const body = JSON.parse(fetchInit.body as string) as { prompt: string }
    expect(body.prompt.startsWith('<threads-ext-marker/>')).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

```bash
npm test -- --reporter=verbose src/content/hooks/useSummary.test.ts
```

Expected: the new test FAILS (prompt does not start with marker yet). Existing tests pass.

- [ ] **Step 3: Implement in `useSummary.ts`**

Add `THR_EXT_MARKER` to the import at the top of `src/content/hooks/useSummary.ts`:

```ts
import { THR_EXT_MARKER } from '@/messaging'
```

In `buildSummarizationPrompt`, prepend the marker as the first line of the returned array:

```ts
  return [
    THR_EXT_MARKER,
    'You are a summarization assistant. Given the thread of messages and an existing summary',
    'return an updated one-sentence summary that captures the key topic and emphasizing new information from the new messages.',
    'Please respond only with a valid JSON object.',
    'Keys are thread IDs, values are one-sentence summaries. No preamble, no explanation.',
    '',
    ...blocks,
  ].join('\n')
```

- [ ] **Step 4: Run to verify tests pass**

```bash
npm test -- --reporter=verbose src/content/hooks/useSummary.test.ts
```

Expected: all tests PASS.

#### Part B — `useQueue.ts`

- [ ] **Step 5: Create `useQueue.test.ts` with a failing test**

Create `src/content/hooks/useQueue.test.ts`:

```ts
import type { NetworkAdapter } from '@/types'
import { threads, endpointInfo } from '../lib/threads'
import { initQueue, sendThreadReply } from './useQueue'

function makeAdapter(): NetworkAdapter {
  return {
    urlPattern: /completion/,
    messages: {
      endpointCaptured: 'endpoint',
      summaryInjected: 'summary',
      streamComplete: 'stream',
    },
    inject: vi.fn(),
    buildCompletion: vi.fn((_, prompt: string) => ({ prompt })),
  }
}

function sse(text: string): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ completion: text })}\n\n`))
        controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
        controller.close()
      },
    }),
  )
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
  threads.value = [
    {
      id: 'thread1',
      blockId: 'block1',
      blockText: 'source passage',
      messages: [{ role: 'user', content: 'Hi' }],
      included: true,
      isTyping: false,
      isOpen: true,
    },
  ]
  endpointInfo.value = { url: '/completion', body: { prompt: '' } }
})

describe('sendThreadReply', () => {
  it('prefixes prompt with threads-ext-marker', async () => {
    const adapter = makeAdapter()
    initQueue(adapter)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sse('The answer.')))

    await sendThreadReply('thread1', 'What is this?')

    expect(adapter.buildCompletion).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/^<threads-ext-marker\/>/),
    )
  })
})
```

- [ ] **Step 6: Run to verify it fails**

```bash
npm test -- --reporter=verbose src/content/hooks/useQueue.test.ts
```

Expected: the new test FAILS.

- [ ] **Step 7: Implement in `useQueue.ts`**

Add `THR_EXT_MARKER` to the import at the top of `src/content/hooks/useQueue.ts`:

```ts
import { THR_EXT_MARKER } from '@/messaging'
```

On line 55, change the prompt construction from:

```ts
  const prompt = `${systemPrompt}\n\n${history}\n\nAssistant:`
```

to:

```ts
  const prompt = `${THR_EXT_MARKER}\n\n${systemPrompt}\n\n${history}\n\nAssistant:`
```

- [ ] **Step 8: Run to verify tests pass**

```bash
npm test -- --reporter=verbose src/content/hooks/useQueue.test.ts
```

Expected: test PASSES.

- [ ] **Step 9: Run all tests to verify no regressions**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add src/content/hooks/useSummary.ts src/content/hooks/useSummary.test.ts \
        src/content/hooks/useQueue.ts src/content/hooks/useQueue.test.ts
git commit -m "feat: prefix extension prompts with THR_EXT_MARKER"
```

---

### Task 6: DOM cleanup — remove tagged turns in observer

**Files:**
- Modify: `src/content/lib/observer.test.ts`
- Modify: `src/content/lib/observer.ts`

- [ ] **Step 1: Write the failing tests**

In `src/content/lib/observer.test.ts`, update `makeAdapter` to include the two missing DOMAdapter methods (needed for TypeScript to compile cleanly):

Find the `makeAdapter` function and add the two missing fields:

```ts
function makeAdapter(container: Element, overrides: Partial<DOMAdapter> = {}): DOMAdapter {
  return {
    findScrollContainer: () => container,
    findAssistantTurns: (root) => Array.from(root.querySelectorAll('[data-is-streaming]')),
    isStreamingComplete: (el) => el.getAttribute('data-is-streaming') === 'false',
    findBlocks: (turn) => Array.from(turn.querySelectorAll('p.thr-blk')),
    findInput: () => null,
    findHeader: () => null,
    findChatContainer: () => null,
    findHeaderActions: () => null,
    ...overrides,
  }
}
```

Then append a new describe block at the bottom of the file:

```ts
describe('tagged turn removal', () => {
  it('removes a complete turn containing the ext marker on init scan', () => {
    const container = document.createElement('div')
    const turn = makeTurn(false, ['<threads-ext-marker/>\nSummarize this.'])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    expect(onBlocksFound).not.toHaveBeenCalled()
    expect(document.contains(turn)).toBe(false)
  })

  it('removes a tagged turn added via childList mutation without instrumenting it', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()

    const turn = makeTurn(false, ['<threads-ext-marker/>\nSummarize this.'])
    container.appendChild(turn)
    await Promise.resolve()

    expect(onBlocksFound).not.toHaveBeenCalled()
    expect(document.contains(turn)).toBe(false)
  })

  it('removes a tagged turn when data-is-streaming flips to false', async () => {
    const container = document.createElement('div')
    const turn = makeTurn(true, ['<threads-ext-marker/>\nSummarize this.'])
    container.appendChild(turn)
    document.body.appendChild(container)

    const onBlocksFound = vi.fn()
    const obs = createObserver(
      makeAdapter(container),
      { onBlocksFound, onConversationChanged: vi.fn() },
      () => {},
    )
    obs.start()
    expect(onBlocksFound).not.toHaveBeenCalled()

    turn.setAttribute('data-is-streaming', 'false')
    await Promise.resolve()

    expect(onBlocksFound).not.toHaveBeenCalled()
    expect(document.contains(turn)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify the new tests fail**

```bash
npm test -- --reporter=verbose src/content/lib/observer.test.ts
```

Expected: the three new `tagged turn removal` tests FAIL. Existing tests still pass.

- [ ] **Step 3: Implement in `observer.ts`**

Add `THR_EXT_MARKER` to the import at the top of `src/content/lib/observer.ts`:

```ts
import { THR_EXT_MARKER } from '@/messaging'
```

In `instrumentTurn`, add the marker check as the second guard (after the `instrumented.has` check, before `isStreamingComplete`):

```ts
  function instrumentTurn(turn: Element): void {
    if (instrumented.has(turn)) return
    if (turn.textContent?.includes(THR_EXT_MARKER)) {
      turn.remove()
      return
    }
    if (!adapter.isStreamingComplete(turn)) return
    const blocks = adapter.findBlocks(turn)
    if (blocks.length === 0) return
    instrumented.add(turn)
    callbacks.onBlocksFound(blocks.map(toDescriptor))
  }
```

- [ ] **Step 4: Run to verify all tests pass**

```bash
npm test -- --reporter=verbose src/content/lib/observer.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/content/lib/observer.ts src/content/lib/observer.test.ts
git commit -m "feat: remove tagged extension turns from DOM before instrumenting"
```

---

### Task 7: Final integration check

- [ ] **Step 1: Build the extension**

```bash
npm run build
```

Expected: build succeeds with no errors.

- [ ] **Step 2: Run all tests one final time**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Commit (if any build artifacts changed)**

If `dist/` is tracked and changed:

```bash
git add dist/
git commit -m "chore: rebuild dist after bug #15 fix"
```
