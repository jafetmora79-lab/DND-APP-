import assert from 'node:assert/strict'
import {
  afterHpChange,
  attackOutcome,
  canTakeAttacks,
  characterSaveBonus,
  effectiveRollMode,
  emptyTurnEconomy,
  formatDiceUsed,
  monsterSaveBonus,
  movementCostFeet,
  parseCombatantStats,
  parseDeathState,
  parseRollMode,
  parseSpeedFeet,
  parseTurnEconomy,
  pickUsedD20,
  resolveDeathSave,
  resolveSavingThrow,
  saveBonusForCombatant,
  spendMovement,
} from '../src/lib/combat.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

check('normal hit requires strictly higher than AC', () => {
  assert.equal(attackOutcome(10, 5, 15), 'miss')
  assert.equal(attackOutcome(11, 5, 15), 'hit')
  assert.equal(attackOutcome(20, 0, 99), 'crit')
  assert.equal(attackOutcome(1, 99, 1), 'fumble')
})

check('advantage uses the higher d20', () => {
  const d = pickUsedD20(8, 17, 'advantage')
  assert.equal(d.used, 17)
  assert.equal(formatDiceUsed(d.a, d.b, d.used), '8 / 17 → 17 used')
})

check('disadvantage uses the lower d20', () => {
  const d = pickUsedD20(17, 8, 'disadvantage')
  assert.equal(d.used, 8)
  assert.equal(formatDiceUsed(d.a, d.b, d.used), '17 / 8 → 8 used')
})

check('normal ignores second die', () => {
  const d = pickUsedD20(12, 20, 'normal')
  assert.equal(d.used, 12)
  assert.equal(d.b, null)
  assert.equal(formatDiceUsed(d.a, d.b, d.used), '12')
})

check('stored advantage plus disadvantage cancel', () => {
  assert.equal(effectiveRollMode('disadvantage', true), 'normal')
  assert.equal(effectiveRollMode('normal', true), 'advantage')
  assert.equal(effectiveRollMode('advantage', true), 'advantage')
  assert.equal(parseRollMode('nope'), 'normal')
})

check('saving throw display math', () => {
  const r = resolveSavingThrow({ d20: 12, modifier: 3, dc: 15 })
  assert.equal(r.total, 15)
  assert.equal(r.success, true)
  assert.match(r.message, /success/)
  const f = resolveSavingThrow({ d20: 4, modifier: 2, dc: 13 })
  assert.equal(f.success, false)
  assert.equal(characterSaveBonus(16, true, 3), 6)
  assert.equal(monsterSaveBonus('Dex +5', 'dex', 10), 5)
  assert.equal(monsterSaveBonus('', 'str', 16), 3)
  const goblin = {
    stats: parseCombatantStats({ dex: 16, str: 8, con: 10, int: 10, wis: 8, cha: 8, savingThrows: 'Dex +4' }),
    constitution: 10,
    source: 'bestiary' as const,
  }
  assert.equal(saveBonusForCombatant(goblin, 'dex', null), 4)
  assert.equal(saveBonusForCombatant(goblin, 'str', null), -1)
  assert.equal(
    saveBonusForCombatant({ stats: null, constitution: 14, source: 'bestiary' }, 'con', {
      con: 18,
      savingThrows: 'Con +6',
    }),
    6,
  )
  assert.equal(saveBonusForCombatant({ stats: null, constitution: 14, source: 'bestiary' }, 'con', null), 2)
})

check('unconscious and dying at 0 HP', () => {
  const first = afterHpChange({
    source: 'character',
    prevHp: 8,
    nextHp: 0,
    conditions: [],
    deathState: 'ok',
    deathSuccess: 0,
    deathFail: 0,
  })
  assert.ok(first.conditions.includes('Unconscious'))
  assert.equal(first.deathState, 'dying')
  const monster = afterHpChange({
    source: 'bestiary',
    prevHp: 4,
    nextHp: 0,
    conditions: [],
    deathState: 'ok',
    deathSuccess: 0,
    deathFail: 0,
  })
  assert.ok(monster.conditions.includes('Unconscious'))
  assert.equal(monster.deathState, 'ok')
  const heal = afterHpChange({
    source: 'bestiary',
    prevHp: 0,
    nextHp: 5,
    conditions: ['Unconscious', 'Prone'],
    deathState: 'ok',
    deathSuccess: 0,
    deathFail: 0,
  })
  assert.deepEqual(heal.conditions, ['Prone'])
})

check('damage while dying adds failures', () => {
  const r = afterHpChange({
    source: 'character',
    prevHp: 0,
    nextHp: 0,
    conditions: ['Unconscious'],
    deathState: 'dying',
    deathSuccess: 1,
    deathFail: 1,
    extraDeathFails: 2,
  })
  assert.equal(r.deathFail, 3)
  assert.equal(r.deathState, 'dead')
})

check('death save success, failure, nat 20, nat 1, reset path', () => {
  const ok = resolveDeathSave(14, { deathSuccess: 0, deathFail: 0, deathState: 'dying' })
  assert.equal(ok.deathSuccess, 1)
  assert.equal(ok.deathState, 'dying')
  const fail = resolveDeathSave(7, { deathSuccess: 0, deathFail: 2, deathState: 'dying' })
  assert.equal(fail.deathFail, 3)
  assert.equal(fail.deathState, 'dead')
  const nat20 = resolveDeathSave(20, { deathSuccess: 2, deathFail: 2, deathState: 'dying' })
  assert.equal(nat20.deathState, 'ok')
  assert.equal(nat20.hpCurrent, 1)
  assert.equal(nat20.revived, true)
  const nat1 = resolveDeathSave(1, { deathSuccess: 0, deathFail: 1, deathState: 'dying' })
  assert.equal(nat1.deathFail, 3)
  assert.equal(nat1.deathState, 'dead')
  const stable = resolveDeathSave(11, { deathSuccess: 2, deathFail: 0, deathState: 'dying' })
  assert.equal(stable.deathState, 'stable')
  assert.equal(parseDeathState('dying'), 'dying')
})

check('turn economy parse and attack block', () => {
  assert.deepEqual(parseTurnEconomy({ action: true }), { ...emptyTurnEconomy(), action: true })
  assert.equal(canTakeAttacks({ conditions: ['Unconscious'], deathState: 'ok' }), false)
  assert.equal(canTakeAttacks({ conditions: [], deathState: 'dying' }), false)
  assert.equal(canTakeAttacks({ conditions: [], deathState: 'ok' }), true)
})

check('per-turn movement uses the 5-ft Chebyshev grid', () => {
  assert.equal(parseSpeedFeet('30 ft.'), 30)
  assert.equal(parseSpeedFeet('25 ft., fly 60 ft.'), 25)
  assert.equal(parseSpeedFeet(''), 30)
  assert.equal(movementCostFeet({ col: 0, row: 0 }, { col: 1, row: 0 }), 5)
  assert.equal(movementCostFeet({ col: 0, row: 0 }, { col: 2, row: 1 }), 10)
  assert.equal(movementCostFeet({ col: 3, row: 3 }, { col: 4, row: 4 }), 5)
  let remaining = 30
  remaining = spendMovement(remaining, 5).remaining
  remaining = spendMovement(remaining, 10).remaining
  assert.equal(remaining, 15)
  const blocked = spendMovement(remaining, 20)
  assert.equal(blocked.ok, false)
  assert.match(blocked.error ?? '', /Not enough movement/)
  assert.equal(blocked.remaining, 15)
  assert.equal(spendMovement(30, 0).remaining, 30)
})

console.log('all combat checks passed')
