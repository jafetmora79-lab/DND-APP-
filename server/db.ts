import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import Database from 'better-sqlite3'
import { customAlphabet, nanoid } from 'nanoid'
import { emptySheet, TOKEN_PALETTE, type BattleMap, type CharacterSheetData, type FogState, type NamedEntry } from '../src/lib/types.ts'
import { cellCenter, parseBlockedCells, playerStartOrigin, spreadCells, tokenCellKeys, tokenSizeSquares, walkablePixel } from '../src/lib/utils.ts'
import { afterHpChange, applyDamage, attackOutcome, attacksFromMonster, canTakeAttacks, combatantStatsFromMonster, consumeAdvantage, effectiveRollMode, emptyTurnEconomy, formatDiceUsed, grantAdvantage, isAttackInRange, parseAttackBonus, parseDeathState, parseRangeFeet, parseRollMode, parseTurnEconomy, pickUsedD20, resolveDeathSave, specCopyCell, tokenCell, type PlayerAttackResult } from '../src/lib/combat.ts'
import { loadSrdMonsters } from './srd.ts'
import { applyEncounterRewards, emptyBrief, parseHub } from '../src/lib/campaign-hub.ts'
import { unpackTemplateJson } from '../src/lib/template-json.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = path.join(root, 'data')
fs.mkdirSync(dataDir, { recursive: true })

export const db = new Database(path.join(dataDir, 'table.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

export const ids = {
  id: () => nanoid(12),
  join: customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6),
  personal: customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8),
  token: () => nanoid(24),
}

db.exec(`
CREATE TABLE IF NOT EXISTS dm_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  passcode_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  dm_id TEXT,
  character_id TEXT,
  campaign_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  dm_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  hub_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (dm_account_id) REFERENCES dm_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS bestiary_monsters (
  id TEXT PRIMARY KEY,
  dm_account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size TEXT,
  creature_type TEXT,
  alignment TEXT,
  ac_value INTEGER,
  ac_note TEXT,
  hp_max INTEGER,
  hit_dice_formula TEXT,
  speed TEXT,
  str INTEGER, dex INTEGER, con INTEGER, int INTEGER, wis INTEGER, cha INTEGER,
  saving_throws TEXT,
  skills TEXT,
  damage_vulnerabilities TEXT,
  damage_resistances TEXT,
  damage_immunities TEXT,
  condition_immunities TEXT,
  senses TEXT,
  languages TEXT,
  challenge_rating REAL,
  xp INTEGER,
  proficiency_bonus INTEGER,
  traits TEXT,
  actions TEXT,
  legendary_actions TEXT,
  reactions TEXT,
  bonus_actions TEXT,
  lair_actions TEXT,
  source TEXT,
  FOREIGN KEY (dm_account_id) REFERENCES dm_accounts(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS player_characters (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  personal_code TEXT NOT NULL UNIQUE,
  owner_display_name TEXT,
  name TEXT,
  token_color TEXT,
  source_pdf_url TEXT,
  sheet_json TEXT NOT NULL,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  name TEXT NOT NULL,
  image_url TEXT NOT NULL,
  grid_size INTEGER NOT NULL,
  grid_cols INTEGER NOT NULL,
  grid_rows INTEGER NOT NULL,
  grid_type TEXT NOT NULL DEFAULT 'square',
  blocked_cells TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS encounter_templates (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  map_id TEXT NOT NULL,
  name TEXT NOT NULL,
  monsters_json TEXT NOT NULL,
  characters_json TEXT NOT NULL DEFAULT '[]',
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS encounter_instances (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL,
  encounter_template_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  round_number INTEGER NOT NULL,
  current_turn_position INTEGER NOT NULL,
  fog_state TEXT NOT NULL,
  map_id TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS combatants (
  id TEXT PRIMARY KEY,
  encounter_instance_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT,
  initiative INTEGER NOT NULL DEFAULT 0,
  hp_current INTEGER NOT NULL,
  hp_max INTEGER NOT NULL,
  hp_temp INTEGER NOT NULL DEFAULT 0,
  ac INTEGER NOT NULL,
  conditions_json TEXT NOT NULL,
  turn_order_position INTEGER NOT NULL,
  color TEXT,
  notes TEXT,
  constitution INTEGER NOT NULL DEFAULT 10,
  advantage_against_json TEXT NOT NULL DEFAULT '[]',
  death_state TEXT NOT NULL DEFAULT 'ok',
  death_success INTEGER NOT NULL DEFAULT 0,
  death_fail INTEGER NOT NULL DEFAULT 0,
  turn_economy_json TEXT NOT NULL DEFAULT '{"action":false,"bonus":false,"reaction":false,"movement":false}',
  stats_json TEXT,
  FOREIGN KEY (encounter_instance_id) REFERENCES encounter_instances(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS tokens_on_map (
  id TEXT PRIMARY KEY,
  encounter_instance_id TEXT NOT NULL,
  x REAL NOT NULL,
  y REAL NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  label TEXT,
  color TEXT,
  size_squares INTEGER NOT NULL DEFAULT 1,
  visible_to_players INTEGER NOT NULL DEFAULT 1,
  FOREIGN KEY (encounter_instance_id) REFERENCES encounter_instances(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS live_sessions (
  id TEXT PRIMARY KEY,
  join_code TEXT NOT NULL UNIQUE,
  campaign_id TEXT NOT NULL,
  encounter_instance_id TEXT,
  created_at INTEGER NOT NULL,
  table_phase TEXT NOT NULL DEFAULT 'table',
  ambiance_image_url TEXT,
  ambiance_caption TEXT NOT NULL DEFAULT '',
  last_outcome TEXT,
  FOREIGN KEY (campaign_id) REFERENCES campaigns(id) ON DELETE CASCADE
);
`)

