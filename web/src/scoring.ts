import type { Site } from './types'
import { checks, ddFactor } from './dd'

export interface Weights {
  substation: number
  line: number
  area: number
  landType: number
}

export const DEFAULT_WEIGHTS: Weights = { substation: 40, line: 20, area: 25, landType: 15 }

export const WEIGHT_LABELS: Record<keyof Weights, string> = {
  substation: '离变电站近、电压高',
  line: '离高压送电线（铁塔）近',
  area: '土地面积大',
  landType: '土地状态（跡地/空地优先）',
}

// Higher voltage means more spare capacity for a large AIDC load.
export function voltageScore(kv: number | null): number {
  if (kv === null) return 0.3
  if (kv >= 275) return 1
  if (kv >= 154) return 0.85
  if (kv >= 66) return 0.55
  return 0.2
}

export const distanceScore = (m: number, maxM: number) => Math.max(0, 1 - m / maxM)

const LAND_STATUS_SCORE = { former: 1, vacant: 0.9, park: 0.8, unknown: 0.5, occupied: 0.1 }

export function scoreParts(site: Site) {
  return {
    substation: site.sub ? voltageScore(site.sub.kv) * distanceScore(site.sub.m, 10_000) : 0,
    line: site.line ? voltageScore(site.line.kv) * distanceScore(site.line.m, 5_000) : 0,
    area: Math.min(1, Math.sqrt(site.ha / 20)),
    landType: LAND_STATUS_SCORE[site.status] ?? 0.5,
  }
}

// 0–100.
export function score(site: Site, w: Weights): number {
  const parts = scoreParts(site)
  const total = w.substation + w.line + w.area + w.landType
  if (total === 0) return 0
  const sum = (Object.keys(parts) as (keyof Weights)[]).reduce((s, k) => s + parts[k] * w[k], 0)
  return Math.round(((100 * sum) / total) * ddFactor(checks(site)))
}

// Rough receiving voltage for a given AIDC load in Japan.
export function suggestedVoltage(mw: number): string {
  if (mw < 2) return '6.6kV（高圧）'
  if (mw < 10) return '22kV / 33kV（特別高圧）'
  if (mw < 50) return '66kV / 77kV（特別高圧）'
  return '154kV 以上（特別高圧）'
}

export function scoreColor(s: number): string {
  if (s >= 75) return '#16a34a'
  if (s >= 60) return '#84cc16'
  if (s >= 45) return '#eab308'
  return '#f97316'
}
