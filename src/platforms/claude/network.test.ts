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

describe('inject — string content', () => {
  it('prepends context block to last user message', () => {
    const body = {
      messages: [
        { role: 'assistant', content: 'Hi there' },
        { role: 'user', content: 'Hello' },
      ],
    }
    const result = claudeAdapter.inject(body, ['Prior context']) as any
    expect(result.messages[1].content).toBe(
      '<context>\nPrior context\n</context>\n\nHello'
    )
  })

  it('targets the last user message when multiple exist', () => {
    const body = {
      messages: [
        { role: 'user', content: 'First message' },
        { role: 'assistant', content: 'Reply' },
        { role: 'user', content: 'Second message' },
      ],
    }
    const result = claudeAdapter.inject(body, ['Summary']) as any
    expect(result.messages[0].content).toBe('First message')
    expect(result.messages[2].content).toBe('<context>\nSummary\n</context>\n\nSecond message')
  })

  it('joins multiple summaries with newlines inside context block', () => {
    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    const result = claudeAdapter.inject(body, ['Summary 1', 'Summary 2']) as any
    expect(result.messages[0].content).toBe(
      '<context>\nSummary 1\nSummary 2\n</context>\n\nHello'
    )
  })

  it('does not mutate the original body', () => {
    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    claudeAdapter.inject(body, ['Summary'])
    expect(body.messages[0].content).toBe('Hello')
  })
})

describe('inject — block content', () => {
  it('inserts a context text block at the front of a content array', () => {
    const body = {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }],
    }
    const result = claudeAdapter.inject(body, ['Prior context']) as any
    expect(result.messages[0].content).toEqual([
      { type: 'text', text: '<context>\nPrior context\n</context>\n\n' },
      { type: 'text', text: 'Hello' },
    ])
  })
})

describe('inject — turn_message_uuids', () => {
  it('regenerates uuids when present', () => {
    const body = {
      messages: [{ role: 'user', content: 'Hello' }],
      turn_message_uuids: {
        human_message_uuid: 'old-human',
        assistant_message_uuid: 'old-assistant',
      },
    }
    const result = claudeAdapter.inject(body, ['Summary']) as any
    expect(result.turn_message_uuids.human_message_uuid).not.toBe('old-human')
    expect(result.turn_message_uuids.assistant_message_uuid).not.toBe('old-assistant')
    expect(result.turn_message_uuids.human_message_uuid).toHaveLength(36)
  })

  it('omits turn_message_uuids when not present in original', () => {
    const body = { messages: [{ role: 'user', content: 'Hello' }] }
    const result = claudeAdapter.inject(body, ['Summary']) as any
    expect(result.turn_message_uuids).toBeUndefined()
  })
})

describe('inject — null returns', () => {
  it('returns null when no user message found', () => {
    const body = { messages: [{ role: 'assistant', content: 'Hi' }] }
    expect(claudeAdapter.inject(body, ['Summary'])).toBeNull()
  })

  it('returns null for non-messages-array body', () => {
    expect(claudeAdapter.inject({ prompt: 'old format' }, ['Summary'])).toBeNull()
    expect(claudeAdapter.inject(null, ['Summary'])).toBeNull()
    expect(claudeAdapter.inject(42, ['Summary'])).toBeNull()
    expect(claudeAdapter.inject('string', ['Summary'])).toBeNull()
  })
})
