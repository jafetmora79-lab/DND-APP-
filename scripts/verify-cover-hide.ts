import assert from 'node:assert/strict'
import { emptyTurnEconomy, hasHiddenAdvantage, snapshotForPlayer, tokenHiddenFromPlayers } from '../src/lib/combat.ts'
import { emptyHub } from '../src/lib/campaign-hub.ts'
import { passivePerception, resolveCheck, skillBonusFromSheet } from '../src/lib/checks.ts'
import { canAttemptHide, hideDcFor, isHiding, resolveHideAttempt, withHiding } from '../src/lib/stealth.ts'
import { emptySheet, type Combatant, type MapToken } from '../src/lib/types.ts'
import { isCellBlocked, TERRAIN, terrainEnterCostFeet } from '../src/lib/utils.ts'
import { coverBonusAlongLine, hasLineOfSight } from '../src/lib/vision.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

function combatant(partial: Partial<Combatant> & Pick<Combatant, 'id' | 'name' | 'source'>): Combatant {
  return {
    encounterInstanceId: 'i',
    sourceId: partial.sourceId ?? partial.id,
    initiative: 10,
    hpCurrent: 12,
    hpMax: 12,
    hpTemp: 0,
    ac: 15,
    conditions: [],
    turnOrderPosition: 0,
    color: '#c',
    notes: '',
    constitution: 10,
    stats: null,
    advantageAgainst: [],
    deathState: 'ok',
    deathSuccess: 0,
    deathFail: 0,
    turnEconomy: emptyTurnEconomy(),
    speedFeet: 30,
    movementRemaining: 30,
    ...partial,
  }
}

function token(refId: string, col: number, row: number): MapToken {
  return {
    id: `t-${refId}`,
    encounterInstanceId: 'i',
    x: col * 70 + 35,
    y: row * 70 + 35,
    refType: 'combatant',
    refId,
    label: refId,
    color: '#c',
    sizeSquares: 1,
    visibleToPlayers: true,
  }
}

const map5 = { gridCols: 5, gridRows: 1, gridSize: 70, blocked: [0, 0, 0, 0, 0] }

check('cover: half and three-quarters bonuses; origin square is ignored', () => {
  const half = [TERRAIN.HALF_COVER, TERRAIN.HALF_COVER, 0, 0, 0]
  const three = [0, TERRAIN.THREE_QUARTER_COVER, 0, 0, 0]
  assert.equal(coverBonusAlongLine(half, 5, 1, { col: 0, row: 0 }, { col: 1, row: 0 }), 2)
  assert.equal(coverBonusAlongLine(three, 5, 1, { col: 0, row: 0 }, { col: 1, row: 0 }), 5)
  assert.equal(coverBonusAlongLine([TERRAIN.HALF_COVER, 0, 0, 0, 0], 5, 1, { col: 0, row: 0 }, { col: 4, row: 0 }), 0)
  const mixed = [0, TERRAIN.HALF_COVER, TERRAIN.THREE_QUARTER_COVER, 0, 0]
  assert.equal(coverBonusAlongLine(mixed, 5, 1, { col: 0, row: 0 }, { col: 4, row: 0 }), 5)
})

check('cover: destination square counts (standing in cover)', () => {
  const dest = [0, 0, 0, 0, TERRAIN.HALF_COVER]
  assert.equal(coverBonusAlongLine(dest, 5, 1, { col: 0, row: 0 }, { col: 4, row: 0 }), 2)
})

check('cover is walkable and does not block line of sight', () => {
  const blocked = [0, TERRAIN.HALF_COVER, TERRAIN.THREE_QUARTER_COVER, 0, 0]
  assert.equal(isCellBlocked(blocked, 1, 0, 5, 1), false)
  assert.equal(isCellBlocked(blocked, 2, 0, 5, 1), false)
  assert.equal(terrainEnterCostFeet(TERRAIN.HALF_COVER), 5)
  assert.equal(hasLineOfSight(blocked, 5, 1, { col: 0, row: 0 }, { col: 4, row: 0 }), true)
})

check('skill bonus: proficiency and expertise', () => {
  const sheet = emptySheet()
  sheet.abilities.dex = 14
  sheet.level = 5
  assert.equal(skillBonusFromSheet(sheet, 'stealth'), 2)
  sheet.skillProf.stealth = true
  assert.equal(skillBonusFromSheet(sheet, 'stealth'), 5)
  sheet.skillExpertise.stealth = true
  assert.equal(skillBonusFromSheet(sheet, 'stealth'), 8)
})

check('passive Perception uses 10 + skill; monster senses text wins', () => {
  const pc = combatant({ id: 'p', name: 'Elara', source: 'character', sourceId: 'elara' })
  const sheet = emptySheet()
  sheet.abilities.wis = 12
  sheet.skillProf.perception = true
  sheet.level = 1
  assert.equal(passivePerception(pc, sheet, null), 13)
  const gob = combatant({ id: 'g', name: 'Goblin', source: 'bestiary', sourceId: 'gob' })
  assert.equal(passivePerception(gob, null, { skills: 'Stealth +6', wis: 10, senses: 'darkvision 60 ft., passive Perception 14' }), 14)
})

