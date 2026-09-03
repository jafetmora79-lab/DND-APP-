import { customAlphabet } from 'nanoid'
import { publicAsset, tableEmail } from './config'
import { emptySheet, type AuthUser, type BattleMap, type Combatant, type EncounterInstance, type FogState, type MapToken, type Monster, type NamedEntry, type PlayerCharacter } from './types'
import { parseCharacterPdf } from './parse-pdf'
import { safeStorageFileName, storageObjectPath } from './storage-key'
import { mapSrdMonster, type SrdMonster } from './srd-map'
import { supabase } from './supabase'
import { parseBlockedCells, tokenSizeSquares, walkablePixel, clampGridDim, clampGridSize, DEFAULT_SCRATCH_CELL, tokenOccupiesBlocked, pixelToCell, remapBlocked, playerStartOrigin, spreadCells, tokenCellKeys, cellCenter, abilityMod } from './utils'
import { afterHpChange, clampMovementRemaining, combatantStatsFromMonster, combatantStatsFromSheet, emptyTurnEconomy, formatDiceUsed, movementCostFeet, parseCombatantStats, parseDeathState, parseSpeedFeet, parseTurnEconomy, resolveDeathSave, snapshotForPlayer, specCopyCell, spendMovement, statsForLiveCombatant, tokenCell } from './combat'
import { lightingFromStart, makeStartFog, coverBonusAlongLine } from './vision'
import { hidingBrokenByWatchers, isHiding, resolveHideAttempt, sheetForHide, withHiding, withoutHiding } from './stealth'
import { attackActivityLines, parseActivity, parsePrompt } from './combat-activity'
import { sessionFromRow } from './session'
import { ambianceFromBeat, applyEncounterRewards, parseHub, sceneAfterEncounter, tableSceneBeat } from './campaign-hub'
import { packTemplateBody, templateFromRow, unpackTemplateJson } from './template-json'
import type { TableApi } from './local-api'
import {
  SURPRISED,
  combatantLikeFromRow,
  firstActingPosition,
  nextActingPosition,
  sortByInitiative,
  withoutSurprised,
} from './turn-flow'

const joinCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)
const personalCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8)

function db() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

function encounterFromRow(i: Record<string, unknown>): EncounterInstance {
  return {
    id: String(i.id),
    campaignId: String(i.campaign_id ?? ''),
    encounterTemplateId: i.encounter_template_id ? String(i.encounter_template_id) : null,
    name: String(i.name),
    status: i.status as EncounterInstance['status'],
    roundNumber: Number(i.round_number),
    currentTurnPosition: Number(i.current_turn_position),
    fogState: i.fog_state as FogState,
    mapId: i.map_id ? String(i.map_id) : null,
    activity: parseActivity(i.activity_json),
    prompt: parsePrompt(i.prompt_json),
  }
}

function missingRpc(message: string, name: string) {
  return /could not find|does not exist|schema cache/i.test(message) && message.includes(name)
}

async function logFeed(instanceId: string, text: string) {
  const { error } = await db().rpc('append_combat_activity', { p_instance: instanceId, p_text: text })
  if (error && !missingRpc(error.message, 'append_combat_activity')) throwIf(error)
}

function throwIf(error: { message: string } | null) {
  if (!error) return
  if (/schema cache/i.test(error.message)) {
    const col = error.message.match(/'([^']+)' column/i)?.[1]
    if (col) omittedSessionCols.add(col)
    throw new Error(
      `Could not find ${col ? `'${col}'` : 'a column'} on live_sessions. In the Supabase SQL Editor run migrate-campaign-table.sql, then: notify pgrst, 'reload schema';`,
    )
  }
  throw new Error(error.message)
}

const omittedSessionCols = new Set<string>()
const omittedTemplateCols = new Set<string>()
let embedPlayersInMonsters = false

function stripSessionCols(row: Record<string, unknown>) {
  const next = { ...row }
  for (const col of omittedSessionCols) delete next[col]
  return next
}

function schemaColumn(message: string) {
  return message.match(/'([^']+)' column/i)?.[1] ?? null
}

async function insertLiveSession(row: Record<string, unknown>) {
  let payload = stripSessionCols(row)
  for (let i = 0; i < 6; i++) {
    const { data, error } = await db().from('live_sessions').insert(payload).select().single()
    if (!error) return data
    if (!/schema cache/i.test(error.message)) throwIf(error)
    const col = schemaColumn(error.message)
    if (col) omittedSessionCols.add(col)
    if (col && col in payload) {
      delete payload[col]
      continue
    }
    throwIf(error)
  }
  throw new Error('Could not open the live session')
}

async function updateLiveSession(id: string, patch: Record<string, unknown>) {
  let payload = stripSessionCols(patch)
  for (let i = 0; i < 6; i++) {
    if (Object.keys(payload).length === 0) return { id }
    const { data, error } = await db().from('live_sessions').update(payload).eq('id', id).select().single()
    if (!error) return data
    if (!/schema cache/i.test(error.message)) throwIf(error)
    const col = schemaColumn(error.message)
    if (col) omittedSessionCols.add(col)
    if (col && col in payload) {
      delete payload[col]
      continue
    }
    throwIf(error)
  }
  throw new Error('Could not update the live session')
}

function monsterFromRow(row: Record<string, unknown>): Monster {
  return {
    id: String(row.id),
    dmAccountId: String(row.dm_account_id),
    name: String(row.name),
    size: String(row.size ?? ''),
    creatureType: String(row.creature_type ?? ''),
    alignment: String(row.alignment ?? ''),
    acValue: Number(row.ac_value ?? 10),
    acNote: String(row.ac_note ?? ''),
    hpMax: Number(row.hp_max ?? 10),
    hitDiceFormula: String(row.hit_dice_formula ?? ''),
    speed: String(row.speed ?? ''),
    str: Number(row.str ?? 10),
    dex: Number(row.dex ?? 10),
    con: Number(row.con ?? 10),
    int: Number(row.int_score ?? 10),
    wis: Number(row.wis ?? 10),
    cha: Number(row.cha ?? 10),
    savingThrows: String(row.saving_throws ?? ''),
    skills: String(row.skills ?? ''),
    damageVulnerabilities: String(row.damage_vulnerabilities ?? ''),
    damageResistances: String(row.damage_resistances ?? ''),
    damageImmunities: String(row.damage_immunities ?? ''),
    conditionImmunities: String(row.condition_immunities ?? ''),
    senses: String(row.senses ?? ''),
    languages: String(row.languages ?? ''),
    challengeRating: Number(row.challenge_rating ?? 0),
    xp: Number(row.xp ?? 0),
    proficiencyBonus: Number(row.proficiency_bonus ?? 2),
    traits: (row.traits as NamedEntry[]) ?? [],
    actions: (row.actions as NamedEntry[]) ?? [],
    legendaryActions: (row.legendary_actions as NamedEntry[]) ?? [],
    reactions: (row.reactions as NamedEntry[]) ?? [],
    bonusActions: (row.bonus_actions as NamedEntry[]) ?? [],
    lairActions: (row.lair_actions as NamedEntry[]) ?? [],
    source: row.source === 'custom' ? 'custom' : 'srd',
  }
}

function monsterInsert(dmId: string, m: Partial<Monster> & ReturnType<typeof mapSrdMonster>) {
  return {
    dm_account_id: dmId,
    name: m.name,
    size: m.size,
    creature_type: m.creatureType,
    alignment: m.alignment,
    ac_value: m.acValue,
    ac_note: m.acNote,
    hp_max: m.hpMax,
    hit_dice_formula: m.hitDiceFormula,
    speed: m.speed,
    str: m.str,
    dex: m.dex,
    con: m.con,
    int_score: m.int,
    wis: m.wis,
    cha: m.cha,
    saving_throws: m.savingThrows,
    skills: m.skills,
    damage_vulnerabilities: m.damageVulnerabilities,
    damage_resistances: m.damageResistances,
    damage_immunities: m.damageImmunities,
    condition_immunities: m.conditionImmunities,
    senses: m.senses,
    languages: m.languages,
    challenge_rating: m.challengeRating,
    xp: m.xp,
    proficiency_bonus: m.proficiencyBonus,
    traits: m.traits ?? [],
    actions: m.actions ?? [],
    legendary_actions: m.legendaryActions ?? [],
    reactions: m.reactions ?? [],
    bonus_actions: m.bonusActions ?? [],
    lair_actions: m.lairActions ?? [],
    source: m.source ?? 'custom',
  }
}

function characterFromRow(row: Record<string, unknown>): PlayerCharacter {
  return {
    id: String(row.id),
    campaignId: String(row.campaign_id),
    personalCode: String(row.personal_code),
    ownerDisplayName: String(row.owner_display_name ?? ''),
    name: String(row.name ?? ''),
    tokenColor: String(row.token_color ?? '#6ea8c9'),
    sourcePdfUrl: (row.source_pdf_url as string) || null,
    sheet: { ...emptySheet(), ...((row.sheet_json as object) || {}) },
  }
}

async function applyHostedFinishRewards(campaignId: string, instanceId: string, outcome: 'won' | 'lost', lootHolder?: string) {
  const { data: camp } = await db().from('campaigns').select('*').eq('id', campaignId).maybeSingle()
  if (!camp) return
  const { data: inst } = await db().from('encounter_instances').select('*').eq('id', instanceId).maybeSingle()
  const encounterName = String(inst?.name ?? 'Encounter')
  const templateId = inst?.encounter_template_id ? String(inst.encounter_template_id) : null
  let brief = unpackTemplateJson({}).brief
  if (templateId) {
    const { data: t } = await db().from('encounter_templates').select('*').eq('id', templateId).maybeSingle()
    if (t) brief = unpackTemplateJson(t as { monsters_json?: unknown; characters_json?: unknown }).brief
  }
  const next = applyEncounterRewards({
    hub: parseHub((camp as { hub_json?: unknown }).hub_json),
    outcome,
    encounterName,
    templateId,
    brief,
    lootHolder,
  })
  const { error: hubErr } = await db().from('campaigns').update({ hub_json: next.hub }).eq('id', campaignId)
  if (hubErr && /hub_json/.test(hubErr.message)) return
  throwIf(hubErr)
  await applyHostedHubStage(campaignId, templateId)
  if (next.xp <= 0) return
  const { data: fighters } = await db()
    .from('combatants')
    .select('source_id')
    .eq('encounter_instance_id', instanceId)
    .eq('source', 'character')
  const ids = [...new Set((fighters ?? []).map((r) => String(r.source_id ?? '')).filter(Boolean))]
  if (ids.length === 0) return
  const { data: chars } = await db().from('player_characters').select('id, sheet_json').eq('campaign_id', campaignId).in('id', ids)
  for (const ch of chars ?? []) {
    const sheet = { ...emptySheet(), ...((ch.sheet_json as object) || {}) }
    sheet.xp = Number(sheet.xp ?? 0) + next.xp
    await db().from('player_characters').update({ sheet_json: sheet }).eq('id', ch.id)
  }
}

