import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { crXp } from '../src/lib/utils.ts'
import type { NamedEntry } from '../src/lib/types.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

type SrdMonster = {
  name: string
  size: string
  type: string | { type?: string }
  alignment: string
  armor_class: number | { type?: string; value: number; armor?: { name: string } }[]
  hit_points: number
  hit_dice?: string
  hit_points_roll?: string
  speed?: Record<string, string | boolean>
  strength: number
  dexterity: number
  constitution: number
  intelligence: number
  wisdom: number
  charisma: number
  proficiencies?: { value: number; proficiency: { name: string } }[]
  damage_vulnerabilities?: string[]
  damage_resistances?: string[]
  damage_immunities?: string[]
  condition_immunities?: { name: string }[]
  senses?: Record<string, string | number>
  languages?: string
  challenge_rating: number
  proficiency_bonus?: number
  xp?: number
  special_abilities?: { name: string; desc: string }[]
  actions?: { name: string; desc: string }[]
  legendary_actions?: { name: string; desc: string }[]
  reactions?: { name: string; desc: string }[]
  legendary_desc?: string
}

function asEntries(list?: { name: string; desc: string }[]): NamedEntry[] {
  return (list ?? []).map((e) => ({ name: e.name, desc: e.desc }))
}

function formatSpeed(speed?: Record<string, string | boolean>) {
  if (!speed) return '30 ft.'
  const parts: string[] = []
  for (const [k, v] of Object.entries(speed)) {
    if (k === 'hover') {
      if (v) parts.push('hover')
      continue
    }
    if (typeof v !== 'string') continue
    parts.push(k === 'walk' ? v : `${k} ${v}`)
  }
  return parts.join(', ') || '30 ft.'
}

function formatAc(ac: SrdMonster['armor_class']) {
  if (typeof ac === 'number') return { value: ac, note: '' }
  if (!Array.isArray(ac) || ac.length === 0) return { value: 10, note: '' }
  const first = ac[0]
  const noteParts = [first.type && first.type !== 'dex' ? first.type : '', first.armor?.name ?? ''].filter(Boolean)
  return { value: first.value, note: noteParts.join(', ') }
}

function formatSenses(senses?: Record<string, string | number>) {
  if (!senses) return ''
  return Object.entries(senses)
    .map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`)
    .join(', ')
}

function splitProfs(list: SrdMonster['proficiencies']) {
  const saves: string[] = []
  const skills: string[] = []
  for (const p of list ?? []) {
    const name = p.proficiency.name
    const signed = p.value >= 0 ? `+${p.value}` : String(p.value)
    if (name.startsWith('Saving Throw:')) {
      saves.push(`${name.replace('Saving Throw: ', '')} ${signed}`)
    } else if (name.startsWith('Skill:')) {
      skills.push(`${name.replace('Skill: ', '')} ${signed}`)
    }
  }
  return { savingThrows: saves.join(', '), skills: skills.join(', ') }
}

function creatureType(type: SrdMonster['type']) {
  if (typeof type === 'string') return type
  return type?.type ?? 'unknown'
}

export function loadSrdMonsters() {
  const file = path.join(root, 'data', 'srd-monsters.json')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as SrdMonster[]
  return raw.map((m) => {
    const ac = formatAc(m.armor_class)
    const profs = splitProfs(m.proficiencies)
    const cr = m.challenge_rating
    const pb = m.proficiency_bonus ?? Math.max(2, Math.min(9, 2 + Math.ceil(cr / 4)))
    const legendary = asEntries(m.legendary_actions)
    if (m.legendary_desc && legendary.length) {
      legendary.unshift({ name: 'Legendary Actions', desc: m.legendary_desc })
    }
    return {
      name: m.name,
      size: m.size,
      creatureType: creatureType(m.type),
      alignment: m.alignment,
      acValue: ac.value,
      acNote: ac.note,
      hpMax: m.hit_points,
      hitDiceFormula: m.hit_points_roll || m.hit_dice || '',
      speed: formatSpeed(m.speed),
      str: m.strength,
      dex: m.dexterity,
      con: m.constitution,
      int: m.intelligence,
      wis: m.wisdom,
      cha: m.charisma,
      savingThrows: profs.savingThrows,
      skills: profs.skills,
      damageVulnerabilities: (m.damage_vulnerabilities ?? []).join(', '),
      damageResistances: (m.damage_resistances ?? []).join(', '),
      damageImmunities: (m.damage_immunities ?? []).join(', '),
      conditionImmunities: (m.condition_immunities ?? []).map((c) => c.name).join(', '),
      senses: formatSenses(m.senses),
      languages: m.languages || '—',
      challengeRating: cr,
      xp: m.xp ?? crXp(cr),
      proficiencyBonus: pb,
      traits: asEntries(m.special_abilities),
      actions: asEntries(m.actions),
      legendaryActions: legendary,
      reactions: asEntries(m.reactions),
      bonusActions: [] as NamedEntry[],
      lairActions: [] as NamedEntry[],
      source: 'srd' as const,
    }
  })
}
