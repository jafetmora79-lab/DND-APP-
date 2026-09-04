import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { WebSocketServer, type WebSocket } from 'ws'
import { sessionFromRow } from '../src/lib/session.ts'
import { clampMovementRemaining, combatantStatsFromMonster, parseDeathState, parseSpeedFeet, parseTurnEconomy, snapshotForPlayer, statsForLiveCombatant } from '../src/lib/combat.ts'
import { parseActivity, parsePrompt } from '../src/lib/combat-activity.ts'
import { emptySheet, type AuthUser, type EncounterSnapshot, type FogState, type NamedEntry } from '../src/lib/types.ts'
import { matchJoinName } from '../src/lib/join-name.ts'
import {
    clampGridDim,
    clampGridSize,
    DEFAULT_SCRATCH_CELL,
    parseBlockedCells,
    pixelToCell,
    remapBlocked,
    spreadCells,
    tokenOccupiesBlocked,
    walkablePixel,
} from '../src/lib/utils.ts'
import { parseHub } from '../src/lib/campaign-hub.ts'
import { packTemplateBody, templateFromRow } from '../src/lib/template-json.ts'
import {
  addCharacterCombatant,
  applyFinishRewards,
  applyHubStageToLiveSession,
  characterFromRow,
  db,
  ids,
  insertMonster,
  jparse,
  mapFromDb,
  monsterFromRow,
  now,
  seedBestiaryForDm,
  spawnFromTemplate,
  resolvePlayerAttack,
  resolveCombatAttack,
  applyCombatDeathSave,
  resetCombatDeath,
  setCombatTurnEconomy,
  applyHpKnockout,
  consumeTurnMovement,
  appendInstanceActivity,
  applyDeclaredAction,
  applyHideResult,
  revealHidingIfSeen,
  instanceActivity,
  setInstancePrompt,
  resolvePromptSave,
  advanceInstanceTurn,
  beginInstanceRound,
  removeCombatantFromFight,
  setCombatantInitiativeFromD20,
  sortInstanceInitiative,
} from './db.ts'
import { parseCharacterPdf } from './pdf.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const uploadDir = path.join(root, 'uploads')
fs.mkdirSync(uploadDir, { recursive: true })

const app = express()
app.use(cors())
app.use(express.json({ limit: '12mb' }))
app.use('/uploads', express.static(uploadDir))
app.use('/maps', express.static(path.join(root, 'public', 'maps')))

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.bin'
    cb(null, `${ids.id()}${ext}`)
  },
})
const upload = multer({
  storage,
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/image\/(png|jpeg|webp|gif|svg\+xml)|application\/pdf/.test(file.mimetype) || file.originalname.endsWith('.svg')) {
      cb(null, true)
    } else cb(new Error('Unsupported file type'))
  },
})

type Sock = WebSocket & { campaignId?: string; role?: string; characterId?: string }

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function authOf(req: express.Request): AuthUser | null {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : (req.query.token as string | undefined)
  if (!token) return null
  const row = db.prepare('SELECT * FROM auth_tokens WHERE token = ?').get(token) as Record<string, unknown> | undefined
  if (!row) return null
  if (row.role === 'dm') return { role: 'dm', id: row.dm_id as string, name: '' }
  return {
    role: 'player',
    id: row.character_id as string,
    characterId: row.character_id as string,
    campaignId: row.campaign_id as string,
    name: '',
  }
}

function requireDm(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = authOf(req)
  if (!user || user.role !== 'dm') {
    res.status(401).json({ error: 'Dungeon Master sign-in required' })
    return
  }
  ;(req as express.Request & { user: AuthUser }).user = user
  next()
}

function requireUser(req: express.Request, res: express.Response, next: express.NextFunction) {
  const user = authOf(req)
  if (!user) {
    res.status(401).json({ error: 'Sign-in required' })
    return
  }
  ;(req as express.Request & { user: AuthUser }).user = user
  next()
}

function userOf(req: express.Request) {
  return (req as express.Request & { user: AuthUser }).user
}

function param(req: express.Request, key: string) {
  const v = req.params[key]
  return Array.isArray(v) ? (v[0] ?? '') : (v ?? '')
}

function campaignOwned(campaignId: string, dmId: string) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ? AND dm_account_id = ?').get(campaignId, dmId) as Record<string, unknown> | undefined
}

function instanceRow(id: string) {
  return db.prepare('SELECT * FROM encounter_instances WHERE id = ?').get(id) as Record<string, unknown> | undefined
}

function snapshot(campaignId: string) {
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(campaignId) as Record<string, unknown> | undefined
  if (!campaign) return null
  const session = db
    .prepare('SELECT * FROM live_sessions WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(campaignId) as Record<string, unknown> | undefined
  const instanceId = (session?.encounter_instance_id as string | undefined) || null
  const instance = instanceId ? instanceRow(instanceId) : null
  const map = instance?.map_id ? (db.prepare('SELECT * FROM maps WHERE id = ?').get(instance.map_id) as Record<string, unknown>) : null
  const combatants = instanceId
    ? (db.prepare('SELECT * FROM combatants WHERE encounter_instance_id = ? ORDER BY turn_order_position').all(instanceId) as Record<string, unknown>[])
    : []
  const missingBestiaryIds = [
    ...new Set(
      combatants
        .filter((c) => c.source === 'bestiary')
        .map((c) => String(c.source_id ?? ''))
        .filter(Boolean),
    ),
  ]
  const bestiaryById = new Map<string, Record<string, unknown>>()
  if (missingBestiaryIds.length) {
    const placeholders = missingBestiaryIds.map(() => '?').join(',')
    const rows = db
      .prepare(`SELECT * FROM bestiary_monsters WHERE id IN (${placeholders})`)
      .all(...missingBestiaryIds) as Record<string, unknown>[]
    for (const m of rows) bestiaryById.set(String(m.id), m)
  }
  const tokens = instanceId
    ? (db.prepare('SELECT * FROM tokens_on_map WHERE encounter_instance_id = ?').all(instanceId) as Record<string, unknown>[])
    : []
  const characters = db.prepare('SELECT * FROM player_characters WHERE campaign_id = ?').all(campaignId) as Record<string, unknown>[]
  return {
    campaign: {
      id: campaign.id,
      dmAccountId: campaign.dm_account_id,
      name: campaign.name,
      hub: parseHub(jparse((campaign.hub_json as string) || '{}', {})),
    },
    session: session ? sessionFromRow(session) : null,
    instance: instance
      ? {
          id: instance.id,
          campaignId: instance.campaign_id,
          encounterTemplateId: instance.encounter_template_id,
          name: instance.name,
          status: instance.status,
          roundNumber: instance.round_number,
          currentTurnPosition: instance.current_turn_position,
          fogState: jparse<FogState>(instance.fog_state as string, { cols: 20, rows: 15, enabled: false, revealed: [] }),
          mapId: instance.map_id,
          activity: parseActivity(jparse((instance.activity_json as string) || '[]', [])),
          prompt: parsePrompt(instance.prompt_json ? jparse(instance.prompt_json as string, null) : null),
        }
      : null,
    map: map ? mapFromDb(map) : null,
    combatants: combatants.map((c) => ({
      id: c.id,
      encounterInstanceId: c.encounter_instance_id,
      name: c.name,
      source: c.source,
      sourceId: c.source_id,
      initiative: c.initiative,
      hpCurrent: c.hp_current,
      hpMax: c.hp_max,
      hpTemp: c.hp_temp,
      ac: c.ac,
      conditions: jparse<string[]>(c.conditions_json as string, []),
      turnOrderPosition: c.turn_order_position,
      color: c.color,
      notes: c.notes,
      constitution: Number(c.constitution ?? 10),
      stats: statsForLiveCombatant(c, c.source === 'bestiary' ? bestiaryById.get(String(c.source_id ?? '')) : null),
      advantageAgainst: jparse<string[]>((c.advantage_against_json as string) || '[]', []),
      deathState: parseDeathState(c.death_state),
      deathSuccess: Number(c.death_success ?? 0),
      deathFail: Number(c.death_fail ?? 0),
      turnEconomy: parseTurnEconomy(jparse((c.turn_economy_json as string) || '{}', {})),
      speedFeet: parseSpeedFeet(c.speed_feet ?? 30),
      movementRemaining: Number.isFinite(Number(c.movement_remaining)) ? Math.max(0, Number(c.movement_remaining)) : parseSpeedFeet(c.speed_feet ?? 30),
    })),
    tokens: tokens.map((t) => ({
      id: t.id,
      encounterInstanceId: t.encounter_instance_id,
      x: t.x,
      y: t.y,
      refType: t.ref_type,
      refId: t.ref_id,
      label: t.label,
      color: t.color,
      sizeSquares: t.size_squares,
      visibleToPlayers: Boolean(t.visible_to_players),
    })),
    characters: characters.map((c) => characterFromRow(c)),
    monsters: [...bestiaryById.values()].map(monsterFromRow),
  }
}

function pushCampaign(campaignId: string) {
  const snap = snapshot(campaignId)
  if (!snap) return
  for (const client of wss.clients) {
    const c = client as Sock
    if (c.readyState !== 1 || c.campaignId !== campaignId) continue
    const payload = c.role === 'player' ? snapshotForPlayer(snap as EncounterSnapshot, c.characterId) : snap
    c.send(JSON.stringify({ type: 'snapshot', payload }))
  }
}

app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.post('/api/auth/register', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const passcode = String(req.body?.passcode ?? '')
  if (name.length < 2 || passcode.length < 4) {
    res.status(400).json({ error: 'Table name (2+) and passcode (4+) required' })
    return
  }
  const exists = db.prepare('SELECT id FROM dm_accounts WHERE name = ? COLLATE NOCASE').get(name)
  if (exists) {
    res.status(409).json({ error: 'That table name is already claimed' })
    return
  }
  const id = ids.id()
  db.prepare('INSERT INTO dm_accounts (id, name, passcode_hash, created_at) VALUES (?,?,?,?)').run(id, name, bcrypt.hashSync(passcode, 10), now())
  seedBestiaryForDm(id)
  const token = ids.token()
  db.prepare('INSERT INTO auth_tokens (token, role, dm_id, created_at) VALUES (?,?,?,?)').run(token, 'dm', id, now())
  res.json({ token, user: { role: 'dm', id, name } })
})

