import type { DOMAdapter } from '@/types'

export const claudeDOMAdapter: DOMAdapter = {
  findScrollContainer() {
    return document.querySelector('[data-autoscroll-container]')
  },

  findAssistantTurns(root) {
    return Array.from(root.querySelectorAll('[data-is-streaming]'))
  },

  isStreamingComplete(turn) {
    return turn.getAttribute('data-is-streaming') === 'false'
  },

  findBlocks(turn) {
    return Array.from(turn.querySelectorAll('p.font-claude-response-body, li.font-claude-response-body'))
  },

  findInput() {
    return document.querySelector('[contenteditable="true"]')
  },

  findHeader() {
    return document.querySelector('header.sticky')
  },

  findChatContainer() {
    return document.querySelector('[data-autoscroll-container] div.max-w-3xl.px-4')
  },

  findHeaderActions() {
    return document.querySelector('[data-testid="wiggle-controls-actions"]')
  },
}
