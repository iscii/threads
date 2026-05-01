import type { Platform } from '@/types'
import { claudeDOMAdapter } from './dom'
import { claudeAdapter } from './network'
import { claudeTheme } from './theme'

export const claudePlatform: Platform = {
  domAdapter: claudeDOMAdapter,
  networkAdapter: claudeAdapter,
  theme: claudeTheme,
}
