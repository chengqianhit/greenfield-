import type { Meta, Site } from './types'
import { DEFAULT_WEIGHTS, WEIGHT_LABELS, scoreColor, scoreParts, type Weights } from './scoring'
import { LAND_STATUS_ZH, UTILITIES } from './utilities'

export interface Filters {
  minHa: number
  minKv: number
  maxSubKm: number
  utility: string
  onlyNew: boolean
  showOccupied: boolean
}

export const DEFAULT_FILTERS: Filters = { minHa: 3, minKv: 66, maxSubKm: 5, utility: '', onlyNew: false, showOccupied: false }

const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`)
const siteName = (s: Site) => s.name ?? `${LAND_STATUS_ZH[s.status]} ${s.ha}ha`

// Areas exported by osmium have ids a<2×way> or a<2×relation+1>.
function osmUrl(id: string) {
  const n = Number(id.slice(1))
  const [kind, num] = id[0] === 'a' ? (n % 2 ? ['relation', (n - 1) / 2] : ['way', n / 2]) : [{ w: 'way', r: 'relation', n: 'node' }[id[0]] ?? 'way', n]
  return `https://www.openstreetmap.org/${kind}/${num}`
}

interface ListProps {
  meta: Meta | null
  ranked: { site: Site; score: number }[]
  total: number
  filters: Filters
  setFilters: (f: Filters) => void
  weights: Weights
  setWeights: (w: Weights) => void
  onSelect: (id: string) => void
  isNew: (s: Site) => boolean
}

