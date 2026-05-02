export type PanelGeometry = { id: string; top: number; height: number }

export function resolveCollisions(
  panels: PanelGeometry[],
  options?: { minTop?: number; maxBottom?: number },
): Record<string, number> {
  if (panels.length === 0) return {}

  const sorted = [...panels].sort((a, b) => a.top - b.top)
  const tops: number[] = new Array(sorted.length)

  // Pass 1: group-aware layout.
  // Walk consecutive panels that naturally collide into groups. Groups of ≤3
  // get greedy push-down so they stay separated. Groups of >3 use natural
  // positions and overlap — pushing 4+ panels apart displaces them too far
  // from their source blocks.
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (
      j < sorted.length - 1 &&
      sorted[j].top + sorted[j].height + 10 > sorted[j + 1].top
    ) j++

    if (j - i < 3) {
      // Small group (≤3 panels): push-down within the group.
      tops[i] = sorted[i].top
      for (let k = i + 1; k <= j; k++) {
        tops[k] = Math.max(sorted[k].top, tops[k - 1] + sorted[k - 1].height + 10)
      }
    } else {
      // Large group (>3 panels): natural positions, let them overlap.
      for (let k = i; k <= j; k++) tops[k] = sorted[k].top
    }

    i = j + 1
  }

  // Bottom boundary: walk backward clamping panels to maxBottom.
  // Panels that exceed the boundary overlap with the one above rather than clipping off-screen.
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
