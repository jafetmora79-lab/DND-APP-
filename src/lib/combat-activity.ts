import type { Ability, CombatActivity, CombatPrompt } from './types.ts'

export const ACTIVITY_CAP = 40

export const OTHER_ACTION_LABELS = ['Search', 'Grapple', 'Shove', 'Use an Object', 'Cast Spell', 'Custom'] as const

export const OTHER_ACTION_LABEL_KEYS: Record<(typeof OTHER_ACTION_LABELS)[number], string> = {
  Search: 'other.search',
  Grapple: 'other.grapple',
  Shove: 'other.shove',
  'Use an Object': 'other.useObject',
  'Cast Spell': 'other.castSpell',
  Custom: 'other.custom',
}

export function parseActivity(raw: unknown): CombatActivity[] {
  if (!Array.isArray(raw)) return []
  const out: CombatActivity[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const text = String(o.text ?? '').trim()
    if (!text) continue
    out.push({
      id: String(o.id ?? ''),
      at: Number(o.at) || 0,
      text,
    })
  }
  return out.slice(-ACTIVITY_CAP)
}

export function parsePrompt(raw: unknown): CombatPrompt {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const kind = o.kind
  const combatantId = String(o.combatantId ?? o.combatant_id ?? '')
  if ((kind !== 'reaction' && kind !== 'save') || !combatantId) return null
  const ability = String(o.ability ?? '')
  const dc = Number(o.dc)
  const ab: Ability | undefined = (['str', 'dex', 'con', 'int', 'wis', 'cha'] as const).includes(ability as Ability)
    ? (ability as Ability)
    : undefined
  return {
    kind,
    combatantId,
    ability: ab,
    dc: Number.isFinite(dc) && dc > 0 ? Math.round(dc) : undefined,
  }
}

export function appendActivity(list: CombatActivity[], text: string): CombatActivity[] {
  const line = String(text ?? '').trim()
  if (!line) return list
  const next = [...list, { id: Math.random().toString(36).slice(2, 10), at: Date.now(), text: line }]
  return next.slice(-ACTIVITY_CAP)
}

export function attackActivityLines(opts: {
  attackerName: string
  targetName: string
  diceNote: string
  bonus: number
  total: number
  hit: boolean
  fumble: boolean
  damage: number
}) {
  const lines = [
    `${opts.attackerName} attacks ${opts.targetName}.`,
    `Attack roll: ${opts.diceNote} + ${opts.bonus} = ${opts.total}.`,
    opts.hit ? 'HIT.' : opts.fumble ? 'MISS (nat 1).' : 'MISS.',
  ]
  if (opts.hit) {
    lines.push(`Damage: ${opts.damage}.`)
    lines.push(`${opts.targetName} took ${opts.damage} damage.`)
  }
  return lines
}