app.post('/api/auth/login', (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  const passcode = String(req.body?.passcode ?? '')
  const row = db.prepare('SELECT * FROM dm_accounts WHERE name = ? COLLATE NOCASE').get(name) as Record<string, unknown> | undefined
  if (!row || !bcrypt.compareSync(passcode, row.passcode_hash as string)) {
    res.status(401).json({ error: 'Unknown table or wrong passcode' })
    return
  }
  const token = ids.token()
  db.prepare('INSERT INTO auth_tokens (token, role, dm_id, created_at) VALUES (?,?,?,?)').run(token, 'dm', row.id, now())
  res.json({ token, user: { role: 'dm', id: row.id, name: row.name } })
})

app.get('/api/me', requireUser, (req, res) => {
  const user = userOf(req)
  if (user.role === 'dm') {
    const row = db.prepare('SELECT name FROM dm_accounts WHERE id = ?').get(user.id) as { name: string }
    res.json({ user: { ...user, name: row.name } })
    return
  }
  const ch = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(user.characterId) as Record<string, unknown>
  res.json({ user: { ...user, name: ch.name }, character: characterFromRow(ch) })
})

app.get('/api/campaigns', requireDm, (req, res) => {
  const rows = db.prepare('SELECT * FROM campaigns WHERE dm_account_id = ?').all(userOf(req).id)
  res.json({
    campaigns: rows.map((r) => {
      const row = r as { id: string; name: string; hub_json?: string }
      return { id: row.id, name: row.name, dmAccountId: userOf(req).id, hub: parseHub(jparse(row.hub_json || '{}', {})) }
    }),
  })
})

app.post('/api/campaigns', requireDm, (req, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!name) {
    res.status(400).json({ error: 'Campaign name required' })
    return
  }
  const id = ids.id()
  db.prepare('INSERT INTO campaigns (id, dm_account_id, name) VALUES (?,?,?)').run(id, userOf(req).id, name)
  res.json({ campaign: { id, name, dmAccountId: userOf(req).id } })
})

app.patch('/api/campaigns/:id', requireDm, (req, res) => {
  const row = campaignOwned(param(req, 'id'), userOf(req).id)
  if (!row) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  const name = String(req.body?.name ?? row.name)
  db.prepare('UPDATE campaigns SET name = ? WHERE id = ?').run(name, row.id)
  if (req.body.hub != null) {
    db.prepare('UPDATE campaigns SET hub_json = ? WHERE id = ?').run(JSON.stringify(parseHub(req.body.hub)), row.id)
  }
  pushCampaign(param(req, 'id'))
  const fresh = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.id) as { id: string; name: string; hub_json?: string }
  res.json({
    ok: true,
    campaign: { id: fresh.id, name: fresh.name, dmAccountId: userOf(req).id, hub: parseHub(jparse(fresh.hub_json || '{}', {})) },
  })
})

app.delete('/api/campaigns/:id', requireDm, (req, res) => {
  const row = campaignOwned(param(req, 'id'), userOf(req).id)
  if (!row) {
    res.status(404).json({ error: 'Campaign not found' })
    return
  }
  db.prepare('DELETE FROM campaigns WHERE id = ?').run(row.id)
  res.json({ ok: true })
})

app.get('/api/bestiary', requireDm, (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase()
  let rows = db.prepare('SELECT * FROM bestiary_monsters WHERE dm_account_id = ? ORDER BY name').all(userOf(req).id) as Record<string, unknown>[]
  if (q) rows = rows.filter((r) => String(r.name).toLowerCase().includes(q) || String(r.creature_type).toLowerCase().includes(q))
  res.json({ monsters: rows.map(monsterFromRow) })
})

app.get('/api/bestiary/:id', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM bestiary_monsters WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  res.json({ monster: monsterFromRow(row) })
})

app.post('/api/bestiary', requireDm, (req, res) => {
  const b = req.body ?? {}
  const id = ids.id()
  const monster = {
    id,
    name: String(b.name || 'Unnamed'),
    size: String(b.size || 'Medium'),
    creatureType: String(b.creatureType || 'humanoid'),
    alignment: String(b.alignment || 'unaligned'),
    acValue: Number(b.acValue ?? 10),
    acNote: String(b.acNote || ''),
    hpMax: Number(b.hpMax ?? 10),
    hitDiceFormula: String(b.hitDiceFormula || ''),
    speed: String(b.speed || '30 ft.'),
    str: Number(b.str ?? 10),
    dex: Number(b.dex ?? 10),
    con: Number(b.con ?? 10),
    int: Number(b.int ?? 10),
    wis: Number(b.wis ?? 10),
    cha: Number(b.cha ?? 10),
    savingThrows: String(b.savingThrows || ''),
    skills: String(b.skills || ''),
    damageVulnerabilities: String(b.damageVulnerabilities || ''),
    damageResistances: String(b.damageResistances || ''),
    damageImmunities: String(b.damageImmunities || ''),
    conditionImmunities: String(b.conditionImmunities || ''),
    senses: String(b.senses || ''),
    languages: String(b.languages || ''),
    challengeRating: Number(b.challengeRating ?? 0),
    xp: Number(b.xp ?? 0),
    proficiencyBonus: Number(b.proficiencyBonus ?? 2),
    attacksPerAction: Math.max(1, Number(b.attacksPerAction) || 1),
    traits: (b.traits ?? []) as NamedEntry[],
    actions: (b.actions ?? []) as NamedEntry[],
    legendaryActions: (b.legendaryActions ?? []) as NamedEntry[],
    reactions: (b.reactions ?? []) as NamedEntry[],
    bonusActions: (b.bonusActions ?? []) as NamedEntry[],
    lairActions: (b.lairActions ?? []) as NamedEntry[],
    source: 'custom' as const,
  }
  insertMonster(userOf(req).id, monster)
  res.json({ monster: { ...monster, dmAccountId: userOf(req).id } })
})

