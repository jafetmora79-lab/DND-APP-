import assert from 'node:assert/strict'
import { matchJoinName } from '../src/lib/join-name.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

const party = [
  { name: 'Elara Voss', personalCode: 'ELARA7K2' },
  { name: 'Brok Ironvein', personalCode: 'BROK4M9X' },
]

check('full name and first name join', () => {
  const full = matchJoinName(party, 'Elara Voss')
  const first = matchJoinName(party, '  elara  ')
  const brok = matchJoinName(party, 'Brok')
  assert.equal(full.ok, true)
  assert.equal(first.ok, true)
  assert.equal(brok.ok, true)
  if (first.ok) assert.equal(first.character.name, 'Elara Voss')
  if (brok.ok) assert.equal(brok.character.name, 'Brok Ironvein')
})

check('old personal codes still work', () => {
  const r = matchJoinName(party, 'elara7k2')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.character.name, 'Elara Voss')
})

check('unknown name is rejected', () => {
  const r = matchJoinName(party, 'Gimli')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /No character/)
})

check('ambiguous first names need the full name', () => {
  const two = [{ name: 'Elara Voss' }, { name: 'Elara Swift' }]
  const r = matchJoinName(two, 'Elara')
  assert.equal(r.ok, false)
  const full = matchJoinName(two, 'Elara Swift')
  assert.equal(full.ok, true)
})

check('empty name is rejected', () => {
  const r = matchJoinName(party, '   ')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /Enter your character name/)
})

check('extra spaces still match the full name', () => {
  const r = matchJoinName(party, '  Elara   Voss  ')
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.character.name, 'Elara Voss')
})

check('duplicate exact names are rejected', () => {
  const two = [{ name: 'Elara Voss' }, { name: 'elara voss' }]
  const r = matchJoinName(two, 'Elara Voss')
  assert.equal(r.ok, false)
  if (!r.ok) assert.match(r.error, /share that name/)
})

console.log('all join-name checks passed')
