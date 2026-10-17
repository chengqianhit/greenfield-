// Samples public rasters inside each site: hazard maps (flood, tsunami, landslide),
// GSI elevation for slope, and ESA WorldCover land cover. Results are cached per
// site so only new sites hit the tile servers.
//
//   node hazards.mjs <sites.json> <hazard-cache.json>

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import sharp from 'sharp'
import { fromUrl } from 'geotiff'
import { pointInRing } from './buildings.mjs'

export const Z = 14 // ≈9.5 m/px at 35°N: enough for screening, few tiles per site
const MAX_SAMPLES = 400
const DISAPORTAL = 'https://disaportaldata.gsi.go.jp/raster'
export const LAYERS = {
  flood: `${DISAPORTAL}/01_flood_l2_shinsuishin_data`,
  tsunami: `${DISAPORTAL}/04_tsunami_newlegend_data`,
  debris: `${DISAPORTAL}/05_dosekiryukeikaikuiki`,
  steep: `${DISAPORTAL}/05_kyukeishakeikaikuiki`,
  slide: `${DISAPORTAL}/05_jisuberikeikaikuiki`,
  dem: 'https://cyberjapandata.gsi.go.jp/xyz/dem_png',
}
const WORLDCOVER = (tile) => `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_${tile}_Map.tif`

// 浸水深 palette (MLIT standard); pixels are matched to the nearest colour.
export const DEPTH_CLASSES = [
  { label: '<0.5', rgb: [247, 245, 169] },
  { label: '0.5-3', rgb: [255, 216, 192] },
  { label: '3-5', rgb: [255, 183, 183] },
  { label: '5-10', rgb: [255, 145, 145] },
  { label: '10-20', rgb: [242, 133, 201] },
  { label: '20+', rgb: [220, 122, 220] },
]

export function depthClass([r, g, b, a]) {
  if (a < 128) return -1
  let best = -1, bestD = Infinity
  DEPTH_CLASSES.forEach((c, i) => {
    const d = (r - c.rgb[0]) ** 2 + (g - c.rgb[1]) ** 2 + (b - c.rgb[2]) ** 2
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

// 土砂災害: yellow = 警戒区域, red = 特別警戒区域.
export function landslideClass([r, g, b, a]) {
  if (a < 128) return 0
  return r > 180 && g < 120 && b < 120 ? 2 : 1
}

// GSI DEM PNG: x = R·65536 + G·256 + B; h = x·0.01 (two's complement at 2^23); 2^23 = no data.
export function demHeight([r, g, b]) {
  const x = r * 65536 + g * 256 + b
  if (x === 2 ** 23) return null
  return (x < 2 ** 23 ? x : x - 2 ** 24) * 0.01
}

const lon2px = (lon) => ((lon + 180) / 360) * 2 ** Z * 256
const lat2px = (lat) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** Z * 256
}
const px2lon = (x) => (x / (2 ** Z * 256)) * 360 - 180
const px2lat = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / (2 ** Z * 256)))) * 180) / Math.PI

// Global pixel coordinates at zoom Z whose centres fall inside the site.
export function samplePixels(site) {
  const pts = site.polygons.flat()
  const xs = pts.map((p) => lon2px(p[0])), ys = pts.map((p) => lat2px(p[1]))
  const [x0, x1, y0, y1] = [Math.floor(Math.min(...xs)), Math.ceil(Math.max(...xs)), Math.floor(Math.min(...ys)), Math.ceil(Math.max(...ys))]
  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / MAX_SAMPLES)))
  const out = []
  for (let x = x0; x <= x1; x += step)
    for (let y = y0; y <= y1; y += step) {
      const p = [px2lon(x + 0.5), px2lat(y + 0.5)]
      if (site.polygons.some((r) => pointInRing(p, r))) out.push([x, y])
    }
  if (out.length === 0) out.push([Math.floor(lon2px(site.lon)), Math.floor(lat2px(site.lat))])
  return out
}

// Fetches and decodes XYZ PNG tiles; a 404 means "nothing mapped here".
export class TileReader {
  constructor(fetchImpl = fetch) { this.fetch = fetchImpl; this.tiles = new Map(); this.requests = 0 }
  async tile(base, tx, ty) {
    const key = `${base}/${tx}/${ty}`
    if (!this.tiles.has(key)) {
      if (this.tiles.size > 4000) this.tiles.clear()
      this.tiles.set(key, this.load(`${base}/${Z}/${tx}/${ty}.png`))
    }
    return this.tiles.get(key)
  }
  async load(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
      this.requests++
      try {
        const res = await this.fetch(url)
        if (res.status === 404) return null
        if (res.ok) return sharp(Buffer.from(await res.arrayBuffer())).ensureAlpha().raw().toBuffer()
      } catch {
        // network hiccup: retry
      }
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
    }
    throw new Error(`failed to load ${url}`)
  }
  async pixel(base, x, y) {
    const t = await this.tile(base, Math.floor(x / 256), Math.floor(y / 256))
    if (!t) return null
    const i = ((y % 256) * 256 + (x % 256)) * 4
    return [t[i], t[i + 1], t[i + 2], t[i + 3]]
  }
}

