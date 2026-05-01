import type { Platform } from '@/types'
import { deepseekDOMAdapter } from './dom'
import { deepseekAdapter } from './network'
import { deepseekTheme } from './theme'

export const deepseekPlatform: Platform = {
  domAdapter: deepseekDOMAdapter,
  networkAdapter: deepseekAdapter,
  theme: deepseekTheme,
}
