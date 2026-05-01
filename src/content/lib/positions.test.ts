import { resolveCollisions, type PanelGeometry } from './positions'

describe('resolveCollisions', () => {
  it('returns empty object for empty input', () => {
    expect(resolveCollisions([])).toEqual({})
  })

  it('returns unchanged top for single panel', () => {
    const panels: PanelGeometry[] = [{ id: 'a', top: 100, height: 50 }]
    expect(resolveCollisions(panels)).toEqual({ a: 100 })
  })

  it('two non-overlapping panels retain their tops', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 0, height: 50 },
      { id: 'b', top: 200, height: 50 },
    ]
    const result = resolveCollisions(panels)
    expect(result['a']).toBe(0)
    expect(result['b']).toBe(200)
  })

  it('overlapping panels: second is pushed at least height + 10 below first', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 0, height: 100 },
      { id: 'b', top: 50, height: 100 },
    ]
    const result = resolveCollisions(panels)
    expect(result['b']).toBeGreaterThanOrEqual(result['a'] + 100 + 10)
  })

  it('three stacked panels are all non-overlapping after resolution', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 0, height: 50 },
      { id: 'b', top: 10, height: 50 },
      { id: 'c', top: 20, height: 50 },
    ]
    const result = resolveCollisions(panels)
    expect(result['a']).toBeGreaterThanOrEqual(0)
    expect(result['b']).toBeGreaterThanOrEqual(result['a'] + 50 + 10)
    expect(result['c']).toBeGreaterThanOrEqual(result['b'] + 50 + 10)
  })
})
