import { describe, expect, it } from 'vitest'
import { DEFAULT_WEIGHTS, score, suggestedVoltage, voltageScore } from './scoring'
import type { Site } from './types'

const site = (over: Partial<Site> = {}): Site => ({
  id: 'a1', name: null, type: 'brownfield', status: 'former', ha: 20, lon: 140, lat: 35.7,
  sub: { id: 'n1', name: null, kv: 275, m: 0 }, subUnknown: null, line: { kv: 275, name: null, m: 0 },
  utility: 'tepco', firstSeen: '2026-10-17', polygons: [], ...over,
})

describe('score', () => {
  it('gives a perfect site 100', () => {
    expect(score(site(), DEFAULT_WEIGHTS)).toBe(100)
  })
  it('drops with distance, lower voltage and smaller land', () => {
    const far = score(site({ sub: { id: 'n1', name: null, kv: 275, m: 5000 } }), DEFAULT_WEIGHTS)
    const low = score(site({ sub: { id: 'n1', name: null, kv: 66, m: 0 } }), DEFAULT_WEIGHTS)
    const small = score(site({ ha: 2 }), DEFAULT_WEIGHTS)
    for (const s of [far, low, small]) expect(s).toBeLessThan(100)
    expect(score(site({ sub: null, line: null }), DEFAULT_WEIGHTS)).toBeLessThan(50)
  })
  it('ranks running plants far below former sites', () => {
    expect(score(site({ status: 'occupied' }), DEFAULT_WEIGHTS)).toBeLessThan(score(site(), DEFAULT_WEIGHTS) - 10)
  })
  it('is cut by failed due-diligence checks', () => {
    const built = site({ dd: { builtPct: 60 }, vision: undefined })
    expect(score(built, DEFAULT_WEIGHTS)).toBe(60)
    expect(score(site({ dd: { builtPct: 10 } }), DEFAULT_WEIGHTS)).toBe(90)
  })
  it('respects weights', () => {
    const noGrid = site({ sub: null, line: null })
    expect(score(noGrid, { substation: 0, line: 0, area: 1, landType: 1 })).toBe(100)
    expect(score(noGrid, { substation: 0, line: 0, area: 0, landType: 0 })).toBe(0)
  })
})

it('voltage helpers', () => {
  expect(voltageScore(500)).toBe(1)
  expect(voltageScore(null)).toBeLessThan(voltageScore(66))
  expect(suggestedVoltage(100)).toContain('154kV')
  expect(suggestedVoltage(1)).toContain('6.6kV')
})
