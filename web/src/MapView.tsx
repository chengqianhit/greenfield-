import { useEffect, useRef } from 'react'
import { GlobeControl, Map as MlMap, NavigationControl, ScaleControl, TerrainControl } from 'maplibre-gl'
import type { GeoJSONSource, MapLayerMouseEvent, StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { Site, Substation } from './types'
import { scoreColor } from './scoring'

export type Basemap = 'photo' | 'std' | 'esri'

const GSI = '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">国土地理院</a>'

const BASEMAPS: Record<Basemap, { tiles: string; attribution: string; maxzoom: number }> = {
  photo: { tiles: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg', attribution: GSI, maxzoom: 18 },
  std: { tiles: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png', attribution: GSI, maxzoom: 18 },
  esri: {
    tiles: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Imagery',
    maxzoom: 19,
  },
}

const FLOOD_TILES = 'https://disaportaldata.gsi.go.jp/raster/01_flood_l2_shinsuishin_data/{z}/{x}/{y}.png'

function baseStyle(basemap: Basemap): StyleSpecification {
  const b = BASEMAPS[basemap]
  return {
    version: 8,
    sources: {
      base: { type: 'raster', tiles: [b.tiles], tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
      flood: {
        type: 'raster', tiles: [FLOOD_TILES], tileSize: 256, minzoom: 2, maxzoom: 17,
        attribution: '<a href="https://disaportal.gsi.go.jp/" target="_blank">ハザードマップポータル</a>',
      },
      terrain: {
        type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
        tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
        attribution: 'Terrain: Mapzen/AWS',
      },
    },
    layers: [
      { id: 'base', type: 'raster', source: 'base' },
      { id: 'flood', type: 'raster', source: 'flood', paint: { 'raster-opacity': 0.6 }, layout: { visibility: 'none' } },
    ],
    projection: { type: 'globe' },
  }
}

const KV_COLOR = ['step', ['coalesce', ['get', 'kv'], 0], '#94a3b8', 66, '#38bdf8', 154, '#a855f7', 275, '#ef4444'] as const

function siteFeatures(sites: Site[], scores: Map<string, number>, selected: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: sites.map((s) => {
      const sc = scores.get(s.id) ?? 0
      return {
        type: 'Feature' as const,
        properties: { id: s.id, score: sc, color: scoreColor(sc), selected: s.id === selected },
        geometry: { type: 'MultiPolygon' as const, coordinates: s.polygons.map((r) => [r]) },
      }
    }),
  }
}

function sitePoints(sites: Site[], scores: Map<string, number>, selected: string | null) {
  return {
    type: 'FeatureCollection' as const,
    features: sites.map((s) => {
      const sc = scores.get(s.id) ?? 0
      return {
        type: 'Feature' as const,
        properties: { id: s.id, score: sc, color: scoreColor(sc), selected: s.id === selected },
        geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
      }
    }),
  }
}

function substationFeatures(subs: Substation[]) {
  return {
    type: 'FeatureCollection' as const,
    features: subs.map((s) => ({
      type: 'Feature' as const,
      properties: { kv: s.kv, label: `${s.name ?? '变电站'}${s.kv ? ` ${s.kv}kV` : ''}` },
      geometry: { type: 'Point' as const, coordinates: [s.lon, s.lat] },
    })),
  }
}

interface Props {
  sites: Site[]
  scores: Map<string, number>
  substations: Substation[]
  linesUrl: string
  selected: Site | null
  onSelect: (id: string) => void
  basemap: Basemap
  showFlood: boolean
  showGrid: boolean
}

export default function MapView({ sites, scores, substations, linesUrl, selected, onSelect, basemap, showFlood, showGrid }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MlMap | null>(null)
  const readyRef = useRef(false)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const latest = useRef({ sites, scores, substations, selectedId: selected?.id ?? null, showFlood, showGrid })
  latest.current = { sites, scores, substations, selectedId: selected?.id ?? null, showFlood, showGrid }

  // Adds our data layers on top of whatever basemap style is loaded.
  const addOverlays = (map: MlMap) => {
    if (map.getSource('lines')) return
    const { sites, scores, substations, selectedId, showFlood, showGrid } = latest.current
    map.addSource('lines', { type: 'geojson', data: linesUrl })
    map.addSource('subs', { type: 'geojson', data: substationFeatures(substations) })
    map.addSource('sites', { type: 'geojson', data: siteFeatures(sites, scores, selectedId) })
    map.addSource('site-points', { type: 'geojson', data: sitePoints(sites, scores, selectedId) })
    const gridVis = showGrid ? 'visible' : 'none'
    map.addLayer({
      id: 'lines', type: 'line', source: 'lines', layout: { visibility: gridVis },
      paint: { 'line-color': KV_COLOR as never, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.6, 12, 2.5], 'line-opacity': 0.85 },
    })
    map.addLayer({
      id: 'subs', type: 'circle', source: 'subs', layout: { visibility: gridVis },
      paint: {
        'circle-color': KV_COLOR as never,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 12, 6],
        'circle-stroke-color': '#fff', 'circle-stroke-width': 1,
      },
    })
    map.addLayer({
      id: 'sites-fill', type: 'fill', source: 'sites', minzoom: 10,
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['get', 'selected'], 0.55, 0.35] },
    })
    map.addLayer({
      id: 'sites-line', type: 'line', source: 'sites', minzoom: 10,
      paint: { 'line-color': ['case', ['get', 'selected'], '#ffffff', ['get', 'color']], 'line-width': ['case', ['get', 'selected'], 3, 1.5] },
    })
    map.addLayer({
      id: 'site-points', type: 'circle', source: 'site-points', maxzoom: 12,
      paint: {
        'circle-color': ['get', 'color'],
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, ['case', ['get', 'selected'], 7, 3], 11, ['case', ['get', 'selected'], 11, 7]],
        'circle-stroke-color': ['case', ['get', 'selected'], '#ffffff', '#1f2937'],
        'circle-stroke-width': ['case', ['get', 'selected'], 3, 0.5],
      },
    })
    map.addLayer({
      id: 'subs-label', type: 'symbol', source: 'subs', minzoom: 11, layout: { visibility: gridVis, 'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, 1.2] },
      paint: { 'text-color': '#fff', 'text-halo-color': '#111', 'text-halo-width': 1.5 },
    })
    map.setLayoutProperty('flood', 'visibility', showFlood ? 'visible' : 'none')
    readyRef.current = true
  }

  useEffect(() => {
    const map = new MlMap({
      container: container.current!,
      style: baseStyle(basemap),
      center: [137.5, 36.5],
      zoom: 4.6,
      maxPitch: 80,
      canvasContextAttributes: { preserveDrawingBuffer: true },
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right')
    map.addControl(new GlobeControl(), 'top-right')
    map.addControl(new TerrainControl({ source: 'terrain', exaggeration: 1.5 }), 'top-right')
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left')
    map.on('load', () => addOverlays(map))
    const click = (e: MapLayerMouseEvent) => {
      const id = e.features?.[0]?.properties?.id
      if (id) onSelectRef.current(String(id))
    }
    for (const layer of ['sites-fill', 'site-points']) {
      map.on('click', layer, click)
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''))
    }
    return () => { readyRef.current = false; map.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switching basemap swaps the style, so overlays are re-added.
  const shownBasemap = useRef(basemap)
  useEffect(() => {
    const map = mapRef.current
    if (!map || shownBasemap.current === basemap) return
    shownBasemap.current = basemap
    readyRef.current = false
    map.setStyle(baseStyle(basemap))
    map.once('style.load', () => addOverlays(map))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    const id = selected?.id ?? null
    ;(map.getSource('sites') as GeoJSONSource).setData(siteFeatures(sites, scores, id))
    ;(map.getSource('site-points') as GeoJSONSource).setData(sitePoints(sites, scores, id))
  }, [sites, scores, selected])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    ;(map.getSource('subs') as GeoJSONSource).setData(substationFeatures(substations))
  }, [substations])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !readyRef.current) return
    map.setLayoutProperty('flood', 'visibility', showFlood ? 'visible' : 'none')
    for (const l of ['lines', 'subs', 'subs-label']) map.setLayoutProperty(l, 'visibility', showGrid ? 'visible' : 'none')
  }, [showFlood, showGrid])

  useEffect(() => {
    if (selected) mapRef.current?.flyTo({ center: [selected.lon, selected.lat], zoom: Math.max(14, Math.min(16, 17 - Math.log2(selected.ha))), duration: 1200 })
  }, [selected])

  return <div ref={container} className="map" />
}
