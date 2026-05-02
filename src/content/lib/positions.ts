export type PanelGeometry = { id: string; top: number; height: number }

export function resolveCollisions(
  panels: PanelGeometry[],
  options?: { activeId?: string; minTop?: number; maxBottom?: number },
): Record<string, number> {
  if (panels.length === 0) return {}

  const sorted = [...panels].sort((a, b) => a.top - b.top)
  const tops: number[] = new Array(sorted.length)
  const n = sorted.length

  const activeIdx = options?.activeId != null
    ? sorted.findIndex(p => p.id === options.activeId)
    : -1

  if (activeIdx === -1) {
    // No active panel: plain greedy push-down.
    tops[0] = sorted[0].top
    for (let i = 1; i < n; i++) {
      tops[i] = Math.max(sorted[i].top, tops[i - 1] + sorted[i - 1].height + 10)
    }
  } else {
    // Active panel is pinned at its natural position.
    tops[activeIdx] = sorted[activeIdx].top

    // Walk upward: pack panels against the active, pushing up if needed.
    for (let i = activeIdx - 1; i >= 0; i--) {
      tops[i] = Math.min(sorted[i].top, tops[i + 1] - sorted[i].height - 10)
    }

    // Walk downward: greedy push-down from active.
    for (let i = activeIdx + 1; i < n; i++) {
      tops[i] = Math.max(sorted[i].top, tops[i - 1] + sorted[i - 1].height + 10)
    }
  }

  // Bottom boundary: walk backward clamping panels to maxBottom.
  // Panels that exceed the boundary overlap rather than clipping off-screen.
  if (options?.maxBottom !== undefined) {
    const maxBottom = options.maxBottom
    for (let i = n - 1; i >= 0; i--) {
      tops[i] = Math.min(tops[i], maxBottom - sorted[i].height)
      if (i < n - 1 && tops[i] > tops[i + 1]) tops[i] = tops[i + 1]
    }
  }

  // Top boundary: walk forward clamping at minTop — only applied at scroll top.
  // Top wins if the zone is too small to fit all panels.
  if (options?.minTop !== undefined) {
    const minTop = options.minTop
    for (let i = 0; i < n; i++) {
      if (tops[i] < minTop) tops[i] = minTop
      if (i > 0 && tops[i] < tops[i - 1] + sorted[i - 1].height + 10) {
        tops[i] = tops[i - 1] + sorted[i - 1].height + 10
      }
    }
  }

  return Object.fromEntries(sorted.map((p, idx) => [p.id, tops[idx]]))
}
