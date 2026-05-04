import { createDebugLogger } from './debug'

afterEach(() => {
  vi.restoreAllMocks()
  delete window.__THREADS_DEBUG__
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe('debug logger', () => {
  it('does not log by default', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = createDebugLogger('dom')

    logger.log('event', { value: 1 })

    expect(log).not.toHaveBeenCalled()
  })

  it('logs only enabled global channels', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    window.__THREADS_DEBUG__ = ['dom']

    createDebugLogger('dom').log('event')
    createDebugLogger('fetch-watcher').log('event')

    expect(log).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('[threads:dom] event')
  })

  it('reads enabled channels from session storage', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.sessionStorage.setItem('threads:debug', 'fetch-watcher')

    createDebugLogger('fetch-watcher').warn('failure point', { safe: true })

    expect(warn).toHaveBeenCalledWith(
      '[threads:fetch-watcher] failure point',
      { safe: true },
    )
  })
})
