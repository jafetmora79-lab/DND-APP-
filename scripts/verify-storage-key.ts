import assert from 'node:assert/strict'
import { safeStorageFileName, storageObjectPath } from '../src/lib/storage-key.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

check('strips spaces, em dashes, and parentheses from map filenames', () => {
  const out = safeStorageFileName('Map 03b — Convergence City Rooftop (landscape).png')
  assert.equal(out, 'Map-03b-Convergence-City-Rooftop-landscape.png')
  assert.doesNotMatch(out, / |—|\(|\)/)
})

check('storage path keeps folder ids and a unique prefix', () => {
  const path = storageObjectPath('9f362c97-3d52-4e61-90f2-c71ac0f16c64/ambiance', 'Map 03b — Convergence City Rooftop (landscape).png')
  assert.match(path, /^9f362c97-3d52-4e61-90f2-c71ac0f16c64\/ambiance\/.+-Map-03b-Convergence-City-Rooftop-landscape\.png$/)
  assert.doesNotMatch(path, / |—|\(|\)/)
})

console.log('all storage-key checks passed')
