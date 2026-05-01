import { render } from 'preact'
import { endpointInfo } from './lib/threads'
import { createCoordinator } from './lib/adapter'
import { initQueue } from './hooks/useQueue'
import { initSummary } from './hooks/useSummary'
import { claudePlatform } from '@/platforms/claude'
import type { Platform } from '@/types'
import { App } from './App'
import { Badge } from './components/Badge'
import contentCSS from '../styles/content.css?raw'

const platforms: Record<string, Platform> = {
  'claude.ai': claudePlatform,
}

const platform = platforms[location.hostname]
if (platform) {
  initQueue(platform.networkAdapter)
  initSummary(platform.networkAdapter)

  window.addEventListener('message', (e: MessageEvent) => {
    if (e.source !== window) return
    const d = e.data as { type?: string; url?: string; body?: unknown }
    if (d?.type === platform.networkAdapter.messages.endpointCaptured) {
      endpointInfo.value = { url: d.url!, body: d.body }
    }
  })

  const coordinator = createCoordinator(platform.domAdapter)

  let currentRoot: ShadowRoot | null = null

  function mountPreact(root: ShadowRoot): void {
    if (currentRoot && currentRoot !== root) {
      render(null, currentRoot)
    }
    currentRoot = root
    const style = document.createElement('style')
    style.textContent = platform.theme + '\n' + contentCSS
    root.appendChild(style)
    render(<App coordinator={coordinator} domAdapter={platform.domAdapter} />, root)
  }

  const shadow = coordinator.getShadowRoot()
  coordinator.setOnReset(mountPreact)
  mountPreact(shadow)

  const header = platform.domAdapter.findHeader()
  if (header) {
    const badgeRoot = document.createElement('div')
    header.appendChild(badgeRoot)
    render(<Badge />, badgeRoot)
  }
}
