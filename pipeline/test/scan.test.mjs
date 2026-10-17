import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { analyse, maxVoltageKv, readFeatures, utilityOf } from '../scan.mjs'
import { haversine, polygonArea, pointSegmentDistance } from '../geo.mjs'

const box = (x, y, w, h) => ({ type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] })
const feat = (id, properties, geometry) => JSON.stringify({ type: 'Feature', id, properties, geometry })

const FIXTURE = [
  feat('n1', { power: 'substation', voltage: '275000;66000', name: '新京葉変電所', operator: '東京電力パワーグリッド' }, { type: 'Point', coordinates: [140.0, 35.7] }),
  feat('w2', { power: 'substation', substation: 'traction', voltage: '66000' }, box(140.001, 35.7, 0.001, 0.001)),
  feat('w2', { power: 'substation', substation: 'traction', voltage: '66000' }, { type: 'LineString', coordinates: box(140.001, 35.7, 0.001, 0.001).coordinates[0] }),
  feat('w3', { power: 'line', voltage: '275000' }, { type: 'LineString', coordinates: [[140.0, 35.69], [140.05, 35.69]] }),
  feat('w4', { power: 'line', voltage: '6600' }, { type: 'LineString', coordinates: [[140.0, 35.68], [140.05, 35.68]] }),
  feat('w5', { landuse: 'industrial', name: 'テスト工業団地' }, box(140.003, 35.701, 0.0025, 0.002)), // ~5 ha, near
  feat('w6', { landuse: 'brownfield' }, box(140.01, 35.71, 0.0005, 0.0005)), // too small
  feat('w7', { landuse: 'greenfield' }, box(141.5, 36.5, 0.003, 0.003)), // far from grid
  feat('w8', { landuse: 'residential' }, box(140.003, 35.705, 0.003, 0.003)), // wrong type
].join('\n')

function fixtureFile() {
  const dir = mkdtempSync(join(tmpdir(), 'scan-'))
  const path = join(dir, 'f.geojsonseq')
  writeFileSync(path, '\x1e' + FIXTURE.split('\n').join('\n\x1e') + '\n')
  return { dir, path }
}

test('geo helpers', () => {
  assert.ok(Math.abs(haversine([139, 35], [139, 36]) - 111_195) < 50)
  const ha = polygonArea(box(140, 35.7, 0.0025, 0.002)) / 10_000
  assert.ok(ha > 4.5 && ha < 5.5, `area ${ha}`)
  assert.ok(Math.abs(pointSegmentDistance([140, 35.701], [139.9, 35.7], [140.1, 35.7]) - 111) < 2)
})

test('voltage and utility parsing', () => {
  assert.equal(maxVoltageKv('275000;66000'), 275)
  assert.equal(maxVoltageKv(undefined), null)
  assert.equal(utilityOf('東京電力パワーグリッド'), 'tepco')
  assert.equal(utilityOf('関西電力送配電'), 'kansai')
  assert.equal(utilityOf('someone'), null)
})

test('analyse keeps only large sites near the grid', async () => {
  const { path } = fixtureFile()
  const data = await readFeatures(path)
  assert.equal(data.subs.length, 1, 'traction substation excluded')
  assert.equal(data.lines.length, 1, 'distribution line excluded')
  const sites = analyse(data, new Map([['w5', '2026-01-01']]), '2026-10-17')
  assert.deepEqual(sites.map((s) => s.id), ['w5'])
  const [s] = sites
  assert.equal(s.name, 'テスト工業団地')
  assert.equal(s.sub.kv, 275)
  assert.ok(s.sub.m > 200 && s.sub.m < 400, `sub distance ${s.sub.m}`)
  assert.equal(s.line.kv, 275)
  assert.equal(s.utility, 'tepco')
  assert.equal(s.firstSeen, '2026-01-01')
})

test('cli writes data files and tracks first-seen dates', () => {
  const { dir, path } = fixtureFile()
  const out = join(dir, 'out')
  const run = () => execFileSync('node', [join(import.meta.dirname, '../scan.mjs'), path, out], { encoding: 'utf8' })
  assert.equal(JSON.parse(run()).counts.newSites, 1)
  assert.equal(JSON.parse(run()).counts.newSites, 0)
  for (const f of ['sites.json', 'substations.json', 'lines.geojson', 'meta.json']) assert.ok(readFileSync(join(out, f), 'utf8').length > 2)
})