export function SiteList({ meta, ranked, total, filters, setFilters, weights, setWeights, onSelect, isNew }: ListProps) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v })
  return (
    <>
      <details className="box" open>
        <summary>筛选条件</summary>
        <label>最小面积 <b>{filters.minHa} ha</b>
          <input type="range" min={2} max={50} step={1} value={filters.minHa} onChange={(e) => set('minHa', +e.target.value)} />
        </label>
        <label>最近变电站距离 ≤ <b>{filters.maxSubKm} km</b>
          <input type="range" min={0.5} max={10} step={0.5} value={filters.maxSubKm} onChange={(e) => set('maxSubKm', +e.target.value)} />
        </label>
        <label>变电站电压 ≥
          <select value={filters.minKv} onChange={(e) => set('minKv', +e.target.value)}>
            
            <option value={66}>66 kV</option>
            <option value={154}>154 kV</option>
            <option value={275}>275 kV</option>
          </select>
        </label>
        <label>电网公司
          <select value={filters.utility} onChange={(e) => set('utility', e.target.value)}>
            <option value="">全部</option>
            {Object.entries(UTILITIES).map(([k, u]) => <option key={k} value={k}>{u.zh}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.onlyNew} onChange={(e) => set('onlyNew', e.target.checked)} /> 只看本次扫描新发现的
        </label>
        <label className="check">
          <input type="checkbox" checked={filters.showOccupied} onChange={(e) => set('showOccupied', e.target.checked)} /> 也显示使用中的工厂/电厂
        </label>
      </details>

      <details className="box">
        <summary>评分权重</summary>
        {(Object.keys(WEIGHT_LABELS) as (keyof Weights)[]).map((k) => (
          <label key={k}>{WEIGHT_LABELS[k]} <b>{weights[k]}</b>
            <input type="range" min={0} max={100} step={5} value={weights[k]} onChange={(e) => setWeights({ ...weights, [k]: +e.target.value })} />
          </label>
        ))}
        <button className="link" onClick={() => setWeights(DEFAULT_WEIGHTS)}>恢复默认</button>
      </details>

      <p className="muted small">
        {meta ? <>扫描于 {meta.scannedAt.slice(0, 10)}，共 {meta.counts.sites} 块候选地，符合条件 {total} 块</> : '加载中…'}
        {total > ranked.length && <>（显示前 {ranked.length} 块）</>}
      </p>
      <ol className="list">
        {ranked.map(({ site, score }) => (
          <li key={site.id}>
            <button onClick={() => onSelect(site.id)}>
              <span className="score" style={{ background: scoreColor(score) }}>{score}</span>
              <span className="grow">
                <span className="title">{siteName(site)}{isNew(site) && <span className="badge">新</span>}</span>
                <span className="muted small">
                  {site.ha} ha · {LAND_STATUS_ZH[site.status]} · {site.sub ? `${site.sub.kv}kV ${km(site.sub.m)}` : '附近无已知变电站'}
                  {site.utility && ` · ${UTILITIES[site.utility]?.zh}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ol>
    </>
  )
}

interface DetailProps {
  site: Site
  score: number
  weights: Weights
  onBack: () => void
  onReport: () => void
}

export function SiteDetail({ site, score, weights, onBack, onReport }: DetailProps) {
  const parts = scoreParts(site)
  const gmaps = `https://www.google.com/maps/search/?api=1&query=${site.lat},${site.lon}`
  const searchQuery = encodeURIComponent(`${site.name ?? ''} 土地 売地 OR 賃貸 OR 分譲 ${site.lat.toFixed(3)},${site.lon.toFixed(3)}`.trim())
  const osm = osmUrl(site.id)
  return (
    <div className="detail">
      <button className="link" onClick={onBack}>← 返回列表</button>
      <h2>{siteName(site)}</h2>
      <div className="big-score" style={{ background: scoreColor(score) }}>{score}<small> / 100</small></div>
      <table>
        <tbody>
          <tr><th>土地状态</th><td className={site.status === 'occupied' ? 'warn' : ''}>{LAND_STATUS_ZH[site.status]}</td></tr>
          <tr><th>面积</th><td>{site.ha} ha（约 {Math.round(site.ha * 3025 / 100) / 100} 万坪）</td></tr>
          <tr><th>坐标</th><td>{site.lat.toFixed(5)}, {site.lon.toFixed(5)}</td></tr>
          <tr><th>最近变电站</th><td>{site.sub ? `${site.sub.name ?? '名称未知'}（${site.sub.kv} kV）${km(site.sub.m)}` : '10 km 内无已知电压的变电站'}</td></tr>
          {site.subUnknown && <tr><th>更近的变电站</th><td>{site.subUnknown.name ?? '名称未知'}（电压未知）{km(site.subUnknown.m)}</td></tr>}
          <tr><th>最近高压线</th><td>{site.line ? `${site.line.name ?? ''} ${site.line.kv} kV，${km(site.line.m)}` : '10 km 内无 154kV 以上'}</td></tr>
          <tr><th>电网公司</th><td>{site.utility ? `${UTILITIES[site.utility]?.zh}（${UTILITIES[site.utility]?.ja}）` : '未能判断'}</td></tr>
          <tr><th>首次发现</th><td>{site.firstSeen}</td></tr>
          <tr><th>可租/可买</th><td className="warn">待确认（公开数据中没有买卖信息）</td></tr>
        </tbody>
      </table>
      <h3>评分构成</h3>
      <ul className="parts">
        {(Object.keys(parts) as (keyof Weights)[]).map((k) => (
          <li key={k}>
            <span>{WEIGHT_LABELS[k]}</span>
            <span className="bar"><span style={{ width: `${parts[k] * 100}%` }} /></span>
            <span className="muted small">权重 {weights[k]}</span>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button className="primary" onClick={onReport}>📄 生成接续申请报告</button>
        <a href={gmaps} target="_blank" rel="noreferrer">Google 地图</a>
        <a href={`https://www.google.com/search?q=${searchQuery}`} target="_blank" rel="noreferrer">搜索买卖/租赁信息</a>
        <a href={osm} target="_blank" rel="noreferrer">OSM 原始数据</a>
      </div>
    </div>
  )
}
