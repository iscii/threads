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

describe('historyUrlPattern', () => {
  it('matches the conversation GET endpoint', () => {
    expect(claudeAdapter.historyUrlPattern!.test(
      'https://claude.ai/api/organizations/org123/chat_conversations/conv456?tree=True'
    )).toBe(true)
  })
})

describe('inject', () => {
  it('prepends threads-context block to prompt', () => {
    const body = { prompt: 'Hello', model: 'claude-sonnet-4-6' }
    const result = claudeAdapter.inject(body, ['Prior context']) as any
    expect(result.prompt).toBe('<threads-context>\nPrior context\n</threads-context>\n\nHello')
  })

  it('joins multiple summaries with newlines inside context block', () => {
    const body = { prompt: 'Hello' }
    const result = claudeAdapter.inject(body, ['Summary 1', 'Summary 2']) as any
    expect(result.prompt).toBe('<threads-context>\nSummary 1\nSummary 2\n</threads-context>\n\nHello')
  })

  it('preserves all other fields', () => {
    const body = { prompt: 'Hello', model: 'claude-sonnet-4-6', timezone: 'America/New_York' }
    const result = claudeAdapter.inject(body, ['Summary']) as any
    expect(result.model).toBe('claude-sonnet-4-6')
    expect(result.timezone).toBe('America/New_York')
  })

  it('regenerates turn_message_uuids when present', () => {
    const body = {
      prompt: 'Hello',
      turn_message_uuids: { human_message_uuid: 'old-human', assistant_message_uuid: 'old-asst' },
    }
    const result = claudeAdapter.inject(body, ['Summary']) as any
    expect(result.turn_message_uuids.human_message_uuid).not.toBe('old-human')
    expect(result.turn_message_uuids.human_message_uuid).toHaveLength(36)
  })

  it('omits turn_message_uuids when not present in original', () => {
    const result = claudeAdapter.inject({ prompt: 'Hello' }, ['Summary']) as any
    expect(result.turn_message_uuids).toBeUndefined()
  })

  it('does not mutate the original body', () => {
    const body = { prompt: 'Hello' }
    claudeAdapter.inject(body, ['Summary'])
    expect(body.prompt).toBe('Hello')
  })

  it('returns null for unrecognized body shapes', () => {
    expect(claudeAdapter.inject(null, ['Summary'])).toBeNull()
    expect(claudeAdapter.inject(42, ['Summary'])).toBeNull()
    expect(claudeAdapter.inject('string', ['Summary'])).toBeNull()
    expect(claudeAdapter.inject({}, ['Summary'])).toBeNull()
  })
})

describe('filterHistory', () => {
  it('strips injected threads-context block from human message text', () => {
    const body = {
      chat_messages: [{
        sender: 'human',
        content: [{ type: 'text', text: '<threads-context>\nSummary\n</threads-context>\n\nHello' }],
      }],
    }
    const result = claudeAdapter.filterHistory!(body) as any
    expect(result.chat_messages[0].content[0].text).toBe('Hello')
  })

  it('leaves assistant messages untouched', () => {
    const body = {
      chat_messages: [{
        sender: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
      }],
    }
    const result = claudeAdapter.filterHistory!(body) as any
    expect(result.chat_messages[0].content[0].text).toBe('Response')
  })

  it('leaves human messages without context block untouched', () => {
    const body = {
      chat_messages: [{
        sender: 'human',
        content: [{ type: 'text', text: 'Just a message' }],
      }],
    }
    const result = claudeAdapter.filterHistory!(body) as any
    expect(result.chat_messages[0].content[0].text).toBe('Just a message')
  })

  it('leaves non-text content blocks untouched', () => {
    const body = {
      chat_messages: [{
        sender: 'human',
        content: [{ type: 'image', source: 'data:...' }],
      }],
    }
    const result = claudeAdapter.filterHistory!(body) as any
    expect(result.chat_messages[0].content[0]).toEqual({ type: 'image', source: 'data:...' })
  })

  it('returns body unchanged for unrecognized shapes', () => {
    expect(claudeAdapter.filterHistory!(null)).toBeNull()
    expect(claudeAdapter.filterHistory!({ other: true })).toEqual({ other: true })
  })
})
