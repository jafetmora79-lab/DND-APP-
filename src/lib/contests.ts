import { resolveCheck, skillBonusForCombatant } from './checks.ts'
import type { CharacterSheetData, Combatant, Monster } from './types.ts'

export type ContestKind = 'grapple' | 'shove'

/**
 * Grapple/Shove are opposed Athletics checks in 5e, but this app has players
 * roll their own physical dice rather than simulating both sides live. To
 * keep that pattern (see Hide vs. passive Perception), the target's side of
 * the contest is approximated the same way passive Perception is: 10 + their
 * better of Athletics or Acrobatics (their choice of defense, per RAW).
 */
export function contestDcFor(
  target: Pick<Combatant, 'source' | 'stats'>,
  sheet?: CharacterSheetData | null,
  monster?: (Pick<Monster, 'skills'> & Partial<Pick<Monster, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'>>) | null,
) {
  const athletics = skillBonusForCombatant(target, 'athletics', sheet, monster)
  const acrobatics = skillBonusForCombatant(target, 'acrobatics', sheet, monster)
  return 10 + Math.max(athletics, acrobatics)
}

export function resolveContest(opts: {
  kind: ContestKind
  attacker: Combatant
  target: Combatant
  d20: number
  attackerSheet?: CharacterSheetData | null
  attackerMonster?: (Pick<Monster, 'skills'> & Partial<Pick<Monster, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'>>) | null
  targetSheet?: CharacterSheetData | null
  targetMonster?: (Pick<Monster, 'skills'> & Partial<Pick<Monster, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'>>) | null
}) {
  const dc = contestDcFor(opts.target, opts.targetSheet, opts.targetMonster)
  const modifier = skillBonusForCombatant(opts.attacker, 'athletics', opts.attackerSheet, opts.attackerMonster)
  const verb = opts.kind === 'grapple' ? 'Grapple' : 'Shove'
  const check = resolveCheck({ d20: opts.d20, modifier, dc, label: `${opts.attacker.name} ${verb} (Athletics) vs ${opts.target.name}` })
  return { ...check, kind: opts.kind }
}
