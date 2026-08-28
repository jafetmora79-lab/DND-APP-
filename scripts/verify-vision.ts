import assert from 'node:assert/strict'
import { emptyHub } from '../src/lib/campaign-hub.ts'
import { initiativeBonusFor, movementCostFeet, snapshotForPlayer } from '../src/lib/combat.ts'
import { emptySheet } from '../src/lib/types.ts'
import { isCellBlocked, TERRAIN } from '../src/lib/utils.ts'
import {
  computeVisionMask,
  darkvisionForSheet,
  hasLineOfSight,
  lightingFromStart,
  makeStartFog,
  parseDarkvisionFt,
  visionRangeSquares,
} from '../src/lib/vision.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

check('terrain: walls and holes are impassable, difficult is not', () => {
  const blocked = [TERRAIN.OPEN, TERRAIN.WALL, TERRAIN.HOLE, TERRAIN.DIFFICULT, TERRAIN.FIRE]
  assert.equal(isCellBlocked(blocked, 0, 0, 5, 1), false)
  assert.equal(isCellBlocked(blocked, 1, 0, 5, 1), true)
  assert.equal(isCellBlocked(blocked, 2, 0, 5, 1), true)
  assert.equal(isCellBlocked(blocked, 3, 0, 5, 1), false)
  assert.equal(isCellBlocked(blocked, 4, 0, 5, 1), false)
})

check('terrain movement costs 10 ft on difficult/fire and 5 ft on open', () => {
  const cols = 5
  const rows = 1
  const blocked = [0, TERRAIN.DIFFICULT, TERRAIN.FIRE, TERRAIN.SLIPPERY, TERRAIN.WATER]
  assert.equal(movementCostFeet({ col: 0, row: 0 }, { col: 1, row: 0 }, blocked, cols, rows), 10)
  assert.equal(movementCostFeet({ col: 0, row: 0 }, { col: 2, row: 0 }, blocked, cols, rows), 20)
  assert.equal(movementCostFeet({ col: 0, row: 0 }, { col: 1, row: 0 }), 5)
})

check('darkvision parses from text and race', () => {
  assert.equal(parseDarkvisionFt('Darkvision 60 ft.'), 60)
  assert.equal(parseDarkvisionFt('Senses darkvision 120 ft., passive Perception 14'), 120)
  const sheet = emptySheet()
  sheet.race = 'Hill Dwarf'
  assert.equal(darkvisionForSheet(sheet), 60)
  sheet.race = 'Human'
  sheet.darkvisionFt = 0
  assert.equal(darkvisionForSheet(sheet), 0)
  sheet.darkvisionFt = 90
  assert.equal(darkvisionForSheet(sheet), 90)
  sheet.darkvisionFt = null
  sheet.race = 'Half-Elf'
  assert.equal(darkvisionForSheet(sheet), 60)
})

check('night uses darkvision squares; interior is LOS-limited; day is unlimited', () => {
  const sheet = emptySheet()
  sheet.darkvisionFt = 60
  assert.equal(visionRangeSquares('night', sheet), 12)
  assert.equal(visionRangeSquares('night', emptySheet()), 0)
  assert.ok(visionRangeSquares('interior', sheet) > 12)
  assert.equal(visionRangeSquares('day', sheet), 0)
})

check('walls block line of sight; you cannot see through a blocked square', () => {
  const cols = 5
  const rows = 1
  const open = [0, 0, 0, 0, 0]
  const wall = [0, TERRAIN.WALL, 0, 0, 0]
  assert.equal(hasLineOfSight(open, cols, rows, { col: 0, row: 0 }, { col: 4, row: 0 }), true)
  assert.equal(hasLineOfSight(wall, cols, rows, { col: 0, row: 0 }, { col: 4, row: 0 }), false)
  assert.equal(hasLineOfSight(wall, cols, rows, { col: 0, row: 0 }, { col: 1, row: 0 }), true)
  const mask = computeVisionMask({
    cols,
    rows,
    blocked: wall,
    origin: { col: 0, row: 0 },
    rangeSquares: 10,
  })
  assert.equal(mask[0], 1)
  assert.equal(mask[1], 1)
  assert.equal(mask[2], 0)
  assert.equal(mask[4], 0)
})

check('diagonal wall pinch blocks peeking through a corner', () => {
  const cols = 3
  const rows = 3
  const blocked = [
    0, TERRAIN.WALL, 0,
    TERRAIN.WALL, 0, 0,
    0, 0, 0,
  ]
  assert.equal(hasLineOfSight(blocked, cols, rows, { col: 0, row: 0 }, { col: 1, row: 1 }), false)
  assert.equal(hasLineOfSight(blocked, cols, rows, { col: 0, row: 0 }, { col: 2, row: 0 }), false)
})

check('start lighting: night and interior enable fog, day does not', () => {
  assert.equal(lightingFromStart({ lighting: 'night' }), 'night')
  assert.equal(lightingFromStart({ fog: true }), 'night')
  assert.equal(lightingFromStart({}), 'day')
  const night = makeStartFog(2, 2, 'night')
  assert.equal(night.enabled, true)
  assert.equal(night.lighting, 'night')
  assert.deepEqual(night.revealed, [1, 1, 1, 1])
  assert.equal(makeStartFog(2, 2, 'day').enabled, false)
})

check('initiative bonus uses sheet override or Dex mod', () => {
  const sheet = emptySheet()
  sheet.abilities.dex = 16
  assert.equal(initiativeBonusFor({ source: 'character', stats: null }, sheet), 3)
  sheet.initiativeBonus = 5
  assert.equal(initiativeBonusFor({ source: 'character', stats: null }, sheet), 5)
  assert.equal(
    initiativeBonusFor({ source: 'bestiary', stats: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10, savingThrows: '' } }, null),
    2,
  )
})

