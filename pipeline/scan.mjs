// Turns an osmium GeoJSONSeq export (substations, power lines, landuse) into the
// site-selection data files the web app loads.
//
//   node scan.mjs <features.geojsonseq> <outDir> [region]

import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import { GridIndex, centroid, haversine, outerRings, pointSegmentDistance, polygonArea, round, simplify } from './geo.mjs'

export const MIN_SITE_HA = 2
export const MIN_GRID_KV = 66
export const MIN_LINE_KV = 154
const SEARCH_M = 10_000
const LAND_TYPES = new Set(['brownfield', 'greenfield', 'industrial'])
const EXCLUDED_SUBSTATION_TYPES = new Set(['traction', 'minor_distribution', 'industrial'])
const RAILWAY_OPERATOR = /鉄道|電鉄|JR|メトロ|railway|metro/i

// 一般送配電事業者, matched against the OSM operator tag.
export const UTILITIES = [
  ['hokkaido', /北海道電力|hokkaido/i],
  ['tohoku', /東北電力|tohoku/i],
  ['tepco', /東京電力|tepco|tokyo electric/i],
  ['chubu', /中部電力|chubu/i],
  ['hokuriku', /北陸電力|hokuriku/i],
  ['kansai', /関西電力|kansai/i],
  ['chugoku', /中国電力|chugoku/i],
  ['shikoku', /四国電力|shikoku/i],
  ['kyushu', /九州電力|kyushu/i],
  ['okinawa', /沖縄電力|okinawa/i],
]

// What the land is likely used for today, from OSM tags and the name.
// Only `occupied` (a running factory or plant) is a poor candidate.
const FORMER = /跡地|跡$|閉鎖|廃止|解体/
const PARK = /団地|工業用地|産業用地|分譲|流通センター|臨海|埋立|(テクノ|リサーチ|ビジネス|インダストリアル|サイエンス)パーク/
// Never suitable, whatever the land is tagged as.
const EXCLUDED = /原子力|原発|核燃料|放射性/
// Public or in-use land that is not for sale unless it is a former (跡地) site.
const IN_USE = /公園|緑地|墓地|霊園|神社|寺院|教会|学校|大学|病院|ゴルフ|運動場|競技場|グラウンド|スポーツ|golf/i
const OCCUPIED = /発電所|原子力|製鉄|製油|精油|コンビナート|工場|製作所|試験場|研究所|変電所|基地|処理場|処分場|清掃|浄水|事業所|製造所|株式会社|㈱|\(株\)/
const OCCUPIED_TAGS = ['power', 'industrial', 'operator', 'man_made']

export function landStatus(type, tags) {
  const name = tags.name ?? tags['name:ja'] ?? ''
  if (EXCLUDED.test(name)) return 'occupied'
  if (type === 'brownfield' || FORMER.test(name) || tags.disused || tags.abandoned) return 'former'
  if (IN_USE.test(name) || tags.leisure) return 'occupied'
  if (type === 'greenfield') return 'vacant'
  if (PARK.test(name) && !OCCUPIED.test(name)) return 'park'
  if (name || OCCUPIED_TAGS.some((t) => tags[t])) return 'occupied'
  return 'unknown'
}

export function utilityOf(operator) {
  if (!operator) return null
  return UTILITIES.find(([, re]) => re.test(operator))?.[0] ?? null
}

// "275000;66000" -> 275 (kV). Returns null when unknown.
export function maxVoltageKv(v) {
  if (!v) return null
  const nums = String(v).split(/[;,]/).map((s) => parseFloat(s)).filter((n) => n > 0)
  if (nums.length === 0) return null
  return Math.round(Math.max(...nums) / 1000)
}

export async function readFeatures(path) {
  const subs = new Map(), lines = [], lands = []
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity })
  for await (const raw of rl) {
    const line = raw.replace(/^\x1e/, '').trim()
    if (!line) continue
    const f = JSON.parse(line)
    const p = f.properties ?? {}, g = f.geometry, id = String(f.id ?? p['@id'] ?? '')
    if (!g) continue
    if (p.power === 'substation') {
      if (g.type === 'LineString') continue // closed way also exported as a line
      if (EXCLUDED_SUBSTATION_TYPES.has(p.substation) || RAILWAY_OPERATOR.test(p.operator ?? '')) continue
      if (subs.has(id)) continue
      const [lon, lat] = round(centroid(g))
      subs.set(id, { id, name: p.name ?? p['name:ja'] ?? null, operator: p.operator ?? null, kv: maxVoltageKv(p.voltage), lon, lat })
    } else if (p.power === 'line' && g.type === 'LineString') {
      const kv = maxVoltageKv(p.voltage)
      if (kv !== null && kv >= MIN_GRID_KV) lines.push({ id, kv, name: p.name ?? null, coords: g.coordinates })
    } else if (LAND_TYPES.has(p.landuse) && (g.type === 'Polygon' || g.type === 'MultiPolygon')) {
      lands.push({ id, type: p.landuse, status: landStatus(p.landuse, p), name: p.name ?? p['name:ja'] ?? null, geom: g })
    }
  }
  return { subs: [...subs.values()], lines, lands }
}

