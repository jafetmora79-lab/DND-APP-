export type MapView = { scale: number; x: number; y: number }

const FIT_PAD = 16

export function fitMapView(
  viewW: number,
  viewH: number,
  worldW: number,
  worldH: number,
  pad = FIT_PAD,
): MapView {
  if (viewW <= 0 || viewH <= 0 || worldW <= 0 || worldH <= 0) {
    return { scale: 1, x: 0, y: 0 }
  }
  const innerW = Math.max(1, viewW - pad * 2)
  const innerH = Math.max(1, viewH - pad * 2)
  const scale = Math.min(innerW / worldW, innerH / worldH)
  return {
    scale,
    x: (viewW - worldW * scale) / 2,
    y: (viewH - worldH * scale) / 2,
  }
}

export function mapScaleLimits(viewW: number, viewH: number, worldW: number, worldH: number) {
  const fit = fitMapView(viewW, viewH, worldW, worldH).scale
  const min = Math.max(0.04, fit)
  const max = Math.max(4, fit * 6)
  return { min, max, fit }
}

export function clampMapScale(scale: number, viewW: number, viewH: number, worldW: number, worldH: number) {
  const { min, max } = mapScaleLimits(viewW, viewH, worldW, worldH)
  return Math.min(max, Math.max(min, scale))
}

export function zoomAtPoint(
  oldScale: number,
  nextScale: number,
  pos: { x: number; y: number },
  point: { x: number; y: number },
): MapView {
  if (oldScale <= 0) return { scale: nextScale, x: pos.x, y: pos.y }
  const world = { x: (point.x - pos.x) / oldScale, y: (point.y - pos.y) / oldScale }
  return {
    scale: nextScale,
    x: point.x - world.x * nextScale,
    y: point.y - world.y * nextScale,
  }
}

export function touchDistance(a: { clientX: number; clientY: number }, b: { clientX: number; clientY: number }) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}
