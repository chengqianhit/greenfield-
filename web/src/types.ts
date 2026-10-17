// Shapes of the files written by pipeline/scan.mjs.

export type LandType = 'brownfield' | 'greenfield' | 'industrial'
export type LandStatus = 'former' | 'vacant' | 'park' | 'unknown' | 'occupied'

export interface Site {
  id: string
  name: string | null
  type: LandType
  status: LandStatus
  ha: number
  lon: number
  lat: number
  sub: { id: string; name: string | null; kv: number | null; m: number } | null
  subUnknown: { id: string; name: string | null; m: number } | null
  line: { kv: number; name: string | null; m: number } | null
  utility: string | null
  firstSeen: string
  polygons: [number, number][][]
  dd?: DueDiligence
  vision?: Vision
}

// Automated checks added by the pipeline's enrichment stages. Every field is
// optional: a missing value means "not checked yet".
export interface DueDiligence {
  builtPct?: number // OSM building footprint coverage, %
  buildings?: number
  homesNear?: number // homes within 300 m
  nearestHomeM?: number | null
  slopePct?: number // mean slope, %
  steepPct?: number // share of the site steeper than 15 %, %
  floodM?: number | null // max expected flood depth (想定最大規模), m
  tsunamiM?: number | null
  landslide?: 'none' | 'warning' | 'special'
  coverBuiltPct?: number // ESA WorldCover built-up share, %
  coverTreePct?: number
}

export interface Vision {
  occupancy: 'empty' | 'partly_built' | 'built'
  builtPct: number
  cover: string[]
  terrain: 'flat' | 'gentle_slope' | 'steep_or_mountainous'
  homesAdjacent: boolean
  suitability: number
  note: string
  at: string
  model: string
}

export interface Substation {
  id: string
  name: string | null
  operator: string | null
  kv: number | null
  lon: number
  lat: number
}

export interface Meta {
  region: string
  scannedAt: string
  source: string
  counts: { sites: number; newSites: number; substations: number; lines: number }
}
