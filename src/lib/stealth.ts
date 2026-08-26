import type { BattleMap, CharacterSheetData, Combatant, MapToken, Monster, PlayerCharacter } from './types.ts'
import { passivePerception, resolveCheck, skillBonusForCombatant } from './checks.ts'
import { pixelToCell } from './utils.ts'
import { hasLineOfSight } from './vision.ts'

export function isHiding(c: { conditions?: string[] }) {
  return (c.conditions ?? []).some((x) => x.toLowerCase() === 'hiding')
}

export function withoutHiding(conditions: string[]) {
  return conditions.filter((x) => x.toLowerCase() !== 'hiding')
}

export function withHiding(conditions: string[]) {
  return isHiding({ conditions }) ? conditions.slice() : [...conditions, 'Hiding']
}

function isAware(c: Combatant) {
  if (c.deathState === 'dead') return false
  if (c.source === 'bestiary' && c.hpCurrent <= 0) return false
  const block = ['Unconscious', 'Blinded', 'Petrified', 'Paralyzed']
  return !c.conditions.some((x) => block.includes(x))
}

/** Opposite side that could notice a hide attempt. */
export function hideWatchers(hider: Pick<Combatant, 'id' | 'source'>, combatants: Combatant[]) {
  return combatants.filter((c) => c.id !== hider.id && isAware(c) && c.source !== hider.source)
}

function cellOf(token: Pick<MapToken, 'x' | 'y'>, gridSize: number) {
  return pixelToCell(token.x, token.y, gridSize)
}

function tokenFor(combatantId: string, tokens: MapToken[]) {
  return tokens.find((t) => t.refId === combatantId)
}

export function watchersWhoSee(
  hider: Combatant,
  combatants: Combatant[],
  tokens: MapToken[],
  map: Pick<BattleMap, 'gridCols' | 'gridRows' | 'gridSize' | 'blocked'>,
) {
  const hidTok = tokenFor(hider.id, tokens)
  if (!hidTok) return []
  const dest = cellOf(hidTok, map.gridSize)
  return hideWatchers(hider, combatants).filter((enemy) => {
    const tok = tokenFor(enemy.id, tokens)
    if (!tok) return false
    const from = cellOf(tok, map.gridSize)
    return hasLineOfSight(map.blocked, map.gridCols, map.gridRows, from, dest)
  })
}

export function canAttemptHide(
  hider: Combatant,
  combatants: Combatant[],
  tokens: MapToken[],
  map: Pick<BattleMap, 'gridCols' | 'gridRows' | 'gridSize' | 'blocked'>,
) {
  if (!tokenFor(hider.id, tokens)) return { ok: false as const, error: 'Get on the map before you hide.' }
  const seenBy = watchersWhoSee(hider, combatants, tokens, map)
  if (seenBy.length > 0) {
    return {
      ok: false as const,
      error: `Enemies can see you (${seenBy.map((c) => c.name).join(', ')}). Break line of sight first.`,
      seenBy,
    }
  }
  return { ok: true as const, seenBy: [] as Combatant[] }
}

export function hideDcFor(
  hider: Combatant,
  combatants: Combatant[],
  characters: PlayerCharacter[],
  monsters?: Monster[],
) {
  const watchers = hideWatchers(hider, combatants)
  if (watchers.length === 0) return 10
  let best = 10
  for (const w of watchers) {
    const sheet = w.source === 'character' ? characters.find((ch) => ch.id === w.sourceId)?.sheet : undefined
    const monster = w.source === 'bestiary' ? monsters?.find((m) => m.id === w.sourceId) : undefined
    best = Math.max(best, passivePerception(w, sheet, monster))
  }
  return best
}

export function resolveHideAttempt(opts: {
  hider: Combatant
  combatants: Combatant[]
  tokens: MapToken[]
  map: Pick<BattleMap, 'gridCols' | 'gridRows' | 'gridSize' | 'blocked'>
  characters: PlayerCharacter[]
  monsters?: Monster[]
  d20: number
  sheet?: CharacterSheetData | null
  monster?: Monster | null
}) {
  const gate = canAttemptHide(opts.hider, opts.combatants, opts.tokens, opts.map)
  if (!gate.ok) return { ...gate, success: false as const, dc: 0, total: 0, message: gate.error }
  const dc = hideDcFor(opts.hider, opts.combatants, opts.characters, opts.monsters)
  const modifier = skillBonusForCombatant(opts.hider, 'stealth', opts.sheet, opts.monster)
  const check = resolveCheck({ d20: opts.d20, modifier, dc, label: `${opts.hider.name} Hide (Stealth)` })
  return {
    ok: true as const,
    success: check.success,
    dc,
    total: check.total,
    message: check.success ? `${check.message}. Hidden.` : check.message,
  }
}

export function sheetForHide(hider: Combatant, characters: PlayerCharacter[]) {
  if (hider.source !== 'character') return null
  return characters.find((c) => c.id === hider.sourceId)?.sheet ?? null
}

/** Hide is broken by attacking, being attacked, or acting in the open (not Dodge/Disengage/Hide). */
export function actionRevealsHiding(kind: string) {
  return kind === 'dash' || kind === 'help' || kind === 'other' || kind === 'custom'
}

export function hidingBrokenByWatchers(
  hider: Combatant,
  combatants: Combatant[],
  tokens: MapToken[],
  map: Pick<BattleMap, 'gridCols' | 'gridRows' | 'gridSize' | 'blocked'>,
) {
  if (!isHiding(hider)) return false
  return watchersWhoSee(hider, combatants, tokens, map).length > 0
}