async function worstClass(reader, base, pixels, classify) {
  let worst = -1
  for (const [x, y] of pixels) {
    const p = await reader.pixel(base, x, y)
    if (p) worst = Math.max(worst, classify(p))
  }
  return worst
}

export async function slope(reader, pixels, lat) {
  const m = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** Z // metres per pixel
  const h = async (x, y) => { const p = await reader.pixel(LAYERS.dem, x, y); return p ? demHeight(p) : null }
  let sum = 0, n = 0, steep = 0
  for (const [x, y] of pixels) {
    const [e, w, s, nn] = await Promise.all([h(x + 1, y), h(x - 1, y), h(x, y + 1), h(x, y - 1)])
    if ([e, w, s, nn].some((v) => v === null)) continue
    const pct = 100 * Math.hypot((e - w) / (2 * m), (s - nn) / (2 * m))
    sum += pct; n++
    if (pct > 15) steep++
  }
  return n ? { slopePct: Math.round(sum / n * 10) / 10, steepPct: Math.round((100 * steep) / n) } : {}
}

const coverImages = new Map()
function worldCoverTile(lon, lat) {
  const la = Math.floor(lat / 3) * 3, lo = Math.floor(lon / 3) * 3
  const name = `${la >= 0 ? 'N' : 'S'}${String(Math.abs(la)).padStart(2, '0')}${lo >= 0 ? 'E' : 'W'}${String(Math.abs(lo)).padStart(3, '0')}`
  return { name, west: lo, north: la + 3 }
}

export async function landCover(site) {
  const { name, west, north } = worldCoverTile(site.lon, site.lat)
  if (!coverImages.has(name)) coverImages.set(name, fromUrl(WORLDCOVER(name)).then((t) => t.getImage()))
  const image = await coverImages.get(name)
  const pts = site.polygons.flat()
  const toX = (lon) => Math.floor((lon - west) * 12000), toY = (lat) => Math.floor((north - lat) * 12000)
  const clamp = (v) => Math.max(0, Math.min(36000, v))
  const x0 = clamp(toX(Math.min(...pts.map((p) => p[0])))), x1 = clamp(toX(Math.max(...pts.map((p) => p[0]))) + 1)
  const y0 = clamp(toY(Math.max(...pts.map((p) => p[1])))), y1 = clamp(toY(Math.min(...pts.map((p) => p[1]))) + 1)
  if (x1 <= x0 || y1 <= y0) return {}
  const [data] = await image.readRasters({ window: [x0, y0, x1, y1] })
  const w = x1 - x0, counts = {}
  let n = 0
  for (let i = 0; i < data.length; i++) {
    const lon = west + (x0 + (i % w) + 0.5) / 12000, lat = north - (y0 + Math.floor(i / w) + 0.5) / 12000
    if (!site.polygons.some((r) => pointInRing([lon, lat], r))) continue
    counts[data[i]] = (counts[data[i]] ?? 0) + 1
    n++
  }
  if (!n) return {}
  const pct = (c) => Math.round((100 * (counts[c] ?? 0)) / n)
  return { coverBuiltPct: pct(50), coverTreePct: pct(10), coverCropPct: pct(40), coverOpenPct: pct(30) + pct(60) + pct(20) }
}

export async function assess(site, reader) {
  const pixels = samplePixels(site)
  const flood = await worstClass(reader, LAYERS.flood, pixels, depthClass)
  const tsunami = await worstClass(reader, LAYERS.tsunami, pixels, depthClass)
  let ls = 0
  for (const layer of [LAYERS.debris, LAYERS.steep, LAYERS.slide]) ls = Math.max(ls, await worstClass(reader, layer, pixels, landslideClass))
  return {
    flood: flood < 0 ? null : DEPTH_CLASSES[flood].label,
    tsunami: tsunami < 0 ? null : DEPTH_CLASSES[tsunami].label,
    landslide: ['none', 'warning', 'special'][ls],
    ...(await slope(reader, pixels, site.lat)),
  }
}

// Sites worth checking: same pre-filter the app applies by default, but looser.
export const eligible = (s) => s.status !== 'occupied' && s.sub && s.sub.m <= 10_000

async function main() {
  const [sitesPath, cachePath] = process.argv.slice(2)
  const sites = JSON.parse(readFileSync(sitesPath, 'utf8'))
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
  const reader = new TileReader()
  const todo = sites.filter((s) => eligible(s) && !cache[s.id])
  console.log(`assessing ${todo.length} sites (${Object.keys(cache).length} cached)`)
  let done = 0, failed = 0
  const save = () => { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, JSON.stringify(cache)) }
  // A few sites in parallel keeps the tile servers' load modest.
  const queue = [...todo]
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        const result = await assess(s, reader)
        try { Object.assign(result, await landCover(s)) } catch (e) { console.error(s.id, 'worldcover', e.message) }
        cache[s.id] = result
      } catch (e) {
        failed++
        console.error(s.id, e.message)
      }
      if (++done % 200 === 0) { console.log(`${done}/${todo.length}, ${reader.requests} tile requests`); save() }
    }
  }))
  save()
  for (const s of sites) if (cache[s.id]) s.dd = { ...s.dd, ...cache[s.id] }
  writeFileSync(sitesPath, JSON.stringify(sites))
  console.log(`done: ${done - failed} assessed, ${failed} failed, ${reader.requests} tile requests`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
