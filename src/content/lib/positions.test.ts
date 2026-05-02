import { resolveCollisions, type PanelGeometry } from './positions'

describe('resolveCollisions', () => {
  // ── No active panel (plain push-down) ──────────────────────────────

  it('returns empty object for empty input', () => {
    expect(resolveCollisions([])).toEqual({})
  })

  it('single panel stays at natural position', () => {
    expect(resolveCollisions([{ id: 'a', top: 100, height: 50 }])).toEqual({ a: 100 })
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

  it('overlapping panels: lower is pushed down by height + gap', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 0, height: 100 },
      { id: 'b', top: 50, height: 100 },
    ]
    expect(resolveCollisions(panels)['b']).toBeGreaterThanOrEqual(0 + 100 + 10)
  })

  it('three stacked panels are all non-overlapping', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 0, height: 50 },
      { id: 'b', top: 10, height: 50 },
      { id: 'c', top: 20, height: 50 },
    ]
    const result = resolveCollisions(panels)
    expect(result['b']).toBeGreaterThanOrEqual(result['a'] + 50 + 10)
    expect(result['c']).toBeGreaterThanOrEqual(result['b'] + 50 + 10)
  })

  it('negative top is preserved without options', () => {
    expect(resolveCollisions([{ id: 'a', top: -100, height: 50 }])).toEqual({ a: -100 })
  })

  it('spread panels are unaffected by each other', () => {
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

  // ── Active panel ──────────────────────────────────────────────────

  it('active panel is pinned at its natural position', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 100, height: 200 },
      { id: 'b', top: 150, height: 200 },
    ]
    const result = resolveCollisions(panels, { activeId: 'a' })
    expect(result['a']).toBe(100)
    expect(result['b']).toBeGreaterThanOrEqual(100 + 200 + 10)
  })

  it('panel above active that fits stays at natural position', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 100, height: 200 },  // 310 < 400 — no overlap
      { id: 'b', top: 400, height: 200 },  // active
    ]
    const result = resolveCollisions(panels, { activeId: 'b' })
    expect(result['b']).toBe(400)
    expect(result['a']).toBe(100)
  })

  it('panel above active that overlaps is pushed up', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 300, height: 200 },  // 510 > 400 — overlaps active
      { id: 'b', top: 400, height: 200 },  // active
    ]
    const result = resolveCollisions(panels, { activeId: 'b' })
    expect(result['b']).toBe(400)
    expect(result['a']).toBe(400 - 200 - 10)
  })

  it('panel below active that overlaps is pushed down', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 100, height: 200 },  // active
      { id: 'b', top: 150, height: 200 },  // overlaps active
    ]
    const result = resolveCollisions(panels, { activeId: 'a' })
    expect(result['a']).toBe(100)
    expect(result['b']).toBe(100 + 200 + 10)
  })

  it('panels on both sides of active are arranged outward', () => {
    const panels: PanelGeometry[] = [
      { id: 'above', top: 200, height: 100 },  // overlaps active
      { id: 'active', top: 300, height: 100 },
      { id: 'below', top: 350, height: 100 },  // overlaps active
    ]
    const result = resolveCollisions(panels, { activeId: 'active' })
    expect(result['active']).toBe(300)
    expect(result['above']).toBe(300 - 100 - 10)  // pushed up
    expect(result['below']).toBe(300 + 100 + 10)  // pushed down
  })

  // ── Boundary options ──────────────────────────────────────────────

  it('minTop clamps negative tops when provided', () => {
    expect(resolveCollisions([{ id: 'a', top: -60, height: 100 }], { minTop: 0 })['a']).toBe(0)
  })

  it('maxBottom pulls up a panel that overflows', () => {
    expect(resolveCollisions([{ id: 'a', top: 700, height: 100 }], { maxBottom: 750 })['a']).toBe(650)
  })

  it('two panels pushed past maxBottom overlap at the boundary', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: 700, height: 100 },
      { id: 'b', top: 720, height: 100 },
    ]
    const result = resolveCollisions(panels, { maxBottom: 800 })
    expect(result['b']).toBe(700)
    expect(result['a']).toBe(700)
    expect(result['a']).toBeLessThanOrEqual(result['b'])
  })

  it('top boundary wins when zone is too small', () => {
    const panels: PanelGeometry[] = [
      { id: 'a', top: -10, height: 100 },
      { id: 'b', top: 0, height: 100 },
    ]
    const result = resolveCollisions(panels, { minTop: 0, maxBottom: 150 })
    expect(result['a']).toBe(0)
    expect(result['b']).toBe(110)
  })
})
