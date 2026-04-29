import { claudeAdapter } from '@/platforms/claude/network'
import type { NetworkAdapter } from '@/types'
import { createFetchWatcher } from './core'

const adapters: Record<string, NetworkAdapter> = {
  'claude.ai': claudeAdapter,
}

const adapter = adapters[location.hostname]

if (adapter) {
  const originalFetch = window.fetch.bind(window)
  const { interceptFetch, handleMessage } = createFetchWatcher(adapter, originalFetch)
  window.fetch = interceptFetch
  window.addEventListener('message', handleMessage)
}