app.patch('/api/bestiary/:id', requireDm, (req, res) => {
  const row = db.prepare('SELECT * FROM bestiary_monsters WHERE id = ? AND dm_account_id = ?').get(param(req, 'id'), userOf(req).id) as
    | Record<string, unknown>
    | undefined
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const cur = monsterFromRow(row)
  const m = { ...cur, ...req.body }
  db.prepare(
    `UPDATE bestiary_monsters SET name=?, size=?, creature_type=?, alignment=?, ac_value=?, ac_note=?, hp_max=?, hit_dice_formula=?, speed=?,
     str=?, dex=?, con=?, int=?, wis=?, cha=?, saving_throws=?, skills=?, damage_vulnerabilities=?, damage_resistances=?, damage_immunities=?,
     condition_immunities=?, senses=?, languages=?, challenge_rating=?, xp=?, proficiency_bonus=?, attacks_per_action=?, traits=?, actions=?,
     legendary_actions=?, reactions=?, bonus_actions=?, lair_actions=? WHERE id=?`,
  ).run(
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
    Math.max(1, Number(m.attacksPerAction) || 1),
    JSON.stringify(m.traits ?? []),
    JSON.stringify(m.actions ?? []),
    JSON.stringify(m.legendaryActions ?? []),
    JSON.stringify(m.reactions ?? []),
    JSON.stringify(m.bonusActions ?? []),
    JSON.stringify(m.lairActions ?? []),
    m.id,
  )
  res.json({ ok: true })
})

app.delete('/api/bestiary/:id', requireDm, (req, res) => {
  db.prepare('DELETE FROM bestiary_monsters WHERE id = ? AND dm_account_id = ?').run(param(req, 'id'), userOf(req).id)
  res.json({ ok: true })
})

app.post('/api/bestiary/:id/portrait', requireDm, upload.single('image'), (req, res) => {
  const row = db.prepare('SELECT * FROM bestiary_monsters WHERE id = ? AND dm_account_id = ?').get(param(req, 'id'), userOf(req).id) as
    | Record<string, unknown>
    | undefined
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'Image required' })
    return
  }
  const portraitUrl = `/uploads/${req.file.filename}`
  db.prepare('UPDATE bestiary_monsters SET portrait_url = ? WHERE id = ?').run(portraitUrl, row.id)
  res.json({ monster: monsterFromRow({ ...row, portrait_url: portraitUrl }) })
})

app.get('/api/campaigns/:id/maps', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const rows = db.prepare('SELECT * FROM maps WHERE campaign_id = ?').all(param(req, 'id')) as Record<string, unknown>[]
  res.json({ maps: rows.map((m) => mapFromDb(m)) })
})

app.post('/api/campaigns/:id/maps', requireDm, upload.single('image'), (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const name = String(req.body?.name || req.file?.originalname || 'Untitled map')
  const imageUrl = req.file ? `/uploads/${req.file.filename}` : String(req.body?.imageUrl || '')
  const gridSize = clampGridSize(req.body?.gridSize, req.file ? 70 : DEFAULT_SCRATCH_CELL)
  const gridCols = clampGridDim(req.body?.gridCols, 20)
  const gridRows = clampGridDim(req.body?.gridRows, 15)
  const blocked = parseBlockedCells(req.body?.blocked, gridCols, gridRows)
  const id = ids.id()
  db.prepare(
    'INSERT INTO maps (id, campaign_id, name, image_url, grid_size, grid_cols, grid_rows, grid_type, blocked_cells) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(id, param(req, 'id'), name, imageUrl, gridSize, gridCols, gridRows, 'square', JSON.stringify(blocked))
  res.json({
    map: mapFromDb({
      id,
      campaign_id: param(req, 'id'),
      name,
      image_url: imageUrl,
      grid_size: gridSize,
      grid_cols: gridCols,
      grid_rows: gridRows,
      blocked_cells: JSON.stringify(blocked),
    }),
  })
})

app.patch('/api/maps/:id', requireDm, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!map || !campaignOwned(map.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const oldCols = Number(map.grid_cols)
  const oldRows = Number(map.grid_rows)
  const gridCols = clampGridDim(req.body.gridCols ?? oldCols, oldCols)
  const gridRows = clampGridDim(req.body.gridRows ?? oldRows, oldRows)
  const gridSize = clampGridSize(req.body.gridSize ?? map.grid_size, Number(map.grid_size))
  const imageUrl = req.body.imageUrl != null ? String(req.body.imageUrl) : String(map.image_url ?? '')
  const blocked =
    req.body.blocked != null
      ? parseBlockedCells(req.body.blocked, gridCols, gridRows)
      : remapBlocked(parseBlockedCells(map.blocked_cells, oldCols, oldRows), oldCols, oldRows, gridCols, gridRows)
  const bgScale = req.body.bgScale != null ? (Number(req.body.bgScale) > 0 ? Number(req.body.bgScale) : null) : (map.bg_scale ?? null)
  const bgOffsetX = req.body.bgOffsetX != null ? Number(req.body.bgOffsetX) : Number(map.bg_offset_x ?? 0)
  const bgOffsetY = req.body.bgOffsetY != null ? Number(req.body.bgOffsetY) : Number(map.bg_offset_y ?? 0)
  db.prepare(
    'UPDATE maps SET name=?, image_url=?, grid_size=?, grid_cols=?, grid_rows=?, blocked_cells=?, bg_scale=?, bg_offset_x=?, bg_offset_y=? WHERE id=?',
  ).run(req.body.name ?? map.name, imageUrl, gridSize, gridCols, gridRows, JSON.stringify(blocked), bgScale, bgOffsetX, bgOffsetY, map.id)
  res.json({
    map: mapFromDb({
      ...map,
      name: req.body.name ?? map.name,
      image_url: imageUrl,
      grid_size: gridSize,
      grid_cols: gridCols,
      grid_rows: gridRows,
      blocked_cells: JSON.stringify(blocked),
      bg_scale: bgScale,
      bg_offset_x: bgOffsetX,
      bg_offset_y: bgOffsetY,
    }),
  })
})

app.post('/api/maps/:id/image', requireDm, upload.single('image'), (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!map || !campaignOwned(map.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'Background image required' })
    return
  }
  const imageUrl = `/uploads/${req.file.filename}`
  db.prepare('UPDATE maps SET image_url=? WHERE id=?').run(imageUrl, map.id)
  res.json({ map: mapFromDb({ ...map, image_url: imageUrl }) })
})

