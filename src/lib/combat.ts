import type { Attack, BattleMap, Combatant, MapToken, TemplateMonster } from './types.ts'
import { monsterTokenLook, playerTokenLook } from './token-look.ts'
import { FEET_PER_SQUARE, pixelToCell, spreadCells, tokenOccupiesBlocked } from './utils.ts'

export function parseAttackBonus(bonus: string | undefined) {
  const m = String(bonus ?? '').match(/([+-]?\d+)/)
  return m ? Number(m[1]) : 0
}

export function parseRangeFeet(range: string | undefined) {
  const m = String(range || '5').match(/(\d+)/)
  const n = m ? Number(m[1]) : 5
  return n > 0 ? n : 5
}

export function chebyshevSquares(a: { col: number; row: number }, b: { col: number; row: number }) {
  return Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row))
}

export function minTokenDistanceSquares(
  a: { col: number; row: number; size?: number },
  b: { col: number; row: number; size?: number },
) {
  const as = Math.max(1, a.size ?? 1)
  const bs = Math.max(1, b.size ?? 1)
  let min = Infinity
  for (let r = 0; r < as; r++) {
    for (let c = 0; c < as; c++) {
      for (let r2 = 0; r2 < bs; r2++) {
        for (let c2 = 0; c2 < bs; c2++) {
          min = Math.min(min, chebyshevSquares({ col: a.col + c, row: a.row + r }, { col: b.col + c2, row: b.row + r2 }))
        }
      }
    }
  }
  return min
}

export function tokenCell(token: { x: number; y: number }, gridSize: number) {
  return pixelToCell(token.x, token.y, gridSize)
}

export function isAttackInRange(
  from: { col: number; row: number; size?: number },
  to: { col: number; row: number; size?: number },
  rangeFeet: number,
) {
  return minTokenDistanceSquares(from, to) * FEET_PER_SQUARE <= Math.max(0, rangeFeet)
}

export function attackOutcome(d20: number, bonus: number, ac: number): 'crit' | 'hit' | 'fumble' | 'miss' {
  if (d20 <= 1) return 'fumble'
  if (d20 >= 20) return 'crit'
  return d20 + bonus > ac ? 'hit' : 'miss'
}

export function grantAdvantage(list: string[] | undefined, vsId: string) {
  const cur = list ?? []
  return cur.includes(vsId) ? cur : [...cur, vsId]
}

export function consumeAdvantage(list: string[] | undefined, vsId: string) {
  return (list ?? []).filter((id) => id !== vsId)
}

export function attacksFromMonster(monster: { actions?: { name: string; desc: string }[] }): Attack[] {
  const parsed = (monster.actions ?? [])
    .map((a) => {
      const bonus = a.desc.match(/([+-]\d+)\s*to hit/i)?.[1] ?? '+0'
      const rangeN = a.desc.match(/(?:reach|range)\s+(\d+)\s*ft/i)?.[1]
      const dmg = a.desc.match(/Hit:\s*([^.]*)/i)?.[1]?.trim() ?? ''
      return { name: a.name, bonus, damage: dmg, range: rangeN ? `${rangeN} ft.` : '5 ft.' } satisfies Attack
    })
    .filter((a) => a.name.trim())
  return parsed.length ? parsed : [{ name: 'Strike', bonus: '+0', damage: '', range: '5 ft.' }]
}

export function applyDamage(hpCurrent: number, hpTemp: number, damage: number) {
  let temp = Math.max(0, hpTemp)
  let dmg = Math.max(0, Math.floor(damage))
  const fromTemp = Math.min(temp, dmg)
  temp -= fromTemp
  dmg -= fromTemp
  return { hpCurrent: Math.max(0, hpCurrent - dmg), hpTemp: temp }
}

export function specCopyCell(spec: TemplateMonster, copyIndex: number, placed: number) {
  const p = spec.positions?.[copyIndex]
  if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return { col: p.x, row: p.y }
  const hasStart = Number.isFinite(spec.startX) && Number.isFinite(spec.startY)
  const baseCol = hasStart ? Number(spec.startX) : 2 + (placed % 8)
  const baseRow = hasStart ? Number(spec.startY) : 2 + Math.floor(placed / 8)
  return { col: baseCol + (copyIndex % 4), row: baseRow + Math.floor(copyIndex / 4) }
}

export function monsterCopyCells(
  spec: TemplateMonster,
  map: Pick<BattleMap, 'gridCols' | 'gridRows' | 'blocked'>,
  occupied: Set<string>,
) {
  const qty = Math.max(1, Math.round(Number(spec.quantity)) || 1)
  const out: { col: number; row: number }[] = []
  for (let i = 0; i < qty; i++) {
    const stored = spec.positions?.[i]
    let cell =
      stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)
        ? { col: Number(stored.x), row: Number(stored.y) }
        : i === 0 && Number.isFinite(spec.startX) && Number.isFinite(spec.startY)
          ? { col: Number(spec.startX), row: Number(spec.startY) }
          : null
    if (!cell || occupied.has(`${cell.col},${cell.row}`) || tokenOccupiesBlocked(map.blocked, cell.col, cell.row, map.gridCols, map.gridRows)) {
      const origin = cell ?? { col: Number(spec.startX) || 2, row: Number(spec.startY) || 2 }
      cell = spreadCells(origin, 1, map.gridCols, map.gridRows, map.blocked, occupied)[0]
    }
    const placed = cell
    occupied.add(`${placed.col},${placed.row}`)
    out.push(placed)
  }
  return out
}

export function decorateTokens(tokens: MapToken[], combatants: Combatant[]): MapToken[] {
  return tokens.map((t) => {
    const c = combatants.find((x) => x.id === t.refId)
    if (!c) return t
    const look = c.source === 'character' ? playerTokenLook(c.color) : monsterTokenLook(c.name)
    return {
      ...t,
      label: c.name || t.label,
      color: look.from,
      color2: look.to,
      hpCurrent: c.hpCurrent,
      hpMax: c.hpMax,
      hpTemp: c.hpTemp,
      ac: c.ac,
      conditions: c.conditions,
    }
  })
}

export function inRangeCombatantIds(
  map: BattleMap,
  tokens: MapToken[],
  combatants: Combatant[],
  attackerCombatantId: string,
  attack: Attack,
) {
  const fromTok = tokens.find((t) => t.refId === attackerCombatantId)
  if (!fromTok) return []
  const from = { ...tokenCell(fromTok, map.gridSize), size: fromTok.sizeSquares }
  const range = parseRangeFeet(attack.range)
  return combatants
    .filter((c) => c.id !== attackerCombatantId)
    .filter((c) => {
      const tok = tokens.find((t) => t.refId === c.id)
      if (!tok) return false
      return isAttackInRange(from, { ...tokenCell(tok, map.gridSize), size: tok.sizeSquares }, range)
    })
    .map((c) => c.id)
}

export type PlayerAttackResult = {
  hit: boolean
  crit: boolean
  fumble: boolean
  hadAdvantage: boolean
  total: number
  ac: number
  damage: number
  hpCurrent: number
  hpTemp: number
  targetName: string
  message: string
}
