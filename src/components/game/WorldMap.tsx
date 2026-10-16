'use client';

import polyline from '@mapbox/polyline';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import { int } from '@/lib/format';
import { cumulativeKm, greatCircle, pointAlong, type LatLon } from '@/lib/geo/geometry';
import { stateAt, type Segment } from '@/lib/game/schedule';

export interface MapLeg {
  geometry: string | null;
  from: LatLon;
  to: LatLon;
  km: number;
}
export interface MapVehicle {
  id: string;
  plate: string;
  label: string;
  color: string;
  position: LatLon; // parking position when idle
  delivery: null | { schedule: Segment[]; empty: MapLeg | null; loaded: MapLeg; title: string };
}
export interface MapProps {
  styleUrl: string;
  center: LatLon;
  vehicles: MapVehicle[];
  depots: { name: string; position: LatLon }[];
  preview: null | { leg: MapLeg; title: string; approximate: boolean };
}

interface CityDetails {
  name: string;
  nameLatin: string;
  country: string;
  countryCode: string;
  region: string | null;
  population: number;
  lat: number;
  lon: number;
  ports: string[];
  openContracts: number;
  market: { cargo: string; produces: boolean; consumes: boolean; demand: number }[];
}

// Served from /public (see scripts/copy-vendor.mjs) so bundlers need no worker plumbing.
maplibregl.setWorkerUrl('/vendor/maplibre-gl-worker.mjs');

const legLine = (leg: MapLeg): LatLon[] => (leg.geometry ? (polyline.decode(leg.geometry, 6) as LatLon[]) : greatCircle(leg.from, leg.to));
const toLngLat = (p: LatLon): [number, number] => [p[1], p[0]];

function vehiclePoint(v: MapVehicle, now: number): LatLon {
  if (!v.delivery) return v.position;
  const s = stateAt(v.delivery.schedule, now);
  const leg = s.leg === 'empty' && v.delivery.empty ? v.delivery.empty : v.delivery.loaded;
  if (s.done) return v.delivery.loaded.to;
  const line = legLine(leg);
  return pointAlong(line, leg.km > 0 ? s.km / leg.km : 0, cumulativeKm(line));
}

function routeFeatures(vehicles: MapVehicle[], preview: MapProps['preview']): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const v of vehicles) {
    if (!v.delivery) continue;
    if (v.delivery.empty) features.push({ type: 'Feature', properties: { kind: 'empty' }, geometry: { type: 'LineString', coordinates: legLine(v.delivery.empty).map(toLngLat) } });
    features.push({ type: 'Feature', properties: { kind: 'loaded' }, geometry: { type: 'LineString', coordinates: legLine(v.delivery.loaded).map(toLngLat) } });
  }
  if (preview) features.push({ type: 'Feature', properties: { kind: preview.approximate ? 'approx' : 'preview' }, geometry: { type: 'LineString', coordinates: legLine(preview.leg).map(toLngLat) } });
  return { type: 'FeatureCollection', features };
}

function depotFeatures(depots: MapProps['depots']): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: depots.map((d) => ({ type: 'Feature', properties: { name: d.name }, geometry: { type: 'Point', coordinates: toLngLat(d.position) } })) };
}

