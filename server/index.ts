import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import cors from 'cors'
import express from 'express'
import multer from 'multer'
import { WebSocketServer, type WebSocket } from 'ws'
import { emptySheet, type AuthUser, type FogState, type NamedEntry } from '../src/lib/types.ts'
import {
    clampGridDim,
    clampGridSize,
    DEFAULT_SCRATCH_CELL,
    parseBlockedCells,
    pixelToCell,
    remapBlocked,
    tokenOccupiesBlocked,
    walkablePixel,
} from '../src/lib/utils.ts'
import {
  addCharacterCombatant,
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

type Sock = WebSocket & { campaignId?: string; role?: string }

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })

function broadcast(campaignId: string, payload: unknown) {
  const data = JSON.stringify(payload)
  for (const client of wss.clients) {
    const c = client as Sock
    if (c.readyState === 1 && c.campaignId === campaignId) c.send(data)
  }
}

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
  const tokens = instanceId
    ? (db.prepare('SELECT * FROM tokens_on_map WHERE encounter_instance_id = ?').all(instanceId) as Record<string, unknown>[])
    : []
  const characters = db.prepare('SELECT * FROM player_characters WHERE campaign_id = ?').all(campaignId) as Record<string, unknown>[]
  return {
    campaign: { id: campaign.id, dmAccountId: campaign.dm_account_id, name: campaign.name },
    session: session
      ? { id: session.id, joinCode: session.join_code, campaignId: session.campaign_id, encounterInstanceId: session.encounter_instance_id }
      : null,
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
      advantageAgainst: jparse<string[]>((c.advantage_against_json as string) || '[]', []),
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
  }
}

