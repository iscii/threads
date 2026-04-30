import { claudeDOMAdapter } from './dom'

describe('findScrollContainer', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('finds the element with overflow-y-auto and pt-6 classes', () => {
    const el = document.createElement('div')
    el.className = 'overflow-y-auto overflow-x-hidden pt-6 flex-1'
    document.body.appendChild(el)
    expect(claudeDOMAdapter.findScrollContainer()).toBe(el)
  })

  it('returns null when not present', () => {
    expect(claudeDOMAdapter.findScrollContainer()).toBeNull()
  })
})

describe('findAssistantTurns', () => {
  it('finds all [data-is-streaming] descendants of root', () => {
    const root = document.createElement('div')
    const t1 = document.createElement('div')
    t1.setAttribute('data-is-streaming', 'false')
    const t2 = document.createElement('div')
    t2.setAttribute('data-is-streaming', 'true')
    root.append(t1, t2)
    expect(claudeDOMAdapter.findAssistantTurns(root)).toEqual([t1, t2])
  })

  it('returns empty array when no turns', () => {
    const root = document.createElement('div')
    expect(claudeDOMAdapter.findAssistantTurns(root)).toEqual([])
  })
})

describe('isStreamingComplete', () => {
  it('returns true when data-is-streaming is "false"', () => {
    const el = document.createElement('div')
    el.setAttribute('data-is-streaming', 'false')
    expect(claudeDOMAdapter.isStreamingComplete(el)).toBe(true)
  })

  it('returns false when data-is-streaming is "true"', () => {
    const el = document.createElement('div')
    el.setAttribute('data-is-streaming', 'true')
    expect(claudeDOMAdapter.isStreamingComplete(el)).toBe(false)
  })

  it('returns false when attribute is absent', () => {
    const el = document.createElement('div')
    expect(claudeDOMAdapter.isStreamingComplete(el)).toBe(false)
  })
})

describe('findBlocks', () => {
  it('finds all p.font-claude-response-body within a turn', () => {
    const turn = document.createElement('div')
    const p1 = document.createElement('p')
    p1.className = 'font-claude-response-body leading-7'
    p1.textContent = 'First'
    const p2 = document.createElement('p')
    p2.className = 'font-claude-response-body leading-7'
    p2.textContent = 'Second'
    turn.append(p1, p2)
    expect(claudeDOMAdapter.findBlocks(turn)).toEqual([p1, p2])
  })

  it('ignores paragraphs without the response-body class', () => {
    const turn = document.createElement('div')
    const p = document.createElement('p')
    p.className = 'other-class'
    turn.appendChild(p)
    expect(claudeDOMAdapter.findBlocks(turn)).toHaveLength(0)
  })
})

describe('findInput', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('finds a contenteditable element', () => {
    const el = document.createElement('div')
    el.setAttribute('contenteditable', 'true')
    document.body.appendChild(el)
    expect(claudeDOMAdapter.findInput()).toBe(el)
  })

  it('returns null when not present', () => {
    expect(claudeDOMAdapter.findInput()).toBeNull()
  })
})

describe('findHeader', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('finds a sticky header element', () => {
    const el = document.createElement('header')
    el.className = 'sticky top-0 z-header h-12'
    document.body.appendChild(el)
    expect(claudeDOMAdapter.findHeader()).toBe(el)
  })
})