// Sample at most `n` vertices of the outer rings, plus the centroid.
function samplePoints(geom, c, n = 120) {
  const pts = outerRings(geom).flat()
  const step = Math.max(1, Math.floor(pts.length / n))
  const out = [c]
  for (let i = 0; i < pts.length; i += step) out.push(pts[i])
  return out
}

const DEG = SEARCH_M / 111_000 // search radius in degrees of latitude

export function analyse({ subs, lines, lands }, previous = new Map(), today = new Date().toISOString().slice(0, 10)) {
  const subIndex = new GridIndex()
  for (const s of subs) if (s.kv !== null && s.kv >= MIN_GRID_KV) subIndex.insertBox(s.lon, s.lat, s.lon, s.lat, s)
  const unknownIndex = new GridIndex()
  for (const s of subs) if (s.kv === null) unknownIndex.insertBox(s.lon, s.lat, s.lon, s.lat, s)
  const opIndex = new GridIndex(0.25)
  for (const s of subs) if (utilityOf(s.operator)) opIndex.insertBox(s.lon, s.lat, s.lon, s.lat, s)

  const segIndex = new GridIndex()
  for (const l of lines) {
    if (l.kv < MIN_LINE_KV) continue
    for (let i = 0; i < l.coords.length - 1; i++) {
      const a = l.coords[i], b = l.coords[i + 1]
      segIndex.insertBox(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { a, b, line: l })
    }
  }

  const sites = []
  for (const land of lands) {
    const ha = polygonArea(land.geom) / 10_000
    if (ha < MIN_SITE_HA) continue
    const c = centroid(land.geom)
    const pts = samplePoints(land.geom, c)
    const lonDeg = DEG / Math.cos((c[1] * Math.PI) / 180)

    const nearest = (index) => {
      let best = null, bestM = Infinity
      for (const s of index.near(c, lonDeg + 0.02)) {
        for (const p of pts) {
          const d = haversine(p, [s.lon, s.lat])
          if (d < bestM) { bestM = d; best = s }
        }
      }
      return [best, bestM]
    }
    const [sub, subM] = nearest(subIndex)
    const [unk, unkM] = nearest(unknownIndex)
    let line = null, lineM = Infinity
    for (const seg of segIndex.near(c, lonDeg + 0.02)) {
      for (const p of pts) {
        const d = pointSegmentDistance(p, seg.a, seg.b)
        if (d < lineM) { lineM = d; line = seg.line }
      }
    }
    if (subM > SEARCH_M && lineM > SEARCH_M && unkM > SEARCH_M) continue

    let utility = utilityOf(sub?.operator), opM = Infinity
    if (!utility) {
      for (const s of opIndex.near(c, 0.5)) {
        const d = haversine(c, [s.lon, s.lat])
        if (d < opM) { opM = d; utility = utilityOf(s.operator) }
      }
    }

    const polygons = outerRings(land.geom).map((r) => simplify(r, 0.00005).map((p) => round(p)))
    sites.push({
      id: land.id,
      name: land.name,
      type: land.type,
      status: land.status,
      ha: Math.round(ha * 10) / 10,
      lon: round(c)[0],
      lat: round(c)[1],
      sub: sub && subM <= SEARCH_M ? { id: sub.id, name: sub.name, kv: sub.kv, m: Math.round(subM) } : null,
      // A closer substation whose voltage OSM does not record; worth checking by hand.
      subUnknown: unk && unkM < subM && unkM <= SEARCH_M ? { id: unk.id, name: unk.name, m: Math.round(unkM) } : null,
      line: line && lineM <= SEARCH_M ? { kv: line.kv, name: line.name, m: Math.round(lineM) } : null,
      utility,
      firstSeen: previous.get(land.id) ?? today,
      polygons,
    })
  }
  return sites
}

function lineFeatures(lines) {
  return {
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature',
      properties: { kv: l.kv, name: l.name },
      geometry: { type: 'LineString', coordinates: simplify(l.coords, 0.0003).map((p) => round(p, 4)) },
    })),
  }
}

async function main() {
  const [input, outDir, region = 'japan'] = process.argv.slice(2)
  if (!input || !outDir) {
    console.error('usage: node scan.mjs <features.geojsonseq> <outDir> [region]')
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  const prevPath = join(outDir, 'sites.json')
  const previous = new Map()
  if (existsSync(prevPath)) for (const s of JSON.parse(readFileSync(prevPath, 'utf8'))) previous.set(s.id, s.firstSeen)

  const data = await readFeatures(input)
  const sites = analyse(data, previous)
  const subs = data.subs.filter((s) => s.kv === null || s.kv >= MIN_GRID_KV)

  writeFileSync(join(outDir, 'sites.json'), JSON.stringify(sites))
  writeFileSync(join(outDir, 'substations.json'), JSON.stringify(subs))
  writeFileSync(join(outDir, 'lines.geojson'), JSON.stringify(lineFeatures(data.lines)))
  const meta = {
    region,
    scannedAt: new Date().toISOString(),
    source: 'OpenStreetMap contributors (ODbL), via Geofabrik',
    counts: { sites: sites.length, newSites: sites.filter((s) => !previous.has(s.id)).length, substations: subs.length, lines: data.lines.length },
  }
  writeFileSync(join(outDir, 'meta.json'), JSON.stringify(meta, null, 2))
  console.log(JSON.stringify(meta, null, 2))
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