function pushCampaign(campaignId: string) {
  broadcast(campaignId, { type: 'snapshot', payload: snapshot(campaignId) })
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
  res.json({ campaigns: rows.map((r) => ({ id: (r as { id: string }).id, name: (r as { name: string }).name, dmAccountId: userOf(req).id })) })
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
  res.json({ ok: true })
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
     condition_immunities=?, senses=?, languages=?, challenge_rating=?, xp=?, proficiency_bonus=?, traits=?, actions=?, legendary_actions=?,
     reactions=?, bonus_actions=?, lair_actions=? WHERE id=?`,
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
  db.prepare('UPDATE maps SET name=?, image_url=?, grid_size=?, grid_cols=?, grid_rows=?, blocked_cells=? WHERE id=?').run(
    req.body.name ?? map.name,
    imageUrl,
    gridSize,
    gridCols,
    gridRows,
    JSON.stringify(blocked),
    map.id,
  )
  res.json({
    map: mapFromDb({
      ...map,
      name: req.body.name ?? map.name,
      image_url: imageUrl,
      grid_size: gridSize,
      grid_cols: gridCols,
      grid_rows: gridRows,
      blocked_cells: JSON.stringify(blocked),
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

app.get('/api/campaigns/:id/templates', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const rows = db.prepare('SELECT * FROM encounter_templates WHERE campaign_id = ?').all(param(req, 'id')) as Record<string, unknown>[]
  res.json({
    templates: rows.map((t) => ({
      id: t.id,
      campaignId: t.campaign_id,
      mapId: t.map_id,
      name: t.name,
      monsters: jparse(t.monsters_json as string, []),
      characters: jparse((t.characters_json as string) || '[]', []),
    })),
  })
})

app.post('/api/campaigns/:id/templates', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const id = ids.id()
  db.prepare('INSERT INTO encounter_templates (id, campaign_id, map_id, name, monsters_json, characters_json) VALUES (?,?,?,?,?,?)').run(
    id,
    param(req, 'id'),
    req.body.mapId,
    String(req.body.name || 'Encounter'),
    JSON.stringify(req.body.monsters ?? []),
    JSON.stringify(req.body.characters ?? []),
  )
  res.json({
    template: {
      id,
      campaignId: param(req, 'id'),
      mapId: req.body.mapId,
      name: req.body.name,
      monsters: req.body.monsters ?? [],
      characters: req.body.characters ?? [],
    },
  })
})

app.patch('/api/templates/:id', requireDm, (req, res) => {
  const t = db.prepare('SELECT * FROM encounter_templates WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!t || !campaignOwned(t.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare('UPDATE encounter_templates SET name=?, map_id=?, monsters_json=?, characters_json=? WHERE id=?').run(
    req.body.name ?? t.name,
    req.body.mapId ?? t.map_id,
    JSON.stringify(req.body.monsters ?? jparse(t.monsters_json as string, [])),
    JSON.stringify(req.body.characters ?? jparse((t.characters_json as string) || '[]', [])),
    t.id,
  )
  res.json({ ok: true })
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
      name: i.name,
      status: i.status,
      roundNumber: i.round_number,
      currentTurnPosition: i.current_turn_position,
      mapId: i.map_id,
      encounterTemplateId: i.encounter_template_id,
    })),
  })
})

app.post('/api/campaigns/:id/instances', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const instanceId = spawnFromTemplate(param(req, 'id'), req.body.templateId, req.body.name)
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

app.post('/api/campaigns/:id/session', requireDm, (req, res) => {
  if (!campaignOwned(param(req, 'id'), userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  db.prepare('DELETE FROM live_sessions WHERE campaign_id = ?').run(param(req, 'id'))
  const join = req.body.joinCode || ids.join()
  const id = ids.id()
  const encounterInstanceId = req.body.encounterInstanceId || null
  if (encounterInstanceId) {
    db.prepare(`UPDATE encounter_instances SET status = 'active' WHERE id = ?`).run(encounterInstanceId)
  }
  db.prepare('INSERT INTO live_sessions (id, join_code, campaign_id, encounter_instance_id, created_at) VALUES (?,?,?,?,?)').run(
    id,
    join,
    param(req, 'id'),
    encounterInstanceId,
    now(),
  )
  pushCampaign(param(req, 'id'))
  res.json({ session: { id, joinCode: join, campaignId: param(req, 'id'), encounterInstanceId } })
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
  const code = String(req.body?.personalCode ?? '').trim().toUpperCase()
  const ch = db
    .prepare('SELECT * FROM player_characters WHERE campaign_id = ? AND personal_code = ? COLLATE NOCASE')
    .get(session.campaign_id, code) as Record<string, unknown> | undefined
  if (!ch) {
    res.status(401).json({ error: 'That personal code does not belong to this campaign' })
    return
  }
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
    snap.characters = snap.characters.map((c) => (c.id === user.characterId ? c : { ...c, personalCode: '••••••••' }))
    snap.tokens = snap.tokens.filter((t) => t.visibleToPlayers)
    if (snap.instance?.fogState.enabled) {
      /* fog handled client-side */
    }
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
      const qty = Number(req.body.quantity ?? 1)
      const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(inst.map_id) as Record<string, unknown> | undefined
      const battle = map ? mapFromDb(map) : null
      const cell = battle?.gridSize ?? 70
      for (let i = 0; i < qty; i++) {
        const id = i === 0 ? cid : ids.id()
        const name = qty > 1 ? `${src.name} ${i + 1}` : String(src.name)
        db.prepare(
          `INSERT INTO combatants (id, encounter_instance_id, name, source, source_id, initiative, hp_current, hp_max, hp_temp, ac, conditions_json, turn_order_position, color, notes, constitution)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        )
        const pos = battle
          ? walkablePixel(battle, 3 + i, 3)
          : { x: cell * (3 + i) + cell / 2, y: cell * 3 + cell / 2 }
        db.prepare(
          `INSERT INTO tokens_on_map (id, encounter_instance_id, x, y, ref_type, ref_id, label, color, size_squares, visible_to_players)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        ).run(ids.id(), inst.id, pos.x, pos.y, 'combatant', id, name, req.body.color || '#c4453c', 1, 1)
      }
  }
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
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
      damage: Number(req.body.damage),
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
    const col = map[k] ?? k
    if (fields.includes(col as (typeof fields)[number])) {
      db.prepare(`UPDATE combatants SET ${col} = ? WHERE id = ?`).run(v, c.id)
    }
  }
  if (c.source === 'character' && (req.body.hpCurrent != null || req.body.hpMax != null)) {
    const ch = db.prepare('SELECT sheet_json FROM player_characters WHERE id = ?').get(c.source_id) as { sheet_json: string } | undefined
    if (ch) {
      const sheet = jparse(ch.sheet_json, {} as Record<string, unknown>)
      if (req.body.hpCurrent != null) sheet.hpCurrent = req.body.hpCurrent
      if (req.body.hpMax != null) sheet.hpMax = req.body.hpMax
      db.prepare('UPDATE player_characters SET sheet_json = ? WHERE id = ?').run(JSON.stringify(sheet), c.source_id)
    }
  }
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.post('/api/instances/:id/next-turn', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const n = db.prepare('SELECT COUNT(*) as c FROM combatants WHERE encounter_instance_id = ?').get(inst.id) as { c: number }
  if (n.c === 0) {
    res.json({ ok: true })
    return
  }
  let pos = Number(inst.current_turn_position) + 1
  let round = Number(inst.round_number)
  if (pos >= n.c) {
    pos = 0
    round += 1
  }
  db.prepare('UPDATE encounter_instances SET current_turn_position = ?, round_number = ? WHERE id = ?').run(pos, round, inst.id)
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true, round, pos })
})

app.post('/api/instances/:id/sort-initiative', requireDm, (req, res) => {
  const inst = instanceRow(param(req, 'id'))
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const rows = db.prepare('SELECT id, initiative FROM combatants WHERE encounter_instance_id = ?').all(inst.id) as { id: string; initiative: number }[]
  rows.sort((a, b) => b.initiative - a.initiative)
  rows.forEach((r, i) => db.prepare('UPDATE combatants SET turn_order_position = ? WHERE id = ?').run(i, r.id))
  db.prepare('UPDATE encounter_instances SET current_turn_position = 0 WHERE id = ?').run(inst.id)
  pushCampaign(inst.campaign_id as string)
  res.json({ ok: true })
})

app.patch('/api/tokens/:id', requireDm, (req, res) => {
  const t = db.prepare('SELECT * FROM tokens_on_map WHERE id = ?').get(param(req, 'id')) as Record<string, unknown> | undefined
  if (!t) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const inst = instanceRow(t.encounter_instance_id as string)
  if (!inst || !campaignOwned(inst.campaign_id as string, userOf(req).id)) {
    res.status(404).json({ error: 'Not found' })
    return
  }
  const nextX = req.body.x ?? t.x
  const nextY = req.body.y ?? t.y
  if (inst.map_id && req.body.x != null && req.body.y != null) {
    const map = db.prepare('SELECT * FROM maps WHERE id = ?').get(inst.map_id) as Record<string, unknown> | undefined
    if (map) {
      const battle = mapFromDb(map)
      const { col, row } = pixelToCell(Number(nextX), Number(nextY), battle.gridSize)
      if (tokenOccupiesBlocked(battle.blocked, col, row, battle.gridCols, battle.gridRows, Number(t.size_squares ?? 1))) {
        res.status(400).json({ error: 'That square is blocked' })
        return
      }
    }
  }
  db.prepare('UPDATE tokens_on_map SET x=?, y=?, visible_to_players=?, size_squares=? WHERE id=?').run(
    req.body.x ?? t.x,
    req.body.y ?? t.y,
    req.body.visibleToPlayers == null ? t.visible_to_players : req.body.visibleToPlayers ? 1 : 0,
    req.body.sizeSquares ?? t.size_squares,
    t.id,
  )
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
