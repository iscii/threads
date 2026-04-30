import type { DOMAdapter } from '@/types'

export const claudeDOMAdapter: DOMAdapter = {
  findScrollContainer() {
    const turn = document.querySelector('[data-is-streaming]')
    if (turn) {
      let el: Element | null = turn.parentElement
      while (el && el !== document.body) {
        if (getComputedStyle(el).overflowY === 'auto') return el
        el = el.parentElement
      }
    }
    return document.querySelector('main')
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
