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