check('hide DC is the highest passive Perception among opposite-side watchers', () => {
  const hider = combatant({ id: 'p', name: 'Elara', source: 'character', sourceId: 'elara' })
  const gob = combatant({ id: 'g', name: 'Goblin', source: 'bestiary', sourceId: 'gob' })
  const ogre = combatant({ id: 'o', name: 'Ogre', source: 'bestiary', sourceId: 'ogre' })
  const chars = [{ id: 'elara', campaignId: 'c', personalCode: 'x', ownerDisplayName: 'A', name: 'Elara', tokenColor: '#6', sourcePdfUrl: null, sheet: emptySheet() }]
  const dc = hideDcFor(hider, [hider, gob, ogre], chars, [
    { id: 'gob', skills: '', wis: 10, senses: 'passive Perception 9' } as never,
    { id: 'ogre', skills: '', wis: 8, senses: 'passive Perception 16' } as never,
  ])
  assert.equal(dc, 16)
})

check('hide is blocked when an enemy has wall line of sight', () => {
  const hider = combatant({ id: 'p', name: 'Elara', source: 'character', sourceId: 'elara' })
  const gob = combatant({ id: 'g', name: 'Goblin', source: 'bestiary', sourceId: 'gob' })
  const open = { ...map5, blocked: [0, 0, 0, 0, 0] }
  const tokens = [token('p', 0, 0), token('g', 4, 0)]
  const gate = canAttemptHide(hider, [hider, gob], tokens, open)
  assert.equal(gate.ok, false)
})

check('hide is allowed when a wall breaks enemy line of sight', () => {
  const hider = combatant({ id: 'p', name: 'Elara', source: 'character', sourceId: 'elara' })
  const gob = combatant({ id: 'g', name: 'Goblin', source: 'bestiary', sourceId: 'gob' })
  const walled = { ...map5, blocked: [0, TERRAIN.WALL, 0, 0, 0] }
  const tokens = [token('p', 0, 0), token('g', 4, 0)]
  const gate = canAttemptHide(hider, [hider, gob], tokens, walled)
  assert.equal(gate.ok, true)
  const sheet = emptySheet()
  sheet.abilities.dex = 16
  const fail = resolveHideAttempt({
    hider,
    combatants: [hider, gob],
    tokens,
    map: walled,
    characters: [{ id: 'elara', campaignId: 'c', personalCode: 'x', ownerDisplayName: 'A', name: 'Elara', tokenColor: '#6', sourcePdfUrl: null, sheet }],
    monsters: [{ id: 'gob', skills: '', wis: 10, senses: 'passive Perception 11' } as never],
    d20: 1,
    sheet,
    monster: null,
  })
  assert.equal(fail.ok, true)
  assert.equal(fail.success, false)
  const win = resolveHideAttempt({
    hider,
    combatants: [hider, gob],
    tokens,
    map: walled,
    characters: [{ id: 'elara', campaignId: 'c', personalCode: 'x', ownerDisplayName: 'A', name: 'Elara', tokenColor: '#6', sourcePdfUrl: null, sheet }],
    monsters: [{ id: 'gob', skills: '', wis: 10, senses: 'passive Perception 11' } as never],
    d20: 20,
    sheet,
    monster: null,
  })
  assert.equal(win.success, true)
})

check('hiding tokens are masked from other players but not the owner or DM', () => {
  const fog = { cols: 4, rows: 1, enabled: false, revealed: [1, 1, 1, 1] }
  const hidden = combatant({ id: 'p', name: 'Elara', source: 'character', sourceId: 'elara', conditions: withHiding([]) })
  const tok = { x: 35, y: 35, visibleToPlayers: true, refId: 'p' }
  assert.equal(tokenHiddenFromPlayers(tok, fog, 70, true, { viewerCharacterId: 'brok', combatants: [hidden] }), false)
  assert.equal(tokenHiddenFromPlayers(tok, fog, 70, false, { viewerCharacterId: 'elara', combatants: [hidden] }), false)
  assert.equal(tokenHiddenFromPlayers(tok, fog, 70, false, { viewerCharacterId: 'brok', combatants: [hidden] }), true)
  assert.equal(isHiding(hidden), true)
  assert.equal(hasHiddenAdvantage(hidden, 'g'), true)
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
      map: { id: 'm', campaignId: 'c', name: 'M', imageUrl: '', gridCols: 4, gridRows: 1, gridSize: 70, gridType: 'square', blocked: [] },
      combatants: [hidden],
      tokens: [
        {
          id: 't1',
          encounterInstanceId: 'i',
          x: 35,
          y: 35,
          refType: 'combatant',
          refId: 'p',
          label: 'Elara',
          color: '#6',
          sizeSquares: 1,
          visibleToPlayers: true,
        },
      ],
      characters: [
        { id: 'elara', campaignId: 'c', personalCode: 'ELARA7K2', ownerDisplayName: 'A', name: 'Elara', tokenColor: '#6', sourcePdfUrl: null, sheet: emptySheet() },
        { id: 'brok', campaignId: 'c', personalCode: 'BROK4M9X', ownerDisplayName: 'B', name: 'Brok', tokenColor: '#b', sourcePdfUrl: null, sheet: emptySheet() },
      ],
    },
    'brok',
  )
  assert.equal(snap.tokens.length, 0)
})

check('resolveCheck matches save math (total >= DC)', () => {
  const r = resolveCheck({ d20: 10, modifier: 3, dc: 13, label: 'Athletics' })
  assert.equal(r.success, true)
  assert.equal(r.total, 13)
  const miss = resolveCheck({ d20: 10, modifier: 2, dc: 13 })
  assert.equal(miss.success, false)
})

console.log('all cover/hide checks passed')
