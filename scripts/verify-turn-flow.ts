import assert from 'node:assert/strict'
import { isFightSetup } from '../src/lib/session.ts'
import type { EncounterInstance, LiveSession } from '../src/lib/types.ts'
import { applyShortRestHp, canActThisTurn, firstActingPosition, nextActingPosition, sortByInitiative, standingEnemies, type CombatantLike } from '../src/lib/turn-flow.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

function c(partial: Partial<CombatantLike> & { id: string; name: string }): CombatantLike {
  return {
    source: 'bestiary',
    initiative: 0,
    hpCurrent: 10,
    conditions: [],
    turnOrderPosition: 0,
    deathState: 'ok',
    stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, savingThrows: '' },
    ...partial,
  }
}

check('sort initiative then dex then name', () => {
  const rows = [
    c({ id: 'a', name: 'Ada', initiative: 15, stats: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, savingThrows: '' } }),
    c({ id: 'b', name: 'Brok', initiative: 15, stats: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10, savingThrows: '' } }),
    c({ id: 'd', name: 'Zed', initiative: 12, stats: { str: 10, dex: 20, con: 10, int: 10, wis: 10, cha: 10, savingThrows: '' } }),
    c({ id: 'e', name: 'Ann', initiative: 15, stats: { str: 10, dex: 16, con: 10, int: 10, wis: 10, cha: 10, savingThrows: '' } }),
  ]
  const sorted = sortByInitiative(rows)
  assert.deepEqual(sorted.map((x) => x.id), ['e', 'b', 'a', 'd'])
})

check('dead and dropped monsters do not act; dying PCs do', () => {
  assert.equal(canActThisTurn(c({ id: '1', name: 'Goblin', hpCurrent: 0 }), 1), false)
  assert.equal(canActThisTurn(c({ id: '2', name: 'Goblin', deathState: 'dead', hpCurrent: 0 }), 1), false)
  assert.equal(
    canActThisTurn(c({ id: '3', name: 'Elara', source: 'character', deathState: 'dying', hpCurrent: 0 }), 1),
    true,
  )
  assert.equal(canActThisTurn(c({ id: '4', name: 'Goblin', conditions: ['Surprised'] }), 1), false)
  assert.equal(canActThisTurn(c({ id: '5', name: 'Goblin', conditions: ['Surprised'] }), 2), true)
})

check('next turn skips corpses and wraps the round', () => {
  const rows = [
    c({ id: 'pc', name: 'Elara', source: 'character', turnOrderPosition: 0 }),
    c({ id: 'dead', name: 'Goblin', turnOrderPosition: 1, hpCurrent: 0, deathState: 'dead' }),
    c({ id: 'wolf', name: 'Wolf', turnOrderPosition: 2 }),
  ]
  const next = nextActingPosition(rows, 0, 1)
  assert.equal(next.position, 2)
  assert.equal(next.round, 1)
  assert.equal(next.wrapped, false)
  const wrap = nextActingPosition(rows, 2, 1)
  assert.equal(wrap.position, 0)
  assert.equal(wrap.round, 2)
  assert.equal(wrap.wrapped, true)
})

check('first actor skips surprised party on round 1', () => {
  const rows = [
    c({ id: 'pc', name: 'Elara', source: 'character', turnOrderPosition: 0, conditions: ['Surprised'] }),
    c({ id: 'gob', name: 'Goblin', turnOrderPosition: 1 }),
  ]
  const first = firstActingPosition(rows, 1)
  assert.equal(first.position, 1)
  assert.equal(first.round, 1)
})

check('all surprised wraps to round 2', () => {
  const rows = [
    c({ id: 'a', name: 'A', turnOrderPosition: 0, conditions: ['Surprised'] }),
    c({ id: 'b', name: 'B', turnOrderPosition: 1, conditions: ['Surprised'] }),
  ]
  const first = firstActingPosition(rows, 1)
  assert.equal(first.round, 2)
  assert.equal(first.position, 0)
  assert.equal(first.wrapped, true)
})

check('standing enemies ignore downed monsters', () => {
  const rows = [
    c({ id: 'g', name: 'Goblin', hpCurrent: 0 }),
    c({ id: 'w', name: 'Wolf', hpCurrent: 4 }),
    c({ id: 'pc', name: 'Elara', source: 'character', hpCurrent: 12 }),
  ]
  assert.equal(standingEnemies(rows).length, 1)
  assert.equal(standingEnemies(rows)[0].id, 'w')
})

check('short rest hp is typed and capped', () => {
  assert.equal(applyShortRestHp(4, 10, 3), 7)
  assert.equal(applyShortRestHp(8, 10, 9), 10)
  assert.equal(applyShortRestHp(2, 10, -4), 2)
})

function inst(round: number): EncounterInstance {
  return {
    id: 'i',
    campaignId: 'c',
    encounterTemplateId: null,
    name: 'Fight',
    status: 'paused',
    roundNumber: round,
    currentTurnPosition: 0,
    fogState: { cols: 1, rows: 1, enabled: false, revealed: [1] },
    mapId: 'm',
    activity: [],
    prompt: null,
  }
}

function sess(phase: LiveSession['tablePhase']): LiveSession {
  return {
    id: 's',
    joinCode: 'HEARTH',
    campaignId: 'c',
    encounterInstanceId: 'i',
    tablePhase: phase,
    ambianceImageUrl: null,
    ambianceCaption: '',
    lastOutcome: null,
  }
}

check('setup survives returning to the hub (round 0)', () => {
  assert.equal(isFightSetup(sess('table'), inst(0)), true)
  assert.equal(isFightSetup(sess('combat'), inst(0)), true)
  assert.equal(isFightSetup(sess('setup'), inst(0)), true)
  assert.equal(isFightSetup(sess('combat'), inst(1)), false)
  assert.equal(isFightSetup(sess('victory'), inst(0)), false)
})

console.log('all turn-flow checks passed')
