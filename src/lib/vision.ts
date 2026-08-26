import type {
  CharacterSheetData,
  Combatant,
  EncounterSnapshot,
  FogState,
  MapToken,
  PlayerCharacter,
} from './types.ts'
import { FEET_PER_SQUARE, isOpaqueTerrain, MAX_GRID_DIM, pixelToCell, terrainAt } from './utils.ts'

export const LIGHTINGS = ['day', 'night', 'interior'] as const
export type Lighting = (typeof LIGHTINGS)[number]

const RACE_DARKVISION: { needle: string; ft: number }[] = [
  { needle: 'drow', ft: 120 },
  { needle: 'elf', ft: 60 },
  { needle: 'dwarf', ft: 60 },
  { needle: 'gnome', ft: 60 },
  { needle: 'half-orc', ft: 60 },
  { needle: 'halforc', ft: 60 },
  { needle: 'half-elf', ft: 60 },
  { needle: 'halfelf', ft: 60 },
  { needle: 'tiefling', ft: 60 },
  { needle: 'kobold', ft: 60 },
  { needle: 'goblin', ft: 60 },
  { needle: 'orc', ft: 60 },
  { needle: 'aasimar', ft: 60 },
]

export function parseLighting(raw: unknown): Lighting {
  return raw === 'night' || raw === 'interior' ? raw : 'day'
}

export function lightingFromStart(opts: { lighting?: Lighting; fog?: boolean } | undefined): Lighting {
  if (opts?.lighting === 'day' || opts?.lighting === 'night' || opts?.lighting === 'interior') return opts.lighting
  return opts?.fog ? 'night' : 'day'
}

export function makeStartFog(cols: number, rows: number, lighting: Lighting): FogState {
  const n = Math.max(0, cols) * Math.max(0, rows)
  return {
    cols,
    rows,
    lighting,
    enabled: lighting !== 'day',
    revealed: Array.from({ length: n }, () => 1),
  }
}

export function fogWithLighting(fog: FogState, lighting: Lighting): FogState {
  const n = Math.max(0, fog.cols) * Math.max(0, fog.rows)
  return {
    ...fog,
    lighting,
    enabled: lighting !== 'day',
    revealed: Array.from({ length: n }, () => 1),
  }
}

export function parseDarkvisionFt(...texts: string[]): number {
  let max = 0
  for (const t of texts) {
    const matches = String(t ?? '').matchAll(/darkvision\s+(\d+)\s*(?:ft\.?|feet)?/gi)
    for (const m of matches) max = Math.max(max, Number(m[1]) || 0)
  }
  return max
}

export function darkvisionForSheet(sheet: CharacterSheetData | null | undefined): number {
  if (!sheet) return 0
  if (sheet.darkvisionFt != null && Number.isFinite(sheet.darkvisionFt)) return Math.max(0, Math.round(sheet.darkvisionFt))
  const parsed = parseDarkvisionFt(sheet.features, sheet.notes, sheet.race, sheet.equipment)
  if (parsed > 0) return parsed
  const race = sheet.race.toLowerCase().replace(/[\s-]+/g, '')
  const races = [...RACE_DARKVISION].sort((a, b) => b.needle.length - a.needle.length)
  for (const row of races) {
    const needle = row.needle.replace(/[\s-]+/g, '')
    if (race.includes(needle)) return row.ft
  }
  return Math.max(0, Math.round(Number(sheet.darkvisionFt) || 0))
}

export function visionRangeSquares(lighting: Lighting, sheet: CharacterSheetData | null | undefined, blinded = false): number {
  if (blinded || lighting === 'day') return 0
  if (lighting === 'interior') return MAX_GRID_DIM
  return Math.max(0, Math.floor(darkvisionForSheet(sheet) / FEET_PER_SQUARE))
}

export function supercoverLine(x0: number, y0: number, x1: number, y1: number): { col: number; row: number }[] {
  const points: { col: number; row: number }[] = [{ col: x0, row: y0 }]
  const dx = x1 - x0
  const dy = y1 - y0
  const nx = Math.abs(dx)
  const ny = Math.abs(dy)
  const signX = dx > 0 ? 1 : dx < 0 ? -1 : 0
  const signY = dy > 0 ? 1 : dy < 0 ? -1 : 0
  let px = x0
  let py = y0
  for (let ix = 0, iy = 0; ix < nx || iy < ny; ) {
    const xDecision = (1 + 2 * ix) * ny
    const yDecision = (1 + 2 * iy) * nx
    if (xDecision === yDecision) {
      px += signX
      py += signY
      ix++
      iy++
    } else if (xDecision < yDecision) {
      px += signX
      ix++
    } else {
      py += signY
      iy++
    }
    points.push({ col: px, row: py })
  }
  return points
}

function opaqueAt(blocked: number[] | undefined, cols: number, rows: number, col: number, row: number) {
  return isOpaqueTerrain(terrainAt(blocked, col, row, cols, rows))
}

/** Walls pinch a diagonal: you cannot peek through the corner of two blocked squares. */
function diagonalPinched(
  blocked: number[] | undefined,
  cols: number,
  rows: number,
  a: { col: number; row: number },
  b: { col: number; row: number },
) {
  const dc = b.col - a.col
  const dr = b.row - a.row
  if (Math.abs(dc) !== 1 || Math.abs(dr) !== 1) return false
  return opaqueAt(blocked, cols, rows, a.col + dc, a.row) && opaqueAt(blocked, cols, rows, a.col, a.row + dr)
}

