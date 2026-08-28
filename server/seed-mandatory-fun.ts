import type Database from 'better-sqlite3'
import { parseHub } from '../src/lib/campaign-hub.ts'
import { isCellBlocked, TERRAIN, tokenOccupiesBlocked } from '../src/lib/utils.ts'
import type { NamedEntry, TemplateMonster } from '../src/lib/types.ts'

type InsertMonster = (
  dmId: string,
  m: {
    name: string
    size: string
    creatureType: string
    alignment: string
    acValue: number
    acNote: string
    hpMax: number
    hitDiceFormula: string
    speed: string
    str: number
    dex: number
    con: number
    int: number
    wis: number
    cha: number
    savingThrows: string
    skills: string
    damageVulnerabilities: string
    damageResistances: string
    damageImmunities: string
    conditionImmunities: string
    senses: string
    languages: string
    challengeRating: number
    xp: number
    proficiencyBonus: number
    traits: NamedEntry[]
    actions: NamedEntry[]
    legendaryActions: NamedEntry[]
    reactions: NamedEntry[]
    bonusActions: NamedEntry[]
    lairActions: NamedEntry[]
    source: 'srd' | 'custom'
  },
) => string

/** # wall  . open  D desk/cover  ~ paper (difficult)  o hole  W water (Glen) */
export const OFFICES = [
  '####################',
  '#......##..........#',
  '#......##..........#',
  '###..######..#######',
  '#..D.#....#..D.....#',
  '#....#....#........#',
  '#..W.##..##........#',
  '#~~~~#....#...oo...#',
  '#....#....#........#',
  '###..######..#######',
  '#..................#',
  '#.....DDD..........#',
  '#..................#',
  '######....##########',
]

export const BOARDROOM = [
  '##############',
  '#............#',
  '#...######...#',
  '#...#....#...#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '#............#',
  '####......####',
]

export function paintAsciiMap(rows: string[]) {
  const gridRows = rows.length
  const gridCols = rows[0]?.length ?? 0
  const blocked: number[] = []
  for (const line of rows) {
    if (line.length !== gridCols) throw new Error(`Map row length ${line.length} !== ${gridCols}`)
    for (const ch of line) {
      if (ch === '#') blocked.push(TERRAIN.WALL)
      else if (ch === 'D') blocked.push(TERRAIN.HALF_COVER)
      else if (ch === '~') blocked.push(TERRAIN.DIFFICULT)
      else if (ch === 'o') blocked.push(TERRAIN.HOLE)
      else if (ch === 'W') blocked.push(TERRAIN.WATER)
      else blocked.push(TERRAIN.OPEN)
    }
  }
  return { gridCols, gridRows, blocked }
}

export function vizzStatBlock() {
  return {
    name: 'Vizz the Unblinking',
    size: 'Large',
    creatureType: 'aberration',
    alignment: 'lawful evil (on a PIP)',
    acValue: 16,
    acNote: 'natural armor',
    hpMax: 68,
    hitDiceFormula: '8d10+24',
    speed: '0 ft., fly 20 ft. (hover)',
    str: 10,
    dex: 12,
    con: 16,
    int: 16,
    wis: 12,
    cha: 14,
    savingThrows: 'Int +5, Wis +3, Cha +4',
    skills: 'Insight +3, Perception +5',
    damageVulnerabilities: '',
    damageResistances: '',
    damageImmunities: '',
    conditionImmunities: 'prone',
    senses: 'darkvision 120 ft., passive Perception 15',
    languages: 'Deep Speech, Common (from a stolen handbook)',
    challengeRating: 2,
    xp: 450,
    proficiencyBonus: 2,
    traits: [
      {
        name: 'Antimagic Quiet Hours (recharge 5–6)',
        desc: 'A 60-ft cone. Creatures in the cone cannot cast spells until the end of their next turn. Vizz uses this to shush the room, not to murder.',
      },
      {
        name: 'Death Ray: Out of Order',
        desc: 'A sticky note covers that eyestalk. Vizz cannot disintegrate anyone. He is very sorry about the inconvenience.',
      },
    ],
    actions: [
      {
        name: 'Bite',
        desc: 'Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 6 (1d8+2) piercing damage.',
      },
      {
        name: 'Eye Ray',
        desc: 'Ranged Spell Attack: +4 to hit, range 60 ft., one creature. Hit: 7 (2d6) psychic damage. Then roll 1d6: (1–2) Charm — Wis DC 12 or charmed 1 minute, new save each turn. (3–4) Sleep — Wis DC 12 or unconscious until damage or 1 minute. (5–6) Quiet Hours — no spells until end of its next turn.',
      },
    ],
    legendaryActions: [] as NamedEntry[],
    reactions: [] as NamedEntry[],
    bonusActions: [] as NamedEntry[],
    lairActions: [] as NamedEntry[],
    source: 'custom' as const,
  }
}

