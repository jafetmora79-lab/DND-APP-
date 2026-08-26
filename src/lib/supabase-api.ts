import { customAlphabet } from 'nanoid'
import { publicAsset, tableEmail } from './config'
import { emptySheet, type AuthUser, type BattleMap, type FogState, type Monster, type NamedEntry, type PlayerCharacter } from './types'
import { parseCharacterPdf } from './parse-pdf'
import { mapSrdMonster, type SrdMonster } from './srd-map'
import { supabase } from './supabase'
import { parseBlockedCells, tokenSizeSquares, walkablePixel, clampGridDim, clampGridSize, DEFAULT_SCRATCH_CELL, tokenOccupiesBlocked, pixelToCell, remapBlocked } from './utils'
import { specCopyCell } from './combat'
import type { TableApi } from './local-api'

const joinCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6)
const personalCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 8)

function db() {
  if (!supabase) throw new Error('Supabase is not configured')
  return supabase
}

function throwIf(error: { message: string } | null) {
  if (error) throw new Error(error.message)
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
    sheet: (row.sheet_json as PlayerCharacter['sheet']) ?? emptySheet(),
  }
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

async function insertCombatantRow(row: Record<string, unknown>) {
  const { data, error } = await db().from('combatants').insert(row).select().single()
  if (error && /constitution/.test(error.message) && 'constitution' in row) {
    const { constitution: _ignored, ...rest } = row
    void _ignored
    const retry = await db().from('combatants').insert(rest).select().single()
    throwIf(retry.error)
    return retry.data
  }
  throwIf(error)
  return data
}

