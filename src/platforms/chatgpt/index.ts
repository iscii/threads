import type { Platform } from '@/types'
import { chatgptDOMAdapter } from './dom'
import { chatgptAdapter } from './network'
import { chatgptTheme } from './theme'

export const chatgptPlatform: Platform = {
  domAdapter: chatgptDOMAdapter,
  networkAdapter: chatgptAdapter,
  theme: chatgptTheme,
}
