import { convId, threadKey, summaryKey } from './keys'

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { pathname: '/chat/conv123/some-path' },
    configurable: true,
  })
})

describe('convId', () => {
  it('extracts conversation id from /chat/{id}/ pathname', () => {
    expect(convId()).toBe('conv123')
  })

  it('returns empty string when no /chat/ segment', () => {
    Object.defineProperty(window, 'location', {
      value: { pathname: '/not-chat/page' },
      configurable: true,
    })
    expect(convId()).toBe('')
  })
})

describe('threadKey', () => {
  it('returns thr:{convId}:{blockId}', () => {
    expect(threadKey('abc12345')).toBe('thr:conv123:abc12345')
  })
})

describe('summaryKey', () => {
  it('returns sum:{convId}', () => {
    expect(summaryKey()).toBe('sum:conv123')
  })
})
