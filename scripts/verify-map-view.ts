import assert from 'node:assert/strict'
import { clampMapScale, fitMapView, mapScaleLimits, zoomAtPoint } from '../src/lib/map-view.ts'

function check(name: string, fn: () => void) {
  fn()
  console.log(`ok  ${name}`)
}

check('small map in a large viewport scales up to fit', () => {
  const view = fitMapView(800, 600, 200, 200)
  assert.ok(view.scale > 1)
  assert.ok(200 * view.scale <= 800 - 32 + 0.01)
  assert.ok(200 * view.scale <= 600 - 32 + 0.01)
})

check('huge map in a phone viewport scales down so the whole map is visible', () => {
  const worldW = 80 * 40
  const worldH = 80 * 40
  const view = fitMapView(360, 520, worldW, worldH)
  assert.ok(view.scale < 1)
  assert.ok(worldW * view.scale <= 360)
  assert.ok(worldH * view.scale <= 520)
})

check('wide map fits width, tall map fits height', () => {
  const wide = fitMapView(400, 400, 800, 200)
  assert.ok(Math.abs(wide.scale - (400 - 32) / 800) < 1e-9)
  const tall = fitMapView(400, 400, 200, 800)
  assert.ok(Math.abs(tall.scale - (400 - 32) / 800) < 1e-9)
})

check('cannot zoom out past a fitted view', () => {
  const { min, fit } = mapScaleLimits(360, 520, 3200, 3200)
  assert.equal(min, fit)
  assert.equal(clampMapScale(0.001, 360, 520, 3200, 3200), min)
})

check('zoom keeps the world point under the cursor', () => {
  const pos = { x: 10, y: 20 }
  const point = { x: 100, y: 80 }
  const next = zoomAtPoint(0.5, 1, pos, point)
  const worldX = (point.x - pos.x) / 0.5
  const worldY = (point.y - pos.y) / 0.5
  assert.ok(Math.abs((point.x - next.x) / next.scale - worldX) < 1e-9)
  assert.ok(Math.abs((point.y - next.y) / next.scale - worldY) < 1e-9)
})

console.log('all map-view checks passed')
