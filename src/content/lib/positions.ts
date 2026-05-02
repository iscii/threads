export type PanelGeometry = { id: string; top: number; height: number }

export function resolveCollisions(
  panels: PanelGeometry[],
  options?: { maxBottom?: number },
): Record<string, number> {
  if (panels.length === 0) return {}

  const sorted = [...panels].sort((a, b) => a.top - b.top)
  const tops: number[] = new Array(sorted.length)

  // Pass 1: greedy push-down — each panel placed below the previous if they overlap
  tops[0] = sorted[0].top
  for (let i = 1; i < sorted.length; i++) {
    const minTop = tops[i - 1] + sorted[i - 1].height + 10
    tops[i] = Math.max(sorted[i].top, minTop)
  }

  // Pass 2: center contiguous displaced groups around their natural midpoint.
  // Only displaced panels (tops[i] > sorted[i].top) are eligible for re-centering.
  // Non-displaced panels are skipped so a correctly-positioned panel is never
  // pulled above its natural scroll position by panels below it.
  let i = 0
  while (i < sorted.length) {
    if (tops[i] <= sorted[i].top) { i++; continue }
    let j = i
    while (j < sorted.length - 1 && tops[j + 1] > sorted[j + 1].top) j++
    const naturalMid = (sorted[i].top + sorted[j].top) / 2
    let groupH = 0
    for (let k = i; k <= j; k++) groupH += sorted[k].height + (k < j ? 10 : 0)
    // Never pull the group above its natural starting position or the previous panel's bottom.
    let newTop = Math.max(naturalMid - groupH / 2, sorted[i].top)
    if (i > 0) newTop = Math.max(newTop, tops[i - 1] + sorted[i - 1].height + 10)
    for (let k = i; k <= j; k++) {
      tops[k] = newTop
      newTop += sorted[k].height + 10
    }
    i = j + 1
  }

  // Pass 3: zone boundary clamping.
  // Bottom: walk backward pushing panels up to keep them inside maxBottom.
  if (options?.maxBottom !== undefined) {
    const maxBottom = options.maxBottom
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (tops[i] + sorted[i].height > maxBottom) tops[i] = maxBottom - sorted[i].height
      if (i > 0 && tops[i] < tops[i - 1] + sorted[i - 1].height + 10) {
        tops[i - 1] = tops[i] - sorted[i - 1].height - 10
      }
    }
  }
  // Top: walk forward clamping at 0. Top wins if zone is too small to fit all panels.
  for (let i = 0; i < sorted.length; i++) {
    if (tops[i] < 0) tops[i] = 0
    if (i > 0 && tops[i] < tops[i - 1] + sorted[i - 1].height + 10) {
      tops[i] = tops[i - 1] + sorted[i - 1].height + 10
    }
  }

  return Object.fromEntries(sorted.map((p, idx) => [p.id, tops[idx]]))
}
