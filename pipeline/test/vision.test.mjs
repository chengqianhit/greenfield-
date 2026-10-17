import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shortlist, viewport, Verdict } from '../vision.mjs'

const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]

test('viewport fits small sites at high zoom and large ones lower', () => {
  const small = viewport({ polygons: [ring(140, 35.7, 0.002, 0.002)] })
  const big = viewport({ polygons: [ring(140, 35.7, 0.03, 0.03)] })
  assert.ok(small.z >= 17, `small z ${small.z}`)
  assert.ok(big.z < small.z)
  assert.ok(small.size >= 512 && small.size <= 1024)
})

test('shortlist skips occupied and built-up sites and prefers high voltage', () => {
  const base = { polygons: [], ha: 10, status: 'unknown', dd: { builtPct: 0 } }
  const sites = [
    { ...base, id: 'a', sub: { kv: 66, m: 100 } },
    { ...base, id: 'b', sub: { kv: 275, m: 900 } },
    { ...base, id: 'c', sub: { kv: 500, m: 100 }, status: 'occupied' },
    { ...base, id: 'd', sub: { kv: 500, m: 100 }, dd: { builtPct: 60 } },
    { ...base, id: 'e', sub: null },
  ]
  assert.deepEqual(shortlist(sites).map((s) => s.id), ['b', 'a'])
})

test('verdict schema accepts a well-formed answer', () => {
  const v = Verdict.parse({ occupancy: 'empty', builtPct: 0, cover: ['grass'], terrain: 'flat', homesAdjacent: false, suitability: 8, note: '平坦草地' })
  assert.equal(v.occupancy, 'empty')
})
