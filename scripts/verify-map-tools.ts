import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { aoeAngleDeg, aoeCoveredCells, aoeLengthFeet, CONE_FULL_ANGLE_DEG, distanceFeet, type AoeShape } from '../src/lib/aoe.ts'
import { PROP_CATALOG, PROP_CATEGORY_LABEL, propDef } from '../src/lib/props.ts'
import { parseMapProps } from '../src/lib/utils.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8')

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

const keys = (cells: { col: number; row: number }[]) => cells.map((c) => `${c.col},${c.row}`).sort()

// Ruler + AoE length -----------------------------------------------------------

check('ruler: one grid square is 5 ft, diagonals are true distance', () => {
  assert.equal(distanceFeet(0, 0, 150, 0, 50), 15)
  assert.equal(distanceFeet(0, 0, 30, 40, 10), 25)
  assert.equal(distanceFeet(10, 10, 10, 10, 50), 0)
})

check('AoE length uses the same conversion as the ruler', () => {
  const shape: AoeShape = { kind: 'cone', originX: 0, originY: 0, endX: 90, endY: 120, widthFeet: 5 }
  assert.equal(aoeLengthFeet(shape, 50), distanceFeet(0, 0, 90, 120, 50))
  assert.equal(aoeLengthFeet(shape, 50), 15)
})

check('AoE angle points from origin to end', () => {
  assert.equal(aoeAngleDeg({ kind: 'line', originX: 0, originY: 0, endX: 10, endY: 0 }), 0)
  assert.equal(aoeAngleDeg({ kind: 'line', originX: 0, originY: 0, endX: 0, endY: 10 }), 90)
})

// AoE coverage -----------------------------------------------------------------

check('zero-length AoE covers nothing', () => {
  assert.deepEqual(aoeCoveredCells({ kind: 'circle', originX: 100, originY: 100, endX: 100, endY: 100 }, 50, 10, 10), [])
})

check('10-ft-radius circle on a grid corner covers the four touching squares', () => {
  const cells = aoeCoveredCells({ kind: 'circle', originX: 250, originY: 250, endX: 300, endY: 250 }, 50, 10, 10)
  assert.deepEqual(keys(cells), ['4,4', '4,5', '5,4', '5,5'])
})

check('cube covers the squares whose centers sit inside it', () => {
  const cells = aoeCoveredCells({ kind: 'cube', originX: 100, originY: 100, endX: 200, endY: 200 }, 50, 10, 10)
  assert.deepEqual(keys(cells), ['2,2', '2,3', '3,2', '3,3'])
})

check('5-ft-wide line covers one row of squares along its length', () => {
  const cells = aoeCoveredCells({ kind: 'line', originX: 0, originY: 125, endX: 500, endY: 125 }, 50, 10, 10)
  assert.equal(cells.length, 10)
  assert.ok(cells.every((c) => c.row === 2))
})

check('wider line covers more rows', () => {
  const cells = aoeCoveredCells({ kind: 'line', originX: 0, originY: 125, endX: 500, endY: 125, widthFeet: 15 }, 50, 10, 10)
  assert.deepEqual([...new Set(cells.map((c) => c.row))].sort(), [1, 2, 3])
})

check('cone follows the 5e rule: width equals distance from the origin', () => {
  assert.ok(Math.abs(CONE_FULL_ANGLE_DEG - 53.13) < 0.01)
  const cells = aoeCoveredCells({ kind: 'cone', originX: 0, originY: 125, endX: 300, endY: 125 }, 50, 10, 10)
  const set = new Set(keys(cells))
  // Centerline: every square out to 30 ft.
  for (let c = 0; c <= 5; c++) assert.ok(set.has(`${c},2`), `centerline ${c}`)
  assert.ok(!set.has('6,2'), 'past the end')
  // One square off-center (10 ft): only once the cone is 20 ft wide, from 10 ft out.
  assert.ok(!set.has('1,1') && set.has('2,1') && set.has('2,3'))
  // Two squares off-center (20 ft): only from 20 ft out.
  assert.ok(!set.has('3,0') && set.has('4,0') && set.has('4,4'))
  assert.equal(cells.length, 18)
})

