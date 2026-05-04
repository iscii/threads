import { convId, threadKey, summaryKey, endpointShapeKey, endpointVarsKey } from './keys'

beforeEach(() => {
  Object.defineProperty(window, 'location', {
    value: { hostname: 'claude.ai', pathname: '/chat/conv123/some-path' },
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

describe('endpointShapeKey', () => {
  it('returns end:{hostname}:shape', () => {
    expect(endpointShapeKey()).toBe('end:claude.ai:shape')
  })
})

describe('endpointVarsKey', () => {
  it('returns end:{hostname}:{convId}:vars', () => {
    expect(endpointVarsKey()).toBe('end:claude.ai:conv123:vars')
  })
})
