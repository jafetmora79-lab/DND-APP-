import type { Monster, TemplateMonster } from './types'

export type XpThresholds = { easy: number; medium: number; hard: number; deadly: number }
export type EncounterDifficulty = 'trivial' | 'easy' | 'medium' | 'hard' | 'deadly'

// DMG (2014) "XP Thresholds by Character Level" table.
const XP_THRESHOLDS_BY_LEVEL: Record<number, XpThresholds> = {
  1: { easy: 25, medium: 50, hard: 75, deadly: 100 },
  2: { easy: 50, medium: 100, hard: 150, deadly: 200 },
  3: { easy: 75, medium: 150, hard: 225, deadly: 400 },
  4: { easy: 125, medium: 250, hard: 375, deadly: 500 },
  5: { easy: 250, medium: 500, hard: 750, deadly: 1100 },
  6: { easy: 300, medium: 600, hard: 900, deadly: 1400 },
  7: { easy: 350, medium: 750, hard: 1100, deadly: 1700 },
  8: { easy: 450, medium: 900, hard: 1400, deadly: 2100 },
  9: { easy: 550, medium: 1100, hard: 1600, deadly: 2400 },
  10: { easy: 600, medium: 1200, hard: 1900, deadly: 2800 },
  11: { easy: 800, medium: 1600, hard: 2400, deadly: 3600 },
  12: { easy: 1000, medium: 2000, hard: 3000, deadly: 4500 },
  13: { easy: 1100, medium: 2200, hard: 3400, deadly: 5100 },
  14: { easy: 1250, medium: 2500, hard: 3800, deadly: 5700 },
  15: { easy: 1400, medium: 2800, hard: 4300, deadly: 6400 },
  16: { easy: 1600, medium: 3200, hard: 4800, deadly: 7200 },
  17: { easy: 2000, medium: 3900, hard: 5900, deadly: 8800 },
  18: { easy: 2100, medium: 4200, hard: 6300, deadly: 9500 },
  19: { easy: 2400, medium: 4900, hard: 7300, deadly: 10900 },
  20: { easy: 2800, medium: 5700, hard: 8500, deadly: 12700 },
}

// DMG "Encounter Multipliers" table, indexed by monster-count bucket.
const MULTIPLIERS = [1, 1.5, 2, 2.5, 3, 4]

function multiplierBucket(monsterCount: number) {
  if (monsterCount <= 1) return 0
  if (monsterCount === 2) return 1
  if (monsterCount <= 6) return 2
  if (monsterCount <= 10) return 3
  if (monsterCount <= 14) return 4
  return 5
}

/** DMG rule: a party smaller than 3 treats the encounter as one bucket more dangerous; 6+ treats it as one bucket less. */
export function encounterMultiplier(monsterCount: number, partySize: number) {
  if (monsterCount <= 0) return 1
  let bucket = multiplierBucket(monsterCount)
  if (partySize > 0 && partySize < 3) bucket = Math.min(bucket + 1, MULTIPLIERS.length - 1)
  else if (partySize >= 6) bucket = Math.max(bucket - 1, 0)
  return MULTIPLIERS[bucket]
}

export function thresholdsForLevel(level: number): XpThresholds {
  const clamped = Math.min(20, Math.max(1, Math.round(level) || 1))
  return XP_THRESHOLDS_BY_LEVEL[clamped]
}

/** Sums each party member's own threshold row — the DMG's method for an uneven-level party. */
export function partyThresholds(levels: number[]): XpThresholds {
  return levels.reduce<XpThresholds>(
    (sum, level) => {
      const t = thresholdsForLevel(level)
      return { easy: sum.easy + t.easy, medium: sum.medium + t.medium, hard: sum.hard + t.hard, deadly: sum.deadly + t.deadly }
    },
    { easy: 0, medium: 0, hard: 0, deadly: 0 },
  )
}

export function monsterXpTotal(templateMonsters: TemplateMonster[], monsterById: Map<string, Pick<Monster, 'xp'>>) {
  return templateMonsters.reduce((sum, m) => sum + Math.max(0, m.quantity) * (monsterById.get(m.bestiaryMonsterId)?.xp ?? 0), 0)
}

export function difficultyForXp(adjustedXp: number, thresholds: XpThresholds): EncounterDifficulty {
  if (adjustedXp >= thresholds.deadly) return 'deadly'
  if (adjustedXp >= thresholds.hard) return 'hard'
  if (adjustedXp >= thresholds.medium) return 'medium'
  if (adjustedXp >= thresholds.easy) return 'easy'
  return 'trivial'
}

export type EncounterBudget = {
  partySize: number
  monsterCount: number
  baseXp: number
  multiplier: number
  adjustedXp: number
  thresholds: XpThresholds
  difficulty: EncounterDifficulty
}

export function computeEncounterBudget(
  templateMonsters: TemplateMonster[],
  monsterById: Map<string, Pick<Monster, 'xp'>>,
  partyLevels: number[],
): EncounterBudget {
  const monsterCount = templateMonsters.reduce((n, m) => n + Math.max(0, m.quantity), 0)
  const baseXp = monsterXpTotal(templateMonsters, monsterById)
  const partySize = partyLevels.length
  const multiplier = encounterMultiplier(monsterCount, partySize)
  const adjustedXp = Math.round(baseXp * multiplier)
  const thresholds = partyThresholds(partySize > 0 ? partyLevels : [1])
  const difficulty = difficultyForXp(adjustedXp, thresholds)
  return { partySize, monsterCount, baseXp, multiplier, adjustedXp, thresholds, difficulty }
}
