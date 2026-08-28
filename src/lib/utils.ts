import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function abilityMod(score: number) {
  return Math.floor((score - 10) / 2)
}

export function signed(n: number) {
  return n >= 0 ? `+${n}` : String(n)
}

export function proficiencyBonus(level: number) {
  return Math.ceil(Math.max(1, level) / 4) + 1
}

export function crXp(cr: number) {
  const table: Record<string, number> = {
    '0': 10,
    '0.125': 25,
    '0.25': 50,
    '0.5': 100,
    '1': 200,
    '2': 450,
    '3': 700,
    '4': 1100,
    '5': 1800,
    '6': 2300,
    '7': 2900,
    '8': 3900,
    '9': 5000,
    '10': 5900,
    '11': 7200,
    '12': 8400,
    '13': 10000,
    '14': 11500,
    '15': 13000,
    '16': 15000,
    '17': 18000,
    '18': 20000,
    '19': 22000,
    '20': 25000,
    '21': 33000,
    '22': 41000,
    '23': 50000,
    '24': 62000,
    '30': 155000,
  }
  return table[String(cr)] ?? 0
}

export function tokenSizeSquares(size: string) {
  const s = size.toLowerCase()
  if (s.includes('gargantuan')) return 4
  if (s.includes('huge')) return 3
  if (s.includes('large')) return 2
  return 1
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export function templateTokenCell(
  spec: { startX?: number; startY?: number },
  copyIndex: number,
  placed: number,
) {
  const hasStart = Number.isFinite(spec.startX) && Number.isFinite(spec.startY)
  const baseCol = hasStart ? Number(spec.startX) : 2 + (placed % 8)
  const baseRow = hasStart ? Number(spec.startY) : 2 + Math.floor(placed / 8)
  return { col: baseCol + (copyIndex % 4), row: baseRow + Math.floor(copyIndex / 4) }
}

export function spreadCells(
  origin: { col: number; row: number },
  count: number,
  cols: number,
  rows: number,
  blocked?: number[],
  occupied?: Set<string>,
) {
  const result: { col: number; row: number }[] = []
  const used = new Set(occupied)
  const maxR = Math.max(cols, rows, 1)
  for (let d = 0; d <= maxR && result.length < count; d++) {
    for (let row = origin.row - d; row <= origin.row + d; row++) {
      for (let col = origin.col - d; col <= origin.col + d; col++) {
        if (d > 0 && Math.abs(col - origin.col) !== d && Math.abs(row - origin.row) !== d) continue
        if (col < 0 || row < 0 || col >= cols || row >= rows) continue
        const key = `${col},${row}`
        if (used.has(key) || tokenOccupiesBlocked(blocked, col, row, cols, rows)) continue
        used.add(key)
        result.push({ col, row })
        if (result.length >= count) break
      }
      if (result.length >= count) break
    }
  }
  while (result.length < count) {
    result.push({
      col: Math.max(0, Math.min(cols - 1, origin.col)),
      row: Math.max(0, Math.min(rows - 1, origin.row)),
    })
  }
  return result
}

/** D&D tactical scale: one square is 5 feet. */
export const FEET_PER_SQUARE = 5
export const DEFAULT_SCRATCH_CELL = 48
export const MAX_GRID_DIM = 80

export function clampGridDim(n: unknown, fallback: number) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(1, Math.min(MAX_GRID_DIM, Math.round(v)))
}

export function clampGridSize(n: unknown, fallback = DEFAULT_SCRATCH_CELL) {
  const v = Number(n)
  if (!Number.isFinite(v)) return fallback
  return Math.max(16, Math.min(128, Math.round(v)))
}

export function mapFeet(cols: number, rows: number) {
  return `${cols * FEET_PER_SQUARE} ft × ${rows * FEET_PER_SQUARE} ft`
}

/** Terrain codes stored in map.blocked / blocked_cells. Old maps used only 0|1. */
export const TERRAIN = {
  OPEN: 0,
  WALL: 1,
  HOLE: 2,
  DIFFICULT: 3,
  SLIPPERY: 4,
  FIRE: 5,
  WATER: 6,
  HALF_COVER: 7,
  THREE_QUARTER_COVER: 8,
} as const

