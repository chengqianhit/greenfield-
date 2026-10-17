import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAccumulator, pointInRing } from '../buildings.mjs'

const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
const building = (x, y, size, type = 'yes') => ({ type: 'Feature', properties: { building: type }, geometry: { type: 'Polygon', coordinates: [ring(x, y, size, size)] } })

test('point in ring', () => {
  assert.ok(pointInRing([0.5, 0.5], ring(0, 0, 1, 1)))
  assert.ok(!pointInRing([1.5, 0.5], ring(0, 0, 1, 1)))
})

test('coverage, homes nearby and nearest home', () => {
  // ~225 m × 222 m ≈ 5 ha site at 35.7°N
  const site = { id: 'a1', lat: 35.701, ha: 5, polygons: [ring(140, 35.7, 0.0025, 0.002)] }
  const acc = createAccumulator([site])
  acc.add(building(140.0005, 35.7005, 0.0005)) // ~45 m × 55 m factory inside
  acc.add(building(140.0028, 35.701, 0.0001, 'house')) // ~27 m east of the edge
  acc.add(building(140.006, 35.701, 0.0001, 'house')) // ~320 m east
  acc.add(building(140.05, 35.701, 0.0001, 'house')) // far away, ignored
  acc.add(building(140.0028, 35.7012, 0.0001, 'yes')) // generic building outside: not a home
  const r = acc.result(site)
  assert.equal(r.buildings, 1)
  assert.ok(r.builtPct > 4 && r.builtPct < 6, `builtPct ${r.builtPct}`)
  assert.equal(r.homesNear, 1)
  assert.ok(r.nearestHomeM > 20 && r.nearestHomeM < 40, `nearest ${r.nearestHomeM}`)
})
