// MapLibre v6 finds its worker next to its own module by default, which breaks
// once Vite bundles it, so point it at a worker Vite builds for us.
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'

setWorkerUrl(workerUrl)