export function hasLineOfSight(
  blocked: number[] | undefined,
  cols: number,
  rows: number,
  from: { col: number; row: number },
  to: { col: number; row: number },
) {
  const line = supercoverLine(from.col, from.row, to.col, to.row)
  for (let i = 1; i < line.length; i++) {
    const prev = line[i - 1]
    const cell = line[i]
    if (diagonalPinched(blocked, cols, rows, prev, cell)) return false
    const last = i === line.length - 1
    if (last) continue
    if (opaqueAt(blocked, cols, rows, cell.col, cell.row)) return false
  }
  return true
}

export function computeVisionMask(opts: {
  cols: number
  rows: number
  blocked: number[] | undefined
  origin: { col: number; row: number }
  rangeSquares: number
}): number[] {
  const { cols, rows, blocked, origin, rangeSquares } = opts
  const out = Array.from({ length: cols * rows }, () => 0)
  if (cols <= 0 || rows <= 0) return out
  if (origin.col < 0 || origin.row < 0 || origin.col >= cols || origin.row >= rows) return out
  const range = Math.max(0, Math.round(rangeSquares))
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const dist = Math.max(Math.abs(col - origin.col), Math.abs(row - origin.row))
      if (dist > range) continue
      if (!hasLineOfSight(blocked, cols, rows, origin, { col, row })) continue
      out[row * cols + col] = 1
    }
  }
  return out
}

export function observerToken(
  tokens: MapToken[],
  combatants: Combatant[],
  characterId: string | null | undefined,
): MapToken | undefined {
  if (!characterId) return undefined
  const fromChar = tokens.find((t) => t.refType === 'character' && t.refId === characterId)
  if (fromChar) return fromChar
  const comb = combatants.find((c) => c.source === 'character' && c.sourceId === characterId)
  if (!comb) return undefined
  return tokens.find((t) => t.refId === comb.id)
}

function characterBlinded(snap: EncounterSnapshot, characterId: string) {
  const comb = snap.combatants.find((c) => c.source === 'character' && c.sourceId === characterId)
  return Boolean(comb?.conditions?.some((x) => x.toLowerCase() === 'blinded'))
}

function andHidden(vision: number[], dm: number[] | undefined) {
  if (!dm || dm.length !== vision.length) return vision
  return vision.map((v, i) => (v && dm[i] ? 1 : 0))
}

export function visionRevealedForCharacter(snap: EncounterSnapshot, characterId: string | null | undefined): number[] {
  const fog = snap.instance?.fogState
  const map = snap.map
  const cols = fog?.cols ?? map?.gridCols ?? 0
  const rows = fog?.rows ?? map?.gridRows ?? 0
  const empty = Array.from({ length: cols * rows }, () => 0)
  if (!fog || !map || cols <= 0 || rows <= 0) return empty
  const lighting = parseLighting(fog.lighting)
  if (lighting === 'day') return Array.from({ length: cols * rows }, () => 1)
  const token = observerToken(snap.tokens, snap.combatants, characterId)
  if (!token) return empty
  const sheet = snap.characters.find((c) => c.id === characterId)?.sheet
  const origin = pixelToCell(token.x, token.y, map.gridSize)
  const mask = computeVisionMask({
    cols,
    rows,
    blocked: map.blocked,
    origin,
    rangeSquares: visionRangeSquares(lighting, sheet, characterId ? characterBlinded(snap, characterId) : false),
  })
  return andHidden(mask, fog.revealed)
}

export function partyVisionRevealed(snap: EncounterSnapshot): number[] {
  const fog = snap.instance?.fogState
  const map = snap.map
  const cols = fog?.cols ?? map?.gridCols ?? 0
  const rows = fog?.rows ?? map?.gridRows ?? 0
  const allLit = Array.from({ length: cols * rows }, () => 1)
  if (!fog || !map) return allLit
  const lighting = parseLighting(fog.lighting)
  if (lighting === 'day') return allLit
  const observers = snap.characters.filter((ch) => observerToken(snap.tokens, snap.combatants, ch.id))
  if (observers.length === 0) return fog.revealed.length === cols * rows ? fog.revealed.slice() : allLit
  const acc = Array.from({ length: cols * rows }, () => 0)
  for (const ch of observers) {
    const vis = visionRevealedForCharacter(snap, ch.id)
    for (let i = 0; i < acc.length; i++) if (vis[i]) acc[i] = 1
  }
  return acc
}

export function applyLightingFog(snap: EncounterSnapshot, forCharacterId?: string | null): FogState | undefined {
  const fog = snap.instance?.fogState
  if (!fog) return fog
  const lighting = fog.lighting
  if (lighting !== 'night' && lighting !== 'interior') return fog
  const revealed = forCharacterId
    ? visionRevealedForCharacter(snap, forCharacterId)
    : partyVisionRevealed(snap)
  return { ...fog, enabled: true, revealed }
}

export function sheetForCombatant(
  combatant: Combatant,
  characters: PlayerCharacter[],
): CharacterSheetData | undefined {
  if (combatant.source !== 'character') return undefined
  return characters.find((c) => c.id === combatant.sourceId)?.sheet
}
