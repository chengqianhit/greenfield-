// Small geo helpers so the pipeline has no dependencies.

const R = 6371008.8 // mean Earth radius, metres
const toRad = (d) => (d * Math.PI) / 180

export function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Distance in metres from point p to segment a-b, using a local equirectangular projection.
export function pointSegmentDistance(p, a, b) {
  const k = Math.cos(toRad(p[1]))
  const ax = (a[0] - p[0]) * k, ay = a[1] - p[1]
  const bx = (b[0] - p[0]) * k, by = b[1] - p[1]
  const dx = bx - ax, dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : -(ax * dx + ay * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const x = ax + t * dx, y = ay + t * dy
  return toRad(Math.sqrt(x * x + y * y)) * R
}

// Outer rings of a Polygon or MultiPolygon geometry.
export function outerRings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]]
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((p) => p[0])
  return []
}

// Signed-area-free spherical polygon area in m² (holes subtracted).
function ringArea(ring) {
  let s = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[i + 1]
    s += toRad(x2 - x1) * (2 + Math.sin(toRad(y1)) + Math.sin(toRad(y2)))
  }
  return Math.abs((s * R * R) / 2)
}

export function polygonArea(geom) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : []
  let total = 0
  for (const rings of polys) {
    total += ringArea(rings[0])
    for (const hole of rings.slice(1)) total -= ringArea(hole)
  }
  return Math.max(0, total)
}

// Area-weighted centroid of the largest outer ring (good enough for siting).
export function centroid(geom) {
  if (geom.type === 'Point') return geom.coordinates
  const rings = outerRings(geom)
  if (rings.length === 0) {
    const c = geom.coordinates
    return c[Math.floor(c.length / 2)]
  }
  const ring = rings.reduce((a, b) => (ringArea(b) > ringArea(a) ? b : a))
  // Work relative to the first vertex to avoid precision loss at large lon/lat.
  const [ox, oy] = ring[0]
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0] - ox, y1 = ring[i][1] - oy, x2 = ring[i + 1][0] - ox, y2 = ring[i + 1][1] - oy
    const f = x1 * y2 - x2 * y1
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f
  }
  if (a === 0) return ring[0]
  return [ox + cx / (3 * a), oy + cy / (3 * a)]
}

// Douglas–Peucker on a coordinate list, tolerance in degrees.
export function simplify(coords, tol) {
  if (coords.length <= 2) return coords
  const keep = new Uint8Array(coords.length)
  keep[0] = keep[coords.length - 1] = 1
  const stack = [[0, coords.length - 1]]
  while (stack.length) {
    const [s, e] = stack.pop()
    let max = 0, idx = -1
    const [ax, ay] = coords[s], [bx, by] = coords[e]
    const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy)
    for (let i = s + 1; i < e; i++) {
      const [px, py] = coords[i]
      const d = len === 0 ? Math.hypot(px - ax, py - ay) : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len
      if (d > max) { max = d; idx = i }
    }
    if (max > tol) { keep[idx] = 1; stack.push([s, idx], [idx, e]) }
  }
  return coords.filter((_, i) => keep[i])
}

export const round = (c, d = 5) => c.map((v) => Math.round(v * 10 ** d) / 10 ** d)

// Uniform grid index over lon/lat cells for nearest-neighbour lookups.
export class GridIndex {
  constructor(cell = 0.05) { this.cell = cell; this.cells = new Map() }
  key(x, y) { return `${Math.floor(x / this.cell)},${Math.floor(y / this.cell)}` }
  insertBox(minX, minY, maxX, maxY, item) {
    const c = this.cell
    for (let x = Math.floor(minX / c); x <= Math.floor(maxX / c); x++)
      for (let y = Math.floor(minY / c); y <= Math.floor(maxY / c); y++) {
        const k = `${x},${y}`
        if (!this.cells.has(k)) this.cells.set(k, [])
        this.cells.get(k).push(item)
      }
  }
  // Items in cells touching the box around p of `radius` degrees (deduplicated).
  near([x, y], radius) {
    const c = this.cell, out = new Set()
    for (let i = Math.floor((x - radius) / c); i <= Math.floor((x + radius) / c); i++)
      for (let j = Math.floor((y - radius) / c); j <= Math.floor((y + radius) / c); j++)
        for (const it of this.cells.get(`${i},${j}`) ?? []) out.add(it)
    return out
  }
}