export type TerrainCode = (typeof TERRAIN)[keyof typeof TERRAIN]

export const TERRAIN_LABEL: Record<number, string> = {
  [TERRAIN.OPEN]: 'Open',
  [TERRAIN.WALL]: 'Wall',
  [TERRAIN.HOLE]: 'Hole',
  [TERRAIN.DIFFICULT]: 'Difficult',
  [TERRAIN.SLIPPERY]: 'Slippery',
  [TERRAIN.FIRE]: 'Fire',
  [TERRAIN.WATER]: 'Water',
  [TERRAIN.HALF_COVER]: 'Half cover',
  [TERRAIN.THREE_QUARTER_COVER]: 'Three-quarters cover',
}

export function emptyBlocked(cols: number, rows: number): number[] {
  return Array.from({ length: Math.max(0, cols) * Math.max(0, rows) }, () => 0)
}

export function normalizeTerrainCode(raw: unknown): number {
  if (raw === true || raw === '1') return TERRAIN.WALL
  const n = Math.round(Number(raw))
  if (!Number.isFinite(n) || n <= 0) return TERRAIN.OPEN
  if (n > TERRAIN.THREE_QUARTER_COVER) return TERRAIN.OPEN
  return n
}

export function normalizeBlocked(raw: unknown, cols: number, rows: number): number[] {
  const out = emptyBlocked(cols, rows)
  if (!Array.isArray(raw) || out.length === 0) return out
  for (let i = 0; i < out.length; i++) out[i] = normalizeTerrainCode(raw[i])
  return out
}

export function terrainAt(blocked: number[] | undefined, col: number, row: number, cols: number, rows: number) {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return TERRAIN.WALL
  if (!blocked || blocked.length === 0) return TERRAIN.OPEN
  return normalizeTerrainCode(blocked[row * cols + col])
}

export function isImpassableTerrain(code: number) {
  return code === TERRAIN.WALL || code === TERRAIN.HOLE
}

export function isOpaqueTerrain(code: number) {
  return code === TERRAIN.WALL
}

/** 5e half cover +2, three-quarters +5. Walls are full cover (LOS), not an AC bonus. */
export function coverBonusForTerrain(code: number) {
  if (code === TERRAIN.THREE_QUARTER_COVER) return 5
  if (code === TERRAIN.HALF_COVER) return 2
  return 0
}

/** Feet spent to enter this square. Walls and holes are not walkable. */
export function terrainEnterCostFeet(code: number) {
  if (isImpassableTerrain(code)) return Infinity
  if (code === TERRAIN.DIFFICULT || code === TERRAIN.SLIPPERY || code === TERRAIN.FIRE || code === TERRAIN.WATER) {
    return FEET_PER_SQUARE * 2
  }
  return FEET_PER_SQUARE
}

export function chebyshevPath(from: { col: number; row: number }, to: { col: number; row: number }) {
  const cells: { col: number; row: number }[] = []
  let c = from.col
  let r = from.row
  while (c !== to.col || r !== to.row) {
    if (c < to.col) c++
    else if (c > to.col) c--
    if (r < to.row) r++
    else if (r > to.row) r--
    cells.push({ col: c, row: r })
  }
  return cells
}

export function parseBlockedCells(raw: unknown, cols: number, rows: number): number[] {
  if (typeof raw === 'string') {
    try {
      return normalizeBlocked(JSON.parse(raw), cols, rows)
    } catch {
      return emptyBlocked(cols, rows)
    }
  }
  return normalizeBlocked(raw, cols, rows)
}

export function remapBlocked(
  old: number[] | undefined,
  oldCols: number,
  oldRows: number,
  newCols: number,
  newRows: number,
) {
  const next = emptyBlocked(newCols, newRows)
  const src = normalizeBlocked(old, oldCols, oldRows)
  const copyCols = Math.min(oldCols, newCols)
  const copyRows = Math.min(oldRows, newRows)
  for (let r = 0; r < copyRows; r++) {
    for (let c = 0; c < copyCols; c++) {
      next[r * newCols + c] = src[r * oldCols + c]
    }
  }
  return next
}