async function insertCharacterCombatant(instanceId: string, characterId: string, startX?: number, startY?: number, turnOrder?: number) {
  const { data: existing } = await db()
    .from('combatants')
    .select('id')
    .eq('encounter_instance_id', instanceId)
    .eq('source', 'character')
    .eq('source_id', characterId)
    .maybeSingle()
  if (existing) return
  const { data: inst, error: iErr } = await db().from('encounter_instances').select('*').eq('id', instanceId).single()
  throwIf(iErr)
  const { data: map } = inst.map_id ? await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle() : { data: null }
  const battle = map ? mapFromRow(map as Record<string, unknown>) : null
  const cell = battle?.gridSize ?? 70
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
  const { data: ch, error } = await db().from('player_characters').select('*').eq('id', characterId).single()
  throwIf(error)
  const mapped = characterFromRow(ch as Record<string, unknown>)
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
  })
  const { count } = await db().from('tokens_on_map').select('id', { count: 'exact', head: true }).eq('encounter_instance_id', instanceId)
  const col = Number.isFinite(startX) ? Number(startX) : 2 + ((count ?? 0) % 6)
  const row = Number.isFinite(startY) ? Number(startY) : 10
  const pos = battle ? walkablePixel(battle, col, row) : { x: cell * col + cell / 2, y: cell * row + cell / 2 }
  const { error: tokErr } = await db().from('tokens_on_map').insert({
    encounter_instance_id: instanceId,
    x: pos.x,
    y: pos.y,
    ref_type: 'combatant',
    ref_id: comb.id,
    label: mapped.name,
    color: mapped.tokenColor,
    size_squares: 1,
    visible_to_players: true,
  })
  throwIf(tokErr)
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
  const safeName = file.name.replace(/[^\w.-]+/g, '_') || 'character.pdf'
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
    return { campaign: { id: String(data.id), dmAccountId: user.id, name: String(data.name) } }
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
    const path = `${campaignId}/${crypto.randomUUID()}-${file.name}`
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
    const path = `${campaignId}/${crypto.randomUUID()}-${file.name}`
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
      templates: (data ?? []).map((t) => ({
        id: String(t.id),
        campaignId: String(t.campaign_id),
        mapId: String(t.map_id),
        name: String(t.name),
        monsters: t.monsters_json ?? [],
        characters: t.characters_json ?? [],
      })),
    }
  },

  async saveTemplate(campaignId, body) {
    const payload = {
      name: body.name,
      map_id: body.mapId,
      monsters_json: body.monsters ?? [],
      characters_json: body.characters ?? [],
    }
    if (body.id) {
      const { error } = await db().from('encounter_templates').update(payload).eq('id', body.id)
      if (error && /characters_json/.test(error.message)) {
        const { error: retry } = await db()
          .from('encounter_templates')
          .update({ name: body.name, map_id: body.mapId, monsters_json: body.monsters ?? [] })
          .eq('id', body.id)
        throwIf(retry)
        return {}
      }
      throwIf(error)
      return {}
    }
    const { data, error } = await db().from('encounter_templates').insert({ campaign_id: campaignId, ...payload }).select().single()
    if (error && /characters_json/.test(error.message)) {
      const { data: retry, error: retryErr } = await db()
        .from('encounter_templates')
        .insert({ campaign_id: campaignId, map_id: body.mapId, name: body.name, monsters_json: body.monsters ?? [] })
        .select()
        .single()
      throwIf(retryErr)
      return {
        template: {
          id: String(retry.id),
          campaignId,
          mapId: String(retry.map_id),
          name: String(retry.name),
          monsters: retry.monsters_json ?? [],
          characters: [],
        },
      }
    }
    throwIf(error)
    return {
      template: {
        id: String(data.id),
        campaignId,
        mapId: String(data.map_id),
        name: String(data.name),
        monsters: data.monsters_json ?? [],
        characters: data.characters_json ?? [],
      },
    }
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
      instances: (data ?? []).map((i) => ({
        id: String(i.id),
        campaignId: String(i.campaign_id),
        encounterTemplateId: i.encounter_template_id ? String(i.encounter_template_id) : null,
        name: String(i.name),
        status: i.status as 'active' | 'paused' | 'completed',
        roundNumber: Number(i.round_number),
        currentTurnPosition: Number(i.current_turn_position),
        fogState: i.fog_state as FogState,
        mapId: i.map_id ? String(i.map_id) : null,
      })),
    }
  },

  async startInstance(campaignId, templateId, name) {
    const { data: template, error: tErr } = await db().from('encounter_templates').select('*').eq('id', templateId).single()
    throwIf(tErr)
    const { data: map, error: mErr } = await db().from('maps').select('*').eq('id', template.map_id).single()
    throwIf(mErr)
    const fog: FogState = {
      cols: Number(map.grid_cols),
      rows: Number(map.grid_rows),
      enabled: false,
      revealed: Array.from({ length: Number(map.grid_cols) * Number(map.grid_rows) }, () => 1),
    }
    const { data: inst, error: iErr } = await db()
      .from('encounter_instances')
      .insert({
        campaign_id: campaignId,
        encounter_template_id: templateId,
        name: name || template.name,
        status: 'active',
        round_number: 1,
        current_turn_position: 0,
        fog_state: fog,
        map_id: map.id,
      })
      .select()
      .single()
    throwIf(iErr)
    const specs = (template.monsters_json ?? []) as {
      bestiaryMonsterId: string
      name: string
      quantity: number
      startX: number
      startY: number
      color: string
      positions?: { x: number; y: number }[]
    }[]
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
    const starters = (template.characters_json ?? []) as { characterId: string; startX: number; startY: number }[]
    for (const spec of starters) {
      await insertCharacterCombatant(String(inst.id), spec.characterId, spec.startX, spec.startY, order++)
    }
    return { instanceId: String(inst.id) }
  },

  async setStatus(id, status) {
    const { error } = await db().from('encounter_instances').update({ status }).eq('id', id)
    throwIf(error)
    return {}
  },

  async openSession(campaignId, encounterInstanceId) {
    await db().from('live_sessions').delete().eq('campaign_id', campaignId)
    if (encounterInstanceId) {
      await db().from('encounter_instances').update({ status: 'active' }).eq('id', encounterInstanceId)
    }
    const code = joinCode()
    const { data, error } = await db()
      .from('live_sessions')
      .insert({ join_code: code, campaign_id: campaignId, encounter_instance_id: encounterInstanceId })
      .select()
      .single()
    throwIf(error)
    return { session: { joinCode: String(data.join_code) } }
  },

  async peekJoin(code) {
    const { data, error } = await db().rpc('peek_join', { p_join: code })
    throwIf(error)
    return data as { campaignName: string; joinCode: string }
  },

  async join(code, personal) {
    await db().auth.signOut()
    const { data: anon, error: anonErr } = await db().auth.signInAnonymously()
    if (anonErr) {
      throw new Error('Anonymous sign-in is off. In Supabase: Authentication → Providers → Anonymous → Enable.')
    }
    const { data, error } = await db().rpc('join_table', { p_join: code, p_personal: personal })
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
    const { data: campaign, error: cErr } = await db().from('campaigns').select('*').eq('id', campaignId).single()
    throwIf(cErr)
    const { data: session } = await db()
      .from('live_sessions')
      .select('*')
      .eq('campaign_id', campaignId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const instanceId = session?.encounter_instance_id as string | undefined
    const { data: instance } = instanceId
      ? await db().from('encounter_instances').select('*').eq('id', instanceId).maybeSingle()
      : { data: null }
    const { data: map } = instance?.map_id ? await db().from('maps').select('*').eq('id', instance.map_id).maybeSingle() : { data: null }
    const { data: combatants } = instanceId
      ? await db().from('combatants').select('*').eq('encounter_instance_id', instanceId).order('turn_order_position')
      : { data: [] }
    const { data: tokens } = instanceId ? await db().from('tokens_on_map').select('*').eq('encounter_instance_id', instanceId) : { data: [] }
    const { data: characters } = await db().from('player_characters').select('*').eq('campaign_id', campaignId)
    const chars = await hideCodes(campaignId, (characters ?? []).map((r) => characterFromRow(r as Record<string, unknown>)))
    return {
      campaign: { id: String(campaign.id), dmAccountId: String(campaign.dm_account_id), name: String(campaign.name) },
      session: session
        ? {
            id: String(session.id),
            joinCode: String(session.join_code),
            campaignId: String(session.campaign_id),
            encounterInstanceId: session.encounter_instance_id ? String(session.encounter_instance_id) : null,
          }
        : null,
      instance: instance
        ? {
            id: String(instance.id),
            campaignId: String(instance.campaign_id),
            encounterTemplateId: instance.encounter_template_id ? String(instance.encounter_template_id) : null,
            name: String(instance.name),
            status: instance.status,
            roundNumber: Number(instance.round_number),
            currentTurnPosition: Number(instance.current_turn_position),
            fogState: instance.fog_state as FogState,
            mapId: instance.map_id ? String(instance.map_id) : null,
          }
        : null,
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
        advantageAgainst: Array.isArray((c as { advantage_against_json?: string[] }).advantage_against_json)
          ? ((c as { advantage_against_json: string[] }).advantage_against_json)
          : [],
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
    }
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
    return {}
  },

  async nextTurn(id) {
    const { data: inst, error } = await db().from('encounter_instances').select('*').eq('id', id).single()
    throwIf(error)
    const { count } = await db().from('combatants').select('id', { count: 'exact', head: true }).eq('encounter_instance_id', id)
    const n = count ?? 0
    if (n === 0) return {}
    let pos = Number(inst.current_turn_position) + 1
    let round = Number(inst.round_number)
    if (pos >= n) {
      pos = 0
      round += 1
    }
    const { error: uErr } = await db().from('encounter_instances').update({ current_turn_position: pos, round_number: round }).eq('id', id)
    throwIf(uErr)
    return {}
  },

  async sortInit(id) {
    const { data, error } = await db().from('combatants').select('id, initiative').eq('encounter_instance_id', id)
    throwIf(error)
    const rows = [...(data ?? [])].sort((a, b) => Number(b.initiative) - Number(a.initiative))
    await Promise.all(rows.map((r, i) => db().from('combatants').update({ turn_order_position: i }).eq('id', r.id)))
    await db().from('encounter_instances').update({ current_turn_position: 0 }).eq('id', id)
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
      const { data: inst } = await db().from('encounter_instances').select('map_id').eq('id', token.encounter_instance_id).maybeSingle()
      if (inst?.map_id) {
        const { data: map } = await db().from('maps').select('*').eq('id', inst.map_id).maybeSingle()
        if (map) {
          const battle = mapFromRow(map as Record<string, unknown>)
          const { col, row } = pixelToCell(Number(body.x), Number(body.y), battle.gridSize)
          if (tokenOccupiesBlocked(battle.blocked, col, row, battle.gridCols, battle.gridRows, Number(token.size_squares ?? 1))) {
            throw new Error('That square is blocked')
          }
        }
      }
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
    const { data, error } = await db().rpc('resolve_player_attack', {
      p_instance: instanceId,
      p_target: body.targetId,
      p_attack_index: body.attackIndex,
      p_d20: body.d20,
      p_damage: body.damage,
      p_attacker: body.attackerId ?? null,
    })
    throwIf(error)
    return data as {
      hit: boolean
      crit: boolean
      fumble: boolean
      hadAdvantage: boolean
      total: number
      ac: number
      damage: number
      hpCurrent: number
      hpTemp: number
      targetName: string
      message: string
    }
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
