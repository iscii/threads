import type { DOMAdapter } from '@/types'

export const chatgptDOMAdapter: DOMAdapter = {
  findScrollContainer() { return null },
  findAssistantTurns() { return [] },
  isStreamingComplete() { return false },
  findBlocks() { return [] },
  findInput() { return null },
  findHeader() { return null },
}
