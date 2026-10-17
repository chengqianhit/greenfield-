import { useEffect, useMemo, useState } from 'react'
import './App.css'
import MapView, { type Basemap } from './MapView'
import Report from './Report'
import { DEFAULT_FILTERS, SiteDetail, SiteList, type Filters } from './SitePanel'
import { DEFAULT_WEIGHTS, score, type Weights } from './scoring'
import { checks } from './dd'
import { load, save } from './storage'
import type { Meta, Site, Substation } from './types'

const REGION = 'japan'
const DATA = `${import.meta.env.BASE_URL}data/${REGION}/`
const LIST_LIMIT = 200

type Route = { view: 'map' | 'report'; id: string | null }

function parseHash(): Route {
  const m = location.hash.match(/^#(site|report)=(.+)$/)
  if (!m) return { view: 'map', id: null }
  return { view: m[1] === 'report' ? 'report' : 'map', id: decodeURIComponent(m[2]) }
}

function useRoute(): [Route, (r: Route) => void] {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => setRoute(parseHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (r: Route) => {
    location.hash = r.id ? `${r.view === 'report' ? 'report' : 'site'}=${encodeURIComponent(r.id)}` : ''
  }
  return [route, go]
}

async function fetchJson<T>(name: string): Promise<T> {
  const res = await fetch(DATA + name)
  if (!res.ok) throw new Error(`${name}: ${res.status}`)
  return res.json()
}

function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [sites, setSites] = useState<Site[]>([])
  const [subs, setSubs] = useState<Substation[]>([])
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<Filters>(() => load('greenfield.filters', DEFAULT_FILTERS))
  const [weights, setWeights] = useState<Weights>(() => load('greenfield.weights', DEFAULT_WEIGHTS))
  const [basemap, setBasemap] = useState<Basemap>('photo')
  const [showFlood, setShowFlood] = useState(false)
  const [showGrid, setShowGrid] = useState(true)
  const [panelOpen, setPanelOpen] = useState(true)
  const [route, go] = useRoute()

  useEffect(() => save('greenfield.filters', filters), [filters])
  useEffect(() => save('greenfield.weights', weights), [weights])

  useEffect(() => {
    Promise.all([fetchJson<Meta>('meta.json'), fetchJson<Site[]>('sites.json'), fetchJson<Substation[]>('substations.json')])
      .then(([m, s, b]) => { setMeta(m); setSites(s); setSubs(b) })
      .catch(() => setError('还没有扫描数据。GitHub 上的「Scan sites」任务完成后刷新即可。'))
  }, [])

  const isNew = (s: Site) => !!meta && s.firstSeen === meta.scannedAt.slice(0, 10)

  const filtered = useMemo(
    () =>
      sites.filter(
        (s) =>
          s.ha >= filters.minHa &&
          s.sub !== null &&
          s.sub.m <= filters.maxSubKm * 1000 &&
          (s.sub.kv ?? 0) >= filters.minKv &&
          (filters.showOccupied || s.status !== 'occupied') &&
          (!filters.hideFailed || !checks(s).some((c) => c.status === 'fail')) &&
          (!filters.utility || s.utility === filters.utility) &&
          (!filters.onlyNew || isNew(s)),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sites, filters, meta],
  )
  const scores = useMemo(() => new Map(filtered.map((s) => [s.id, score(s, weights)])), [filtered, weights])
  const ranked = useMemo(
    () => filtered.map((site) => ({ site, score: scores.get(site.id)! })).sort((a, b) => b.score - a.score).slice(0, LIST_LIMIT),
    [filtered, scores],
  )

  const selected = useMemo(() => sites.find((s) => s.id === route.id) ?? null, [sites, route.id])
  const select = (id: string) => { go({ view: 'map', id }); setPanelOpen(true) }

  if (route.view === 'report' && selected) return <Report site={selected} onClose={() => go({ view: 'map', id: selected.id })} />

  return (
    <div className="app">
      <MapView
        sites={filtered}
        scores={scores}
        substations={subs}
        linesUrl={DATA + 'lines.geojson'}
        selected={selected}
        onSelect={select}
        basemap={basemap}
        showFlood={showFlood}
        showGrid={showGrid}
      />

      <div className="toolbar">
        <strong className="brand">Greenfield · AIDC 选址</strong>
        <select value={basemap} onChange={(e) => setBasemap(e.target.value as Basemap)} aria-label="底图">
          <option value="photo">航拍（日本）</option>
          <option value="std">标准地图</option>
          <option value="esri">卫星（全球）</option>
        </select>
        <label className="check"><input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />电网</label>
        <label className="check"><input type="checkbox" checked={showFlood} onChange={(e) => setShowFlood(e.target.checked)} />洪水风险</label>
      </div>

      <aside className={`panel ${panelOpen ? 'open' : ''}`}>
        <button className="handle" onClick={() => setPanelOpen(!panelOpen)} aria-label="展开/收起">
          {panelOpen ? '▾ 收起' : `▴ 候选地（${filtered.length}）`}
        </button>
        <div className="panel-body">
          {error && <p className="warn">{error}</p>}
          {selected ? (
            <SiteDetail
              site={selected}
              score={score(selected, weights)}
              weights={weights}
              onBack={() => go({ view: 'map', id: null })}
              onReport={() => go({ view: 'report', id: selected.id })}
            />
          ) : (
            <SiteList
              meta={meta}
              ranked={ranked}
              total={filtered.length}
              filters={filters}
              setFilters={setFilters}
              weights={weights}
              setWeights={setWeights}
              onSelect={select}
              isNew={isNew}
            />
          )}
        </div>
      </aside>

      <div className="legend">
        <span><i style={{ background: '#16a34a' }} />75+</span>
        <span><i style={{ background: '#84cc16' }} />60+</span>
        <span><i style={{ background: '#eab308' }} />45+</span>
        <span><i style={{ background: '#f97316' }} />&lt;45</span>
        {showGrid && <span className="sep">变电站/线路：<i style={{ background: '#ef4444' }} />275kV+ <i style={{ background: '#a855f7' }} />154 <i style={{ background: '#38bdf8' }} />66</span>}
      </div>
    </div>
  )
}

export default App
