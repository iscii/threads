import type { DOMAdapter } from '@/types'

export const deepseekDOMAdapter: DOMAdapter = {
  findScrollContainer() { return null },
  findAssistantTurns() { return [] },
  isStreamingComplete() { return false },
  findBlocks() { return [] },
  findInput() { return null },
  findHeader() { return null },
}