try {
  db.exec(`ALTER TABLE campaigns ADD COLUMN hub_json TEXT NOT NULL DEFAULT '{}'`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE maps ADD COLUMN blocked_cells TEXT NOT NULL DEFAULT '[]'`)
} catch {
  /* already present on existing databases */
}
try {
  db.exec(`ALTER TABLE encounter_templates ADD COLUMN characters_json TEXT NOT NULL DEFAULT '[]'`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN constitution INTEGER NOT NULL DEFAULT 10`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN advantage_against_json TEXT NOT NULL DEFAULT '[]'`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN death_state TEXT NOT NULL DEFAULT 'ok'`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN death_success INTEGER NOT NULL DEFAULT 0`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN death_fail INTEGER NOT NULL DEFAULT 0`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN turn_economy_json TEXT NOT NULL DEFAULT '{"action":false,"bonus":false,"reaction":false,"movement":false}'`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE combatants ADD COLUMN stats_json TEXT`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE live_sessions ADD COLUMN table_phase TEXT NOT NULL DEFAULT 'table'`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE live_sessions ADD COLUMN ambiance_image_url TEXT`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE live_sessions ADD COLUMN ambiance_caption TEXT NOT NULL DEFAULT ''`)
} catch {
  /* already present */
}
try {
  db.exec(`ALTER TABLE live_sessions ADD COLUMN last_outcome TEXT`)
} catch {
  /* already present */
}
try {
  db.exec(`UPDATE live_sessions SET table_phase = 'combat' WHERE encounter_instance_id IS NOT NULL AND (table_phase IS NULL OR table_phase = 'table')`)
} catch {
  /* ignore */
}

export function now() {
  return Date.now()
}

export function mapFromDb(row: Record<string, unknown>): BattleMap {
  const gridCols = Number(row.grid_cols)
  const gridRows = Number(row.grid_rows)
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    name: String(row.name),
    imageUrl: String(row.image_url ?? ''),
    gridSize: Number(row.grid_size),
    gridCols,
    gridRows,
    gridType: 'square',
    blocked: parseBlockedCells(row.blocked_cells, gridCols, gridRows),
  }
}

export function jparse<T>(s: string, fallback: T): T {
  try {
    return JSON.parse(s) as T
  } catch {
    return fallback
  }
}

export function monsterFromRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    dmAccountId: row.dm_account_id as string,
    name: row.name as string,
    size: row.size as string,
    creatureType: row.creature_type as string,
    alignment: row.alignment as string,
    acValue: row.ac_value as number,
    acNote: row.ac_note as string,
    hpMax: row.hp_max as number,
    hitDiceFormula: row.hit_dice_formula as string,
    speed: row.speed as string,
    str: row.str as number,
    dex: row.dex as number,
    con: row.con as number,
    int: row.int as number,
    wis: row.wis as number,
    cha: row.cha as number,
    savingThrows: row.saving_throws as string,
    skills: row.skills as string,
    damageVulnerabilities: row.damage_vulnerabilities as string,
    damageResistances: row.damage_resistances as string,
    damageImmunities: row.damage_immunities as string,
    conditionImmunities: row.condition_immunities as string,
    senses: row.senses as string,
    languages: row.languages as string,
    challengeRating: row.challenge_rating as number,
    xp: row.xp as number,
    proficiencyBonus: row.proficiency_bonus as number,
    traits: jparse<NamedEntry[]>(row.traits as string, []),
    actions: jparse<NamedEntry[]>(row.actions as string, []),
    legendaryActions: jparse<NamedEntry[]>(row.legendary_actions as string, []),
    reactions: jparse<NamedEntry[]>(row.reactions as string, []),
    bonusActions: jparse<NamedEntry[]>(row.bonus_actions as string, []),
    lairActions: jparse<NamedEntry[]>(row.lair_actions as string, []),
    source: row.source as 'srd' | 'custom',
  }
}

export function characterFromRow(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    campaignId: row.campaign_id as string,
    personalCode: row.personal_code as string,
    ownerDisplayName: row.owner_display_name as string,
    name: row.name as string,
    tokenColor: row.token_color as string,
    sourcePdfUrl: (row.source_pdf_url as string) || null,
    sheet: { ...emptySheet(), ...jparse<CharacterSheetData>(row.sheet_json as string, emptySheet()) },
  }
}

export function insertMonster(
  dmId: string,
  m: Omit<ReturnType<typeof loadSrdMonsters>[number], 'source'> & { id?: string; source: 'srd' | 'custom' },
) {
  const id = m.id ?? ids.id()
  db.prepare(
    `INSERT INTO bestiary_monsters (
      id, dm_account_id, name, size, creature_type, alignment, ac_value, ac_note, hp_max, hit_dice_formula, speed,
      str, dex, con, int, wis, cha, saving_throws, skills, damage_vulnerabilities, damage_resistances, damage_immunities,
      condition_immunities, senses, languages, challenge_rating, xp, proficiency_bonus, traits, actions, legendary_actions,
      reactions, bonus_actions, lair_actions, source
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    dmId,
    m.name,
    m.size,
    m.creatureType,
    m.alignment,
    m.acValue,
    m.acNote,
    m.hpMax,
    m.hitDiceFormula,
    m.speed,
    m.str,
    m.dex,
    m.con,
    m.int,
    m.wis,
    m.cha,
    m.savingThrows,
    m.skills,
    m.damageVulnerabilities,
    m.damageResistances,
    m.damageImmunities,
    m.conditionImmunities,
    m.senses,
    m.languages,
    m.challengeRating,
    m.xp,
    m.proficiencyBonus,
    JSON.stringify(m.traits),
    JSON.stringify(m.actions),
    JSON.stringify(m.legendaryActions),
    JSON.stringify(m.reactions),
    JSON.stringify(m.bonusActions),
    JSON.stringify(m.lairActions),
    m.source,
  )
  return id
}

export function seedBestiaryForDm(dmId: string) {
  const count = db.prepare('SELECT COUNT(*) as c FROM bestiary_monsters WHERE dm_account_id = ?').get(dmId) as { c: number }
  if (count.c > 0) return count.c
  const monsters = loadSrdMonsters()
  const tx = db.transaction(() => {
    for (const m of monsters) insertMonster(dmId, m)
  })
  tx()
  return monsters.length
}

function defaultFog(cols: number, rows: number): FogState {
  return {
    cols,
    rows,
    enabled: false,
    revealed: Array.from({ length: cols * rows }, () => 1),
  }
}

export function spawnFromTemplate(campaignId: string, templateId: string, name?: string) {
  const template = db.prepare('SELECT * FROM encounter_templates WHERE id = ? AND campaign_id = ?').get(templateId, campaignId) as
    | Record<string, unknown>
    | undefined
  if (!template) throw new Error('Template not found')
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(template.map_id) as Record<string, unknown>
  const packed = unpackTemplateJson(template)
  const monsters = packed.monsters
  const starters = packed.characters
  const instanceId = ids.id()
  const cell = Number(map.grid_size)
  db.prepare(
    `INSERT INTO encounter_instances (id, campaign_id, encounter_template_id, name, status, round_number, current_turn_position, fog_state, map_id)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    instanceId,
    campaignId,
    templateId,
    name || (template.name as string),
    'active',
    1,
    0,
    JSON.stringify(defaultFog(Number(map.grid_cols), Number(map.grid_rows))),
    map.id,
  )

  let order = 0
  let placed = 0
  for (const spec of monsters) {
    const src = db.prepare('SELECT * FROM bestiary_monsters WHERE id = ?').get(spec.bestiaryMonsterId) as Record<string, unknown> | undefined
    if (!src) continue
    for (let i = 0; i < spec.quantity; i++) {
      const cid = ids.id()
      const label = spec.quantity > 1 ? `${spec.name} ${i + 1}` : spec.name
      db.prepare(
        `INSERT INTO combatants (id, encounter_instance_id, name, source, source_id, initiative, hp_current, hp_max, hp_temp, ac, conditions_json, turn_order_position, color, notes, constitution, stats_json)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        cid,
        instanceId,
        label,
        'bestiary',
        spec.bestiaryMonsterId,
        0,
        src.hp_max,
        src.hp_max,
        0,
        src.ac_value,
        '[]',
        order++,
        spec.color,
        '',
        Number(src.con ?? 10),
        JSON.stringify(combatantStatsFromMonster(src)),
      )
      const { col, row } = specCopyCell(spec, i, placed)
      const size = tokenSizeSquares(String(src.size ?? 'Medium'))
      const pos = walkablePixel(
        {
          blocked: parseBlockedCells(map.blocked_cells, Number(map.grid_cols), Number(map.grid_rows)),
          gridCols: Number(map.grid_cols),
          gridRows: Number(map.grid_rows),
          gridSize: cell,
        },
        col,
        row,
        size,
      )
      db.prepare(
        `INSERT INTO tokens_on_map (id, encounter_instance_id, x, y, ref_type, ref_id, label, color, size_squares, visible_to_players)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
      ).run(
        ids.id(),
        instanceId,
        pos.x,
        pos.y,
        'combatant',
        cid,
        label,
        spec.color || '#c4453c',
        size,
        1,
      )
      placed++
    }
  }
  for (const spec of starters) {
    addCharacterCombatant(instanceId, spec.characterId, { col: spec.startX, row: spec.startY })
  }
  return instanceId
}

function mapForInstance(instanceId: string) {
  const inst = db.prepare('SELECT map_id FROM encounter_instances WHERE id = ?').get(instanceId) as { map_id: string } | undefined
  if (!inst?.map_id) return undefined
  return db.prepare('SELECT * FROM maps WHERE id = ?').get(inst.map_id) as Record<string, unknown> | undefined
}

function placeCharacterToken(
  instanceId: string,
  combatantId: string,
  label: string,
  color: string,
  map: Record<string, unknown> | undefined,
  start?: { col: number; row: number },
) {
  const cell = Number(map?.grid_size ?? 70)
  const cols = Number(map?.grid_cols ?? 20)
  const rows = Number(map?.grid_rows ?? 15)
  const blocked = map ? parseBlockedCells(map.blocked_cells, cols, rows) : []
  const tokens = db.prepare('SELECT x, y, size_squares FROM tokens_on_map WHERE encounter_instance_id = ?').all(instanceId) as {
    x: number
    y: number
    size_squares: number
  }[]
  const occupied = tokenCellKeys(
    tokens.map((t) => ({ x: t.x, y: t.y, sizeSquares: t.size_squares })),
    cell,
  )
  const origin = start ?? playerStartOrigin(cols, rows)
  const found = spreadCells(origin, 1, cols, rows, blocked, occupied)[0]
  const pos = cellCenter(found.col, found.row, cell)
  db.prepare(
    `INSERT INTO tokens_on_map (id, encounter_instance_id, x, y, ref_type, ref_id, label, color, size_squares, visible_to_players)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  ).run(ids.id(), instanceId, pos.x, pos.y, 'combatant', combatantId, label, color, 1, 1)
}

export function addCharacterCombatant(instanceId: string, characterId: string, start?: { col: number; row: number }) {
  const ch = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(characterId) as Record<string, unknown> | undefined
  if (!ch) throw new Error('Character not found')
  const existing = db
    .prepare(`SELECT id FROM combatants WHERE encounter_instance_id = ? AND source = 'character' AND source_id = ?`)
    .get(instanceId, characterId) as { id: string } | undefined
  const map = mapForInstance(instanceId)
  if (existing) {
    const tok = db.prepare('SELECT id FROM tokens_on_map WHERE encounter_instance_id = ? AND ref_id = ?').get(instanceId, existing.id)
    if (!tok) placeCharacterToken(instanceId, existing.id, String(ch.name), String(ch.token_color), map, start)
    return existing
  }
  const sheet = jparse<CharacterSheetData>(ch.sheet_json as string, emptySheet())
  const maxPos = db.prepare('SELECT COALESCE(MAX(turn_order_position), -1) as m FROM combatants WHERE encounter_instance_id = ?').get(instanceId) as {
    m: number
  }
  const cid = ids.id()
  db.prepare(
    `INSERT INTO combatants (id, encounter_instance_id, name, source, source_id, initiative, hp_current, hp_max, hp_temp, ac, conditions_json, turn_order_position, color, notes, constitution)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    cid,
    instanceId,
    ch.name,
    'character',
    characterId,
    0,
    sheet.hpCurrent,
    sheet.hpMax,
    sheet.hpTemp,
    sheet.ac,
    '[]',
    maxPos.m + 1,
    ch.token_color,
    '',
    sheet.abilities.con,
  )
  placeCharacterToken(instanceId, cid, String(ch.name), String(ch.token_color), map, start)
  return { id: cid }
}

export function resolveCombatAttack(opts: {
  campaignId: string
  instanceId: string
  attackerId: string
  targetId: string
  attackIndex: number
  d20: number
  d20b?: number
  rollMode?: string
  damage: number
}): PlayerAttackResult {
  const { campaignId, instanceId, attackerId, targetId, attackIndex, d20, damage } = opts
  if (!Number.isInteger(d20) || d20 < 1 || d20 > 20) throw new Error('d20 must be between 1 and 20')
  const requested = parseRollMode(opts.rollMode)
  let d20b = opts.d20b
  if (requested !== 'normal') {
    if (!Number.isInteger(d20b) || (d20b as number) < 1 || (d20b as number) > 20) {
      throw new Error('Enter both d20s for advantage or disadvantage')
    }
  } else {
    d20b = undefined
  }
  if (!Number.isFinite(damage) || damage < 0 || damage > 999) throw new Error('Damage looks wrong')
  const inst = db.prepare('SELECT * FROM encounter_instances WHERE id = ? AND campaign_id = ?').get(instanceId, campaignId) as
    | Record<string, unknown>
    | undefined
  if (!inst) throw new Error('Encounter not found')
  const attacker = db.prepare('SELECT * FROM combatants WHERE id = ? AND encounter_instance_id = ?').get(attackerId, instanceId) as
    | Record<string, unknown>
    | undefined
  if (!attacker) throw new Error('Attacker is not on the map')
  if (
    !canTakeAttacks({
      conditions: jparse<string[]>((attacker.conditions_json as string) || '[]', []),
      deathState: parseDeathState(attacker.death_state),
    })
  ) {
    throw new Error(`${attacker.name} cannot take a normal attack`)
  }
  const target = db.prepare('SELECT * FROM combatants WHERE id = ? AND encounter_instance_id = ?').get(targetId, instanceId) as
    | Record<string, unknown>
    | undefined
  if (!target) throw new Error('Target not found')
  if (String(target.id) === String(attacker.id)) throw new Error('Pick a different creature')
  const attack = lookupAttack(attacker, attackIndex)
  const map = inst.map_id ? (db.prepare('SELECT * FROM maps WHERE id = ?').get(inst.map_id) as Record<string, unknown> | undefined) : undefined
  const fromTok = db
    .prepare('SELECT * FROM tokens_on_map WHERE encounter_instance_id = ? AND ref_id = ?')
    .get(instanceId, attacker.id) as Record<string, unknown> | undefined
  const toTok = db
    .prepare('SELECT * FROM tokens_on_map WHERE encounter_instance_id = ? AND ref_id = ?')
    .get(instanceId, target.id) as Record<string, unknown> | undefined
  if (!fromTok || !toTok || !map) throw new Error('Both creatures need to be on the map')
  const gridSize = Number(map.grid_size)
  const inRange = isAttackInRange(
    { ...tokenCell({ x: Number(fromTok.x), y: Number(fromTok.y) }, gridSize), size: Number(fromTok.size_squares ?? 1) },
    { ...tokenCell({ x: Number(toTok.x), y: Number(toTok.y) }, gridSize), size: Number(toTok.size_squares ?? 1) },
    parseRangeFeet(attack.range),
  )
  if (!inRange) throw new Error(`That creature is out of range (${parseRangeFeet(attack.range)} ft)`)
  const bonus = parseAttackBonus(attack.bonus)
  const ac = Number(target.ac)
  const attackerAdv = jparse<string[]>((attacker.advantage_against_json as string) || '[]', [])
  const targetAdv = jparse<string[]>((target.advantage_against_json as string) || '[]', [])
  const hadAdvantage = attackerAdv.includes(String(target.id))
  const mode = effectiveRollMode(requested, hadAdvantage)
  const dice = pickUsedD20(d20, mode === 'normal' ? undefined : d20b, mode)
  const outcome = attackOutcome(dice.used, bonus, ac)
  const total = dice.used + bonus
  const diceNote = formatDiceUsed(dice.a, dice.b, dice.used)
  const nextAttackerAdv = consumeAdvantage(attackerAdv, String(target.id))
  const nextTargetAdv = outcome === 'fumble' ? grantAdvantage(targetAdv, String(attacker.id)) : targetAdv
  db.prepare('UPDATE combatants SET advantage_against_json = ? WHERE id = ?').run(JSON.stringify(nextAttackerAdv), attacker.id)
  db.prepare('UPDATE combatants SET advantage_against_json = ? WHERE id = ?').run(JSON.stringify(nextTargetAdv), target.id)
  const fumbleNote =
    outcome === 'fumble' ? ` ${target.name} has advantage against ${attacker.name} next turn.` : ''
  const modeNote = mode === 'normal' ? '' : ` (${mode})`
  if (outcome === 'miss' || outcome === 'fumble') {
    return {
      hit: false,
      crit: false,
      fumble: outcome === 'fumble',
      hadAdvantage,
      rollMode: mode,
      d20: dice.used,
      d20b: dice.b,
      total,
      ac,
      damage: 0,
      hpCurrent: Number(target.hp_current),
      hpTemp: Number(target.hp_temp),
      targetName: String(target.name),
      message:
        outcome === 'fumble'
          ? `${diceNote}${modeNote}. Natural 1 against ${target.name} — miss.${fumbleNote}`
          : `${diceNote}${modeNote}. ${total} vs AC ${ac} — need higher than ${ac} to hit ${target.name}.${hadAdvantage ? ' (advantage used)' : ''}`,
    }
  }
  const prevHp = Number(target.hp_current)
  const next = applyDamage(prevHp, Number(target.hp_temp), damage)
  db.prepare('UPDATE combatants SET hp_current = ?, hp_temp = ? WHERE id = ?').run(next.hpCurrent, next.hpTemp, target.id)
  applyKnockout(target, prevHp, next.hpCurrent, outcome === 'crit' ? 2 : 1)
  if (target.source === 'character') {
    const victim = db.prepare('SELECT sheet_json FROM player_characters WHERE id = ?').get(target.source_id) as { sheet_json: string } | undefined
    if (victim) {
      const vs = jparse(victim.sheet_json, {} as Record<string, unknown>)
      vs.hpCurrent = next.hpCurrent
      vs.hpTemp = next.hpTemp
      db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(vs), target.source_id)
    }
  }
  const crit = outcome === 'crit'
  return {
    hit: true,
    crit,
    fumble: false,
    hadAdvantage,
    rollMode: mode,
    d20: dice.used,
    d20b: dice.b,
    total,
    ac,
    damage,
    hpCurrent: next.hpCurrent,
    hpTemp: next.hpTemp,
    targetName: String(target.name),
    message: crit
      ? `${diceNote}${modeNote}. Natural 20! ${damage} damage to ${target.name} (${next.hpCurrent} HP left).`
      : `${diceNote}${modeNote}. Hit ${target.name} (${total} beats AC ${ac}) for ${damage} damage (${next.hpCurrent} HP left).`,
  }
}

function applyKnockout(target: Record<string, unknown>, prevHp: number, nextHp: number, extraDeathFails: number) {
  const next = afterHpChange({
    source: target.source === 'character' ? 'character' : 'bestiary',
    prevHp,
    nextHp,
    conditions: jparse<string[]>((target.conditions_json as string) || '[]', []),
    deathState: parseDeathState(target.death_state),
    deathSuccess: Number(target.death_success ?? 0),
    deathFail: Number(target.death_fail ?? 0),
    extraDeathFails: prevHp <= 0 && nextHp <= 0 ? extraDeathFails : undefined,
  })
  db.prepare('UPDATE combatants SET conditions_json = ?, death_state = ?, death_success = ?, death_fail = ? WHERE id = ?').run(
    JSON.stringify(next.conditions),
    next.deathState,
    next.deathSuccess,
    next.deathFail,
    target.id,
  )
  if (target.source === 'character') {
    const victim = db.prepare('SELECT sheet_json FROM player_characters WHERE id = ?').get(target.source_id) as { sheet_json: string } | undefined
    if (victim) {
      const vs = jparse(victim.sheet_json, {} as Record<string, unknown>)
      vs.deathSuccess = next.deathSuccess
      vs.deathFail = next.deathFail
      db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(vs), target.source_id)
    }
  }
}

export function applyCombatDeathSave(combatantId: string, d20: number) {
  const row = db.prepare('SELECT * FROM combatants WHERE id = ?').get(combatantId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Combatant not found')
  if (row.source !== 'character') throw new Error('Death saves are for player characters')
  const result = resolveDeathSave(d20, {
    deathSuccess: Number(row.death_success ?? 0),
    deathFail: Number(row.death_fail ?? 0),
    deathState: parseDeathState(row.death_state),
  })
  let conditions = jparse<string[]>((row.conditions_json as string) || '[]', [])
  let hp = Number(row.hp_current)
  if (result.revived) {
    hp = result.hpCurrent
    conditions = conditions.filter((c) => c !== 'Unconscious')
  } else if (result.deathState === 'dying' || result.deathState === 'stable') {
    if (!conditions.includes('Unconscious')) conditions.push('Unconscious')
  }
  db.prepare('UPDATE combatants SET death_state = ?, death_success = ?, death_fail = ?, hp_current = ?, conditions_json = ? WHERE id = ?').run(
    result.deathState,
    result.deathSuccess,
    result.deathFail,
    hp,
    JSON.stringify(conditions),
    combatantId,
  )
  const ch = db.prepare('SELECT sheet_json FROM player_characters WHERE id = ?').get(row.source_id) as { sheet_json: string } | undefined
  if (ch) {
    const sheet = jparse(ch.sheet_json, {} as Record<string, unknown>)
    sheet.deathSuccess = result.deathSuccess
    sheet.deathFail = result.deathFail
    sheet.hpCurrent = hp
    db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(sheet), row.source_id)
  }
  return result
}

export function resetCombatDeath(combatantId: string) {
  const row = db.prepare('SELECT * FROM combatants WHERE id = ?').get(combatantId) as Record<string, unknown> | undefined
  if (!row) throw new Error('Combatant not found')
  const conditions = jparse<string[]>((row.conditions_json as string) || '[]', []).filter((c) => c !== 'Unconscious')
  db.prepare('UPDATE combatants SET death_state = ?, death_success = 0, death_fail = 0, conditions_json = ? WHERE id = ?').run(
    'ok',
    JSON.stringify(conditions),
    combatantId,
  )
  if (row.source === 'character') {
    const ch = db.prepare('SELECT sheet_json FROM player_characters WHERE id = ?').get(row.source_id) as { sheet_json: string } | undefined
    if (ch) {
      const sheet = jparse(ch.sheet_json, {} as Record<string, unknown>)
      sheet.deathSuccess = 0
      sheet.deathFail = 0
      db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(sheet), row.source_id)
    }
  }
}

export function resetTurnEconomyAt(instanceId: string, turnOrderPosition: number) {
  const row = db
    .prepare('SELECT id FROM combatants WHERE encounter_instance_id = ? AND turn_order_position = ?')
    .get(instanceId, turnOrderPosition) as { id: string } | undefined
  if (!row) return
  db.prepare('UPDATE combatants SET turn_economy_json = ? WHERE id = ?').run(JSON.stringify(emptyTurnEconomy()), row.id)
}

export function setCombatTurnEconomy(combatantId: string, economy: unknown) {
  const row = db.prepare('SELECT id FROM combatants WHERE id = ?').get(combatantId) as { id: string } | undefined
  if (!row) throw new Error('Combatant not found')
  db.prepare('UPDATE combatants SET turn_economy_json = ? WHERE id = ?').run(JSON.stringify(parseTurnEconomy(economy)), combatantId)
}

export function applyHpKnockout(combatantId: string, prevHp: number, nextHp: number) {
  const target = db.prepare('SELECT * FROM combatants WHERE id = ?').get(combatantId) as Record<string, unknown> | undefined
  if (!target) return
  applyKnockout(target, prevHp, nextHp, 1)
}

function lookupAttack(attacker: Record<string, unknown>, attackIndex: number) {
  if (attacker.source === 'character') {
    const ch = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(attacker.source_id) as Record<string, unknown> | undefined
    if (!ch) throw new Error('Character not found')
    const sheet = jparse<CharacterSheetData>(ch.sheet_json as string, emptySheet())
    const attack = sheet.attacks[attackIndex]
    if (!attack?.name) throw new Error('That attack is not on the sheet')
    return attack
  }
  const src = db.prepare('SELECT * FROM bestiary_monsters WHERE id = ?').get(attacker.source_id) as Record<string, unknown> | undefined
  if (!src) throw new Error('Monster not found')
  const attacks = attacksFromMonster({ actions: jparse(src.actions as string, []) })
  const attack = attacks[attackIndex]
  if (!attack?.name) throw new Error('That attack is not on the stat block')
  return attack
}

export function applyFinishRewards(campaignId: string, instanceId: unknown, outcome: 'won' | 'lost') {
  const camp = db.prepare('SELECT hub_json FROM campaigns WHERE id = ?').get(campaignId) as { hub_json?: string } | undefined
  if (!camp) return
  let brief = emptyBrief()
  let encounterName = 'Encounter'
  let templateId: string | null = null
  if (instanceId) {
    const inst = db.prepare('SELECT * FROM encounter_instances WHERE id = ?').get(instanceId) as Record<string, unknown> | undefined
    if (inst) {
      encounterName = String(inst.name ?? 'Encounter')
      templateId = inst.encounter_template_id ? String(inst.encounter_template_id) : null
      if (templateId) {
        const t = db.prepare('SELECT * FROM encounter_templates WHERE id = ?').get(templateId) as Record<string, unknown> | undefined
        if (t) brief = unpackTemplateJson(t).brief
      }
    }
  }
  const next = applyEncounterRewards({
    hub: parseHub(jparse(camp.hub_json as string, {})),
    outcome,
    encounterName,
    templateId,
    brief,
  })
  db.prepare('UPDATE campaigns SET hub_json = ? WHERE id = ?').run(JSON.stringify(next.hub), campaignId)
  if (next.xp <= 0) return
  const chars = db.prepare('SELECT id, sheet_json FROM player_characters WHERE campaign_id = ?').all(campaignId) as {
    id: string
    sheet_json: string
  }[]
  for (const ch of chars) {
    const sheet = jparse(ch.sheet_json, {} as Record<string, unknown>)
    sheet.xp = Number(sheet.xp ?? 0) + next.xp
    db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(sheet), ch.id)
  }
}

export function resolvePlayerAttack(opts: {
  campaignId: string
  characterId: string
  instanceId: string
  targetId: string
  attackIndex: number
  d20: number
  d20b?: number
  rollMode?: string
  damage: number
}): PlayerAttackResult {
  const attacker = db
    .prepare(`SELECT * FROM combatants WHERE encounter_instance_id = ? AND source = 'character' AND source_id = ?`)
    .get(opts.instanceId, opts.characterId) as Record<string, unknown> | undefined
  if (!attacker) throw new Error('You are not on the map yet. Ask the DM to place you.')
  return resolveCombatAttack({ ...opts, attackerId: String(attacker.id) })
}

function seedDemo() {
  const existing = db.prepare('SELECT id FROM dm_accounts WHERE name = ?').get('Hearthkeeper') as { id: string } | undefined
  if (existing) return
  const dmId = ids.id()
  db.prepare('INSERT INTO dm_accounts (id, name, passcode_hash, created_at) VALUES (?,?,?,?)').run(
    dmId,
    'Hearthkeeper',
    bcrypt.hashSync('torch', 10),
    now(),
  )
  seedBestiaryForDm(dmId)
  const campaignId = ids.id()
  db.prepare('INSERT INTO campaigns (id, dm_account_id, name) VALUES (?,?,?)').run(campaignId, dmId, 'Phandalin Nights')
  const mapId = ids.id()
  db.prepare(
    'INSERT INTO maps (id, campaign_id, name, image_url, grid_size, grid_cols, grid_rows, grid_type, blocked_cells) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(mapId, campaignId, 'Cragmaw Hideout', '/maps/cragmaw-hideout.svg', 70, 20, 15, 'square', '[]')

  const elaraSheet = emptySheet()
  elaraSheet.className = 'Wizard 3'
  elaraSheet.level = 3
  elaraSheet.race = 'High Elf'
  elaraSheet.background = 'Sage'
  elaraSheet.alignment = 'Chaotic Good'
  elaraSheet.abilities = { str: 8, dex: 16, con: 14, int: 16, wis: 12, cha: 10 }
  elaraSheet.ac = 13
  elaraSheet.hpMax = 20
  elaraSheet.hpCurrent = 20
  elaraSheet.hitDice = '3d6'
  elaraSheet.speed = '30 ft.'
  elaraSheet.savingThrowProf = { str: false, dex: false, con: false, int: true, wis: true, cha: false }
  elaraSheet.skillProf = { arcana: true, history: true, investigation: true, perception: true }
  elaraSheet.spellcastingAbility = 'int'
  elaraSheet.spellSlots = [4, 2, 0, 0, 0, 0, 0, 0, 0]
  elaraSheet.spells = [
    { name: 'Fire Bolt', level: 0, prepared: true },
    { name: 'Mage Armor', level: 1, prepared: true },
    { name: 'Magic Missile', level: 1, prepared: true },
    { name: 'Misty Step', level: 2, prepared: true },
  ]
  elaraSheet.attacks = [{ name: 'Fire Bolt', bonus: '+5', damage: '1d10 fire', range: '120 ft.' }]
  elaraSheet.personality = 'I speak in riddles when I am nervous, which is often.'
  elaraSheet.ideals = 'Knowledge should be shared over a full mug, not hoarded.'
  elaraSheet.bonds = 'Brok pulled me out of a collapsing watchtower. I owe him.'
  elaraSheet.flaws = 'I cannot walk past an unmarked book.'
  elaraSheet.features = 'Fey Ancestry. Darkvision 60 ft. Ritual Casting.'
  elaraSheet.equipment = 'Spellbook, quarterstaff, component pouch, 12 gp'

  const brokSheet = emptySheet()
  brokSheet.className = 'Fighter 3'
  brokSheet.level = 3
  brokSheet.race = 'Mountain Dwarf'
  brokSheet.background = 'Soldier'
  brokSheet.alignment = 'Lawful Good'
  brokSheet.abilities = { str: 16, dex: 12, con: 16, int: 8, wis: 13, cha: 10 }
  brokSheet.ac = 18
  brokSheet.hpMax = 32
  brokSheet.hpCurrent = 32
  brokSheet.hitDice = '3d10'
  brokSheet.speed = '25 ft.'
  brokSheet.savingThrowProf = { str: true, dex: false, con: true, int: false, wis: false, cha: false }
  brokSheet.skillProf = { athletics: true, intimidation: true, perception: true, survival: true }
  brokSheet.attacks = [{ name: 'Warhammer', bonus: '+5', damage: '1d8+3 bludgeoning', range: '5 ft.' }]
  brokSheet.personality = 'I measure a room by its exits, then by its ale.'
  brokSheet.ideals = 'Hold the line. The people behind you are why you fight.'
  brokSheet.bonds = 'Elara is the only wizard I trust with my back.'
  brokSheet.flaws = 'I take every insult as a challenge to wrestle.'
  brokSheet.features = 'Second Wind. Action Surge. Dwarven Resilience.'
  brokSheet.equipment = 'Chain mail, shield, warhammer, javelins (3), 18 gp'

  const elaraId = ids.id()
  const brokId = ids.id()
  db.prepare(
    `INSERT INTO player_characters (id, campaign_id, personal_code, owner_display_name, name, token_color, source_pdf_url, sheet_json)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(elaraId, campaignId, 'ELARA7K2', 'Mira', 'Elara Voss', TOKEN_PALETTE[4], null, JSON.stringify(elaraSheet))
  db.prepare(
    `INSERT INTO player_characters (id, campaign_id, personal_code, owner_display_name, name, token_color, source_pdf_url, sheet_json)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(brokId, campaignId, 'BROK4M9X', 'Joss', 'Brok Ironvein', TOKEN_PALETTE[2], null, JSON.stringify(brokSheet))

  const goblin = db.prepare(`SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = 'Goblin'`).get(dmId) as { id: string } | undefined
  const bugbear = db.prepare(`SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = 'Bugbear'`).get(dmId) as { id: string } | undefined
  const wolf = db.prepare(`SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = 'Wolf'`).get(dmId) as { id: string } | undefined
  const templateId = ids.id()
  db.prepare('INSERT INTO encounter_templates (id, campaign_id, map_id, name, monsters_json, characters_json) VALUES (?,?,?,?,?,?)').run(
    templateId,
    campaignId,
    mapId,
    'Cragmaw Ambush',
    JSON.stringify([
      { bestiaryMonsterId: goblin?.id, name: 'Goblin', quantity: 4, startX: 8, startY: 5, color: '#4ea36a' },
      { bestiaryMonsterId: bugbear?.id, name: 'Bugbear', quantity: 1, startX: 11, startY: 4, color: '#c4453c' },
      { bestiaryMonsterId: wolf?.id, name: 'Wolf', quantity: 2, startX: 6, startY: 7, color: '#8a6a4a' },
    ]),
    JSON.stringify([
      { characterId: elaraId, name: 'Elara Voss', startX: 3, startY: 12, color: TOKEN_PALETTE[4] },
      { characterId: brokId, name: 'Brok Ironvein', startX: 4, startY: 12, color: TOKEN_PALETTE[2] },
    ]),
  )
  db.prepare('UPDATE campaigns SET hub_json = ? WHERE id = ?').run(
    JSON.stringify({
      recap: 'Gundren hired the party to escort supplies to Phandalin.',
      sessionTitle: 'Night of the Cragmaw',
      sessionNotes: 'Ambush on the Triboar Trail, then rumors in town.',
      beats: [
        { id: 'b1', kind: 'combat', title: 'Cragmaw Ambush', notes: 'Goblins on the trail.', templateId, status: 'active' },
        { id: 'b2', kind: 'social', title: 'Stonehill Inn', notes: 'Ask about Gundren.', templateId: '', status: 'upcoming' },
      ],
      quests: [{ id: 'q1', name: 'Find Gundren', status: 'open', notes: 'Taken east by the Cragmaw.', npcIds: ['n1'] }],
      npcs: [
        { id: 'n1', name: 'Gundren Rockseeker', role: 'Patron', notes: 'Dwarf who hired the party.' },
        { id: 'n2', name: 'Sildar Hallwinter', role: 'Ally', notes: 'Lords’ Alliance agent, missing with Gundren.' },
      ],
      loot: [],
    }),
    campaignId,
  )

  const instanceId = spawnFromTemplate(campaignId, templateId, 'Cragmaw Ambush')

  const combatants = db.prepare('SELECT id, name FROM combatants WHERE encounter_instance_id = ?').all(instanceId) as { id: string; name: string }[]
  const inits: Record<string, number> = {}
  for (const c of combatants) {
    const roll = c.name.startsWith('Elara') ? 16 : c.name.startsWith('Brok') ? 12 : c.name.startsWith('Bugbear') ? 14 : c.name.startsWith('Wolf') ? 13 : 10
    inits[c.id] = roll
  }
  const ordered = [...combatants].sort((a, b) => inits[b.id] - inits[a.id])
  ordered.forEach((c, i) => {
    db.prepare('UPDATE combatants SET initiative = ?, turn_order_position = ? WHERE id = ?').run(inits[c.id], i, c.id)
  })
  db.prepare(`UPDATE encounter_instances SET status = 'paused', round_number = 2, current_turn_position = 1 WHERE id = ?`).run(instanceId)
  const bug = combatants.find((c) => c.name === 'Bugbear')
  if (bug) db.prepare('UPDATE combatants SET hp_current = 18, conditions_json = ? WHERE id = ?').run(JSON.stringify(['Poisoned']), bug.id)

  db.prepare(
    `INSERT INTO live_sessions (id, join_code, campaign_id, encounter_instance_id, created_at, table_phase, ambiance_caption, last_outcome)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    ids.id(),
    'HEARTH',
    campaignId,
    null,
    now(),
    'table',
    'The Hearthkeeper tavern. Wet cloaks by the fire — the road to Cragmaw can wait.',
    null,
  )
}

seedDemo()