export function WorldMap({ styleUrl, center, vehicles, depots, preview }: MapProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [city, setCity] = useState<CityDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Latest props for the one-time initialisation (data updates are applied by effects below).
  const initial = useRef({ center, preview });

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: toLngLat(initial.current.center),
      zoom: 5.4,
      attributionControl: { compact: true, customAttribution: 'Градове: GeoNames · Маршрути: Valhalla / OSM' },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('error', (e) => {
      if (e.error?.message?.includes('could not be loaded')) return; // missing sprite icons are harmless
      setError(e.error?.message ?? 'Грешка при зареждане на картата');
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);

    const loadCities = async () => {
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()].map((n) => n.toFixed(3)).join(',');
      const res = await fetch(`/api/geo/cities?bbox=${bbox}&zoom=${map.getZoom().toFixed(1)}`);
      if (!res.ok) return;
      (map.getSource('cities') as GeoJSONSource | undefined)?.setData(await res.json());
    };

    map.on('load', () => {
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.addSource('cities', { type: 'geojson', data: empty });
      map.addLayer({ id: 'cities-dot', type: 'circle', source: 'cities', paint: {
        'circle-radius': ['interpolate', ['linear'], ['get', 'population'], 15000, 3, 500000, 6, 3000000, 9],
        'circle-color': ['case', ['get', 'hub'], '#f6c343', '#8d9bb3'],
        'circle-stroke-color': '#05070b',
        'circle-stroke-width': 1.5,
      } });
      map.addLayer({ id: 'cities-label', type: 'symbol', source: 'cities', layout: {
        'text-field': ['case', ['>', ['get', 'open'], 0], ['concat', ['get', 'name'], ' · ', ['to-string', ['get', 'open']]], ['get', 'name']],
        'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'],
      }, paint: { 'text-color': '#e8eef7', 'text-halo-color': '#05070b', 'text-halo-width': 1.5 } });

      map.addSource('routes', { type: 'geojson', data: empty });
      map.addLayer({ id: 'routes-glow', type: 'line', source: 'routes', paint: { 'line-color': '#2f7bff', 'line-width': 9, 'line-opacity': 0.25 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
      map.addLayer({ id: 'routes-line', type: 'line', source: 'routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: {
        'line-color': ['match', ['get', 'kind'], 'empty', '#8d9bb3', 'preview', '#f6c343', 'approx', '#ff8a1f', '#22d3ee'],
        'line-width': 3.5,
        'line-dasharray': ['match', ['get', 'kind'], 'empty', ['literal', [1, 2]], 'approx', ['literal', [2, 2]], ['literal', [1, 0]]],
      } });
      map.addSource('depots', { type: 'geojson', data: empty });
      map.addLayer({ id: 'depots', type: 'circle', source: 'depots', paint: { 'circle-radius': 11, 'circle-color': 'rgba(166,107,255,0.15)', 'circle-stroke-color': '#a66bff', 'circle-stroke-width': 2 } });
      map.addSource('vehicles', { type: 'geojson', data: empty });
      map.addLayer({ id: 'vehicles-halo', type: 'circle', source: 'vehicles', paint: { 'circle-radius': 12, 'circle-color': '#22d3ee', 'circle-opacity': 0.25 } });
      map.addLayer({ id: 'vehicles', type: 'circle', source: 'vehicles', paint: { 'circle-radius': 6.5, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#22d3ee', 'circle-stroke-width': 2.5 } });
      map.addLayer({ id: 'vehicles-label', type: 'symbol', source: 'vehicles', layout: { 'text-field': ['get', 'plate'], 'text-size': 11, 'text-offset': [0, -1.6], 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#22d3ee', 'text-halo-color': '#05070b', 'text-halo-width': 1.5 } });

      const p = initial.current.preview;
      if (p) {
        const line = legLine(p.leg).map(toLngLat);
        const bounds = line.reduce((b, c) => b.extend(c), new maplibregl.LngLatBounds(line[0], line[0]));
        map.fitBounds(bounds, { padding: 80, duration: 0 });
      }
      setReady(true);
      void loadCities();
    });
    map.on('moveend', () => void loadCities());
    map.on('mouseenter', 'cities-dot', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'cities-dot', () => (map.getCanvas().style.cursor = ''));
    map.on('click', 'cities-dot', async (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (!id) return;
      const res = await fetch(`/api/geo/city/${id}`);
      if (res.ok) setCity((await res.json()) as CityDetails);
    });
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [styleUrl]);

  // Data layers follow server refreshes without recreating the map.
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource('routes') as GeoJSONSource | undefined)?.setData(routeFeatures(vehicles, preview));
    (mapRef.current?.getSource('depots') as GeoJSONSource | undefined)?.setData(depotFeatures(depots));
  }, [ready, vehicles, depots, preview]);

  // Animate vehicle positions from their schedules.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      const src = mapRef.current?.getSource('vehicles') as GeoJSONSource | undefined;
      const now = Date.now();
      src?.setData({ type: 'FeatureCollection', features: vehicles.map((v) => ({ type: 'Feature', properties: { plate: v.plate, color: v.color }, geometry: { type: 'Point', coordinates: toLngLat(vehiclePoint(v, now)) } })) });
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [ready, vehicles]);

  return (
    <div className="relative h-[calc(100dvh-210px)] min-h-[420px] overflow-hidden rounded-2xl border border-asphalt-700">
      <div ref={container} className="h-full w-full" />
      {error && <div className="absolute left-3 top-3 rounded-lg bg-loss/90 px-3 py-2 text-sm text-white">{error}</div>}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-xl bg-asphalt-950/85 px-3 py-2 text-[11px] text-mist-300 backdrop-blur">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gold-400" />Град с товарен пазар (число = поръчки)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-cyan-glow" />С товар</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dotted border-mist-400" />Празен курс</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-prestige" />Депо</span>
      </div>
      {city && (
        <aside className="absolute right-3 top-14 w-[min(320px,calc(100%-24px))] rounded-2xl border border-asphalt-600 bg-asphalt-950/95 p-4 text-sm shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold">{city.name}</div>
              <div className="text-xs text-mist-400">{city.nameLatin} · {city.country} ({city.countryCode}){city.region ? ` · ${city.region}` : ''}</div>
            </div>
            <button className="text-mist-400 hover:text-white" onClick={() => setCity(null)} aria-label="Затвори">✕</button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-mist-400">Население</dt><dd className="num">{int(city.population)}</dd></div>
            <div><dt className="text-mist-400">Координати</dt><dd className="num">{city.lat.toFixed(4)}, {city.lon.toFixed(4)}</dd></div>
            <div><dt className="text-mist-400">Отворени поръчки</dt><dd className="num">{city.openContracts}</dd></div>
            <div><dt className="text-mist-400">Пристанища</dt><dd>{city.ports.length ? city.ports.join(', ') : '—'}</dd></div>
          </dl>
          {city.market.length > 0 && (
            <div className="mt-3">
              <div className="label">Игрови пазарен профил</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {city.market.map((m) => (
                  <li key={m.cargo} className="flex justify-between gap-2">
                    <span>{m.cargo}</span>
                    <span className="text-mist-400">{[m.produces && 'произвежда', m.consumes && `търси (${m.demand.toFixed(2)}×)`].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-mist-400">Симулирани данни на играта, не реална статистика.</p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}
