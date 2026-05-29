import { claudeAdapter } from './network'

describe('urlPattern', () => {
  it('matches the completion endpoint', () => {
    expect(claudeAdapter.urlPattern.test(
      '/api/organizations/org123/chat_conversations/conv456/completion'
    )).toBe(true)
  })

  it('does not match unrelated endpoints', () => {
    expect(claudeAdapter.urlPattern.test('/api/organizations/org123/other')).toBe(false)
    expect(claudeAdapter.urlPattern.test('/api/other')).toBe(false)
    expect(claudeAdapter.urlPattern.test('')).toBe(false)
  })
})

describe('history.urlPattern', () => {
  it('matches the conversation GET endpoint', () => {
    expect(claudeAdapter.history!.urlPattern.test(
      'https://claude.ai/api/organizations/org123/chat_conversations/conv456?tree=True'
    )).toBe(true)
  })
})

describe('inject', () => {
  it('prepends threads-context block to prompt', () => {
    const result = claudeAdapter.inject({ prompt: 'Hello', model: 'claude-sonnet-4-6' }, ['Prior context'])
    expect(result.injected).toBe(true)
    expect((result.body as any).prompt).toBe('<threads-context>\nPrior context\n</threads-context>\n\nHello')
  })

  it('joins multiple summaries with newlines inside context block', () => {
    const result = claudeAdapter.inject({ prompt: 'Hello' }, ['Summary 1', 'Summary 2'])
    expect((result.body as any).prompt).toBe('<threads-context>\nSummary 1\nSummary 2\n</threads-context>\n\nHello')
  })

  it('preserves all other fields', () => {
    const result = claudeAdapter.inject({ prompt: 'Hello', model: 'claude-sonnet-4-6', timezone: 'America/New_York' }, ['Summary'])
    expect((result.body as any).model).toBe('claude-sonnet-4-6')
    expect((result.body as any).timezone).toBe('America/New_York')
  })

  it('regenerates turn_message_uuids when present', () => {
    const body = {
      prompt: 'Hello',
      turn_message_uuids: { human_message_uuid: 'old-human', assistant_message_uuid: 'old-asst' },
    }
    const result = claudeAdapter.inject(body, ['Summary'])
    expect((result.body as any).turn_message_uuids.human_message_uuid).not.toBe('old-human')
    expect((result.body as any).turn_message_uuids.human_message_uuid).toHaveLength(36)
  })

  it('omits turn_message_uuids when not present in original', () => {
    const result = claudeAdapter.inject({ prompt: 'Hello' }, ['Summary'])
    expect((result.body as any).turn_message_uuids).toBeUndefined()
  })

  it('does not mutate the original body', () => {
    const body = { prompt: 'Hello' }
    claudeAdapter.inject(body, ['Summary'])
    expect(body.prompt).toBe('Hello')
  })

  it('returns injected: false for unrecognized body shapes', () => {
    expect(claudeAdapter.inject(null, ['Summary']).injected).toBe(false)
    expect(claudeAdapter.inject(42, ['Summary']).injected).toBe(false)
    expect(claudeAdapter.inject('string', ['Summary']).injected).toBe(false)
    expect(claudeAdapter.inject({}, ['Summary']).injected).toBe(false)
  })
})

describe('history.filter', () => {
  it('strips injected threads-context block from human message text', () => {
    const body = {
      chat_messages: [{
        sender: 'human',
        content: [{ type: 'text', text: '<threads-context>\nSummary\n</threads-context>\n\nHello' }],
      }],
    }
    const result = claudeAdapter.history!.filter(body) as any
    expect(result.chat_messages[0].content[0].text).toBe('Hello')
  })

  it('leaves assistant messages untouched', () => {
    const body = {
      chat_messages: [{ sender: 'assistant', content: [{ type: 'text', text: 'Response' }] }],
    }
    const result = claudeAdapter.history!.filter(body) as any
    expect(result.chat_messages[0].content[0].text).toBe('Response')
  })

  it('leaves human messages without context block untouched', () => {
    const body = {
      chat_messages: [{ sender: 'human', content: [{ type: 'text', text: 'Just a message' }] }],
    }
    const result = claudeAdapter.history!.filter(body) as any
    expect(result.chat_messages[0].content[0].text).toBe('Just a message')
  })

  it('leaves non-text content blocks untouched', () => {
    const body = {
      chat_messages: [{ sender: 'human', content: [{ type: 'image', source: 'data:...' }] }],
    }
    const result = claudeAdapter.history!.filter(body) as any
    expect(result.chat_messages[0].content[0]).toEqual({ type: 'image', source: 'data:...' })
  })

  it('returns body unchanged for unrecognized shapes', () => {
    expect(claudeAdapter.history!.filter(null)).toBeNull()
    expect(claudeAdapter.history!.filter({ other: true })).toEqual({ other: true })
  })
})

describe('runtime value refresh', () => {
  it('replaces stale rotating token fields in captured bodies with latest observed values', () => {
    claudeAdapter.observeRuntimeValues?.('/api/bootstrap', {
      nested: { client_nonce: 'fresh-nonce' },
      token: 'fresh-token',
      prompt: 'do-not-copy',
    })

    const refreshed = claudeAdapter.refreshCapturedBody?.({
      prompt: 'persisted prompt',
      token: 'stale-token',
      nested: { client_nonce: 'stale-nonce' },
    }) as any

    expect(refreshed.prompt).toBe('persisted prompt')
    expect(refreshed.token).toBe('fresh-token')
    expect(refreshed.nested.client_nonce).toBe('fresh-nonce')
  })

  it('does not introduce rotating fields that were not in the captured completion shape', () => {
    claudeAdapter.observeRuntimeValues?.('/api/bootstrap', { token: 'fresh-token' })

    const refreshed = claudeAdapter.refreshCapturedBody?.({ prompt: 'persisted prompt' }) as any

    expect(refreshed).toEqual({ prompt: 'persisted prompt' })
  })
})

describe('buildCompletion', () => {
  it('spreads base body and substitutes prompt', () => {
    const base = { prompt: 'original', model: 'claude-sonnet-4-6', other: 'value' }
    const result = claudeAdapter.buildCompletion(base, 'new prompt') as any
    expect(result.prompt).toBe('new prompt')
    expect(result.other).toBe('value')
    expect(result.model).toBe('claude-sonnet-4-6')
  })

  it('overrides model when provided', () => {
    const base = { prompt: 'x', model: 'claude-sonnet-4-6' }
    const result = claudeAdapter.buildCompletion(base, 'x', 'claude-haiku-4-5-20251001') as any
    expect(result.model).toBe('claude-haiku-4-5-20251001')
  })

  it('generates fresh turn_message_uuids', () => {
    const base = {
      prompt: 'x',
      turn_message_uuids: { human_message_uuid: 'old-h', assistant_message_uuid: 'old-a' },
    }
    const result = claudeAdapter.buildCompletion(base, 'x') as any
    expect(result.turn_message_uuids.human_message_uuid).not.toBe('old-h')
    expect(result.turn_message_uuids.human_message_uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('returns body unchanged when not a prompt body', () => {
    const notPrompt = { messages: [] }
    const result = claudeAdapter.buildCompletion(notPrompt, 'x')
    expect(result).toBe(notPrompt)
  })
})