async function applyHostedHubStage(campaignId: string, afterTemplateId: string | null | undefined) {
  const { data: camp } = await db().from('campaigns').select('hub_json').eq('id', campaignId).maybeSingle()
  if (!camp) return
  const hub = parseHub((camp as { hub_json?: unknown }).hub_json)
  const beat = afterTemplateId ? sceneAfterEncounter(hub, afterTemplateId) : tableSceneBeat(hub)
  const ambiance = ambianceFromBeat(beat)
  if (!ambiance) return
  const { data: existing } = await db()
    .from('live_sessions')
    .select('id')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!existing) return
  await updateLiveSession(String(existing.id), {
    ambiance_image_url: ambiance.imageUrl,
    ambiance_caption: ambiance.caption,
  })
}

function mapFromRow(row: Record<string, unknown>): BattleMap {
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

function tokenFromSupabase(t: Record<string, unknown>): MapToken {
  return {
    id: String(t.id),
    encounterInstanceId: String(t.encounter_instance_id),
    x: Number(t.x),
    y: Number(t.y),
    refType: (t.ref_type as MapToken['refType']) ?? 'combatant',
    refId: String(t.ref_id),
    label: String(t.label ?? ''),
    color: String(t.color ?? ''),
    sizeSquares: Number(t.size_squares ?? 1),
    visibleToPlayers: Boolean(t.visible_to_players),
  }
}

function combatantFromSupabase(c: Record<string, unknown>, monster?: Parameters<typeof statsForLiveCombatant>[1]): Combatant {
  return {
    id: String(c.id),
    encounterInstanceId: String(c.encounter_instance_id),
    name: String(c.name),
    source: c.source === 'character' ? 'character' : 'bestiary',
    sourceId: String(c.source_id ?? ''),
    initiative: Number(c.initiative),
    hpCurrent: Number(c.hp_current),
    hpMax: Number(c.hp_max),
    hpTemp: Number(c.hp_temp),
    ac: Number(c.ac),
    conditions: Array.isArray(c.conditions_json) ? (c.conditions_json as string[]) : [],
    turnOrderPosition: Number(c.turn_order_position),
    color: String(c.color ?? '#c4453c'),
    notes: String(c.notes ?? ''),
    constitution: Number((c as { constitution?: number }).constitution ?? 10),
    stats: statsForLiveCombatant(c as { stats_json?: unknown; source?: unknown }, monster),
    advantageAgainst: Array.isArray((c as { advantage_against_json?: string[] }).advantage_against_json)
      ? ((c as { advantage_against_json: string[] }).advantage_against_json)
      : [],
    deathState: parseDeathState((c as { death_state?: string }).death_state),
    deathSuccess: Number((c as { death_success?: number }).death_success ?? 0),
    deathFail: Number((c as { death_fail?: number }).death_fail ?? 0),
    turnEconomy: parseTurnEconomy((c as { turn_economy_json?: unknown }).turn_economy_json),
    speedFeet: parseSpeedFeet((c as { speed_feet?: unknown }).speed_feet ?? 30),
    movementRemaining: Number.isFinite(Number((c as { movement_remaining?: unknown }).movement_remaining))
      ? Math.max(0, Number((c as { movement_remaining?: unknown }).movement_remaining))
      : parseSpeedFeet((c as { speed_feet?: unknown }).speed_feet ?? 30),
    attacksUsed: Math.max(0, Number((c as { attacks_used?: unknown }).attacks_used) || 0),
  }
}

async function loadFightPieces(instanceId: string) {
  const { data: inst, error } = await db().from('encounter_instances').select('*').eq('id', instanceId).single()
  throwIf(error)
  const mapRes = inst.map_id ? await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle() : { data: null }
  const map = mapRes.data ? mapFromRow(mapRes.data as Record<string, unknown>) : null
  const { data: combatRows } = await db().from('combatants').select('*').eq('encounter_instance_id', instanceId)
  const { data: tokenRows } = await db().from('tokens_on_map').select('*').eq('encounter_instance_id', instanceId)
  const { data: charRows } = await db().from('player_characters').select('*').eq('campaign_id', inst.campaign_id)
  const monsterIds = [...new Set((combatRows ?? []).filter((c) => c.source === 'bestiary').map((c) => String(c.source_id)).filter(Boolean))]
  const bestiaryRes =
    monsterIds.length > 0 ? await db().from('bestiary_monsters').select('*').in('id', monsterIds) : { data: [] as Record<string, unknown>[] }
  const monsters = (bestiaryRes.data ?? []).map((row) => monsterFromRow(row as Record<string, unknown>))
  const monsterById = new Map(monsters.map((m) => [m.id, m]))
  const combatants = (combatRows ?? []).map((c) =>
    combatantFromSupabase(c as Record<string, unknown>, c.source === 'bestiary' ? monsterById.get(String(c.source_id)) : null),
  )
  const tokens = (tokenRows ?? []).map((t) => tokenFromSupabase(t as Record<string, unknown>))
  const characters = (charRows ?? []).map((r) => characterFromRow(r as Record<string, unknown>))
  return { inst, map, combatants, tokens, characters, monsters }
}

async function coverForAttack(instanceId: string, attackerId: string | undefined, targetId: string) {
  if (!attackerId) return 0
  const { data: inst } = await db().from('encounter_instances').select('map_id').eq('id', instanceId).maybeSingle()
  if (!inst?.map_id) return 0
  const { data: mapRow } = await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle()
  if (!mapRow) return 0
  const battle = mapFromRow(mapRow as Record<string, unknown>)
  const { data: tokens } = await db().from('tokens_on_map').select('x, y, ref_id').eq('encounter_instance_id', instanceId)
  const from = tokens?.find((t) => String(t.ref_id) === attackerId)
  const to = tokens?.find((t) => String(t.ref_id) === targetId)
  if (!from || !to) return 0
  return coverBonusAlongLine(
    battle.blocked,
    battle.gridCols,
    battle.gridRows,
    tokenCell({ x: Number(from.x), y: Number(from.y) }, battle.gridSize),
    tokenCell({ x: Number(to.x), y: Number(to.y) }, battle.gridSize),
  )
}

async function persistHide(combatantId: string, success: boolean) {
  const { data: row } = await db().from('combatants').select('conditions_json').eq('id', combatantId).maybeSingle()
  const conditions = Array.isArray(row?.conditions_json) ? (row!.conditions_json as string[]) : []
  const { error } = await db()
    .from('combatants')
    .update({ conditions_json: success ? withHiding(conditions) : withoutHiding(conditions) })
    .eq('id', combatantId)
  throwIf(error)
}

async function revealHidingAfterMove(instanceId: string, combatantId: string, map: BattleMap | undefined, nextPos: { x: number; y: number }) {
  if (!map) return
  const pieces = await loadFightPieces(instanceId)
  const hider = pieces.combatants.find((c) => c.id === combatantId)
  if (!hider || !isHiding(hider)) return
  const tokens = pieces.tokens.map((t) => (t.refId === combatantId ? { ...t, x: nextPos.x, y: nextPos.y } : t))
  if (!hidingBrokenByWatchers(hider, pieces.combatants, tokens, map)) return
  await persistHide(combatantId, false)
  await logFeed(instanceId, `${hider.name} is no longer hidden.`)
}

async function stripHidingOnAttack(instanceId: string, attackerId?: string, targetId?: string) {
  const ids = [attackerId, targetId].filter(Boolean) as string[]
  if (ids.length === 0) return
  const { data: rows } = await db().from('combatants').select('id, name, conditions_json').in('id', ids)
  for (const row of rows ?? []) {
    const conditions = Array.isArray(row.conditions_json) ? (row.conditions_json as string[]) : []
    if (!isHiding({ conditions })) continue
    await persistHide(String(row.id), false)
    await logFeed(instanceId, `${row.name} is no longer hidden.`)
  }
}

async function insertCombatantRow(row: Record<string, unknown>) {
  let payload = { ...row }
  for (let i = 0; i < 8; i++) {
    const { data, error } = await db().from('combatants').insert(payload).select().single()
    if (!error) return data
    const col = schemaColumn(error.message)
    if (col && col in payload) {
      delete payload[col]
      continue
    }
    if (/constitution/.test(error.message) && 'constitution' in payload) {
      delete payload.constitution
      continue
    }
    if (/stats_json/.test(error.message) && 'stats_json' in payload) {
      delete payload.stats_json
      continue
    }
    throwIf(error)
  }
  throw new Error('Could not insert combatant')
}

async function insertCharacterToken(
  instanceId: string,
  combatantId: string,
  label: string,
  color: string,
  battle: ReturnType<typeof mapFromRow> | null,
  startX?: number,
  startY?: number,
) {
  const cell = battle?.gridSize ?? 70
  const cols = battle?.gridCols ?? 20
  const rows = battle?.gridRows ?? 15
  const { data: tokens } = await db().from('tokens_on_map').select('x, y, size_squares').eq('encounter_instance_id', instanceId)
  const occupied = tokenCellKeys(
    (tokens ?? []).map((t) => ({ x: Number(t.x), y: Number(t.y), sizeSquares: Number(t.size_squares ?? 1) })),
    cell,
  )
  const origin =
    Number.isFinite(startX) && Number.isFinite(startY)
      ? { col: Number(startX), row: Number(startY) }
      : playerStartOrigin(cols, rows)
  const found = spreadCells(origin, 1, cols, rows, battle?.blocked, occupied)[0]
  const pos = battle ? cellCenter(found.col, found.row, cell) : { x: cell * found.col + cell / 2, y: cell * found.row + cell / 2 }
  const { error: tokErr } = await db().from('tokens_on_map').insert({
    encounter_instance_id: instanceId,
    x: pos.x,
    y: pos.y,
    ref_type: 'combatant',
    ref_id: combatantId,
    label,
    color,
    size_squares: 1,
    visible_to_players: true,
  })
  throwIf(tokErr)
}

async function insertCharacterCombatant(instanceId: string, characterId: string, startX?: number, startY?: number, turnOrder?: number) {
  const { data: existing } = await db()
    .from('combatants')
    .select('id')
    .eq('encounter_instance_id', instanceId)
    .eq('source', 'character')
    .eq('source_id', characterId)
    .maybeSingle()
  const { data: inst, error: iErr } = await db().from('encounter_instances').select('*').eq('id', instanceId).single()
  throwIf(iErr)
  const { data: map } = inst.map_id ? await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle() : { data: null }
  const battle = map ? mapFromRow(map as Record<string, unknown>) : null
  const { data: ch, error } = await db().from('player_characters').select('*').eq('id', characterId).single()
  throwIf(error)
  const mapped = characterFromRow(ch as Record<string, unknown>)
  if (existing) {
    const { data: tok } = await db()
      .from('tokens_on_map')
      .select('id')
      .eq('encounter_instance_id', instanceId)
      .eq('ref_id', existing.id)
      .maybeSingle()
    if (!tok) await insertCharacterToken(instanceId, String(existing.id), mapped.name, mapped.tokenColor, battle, startX, startY)
    return
  }
  let nextPos = turnOrder
  if (nextPos == null) {
    const { data: maxRow } = await db()
      .from('combatants')
      .select('turn_order_position')
      .eq('encounter_instance_id', instanceId)
      .order('turn_order_position', { ascending: false })
      .limit(1)
      .maybeSingle()
    nextPos = Number(maxRow?.turn_order_position ?? -1) + 1
  }
  const comb = await insertCombatantRow({
    encounter_instance_id: instanceId,
    name: mapped.name,
    source: 'character',
    source_id: mapped.id,
    initiative: 0,
    hp_current: mapped.sheet.hpCurrent,
    hp_max: mapped.sheet.hpMax,
    hp_temp: mapped.sheet.hpTemp,
    ac: mapped.sheet.ac,
    conditions_json: [],
    turn_order_position: nextPos,
    color: mapped.tokenColor,
    notes: '',
    constitution: mapped.sheet.abilities.con,
    stats_json: combatantStatsFromSheet(mapped.sheet.abilities),
    speed_feet: parseSpeedFeet(mapped.sheet.speed),
    movement_remaining: parseSpeedFeet(mapped.sheet.speed),
  })
  await insertCharacterToken(instanceId, String(comb.id), mapped.name, mapped.tokenColor, battle, startX, startY)
}

async function currentUserId() {
  const { data, error } = await db().auth.getUser()
  throwIf(error)
  if (!data.user) throw new Error('Sign-in required')
  return data.user
}

async function seedBestiary(dmId: string) {
  const { count } = await db().from('bestiary_monsters').select('id', { count: 'exact', head: true }).eq('dm_account_id', dmId)
  if ((count ?? 0) > 0) return
  const mod = await import('../../data/srd-monsters.json')
  const raw = (mod.default ?? mod) as unknown as SrdMonster[]
  const rows = raw.map((m) => monsterInsert(dmId, mapSrdMonster(m)))
  for (let i = 0; i < rows.length; i += 80) {
    const { error } = await db().from('bestiary_monsters').insert(rows.slice(i, i + 80))
    throwIf(error)
  }
}

async function uploadCharacterPdf(campaignId: string, characterId: string, file: File) {
  const safeName = safeStorageFileName(file.name.endsWith('.pdf') ? file.name : `${file.name}.pdf`)
  const relative = `${campaignId}/${characterId}/${safeName}`
  const attempts = [
    { bucket: 'pdfs', path: relative },
    { bucket: 'maps', path: `character-pdfs/${relative}` },
  ] as const
  let last = 'Storage upload failed'
  for (const attempt of attempts) {
    const { error } = await db().storage.from(attempt.bucket).upload(attempt.path, file, {
      upsert: true,
      contentType: 'application/pdf',
    })
    if (!error) {
      return db().storage.from(attempt.bucket).getPublicUrl(attempt.path).data.publicUrl
    }
    last = error.message
    if (!/not found|does not exist/i.test(error.message)) throw new Error(error.message)
  }
  throw new Error(
    `${last}. Create a public Storage bucket named "pdfs" (or keep using "maps") so character PDFs can be stored.`,
  )
}

async function hideCodes(campaignId: string, list: PlayerCharacter[]) {
  const user = await currentUserId()
  const { data: dm } = await db().from('dm_accounts').select('id').eq('id', user.id).maybeSingle()
  if (dm) return list
  const { data: access } = await db()
    .from('character_access')
    .select('character_id')
    .eq('user_id', user.id)
    .eq('campaign_id', campaignId)
    .maybeSingle()
  const mine = access?.character_id
  return list.map((c) => (c.id === mine ? c : { ...c, personalCode: '••••••••' }))
}

export const supabaseApi: TableApi = {
  async register(name, passcode) {
    const email = tableEmail(name)
    const { data, error } = await db().auth.signUp({
      email,
      password: passcode,
      options: { data: { role: 'dm', table_name: name } },
    })
    throwIf(error)
    if (!data.session || !data.user) {
      throw new Error('No session after sign-up. In Supabase: Authentication → Providers → Email → turn off Confirm email.')
    }
    const { error: dmErr } = await db().from('dm_accounts').insert({ id: data.user.id, name: name.trim() })
    throwIf(dmErr)
    await seedBestiary(data.user.id)
    return { token: data.session.access_token, user: { role: 'dm', id: data.user.id, name: name.trim() } }
  },

  async login(name, passcode) {
    const { data, error } = await db().auth.signInWithPassword({ email: tableEmail(name), password: passcode })
    throwIf(error)
    if (!data.session || !data.user) throw new Error('Unknown table or wrong passcode')
    const { data: dm, error: dmErr } = await db().from('dm_accounts').select('*').eq('id', data.user.id).single()
    throwIf(dmErr)
    await seedBestiary(data.user.id)
    return { token: data.session.access_token, user: { role: 'dm', id: data.user.id, name: String(dm.name) } }
  },

  async me() {
    const user = await currentUserId()
    const { data: accessRows } = await db().from('character_access').select('*').eq('user_id', user.id)
    const access = accessRows?.[0]
    if (access) {
      const { data: ch, error } = await db().from('player_characters').select('*').eq('id', access.character_id).single()
      throwIf(error)
      const mapped = characterFromRow(ch as Record<string, unknown>)
      return {
        user: {
          role: 'player',
          id: mapped.id,
          characterId: mapped.id,
          campaignId: mapped.campaignId,
          name: mapped.name,
        } satisfies AuthUser,
        character: mapped,
      }
    }
    const { data: dm, error } = await db().from('dm_accounts').select('*').eq('id', user.id).single()
    throwIf(error)
    return { user: { role: 'dm', id: user.id, name: String(dm.name) } satisfies AuthUser }
  },

  async campaigns() {
    const { data, error } = await db().from('campaigns').select('*')
    throwIf(error)
    return {
      campaigns: (data ?? []).map((c) => ({
        id: String(c.id),
        dmAccountId: String(c.dm_account_id),
        name: String(c.name),
        hub: parseHub((c as { hub_json?: unknown }).hub_json),
      })),
    }
  },

  async createCampaign(name) {
    const user = await currentUserId()
    const { data, error } = await db().from('campaigns').insert({ dm_account_id: user.id, name }).select().single()
    throwIf(error)
    const { error: mapErr } = await db().from('maps').insert({
      campaign_id: data.id,
      name: 'Cragmaw Hideout',
      image_url: publicAsset('maps/cragmaw-hideout.svg'),
      grid_size: 70,
      grid_cols: 20,
      grid_rows: 15,
      grid_type: 'square',
    })
    throwIf(mapErr)
    return { campaign: { id: String(data.id), dmAccountId: user.id, name: String(data.name), hub: parseHub((data as { hub_json?: unknown }).hub_json) } }
  },

  async patchCampaign(id, body) {
    const patch: Record<string, unknown> = {}
    if (body.name != null) patch.name = body.name
    if (body.hub != null) patch.hub_json = parseHub(body.hub)
    const { data, error } = await db().from('campaigns').update(patch).eq('id', id).select().single()
    if (error && /hub_json/.test(error.message)) {
      throw new Error('Could not find hub_json on campaigns. In the Supabase SQL Editor run migrate-campaign-mvp.sql, then: notify pgrst, \'reload schema\';')
    }
    throwIf(error)
    return {
      ok: true as const,
      campaign: {
        id: String(data.id),
        dmAccountId: String(data.dm_account_id),
        name: String(data.name),
        hub: parseHub((data as { hub_json?: unknown }).hub_json),
      },
    }
  },

  async bestiary(q = '') {
    const { data, error } = await db().from('bestiary_monsters').select('*').order('name')
    throwIf(error)
    let monsters = (data ?? []).map((r) => monsterFromRow(r as Record<string, unknown>))
    const n = q.trim().toLowerCase()
    if (n) monsters = monsters.filter((m) => m.name.toLowerCase().includes(n) || m.creatureType.toLowerCase().includes(n))
    return { monsters }
  },

  async monster(id) {
    const { data, error } = await db().from('bestiary_monsters').select('*').eq('id', id).single()
    throwIf(error)
    return { monster: monsterFromRow(data as Record<string, unknown>) }
  },

  async saveMonster(m) {
    const user = await currentUserId()
    if (m.id) {
      const { error } = await db()
        .from('bestiary_monsters')
        .update(monsterInsert(user.id, { ...mapSrdPlaceholder(m), ...m } as ReturnType<typeof mapSrdMonster> & Partial<Monster>))
        .eq('id', m.id)
      throwIf(error)
      return {}
    }
    const { data, error } = await db()
      .from('bestiary_monsters')
      .insert(monsterInsert(user.id, { ...mapSrdPlaceholder(m), ...m } as ReturnType<typeof mapSrdMonster> & Partial<Monster>))
      .select()
      .single()
    throwIf(error)
    return { monster: monsterFromRow(data as Record<string, unknown>) }
  },

  async deleteMonster(id) {
    const { error } = await db().from('bestiary_monsters').delete().eq('id', id)
    throwIf(error)
    return {}
  },

  async maps(campaignId) {
    const { data, error } = await db().from('maps').select('*').eq('campaign_id', campaignId)
    throwIf(error)
    return { maps: (data ?? []).map((r) => mapFromRow(r as Record<string, unknown>)) }
  },

  async createMap(campaignId, body) {
    const gridCols = clampGridDim(body.gridCols, 20)
    const gridRows = clampGridDim(body.gridRows, 15)
    const gridSize = clampGridSize(body.gridSize, DEFAULT_SCRATCH_CELL)
    const { data, error } = await db()
      .from('maps')
      .insert({
        campaign_id: campaignId,
        name: body.name || 'Untitled map',
        image_url: body.imageUrl || '',
        grid_size: gridSize,
        grid_cols: gridCols,
        grid_rows: gridRows,
        grid_type: 'square',
      })
      .select()
      .single()
    throwIf(error)
    return { map: mapFromRow(data as Record<string, unknown>) }
  },

  async uploadMap(campaignId, form) {
    const file = form.get('image') as File | null
    const name = String(form.get('name') || file?.name || 'Untitled map')
    if (!file) throw new Error('Map image required')
    const path = storageObjectPath(campaignId, file.name)
    const { error: upErr } = await db().storage.from('maps').upload(path, file, { upsert: true })
    if (upErr) {
      throw new Error(
        upErr.message.includes('Bucket not found') || upErr.message.includes('not found')
          ? 'Create a public Storage bucket named "maps" in Supabase, then try the upload again.'
          : upErr.message,
      )
    }
    const { data: pub } = db().storage.from('maps').getPublicUrl(path)
    const gridCols = clampGridDim(form.get('gridCols'), 20)
    const gridRows = clampGridDim(form.get('gridRows'), 15)
    const { data, error } = await db()
      .from('maps')
      .insert({
        campaign_id: campaignId,
        name,
        image_url: pub.publicUrl,
        grid_size: clampGridSize(form.get('gridSize'), 70),
        grid_cols: gridCols,
        grid_rows: gridRows,
        grid_type: 'square',
      })
      .select()
      .single()
    throwIf(error)
    return { map: mapFromRow(data as Record<string, unknown>) }
  },

  async uploadMapImage(id, file) {
    const { data: row, error: loadErr } = await db().from('maps').select('*').eq('id', id).single()
    throwIf(loadErr)
    const campaignId = String(row.campaign_id)
    const path = storageObjectPath(campaignId, file.name)
    const { error: upErr } = await db().storage.from('maps').upload(path, file, { upsert: true })
    if (upErr) {
      throw new Error(
        upErr.message.includes('Bucket not found') || upErr.message.includes('not found')
          ? 'Create a public Storage bucket named "maps" in Supabase, then try the upload again.'
          : upErr.message,
      )
    }
    const { data: pub } = db().storage.from('maps').getPublicUrl(path)
    const { data, error } = await db().from('maps').update({ image_url: pub.publicUrl }).eq('id', id).select().single()
    throwIf(error)
    return { map: mapFromRow(data as Record<string, unknown>) }
  },

  async patchMap(id, body) {
    const { data: current, error: loadErr } = await db().from('maps').select('*').eq('id', id).single()
    throwIf(loadErr)
    const oldCols = Number(current.grid_cols)
    const oldRows = Number(current.grid_rows)
    const patch: Record<string, unknown> = {}
    if (body.name != null) patch.name = body.name
    if (body.gridSize != null) patch.grid_size = clampGridSize(body.gridSize, Number(current.grid_size))
    if (body.gridCols != null) patch.grid_cols = clampGridDim(body.gridCols, oldCols)
    if (body.gridRows != null) patch.grid_rows = clampGridDim(body.gridRows, oldRows)
    if (body.imageUrl != null) patch.image_url = body.imageUrl
    const nextCols = Number(patch.grid_cols ?? oldCols)
    const nextRows = Number(patch.grid_rows ?? oldRows)
    if (body.blocked != null) {
      patch.blocked_cells = parseBlockedCells(body.blocked, nextCols, nextRows)
    } else if (nextCols !== oldCols || nextRows !== oldRows) {
      patch.blocked_cells = remapBlocked(
        parseBlockedCells(current.blocked_cells, oldCols, oldRows),
        oldCols,
        oldRows,
        nextCols,
        nextRows,
      )
    }
    const { data, error } = await db().from('maps').update(patch).eq('id', id).select().single()
    throwIf(error)
    return { map: mapFromRow(data as Record<string, unknown>) }
  },

  async deleteMap(id) {
    const { error } = await db().from('maps').delete().eq('id', id)
    throwIf(error)
    return {}
  },

  async characters(campaignId) {
    const { data, error } = await db().from('player_characters').select('*').eq('campaign_id', campaignId)
    throwIf(error)
    const list = await hideCodes(campaignId, (data ?? []).map((r) => characterFromRow(r as Record<string, unknown>)))
    return { characters: list }
  },

  async createCharacter(campaignId, body) {
    const sheet = { ...emptySheet(), ...((body.sheet as object) ?? {}) }
    const { data, error } = await db()
      .from('player_characters')
      .insert({
        campaign_id: campaignId,
        personal_code: personalCode(),
        owner_display_name: String(body.ownerDisplayName || ''),
        name: String(body.name || 'New adventurer'),
        token_color: String(body.tokenColor || '#6ea8c9'),
        sheet_json: sheet,
      })
      .select()
      .single()
    throwIf(error)
    return { character: characterFromRow(data as Record<string, unknown>) }
  },

  async patchCharacter(id, body) {
    const { data: cur, error: getErr } = await db().from('player_characters').select('*').eq('id', id).single()
    throwIf(getErr)
    const mapped = characterFromRow(cur as Record<string, unknown>)
    const next = {
      name: (body.name as string) ?? mapped.name,
      owner_display_name: (body.ownerDisplayName as string) ?? mapped.ownerDisplayName,
      token_color: (body.tokenColor as string) ?? mapped.tokenColor,
      sheet_json: body.sheet ? { ...mapped.sheet, ...(body.sheet as object) } : mapped.sheet,
    }
    const { data, error } = await db().from('player_characters').update(next).eq('id', id).select().single()
    throwIf(error)
    const sheet = next.sheet_json as PlayerCharacter['sheet']
    if (body.sheet) {
      await db()
        .from('combatants')
        .update({ hp_current: sheet.hpCurrent, hp_max: sheet.hpMax, ac: sheet.ac })
        .eq('source', 'character')
        .eq('source_id', id)
    }
    return { character: characterFromRow(data as Record<string, unknown>) }
  },

  async regenCode(id) {
    const code = personalCode()
    const { error } = await db().from('player_characters').update({ personal_code: code }).eq('id', id)
    throwIf(error)
    return { personalCode: code }
  },

  async importPdf(id, file) {
    const parsed = await parseCharacterPdf(await file.arrayBuffer())
    const { data: cur, error: getErr } = await db().from('player_characters').select('*').eq('id', id).single()
    throwIf(getErr)
    const mapped = characterFromRow(cur as Record<string, unknown>)
    const name = parsed.characterName || mapped.name
    const owner = parsed.playerName || mapped.ownerDisplayName
    const sourcePdfUrl = await uploadCharacterPdf(mapped.campaignId, id, file)
    const { data, error } = await db()
      .from('player_characters')
      .update({
        name,
        owner_display_name: owner,
        sheet_json: { ...mapped.sheet, ...parsed.sheet },
        source_pdf_url: sourcePdfUrl,
      })
      .eq('id', id)
      .select()
      .single()
    throwIf(error)
    return { character: characterFromRow(data as Record<string, unknown>), fieldCount: parsed.fieldCount }
  },

  async templates(campaignId) {
    const { data, error } = await db().from('encounter_templates').select('*').eq('campaign_id', campaignId)
    throwIf(error)
    return {
      templates: (data ?? []).map((t) => templateFromRow(t as { id: unknown; campaign_id: unknown; map_id: unknown; name: unknown; monsters_json?: unknown; characters_json?: unknown })),
    }
  },

  async saveTemplate(campaignId, body) {
    const row = (): Record<string, unknown> => {
      const packedBody = packTemplateBody(body, embedPlayersInMonsters)
      const payload: Record<string, unknown> = {
        name: body.name,
        map_id: body.mapId,
        monsters_json: packedBody.packed,
      }
      if (!omittedTemplateCols.has('characters_json')) payload.characters_json = packedBody.characters
      return payload
    }
    const mapSaved = (data: Record<string, unknown>) => {
      return {
        template: templateFromRow({ ...data, campaign_id: data.campaign_id ?? campaignId }),
      }
    }
    const rememberMissingCharactersCol = (message: string) => {
      if (!/characters_json/.test(message)) return false
      omittedTemplateCols.add('characters_json')
      embedPlayersInMonsters = true
      return true
    }
    if (body.id) {
      for (let i = 0; i < 4; i++) {
        const { data, error } = await db().from('encounter_templates').update(row()).eq('id', body.id).select().single()
        if (!error) return mapSaved(data as Record<string, unknown>)
        if (rememberMissingCharactersCol(error.message)) continue
        throwIf(error)
      }
      throw new Error('Could not save the encounter.')
    }
    for (let i = 0; i < 4; i++) {
      const { data, error } = await db()
        .from('encounter_templates')
        .insert({ campaign_id: campaignId, ...row() })
        .select()
        .single()
      if (!error) return mapSaved(data as Record<string, unknown>)
      if (rememberMissingCharactersCol(error.message)) continue
      throwIf(error)
    }
    throw new Error('Could not save the encounter.')
  },

  async deleteTemplate(id) {
    const { error } = await db().from('encounter_templates').delete().eq('id', id)
    throwIf(error)
    return {}
  },

  async instances(campaignId) {
    const { data, error } = await db().from('encounter_instances').select('*').eq('campaign_id', campaignId)
    throwIf(error)
    return {
      instances: (data ?? []).map((i) => encounterFromRow(i as Record<string, unknown>)),
    }
  },

  async startInstance(campaignId, templateId, opts) {
    const start = opts ?? {}
    const { data: template, error: tErr } = await db().from('encounter_templates').select('*').eq('id', templateId).single()
    throwIf(tErr)
    const { data: map, error: mErr } = await db().from('maps').select('*').eq('id', template.map_id).single()
    throwIf(mErr)
    const lighting = lightingFromStart(start)
    const fog: FogState = makeStartFog(Number(map.grid_cols), Number(map.grid_rows), lighting)
    const { data: inst, error: iErr } = await db()
      .from('encounter_instances')
      .insert({
        campaign_id: campaignId,
        encounter_template_id: templateId,
        name: start.name || template.name,
        status: 'active',
        round_number: 0,
        current_turn_position: 0,
        fog_state: fog,
        map_id: map.id,
      })
      .select()
      .single()
    throwIf(iErr)
    const packed = unpackTemplateJson(template as { monsters_json?: unknown; characters_json?: unknown })
    const specs = packed.monsters
    let order = 0
    let placed = 0
    const battle = mapFromRow(map as Record<string, unknown>)
    for (const spec of specs) {
      const { data: src } = await db().from('bestiary_monsters').select('*').eq('id', spec.bestiaryMonsterId).maybeSingle()
      if (!src) continue
      for (let i = 0; i < spec.quantity; i++) {
        const label = spec.quantity > 1 ? `${spec.name} ${i + 1}` : spec.name
        const comb = await insertCombatantRow({
          encounter_instance_id: inst.id,
          name: label,
          source: 'bestiary',
          source_id: spec.bestiaryMonsterId,
          initiative: 0,
          hp_current: src.hp_max,
          hp_max: src.hp_max,
          hp_temp: 0,
          ac: src.ac_value,
          conditions_json: [],
          turn_order_position: order++,
          color: spec.color,
          notes: '',
          constitution: Number(src.con ?? 10),
          stats_json: combatantStatsFromMonster(src as Record<string, unknown>),
          speed_feet: parseSpeedFeet(src.speed),
          movement_remaining: parseSpeedFeet(src.speed),
        })
        const { col, row: r } = specCopyCell(spec, i, placed)
        const size = tokenSizeSquares(String(src.size ?? 'Medium'))
        const pos = walkablePixel(battle, col, r, size)
        const { error: tokErr } = await db().from('tokens_on_map').insert({
          encounter_instance_id: inst.id,
          x: pos.x,
          y: pos.y,
          ref_type: 'combatant',
          ref_id: comb.id,
          label,
          color: spec.color || '#c4453c',
          size_squares: size,
          visible_to_players: true,
        })
        throwIf(tokErr)
        placed++
      }
    }
    const starters = packed.characters
    for (const spec of starters) {
      await insertCharacterCombatant(String(inst.id), spec.characterId, spec.startX, spec.startY, order++)
    }
    if (start.surpriseParty || start.surpriseMonsters) {
      const { data: spawned } = await db().from('combatants').select('id, source, conditions_json').eq('encounter_instance_id', inst.id)
      for (const row of spawned ?? []) {
        const hit =
          (start.surpriseParty && row.source === 'character') || (start.surpriseMonsters && row.source === 'bestiary')
        if (!hit) continue
        const conditions = Array.isArray(row.conditions_json) ? [...(row.conditions_json as string[])] : []
        if (!conditions.some((x) => x.toLowerCase() === 'surprised')) conditions.push(SURPRISED)
        await db().from('combatants').update({ conditions_json: conditions }).eq('id', row.id)
      }
    }
    return { instanceId: String(inst.id) }
  },

  async setStatus(id, status) {
    const { error } = await db().from('encounter_instances').update({ status }).eq('id', id)
    throwIf(error)
    return {}
  },

  async openSession(campaignId, encounterInstanceId, opts) {
    const { data: existing } = await db()
      .from('live_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (encounterInstanceId) {
      await db().from('encounter_instances').update({ status: 'active' }).eq('id', encounterInstanceId)
    }
    if (!existing) {
      const code = joinCode()
    const data = await insertLiveSession({
      join_code: code,
      campaign_id: campaignId,
      encounter_instance_id: encounterInstanceId,
      table_phase: opts?.tablePhase === 'setup' ? 'setup' : encounterInstanceId ? 'combat' : 'table',
      ...(encounterInstanceId ? { last_outcome: null } : {}),
    })
    if (!encounterInstanceId) await applyHostedHubStage(campaignId, '')
    return { session: { joinCode: String(data.join_code) } }
    }
    const patch: Record<string, unknown> = {}
    if (opts?.rotateJoinCode) patch.join_code = joinCode()
    patch.encounter_instance_id = encounterInstanceId
    patch.table_phase =
      opts?.tablePhase === 'setup' || opts?.tablePhase === 'combat' || opts?.tablePhase === 'table'
        ? opts.tablePhase
        : encounterInstanceId
          ? 'combat'
          : 'table'
    if (encounterInstanceId) patch.last_outcome = null
    const data = await updateLiveSession(String(existing.id), patch)
    return { session: { joinCode: String(data.join_code ?? existing.join_code) } }
  },

  async ensureSession(campaignId) {
    const { data: existing } = await db()
      .from('live_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (existing) {
      if (!existing.encounter_instance_id && String(existing.table_phase ?? 'table') === 'table') {
        await applyHostedHubStage(campaignId, '')
      }
      return { session: { joinCode: String(existing.join_code) } }
    }
    const code = joinCode()
    const data = await insertLiveSession({
      join_code: code,
      campaign_id: campaignId,
      encounter_instance_id: null,
      table_phase: 'table',
    })
    await applyHostedHubStage(campaignId, '')
    return { session: { joinCode: String(data.join_code) } }
  },

  async patchSession(campaignId, body) {
    const { data: existing, error: loadErr } = await db()
      .from('live_sessions')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwIf(loadErr)
    if (!existing) throw new Error('No live session')
    const patch: Record<string, unknown> = {}
    if (body.ambianceCaption != null) patch.ambiance_caption = body.ambianceCaption
    if (body.ambianceImageUrl !== undefined) patch.ambiance_image_url = body.ambianceImageUrl
    if (body.tablePhase) patch.table_phase = body.tablePhase
    if (Object.keys(patch).length === 0) return {}
    await updateLiveSession(String(existing.id), patch)
    return {}
  },

  async uploadAmbiance(campaignId, file) {
    await supabaseApi.ensureSession(campaignId)
    const { data: existing, error: loadErr } = await db()
      .from('live_sessions')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwIf(loadErr)
    if (!existing) throw new Error('No live session')
    const path = storageObjectPath(`${campaignId}/ambiance`, file.name)
    const { error: upErr } = await db().storage.from('maps').upload(path, file, { upsert: true })
    if (upErr) {
      throw new Error(
        upErr.message.includes('Bucket not found') || upErr.message.includes('not found')
          ? 'Create a public Storage bucket named "maps" in Supabase, then try the upload again.'
          : upErr.message,
      )
    }
    const { data: pub } = db().storage.from('maps').getPublicUrl(path)
    await updateLiveSession(String(existing.id), { ambiance_image_url: pub.publicUrl })
    return {}
  },

  async uploadStageImage(campaignId, file) {
    const path = storageObjectPath(`${campaignId}/stages`, file.name)
    const { error: upErr } = await db().storage.from('maps').upload(path, file, { upsert: true })
    if (upErr) {
      throw new Error(
        upErr.message.includes('Bucket not found') || upErr.message.includes('not found')
          ? 'Create a public Storage bucket named "maps" in Supabase, then try the upload again.'
          : upErr.message,
      )
    }
    const { data: pub } = db().storage.from('maps').getPublicUrl(path)
    return { imageUrl: pub.publicUrl }
  },

  async finishEncounter(campaignId, outcome, opts) {
    const { data: existing, error: loadErr } = await db()
      .from('live_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwIf(loadErr)
    if (!existing) throw new Error('No live session')
    if (existing.encounter_instance_id) {
      const { data: instRow, error: instErr } = await db()
        .from('encounter_instances')
        .select('status')
        .eq('id', existing.encounter_instance_id)
        .maybeSingle()
      throwIf(instErr)
      const firstFinish = instRow?.status !== 'completed'
      const { error: stErr } = await db()
        .from('encounter_instances')
        .update({ status: 'completed' })
        .eq('id', existing.encounter_instance_id)
      throwIf(stErr)
      if (firstFinish) await applyHostedFinishRewards(campaignId, String(existing.encounter_instance_id), outcome, opts?.lootHolder)
    }
    await updateLiveSession(String(existing.id), {
      table_phase: outcome === 'won' ? 'victory' : 'defeat',
      last_outcome: outcome,
    })
    return {}
  },

  async returnToTable(campaignId) {
    const { data: existing, error: loadErr } = await db()
      .from('live_sessions')
      .select('id')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwIf(loadErr)
    if (!existing) throw new Error('No live session')
    await updateLiveSession(String(existing.id), { encounter_instance_id: null, table_phase: 'table' })
    return {}
  },

  async endSession(campaignId) {
    await db().from('encounter_instances').update({ status: 'paused' }).eq('campaign_id', campaignId).eq('status', 'active')
    const { error } = await db().from('live_sessions').delete().eq('campaign_id', campaignId)
    throwIf(error)
    return {}
  },

  async beginRound(campaignId) {
    const { data: existing, error: loadErr } = await db()
      .from('live_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    throwIf(loadErr)
    if (!existing?.encounter_instance_id) throw new Error('No fight on the table')
    const instanceId = String(existing.encounter_instance_id)
    const { data: inst, error: iErr } = await db().from('encounter_instances').select('*').eq('id', instanceId).single()
    throwIf(iErr)
    if (!inst) throw new Error('Encounter not found')
    const { data: rows, error: cErr } = await db().from('combatants').select('*').eq('encounter_instance_id', instanceId)
    throwIf(cErr)
    const likes = (rows ?? []).map((r) => combatantLikeFromRow(r as Record<string, unknown>))
    const first = firstActingPosition(likes, 1)
    const { error: uErr } = await db()
      .from('encounter_instances')
      .update({ current_turn_position: first.position, round_number: first.round })
      .eq('id', instanceId)
    throwIf(uErr)
    const nxt = likes.find((c) => c.turnOrderPosition === first.position) ?? likes[first.position]
    if (nxt) {
      const { data: row } = await db().from('combatants').select('speed_feet').eq('id', nxt.id).maybeSingle()
      await db()
        .from('combatants')
        .update({ turn_economy_json: emptyTurnEconomy(), movement_remaining: parseSpeedFeet(row?.speed_feet ?? 30) })
        .eq('id', nxt.id)
    }
    await logFeed(instanceId, `Round ${first.round} begins.`)
    await updateLiveSession(String(existing.id), { table_phase: 'combat' })
    return {}
  },

  async peekJoin(code) {
    const { data, error } = await db().rpc('peek_join', { p_join: code })
    throwIf(error)
    return data as { campaignName: string; joinCode: string }
  },

  async join(code, playerName) {
    await db().auth.signOut()
    const { data: anon, error: anonErr } = await db().auth.signInAnonymously()
    if (anonErr) {
      throw new Error('Anonymous sign-in is off. In Supabase: Authentication → Providers → Anonymous → Enable.')
    }
    const { data, error } = await db().rpc('join_table', { p_join: code, p_personal: playerName })
    throwIf(error)
    const payload = data as { characterId: string; campaignId: string; name: string }
    return {
      token: anon.session?.access_token ?? 'sb',
      user: {
        role: 'player',
        id: payload.characterId,
        characterId: payload.characterId,
        campaignId: payload.campaignId,
        name: payload.name,
      } satisfies AuthUser,
    }
  },

  async live(campaignId) {
    const userP = currentUserId()
    const campP = db().from('campaigns').select('*').eq('id', campaignId).single()
    const sessP = db()
      .from('live_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const [user, campRes, sessRes] = await Promise.all([userP, campP, sessP])
    throwIf(campRes.error)
    const campaign = campRes.data
    if (!campaign) throw new Error('Campaign not found')
    const session = sessRes.data
    const instanceId = session?.encounter_instance_id as string | undefined

    const instP = instanceId
      ? db().from('encounter_instances').select('*').eq('id', instanceId).maybeSingle()
      : Promise.resolve({ data: null as Record<string, unknown> | null })
    const charsP = db().from('player_characters').select('*').eq('campaign_id', campaignId)
    const dmP = db().from('dm_accounts').select('id').eq('id', user.id).maybeSingle()
    const combP = instanceId
      ? db().from('combatants').select('*').eq('encounter_instance_id', instanceId).order('turn_order_position')
      : Promise.resolve({ data: [] as Record<string, unknown>[] })
    const tokP = instanceId
      ? db().from('tokens_on_map').select('*').eq('encounter_instance_id', instanceId)
      : Promise.resolve({ data: [] as Record<string, unknown>[] })
    const [instRes, charsRes, dmRes, combRes, tokRes] = await Promise.all([instP, charsP, dmP, combP, tokP])
    const instance = instRes.data
    const combatants = combRes.data ?? []
    const tokens = tokRes.data ?? []
    const accessP = dmRes.data
      ? Promise.resolve({ data: null as { character_id?: string } | null })
      : db()
          .from('character_access')
          .select('character_id')
          .eq('user_id', user.id)
          .eq('campaign_id', campaignId)
          .maybeSingle()
    const mapP = instance?.map_id
      ? db().from('maps').select('*').eq('id', instance.map_id).maybeSingle()
      : Promise.resolve({ data: null as Record<string, unknown> | null })
    const missingBestiaryIds = [
      ...new Set(
        combatants
          .filter((c) => c.source === 'bestiary')
          .map((c) => String(c.source_id ?? ''))
          .filter(Boolean),
      ),
    ]
    const bestiaryP = missingBestiaryIds.length
      ? db()
          .from('bestiary_monsters')
          .select('*')
          .in('id', missingBestiaryIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] })
    const [mapRes, accessRes, bestiaryRes] = await Promise.all([mapP, accessP, bestiaryP])
    const map = mapRes.data
    const bestiaryById = new Map<string, Record<string, unknown>>()
    for (const m of bestiaryRes.data ?? []) bestiaryById.set(String((m as { id?: string }).id), m as Record<string, unknown>)
    const chars = (charsRes.data ?? []).map((r) => characterFromRow(r as Record<string, unknown>))
    if (!dmRes.data) {
      const mine = accessRes.data?.character_id
      for (const c of chars) {
        if (c.id !== mine) c.personalCode = '••••••••'
      }
    }
    const snap = {
      campaign: {
        id: String(campaign.id),
        dmAccountId: String(campaign.dm_account_id),
        name: String(campaign.name),
        hub: parseHub((campaign as { hub_json?: unknown }).hub_json),
      },
      session: session ? sessionFromRow(session as Record<string, unknown>) : null,
      instance: instance ? encounterFromRow(instance as Record<string, unknown>) : null,
      map: map ? mapFromRow(map as Record<string, unknown>) : null,
      combatants: (combatants ?? []).map((c) => ({
        id: String(c.id),
        encounterInstanceId: String(c.encounter_instance_id),
        name: String(c.name),
        source: c.source as 'bestiary' | 'character',
        sourceId: String(c.source_id ?? ''),
        initiative: Number(c.initiative),
        hpCurrent: Number(c.hp_current),
        hpMax: Number(c.hp_max),
        hpTemp: Number(c.hp_temp),
        ac: Number(c.ac),
        conditions: (c.conditions_json as string[]) ?? [],
        turnOrderPosition: Number(c.turn_order_position),
        color: String(c.color ?? '#c4453c'),
        notes: String(c.notes ?? ''),
        constitution: Number((c as { constitution?: number }).constitution ?? 10),
        stats: statsForLiveCombatant(
          c as { stats_json?: unknown; source?: unknown },
          c.source === 'bestiary' ? bestiaryById.get(String(c.source_id ?? '')) : null,
        ),
        advantageAgainst: Array.isArray((c as { advantage_against_json?: string[] }).advantage_against_json)
          ? ((c as { advantage_against_json: string[] }).advantage_against_json)
          : [],
        deathState: parseDeathState((c as { death_state?: string }).death_state),
        deathSuccess: Number((c as { death_success?: number }).death_success ?? 0),
        deathFail: Number((c as { death_fail?: number }).death_fail ?? 0),
        turnEconomy: parseTurnEconomy((c as { turn_economy_json?: unknown }).turn_economy_json),
        speedFeet: parseSpeedFeet((c as { speed_feet?: unknown }).speed_feet ?? 30),
        movementRemaining: Number.isFinite(Number((c as { movement_remaining?: unknown }).movement_remaining))
          ? Math.max(0, Number((c as { movement_remaining?: unknown }).movement_remaining))
          : parseSpeedFeet((c as { speed_feet?: unknown }).speed_feet ?? 30),
        attacksUsed: Math.max(0, Number((c as { attacks_used?: unknown }).attacks_used) || 0),
      })),
      tokens: (tokens ?? []).map((t) => ({
        id: String(t.id),
        encounterInstanceId: String(t.encounter_instance_id),
        x: Number(t.x),
        y: Number(t.y),
        refType: t.ref_type as 'character' | 'combatant',
        refId: String(t.ref_id),
        label: String(t.label ?? ''),
        color: String(t.color ?? '#c4453c'),
        sizeSquares: Number(t.size_squares ?? 1),
        visibleToPlayers: Boolean(t.visible_to_players),
      })),
      characters: chars,
      monsters: [...bestiaryById.values()].map((row) => monsterFromRow(row)),
    }
    if (dmRes.data) return snap
    return snapshotForPlayer(snap, accessRes.data?.character_id as string | undefined)
  },

  async addCombatant(instanceId, body) {
    const { data: inst, error: iErr } = await db().from('encounter_instances').select('*').eq('id', instanceId).single()
    throwIf(iErr)
    const { data: map } = inst.map_id ? await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle() : { data: null }
    const battle = map ? mapFromRow(map as Record<string, unknown>) : null
    const cell = battle?.gridSize ?? 70
    const { data: maxRow } = await db()
      .from('combatants')
      .select('turn_order_position')
      .eq('encounter_instance_id', instanceId)
      .order('turn_order_position', { ascending: false })
      .limit(1)
      .maybeSingle()
    const nextPos = Number(maxRow?.turn_order_position ?? -1) + 1
    if (body.characterId) {
      await insertCharacterCombatant(
        instanceId,
        String(body.characterId),
        typeof body.startX === 'number' ? body.startX : undefined,
        typeof body.startY === 'number' ? body.startY : undefined,
        nextPos,
      )
      return {}
    }
    if (body.bestiaryMonsterId) {
      const { data: src, error } = await db().from('bestiary_monsters').select('*').eq('id', body.bestiaryMonsterId).single()
      throwIf(error)
      const qty = Number(body.quantity ?? 1)
      for (let i = 0; i < qty; i++) {
        const label = qty > 1 ? `${src.name} ${i + 1}` : String(src.name)
        const comb = await insertCombatantRow({
          encounter_instance_id: instanceId,
          name: label,
          source: 'bestiary',
          source_id: src.id,
          initiative: 0,
          hp_current: src.hp_max,
          hp_max: src.hp_max,
          hp_temp: 0,
          ac: src.ac_value,
          conditions_json: [],
          turn_order_position: nextPos + i,
          color: body.color || '#c4453c',
          notes: '',
          constitution: Number(src.con ?? 10),
          stats_json: combatantStatsFromMonster(src as Record<string, unknown>),
          speed_feet: parseSpeedFeet(src.speed),
          movement_remaining: parseSpeedFeet(src.speed),
        })
        const pos = battle ? walkablePixel(battle, 3 + i, 3) : { x: cell * (3 + i) + cell / 2, y: cell * 3 + cell / 2 }
        await db().from('tokens_on_map').insert({
          encounter_instance_id: instanceId,
          x: pos.x,
          y: pos.y,
          ref_type: 'combatant',
          ref_id: comb.id,
          label,
          color: body.color || '#c4453c',
          size_squares: 1,
          visible_to_players: true,
        })
      }
    }
    return {}
  },

  async joinFight(instanceId) {
    const rpc = await db().rpc('player_join_fight', { p_instance: instanceId })
    if (!rpc.error) return {}
    if (!missingRpc(rpc.error.message, 'player_join_fight')) throwIf(rpc.error)
    const user = await currentUserId()
    const { data: inst, error: iErr } = await db().from('encounter_instances').select('campaign_id').eq('id', instanceId).single()
    throwIf(iErr)
    if (!inst) throw new Error('Encounter not found')
    const { data: access } = await db()
      .from('character_access')
      .select('character_id')
      .eq('user_id', user.id)
      .eq('campaign_id', inst.campaign_id)
      .maybeSingle()
    if (!access?.character_id) throw new Error('You are not at this table.')
    await insertCharacterCombatant(instanceId, String(access.character_id))
    return {}
  },

  async removeCombatant(id) {
    const { data: c, error } = await db().from('combatants').select('*').eq('id', id).single()
    throwIf(error)
    await db().from('tokens_on_map').delete().eq('encounter_instance_id', c.encounter_instance_id).eq('ref_id', id)
    await db().from('combatants').delete().eq('id', id)
    const { data: rows } = await db()
      .from('combatants')
      .select('id, turn_order_position')
      .eq('encounter_instance_id', c.encounter_instance_id)
      .order('turn_order_position', { ascending: true })
    await Promise.all((rows ?? []).map((r, i) => db().from('combatants').update({ turn_order_position: i }).eq('id', r.id)))
    const { data: inst } = await db()
      .from('encounter_instances')
      .select('current_turn_position')
      .eq('id', c.encounter_instance_id)
      .maybeSingle()
    const n = rows?.length ?? 0
    let pos = Number(inst?.current_turn_position ?? 0)
    if (n === 0 || pos >= n) pos = 0
    await db().from('encounter_instances').update({ current_turn_position: pos }).eq('id', c.encounter_instance_id)
    return {}
  },

  async setInitiative(id, body) {
    const rpc = await db().rpc('player_set_initiative', { p_combatant: id, p_d20: body.d20 })
    if (!rpc.error) return { initiative: Number((rpc.data as { initiative?: number } | null)?.initiative ?? 0) }
    if (!missingRpc(rpc.error.message, 'player_set_initiative')) throwIf(rpc.error)
    if (!Number.isInteger(body.d20) || body.d20 < 1 || body.d20 > 20) throw new Error('d20 must be between 1 and 20')
    const { data: c, error } = await db().from('combatants').select('*').eq('id', id).single()
    throwIf(error)
    const stats = parseCombatantStats(c.stats_json)
    let bonus = abilityMod(Number(stats?.dex ?? 10))
    if (c.source === 'character' && c.source_id) {
      const { data: ch } = await db().from('player_characters').select('sheet_json').eq('id', c.source_id).maybeSingle()
      if (ch) {
        const sheet = { ...emptySheet(), ...((ch.sheet_json as object) || {}) }
        bonus = sheet.initiativeBonus ?? abilityMod(sheet.abilities.dex)
      }
    }
    const total = body.d20 + bonus
    const { error: uErr } = await db().from('combatants').update({ initiative: total }).eq('id', id)
    throwIf(uErr)
    return { initiative: total }
  },

  async patchCombatant(id, body) {
    const patch: Record<string, unknown> = {}
    if (body.name != null) patch.name = body.name
    if (body.initiative != null) patch.initiative = body.initiative
    if (body.hpCurrent != null) patch.hp_current = body.hpCurrent
    if (body.hpMax != null) patch.hp_max = body.hpMax
    if (body.hpTemp != null) patch.hp_temp = body.hpTemp
    if (body.ac != null) patch.ac = body.ac
    if (body.turnOrderPosition != null) patch.turn_order_position = body.turnOrderPosition
    if (body.color != null) patch.color = body.color
    if (body.notes != null) patch.notes = body.notes
    if (body.conditions != null) patch.conditions_json = body.conditions
    if (body.deathState != null) patch.death_state = body.deathState
    if (body.deathSuccess != null) patch.death_success = body.deathSuccess
    if (body.deathFail != null) patch.death_fail = body.deathFail
    if (body.turnEconomy != null) patch.turn_economy_json = parseTurnEconomy(body.turnEconomy)
    if (body.speedFeet != null) patch.speed_feet = parseSpeedFeet(body.speedFeet)
    if (body.movementRemaining != null) patch.movement_remaining = clampMovementRemaining(body.movementRemaining)
    const prevHp = body.hpCurrent != null ? Number((await db().from('combatants').select('hp_current').eq('id', id).maybeSingle()).data?.hp_current ?? 0) : 0
    const { data, error } = await db().from('combatants').update(patch).eq('id', id).select().single()
    throwIf(error)
    if (data.source === 'character' && (body.hpCurrent != null || body.hpMax != null)) {
      const { data: ch } = await db().from('player_characters').select('sheet_json').eq('id', data.source_id).maybeSingle()
      if (ch) {
        const sheet = { ...(ch.sheet_json as Record<string, unknown>) }
        if (body.hpCurrent != null) sheet.hpCurrent = body.hpCurrent
        if (body.hpMax != null) sheet.hpMax = body.hpMax
        await db().from('player_characters').update({ sheet_json: sheet }).eq('id', data.source_id)
      }
    }
    if (body.hpCurrent != null) {
      const knock = afterHpChange({
        source: data.source === 'character' ? 'character' : 'bestiary',
        prevHp,
        nextHp: Number(body.hpCurrent),
        conditions: Array.isArray(data.conditions_json) ? (data.conditions_json as string[]) : [],
        deathState: parseDeathState((data as { death_state?: string }).death_state),
        deathSuccess: Number((data as { death_success?: number }).death_success ?? 0),
        deathFail: Number((data as { death_fail?: number }).death_fail ?? 0),
      })
      await db()
        .from('combatants')
        .update({
          conditions_json: knock.conditions,
          death_state: knock.deathState,
          death_success: knock.deathSuccess,
          death_fail: knock.deathFail,
        })
        .eq('id', id)
    }
    return {}
  },

  async nextTurn(id, opts) {
    const expected = opts?.expectedTurnPosition
    const rpc = await db().rpc('player_advance_turn', { p_instance: id, p_expected_pos: expected ?? null })
    if (!rpc.error) return {}
    if (!missingRpc(rpc.error.message, 'player_advance_turn')) throwIf(rpc.error)
    const { data: inst, error } = await db().from('encounter_instances').select('*').eq('id', id).single()
    throwIf(error)
    const currentPos = Number(inst.current_turn_position)
    if (expected != null && Number.isInteger(expected) && expected !== currentPos) return {}
    const { data: rows, error: cErr } = await db().from('combatants').select('*').eq('encounter_instance_id', id)
    throwIf(cErr)
    const likes = (rows ?? []).map((r) => combatantLikeFromRow(r as Record<string, unknown>))
    if (likes.length === 0) return {}
    const next = nextActingPosition(likes, currentPos, Number(inst.round_number))
    if (next.wrapped) {
      for (const row of rows ?? []) {
        const conditions = Array.isArray(row.conditions_json) ? (row.conditions_json as string[]) : []
        const stripped = withoutSurprised(conditions)
        if (stripped.length !== conditions.length) {
          await db().from('combatants').update({ conditions_json: stripped }).eq('id', row.id)
        }
      }
      await logFeed(id, `Round ${next.round} begins.`)
    }
    const { error: uErr } = await db()
      .from('encounter_instances')
      .update({ current_turn_position: next.position, round_number: next.round })
      .eq('id', id)
    throwIf(uErr)
    const { data: up } = await db()
      .from('combatants')
      .select('id, speed_feet')
      .eq('encounter_instance_id', id)
      .eq('turn_order_position', next.position)
      .maybeSingle()
    if (up) {
      await db()
        .from('combatants')
        .update({ turn_economy_json: emptyTurnEconomy(), movement_remaining: parseSpeedFeet(up.speed_feet ?? 30) })
        .eq('id', up.id)
    }
    return {}
  },

  async sortInit(id, opts) {
    const { data, error } = await db()
      .from('combatants')
      .select('id, name, initiative, stats_json, turn_order_position')
      .eq('encounter_instance_id', id)
    throwIf(error)
    const { data: inst } = await db().from('encounter_instances').select('current_turn_position').eq('id', id).maybeSingle()
    const currentId = (data ?? []).find((r) => Number(r.turn_order_position) === Number(inst?.current_turn_position))?.id
    const rows = sortByInitiative(
      (data ?? []).map((r) => ({
        id: String(r.id),
        name: String(r.name ?? ''),
        initiative: Number(r.initiative),
        stats: parseCombatantStats(r.stats_json),
      })),
    )
    await Promise.all(rows.map((r, i) => db().from('combatants').update({ turn_order_position: i }).eq('id', r.id)))
    let pos = 0
    if (opts?.keepCurrent && currentId) {
      const idx = rows.findIndex((r) => r.id === String(currentId))
      if (idx >= 0) pos = idx
    }
    await db().from('encounter_instances').update({ current_turn_position: pos }).eq('id', id)
    return {}
  },

  async reorder(id, ids) {
    await Promise.all(ids.map((cid, i) => db().from('combatants').update({ turn_order_position: i }).eq('id', cid).eq('encounter_instance_id', id)))
    return {}
  },

  async moveToken(id, body) {
    if (body.x != null && body.y != null) {
      const { data: token, error: tErr } = await db().from('tokens_on_map').select('*').eq('id', id).single()
      throwIf(tErr)
      const { data: inst } = await db().from('encounter_instances').select('*').eq('id', token.encounter_instance_id).maybeSingle()
      let gridSize = 70
      let battle: BattleMap | undefined
      if (inst?.map_id) {
        const { data: map } = await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle()
        if (map) {
          battle = mapFromRow(map as Record<string, unknown>)
          gridSize = battle.gridSize
          const { col, row } = pixelToCell(Number(body.x), Number(body.y), battle.gridSize)
          if (tokenOccupiesBlocked(battle.blocked, col, row, battle.gridCols, battle.gridRows, Number(token.size_squares ?? 1))) {
            throw new Error('That square is blocked')
          }
        }
      }
      const { error: rpcErr } = await db().rpc('move_combatant_token', { p_token: id, p_x: body.x, p_y: body.y })
      if (!rpcErr) {
        await revealHidingAfterMove(String(token.encounter_instance_id), String(token.ref_id), battle, { x: Number(body.x), y: Number(body.y) })
        return {}
      }
      if (!/could not find|does not exist|schema cache|move_combatant_token/i.test(rpcErr.message)) throwIf(rpcErr)
      const { data: comb } = await db().from('combatants').select('*').eq('id', token.ref_id).maybeSingle()
      if (comb && Number(comb.turn_order_position) === Number(inst?.current_turn_position)) {
        const cost = movementCostFeet(
          tokenCell({ x: Number(token.x), y: Number(token.y) }, gridSize),
          tokenCell({ x: Number(body.x), y: Number(body.y) }, gridSize),
          battle?.blocked,
          battle?.gridCols,
          battle?.gridRows,
        )
        if (!Number.isFinite(cost)) throw new Error('That path is blocked')
        const spent = spendMovement(Number((comb as { movement_remaining?: number }).movement_remaining ?? (comb as { speed_feet?: number }).speed_feet ?? 30), cost)
        if (!spent.ok) throw new Error(spent.error)
        const { error: mvErr } = await db().from('combatants').update({ movement_remaining: spent.remaining }).eq('id', comb.id)
        throwIf(mvErr)
        if (cost > 0) await logFeed(String(token.encounter_instance_id), `${comb.name} moved ${cost} ft.`)
      }
      await revealHidingAfterMove(String(token.encounter_instance_id), String(token.ref_id), battle, { x: Number(body.x), y: Number(body.y) })
    }
    const { error } = await db()
      .from('tokens_on_map')
      .update({
        x: body.x,
        y: body.y,
        visible_to_players: body.visibleToPlayers,
        size_squares: body.sizeSquares,
      })
      .eq('id', id)
    throwIf(error)
    return {}
  },

  async setFog(id, fogState) {
    const { error } = await db().from('encounter_instances').update({ fog_state: fogState }).eq('id', id)
    throwIf(error)
    return {}
  },

  async playerAttack(instanceId, body) {
    const cover = await coverForAttack(instanceId, body.attackerId, body.targetId)
    const payload: Record<string, unknown> = {
      p_instance: instanceId,
      p_target: body.targetId,
      p_attack_index: body.attackIndex,
      p_d20: body.d20,
      p_damage: body.damage,
      p_attacker: body.attackerId ?? null,
      p_d20_b: body.d20b ?? null,
      p_roll_mode: body.rollMode ?? 'normal',
      p_cover: cover,
      p_slot: body.slot ?? 'action',
    }
    let { data, error } = await db().rpc('resolve_player_attack', payload)
    if (error && /p_slot/.test(error.message)) {
      delete payload.p_slot
      const retry = await db().rpc('resolve_player_attack', payload)
      data = retry.data
      error = retry.error
    }
    if (error && /p_cover/.test(error.message)) {
      delete payload.p_cover
      const retry = await db().rpc('resolve_player_attack', payload)
      data = retry.data
      error = retry.error
    }
    if (error && /p_d20_b|p_roll_mode/.test(error.message)) {
      delete payload.p_d20_b
      delete payload.p_roll_mode
      delete payload.p_cover
      const retry = await db().rpc('resolve_player_attack', payload)
      data = retry.data
      error = retry.error
    }
    throwIf(error)
    await stripHidingOnAttack(instanceId, body.attackerId, body.targetId)
    const result = data as {
      hit: boolean
      crit: boolean
      fumble: boolean
      hadAdvantage: boolean
      rollMode?: string
      d20?: number
      d20b?: number | null
      total: number
      ac: number
      damage: number
      hpCurrent: number
      hpTemp: number
      targetName: string
      message: string
    }
    let attackerName = 'Player'
    if (body.attackerId) {
      const { data: atk } = await db().from('combatants').select('name').eq('id', body.attackerId).maybeSingle()
      if (atk?.name) attackerName = String(atk.name)
    }
    const used = Number(result.d20 ?? body.d20)
    const bonus = Number(result.total) - used
    const mode = String(result.rollMode ?? body.rollMode ?? 'normal')
    const diceNote = formatDiceUsed(body.d20, mode === 'normal' ? null : (body.d20b ?? result.d20b ?? null), used)
    void Promise.all(
      attackActivityLines({
        attackerName,
        targetName: result.targetName,
        diceNote,
        bonus,
        total: result.total,
        hit: result.hit,
        fumble: result.fumble,
        damage: result.damage,
      }).map((line) => logFeed(instanceId, line)),
    )
    return result
  },

  async deathSave(combatantId, body) {
    const { data: row, error: rErr } = await db().from('combatants').select('*').eq('id', combatantId).single()
    throwIf(rErr)
    const result = resolveDeathSave(Number(body.d20), {
      deathSuccess: Number(row.death_success ?? 0),
      deathFail: Number(row.death_fail ?? 0),
      deathState: parseDeathState(row.death_state),
    })
    const conditions = Array.isArray(row.conditions_json) ? [...(row.conditions_json as string[])] : []
    let hp = Number(row.hp_current)
    if (result.revived) {
      hp = result.hpCurrent
      const i = conditions.indexOf('Unconscious')
      if (i >= 0) conditions.splice(i, 1)
    } else if ((result.deathState === 'dying' || result.deathState === 'stable') && !conditions.includes('Unconscious')) {
      conditions.push('Unconscious')
    }
    const { error } = await db()
      .from('combatants')
      .update({
        death_state: result.deathState,
        death_success: result.deathSuccess,
        death_fail: result.deathFail,
        hp_current: hp,
        conditions_json: conditions,
      })
      .eq('id', combatantId)
    if (error) {
      const rpc = await db().rpc('resolve_death_save', { p_combatant: combatantId, p_d20: Number(body.d20) })
      throwIf(rpc.error)
      return rpc.data as typeof result
    }
    if (row.source === 'character') {
      const { data: ch } = await db().from('player_characters').select('sheet_json').eq('id', row.source_id).maybeSingle()
      if (ch) {
        const sheet = { ...(ch.sheet_json as Record<string, unknown>), deathSuccess: result.deathSuccess, deathFail: result.deathFail, hpCurrent: hp }
        await db().from('player_characters').update({ sheet_json: sheet }).eq('id', row.source_id)
      }
    }
    return result
  },

  async resetDeath(combatantId) {
    const { data: row, error: rErr } = await db().from('combatants').select('*').eq('id', combatantId).single()
    throwIf(rErr)
    const conditions = (Array.isArray(row.conditions_json) ? (row.conditions_json as string[]) : []).filter((c) => c !== 'Unconscious')
    const { error } = await db()
      .from('combatants')
      .update({ death_state: 'ok', death_success: 0, death_fail: 0, conditions_json: conditions })
      .eq('id', combatantId)
    throwIf(error)
    return {}
  },

  async setTurnEconomy(combatantId, body) {
    const economy = parseTurnEconomy(body)
    const { error } = await db().from('combatants').update({ turn_economy_json: economy }).eq('id', combatantId)
    if (error) {
      const rpc = await db().rpc('set_turn_economy', { p_combatant: combatantId, p_economy: economy })
      throwIf(rpc.error)
    }
    return {}
  },

  async logActivity(instanceId, text) {
    await logFeed(instanceId, text)
    return {}
  },

  async declareAction(instanceId, body) {
    if (body.kind === 'hide') {
      const pieces = await loadFightPieces(instanceId)
      const hider = body.combatantId
        ? pieces.combatants.find((c) => c.id === body.combatantId)
        : pieces.combatants.find((c) => c.turnOrderPosition === Number(pieces.inst.current_turn_position))
      if (!hider) throw new Error('Combatant not found')
      if (!pieces.map) throw new Error('Need the map to hide.')
      const d20 = Number(body.d20)
      const monster = hider.source === 'bestiary' ? pieces.monsters.find((m) => m.id === hider.sourceId) ?? null : null
      const result = resolveHideAttempt({
        hider,
        combatants: pieces.combatants,
        tokens: pieces.tokens,
        map: pieces.map,
        characters: pieces.characters,
        monsters: pieces.monsters,
        d20,
        sheet: sheetForHide(hider, pieces.characters),
        monster,
      })
      if (!result.ok) throw new Error(result.message)
      const { data, error } = await db().rpc('apply_hide_result', {
        p_instance: instanceId,
        p_combatant: hider.id,
        p_success: result.success,
        p_text: result.message,
        p_spend_action: true,
        p_slot: body.slot ?? 'action',
      })
      if (error) {
        if (missingRpc(error.message, 'apply_hide_result')) {
          await persistHide(hider.id, result.success)
          const { data: row } = await db().from('combatants').select('turn_economy_json').eq('id', hider.id).maybeSingle()
          const econ = parseTurnEconomy(row?.turn_economy_json)
          const slot = body.slot === 'bonus' ? 'bonus' : body.slot === 'reaction' ? 'reaction' : 'action'
          econ[slot] = true
          await db().from('combatants').update({ turn_economy_json: econ }).eq('id', hider.id)
          await logFeed(instanceId, result.message)
          return { text: result.message, success: result.success }
        }
        throw new Error(error.message)
      }
      return { ...(data ?? { text: result.message }), success: result.success } as { text: string; success: boolean }
    }
    const { data, error } = await db().rpc('declare_combat_action', {
      p_instance: instanceId,
      p_kind: body.kind,
      p_slot: body.slot ?? 'action',
      p_combatant: body.combatantId ?? null,
      p_target: body.targetId ?? null,
      p_other: body.other ?? null,
      p_custom: body.custom ?? null,
    })
    if (error) {
      throw new Error(
        missingRpc(error.message, 'declare_combat_action')
          ? 'Run migrate-player-combat.sql in the Supabase SQL Editor, then: notify pgrst, \'reload schema\';'
          : error.message,
      )
    }
    if (body.kind === 'dash' || body.kind === 'help' || body.kind === 'other' || body.kind === 'custom') {
      const cid = body.combatantId
      if (cid) {
        const { data: row } = await db().from('combatants').select('name, conditions_json').eq('id', cid).maybeSingle()
        const conditions = Array.isArray(row?.conditions_json) ? (row!.conditions_json as string[]) : []
        if (isHiding({ conditions })) {
          await persistHide(cid, false)
          await logFeed(instanceId, `${row?.name ?? 'Creature'} is no longer hidden.`)
        }
      }
    }
    return (data ?? { text: '' }) as { text: string }
  },

  async applyHide(instanceId, body) {
    const { data, error } = await db().rpc('apply_hide_result', {
      p_instance: instanceId,
      p_combatant: body.combatantId,
      p_success: body.success,
      p_text: body.text,
      p_spend_action: false,
    })
    if (error) {
      if (!missingRpc(error.message, 'apply_hide_result')) throw new Error(error.message)
      await persistHide(body.combatantId, body.success)
      if (body.text) await logFeed(instanceId, body.text)
      return { text: body.text }
    }
    return (data ?? { text: body.text }) as { text: string }
  },

  async setPrompt(instanceId, prompt) {
    const { error } = await db().rpc('set_combat_prompt', { p_instance: instanceId, p_prompt: prompt })
    if (error) {
      throw new Error(
        missingRpc(error.message, 'set_combat_prompt')
          ? 'Run migrate-player-combat.sql in the Supabase SQL Editor, then: notify pgrst, \'reload schema\';'
          : error.message,
      )
    }
    return {}
  },

  async answerPrompt(instanceId, body) {
    const { data, error } = await db().rpc('answer_combat_prompt', {
      p_instance: instanceId,
      p_use: body.use ?? null,
      p_d20: body.d20 ?? null,
      p_other: body.other ?? body.attackName ?? null,
    })
    if (error) {
      throw new Error(
        missingRpc(error.message, 'answer_combat_prompt')
          ? 'Run migrate-player-combat.sql in the Supabase SQL Editor, then: notify pgrst, \'reload schema\';'
          : error.message,
      )
    }
    return (data ?? { ok: true }) as { ok?: true; success?: boolean; total?: number; message?: string }
  },
}

function mapSrdPlaceholder(m: Partial<Monster>): ReturnType<typeof mapSrdMonster> {
  return {
    name: m.name ?? 'Unnamed',
    size: m.size ?? 'Medium',
    creatureType: m.creatureType ?? 'humanoid',
    alignment: m.alignment ?? 'unaligned',
    acValue: m.acValue ?? 10,
    acNote: m.acNote ?? '',
    hpMax: m.hpMax ?? 10,
    hitDiceFormula: m.hitDiceFormula ?? '',
    speed: m.speed ?? '30 ft.',
    str: m.str ?? 10,
    dex: m.dex ?? 10,
    con: m.con ?? 10,
    int: m.int ?? 10,
    wis: m.wis ?? 10,
    cha: m.cha ?? 10,
    savingThrows: m.savingThrows ?? '',
    skills: m.skills ?? '',
    damageVulnerabilities: m.damageVulnerabilities ?? '',
    damageResistances: m.damageResistances ?? '',
    damageImmunities: m.damageImmunities ?? '',
    conditionImmunities: m.conditionImmunities ?? '',
    senses: m.senses ?? '',
    languages: m.languages ?? '',
    challengeRating: m.challengeRating ?? 0,
    xp: m.xp ?? 0,
    proficiencyBonus: m.proficiencyBonus ?? 2,
    traits: m.traits ?? [],
    actions: m.actions ?? [],
    legendaryActions: m.legendaryActions ?? [],
    reactions: m.reactions ?? [],
    bonusActions: m.bonusActions ?? [],
    lairActions: m.lairActions ?? [],
    source: m.source ?? 'custom',
  }
}
