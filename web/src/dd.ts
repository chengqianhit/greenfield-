import type { DepthClass, Site } from './types'

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'unknown'

export interface Check {
  key: string
  label: string
  status: CheckStatus
  detail: string
}

// ≥3 m floods the ground floor and electrical rooms of a typical DC: hard to justify.
const DEPTH_STATUS: Record<DepthClass, CheckStatus> = { '<0.5': 'warn', '0.5-3': 'warn', '3-5': 'fail', '5-10': 'fail', '10-20': 'fail', '20+': 'fail' }

const m = (v: number) => (v < 1000 ? `${Math.round(v)} m` : `${(v / 1000).toFixed(1)} km`)

function grade(v: number | null | undefined, warnAt: number, failAt: number): CheckStatus {
  if (v === null || v === undefined) return 'unknown'
  return v >= failAt ? 'fail' : v >= warnAt ? 'warn' : 'pass'
}

// Screening checks a grid operator / DD reviewer would ask about, from public data.
export function checks(site: Site): Check[] {
  const dd = site.dd ?? {}
  const v = site.vision
  const out: Check[] = []

  out.push({
    key: 'grid',
    label: '电网接入',
    status: !site.sub ? 'fail' : (site.sub.kv ?? 0) >= 154 && site.sub.m <= 3000 ? 'pass' : site.sub.m <= 5000 ? 'warn' : 'fail',
    detail: site.sub ? `最近 ${site.sub.kv}kV 变电站 ${m(site.sub.m)}` : '附近没有已知电压的变电站',
  })

  out.push({
    key: 'vacant',
    label: '现状是否空地（建筑数据）',
    status: grade(dd.builtPct, 5, 20),
    detail: dd.builtPct === undefined ? '未检查' : `建筑覆盖 ${dd.builtPct}%（${dd.buildings ?? 0} 栋）`,
  })

  if (dd.coverBuiltPct !== undefined)
    out.push({
      key: 'cover',
      label: '卫星影像地表分类',
      // Built-up here includes paved ground and cleared plant slabs, so it only warns.
      status: dd.coverBuiltPct >= 10 ? 'warn' : 'pass',
      detail: `建成区/铺装 ${dd.coverBuiltPct}%，林地 ${dd.coverTreePct ?? 0}%，农田 ${dd.coverCropPct ?? 0}%，草地/裸地 ${dd.coverOpenPct ?? 0}%（ESA WorldCover 2021，仅供参考）`,
    })

  if (v)
    out.push({
      key: 'vision',
      label: 'AI 航拍判读',
      status: v.occupancy === 'empty' && v.suitability >= 6 ? 'pass' : v.occupancy === 'built' || v.suitability <= 3 ? 'fail' : 'warn',
      detail: `${{ empty: '空地', partly_built: '部分有建筑', built: '已建满' }[v.occupancy]}，适合度 ${v.suitability}/10。${v.note}`,
    })

  const slopeStatus: CheckStatus =
    dd.slopePct !== undefined ? ((dd.steepPct ?? 0) >= 30 ? 'fail' : grade(dd.slopePct, 5, 15)) : v ? (v.terrain === 'flat' ? 'pass' : v.terrain === 'gentle_slope' ? 'warn' : 'fail') : 'unknown'
  out.push({
    key: 'slope',
    label: '坡度',
    status: slopeStatus,
    detail: dd.slopePct !== undefined ? `平均坡度 ${dd.slopePct}%，陡坡（>15%）占 ${dd.steepPct ?? 0}%` : v ? `航拍判读：${{ flat: '平坦', gentle_slope: '缓坡', steep_or_mountainous: '陡坡/山地' }[v.terrain]}` : '未检查',
  })

  out.push({
    key: 'homes',
    label: '与民宅距离',
    status: dd.nearestHomeM === undefined ? (v ? (v.homesAdjacent ? 'warn' : 'pass') : 'unknown') : dd.nearestHomeM === null ? 'pass' : dd.nearestHomeM < 100 ? 'fail' : dd.nearestHomeM < 300 ? 'warn' : 'pass',
    detail: dd.nearestHomeM === undefined ? (v ? (v.homesAdjacent ? '航拍可见紧邻民宅' : '航拍未见紧邻民宅') : '未检查') : dd.nearestHomeM === null ? '1 km 内无住宅' : `最近住宅 ${m(dd.nearestHomeM)}，300 m 内 ${dd.homesNear ?? 0} 栋`,
  })

  out.push({
    key: 'flood',
    label: '洪水浸水',
    status: dd.flood === undefined ? 'unknown' : dd.flood === null ? 'pass' : DEPTH_STATUS[dd.flood],
    detail: dd.flood === undefined ? '未检查' : dd.flood === null ? '不在想定浸水区域（想定最大规模）' : `想定最大浸水深 ${dd.flood} m`,
  })

  if (dd.tsunami !== undefined)
    out.push({
      key: 'tsunami',
      label: '海啸浸水',
      status: dd.tsunami === null ? 'pass' : dd.tsunami === '<0.5' ? 'warn' : 'fail',
      detail: dd.tsunami === null ? '不在想定浸水区域' : `想定浸水深 ${dd.tsunami} m`,
    })

  out.push({
    key: 'landslide',
    label: '土砂灾害',
    status: dd.landslide === undefined ? 'unknown' : dd.landslide === 'special' ? 'fail' : dd.landslide === 'warning' ? 'warn' : 'pass',
    detail: dd.landslide === undefined ? '未检查' : { none: '不在警戒区域', warning: '含土砂灾害警戒区域', special: '含土砂灾害特别警戒区域' }[dd.landslide],
  })

  return out
}

// Multiplier applied to the score: each failed check hurts a lot, warnings a little.
// The grid check is already part of the base score, so it is left out here.
export function ddFactor(list: Check[]): number {
  return list.filter((c) => c.key !== 'grid').reduce((f, c) => f * (c.status === 'fail' ? 0.6 : c.status === 'warn' ? 0.9 : 1), 1)
}

export const STATUS_ICON: Record<CheckStatus, string> = { pass: '✅', warn: '⚠️', fail: '❌', unknown: '⚪' }
