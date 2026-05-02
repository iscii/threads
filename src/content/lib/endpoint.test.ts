import { sameOriginURL } from './endpoint'

describe('sameOriginURL', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'location', {
      value: new URL('https://claude.ai/chat/test'),
      configurable: true,
    })
  })

  it('allows same-origin absolute URLs', () => {
    expect(sameOriginURL('https://claude.ai/api/append_message')).toBe('https://claude.ai/api/append_message')
  })

  it('resolves and allows same-origin relative URLs', () => {
    expect(sameOriginURL('/api/append_message')).toBe('https://claude.ai/api/append_message')
  })

  it('rejects cross-origin URLs before credentialed fetches', () => {
    expect(sameOriginURL('https://evil.example/api/append_message')).toBeNull()
  })

  it('rejects malformed URLs', () => {
    expect(sameOriginURL('http://%')).toBeNull()
  })
})