// Props ------------------------------------------------------------------------

check('prop catalog ids are unique and every category has a label', () => {
  const ids = PROP_CATALOG.map((p) => p.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const p of PROP_CATALOG) assert.ok(PROP_CATEGORY_LABEL[p.category], p.id)
})

check('every catalog prop has an image, and every image is in the catalog', () => {
  const files = fs.readdirSync(path.join(root, 'public/props')).filter((f) => f.endsWith('.png'))
  const onDisk = new Set(files.map((f) => f.replace(/\.png$/, '')))
  for (const p of PROP_CATALOG) assert.ok(onDisk.has(p.id), `missing public/props/${p.id}.png`)
  const inCatalog = new Set(PROP_CATALOG.map((p) => p.id))
  for (const id of onDisk) assert.ok(inCatalog.has(id), `public/props/${id}.png is not in PROP_CATALOG`)
})

check('propDef looks up by id', () => {
  assert.equal(propDef('storage_crate')?.label, 'Crate')
  assert.equal(propDef('nope'), undefined)
})

check('parseMapProps reads stored JSON and drops malformed entries', () => {
  const stored = JSON.stringify([
    { id: 'a', propId: 'storage_crate', x: 10.5, y: 20 },
    { id: 'b', propId: 'nature_bush', x: '30', y: '40' },
    { id: '', propId: 'storage_crate', x: 1, y: 1 },
    { id: 'c', propId: 'storage_crate', x: 'left', y: 1 },
    { id: 'd', x: 1, y: 1 },
    null,
    'crate',
  ])
  assert.deepEqual(parseMapProps(stored), [
    { id: 'a', propId: 'storage_crate', x: 10.5, y: 20 },
    { id: 'b', propId: 'nature_bush', x: 30, y: 40 },
  ])
})

check('parseMapProps accepts arrays (Supabase jsonb) and survives junk', () => {
  assert.deepEqual(parseMapProps([{ id: 'a', propId: 'light_brazier', x: 0, y: 0 }]), [{ id: 'a', propId: 'light_brazier', x: 0, y: 0 }])
  assert.deepEqual(parseMapProps('not json'), [])
  assert.deepEqual(parseMapProps({ id: 'a' }), [])
  assert.deepEqual(parseMapProps(null), [])
  assert.deepEqual(parseMapProps(undefined), [])
})

// Props + paint persistence on both backends -------------------------------------

check('local SQLite stores props_json and paint_url and migrates old databases', () => {
  const db = read('server/db.ts')
  const mapsTable = db.match(/CREATE TABLE IF NOT EXISTS maps \(([\s\S]*?)\);/)?.[1] ?? ''
  assert.match(mapsTable, /props_json TEXT NOT NULL DEFAULT '\[\]'/)
  assert.match(mapsTable, /paint_url TEXT NOT NULL DEFAULT ''/)
  assert.match(db, /ALTER TABLE maps ADD COLUMN props_json/)
  assert.match(db, /ALTER TABLE maps ADD COLUMN paint_url/)
  assert.match(db, /props: parseMapProps\(row\.props_json\)/)
  assert.match(db, /paintUrl: String\(row\.paint_url/)
})

check('local API saves props and paint on map PATCH and has a paint upload route', () => {
  const index = read('server/index.ts')
  assert.match(index, /UPDATE maps SET [^']*props_json=\?[^']*paint_url=\?/)
  assert.match(index, /app\.post\('\/api\/maps\/:id\/paint'/)
})

check('Supabase schema, migrate files, and error hints agree on props_json / paint_url', () => {
  const schema = read('supabase/schema.sql')
  assert.match(schema, /props_json jsonb not null default '\[\]'::jsonb/)
  assert.match(schema, /paint_url text not null default ''/)
  assert.match(read('supabase/migrate-map-props.sql'), /add column if not exists props_json/)
  assert.match(read('supabase/migrate-map-paint.sql'), /add column if not exists paint_url/)
  const api = read('src/lib/supabase-api.ts')
  assert.match(api, /props_json: 'migrate-map-props\.sql'/)
  assert.match(api, /paint_url: 'migrate-map-paint\.sql'/)
})

console.log('all map-tool checks passed')
