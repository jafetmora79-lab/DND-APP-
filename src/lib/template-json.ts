import type { TemplateCharacter, TemplateMonster } from './types'

type PackedMonsters = {
  monsters?: TemplateMonster[]
  characters?: TemplateCharacter[]
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

/** Read monsters + player starts from either the dedicated column or a packed monsters_json. */
export function unpackTemplateJson(row: { monsters_json?: unknown; characters_json?: unknown }) {
  const fromColumn = asCharacterList(row.characters_json)
  const raw = row.monsters_json
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const packed = raw as PackedMonsters
    return {
      monsters: asMonsterList(packed.monsters),
      characters: fromColumn.length ? fromColumn : asCharacterList(packed.characters),
    }
  }
  return {
    monsters: asMonsterList(raw),
    characters: fromColumn,
  }
}

export function packMonstersJson(monsters: TemplateMonster[], characters: TemplateCharacter[], embedPlayers: boolean) {
  if (!embedPlayers) return monsters
  return { monsters, characters }
}
