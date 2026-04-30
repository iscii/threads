import type { DOMAdapter } from '@/types'

export const claudeDOMAdapter: DOMAdapter = {
  findScrollContainer() {
    return document.querySelector(
      'div[class*="overflow-y-auto"][class*="pt-6"]',
    )
  },

  findAssistantTurns(root) {
    return Array.from(root.querySelectorAll('[data-is-streaming]'))
  },

  isStreamingComplete(turn) {
    return turn.getAttribute('data-is-streaming') === 'false'
  },

  findBlocks(turn) {
    return Array.from(turn.querySelectorAll('p.font-claude-response-body'))
  },

  findInput() {
    return document.querySelector('[contenteditable="true"]')
  },

  findHeader() {
    return document.querySelector('header.sticky')
  },
}
