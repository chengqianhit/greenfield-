// Looks at an aerial photo of the best-ranked sites with Claude and records whether
// the land is actually empty, flat and away from homes. Results are cached by site id
// so each site is only paid for once.
//
//   ANTHROPIC_API_KEY=… node vision.mjs <sites.json> <vision-cache.json> [maxNew]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import sharp from 'sharp'
import { z } from 'zod'

const MODEL = 'claude-opus-5-5'
const TILE = 256
const MAX_PX = 1024
const TILE_URL = (z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${x}/${y}.jpg`

export const Verdict = z.object({
  occupancy: z.enum(['empty', 'partly_built', 'built']).describe('empty = no buildings/structures inside the red outline'),
  builtPct: z.number().describe('estimated % of the outlined area covered by buildings, tanks, solar panels or other structures'),
  cover: z.array(z.enum(['bare_soil', 'grass', 'farmland', 'forest', 'paved', 'buildings', 'solar_panels', 'water', 'construction'])).describe('main surface types inside the outline'),
  terrain: z.enum(['flat', 'gentle_slope', 'steep_or_mountainous']),
  homesAdjacent: z.boolean().describe('detached houses or apartment blocks directly next to the outline'),
  suitability: z.number().describe('0–10: how plausible it is to build a large data center here as the land looks today'),
  note: z.string().describe('one or two short sentences in Simplified Chinese explaining what is on the land'),
})

const PROMPT = `这是一张日本国土地理院的航拍照片，红线是一块候选土地的边界。
我们在找可以新建大型 AI 数据中心（AIDC）的土地：最好是平坦的空地或已拆除的工厂跡地，没有现存建筑，旁边没有密集民宅。
请只根据照片判断红线内的现状，按给定的 JSON 格式回答。看不清的地方保守判断。`

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z
}

// Highest zoom (≤18) at which the site plus a margin fits in MAX_PX.
export function viewport(site) {
  const pts = site.polygons.flat()
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1])
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
  for (let z = 18; z >= 10; z--) {
    const x0 = lon2x(w, z), x1 = lon2x(e, z), y0 = lat2y(n, z), y1 = lat2y(s, z)
    const span = Math.max(x1 - x0, y1 - y0) * 1.4 * TILE
    if (span <= MAX_PX || z === 10) {
      const size = Math.min(MAX_PX, Math.max(512, Math.ceil(span)))
      const cx = ((x0 + x1) / 2) * TILE, cy = ((y0 + y1) / 2) * TILE
      return { z, left: Math.round(cx - size / 2), top: Math.round(cy - size / 2), size }
    }
  }
}

async function fetchTile(z, x, y) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(TILE_URL(z, x, y))
    if (res.ok) return Buffer.from(await res.arrayBuffer())
    if (res.status === 404) return null
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
  }
  return null
}

export async function renderSite(site) {
  const { z, left, top, size } = viewport(site)
  const tx0 = Math.floor(left / TILE), ty0 = Math.floor(top / TILE)
  const tx1 = Math.floor((left + size - 1) / TILE), ty1 = Math.floor((top + size - 1) / TILE)
  const composites = []
  for (let tx = tx0; tx <= tx1; tx++)
    for (let ty = ty0; ty <= ty1; ty++) {
      const buf = await fetchTile(z, tx, ty)
      if (buf) composites.push({ input: buf, left: tx * TILE - left, top: ty * TILE - top })
    }
  if (composites.length === 0) return null
  const paths = site.polygons
    .map((r) => 'M' + r.map(([lon, lat]) => `${(lon2x(lon, z) * TILE - left).toFixed(1)},${(lat2y(lat, z) * TILE - top).toFixed(1)}`).join('L') + 'Z')
    .join(' ')
  const outline = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><path d="${paths}" fill="none" stroke="#ff2020" stroke-width="3"/></svg>`)
  // Tiles overhang the canvas edges, so compose on a larger canvas and crop.
  const pad = TILE
  const canvas = sharp({ create: { width: size + 2 * pad, height: size + 2 * pad, channels: 3, background: '#808080' } })
  const tiles = await canvas
    .composite(composites.map((c) => ({ ...c, left: c.left + pad, top: c.top + pad })))
    .png()
    .toBuffer()
  return sharp(tiles)
    .extract({ left: pad, top: pad, width: size, height: size })
    .composite([{ input: outline, left: 0, top: 0 }])
    .jpeg({ quality: 85 })
    .toBuffer()
}

export async function judge(client, image) {
  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low', format: betaZodOutputFormat(Verdict) },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image.toString('base64') } },
        { type: 'text', text: PROMPT },
      ],
    }],
  })
  if (res.stop_reason === 'refusal' || !res.parsed_output) return null
  return { ...res.parsed_output, model: res.model }
}

// Hazards that rule a site out regardless of what the photo shows.
const hazardFail = (dd) =>
  ['3-5', '5-10', '10-20', '20+'].includes(dd.flood) || (dd.tsunami && dd.tsunami !== '<0.5') || dd.landslide === 'special' || (dd.steepPct ?? 0) >= 30

// Sites worth a look: not a running plant, mostly unbuilt per OSM, near a known grid substation.
export function shortlist(sites) {
  return sites
    .filter((s) => s.status !== 'occupied' && s.sub && s.sub.m <= 5000 && (s.dd?.builtPct ?? 0) < 30 && !hazardFail(s.dd ?? {}))
    .map((s) => ({ s, rank: (s.sub.kv >= 275 ? 3 : s.sub.kv >= 154 ? 2 : 1) * 10_000 - s.sub.m + Math.min(s.ha, 50) * 50 }))
    .sort((a, b) => b.rank - a.rank)
    .map((x) => x.s)
}

async function main() {
  const [sitesPath, cachePath, maxNewArg = '150'] = process.argv.slice(2)
  const sites = JSON.parse(readFileSync(sitesPath, 'utf8'))
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}
  const maxNew = Number(maxNewArg)

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY not set: applying cached verdicts only')
  } else {
    const client = new Anthropic()
    const todo = shortlist(sites).filter((s) => !cache[s.id]).slice(0, maxNew)
    console.log(`analysing ${todo.length} new sites`)
    for (const s of todo) {
      try {
        const image = await renderSite(s)
        if (!image) continue
        const verdict = await judge(client, image)
        if (verdict) cache[s.id] = { ...verdict, at: new Date().toISOString().slice(0, 10) }
        console.log(s.id, s.name ?? '', verdict?.occupancy, verdict?.suitability)
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw e
        console.error(s.id, e.message)
      }
      writeFileSync(cachePath, JSON.stringify(cache))
    }
  }
  for (const s of sites) if (cache[s.id]) s.vision = cache[s.id]
  writeFileSync(sitesPath, JSON.stringify(sites))
  mkdirSync(dirname(cachePath), { recursive: true })
  writeFileSync(cachePath, JSON.stringify(cache))
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
