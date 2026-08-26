import assert from 'node:assert/strict'
import { attacksFromMonster } from '../src/lib/combat.ts'
import { parseHub } from '../src/lib/campaign-hub.ts'
import { unpackTemplateJson } from '../src/lib/template-json.ts'
import { TERRAIN, terrainAt } from '../src/lib/utils.ts'
import {
  assertWalkableSpawns,
  BOARDROOM,
  FRONT_DESK_SPAWNS,
  mandatoryFunHub,
  OFFICES,
  paintAsciiMap,
  REVIEW_SPAWNS,
  SEMINAR_SPAWNS,
  vizzStatBlock,
} from '../server/seed-mandatory-fun.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

check('offices map is 20×14 with a south door, pit, desks, and Glen', () => {
  const m = paintAsciiMap(OFFICES)
  assert.equal(m.gridCols, 20)
  assert.equal(m.gridRows, 14)
  assert.equal(m.blocked.length, 20 * 14)
  assert.equal(terrainAt(m.blocked, 7, 13, 20, 14), TERRAIN.OPEN)
  assert.equal(terrainAt(m.blocked, 6, 13, 20, 14), TERRAIN.OPEN)
  assert.equal(terrainAt(m.blocked, 5, 13, 20, 14), TERRAIN.WALL)
  assert.equal(terrainAt(m.blocked, 14, 7, 20, 14), TERRAIN.HOLE)
  assert.equal(terrainAt(m.blocked, 15, 7, 20, 14), TERRAIN.HOLE)
  assert.equal(terrainAt(m.blocked, 6, 11, 20, 14), TERRAIN.HALF_COVER)
  assert.equal(terrainAt(m.blocked, 3, 6, 20, 14), TERRAIN.WATER)
  assert.equal(terrainAt(m.blocked, 1, 7, 20, 14), TERRAIN.DIFFICULT)
})

check('corner office is 14×12 with a south door and inner glass box', () => {
  const m = paintAsciiMap(BOARDROOM)
  assert.equal(m.gridCols, 14)
  assert.equal(m.gridRows, 12)
  assert.equal(terrainAt(m.blocked, 6, 11, 14, 12), TERRAIN.OPEN)
  assert.equal(terrainAt(m.blocked, 3, 11, 14, 12), TERRAIN.WALL)
  assert.equal(terrainAt(m.blocked, 5, 2, 14, 12), TERRAIN.WALL)
  assert.equal(terrainAt(m.blocked, 6, 5, 14, 12), TERRAIN.OPEN)
})

check('all three encounter spawns sit on walkable floor', () => {
  assertWalkableSpawns(OFFICES, FRONT_DESK_SPAWNS)
  assertWalkableSpawns(OFFICES, SEMINAR_SPAWNS)
  assertWalkableSpawns(BOARDROOM, [REVIEW_SPAWNS[0]!], 2)
  assertWalkableSpawns(BOARDROOM, [REVIEW_SPAWNS[1]!])
})

check('hub has 3 combat beats, 2 maps in the runbook, and the nice NPCs', () => {
  const hub = parseHub(mandatoryFunHub({ frontDesk: 'e1', seminar: 'e2', review: 'e3' }))
  assert.equal(hub.sessionTitle, 'Mandatory Fun')
  const combat = hub.beats.filter((b) => b.kind === 'combat')
  assert.equal(combat.length, 3)
  assert.equal(combat[0]?.templateId, 'e1')
  assert.equal(combat[1]?.templateId, 'e2')
  assert.equal(combat[2]?.templateId, 'e3')
  assert.ok(hub.npcs.some((n) => n.name === 'Glen'))
  assert.ok(hub.npcs.some((n) => n.name === 'Pip'))
  assert.ok(hub.npcs.some((n) => n.name === 'Brenda'))
  assert.ok(hub.npcs.some((n) => n.name === 'Mayor Blink Harrow'))
  assert.ok(hub.npcs.some((n) => /Vizz/.test(n.name)))
  assert.match(hub.recap, /two maps|second map|Corner Office/i)
})

check('packed templates unpack with briefs and monster positions', () => {
  const packed = unpackTemplateJson({
    monsters_json: {
      monsters: FRONT_DESK_SPAWNS.map((s) => ({ ...s, bestiaryMonsterId: 'gob' })),
      brief: { notes: 'Lobby', objective: 'Get in', difficulty: 'Easy', xpAward: 200, lootNotes: 'Mints', sortOrder: 1 },
    },
    characters_json: [],
  })
  assert.equal(packed.monsters.length, 2)
  assert.equal(packed.monsters[0]?.positions?.length, 3)
  assert.equal(packed.brief.xpAward, 200)
  assert.equal(packed.brief.sortOrder, 1)
})

check('Vizz’s bite and eye ray parse as live-table attacks', () => {
  const attacks = attacksFromMonster(vizzStatBlock())
  const bite = attacks.find((a) => a.name === 'Bite')
  const ray = attacks.find((a) => a.name === 'Eye Ray')
  assert.equal(bite?.bonus, '+5')
  assert.match(bite?.damage ?? '', /1d8/)
  assert.equal(ray?.bonus, '+4')
  assert.match(ray?.range ?? '', /60/)
  assert.match(ray?.damage ?? '', /psychic/)
})
