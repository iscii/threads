export type PanelGeometry = { id: string; top: number; height: number }

export function resolveCollisions(
  panels: PanelGeometry[],
  options?: { minTop?: number; maxBottom?: number },
): Record<string, number> {
  if (panels.length === 0) return {}

  const sorted = [...panels].sort((a, b) => a.top - b.top)
  const tops: number[] = new Array(sorted.length)

  // Pass 1: greedy push-down — each panel placed below the previous if they overlap.
  tops[0] = sorted[0].top
  for (let i = 1; i < sorted.length; i++) {
    tops[i] = Math.max(sorted[i].top, tops[i - 1] + sorted[i - 1].height + 10)
  }

  // Bottom boundary: walk backward clamping each panel to maxBottom.
  // Panels that exceed the boundary overlap with the one above rather than clipping off-screen.
  // Ordering is preserved (no inversions) but gaps can go negative.
  if (options?.maxBottom !== undefined) {
    const maxBottom = options.maxBottom
    for (let i = sorted.length - 1; i >= 0; i--) {
      tops[i] = Math.min(tops[i], maxBottom - sorted[i].height)
      if (i < sorted.length - 1 && tops[i] > tops[i + 1]) tops[i] = tops[i + 1]
    }
  }

  // Top boundary: walk forward clamping at minTop — only applied at scroll top.
  // Top wins if the zone is too small to fit all panels without overflow.
  if (options?.minTop !== undefined) {
    const minTop = options.minTop
    for (let i = 0; i < sorted.length; i++) {
      if (tops[i] < minTop) tops[i] = minTop
      if (i > 0 && tops[i] < tops[i - 1] + sorted[i - 1].height + 10) {
        tops[i] = tops[i - 1] + sorted[i - 1].height + 10
      }
    }
  }

  return Object.fromEntries(sorted.map((p, idx) => [p.id, tops[idx]]))
}
