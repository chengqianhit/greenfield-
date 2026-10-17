import { useEffect, useRef, useState } from 'react'
import { Map as MlMap } from 'maplibre-gl'
import type { Site } from './types'
import { suggestedVoltage } from './scoring'
import { LAND_STATUS_JA, UTILITIES } from './utilities'
import { STATUS_ICON, checks } from './dd'

const CHECK_JA: Record<string, string> = {
  grid: '系統接続（最寄り変電所）', vacant: '現況の建物（建物データ）', cover: '土地被覆（衛星画像分類）', vision: '航空写真の AI 判読',
  slope: '地形・傾斜', homes: '住宅との離隔', flood: '洪水浸水想定', tsunami: '津波浸水想定', landslide: '土砂災害警戒区域',
}
const STATUS_JA = { pass: '適', warn: '要確認', fail: '不適', unknown: '未確認' }
import { load, save } from './storage'

interface Applicant {
  company: string
  person: string
  contact: string
  mw: number
  startDate: string
  notes: string
}

const DEFAULT_APPLICANT: Applicant = { company: '', person: '', contact: '', mw: 50, startDate: '', notes: '' }
const KEY = 'greenfield.applicant'

const km = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`)

function SiteMap({ site }: { site: Site }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const map = new MlMap({
      container: ref.current!,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: {
        version: 8,
        sources: {
          photo: { type: 'raster', tiles: ['https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg'], tileSize: 256, maxzoom: 18 },
          site: { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: site.polygons.map((r) => [r]) } } },
        },
        layers: [
          { id: 'photo', type: 'raster', source: 'photo' },
          { id: 'site', type: 'line', source: 'site', paint: { 'line-color': '#ff2d2d', 'line-width': 3 } },
        ],
      },
      center: [site.lon, site.lat],
      zoom: 15,
    })
    const xs = site.polygons.flat().map((p) => p[0]), ys = site.polygons.flat().map((p) => p[1])
    if (xs.length) map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 40, animate: false, maxZoom: 17 })
    return () => map.remove()
  }, [site])
  return <div ref={ref} className="report-map" />
}

export default function Report({ site, onClose }: { site: Site; onClose: () => void }) {
  const [a, setA] = useState<Applicant>(() => load(KEY, DEFAULT_APPLICANT))
  useEffect(() => save(KEY, a), [a])
  const set = <K extends keyof Applicant>(k: K, v: Applicant[K]) => setA({ ...a, [k]: v })
  const utility = site.utility ? UTILITIES[site.utility] : null
  const [today] = useState(() => new Date().toLocaleDateString('ja-JP'))
  const name = site.name ?? `${LAND_STATUS_JA[site.status]}（${site.lat.toFixed(4)}, ${site.lon.toFixed(4)}）`

  return (
    <div className="report-wrap">
      <div className="report-toolbar no-print">
        <button className="link" onClick={onClose}>← 返回地图</button>
        <span className="muted small">先填写下面的申请人信息（会自动保存），再点「打印 / 存为 PDF」。</span>
        <button className="primary" onClick={() => window.print()}>🖨 打印 / 存为 PDF</button>
      </div>

      <article className="report">
        <p className="draft">【ドラフト】本資料は公開データから自動作成した事前検討資料です。正式な申込書式は一般送配電事業者の指定様式をご使用ください。</p>
        <h1>特別高圧受電 接続検討申込 事前資料</h1>
        <p className="right">作成日：{today}</p>

        <h2>1. 申込者</h2>
        <table>
          <tbody>
            <tr><th>会社名</th><td><input value={a.company} onChange={(e) => set('company', e.target.value)} placeholder="株式会社〇〇" /></td></tr>
            <tr><th>担当者</th><td><input value={a.person} onChange={(e) => set('person', e.target.value)} placeholder="氏名" /></td></tr>
            <tr><th>連絡先</th><td><input value={a.contact} onChange={(e) => set('contact', e.target.value)} placeholder="電話番号 / メール" /></td></tr>
          </tbody>
        </table>

        <h2>2. 計画概要</h2>
        <table>
          <tbody>
            <tr><th>用途</th><td>データセンター（AI データセンター / AIDC）</td></tr>
            <tr><th>最大受電電力</th><td><input type="number" min={1} value={a.mw} onChange={(e) => set('mw', +e.target.value)} className="num" /> MW（{(a.mw * 1000).toLocaleString()} kW）</td></tr>
            <tr><th>希望受電電圧（目安）</th><td>{suggestedVoltage(a.mw)}</td></tr>
            <tr><th>希望受電開始時期</th><td><input value={a.startDate} onChange={(e) => set('startDate', e.target.value)} placeholder="例：2029年4月" /></td></tr>
            <tr><th>備考</th><td><textarea value={a.notes} onChange={(e) => set('notes', e.target.value)} rows={2} placeholder="段階的増設計画、冗長構成（2回線受電）など" /></td></tr>
          </tbody>
        </table>

        <h2>3. 計画地点</h2>
        <table>
          <tbody>
            <tr><th>名称</th><td>{name}</td></tr>
            <tr><th>位置（緯度・経度）</th><td>{site.lat.toFixed(6)}, {site.lon.toFixed(6)}</td></tr>
            <tr><th>敷地面積（概算）</th><td>{site.ha} ha（約 {Math.round(site.ha * 3025).toLocaleString()} 坪）</td></tr>
            <tr><th>土地区分（推定）</th><td>{LAND_STATUS_JA[site.status]}</td></tr>
            <tr><th>地図</th><td>https://www.google.com/maps?q={site.lat},{site.lon}</td></tr>
          </tbody>
        </table>
        <SiteMap site={site} />
        <p className="caption">位置図（背景：国土地理院 シームレス空中写真、赤枠：計画地点）</p>

        <h2>4. 近傍の系統設備（公開データによる推定）</h2>
        <table>
          <tbody>
            <tr><th>最寄り変電所</th><td>{site.sub ? `${site.sub.name ?? '名称不明'}（${site.sub.kv} kV）／ 約 ${km(site.sub.m)}` : '10 km 以内に該当なし'}</td></tr>
            {site.subUnknown && <tr><th>より近い変電所（電圧不明）</th><td>{site.subUnknown.name ?? '名称不明'}／ 約 {km(site.subUnknown.m)}</td></tr>}
            <tr><th>最寄り送電線（154kV 以上）</th><td>{site.line ? `${site.line.name ?? '名称不明'}（${site.line.kv} kV）／ 約 ${km(site.line.m)}` : '10 km 以内に該当なし'}</td></tr>
            <tr><th>一般送配電事業者</th><td>{utility?.ja ?? '要確認'}</td></tr>
          </tbody>
        </table>

        <h2>5. 立地スクリーニング結果（公開データによる自動判定）</h2>
        <table>
          <tbody>
            {checks(site).map((c) => (
              <tr key={c.key}><th>{CHECK_JA[c.key] ?? c.label}</th><td>{STATUS_ICON[c.status]} {STATUS_JA[c.status]}</td></tr>
            ))}
          </tbody>
        </table>
        {site.vision && <p className="caption">航空写真判読（{site.vision.at}）：{site.vision.note}</p>}

        <h2>6. 申込前の確認事項</h2>
        <ul className="checklist">
          <li>☐ {utility?.ja ?? '一般送配電事業者'}の空き容量マップで、最寄り変電所・送電線の空き容量を確認</li>
          <li>☐ 法務局で登記簿謄本・公図を取得し、所有者と地目を確認（売買／賃貸の可否）</li>
          <li>☐ 都市計画（用途地域・市街化調整区域）、農地転用・林地開発の要否を自治体に確認</li>
          <li>☐ ハザードマップ（洪水・土砂災害・液状化）の確認</li>
          <li>☐ 通信（光ファイバー）・用水・排熱の条件確認</li>
        </ul>

        <h2>7. 接続検討申込の主な提出書類（一般例）</h2>
        <ul className="checklist">
          <li>☐ 接続検討申込書（事業者指定様式）</li>
          <li>☐ 位置図・配置図</li>
          <li>☐ 単線結線図（受電設備の構成）</li>
          <li>☐ 負荷設備の概要・最大電力の算定根拠</li>
          <li>☐ 受電開始希望時期・段階的増設計画</li>
        </ul>

        <p className="source">
          出典：変電所・送電線・土地区分は OpenStreetMap（© OpenStreetMap contributors, ODbL）による。距離は敷地境界からの直線距離の概算であり、
          実際の連系可否・工事費・工期は一般送配電事業者の接続検討回答によって確定します。
        </p>
      </article>
    </div>
  )
}