export function isCellBlocked(
  blocked: number[] | undefined,
  col: number,
  row: number,
  cols: number,
  rows: number,
) {
  if (col < 0 || row < 0 || col >= cols || row >= rows) return true
  if (!blocked || blocked.length === 0) return false
  return isImpassableTerrain(terrainAt(blocked, col, row, cols, rows))
}

export function tokenOccupiesBlocked(
  blocked: number[] | undefined,
  col: number,
  row: number,
  cols: number,
  rows: number,
  sizeSquares = 1,
) {
  const size = Math.max(1, sizeSquares)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (isCellBlocked(blocked, col + c, row + r, cols, rows)) return true
    }
  }
  return false
}

export function nearestWalkableCell(
  blocked: number[] | undefined,
  col: number,
  row: number,
  cols: number,
  rows: number,
  sizeSquares = 1,
): { col: number; row: number } | null {
  if (!tokenOccupiesBlocked(blocked, col, row, cols, rows, sizeSquares)) return { col, row }
  const maxR = Math.max(cols, rows)
  for (let d = 1; d <= maxR; d++) {
    for (let r = row - d; r <= row + d; r++) {
      for (let c = col - d; c <= col + d; c++) {
        if (Math.abs(c - col) !== d && Math.abs(r - row) !== d) continue
        if (!tokenOccupiesBlocked(blocked, c, r, cols, rows, sizeSquares)) return { col: c, row: r }
      }
    }
  }
  return null
}

export function cellCenter(col: number, row: number, gridSize: number) {
  return { x: col * gridSize + gridSize / 2, y: row * gridSize + gridSize / 2 }
}

export function pixelToCell(x: number, y: number, gridSize: number) {
  return {
    col: Math.round((x - gridSize / 2) / gridSize),
    row: Math.round((y - gridSize / 2) / gridSize),
  }
}

/** Squares a token occupies, origin at the top-left cell from pixelToCell. */
export function tokenOccupiedCells(
  token: { x: number; y: number; sizeSquares?: number },
  gridSize: number,
  cols?: number,
  rows?: number,
) {
  const { col, row } = pixelToCell(token.x, token.y, gridSize)
  const size = Math.max(1, token.sizeSquares ?? 1)
  const cells: { col: number; row: number }[] = []
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cc = col + c
      const rr = row + r
      if (cols != null && (cc < 0 || cc >= cols)) continue
      if (rows != null && (rr < 0 || rr >= rows)) continue
      cells.push({ col: cc, row: rr })
    }
  }
  return cells
}

/** Default party start: near the south-center of the map, not a hardcoded row 10. */
export function playerStartOrigin(cols: number, rows: number) {
  return {
    col: Math.min(Math.max(0, cols - 1), Math.max(0, Math.floor(cols / 2) - 1)),
    row: Math.max(0, rows - 2),
  }
}

export function tokenCellKeys(
  tokens: { x: number; y: number; sizeSquares?: number }[],
  gridSize: number,
) {
  const keys = new Set<string>()
  for (const t of tokens) {
    const { col, row } = pixelToCell(t.x, t.y, gridSize)
    const size = Math.max(1, t.sizeSquares ?? 1)
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) keys.add(`${col + c},${row + r}`)
    }
  }
  return keys
}

export function walkablePixel(
  map: { blocked?: number[]; gridCols: number; gridRows: number; gridSize: number },
  col: number,
  row: number,
  sizeSquares = 1,
) {
  const found =
    nearestWalkableCell(map.blocked, col, row, map.gridCols, map.gridRows, sizeSquares) ?? { col, row }
  return cellCenter(found.col, found.row, map.gridSize)
}

export function hpColor(current: number, max: number) {
  if (max <= 0) return 'bg-muted'
  const r = current / max
  if (r > 0.66) return 'bg-moss'
  if (r > 0.33) return 'bg-gold'
  return 'bg-blood'
}

export function hpBarFill(current: number, max: number) {
  if (max <= 0) return '#6b7280'
  const r = current / max
  if (r > 0.66) return '#4ea36a'
  if (r > 0.33) return '#d4b45a'
  return '#c4453c'
}
