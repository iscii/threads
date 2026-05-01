export type PanelGeometry = { id: string; top: number; height: number }

export function resolveCollisions(panels: PanelGeometry[]): Record<string, number> {
  if (panels.length === 0) return {}

  const sorted = [...panels].sort((a, b) => a.top - b.top)
  const tops: number[] = new Array(sorted.length)

  // Pass 1: greedy push-down — each panel placed below the previous if they overlap
  tops[0] = Math.max(0, sorted[0].top)
  for (let i = 1; i < sorted.length; i++) {
    const minTop = tops[i - 1] + sorted[i - 1].height + 10
    tops[i] = Math.max(sorted[i].top, minTop)
  }

  // Pass 2: center contiguous displaced groups around their natural midpoint
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j < sorted.length - 1 && tops[j + 1] > sorted[j + 1].top) j++
    if (j > i) {
      const naturalMid = (sorted[i].top + sorted[j].top) / 2
      let groupH = 0
      for (let k = i; k <= j; k++) groupH += sorted[k].height + (k < j ? 10 : 0)
      let newTop = Math.max(0, naturalMid - groupH / 2)
      for (let k = i; k <= j; k++) {
        tops[k] = newTop
        newTop += sorted[k].height + 10
      }
    }
    i = j + 1
  }

  return Object.fromEntries(sorted.map((p, idx) => [p.id, tops[idx]]))
}
