import { parseCombatantStats, parseDeathState } from './combat.ts'
import type { Combatant, CombatantStats, DeathState } from './types.ts'

export const SURPRISED = 'Surprised'

export type StartFightOpts = {
  name?: string
  fog?: boolean
  surpriseParty?: boolean
  surpriseMonsters?: boolean
}

export type CombatantLike = {
  id: string
  name: string
  source: 'bestiary' | 'character' | string
  initiative: number
  hpCurrent: number
  conditions: string[]
  turnOrderPosition: number
  deathState: DeathState
  stats: CombatantStats | null
}

export function isSurprised(c: { conditions?: string[] }) {
  return (c.conditions ?? []).some((x) => x.toLowerCase() === 'surprised')
}

export function withoutSurprised(conditions: string[]) {
  return conditions.filter((x) => x.toLowerCase() !== 'surprised')
}

export function dexScore(c: { stats?: CombatantStats | null }) {
  const n = Number(c.stats?.dex ?? 10)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 10
}

/** Who still gets a turn: corpses and dropped monsters are skipped; dying PCs still act (death saves). */
export function canActThisTurn(c: CombatantLike, round: number) {
  if (c.deathState === 'dead') return false
  if (c.source === 'bestiary' && c.hpCurrent <= 0) return false
  if (round === 1 && isSurprised(c)) return false
  return true
}

export function orderedCombatants<T extends { turnOrderPosition: number }>(list: T[]) {
  return [...list].sort((a, b) => a.turnOrderPosition - b.turnOrderPosition)
}

export function sortByInitiative<T extends { initiative: number; name: string; stats?: CombatantStats | null }>(list: T[]) {
  return [...list].sort((a, b) => {
    if (b.initiative !== a.initiative) return b.initiative - a.initiative
    const dexDiff = dexScore(b) - dexScore(a)
    if (dexDiff) return dexDiff
    return a.name.localeCompare(b.name)
  })
}

export function standingEnemies(combatants: CombatantLike[]) {
  return combatants.filter((c) => c.source === 'bestiary' && c.hpCurrent > 0 && c.deathState !== 'dead')
}

export function nextActingPosition(
  combatants: CombatantLike[],
  fromPos: number,
  round: number,
): { position: number; round: number; wrapped: boolean; skippedIds: string[] } {
  const ordered = orderedCombatants(combatants)
  if (ordered.length === 0) return { position: 0, round, wrapped: false, skippedIds: [] }
  const originPos = fromPos
  const originRound = round
  let pos = fromPos
  let rnd = round
  let wrapped = false
  const skippedIds: string[] = []
  for (let step = 0; step < ordered.length * 2; step++) {
    pos += 1
    if (pos >= ordered.length) {
      pos = 0
      rnd += 1
      wrapped = true
    }
    const c = ordered[pos]
    if (canActThisTurn(c, rnd)) {
      return { position: pos, round: rnd, wrapped, skippedIds }
    }
    skippedIds.push(c.id)
  }
  return { position: Math.max(0, originPos), round: originRound, wrapped: false, skippedIds }
}

export function firstActingPosition(combatants: CombatantLike[], round: number) {
  return nextActingPosition(combatants, -1, round)
}

export function combatantLikeFromRow(row: Record<string, unknown>): CombatantLike {
  const conditionsRaw = row.conditions_json ?? row.conditions
  const conditions = Array.isArray(conditionsRaw)
    ? conditionsRaw.map((x) => String(x))
    : typeof conditionsRaw === 'string'
      ? (() => {
          try {
            const parsed = JSON.parse(conditionsRaw) as unknown
            return Array.isArray(parsed) ? parsed.map((x) => String(x)) : []
          } catch {
            return []
          }
        })()
      : []
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    source: String(row.source ?? 'bestiary'),
    initiative: Number(row.initiative ?? 0),
    hpCurrent: Number(row.hp_current ?? row.hpCurrent ?? 0),
    conditions,
    turnOrderPosition: Number(row.turn_order_position ?? row.turnOrderPosition ?? 0),
    deathState: parseDeathState(row.death_state ?? row.deathState),
    stats: parseCombatantStats(row.stats_json ?? row.stats),
  }
}

export function asCombatantLike(c: Combatant): CombatantLike {
  return {
    id: c.id,
    name: c.name,
    source: c.source,
    initiative: c.initiative,
    hpCurrent: c.hpCurrent,
    conditions: c.conditions ?? [],
    turnOrderPosition: c.turnOrderPosition,
    deathState: c.deathState,
    stats: c.stats,
  }
}

export function applyShortRestHp(hpCurrent: number, hpMax: number, recovered: number) {
  const cur = Number.isFinite(hpCurrent) ? hpCurrent : 0
  const max = Number.isFinite(hpMax) && hpMax > 0 ? hpMax : cur
  const add = Number.isFinite(recovered) ? Math.max(0, Math.round(recovered)) : 0
  return Math.max(0, Math.min(max, cur + add))
}
