import { briefFromTemplate, emptyBrief, parseBrief } from './campaign-hub.ts'
import type { EncounterBrief, EncounterTemplate, TemplateCharacter, TemplateMonster } from './types.ts'

type PackedMonsters = {
  monsters?: TemplateMonster[]
  characters?: TemplateCharacter[]
  brief?: EncounterBrief
}

function parseMaybeJson(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }
  return raw
}

function asMonsterList(raw: unknown): TemplateMonster[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((row): row is TemplateMonster => {
    if (!row || typeof row !== 'object') return false
    return Boolean((row as TemplateMonster).bestiaryMonsterId)
  })
}

function asCharacterList(raw: unknown): TemplateCharacter[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((row): row is TemplateCharacter => {
    if (!row || typeof row !== 'object') return false
    return Boolean((row as TemplateCharacter).characterId)
  })
}

/** Read monsters, player starts, and encounter brief from either the dedicated column or packed monsters_json. */
export function unpackTemplateJson(row: { monsters_json?: unknown; characters_json?: unknown }) {
  const fromColumn = asCharacterList(parseMaybeJson(row.characters_json))
  const raw = parseMaybeJson(row.monsters_json)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const packed = raw as PackedMonsters
    return {
      monsters: asMonsterList(packed.monsters),
      characters: fromColumn.length ? fromColumn : asCharacterList(packed.characters),
      brief: parseBrief(packed.brief),
    }
  }
  return {
    monsters: asMonsterList(raw),
    characters: fromColumn,
    brief: emptyBrief(),
  }
}

export function packMonstersJson(
  monsters: TemplateMonster[],
  characters: TemplateCharacter[],
  embedPlayers: boolean,
  brief?: EncounterBrief,
) {
  const packed: PackedMonsters = { monsters, brief: brief ?? emptyBrief() }
  if (embedPlayers) packed.characters = characters
  return packed
}

export function templateFromRow(row: Record<string, unknown>): EncounterTemplate {
  const packed = unpackTemplateJson(row)
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    mapId: String(row.map_id ?? ''),
    name: String(row.name ?? ''),
    monsters: packed.monsters,
    characters: packed.characters,
    notes: packed.brief.notes,
    objective: packed.brief.objective,
    difficulty: packed.brief.difficulty,
    xpAward: packed.brief.xpAward,
    lootNotes: packed.brief.lootNotes,
    sortOrder: packed.brief.sortOrder,
    chapter: packed.brief.chapter,
  }
}

export function packTemplateBody(body: Partial<EncounterTemplate>, embedPlayers: boolean) {
  const monsters = body.monsters ?? []
  const characters = body.characters ?? []
  return {
    monsters,
    characters,
    packed: packMonstersJson(monsters, characters, embedPlayers, briefFromTemplate(body)),
  }
}