check('player snapshot applies night vision from the character token', () => {
  const sheet = emptySheet()
  sheet.darkvisionFt = 5
  const fog = makeStartFog(4, 1, 'night')
  const snap = snapshotForPlayer(
    {
      campaign: { id: 'c', dmAccountId: 'd', name: 'T', hub: emptyHub() },
      session: null,
      instance: {
        id: 'i',
        campaignId: 'c',
        encounterTemplateId: null,
        name: 'F',
        status: 'active',
        roundNumber: 1,
        currentTurnPosition: 0,
        fogState: fog,
        mapId: 'm',
        activity: [],
        prompt: null,
      },
      map: {
        id: 'm',
        campaignId: 'c',
        name: 'M',
        imageUrl: '',
        gridCols: 4,
        gridRows: 1,
        gridSize: 70,
        gridType: 'square',
        blocked: [0, 0, 0, 0],
      },
      combatants: [
        {
          id: 'me-c',
          encounterInstanceId: 'i',
          name: 'Elara',
          source: 'character',
          sourceId: 'me',
          initiative: 10,
          hpCurrent: 10,
          hpMax: 10,
          hpTemp: 0,
          ac: 15,
          conditions: [],
          turnOrderPosition: 0,
          color: '#6',
          notes: '',
          constitution: 12,
          stats: null,
          advantageAgainst: [],
          deathState: 'ok',
          deathSuccess: 0,
          deathFail: 0,
          turnEconomy: { action: false, bonus: false, reaction: false, movement: false },
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      tokens: [
        {
          id: 't1',
          encounterInstanceId: 'i',
          x: 35,
          y: 35,
          refType: 'combatant',
          refId: 'me-c',
          label: 'Elara',
          color: '#6',
          sizeSquares: 1,
          visibleToPlayers: true,
        },
        {
          id: 't2',
          encounterInstanceId: 'i',
          x: 35 + 70 * 3,
          y: 35,
          refType: 'combatant',
          refId: 'gob',
          label: 'Goblin',
          color: '#c',
          sizeSquares: 1,
          visibleToPlayers: true,
        },
      ],
      characters: [
        {
          id: 'me',
          campaignId: 'c',
          personalCode: 'ELARA7K2',
          ownerDisplayName: 'A',
          name: 'Elara',
          tokenColor: '#6',
          sourcePdfUrl: null,
          sheet,
        },
      ],
      monsters: [],
    },
    'me',
  )
  assert.equal(snap.instance?.fogState.enabled, true)
  assert.equal(snap.instance?.fogState.revealed[0], 1)
  assert.equal(snap.instance?.fogState.revealed[3], 0)
  assert.deepEqual(snap.tokens.map((t) => t.id), ['t1'])
})

check('player snapshot always keeps your token and the square you stand on', () => {
  const sheet = emptySheet()
  sheet.darkvisionFt = 0
  const n = 4
  const fog = { cols: n, rows: 1, lighting: 'night' as const, enabled: true, revealed: [0, 0, 0, 0] }
  const snap = snapshotForPlayer(
    {
      campaign: { id: 'c', dmAccountId: 'd', name: 'T', hub: emptyHub() },
      session: null,
      instance: {
        id: 'i',
        campaignId: 'c',
        encounterTemplateId: null,
        name: 'F',
        status: 'active',
        roundNumber: 1,
        currentTurnPosition: 0,
        fogState: fog,
        mapId: 'm',
        activity: [],
        prompt: null,
      },
      map: {
        id: 'm',
        campaignId: 'c',
        name: 'M',
        imageUrl: '',
        gridCols: n,
        gridRows: 1,
        gridSize: 70,
        gridType: 'square',
        blocked: [0, 0, 0, 0],
      },
      combatants: [
        {
          id: 'me-c',
          encounterInstanceId: 'i',
          name: 'Berno',
          source: 'character',
          sourceId: 'me',
          initiative: 10,
          hpCurrent: 21,
          hpMax: 21,
          hpTemp: 0,
          ac: 15,
          conditions: [],
          turnOrderPosition: 0,
          color: '#6',
          notes: '',
          constitution: 12,
          stats: null,
          advantageAgainst: [],
          deathState: 'ok',
          deathSuccess: 0,
          deathFail: 0,
          turnEconomy: { action: false, bonus: false, reaction: false, movement: false },
          speedFeet: 30,
          movementRemaining: 30,
        },
      ],
      tokens: [
        {
          id: 'mine',
          encounterInstanceId: 'i',
          x: 35,
          y: 35,
          refType: 'combatant',
          refId: 'me-c',
          label: 'Berno',
          color: '#6',
          sizeSquares: 1,
          visibleToPlayers: true,
        },
        {
          id: 'other',
          encounterInstanceId: 'i',
          x: 105,
          y: 35,
          refType: 'combatant',
          refId: 'gob',
          label: 'Goblin',
          color: '#c',
          sizeSquares: 1,
          visibleToPlayers: true,
        },
      ],
      characters: [
        {
          id: 'me',
          campaignId: 'c',
          personalCode: 'X',
          ownerDisplayName: 'Nico',
          name: 'Berno',
          tokenColor: '#6',
          sourcePdfUrl: null,
          sheet,
        },
      ],
      monsters: [],
    },
    'me',
  )
  assert.equal(snap.instance?.fogState.revealed[0], 1)
  assert.equal(snap.tokens.some((t) => t.id === 'mine'), true)
  assert.equal(snap.tokens.some((t) => t.id === 'other'), false)
})

console.log('all vision/terrain checks passed')