export const FRONT_DESK_SPAWNS: Omit<TemplateMonster, 'bestiaryMonsterId'>[] = [
  { name: 'Security Goblin', quantity: 3, startX: 9, startY: 11, color: '#4ea36a', positions: [{ x: 9, y: 11 }, { x: 10, y: 11 }, { x: 11, y: 12 }] },
  { name: 'Emotional-Support Wolf', quantity: 1, startX: 4, startY: 12, color: '#8a6a4a', positions: [{ x: 4, y: 12 }] },
]

export const SEMINAR_SPAWNS: Omit<TemplateMonster, 'bestiaryMonsterId'>[] = [
  { name: 'Facilitator', quantity: 2, startX: 2, startY: 1, color: '#c4453c', positions: [{ x: 2, y: 1 }, { x: 4, y: 1 }] },
  { name: 'Intern Goblin', quantity: 2, startX: 14, startY: 1, color: '#4ea36a', positions: [{ x: 14, y: 1 }, { x: 16, y: 1 }] },
]

export const REVIEW_SPAWNS: Omit<TemplateMonster, 'bestiaryMonsterId'>[] = [
  { name: 'Vizz the Unblinking', quantity: 1, startX: 6, startY: 5, color: '#7b6cc9', positions: [{ x: 6, y: 5 }] },
  { name: 'HR Note-Taker', quantity: 2, startX: 2, startY: 9, color: '#4ea36a', positions: [{ x: 2, y: 9 }, { x: 10, y: 9 }] },
]

export function assertWalkableSpawns(rows: string[], spawns: Omit<TemplateMonster, 'bestiaryMonsterId'>[], sizeSquares = 1) {
  const map = paintAsciiMap(rows)
  for (const spec of spawns) {
    const cells = spec.positions ?? [{ x: spec.startX, y: spec.startY }]
    for (const p of cells) {
      if (tokenOccupiesBlocked(map.blocked, p.x, p.y, map.gridCols, map.gridRows, sizeSquares) || isCellBlocked(map.blocked, p.x, p.y, map.gridCols, map.gridRows)) {
        throw new Error(`${spec.name} spawn ${p.x},${p.y} is blocked`)
      }
    }
  }
}

