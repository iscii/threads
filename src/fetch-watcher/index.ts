import { claudeAdapter } from '@/platforms/claude/network'
import type { NetworkAdapter } from '@/types'
import { createFetchWatcher } from './core'
import { createDebugLogger } from '@/debug'

const debug = createDebugLogger('fetch-watcher')

const adapters: Record<string, NetworkAdapter> = {
  'claude.ai': claudeAdapter,
}

const adapter = adapters[location.hostname]

if (adapter) {
  debug.log('fetch watcher installing', () => ({ hostname: location.hostname }))
  const originalFetch = window.fetch.bind(window)
  const { interceptFetch, handleMessage } = createFetchWatcher(adapter, originalFetch)
  window.fetch = interceptFetch
  window.addEventListener('message', handleMessage)
} else {
  debug.warn('fetch watcher skipped unsupported hostname', () => ({ hostname: location.hostname }))
}