app.delete('/api/maps/:id', requireDm, (req, res) => {
  const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!map || !campaignOwned(map.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare('DELETE FROM maps WHERE id = ?').run(map.id)
  res.json({ ok: true })
})

app.get('/api/campaigns/:id/characters', requireUser, (req, res) => {
  const user = userOf(req)
  if (user.role === 'dm' && !campaignOwned(param(req, 'id'), user.id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (user.role === 'player' && user.campaignId !== param(req, 'id')) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const rows = db.prepare('SELECT * FROM player_characters WHERE campaign_id = ?').all(param(req, 'id')) as Record<string, unknown>[]
  const list = rows.map(characterFromRow)
  if (user.role === 'player') {
    res.json({
      characters: list.map((c) => (c.id === user.characterId ? c : { ...c, personalCode: '••••••••' })),
    })
    return
  }
  res.json({ characters: list })
})

app.post('/api/campaigns/:id/characters', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const id = ids.id()
  const code = ids.personal()
  const incoming = (req.body?.sheet ?? {}) as Record<string, unknown>
  const sheet = { ...emptySheet(), ...incoming }
  const name = String(req.body?.name || sheet.className || 'New adventurer')
  db.prepare(
    `INSERT INTO player_characters (id, campaign_id, personal_code, owner_display_name, name, token_color, source_pdf_url, sheet_json)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    param(req, 'id'),
    code,
    String(req.body?.ownerDisplayName || ''),
    name,
    String(req.body?.tokenColor || '#6ea8c9'),
    null,
    JSON.stringify(sheet),
  )
  const row = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(id) as Record<string, unknown>
  res.json({ character: characterFromRow(row) })
})

app.patch('/api/characters/:id', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const user = userOf(req)
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.campaign_id) as Record<string, unknown>
  const isDm = user.role === 'dm' && user.id === campaign.dm_account_id
  const isOwner = user.role === 'player' && user.characterId === row.id
  if (!isDm && !isOwner) {
    res.status(403).json({ error: 'Only the owner or the DM can edit this sheet' })
    return
  }
  const cur = characterFromRow(row)
  const next = {
    ...cur,
    name: req.body.name ?? cur.name,
    ownerDisplayName: req.body.ownerDisplayName ?? cur.ownerDisplayName,
    tokenColor: req.body.tokenColor ?? cur.tokenColor,
    sheet: req.body.sheet ? { ...cur.sheet, ...req.body.sheet } : cur.sheet,
  }
  db.prepare('UPDATE player_characters SET name=?, owner_display_name=?, token_color=?, sheet_json=? WHERE id=?').run(
    next.name,
    next.ownerDisplayName,
    next.tokenColor,
    JSON.stringify(next.sheet),
    cur.id,
  )
  if (req.body.sheet?.hpCurrent != null || req.body.sheet?.hpMax != null || req.body.sheet?.ac != null) {
    db.prepare(
      `UPDATE combatants SET hp_current = COALESCE(?, hp_current), hp_max = COALESCE(?, hp_max), ac = COALESCE(?, ac)
       WHERE source = 'character' AND source_id = ?`,
    ).run(req.body.sheet?.hpCurrent ?? null, req.body.sheet?.hpMax ?? null, req.body.sheet?.ac ?? null, cur.id)
  }
  pushCampaign(cur.campaignId)
  res.json({ character: next })
})

app.post('/api/characters/:id/regenerate-code', requireDm, (req, res) => {
  const row = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!row || !campaignOwned(row.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const code = ids.personal()
  db.prepare('UPDATE player_characters SET personal_code = ? WHERE id = ?').run(code, row.id)
  res.json({ personalCode: code })
})

app.post('/api/characters/:id/import-pdf', requireUser, upload.single('pdf'), async (req, res) => {
  const row = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const user = userOf(req)
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.campaign_id) as Record<string, unknown>
  const isDm = user.role === 'dm' && user.id === campaign.dm_account_id
  const isOwner = user.role === 'player' && user.characterId === row.id
  if (!isDm && !isOwner) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'PDF required' })
    return
  }
  try {
    const parsed = await parseCharacterPdf(fs.readFileSync(req.file.path))
    const cur = characterFromRow(row)
    const name = parsed.characterName || cur.name
    const owner = parsed.playerName || cur.ownerDisplayName
    const url = `/uploads/${req.file.filename}`
    db.prepare('UPDATE player_characters SET name=?, owner_display_name=?, source_pdf_url=?, sheet_json=? WHERE id=?').run(
      name,
      owner,
      url,
      JSON.stringify({ ...cur.sheet, ...parsed.sheet }),
      cur.id,
    )
    pushCampaign(cur.campaignId)
    res.json({
      character: { ...cur, name, ownerDisplayName: owner, sourcePdfUrl: url, sheet: { ...cur.sheet, ...parsed.sheet } },
      fieldCount: parsed.fieldCount,
    })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not read that PDF' })
  }
})

app.post('/api/characters/:id/portrait', requireUser, upload.single('image'), (req, res) => {
  const row = db.prepare('SELECT * FROM player_characters WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!row) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const user = userOf(req)
  const campaign = db.prepare('SELECT * FROM campaigns WHERE id = ?').get(row.campaign_id) as Record<string, unknown>
  const isDm = user.role === 'dm' && user.id === campaign.dm_account_id
  const isOwner = user.role === 'player' && user.characterId === row.id
  if (!isDm && !isOwner) {
    res.status(403).json({ error: 'Only the owner or the DM can set this portrait' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'Image required' })
    return
  }
  const portraitUrl = `/uploads/${req.file.filename}`
  db.prepare('UPDATE player_characters SET portrait_url = ? WHERE id = ?').run(portraitUrl, row.id)
  const cur = characterFromRow({ ...row, portrait_url: portraitUrl })
  pushCampaign(cur.campaignId)
  res.json({ character: cur })
})

app.get('/api/campaigns/:id/templates', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const rows = db.prepare('SELECT * FROM encounter_templates WHERE campaign_id = ?').all(param(req, 'id')) as Record<string, unknown>[]
  res.json({
    templates: rows.map((t) => templateFromRow(t)),
  })
})

app.post('/api/campaigns/:id/templates', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const id = ids.id()
  const packedBody = packTemplateBody(req.body, true)
  db.prepare('INSERT INTO encounter_templates (id, campaign_id, map_id, name, monsters_json, characters_json) VALUES (?,?,?,?,?,?)').run(
    id,
    param(req, 'id'),
    req.body.mapId,
    String(req.body.name || 'Encounter'),
    JSON.stringify(packedBody.packed),
    JSON.stringify(packedBody.characters),
  )
  res.json({
    template: templateFromRow({
      id,
      campaign_id: param(req, 'id'),
      map_id: req.body.mapId,
      name: req.body.name,
      monsters_json: packedBody.packed,
      characters_json: packedBody.characters,
    }),
  })
})

app.patch('/api/templates/:id', requireDm, (req, res) => {
  const t = db.prepare('SELECT * FROM encounter_templates WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!t || !campaignOwned(t.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const existing = templateFromRow(t)
  const nextBrief = {
    notes: req.body.notes ?? existing.notes,
    objective: req.body.objective ?? existing.objective,
    difficulty: req.body.difficulty ?? existing.difficulty,
    xpAward: req.body.xpAward ?? existing.xpAward,
    lootNotes: req.body.lootNotes ?? existing.lootNotes,
    sortOrder: req.body.sortOrder ?? existing.sortOrder,
    chapter: req.body.chapter ?? existing.chapter,
    readAloud: req.body.readAloud ?? existing.readAloud,
    surpriseParty: req.body.surpriseParty ?? existing.surpriseParty,
    surpriseMonsters: req.body.surpriseMonsters ?? existing.surpriseMonsters,
    monsters: req.body.monsters ?? existing.monsters,
    characters: req.body.characters ?? existing.characters,
  }
  const saved = packTemplateBody(nextBrief, true)
  db.prepare('UPDATE encounter_templates SET name=?, map_id=?, monsters_json=?, characters_json=? WHERE id=?').run(
    req.body.name ?? t.name,
    req.body.mapId ?? t.map_id,
    JSON.stringify(saved.packed),
    JSON.stringify(saved.characters),
    t.id,
  )
  const row = db.prepare('SELECT * FROM encounter_templates WHERE id = ?').get(t.id) as Record<string, unknown>
  res.json({ template: templateFromRow(row) })
})

app.delete('/api/templates/:id', requireDm, (req, res) => {
  const t = db.prepare('SELECT * FROM encounter_templates WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!t || !campaignOwned(t.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare('DELETE FROM encounter_templates WHERE id = ?').run(t.id)
  res.json({ ok: true })
})

app.get('/api/campaigns/:id/instances', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const rows = db.prepare('SELECT * FROM encounter_instances WHERE campaign_id = ? ORDER BY rowid DESC').all(param(req, 'id')) as Record<
    string,
    unknown
  >[]
  res.json({
    instances: rows.map((i) => ({
      id: i.id,
      campaignId: i.campaign_id,
      encounterTemplateId: i.encounter_template_id,
      name: i.name,
      status: i.status,
      roundNumber: i.round_number,
      currentTurnPosition: i.current_turn_position,
      fogState: jparse<FogState>(i.fog_state as string, { cols: 20, rows: 15, enabled: false, revealed: [] }),
      mapId: i.map_id,
      activity: parseActivity(jparse((i.activity_json as string) || '[]', [])),
      prompt: parsePrompt(i.prompt_json ? jparse(i.prompt_json as string, null) : null),
    })),
  })
})

app.post('/api/campaigns/:id/instances', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const instanceId = spawnFromTemplate(param(req, 'id'), req.body.templateId, {
    name: req.body.name,
    fog: Boolean(req.body.fog),
    lighting: req.body.lighting,
    surpriseParty: Boolean(req.body.surpriseParty),
    surpriseMonsters: Boolean(req.body.surpriseMonsters),
  })
  res.json({ instanceId })
})

app.post('/api/instances/:id/status', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare('UPDATE encounter_instances SET status = ? WHERE id = ?').run(req.body.status, inst.id)
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

function liveSessionRow(campaignId: string) {
  return db.prepare('SELECT * FROM live_sessions WHERE campaign_id = ? ORDER BY created_at DESC LIMIT 1').get(campaignId) as
    | Record<string, unknown>
    | undefined
}

app.post('/api/campaigns/:id/session', requireDm, (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const rotate = Boolean(req.body?.rotateJoinCode)
  const ensure = Boolean(req.body?.ensure)
  const hasInstance = Object.prototype.hasOwnProperty.call(req.body ?? {}, 'encounterInstanceId')
  const encounterInstanceId = hasInstance ? req.body.encounterInstanceId || null : undefined
  let existing = liveSessionRow(campaignId)

  if (!existing) {
    const join = req.body.joinCode || ids.join()
    const id = ids.id()
    const inst = encounterInstanceId ?? null
    if (inst) db.prepare(`UPDATE encounter_instances SET status = 'active' WHERE id = ?`).run(inst)
    db.prepare(
      `INSERT INTO live_sessions (id, join_code, campaign_id, encounter_instance_id, created_at, table_phase, ambiance_image_url, ambiance_caption, last_outcome)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      join,
      campaignId,
      inst,
      now(),
      req.body?.tablePhase === 'setup' ? 'setup' : inst ? 'combat' : 'table',
      null,
      '',
      null,
    )
    if (!inst) applyHubStageToLiveSession(campaignId, '')
    pushCampaign(campaignId)
    existing = liveSessionRow(campaignId)
    res.json({ session: existing ? sessionFromRow(existing) : { id, joinCode: join, campaignId, encounterInstanceId: inst } })
    return
  }

  if (ensure && !rotate && encounterInstanceId === undefined) {
    if (!existing.encounter_instance_id && String(existing.table_phase ?? 'table') === 'table') {
      applyHubStageToLiveSession(campaignId, '')
      existing = liveSessionRow(campaignId) ?? existing
    }
    res.json({ session: sessionFromRow(existing) })
    return
  }

  const join = rotate ? req.body.joinCode || ids.join() : existing.join_code
  let inst = existing.encounter_instance_id
  let phase = existing.table_phase
  let lastOutcome = existing.last_outcome
  if (encounterInstanceId !== undefined) {
    inst = encounterInstanceId
    phase =
      req.body?.tablePhase === 'setup'
        ? 'setup'
        : req.body?.tablePhase === 'combat'
          ? 'combat'
          : encounterInstanceId
            ? 'combat'
            : 'table'
    lastOutcome = encounterInstanceId ? null : lastOutcome
    if (encounterInstanceId) {
      db.prepare(`UPDATE encounter_instances SET status = 'active' WHERE id = ?`).run(encounterInstanceId)
    }
  }
  db.prepare('UPDATE live_sessions SET join_code=?, encounter_instance_id=?, table_phase=?, last_outcome=? WHERE id=?').run(
    join,
    inst,
    phase,
    lastOutcome,
    existing.id,
  )
  pushCampaign(campaignId)
  const next = liveSessionRow(campaignId)
  res.json({ session: next ? sessionFromRow(next) : sessionFromRow({ ...existing, join_code: join }) })
})

app.patch('/api/campaigns/:id/session', requireDm, (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const existing = liveSessionRow(campaignId)
  if (!existing) {
    res.status(404).json({ error: 'No live session' })
    return
  }
  const caption = req.body?.ambianceCaption != null ? String(req.body.ambianceCaption) : existing.ambiance_caption
  const imageUrl =
    req.body?.ambianceImageUrl === undefined
      ? existing.ambiance_image_url
      : req.body.ambianceImageUrl
        ? String(req.body.ambianceImageUrl)
        : null
  const phase =
    req.body?.tablePhase === 'setup' ||
    req.body?.tablePhase === 'combat' ||
    req.body?.tablePhase === 'table' ||
    req.body?.tablePhase === 'victory' ||
    req.body?.tablePhase === 'defeat'
      ? req.body.tablePhase
      : existing.table_phase
  db.prepare('UPDATE live_sessions SET ambiance_caption=?, ambiance_image_url=?, table_phase=? WHERE id=?').run(
    caption,
    imageUrl,
    phase,
    existing.id,
  )
  pushCampaign(campaignId)
  const next = liveSessionRow(campaignId)
  res.json({ session: next ? sessionFromRow(next) : sessionFromRow(existing) })
})

app.post('/api/campaigns/:id/session/ambiance', requireDm, upload.single('image'), (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'Image required' })
    return
  }
  let existing = liveSessionRow(campaignId)
  if (!existing) {
    const id = ids.id()
    db.prepare(
      `INSERT INTO live_sessions (id, join_code, campaign_id, encounter_instance_id, created_at, table_phase, ambiance_image_url, ambiance_caption, last_outcome)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    ).run(id, ids.join(), campaignId, null, now(), 'table', null, '', null)
    existing = liveSessionRow(campaignId)
  }
  if (!existing) {
    res.status(500).json({ error: 'Could not open the table' })
    return
  }
  const imageUrl = `/uploads/${req.file.filename}`
  db.prepare('UPDATE live_sessions SET ambiance_image_url=? WHERE id=?').run(imageUrl, existing.id)
  pushCampaign(campaignId)
  const next = liveSessionRow(campaignId)
  res.json({ session: next ? sessionFromRow(next) : sessionFromRow(existing) })
})

app.post('/api/campaigns/:id/stage-image', requireDm, upload.single('image'), (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (!req.file) {
    res.status(400).json({ error: 'Image required' })
    return
  }
  res.json({ imageUrl: `/uploads/${req.file.filename}` })
})

app.post('/api/campaigns/:id/finish-encounter', requireDm, (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const outcome = req.body?.outcome === 'lost' ? 'lost' : req.body?.outcome === 'won' ? 'won' : null
  if (!outcome) {
    res.status(400).json({ error: 'Choose won or lost' })
    return
  }
  const existing = liveSessionRow(campaignId)
  if (!existing) {
    res.status(404).json({ error: 'No live session' })
    return
  }
  if (existing.encounter_instance_id) {
    const inst = db.prepare('SELECT status FROM encounter_instances WHERE id = ?').get(existing.encounter_instance_id) as
      | { status?: string }
      | undefined
    const firstFinish = inst?.status !== 'completed'
    db.prepare(`UPDATE encounter_instances SET status = 'completed' WHERE id = ?`).run(existing.encounter_instance_id)
    if (firstFinish) applyFinishRewards(campaignId, existing.encounter_instance_id, outcome, req.body?.lootHolder ? String(req.body.lootHolder) : undefined)
  }
  db.prepare('UPDATE live_sessions SET table_phase=?, last_outcome=? WHERE id=?').run(
    outcome === 'won' ? 'victory' : 'defeat',
    outcome,
    existing.id,
  )
  pushCampaign(campaignId)
  res.json({ ok: true })
})

app.post('/api/campaigns/:id/end-session', requireDm, (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare(`UPDATE encounter_instances SET status = 'paused' WHERE campaign_id = ? AND status = 'active'`).run(campaignId)
  db.prepare('DELETE FROM live_sessions WHERE campaign_id = ?').run(campaignId)
  pushCampaign(campaignId)
  res.json({ ok: true })
})

app.post('/api/campaigns/:id/return-to-table', requireDm, (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const existing = liveSessionRow(campaignId)
  if (!existing) {
    res.status(404).json({ error: 'No live session' })
    return
  }
  db.prepare('UPDATE live_sessions SET encounter_instance_id=NULL, table_phase=? WHERE id=?').run('table', existing.id)
  pushCampaign(campaignId)
  res.json({ ok: true })
})

app.post('/api/campaigns/:id/begin-round', requireDm, (req, res) => {
  const campaignId = param(req, 'id')
  if (!campaignOwned(campaignId, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const existing = liveSessionRow(campaignId)
  if (!existing?.encounter_instance_id) {
    res.status(400).json({ error: 'No fight on the table' })
    return
  }
  try {
    const result = beginInstanceRound(String(existing.encounter_instance_id))
    db.prepare('UPDATE live_sessions SET table_phase=? WHERE id=?').run('combat', existing.id)
    pushCampaign(campaignId)
    res.json({ ok: true, ...result })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not begin the round' })
  }
})

app.get('/api/join/:code', (req, res) => {
  const session = db.prepare('SELECT * FROM live_sessions WHERE join_code = ? COLLATE NOCASE').get(param(req, 'code')) as
    | Record<string, unknown>
    | undefined
  if (!session) {
    res.status(404).json({ error: 'No table is using that join code tonight' })
    return
  }
  const campaign = db.prepare('SELECT name FROM campaigns WHERE id = ?').get(session.campaign_id) as { name: string }
  res.json({ campaignName: campaign.name, joinCode: session.join_code })
})

app.post('/api/join/:code', (req, res) => {
  const session = db.prepare('SELECT * FROM live_sessions WHERE join_code = ? COLLATE NOCASE').get(param(req, 'code')) as
    | Record<string, unknown>
    | undefined
  if (!session) {
    res.status(404).json({ error: 'No table is using that join code tonight' })
    return
  }
  const needle = String(req.body?.playerName ?? req.body?.personalCode ?? '')
  const chars = db.prepare('SELECT * FROM player_characters WHERE campaign_id = ?').all(session.campaign_id) as Record<string, unknown>[]
  const hit = matchJoinName(
    chars.map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      personalCode: String(c.personal_code ?? ''),
    })),
    needle,
  )
  if (!hit.ok) {
    res.status(401).json({ error: hit.error })
    return
  }
  const ch = hit.character
  const token = ids.token()
  db.prepare('INSERT INTO auth_tokens (token, role, character_id, campaign_id, created_at) VALUES (?,?,?,?,?)').run(
    token,
    'player',
    ch.id,
    session.campaign_id,
    now(),
  )
  res.json({ token, user: { role: 'player', id: ch.id, characterId: ch.id, campaignId: session.campaign_id, name: ch.name } })
})

app.get('/api/campaigns/:id/live', requireUser, (req, res) => {
  const user = userOf(req)
  if (user.role === 'dm' && !campaignOwned(param(req, 'id'), user.id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (user.role === 'player' && user.campaignId !== param(req, 'id')) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  const snap = snapshot(param(req, 'id'))
  if (user.role === 'player' && snap) {
    res.json(snapshotForPlayer(snap as EncounterSnapshot, user.characterId))
    return
  }
  res.json(snap)
})

app.post('/api/instances/:id/combatants', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (req.body.characterId) {
    addCharacterCombatant(inst.id as string, req.body.characterId)
  } else if (req.body.bestiaryMonsterId) {
    const src = db.prepare('SELECT * FROM bestiary_monsters WHERE id = ?').get(req.body.bestiaryMonsterId) as Record<string, unknown>
    const maxPos = db.prepare('SELECT COALESCE(MAX(turn_order_position), -1) as m FROM combatants WHERE encounter_instance_id = ?').get(inst.id) as {
      m: number
    }
    const cid = ids.id()
      const qty = Math.max(1, Number(req.body.quantity ?? 1))
      const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(inst.map_id) as Record<string, unknown> | undefined
      const battle = map ? mapFromDb(map) : null
      const cell = battle?.gridSize ?? 70
      const existingTokens = db.prepare('SELECT x, y FROM tokens_on_map WHERE encounter_instance_id = ?').all(inst.id) as {
        x: number
        y: number
      }[]
      const occupied = new Set(existingTokens.map((t) => {
        const { col, row } = pixelToCell(t.x, t.y, cell)
        return `${col},${row}`
      }))
      const hasStart = Number.isFinite(Number(req.body.startCol)) && Number.isFinite(Number(req.body.startRow))
      const origin = hasStart
        ? { col: Number(req.body.startCol), row: Number(req.body.startRow) }
        : { col: battle ? Math.floor(battle.gridCols / 2) : 3, row: battle ? Math.floor(battle.gridRows / 2) : 3 }
      const cells = battle
        ? spreadCells(origin, qty, battle.gridCols, battle.gridRows, battle.blocked, occupied)
        : Array.from({ length: qty }, (_, i) => ({ col: origin.col + i, row: origin.row }))
      for (let i = 0; i < qty; i++) {
        const id = i === 0 ? cid : ids.id()
        const name = qty > 1 ? `${src.name} ${i + 1}` : String(src.name)
        const speedFeet = parseSpeedFeet(src.speed)
        db.prepare(
          `INSERT INTO combatants (id, encounter_instance_id, name, source, source_id, initiative, hp_current, hp_max, hp_temp, ac, conditions_json, turn_order_position, color, notes, constitution, stats_json, speed_feet, movement_remaining)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(
          id,
          inst.id,
          name,
          'bestiary',
          src.id,
          0,
          src.hp_max,
          src.hp_max,
          0,
          src.ac_value,
          '[]',
          maxPos.m + 1 + i,
          req.body.color || '#c4453c',
          '',
          Number(src.con ?? 10),
          JSON.stringify(combatantStatsFromMonster(src)),
          speedFeet,
          speedFeet,
        )
        const target = cells[i] ?? origin
        const pos = battle
          ? walkablePixel(battle, target.col, target.row)
          : { x: cell * target.col + cell / 2, y: cell * target.row + cell / 2 }
        db.prepare(
          `INSERT INTO tokens_on_map (id, encounter_instance_id, x, y, ref_type, ref_id, label, color, size_squares, visible_to_players)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(ids.id(), inst.id, pos.x, pos.y, 'combatant', id, name, req.body.color || '#c4453c', 1, 1)
      }
  }
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.post('/api/instances/:id/join-fight', requireUser, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  const user = userOf(req)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (user.role !== 'player' || user.campaignId !== inst.campaign_id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  try {
    addCharacterCombatant(String(inst.id), user.characterId)
    pushCampaign(inst.campaign_id as string)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not join the fight' })
  }
})

app.post('/api/instances/:id/player-attack', requireUser, (req, res) => {
  const user = userOf(req)
  const inst = instanceRow(param(req, 'id'))
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  try {
    const body = {
      instanceId: String(inst.id),
      targetId: String(req.body.targetId ?? ''),
      attackIndex: Number(req.body.attackIndex),
      d20: Number(req.body.d20),
      d20b: req.body.d20b == null || req.body.d20b === '' ? undefined : Number(req.body.d20b),
      rollMode: req.body.rollMode,
      damage: Number(req.body.damage),
      slot: req.body.slot,
    }
    let result
    if (user.role === 'player') {
      if (inst.campaign_id !== user.campaignId) {
        res.status(404).json({ error: 'Not found' })
        return
      }
      result = resolvePlayerAttack({ ...body, campaignId: user.campaignId, characterId: user.characterId })
    } else {
      if (!campaignOwned(inst.campaign_id as string, user.id)) {
        res.status(404).json({ error: 'Not found' })
        return
      }
      const attackerId = String(req.body.attackerId ?? '')
      if (!attackerId) throw new Error('Select the attacking creature first')
      result = resolveCombatAttack({ ...body, campaignId: inst.campaign_id as string, attackerId })
    }
    pushCampaign(inst.campaign_id as string)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Attack failed' })
  }
})

app.patch('/api/combatants/:id', requireDm, (req, res) => {
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!c) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = instanceRow(c.encounter_instance_id as string)
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const fields = ['name', 'initiative', 'hp_current', 'hp_max', 'hp_temp', 'ac', 'turn_order_position', 'color', 'notes'] as const
  const map: Record<string, string> = {
    hpCurrent: 'hp_current',
    hpMax: 'hp_max',
    hpTemp: 'hp_temp',
    turnOrderPosition: 'turn_order_position',
  }
  for (const [k, v] of Object.entries(req.body)) {
    if (k === 'conditions') {
      db.prepare('UPDATE combatants SET conditions_json = ? WHERE id = ?').run(JSON.stringify(v), c.id)
      continue
    }
    if (k === 'speedFeet') {
      const speed = parseSpeedFeet(v)
      db.prepare('UPDATE combatants SET speed_feet = ? WHERE id = ?').run(speed, c.id)
      continue
    }
    if (k === 'movementRemaining') {
      db.prepare('UPDATE combatants SET movement_remaining = ? WHERE id = ?').run(clampMovementRemaining(v), c.id)
      continue
    }
    if (k === 'deathState' || k === 'deathSuccess' || k === 'deathFail') {
      const col = k === 'deathState' ? 'death_state' : k === 'deathSuccess' ? 'death_success' : 'death_fail'
      db.prepare(`UPDATE combatants SET ${col} = ? WHERE id = ?`).run(v, c.id)
      continue
    }
    const col = map[k] ?? k
    if (fields.includes(col as (typeof fields)[number])) {
      db.prepare(`UPDATE combatants SET ${col} = ? WHERE id = ?`).run(v, c.id)
    }
  }
  if (c.source === 'character' && (req.body.hpCurrent != null || req.body.hpMax != null || req.body.deathSuccess != null || req.body.deathFail != null)) {
    const ch = db.prepare('SELECT sheet_json FROM player_characters WHERE id = ?').get(c.source_id) as { sheet_json: string } | undefined
    if (ch) {
      const sheet = jparse(ch.sheet_json, {} as Record<string, unknown>)
      if (req.body.hpCurrent != null) sheet.hpCurrent = req.body.hpCurrent
      if (req.body.hpMax != null) sheet.hpMax = req.body.hpMax
      if (req.body.deathSuccess != null) sheet.deathSuccess = req.body.deathSuccess
      if (req.body.deathFail != null) sheet.deathFail = req.body.deathFail
      db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(sheet), c.source_id)
    }
  }
  if (req.body.hpCurrent != null) {
    applyHpKnockout(String(c.id), Number(c.hp_current), Number(req.body.hpCurrent))
  }
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.delete('/api/combatants/:id', requireDm, (req, res) => {
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!c) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = instanceRow(c.encounter_instance_id as string)
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  removeCombatantFromFight(String(c.id))
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.post('/api/combatants/:id/initiative', requireUser, (req, res) => {
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!c) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = instanceRow(c.encounter_instance_id as string)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const user = userOf(req)
  const asDm = user.role === 'dm' && campaignOwned(inst.campaign_id as string, user.id)
  const asOwner = user.role === 'player' && c.source === 'character' && String(c.source_id) === user.characterId && inst.campaign_id === user.campaignId
  if (!asDm && !asOwner) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  try {
    const result = setCombatantInitiativeFromD20(String(c.id), Number(req.body.d20))
    pushCampaign(inst.campaign_id as string)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not set initiative' })
  }
})

function combatantCampaign(c: Record<string, unknown>) {
  const inst = instanceRow(c.encounter_instance_id as string)
  return inst
}

function canActAsCombatant(user: AuthUser, c: Record<string, unknown>, inst: Record<string, unknown>) {
  if (user.role === 'dm') return campaignOwned(inst.campaign_id as string, user.id)
  return user.role === 'player' && c.source === 'character' && String(c.source_id) === user.characterId && inst.campaign_id === user.campaignId
}

app.post('/api/combatants/:id/death-save', requireUser, (req, res) => {
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!c) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = combatantCampaign(c)
  if (!inst || !canActAsCombatant(userOf(req), c, inst)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  try {
    const result = applyCombatDeathSave(String(c.id), Number(req.body.d20))
    pushCampaign(inst.campaign_id as string)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Death save failed' })
  }
})

app.post('/api/combatants/:id/reset-death', requireDm, (req, res) => {
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!c) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = combatantCampaign(c)
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  resetCombatDeath(String(c.id))
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.post('/api/combatants/:id/turn-economy', requireUser, (req, res) => {
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!c) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = combatantCampaign(c)
  if (!inst || !canActAsCombatant(userOf(req), c, inst)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  setCombatTurnEconomy(String(c.id), req.body)
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.post('/api/instances/:id/activity', requireUser, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  const user = userOf(req)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (user.role === 'dm') {
    if (!campaignOwned(inst.campaign_id as string, user.id)) {
      res.status(404).json({ error: 'Not found' })
      return
    }
  } else if (user.campaignId !== inst.campaign_id) {
    res.status(403).json({ error: 'Forbidden' })
    return
  }
  try {
    appendInstanceActivity(String(inst.id), String(req.body.text ?? ''))
    pushCampaign(inst.campaign_id as string)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not log' })
  }
})

app.post('/api/instances/:id/declare', requireUser, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  const user = userOf(req)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  let combatantId = String(req.body.combatantId ?? '')
  if (user.role === 'dm') {
    if (!campaignOwned(inst.campaign_id as string, user.id)) {
      res.status(404).json({ error: 'Not found' })
      return
    }
  } else {
    if (user.campaignId !== inst.campaign_id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    const mine = db
      .prepare(`SELECT * FROM combatants WHERE encounter_instance_id = ? AND source = 'character' AND source_id = ?`)
      .get(inst.id, user.characterId) as Record<string, unknown> | undefined
    if (!mine) {
      res.status(400).json({ error: 'You are not on the map yet. Ask the DM to place you.' })
      return
    }
    combatantId = String(mine.id)
  }
  try {
    const r = applyDeclaredAction({
      instanceId: String(inst.id),
      combatantId,
      kind: String(req.body.kind ?? ''),
      slot: req.body.slot,
      targetId: req.body.targetId,
      other: req.body.other,
      custom: req.body.custom,
      d20: req.body.d20 == null || req.body.d20 === '' ? undefined : Number(req.body.d20),
    })
    pushCampaign(inst.campaign_id as string)
    res.json(r)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not declare' })
  }
})

app.post('/api/instances/:id/apply-hide', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  try {
    const r = applyHideResult({
      instanceId: String(inst.id),
      combatantId: String(req.body.combatantId ?? ''),
      success: Boolean(req.body.success),
      text: String(req.body.text ?? ''),
    })
    pushCampaign(inst.campaign_id as string)
    res.json(r)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not hide' })
  }
})

app.post('/api/instances/:id/prompt', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  try {
    const kind = req.body.kind
    if (kind == null || kind === '') {
      setInstancePrompt(String(inst.id), null)
    } else {
      setInstancePrompt(String(inst.id), {
        kind,
        combatantId: req.body.combatantId,
        ability: req.body.ability,
        dc: req.body.dc,
      })
    }
    pushCampaign(inst.campaign_id as string)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not set prompt' })
  }
})

app.post('/api/instances/:id/prompt-answer', requireUser, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  const user = userOf(req)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const { prompt } = instanceActivity(String(inst.id))
  if (!prompt) {
    res.status(400).json({ error: 'Nothing is waiting.' })
    return
  }
  const c = db.prepare('SELECT * FROM combatants WHERE id = ?').get(prompt.combatantId) as Record<string, unknown> | undefined
  if (!c || !canActAsCombatant(user, c, inst)) {
    res.status(403).json({ error: 'This prompt is not for you.' })
    return
  }
  try {
    if (prompt.kind === 'save') {
      const r = resolvePromptSave({ instanceId: String(inst.id), combatantId: prompt.combatantId, d20: Number(req.body.d20) })
      pushCampaign(inst.campaign_id as string)
      res.json(r)
      return
    }
    const accept = Boolean(req.body.use)
    if (accept) {
      const econ = parseTurnEconomy(jparse((c.turn_economy_json as string) || '{}', {}))
      econ.reaction = true
      setCombatTurnEconomy(String(c.id), econ)
      const note = String(req.body.other || req.body.attackName || '').trim()
      appendInstanceActivity(String(inst.id), note ? `${c.name} used their Reaction (${note}).` : `${c.name} used their Reaction.`)
    } else {
      appendInstanceActivity(String(inst.id), `${c.name} declined a Reaction.`)
    }
    setInstancePrompt(String(inst.id), null)
    pushCampaign(inst.campaign_id as string)
    res.json({ ok: true })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not answer' })
  }
})

app.post('/api/instances/:id/next-turn', requireUser, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  const user = userOf(req)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (user.role === 'dm') {
    if (!campaignOwned(inst.campaign_id as string, user.id)) {
      res.status(404).json({ error: 'Not found' })
      return
    }
  } else {
    if (user.campaignId !== inst.campaign_id) {
      res.status(403).json({ error: 'Forbidden' })
      return
    }
    const current = db
      .prepare('SELECT * FROM combatants WHERE encounter_instance_id = ? AND turn_order_position = ?')
      .get(inst.id, inst.current_turn_position) as Record<string, unknown> | undefined
    if (!current || !canActAsCombatant(user, current, inst)) {
      res.status(400).json({ error: 'Wait for your turn to end the round.' })
      return
    }
  }
  const expectedRaw = req.body?.expectedTurnPosition
  const expected = Number.isInteger(Number(expectedRaw)) ? Number(expectedRaw) : undefined
  try {
    const result = advanceInstanceTurn(String(inst.id), expected)
    pushCampaign(inst.campaign_id as string)
    res.json(result)
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not advance the turn' })
  }
})

app.post('/api/instances/:id/sort-initiative', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  sortInstanceInitiative(String(inst.id), Boolean(req.body?.keepCurrent))
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.patch('/api/tokens/:id', requireUser, (req, res) => {
  const t = db.prepare('SELECT * FROM tokens_on_map WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!t) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = instanceRow(t.encounter_instance_id as string)
  if (!inst) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const user = userOf(req)
  const combatant = db.prepare('SELECT * FROM combatants WHERE id = ?').get(t.ref_id) as Record<string, unknown> | undefined
  const asDm = user.role === 'dm' && campaignOwned(inst.campaign_id as string, user.id)
  const asPlayer = Boolean(combatant && canActAsCombatant(user, combatant, inst))
  if (!asDm && !asPlayer) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  if (asPlayer && !asDm) {
    if (Number(combatant?.turn_order_position) !== Number(inst.current_turn_position)) {
      res.status(400).json({ error: 'Wait for your turn to move.' })
      return
    }
    if (req.body.visibleToPlayers != null || req.body.sizeSquares != null) {
      res.status(400).json({ error: 'Only the DM can change that' })
      return
    }
  }
  const nextX = req.body.x ?? t.x
  const nextY = req.body.y ?? t.y
  const moving = req.body.x != null && req.body.y != null
  let gridSize = 70
  let battle: ReturnType<typeof mapFromDb> | undefined
  if (inst.map_id && moving) {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(inst.map_id) as Record<string, unknown> | undefined
    if (map) {
      battle = mapFromDb(map)
      gridSize = battle.gridSize
      const { col, row } = pixelToCell(Number(nextX), Number(nextY), battle.gridSize)
      if (tokenOccupiesBlocked(battle.blocked, col, row, battle.gridCols, battle.gridRows, Number(t.size_squares ?? 1))) {
        res.status(400).json({ error: 'That square is blocked' })
        return
      }
    }
  }
  try {
    if (moving && combatant && (asPlayer || Number(combatant.turn_order_position) === Number(inst.current_turn_position))) {
      consumeTurnMovement(
        String(inst.id),
        String(combatant.id),
        { x: Number(t.x), y: Number(t.y) },
        { x: Number(nextX), y: Number(nextY) },
        gridSize,
        battle?.blocked,
        battle?.gridCols,
        battle?.gridRows,
      )
    }
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Could not move' })
    return
  }
  db.prepare('UPDATE tokens_on_map SET x=?, y=?, visible_to_players=?, size_squares=? WHERE id=?').run(
    req.body.x ?? t.x,
    req.body.y ?? t.y,
    req.body.visibleToPlayers == null ? t.visible_to_players : req.body.visibleToPlayers ? 1 : 0,
    req.body.sizeSquares ?? t.size_squares,
    t.id,
  )
  if (moving && combatant) revealHidingIfSeen(String(inst.id), String(combatant.id))
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.patch('/api/instances/:id/fog', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare('UPDATE encounter_instances SET fog_state = ? WHERE id = ?').run(JSON.stringify(req.body.fogState), inst.id)
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.post('/api/instances/:id/reorder', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const order = req.body.ids as string[]
  order.forEach((id, i) => db.prepare('UPDATE combatants SET turn_order_position = ? WHERE id = ? AND encounter_instance_id = ?').run(i, id, inst.id))
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '', 'http://localhost')
  const token = url.searchParams.get('token')
  const row = token ? (db.prepare('SELECT * FROM auth_tokens WHERE token = ?').get(token) as Record<string, unknown> | undefined) : undefined
  const sock = ws as Sock
  if (!row) {
    ws.close()
    return
  }
  sock.role = row.role as string
  sock.characterId = row.character_id ? String(row.character_id) : undefined
  sock.campaignId = row.role === 'dm' ? url.searchParams.get('campaignId') || '' : (row.campaign_id as string)
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { type: string; campaignId?: string }
      if (msg.type === 'subscribe' && sock.role === 'dm' && msg.campaignId) sock.campaignId = msg.campaignId
    } catch {
      /* ignore */
    }
  })
})

const dist = path.join(root, 'dist')
if (fs.existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
}

const PORT = Number(process.env.PORT ?? 4732)
server.listen(PORT, '0.0.0.0', () => {
  console.log(`D&D Live Table API on http://127.0.0.1:${PORT}`)
})