export function mandatoryFunHub(templateIds: { frontDesk: string; seminar: string; review: string }) {
  return {
    recap: `Winkwell’s chickens have stopped blinking. So have the baker, the miller, and one very confused mule. Mayor Blink Harrow (he blinks enough for everyone) hired six 2nd-level “consultants” for 25 gp and a pie coupon.

Cause: Vizz the Unblinking, a lonely middle-manager beholder fired from a lich’s dungeon, is running a mandatory team-building retreat in the old salt mine. His “quiet hours” cone is freezing eyelids in town. He wants friends. He still has eyestalks.

2-hour clock (six PCs = slow combat — keep fights 1 and 2 to 2–3 rounds):
• Start campaign — Mayor Blink on the opening scene. Lighting: Inside.
• Start encounter 1 (Front Desk). Finalize → cubicle crawl scene.
• Same map, cubicles. Glen the water cooler (west, the wet square) will not fight. Paper is difficult terrain. Desks are half cover. Holes are the trust-fall.
• Start encounter 2 (Trust-Fall Seminar). Free Pip (east cubicle, KPI). Finalize → elevator scene.
• Elevator small talk. Start encounter 3 (Performance Review) on the second map.
• Boss. Vizz talks every round. He surrenders at ~20 HP or if the party finishes 3 KPIs: posters down, Pip free, honest performance review spoken aloud. Death ray is out of order. Finalize → pie in Winkwell.

Prep: maps → encounters → Run order. Add 5–6 level-2 characters, then drop starting squares on each template. One fight per template.`,
    sessionTitle: 'Mandatory Fun',
    sessionNotes:
      '2-hour one-shot. Six level-2 PCs. Lighting: Inside. Fights 1–2: 2–3 rounds. Add PCs in Prep, then starting squares. Vizz surrenders at 20 HP or 3 KPIs.',
    beats: [
      {
        id: 'b1',
        kind: 'social',
        title: 'Mayor Blink in Winkwell',
        notes: '25 gp + pie coupon. Salt mine. Do this on the opening scene, not on a map.',
        templateId: '',
        status: 'upcoming',
        imageUrl: '',
        caption: 'Mayor Blink’s square. The chickens will not blink.',
      },
      {
        id: 'b2',
        kind: 'combat',
        title: 'Front Desk',
        notes: 'Lobby on Salt-Mine Offices. Brenda helps after.',
        templateId: templateIds.frontDesk,
        status: 'upcoming',
        imageUrl: '',
        caption: '',
      },
      {
        id: 'b3',
        kind: 'travel',
        title: 'Cubicle crawl',
        notes: 'Same map. Glen hints: north, don’t fall in the trust-fall, Vizz hates honest feedback.',
        templateId: '',
        status: 'upcoming',
        imageUrl: '',
        caption: 'Paper snow. Glen gurgles. The trust-fall pit waits north.',
      },
      {
        id: 'b4',
        kind: 'combat',
        title: 'Trust-Fall Seminar',
        notes: 'North end of the offices. Free Pip. Elevator is the open rooms at the top.',
        templateId: templateIds.seminar,
        status: 'upcoming',
        imageUrl: '',
        caption: '',
      },
      {
        id: 'b5',
        kind: 'travel',
        title: 'Elevator to the corner office',
        notes: 'Switch to map The Corner Office. Vizz is already talking on the intercom.',
        templateId: '',
        status: 'upcoming',
        imageUrl: '',
        caption: 'A salt-mine elevator. Vizz is already talking on the intercom.',
      },
      {
        id: 'b6',
        kind: 'combat',
        title: 'Performance Review',
        notes: 'Boss. Large token. Two HR goblins take notes and flinch.',
        templateId: templateIds.review,
        status: 'upcoming',
        imageUrl: '',
        caption: '',
      },
      {
        id: 'b7',
        kind: 'social',
        title: 'Pie coupon',
        notes: 'Back in Winkwell if they survive the review.',
        templateId: '',
        status: 'upcoming',
        imageUrl: '',
        caption: 'Back in Winkwell. The mayor has pie. Someone should blink.',
      },
    ],
    quests: [
      { id: 'q1', name: 'Shut down the retreat', status: 'open', notes: 'End Vizz’s all-hands without the town freezing forever.', npcIds: ['n1'] },
      { id: 'q2', name: 'Free Pip', status: 'open', notes: 'Baker intern in the east cubicles. KPI for the boss fight.', npcIds: ['n4'] },
      { id: 'q3', name: 'Honest feedback', status: 'open', notes: 'Someone must say a true thing about Vizz’s management out loud.', npcIds: ['n5'] },
    ],
    npcs: [
      { id: 'n1', name: 'Mayor Blink Harrow', role: 'Patron', notes: 'Blinks too much. Pays 25 gp and a pie coupon. Genuinely kind.' },
      { id: 'n2', name: 'Brenda', role: 'Reception goblin', notes: 'Hides under the desk. After fight 1 she badges them through and warns about the pit.' },
      { id: 'n3', name: 'Glen', role: 'Water cooler', notes: 'Water weird on lunch break. Will not fight. Hints: “North. Don’t fall in the trust-fall. He hates honest feedback.”' },
      { id: 'n4', name: 'Pip', role: 'Intern (baker)', notes: 'Tied in the east cubicle. Nice. Knows Vizz’s death ray is broken. Loves cinnamon.' },
      { id: 'n5', name: 'Vizz the Unblinking', role: 'Boss', notes: 'Lonely middle-manager beholder. Wants friends. Still a monster. Do not use disintegrate.' },
    ],
    loot: [{ id: 'l1', name: 'Pie coupon', qty: 1, notes: 'Stonehill-quality. Mayor already paid.', holder: '' }],
    stages: [],
  }
}

