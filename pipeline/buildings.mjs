// Adds building-based checks to sites.json from a stream of OSM building polygons:
// how much of each site is already built on, and how close the nearest homes are.
//
//   osmium export buildings.osm.pbf -f geojsonseq -o - | node buildings.mjs <sites.json>

import { readFileSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { GridIndex, centroid, pointSegmentDistance, polygonArea } from './geo.mjs'

export const HOME_RADIUS_M = 1000
export const HOMES_NEAR_M = 300
const HOME_TYPES = new Set(['house', 'detached', 'residential', 'apartments', 'terrace', 'semidetached_house', 'dormitory', 'farm'])
const DEG_PER_M = 1 / 111_000

export function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function createAccumulator(sites) {
  const index = new GridIndex(0.02)
  const state = new Map()
  for (const s of sites) {
    const pts = s.polygons.flat()
    const pad = HOME_RADIUS_M * DEG_PER_M / Math.cos((s.lat * Math.PI) / 180)
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1])
    const box = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
    index.insertBox(box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad, s)
    state.set(s.id, { box, builtM2: 0, count: 0, homesNear: 0, nearestHomeM: null })
  }

  function add(feature) {
    const g = feature.geometry
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return
    const c = centroid(g)
    const isHome = HOME_TYPES.has(feature.properties?.building)
    for (const s of index.near(c, 0)) {
      const st = state.get(s.id)
      const inBox = c[0] >= st.box[0] && c[0] <= st.box[2] && c[1] >= st.box[1] && c[1] <= st.box[3]
      if (inBox && s.polygons.some((r) => pointInRing(c, r))) {
        st.builtM2 += polygonArea(g)
        st.count++
        continue
      }
      if (!isHome) continue
      let d = Infinity
      for (const r of s.polygons) for (let i = 0; i < r.length - 1; i++) d = Math.min(d, pointSegmentDistance(c, r[i], r[i + 1]))
      if (d > HOME_RADIUS_M) continue
      if (d <= HOMES_NEAR_M) st.homesNear++
      if (st.nearestHomeM === null || d < st.nearestHomeM) st.nearestHomeM = Math.round(d)
    }
  }

  function result(site) {
    const st = state.get(site.id)
    return {
      builtPct: Math.min(100, Math.round((1000 * st.builtM2) / (site.ha * 10_000)) / 10),
      buildings: st.count,
      homesNear: st.homesNear,
      nearestHomeM: st.nearestHomeM,
    }
  }

  return { add, result }
}

async function main() {
  const [sitesPath] = process.argv.slice(2)
  if (!sitesPath) {
    console.error('usage: … | node buildings.mjs <sites.json>')
    process.exit(1)
  }
  const sites = JSON.parse(readFileSync(sitesPath, 'utf8'))
  const acc = createAccumulator(sites)
  let n = 0
  for await (const raw of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    const line = raw.replace(/^\x1e/, '').trim()
    if (!line) continue
    acc.add(JSON.parse(line))
    if (++n % 1_000_000 === 0) console.error(`${n / 1e6}M buildings`)
  }
  for (const s of sites) s.dd = { ...s.dd, ...acc.result(s) }
  writeFileSync(sitesPath, JSON.stringify(sites))
  const built = sites.filter((s) => s.dd.builtPct >= 20).length
  console.log(`${n} buildings read; ${built}/${sites.length} sites are ≥20% built over`)
}

if (import.meta.url === `file://${process.argv[1]}`) await main()
