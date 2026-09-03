export type AoeKind = 'circle' | 'cone' | 'line' | 'cube'

export type AoeShape = {
  kind: AoeKind
  originX: number
  originY: number
  endX: number
  endY: number
  /** Line width in feet. Defaults to 5 ft (one square). Ignored by other kinds. */
  widthFeet?: number
}

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(bx - ax, by - ay)
}

export function aoeLengthFeet(shape: AoeShape, gridSize: number) {
  return (dist(shape.originX, shape.originY, shape.endX, shape.endY) / gridSize) * 5
}

/** Direction from origin to end, in degrees (Konva rotation convention: 0 = +x axis, clockwise). */
export function aoeAngleDeg(shape: AoeShape) {
  return (Math.atan2(shape.endY - shape.originY, shape.endX - shape.originX) * 180) / Math.PI
}

/** 5e's cone rule: width at any point equals that point's distance from the origin — a 2*atan(0.5) ≈ 53.13° wedge. */
export const CONE_FULL_ANGLE_DEG = (2 * Math.atan(0.5) * 180) / Math.PI

/** Grid cells (col/row) whose center falls inside the shape. */
export function aoeCoveredCells(shape: AoeShape, gridSize: number, cols: number, rows: number): { col: number; row: number }[] {
  const out: { col: number; row: number }[] = []
  const length = dist(shape.originX, shape.originY, shape.endX, shape.endY)
  if (length < 1) return out
  const dirX = (shape.endX - shape.originX) / length
  const dirY = (shape.endY - shape.originY) / length
  const halfWidth = ((shape.widthFeet ?? 5) / 5) * (gridSize / 2)
  const minX = Math.min(shape.originX, shape.endX)
  const maxX = Math.max(shape.originX, shape.endX)
  const minY = Math.min(shape.originY, shape.endY)
  const maxY = Math.max(shape.originY, shape.endY)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cx = c * gridSize + gridSize / 2
      const cy = r * gridSize + gridSize / 2
      let inside = false
      if (shape.kind === 'circle') {
        inside = dist(cx, cy, shape.originX, shape.originY) <= length
      } else if (shape.kind === 'cube') {
        inside = cx >= minX && cx <= maxX && cy >= minY && cy <= maxY
      } else {
        const dx = cx - shape.originX
        const dy = cy - shape.originY
        const along = dx * dirX + dy * dirY
        const perp = Math.abs(dx * -dirY + dy * dirX)
        if (along >= 0 && along <= length) {
          inside = shape.kind === 'cone' ? perp <= along / 2 : perp <= halfWidth
        }
      }
      if (inside) out.push({ col: c, row: r })
    }
  }
  return out
}
