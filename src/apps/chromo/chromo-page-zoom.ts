export const CHROMO_ZOOM_STEPS = [
  0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const

export const CHROMO_DEFAULT_ZOOM = 1

function nearestStepIndex(zoom: number): number {
  let best = 0
  let bestDist = Number.POSITIVE_INFINITY
  for (let i = 0; i < CHROMO_ZOOM_STEPS.length; i++) {
    const dist = Math.abs(CHROMO_ZOOM_STEPS[i]! - zoom)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}

export function nextChromoZoom(current: number, direction: 1 | -1): number {
  const index = nearestStepIndex(current)
  const next = index + direction
  if (next < 0) return CHROMO_ZOOM_STEPS[0]!
  if (next >= CHROMO_ZOOM_STEPS.length) return CHROMO_ZOOM_STEPS[CHROMO_ZOOM_STEPS.length - 1]!
  return CHROMO_ZOOM_STEPS[next]!
}

export function formatChromoZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`
}

export function chromoViewerZoomStyle(
  zoom: number,
): { transform: string; transformOrigin: string; width: string; height: string; inset: string } | undefined {
  if (!Number.isFinite(zoom) || zoom <= 0 || Math.abs(zoom - 1) < 0.001) {
    return undefined
  }
  const percent = `${100 / zoom}%`
  return {
    transform: `scale(${zoom})`,
    transformOrigin: '0 0',
    width: percent,
    height: percent,
    inset: 'auto',
  }
}
