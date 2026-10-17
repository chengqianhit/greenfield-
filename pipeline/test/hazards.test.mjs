import { test } from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { LAYERS, TileReader, Z, assess, demHeight, depthClass, landslideClass, samplePixels } from '../hazards.mjs'

const ring = (x, y, w, h) => [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]
const site = { id: 'a1', lon: 140.0012, lat: 35.7010, polygons: [ring(140, 35.7, 0.0025, 0.002)] }

test('pixel classifiers', () => {
  assert.equal(depthClass([0, 0, 0, 0]), -1)
  assert.equal(depthClass([255, 215, 190, 255]), 1) // 0.5–3 m
  assert.equal(depthClass([221, 120, 221, 255]), 5) // ≥20 m
  assert.equal(landslideClass([255, 230, 0, 255]), 1)
  assert.equal(landslideClass([230, 30, 30, 255]), 2)
  assert.equal(landslideClass([0, 0, 0, 0]), 0)
  assert.equal(demHeight([0, 39, 16]), 100) // 10000 × 0.01
  assert.equal(demHeight([128, 0, 0]), null)
  assert.equal(demHeight([255, 255, 255]), -0.01)
})

test('samples pixels inside the site', () => {
  const px = samplePixels(site)
  assert.ok(px.length > 200 && px.length <= 600, `${px.length} samples`) // ~5 ha at ~9.5 m pixels
})

// Fake tile server: solid-colour hazard tiles and a DEM rising 1 m per pixel eastwards.
async function fakeFetch(url) {
  const solid = (rgba) => sharp({ create: { width: 256, height: 256, channels: 4, background: { r: rgba[0], g: rgba[1], b: rgba[2], alpha: rgba[3] / 255 } } }).png().toBuffer()
  if (url.startsWith(LAYERS.flood)) return new Response(await solid([255, 216, 192, 255]))
  if (url.startsWith(LAYERS.debris)) return new Response(await solid([255, 230, 0, 255]))
  if (url.startsWith(LAYERS.dem)) {
    const tx = Number(url.split('/').at(-2))
    const raw = Buffer.alloc(256 * 256 * 3)
    for (let y = 0; y < 256; y++)
      for (let x = 0; x < 256; x++) {
        const v = (tx * 256 + x) % 100000 * 100 // 1 m per pixel, in 0.01 m units
        raw.set([(v >> 16) & 255, (v >> 8) & 255, v & 255], (y * 256 + x) * 3)
      }
    return new Response(await sharp(raw, { raw: { width: 256, height: 256, channels: 3 } }).png().toBuffer())
  }
  return new Response('not found', { status: 404 })
}

test('assess combines hazard layers and slope', async () => {
  const r = await assess(site, new TileReader(fakeFetch))
  assert.equal(r.flood, '0.5-3')
  assert.equal(r.tsunami, null)
  assert.equal(r.landslide, 'warning')
  const m = (156543.03392 * Math.cos((35.701 * Math.PI) / 180)) / 2 ** Z
  assert.ok(Math.abs(r.slopePct - 100 / m) < 1, `slope ${r.slopePct} vs ${100 / m}`)
  assert.equal(r.steepPct, 0)
})
