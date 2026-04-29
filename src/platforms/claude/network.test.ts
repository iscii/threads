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

describe('inject', () => {
  it('prepends context block to prompt', () => {
    const body = { prompt: 'Hello', model: 'claude-sonnet-4-6' }
    const result = claudeAdapter.inject(body, ['Prior context']) as any
    expect(result.prompt).toBe('<context>\nPrior context\n</context>\n\nHello')
  })

  it('joins multiple summaries with newlines inside context block', () => {
    const body = { prompt: 'Hello' }
    const result = claudeAdapter.inject(body, ['Summary 1', 'Summary 2']) as any
    expect(result.prompt).toBe('<context>\nSummary 1\nSummary 2\n</context>\n\nHello')
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
      turn_message_uuids: {
        human_message_uuid: 'old-human',
        assistant_message_uuid: 'old-assistant',
      },
    }
    const result = claudeAdapter.inject(body, ['Summary']) as any
    expect(result.turn_message_uuids.human_message_uuid).not.toBe('old-human')
    expect(result.turn_message_uuids.human_message_uuid).toHaveLength(36)
  })

  it('omits turn_message_uuids when not present in original', () => {
    const body = { prompt: 'Hello' }
    const result = claudeAdapter.inject(body, ['Summary']) as any
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
