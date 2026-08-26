import { SKILLS, type Ability, type CharacterSheetData, type Combatant, type Monster } from './types.ts'
import { abilityMod, proficiencyBonus } from './utils.ts'

export function skillByKey(key: string) {
  return SKILLS.find((s) => s.key === key) ?? null
}

export function skillBonusFromSheet(sheet: CharacterSheetData, skillKey: string) {
  const skill = skillByKey(skillKey)
  if (!skill) return 0
  const pb = proficiencyBonus(sheet.level)
  const score = Number(sheet.abilities[skill.ability] ?? 10)
  let n = abilityMod(score)
  if (sheet.skillProf[skillKey]) n += pb
  if (sheet.skillExpertise[skillKey]) n += pb
  return n
}

/** Monster stat-block skills text, e.g. "Stealth +6, Perception +2". */
export function monsterSkillBonus(skills: string | undefined, skillName: string, abilityScore: number) {
  const m = String(skills ?? '').match(new RegExp(`${skillName}\\s*([+-]\\d+)`, 'i'))
  if (m) return Number(m[1])
  return abilityMod(abilityScore)
}

export function skillBonusForCombatant(
  combatant: Pick<Combatant, 'source' | 'stats'>,
  skillKey: string,
  sheet?: CharacterSheetData | null,
  monster?: (Pick<Monster, 'skills'> & Partial<Pick<Monster, 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'>>) | null,
) {
  const skill = skillByKey(skillKey)
  if (!skill) return 0
  if (combatant.source === 'character' && sheet) return skillBonusFromSheet(sheet, skillKey)
  const score = Number(
    monster?.[skill.ability] ?? combatant.stats?.[skill.ability] ?? (skill.ability === 'wis' ? 10 : 10),
  )
  return monsterSkillBonus(monster?.skills, skill.name, score)
}

export function passivePerception(
  combatant: Pick<Combatant, 'source' | 'stats'>,
  sheet?: CharacterSheetData | null,
  monster?: Pick<Monster, 'skills' | 'wis' | 'senses'> | null,
) {
  const fromSenses = String(monster?.senses ?? '').match(/passive Perception\s+(\d+)/i)
  if (fromSenses) return Number(fromSenses[1])
  return 10 + skillBonusForCombatant(combatant, 'perception', sheet, monster)
}

export function resolveCheck(opts: { d20: number; modifier: number; dc: number; label?: string }) {
  const { d20, modifier, dc } = opts
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) throw new Error('d20 must be between 1 and 20')
  const total = d20 + modifier
  const success = total >= dc
  const label = opts.label ? `${opts.label}: ` : ''
  return {
    d20,
    modifier,
    total,
    dc,
    success,
    message: `${label}${d20} ${modifier >= 0 ? '+' : '−'}${Math.abs(modifier)} = ${total} vs DC ${dc} — ${success ? 'success' : 'failure'}`,
  }
}

export function abilityScoreFor(combatant: Pick<Combatant, 'stats' | 'constitution'>, ability: Ability, sheet?: CharacterSheetData | null) {
  if (sheet) return Number(sheet.abilities[ability] ?? 10)
  if (combatant.stats) return Number(combatant.stats[ability] ?? 10)
  if (ability === 'con') return Number(combatant.constitution ?? 10)
  return 10
}
