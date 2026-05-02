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
    expect(result['b']).toBeGreaterThanOrEqual(result['a'] + 50 + 10)
    expect(result['c']).toBeGreaterThanOrEqual(result['b'] + 50 + 10)
  })

  it('single panel with negative top preserves the negative value without options', () => {
    const panels: PanelGeometry[] = [{ id: 'a', top: -100, height: 50 }]
    expect(resolveCollisions(panels)).toEqual({ a: -100 })
  })

  it('panel with negative top is clamped to minTop when minTop is provided', () => {
    const panels: PanelGeometry[] = [{ id: 'a', top: -60, height: 100 }]
    expect(resolveCollisions(panels, { minTop: 0 })['a']).toBe(0)
  })

  it('panel overflowing bottom is pulled up to fit within maxBottom', () => {
    const panels: PanelGeometry[] = [{ id: 'a', top: 700, height: 100 }]
    expect(resolveCollisions(panels, { maxBottom: 750 })['a']).toBe(650)
  })

  it('two panels pushed past maxBottom overlap at the boundary', () => {
    // Both panels end up at the cap — overlap is the correct outcome when
    // the push-down chain runs into the bottom of the zone.
    const panels: PanelGeometry[] = [
      { id: 'a', top: 700, height: 100 },
      { id: 'b', top: 720, height: 100 },
    ]
    const result = resolveCollisions(panels, { maxBottom: 800 })
    expect(result['b']).toBe(700)   // 800 - height(100)
    expect(result['a']).toBe(700)   // capped at same boundary, full overlap
    expect(result['a']).toBeLessThanOrEqual(result['b'])  // no inversion
  })

  it('top boundary wins when zone is too small for all panels', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: -10, height: 100 },
      { id: 'b', top: 0, height: 100 },
    ]
    const result = resolveCollisions(panels, { minTop: 0, maxBottom: 150 })
    expect(result['a']).toBe(0)
    expect(result['b']).toBe(110)   // pushed below a even though it overflows maxBottom
  })

  it('regression: two spread panels are unaffected by each other', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 100, height: 200 },
      { id: 'b', top: 700, height: 200 },
      { id: 'c', top: 750, height: 200 },
    ]
    const result = resolveCollisions(panels)
    expect(result['a']).toBe(100)
    expect(result['b']).toBe(700)
    expect(result['c']).toBeGreaterThanOrEqual(700 + 200 + 10)
  })
})
