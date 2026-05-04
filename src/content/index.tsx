import { render } from 'preact'
import {
  initEndpointInfo,
  setEndpointShape,
  setEndpointVars,
  updateEndpointHeaders,
} from './lib/threads'
import { createCoordinator } from './lib/adapter'
import { initQueue } from './hooks/useQueue'
import { initSummary } from './hooks/useSummary'
import { claudePlatform } from '@/platforms/claude'
import type { Platform } from '@/types'
import { App } from './App'
import { Badge } from './components/Badge'
import { createDebugLogger } from '@/debug'
import contentCSS from '../styles/content.css?raw'

const debugApp = createDebugLogger('app')
const debugEndpoint = createDebugLogger('endpoint')

const platforms: Record<string, Platform> = {
  'claude.ai': claudePlatform,
}

const platform = platforms[location.hostname]
if (platform) {
  debugApp.log('platform matched', () => ({ hostname: location.hostname }))
  initEndpointInfo(platform.networkAdapter)
  initQueue(platform.networkAdapter)
  initSummary(platform.networkAdapter)

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return
    const d = e.data as {
      type?: string
      url?: string
      body?: unknown
      headers?: Record<string, string>
    }
    if (d?.type === platform.networkAdapter.messages.endpointCaptured) {
      debugEndpoint.log('endpoint capture message received', () => ({
        hasUrl: Boolean(d.url),
        body: describeValue(d.body),
        headerKeys: d.headers ? Object.keys(d.headers) : [],
      }))
      if (d.headers) {
        updateEndpointHeaders(d.headers)
      }
      if (!d.url) {
        debugEndpoint.warn('endpoint capture skipped missing url')
        return
      }

      const shape = platform.networkAdapter.captureCompletion?.(d.url, d.body)
      if (shape) {
        debugEndpoint.log('completion shape captured', () => ({
          urlTemplate: shape.url,
          body: describeValue(shape.body),
        }))
        setEndpointShape(shape)
      }

      const vars = platform.networkAdapter.captureEndpointVars?.(d.url, d.body)
      if (vars) {
        debugEndpoint.log('endpoint vars captured', () => ({
          hasOrganizationUuid: Boolean(vars.organizationUuid),
          hasConversationUuid: Boolean(vars.conversationUuid),
          hasParentMessageUuid: Boolean(vars.parentMessageUuid),
        }))
        setEndpointVars(vars)
      }
    }
  })

  const coordinator = createCoordinator(platform.domAdapter)

  let currentRoot: ShadowRoot | null = null
  let badgeRoot: HTMLDivElement | null = null

  function mountPreact(root: ShadowRoot): void {
    debugApp.log('mounting app', () => ({ replacingRoot: Boolean(currentRoot && currentRoot !== root) }))
    if (currentRoot && currentRoot !== root) {
      render(null, currentRoot)
    }
    currentRoot = root
    const style = document.createElement('style')
    style.textContent = platform.theme + '\n' + contentCSS
    root.appendChild(style)
    render(<App coordinator={coordinator} domAdapter={platform.domAdapter} />, root)
  }

  function syncBadge(): void {
    const container = platform.domAdapter.findHeaderActions()
    if (badgeRoot?.parentElement === container) return
    if (badgeRoot) {
      debugApp.log('unmounting badge')
      render(null, badgeRoot)
    }
    if (!container) {
      badgeRoot = null
      return
    }
    badgeRoot = document.createElement('div')
    container.insertBefore(badgeRoot, container.firstChild)
    render(<Badge />, badgeRoot)
    debugApp.log('badge mounted')
  }

  const shadow = coordinator.getShadowRoot()
  coordinator.setOnReset(mountPreact)
  mountPreact(shadow)
  coordinator.start()
  new MutationObserver(syncBadge).observe(document.body, { childList: true, subtree: true })
  syncBadge()
} else {
  debugApp.warn('no platform for hostname', () => ({ hostname: location.hostname }))
}

function describeValue(value: unknown): unknown {
  if (value === null) return { type: 'null' }
  if (Array.isArray(value)) return { type: 'array', length: value.length }
  if (typeof value === 'object') {
    return { type: 'object', keys: Object.keys(value as Record<string, unknown>) }
  }
  return { type: typeof value }
}