function withBestiary(spec: Omit<TemplateMonster, 'bestiaryMonsterId'>, bestiaryMonsterId: string | undefined): TemplateMonster {
  return { ...spec, bestiaryMonsterId: bestiaryMonsterId ?? '' }
}

export function seedMandatoryFun(
  deps: { db: Database.Database; id: () => string; insertMonster: InsertMonster },
  dmId: string,
) {
  const { db, id, insertMonster } = deps
  const exists = db.prepare('SELECT id FROM campaigns WHERE dm_account_id = ? AND name = ?').get(dmId, 'Mandatory Fun') as
    | { id: string }
    | undefined
  if (exists) {
    const row = db.prepare('SELECT hub_json FROM campaigns WHERE id = ?').get(exists.id) as { hub_json?: string } | undefined
    const raw = row?.hub_json ? JSON.parse(row.hub_json) : {}
    const hub = parseHub(raw)
    const tpls = db.prepare('SELECT id, name FROM encounter_templates WHERE campaign_id = ?').all(exists.id) as { id: string; name: string }[]
    const frontDesk = tpls.find((t) => /front desk/i.test(t.name))?.id ?? ''
    const seminar = tpls.find((t) => /trust-fall|seminar/i.test(t.name))?.id ?? ''
    const review = tpls.find((t) => /performance|review/i.test(t.name))?.id ?? ''
    const fresh = parseHub(mandatoryFunHub({ frontDesk, seminar, review }))
    const hasScenes = hub.beats.some((b) => b.caption.trim() || b.imageUrl)
    const hasPie = hub.beats.some((b) => /pie coupon/i.test(b.title))
    if (!hasScenes || !hasPie) {
      const statusByTemplate = new Map(hub.beats.filter((b) => b.templateId).map((b) => [b.templateId, b.status]))
      const statusById = new Map(hub.beats.map((b) => [b.id, b.status]))
      const beats = fresh.beats.map((b) => ({
        ...b,
        status: (b.templateId && statusByTemplate.get(b.templateId)) || statusById.get(b.id) || b.status,
      }))
      db.prepare('UPDATE campaigns SET hub_json = ? WHERE id = ?').run(JSON.stringify({ ...hub, beats, stages: [] }), exists.id)
    }
    return exists.id
  }

  const goblin = db.prepare(`SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = 'Goblin'`).get(dmId) as { id: string } | undefined
  const wolf = db.prepare(`SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = 'Wolf'`).get(dmId) as { id: string } | undefined
  const hobgoblin = db.prepare(`SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = 'Hobgoblin'`).get(dmId) as
    | { id: string }
    | undefined
  if (!goblin?.id || !wolf?.id) {
    throw new Error('Mandatory Fun needs SRD Goblin and Wolf in this DM’s bestiary. Seed the bestiary first.')
  }

  const campaignId = id()
  db.prepare('INSERT INTO campaigns (id, dm_account_id, name) VALUES (?,?,?)').run(campaignId, dmId, 'Mandatory Fun')

  const offices = paintAsciiMap(OFFICES)
  const board = paintAsciiMap(BOARDROOM)
  assertWalkableSpawns(OFFICES, FRONT_DESK_SPAWNS)
  assertWalkableSpawns(OFFICES, SEMINAR_SPAWNS)
  assertWalkableSpawns(BOARDROOM, [REVIEW_SPAWNS[0]!], 2)
  assertWalkableSpawns(BOARDROOM, [REVIEW_SPAWNS[1]!])

  const officesId = id()
  const boardId = id()
  db.prepare(
    'INSERT INTO maps (id, campaign_id, name, image_url, grid_size, grid_cols, grid_rows, grid_type, blocked_cells) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(
    officesId,
    campaignId,
    'Salt-Mine Offices',
    '',
    70,
    offices.gridCols,
    offices.gridRows,
    'square',
    JSON.stringify(offices.blocked),
  )
  db.prepare(
    'INSERT INTO maps (id, campaign_id, name, image_url, grid_size, grid_cols, grid_rows, grid_type, blocked_cells) VALUES (?,?,?,?,?,?,?,?,?)',
  ).run(boardId, campaignId, 'The Corner Office', '', 70, board.gridCols, board.gridRows, 'square', JSON.stringify(board.blocked))

  let vizzId = (db.prepare('SELECT id FROM bestiary_monsters WHERE dm_account_id = ? AND name = ?').get(dmId, 'Vizz the Unblinking') as { id: string } | undefined)
    ?.id
  if (!vizzId) vizzId = insertMonster(dmId, vizzStatBlock())

  const e1 = id()
  const e2 = id()
  const e3 = id()

  db.prepare('INSERT INTO encounter_templates (id, campaign_id, map_id, name, monsters_json, characters_json) VALUES (?,?,?,?,?,?)').run(
    e1,
    campaignId,
    officesId,
    '1. Front Desk',
    JSON.stringify({
      monsters: [
        withBestiary(FRONT_DESK_SPAWNS[0]!, goblin.id),
        withBestiary(FRONT_DESK_SPAWNS[1]!, wolf.id),
      ],
      brief: {
        notes: 'Lobby. Brenda hid under the desk (the DDD). Glen is the wet square in the west cubicle and will not fight. Keep this to 2–3 rounds. Party starts at the south doors (the gap in the bottom wall).',
        objective: 'Get past reception and into the cubicle halls.',
        difficulty: 'Easy',
        xpAward: 200,
        lootNotes: 'Visitor badges (worthless) and a bowl of mints.',
        sortOrder: 1,
      },
    }),
    JSON.stringify([]),
  )
  db.prepare('INSERT INTO encounter_templates (id, campaign_id, map_id, name, monsters_json, characters_json) VALUES (?,?,?,?,?,?)').run(
    e2,
    campaignId,
    officesId,
    '2. Trust-Fall Seminar',
    JSON.stringify({
      monsters: [
        withBestiary(SEMINAR_SPAWNS[0]!, hobgoblin?.id ?? goblin.id),
        withBestiary(SEMINAR_SPAWNS[1]!, goblin.id),
      ],
      brief: {
        notes: 'Same map, north end. Party starts just north of the lobby doors. Pit (oo) is the trust-fall. Pip the baker intern is tied in the east cubicle — freeing her is a KPI.',
        objective: 'Reach the north elevator (the open rooms at the top).',
        difficulty: 'Easy–medium',
        xpAward: 300,
        lootNotes: 'Employee handbook (Vizz’s). Sticky note: Death ray OUT OF ORDER.',
        sortOrder: 2,
      },
    }),
    JSON.stringify([]),
  )
  db.prepare('INSERT INTO encounter_templates (id, campaign_id, map_id, name, monsters_json, characters_json) VALUES (?,?,?,?,?,?)').run(
    e3,
    campaignId,
    boardId,
    '3. Performance Review',
    JSON.stringify({
      monsters: [
        withBestiary(REVIEW_SPAWNS[0]!, vizzId),
        withBestiary(REVIEW_SPAWNS[1]!, goblin.id),
      ],
      brief: {
        notes: 'Boss. Vizz is Large (2 squares). He talks every round. He surrenders at 20 HP or if the party finishes 3 KPIs: posters down, Pip free, honest review spoken aloud. Do not use disintegrate. Party starts at the south doors.',
        objective: 'End the retreat. Kill or redeem Vizz.',
        difficulty: 'Boss (tuned for six 2nd-level PCs)',
        xpAward: 450,
        lootNotes: 'Pie coupon (already paid). Vizz’s handbook. 25 gp from the mayor if they return.',
        sortOrder: 3,
      },
    }),
    JSON.stringify([]),
  )

  db.prepare('UPDATE campaigns SET hub_json = ? WHERE id = ?').run(JSON.stringify(mandatoryFunHub({ frontDesk: e1, seminar: e2, review: e3 })), campaignId)
  return campaignId
}
