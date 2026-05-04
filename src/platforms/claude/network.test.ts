import { claudeAdapter } from './network'

describe('isStreamDone', () => {
  it('returns true when chunk contains data: [DONE]', () => {
    expect(claudeAdapter.isStreamDone!('data: [DONE]\n')).toBe(true)
    expect(claudeAdapter.isStreamDone!('data: {"completion":"hi"}\n\ndata: [DONE]\n')).toBe(true)
  })

  it('returns false for regular data chunks', () => {
    expect(claudeAdapter.isStreamDone!('data: {"completion":"hello"}\n')).toBe(false)
    expect(claudeAdapter.isStreamDone!('')).toBe(false)
  })
})

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

describe('endpoint capture', () => {
  const completionUrl =
    '/api/organizations/org123/chat_conversations/conv456/completion'

  it('stores a sanitized generic completion shape', () => {
    const result = claudeAdapter.captureCompletion!(completionUrl, {
      prompt: 'secret user prompt',
      parent_message_uuid: 'parent-old',
      turn_message_uuids: {
        human_message_uuid: 'human-old',
        assistant_message_uuid: 'assistant-old',
      },
      attachments: [],
      files: [],
      locale: 'en-US',
      model: 'claude-sonnet-4-6',
      personalized_styles: [{ type: 'default' }],
      rendering_mode: 'messages',
      sync_sources: [],
      timezone: 'America/New_York',
      tools: [{ name: 'web_search', type: 'web_search_v0' }],
      extra_secret: 'do-not-store',
    }) as any

    expect(result.url).toBe(
      '/api/organizations/{organizationUuid}/chat_conversations/{conversationUuid}/completion',
    )
    expect(result.body.prompt).toBe('')
    expect(result.body.model).toBe('claude-haiku-4-5-20251001')
    expect(result.body.parent_message_uuid).toBeUndefined()
    expect(result.body.turn_message_uuids).toBeUndefined()
    expect(result.body.extra_secret).toBeUndefined()
    expect(result.body.tools).toEqual([{ name: 'web_search', type: 'web_search_v0' }])
  })

  it('captures conversation variables from completion requests', () => {
    const vars = claudeAdapter.captureEndpointVars!(completionUrl, {
      prompt: 'x',
      parent_message_uuid: 'parent1',
    })

    expect(vars).toEqual({
      organizationUuid: 'org123',
      conversationUuid: 'conv456',
      parentMessageUuid: 'parent1',
    })
  })

  it('captures conversation variables from history responses', () => {
    const vars = claudeAdapter.captureEndpointVars!(
      '/api/organizations/org123/chat_conversations/conv456?tree=True',
      {
        chat_messages: [
          { uuid: 'human1', sender: 'human', content: [] },
          { uuid: 'assistant1', sender: 'assistant', content: [] },
        ],
      },
    )

    expect(vars).toEqual({
      organizationUuid: 'org123',
      conversationUuid: 'conv456',
      parentMessageUuid: 'assistant1',
    })
  })

  it('builds a concrete haiku endpoint from shape and variables', () => {
    const built = claudeAdapter.buildEndpoint!(
      {
        url: '/api/organizations/{organizationUuid}/chat_conversations/{conversationUuid}/completion',
        body: { prompt: '', model: 'claude-sonnet-4-6' },
      },
      {
        organizationUuid: 'org123',
        conversationUuid: 'conv456',
        parentMessageUuid: 'parent1',
      },
    ) as any

    expect(built.url).toBe(completionUrl)
    expect(built.body.model).toBe('claude-haiku-4-5-20251001')
    expect(built.body.parent_message_uuid).toBe('parent1')
  })
})
