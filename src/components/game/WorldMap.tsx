'use client';

import polyline from '@mapbox/polyline';
import { nightShade, sunAltitude } from '@/lib/geo/sun';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Users } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { duration, int, money } from '@/lib/format';
import { cumulativeKm, greatCircle, headingWest, pointAlong, type LatLon } from '@/lib/geo/geometry';
import { isMoving, scheduleEnd, stateAt, type Segment } from '@/lib/game/schedule';
import type { WorldSnapshot, WorldTruck } from '@/server/game/world-map';
import { PlayerName } from './PlayerName';
import { CONVOY_RULES } from '@/lib/game/convoy';
import { helpableStop, ROADSIDE } from '@/lib/game/roadside';
import { ActionButton } from '@/components/ui/ActionButton';
import { api } from '@/lib/client/api';
import { useFeature } from './Features';
import { motionEnabled } from '@/lib/client/motion';
import { t as tr, tx } from '@/i18n/t';
import { CROWD_CAP, DEFAULT_MAP_LAYERS, mapLayers as resolveLayers, nearestFirst, type MapLayerKey, type MapLayers } from '@/lib/game/map-layers';

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
  /** The player is VIP: golden glow on their own trucks. */
  ownVip?: boolean;
  /** Баба Марта (v1.5): the stork of the day over a real city — click it to spot it. */
  stork?: { name: string; position: LatLon } | null;
  /** v1.5: the company's base and the bases of its alliance. */
  bases?: { name: string; city: string; color: string | null; position: LatLon; own: boolean }[];
  /** v1.8: road reports from the drivers (accident, police, jam…). */
  reports?: { id: number; emoji: string; label: string; near: string; position: LatLon }[];
  /** 1.2.2: a shorter map on top of „Курсове“ (the full one stays on /game/map). */
  compact?: boolean;
  /** 1.2.8: snow, ice and blizzards by country today (only the countries that have them). */
  weather?: Partial<Record<string, 'snow' | 'ice' | 'blizzard'>>;
  /** 1.2.3.6: the map layers the player chose (kept in the profile). */
  layers?: Partial<MapLayers> | null;
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
/** 1.2.8: open elevation tiles (Mapzen terrarium encoding on AWS Open Data). */
const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function vehiclePoint(v: MapVehicle, now: number): { point: LatLon; west: boolean } {
  if (!v.delivery) return { point: v.position, west: false };
  const s = stateAt(v.delivery.schedule, now);
  const leg = s.leg === 'empty' && v.delivery.empty ? v.delivery.empty : v.delivery.loaded;
  if (s.done) return { point: v.delivery.loaded.to, west: false };
  const line = legLine(leg);
  const cum = cumulativeKm(line);
  const f = leg.km > 0 ? s.km / leg.km : 0;
  return { point: pointAlong(line, f, cum), west: headingWest(line, f, cum) };
}

/**
 * Truck icons are drawn in the browser (no image files): a side-view lorry in the
 * company colour with an outline that marks whose truck it is. The icon id carries
 * the colours, e.g. "truck|#f8fafc|#34d399", and is created on first use.
 */
const truckIcon = (fill: string, ring: string, vip = false, west = false) => `truck|${fill}|${ring}|${vip ? 'v' : ''}|${west ? 'w' : 'e'}`;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The cab faces east; `west` mirrors the icon so a truck heading west drives cab first. */
function drawTruck(fill: string, ring: string, vip = false, west = false): ImageData | null {
  const r = 2; // pixel ratio
  const canvas = document.createElement('canvas');
  canvas.width = 34 * r;
  canvas.height = 22 * r;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(r, r);
  if (west) {
    ctx.translate(34, 0);
    ctx.scale(-1, 1);
  }
  ctx.lineJoin = 'round';
  if (vip) {
    // VIP: a golden glow around the whole truck.
    ctx.shadowColor = '#d4af37';
    ctx.shadowBlur = 4;
  }
  const shape = (draw: () => void, color: string, stroke = true) => {
    ctx.beginPath();
    draw();
    ctx.fillStyle = color;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = ring;
      ctx.stroke();
    }
  };
  // Trailer box, cab (facing right), window and wheels.
  shape(() => ctx.roundRect(2, 3, 20, 12, 1.5), fill);
  shape(() => {
    ctx.moveTo(23, 15);
    ctx.lineTo(23, 6);
    ctx.lineTo(28.5, 6);
    ctx.lineTo(32, 10);
    ctx.lineTo(32, 15);
    ctx.closePath();
  }, fill);
  shape(() => {
    ctx.moveTo(25, 7.5);
    ctx.lineTo(28, 7.5);
    ctx.lineTo(30.3, 10);
    ctx.lineTo(25, 10);
    ctx.closePath();
  }, '#0b1220', false);
  for (const x of [7, 13, 28]) shape(() => ctx.arc(x, 17, 2.6, 0, Math.PI * 2), '#0b1220');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/** Decoded route lines are cached: other players' trucks are re-positioned every few seconds. */
type Line = { line: LatLon[]; cum: number[] };
const lineCache = new Map<string, Line>();
function cachedLine(key: string, geometry: string | null, from: LatLon, to: LatLon): Line {
  let hit = lineCache.get(key);
  if (!hit) {
    const line = geometry ? (polyline.decode(geometry, 6) as LatLon[]) : greatCircle(from, to);
    hit = { line, cum: cumulativeKm(line) };
    lineCache.set(key, hit);
  }
  return hit;
}

function truckPoint(t: WorldTruck, routes: WorldSnapshot['routes'], now: number): { point: LatLon; moving: boolean; west: boolean } {
  if (!t.delivery) return { point: t.position, moving: false, west: false };
  const s = stateAt(t.delivery.schedule, now);
  if (s.done) return { point: t.delivery.loaded.to, moving: false, west: false };
  const leg = s.leg === 'empty' && t.delivery.empty ? t.delivery.empty : t.delivery.loaded;
  const { line, cum } = cachedLine(`${leg.routeId}:${routes[leg.routeId]?.length ?? 0}`, routes[leg.routeId] ?? null, leg.from, leg.to);
  const f = leg.km > 0 ? s.km / leg.km : 0;
  return { point: pointAlong(line, f, cum), moving: !!s.segment && isMoving(s.segment.kind) && s.segment.toKm > s.segment.fromKm, west: headingWest(line, f, cum) };
}

/** Which other players' trucks are drawn with the old switch (before the „Слоеве“ panel of 1.2.3.6). */
type PlayersMode = 'all' | 'circle' | 'none';
const RELATION_COLOR = { friend: '#ff6bcb', company: '#a66bff' } as const;
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const collection = (features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

/**
 * Other players' trucks in two sources: friends and the company (never grouped) and everyone
 * else, grouped into numbered bubbles from far away and capped to the CROWD_CAP nearest to the
 * view. The truck in focus is always drawn, with the rest of its current leg.
 */
function playerFeatures(world: WorldSnapshot, ownIds: Set<string>, now: number, layers: MapLayers, center: LatLon | null, focus: string | null) {
  const circle: GeoJSON.Feature[] = [];
  const crowd: { f: GeoJSON.Feature; p: LatLon; keep: boolean }[] = [];
  const line: GeoJSON.Feature[] = [];
  for (const t of world.trucks) {
    if (ownIds.has(t.id)) continue;
    const focused = t.id === focus;
    const shown = t.relation === 'friend' ? layers.friends : t.relation === 'company' ? layers.company : layers.others;
    if (!shown && !focused) continue;
    const { point, moving, west } = truckPoint(t, world.routes, now);
    if (layers.movingOnly && !moving && !focused) continue;
    const label = t.tag ? `[${t.tag}] ${t.player}` : t.player;
    const fill = t.color && HEX.test(t.color) ? t.color : '#e8eef7';
    const ring = t.vip ? '#d4af37' : t.online ? '#34d399' : '#ef4444';
    const f: GeoJSON.Feature = { type: 'Feature', properties: { id: t.id, label, rel: t.relation ?? '', icon: truckIcon(fill, ring, t.vip, west), fill, ring, moving, focus: focused }, geometry: { type: 'Point', coordinates: toLngLat(point) } };
    if (t.relation) circle.push(f);
    else crowd.push({ f, p: point, keep: focused });
    if (focused && t.delivery) {
      const s = stateAt(t.delivery.schedule, now);
      const leg = s.leg === 'empty' && t.delivery.empty ? t.delivery.empty : t.delivery.loaded;
      const hit = cachedLine(`${leg.routeId}:${world.routes[leg.routeId]?.length ?? 0}`, world.routes[leg.routeId] ?? null, leg.from, leg.to);
      line.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: hit.line.map(toLngLat) } });
    }
  }
  const kept = nearestFirst(crowd, center, CROWD_CAP, (c) => c.p, (c) => c.keep);
  return { circle: collection(circle), crowd: collection(kept.map((c) => c.f)), focusLine: collection(line), hidden: crowd.length - kept.length };
}

/** "→ Виена · 1 ч 20 мин" or "в София". */
function truckStatus(t: WorldTruck, now: number): string {
  if (!t.delivery) return tr('в {0}', t.city);
  const left = Math.max(0, Math.round((scheduleEnd(t.delivery.schedule) - now) / 60_000));
  return left > 0 ? `→ ${t.delivery.destination} · ${duration(left)}` : tr('пристига в {0}', t.delivery.destination);
}

function routeFeatures(vehicles: MapVehicle[], preview: MapProps['preview']): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const v of vehicles) {
    if (!v.delivery) continue;
    if (v.delivery.empty) features.push({ type: 'Feature', properties: { kind: 'empty', vid: v.id }, geometry: { type: 'LineString', coordinates: legLine(v.delivery.empty).map(toLngLat) } });
    features.push({ type: 'Feature', properties: { kind: 'loaded', vid: v.id }, geometry: { type: 'LineString', coordinates: legLine(v.delivery.loaded).map(toLngLat) } });
  }
  if (preview) features.push({ type: 'Feature', properties: { kind: preview.approximate ? 'approx' : 'preview' }, geometry: { type: 'LineString', coordinates: legLine(preview.leg).map(toLngLat) } });
  return { type: 'FeatureCollection', features };
}

function depotFeatures(depots: MapProps['depots']): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: depots.map((d) => ({ type: 'Feature', properties: { name: d.name }, geometry: { type: 'Point', coordinates: toLngLat(d.position) } })) };
}

export function WorldMap({ styleUrl, center, vehicles, depots, preview, ownVip = false, stork = null, bases = [], reports = [], compact = false, weather, layers }: MapProps) {
  const compactAtStart = useRef(compact);
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [ready, setReady] = useState(false);
  const [city, setCity] = useState<CityDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [world, setWorld] = useState<WorldSnapshot | null>(null);
  const [mode, setMode] = useState<PlayersMode>('all');
  // 1.2.3.6 „Чиста карта“: layers kept in the profile, a truck in focus, the panel.
  const layersLive = useFeature('map_layers');
  const [chosen, setChosen] = useState<MapLayers>(() => resolveLayers(layers));
  const shown = useMemo<MapLayers>(() => (layersLive ? chosen : { ...DEFAULT_MAP_LAYERS, others: mode === 'all', friends: mode !== 'none', company: mode !== 'none' }), [layersLive, chosen, mode]);
  const [layersOpen, setLayersOpen] = useState(false);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(0);
  const layerLabels: [MapLayerKey, string][] = [
    ['mine', tr('Моите камиони')],
    ['company', tr('Компанията')],
    ['friends', tr('Приятели')],
    ['others', tr('Другите играчи')],
    ['movingOnly', tr('Само камиони в движение')],
    ['plates', tr('Имена и номера')],
    ['depots', tr('Депа')],
    ['routes', tr('Маршрути')],
    ['weather', tr('Сняг и лед')],
  ];
  const toggleLayer = (k: MapLayerKey) => {
    const next = { ...chosen, [k]: !chosen[k] };
    setChosen(next);
    void api('/api/game/action', { type: 'uiPrefs', mapLayers: { [k]: next[k] } }).catch(() => undefined);
  };
  // The list starts folded on phones, where it would cover the map.
  const [circleOpen, setCircleOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  const [clock, setClock] = useState(0);
  // v2.0: the day and night at the map's centre, and the 3D view.
  const mapLook = useFeature('map_3d');
  // 1.1.4.3: own trucks glide (several updates a second) and their halo breathes.
  const fx = useFeature('game_fx');
  const [shade, setShade] = useState(0);
  const [tilted, setTilted] = useState(false);
  // 1.2.8 „Жива картина“: relief, sky and weather in 3D, and a camera that follows a truck.
  const live = useFeature('map_live');
  const [followId, setFollowId] = useState<string | null>(null);
  const snowy = Object.keys(weather ?? {});
  const circleLive = useFeature('map_circle');
  const roadsideLive = useFeature('roadside');
  // The picked truck by id, so its card follows fresh data (e.g. after help on the road).
  const [pickedId, setPickedId] = useState<string | null>(null);
  const picked = (pickedId && world?.trucks.find((t) => t.id === pickedId)) || null;
  const worldRef = useRef<WorldSnapshot | null>(null);
  // Latest props for the one-time initialisation (data updates are applied by effects below).
  const initial = useRef({ center, preview });

  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({
      container: container.current,
      style: styleUrl,
      center: toLngLat(initial.current.center),
      zoom: 5.4,
      attributionControl: { compact: true, customAttribution: tr('Градове: GeoNames · Маршрути: Valhalla / OSM') },
    });
    mapRef.current = map;
    const updateShade = () => {
      const c = map.getCenter();
      setShade(nightShade(sunAltitude(new Date(), c.lat, c.lng)));
    };
    map.on('moveend', updateShade);
    updateShade();
    const shadeTimer = setInterval(updateShade, 60_000);
    map.on('remove', () => clearInterval(shadeTimer));
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('styleimagemissing', (e) => {
      const [kind, fill, ring, flag, side] = e.id.split('|');
      if (kind !== 'truck' || !fill || !ring || !HEX.test(fill) || !HEX.test(ring) || map.hasImage(e.id)) return;
      const image = drawTruck(fill, ring, flag === 'v', side === 'w');
      if (image) map.addImage(e.id, image, { pixelRatio: 2 });
    });
    map.on('error', (e) => {
      if (e.error?.message?.includes('could not be loaded')) return; // missing sprite icons are harmless
      setError(e.error?.message ?? tr('Грешка при зареждане на картата'));
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
      // 1.2.2: on the compact map the sources stay one tap away (ⓘ) instead of covering it.
      if (compactAtStart.current) container.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
      map.addSource('cities', { type: 'geojson', data: empty });
      // 1.2.8: snow and ice around the cities of the countries that have them today (soft white patches).
      map.addLayer({ id: 'weather-snow', type: 'circle', source: 'cities', filter: ['in', ['get', 'country'], ['literal', []]], paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 16, 7, 40, 10, 90],
        'circle-color': '#e8f2ff',
        'circle-blur': 1,
        'circle-opacity': 0.22,
      } });
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
      map.addLayer({ id: 'vehicles', type: 'symbol', source: 'vehicles', layout: { 'icon-image': ['get', 'icon'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.9, 9, 1.25], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
      map.addLayer({ id: 'vehicles-label', type: 'symbol', source: 'vehicles', layout: { 'text-field': ['get', 'plate'], 'text-size': 11, 'text-offset': [0, -1.9], 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#22d3ee', 'text-halo-color': '#05070b', 'text-halo-width': 1.5 } });

      map.addSource('players', { type: 'geojson', data: empty });
      // Friends and company members: a coloured halo and a name visible from far away.
      map.addLayer({ id: 'players-circle', type: 'circle', source: 'players', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 14, 9, 19],
        'circle-color': ['match', ['get', 'rel'], 'friend', RELATION_COLOR.friend, RELATION_COLOR.company],
        'circle-opacity': 0.35,
        'circle-stroke-color': ['match', ['get', 'rel'], 'friend', RELATION_COLOR.friend, RELATION_COLOR.company],
        'circle-stroke-width': 2.5,
      } }, 'vehicles-halo');
      map.addLayer({ id: 'players', type: 'symbol', source: 'players', layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.75, 9, 1.05],
        'icon-allow-overlap': true,
      }, paint: { 'icon-opacity': ['case', ['get', 'moving'], 1, 0.75] } }, 'vehicles-halo');
      map.addLayer({ id: 'players-circle-label', type: 'symbol', source: 'players', layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, -1.7], 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true }, paint: { 'text-color': ['match', ['get', 'rel'], 'friend', RELATION_COLOR.friend, RELATION_COLOR.company], 'text-halo-color': '#05070b', 'text-halo-width': 1.5 } }, 'vehicles-halo');

      // 1.2.3.6: everyone else — numbered bubbles from far away, small dots, then icons and names up close.
      map.addSource('crowd', { type: 'geojson', data: empty, cluster: true, clusterRadius: 46, clusterMaxZoom: 7 });
      const single: maplibregl.FilterSpecification = ['!', ['has', 'point_count']];
      map.addLayer({ id: 'crowd-cluster', type: 'circle', source: 'crowd', filter: ['has', 'point_count'], paint: {
        'circle-radius': ['step', ['get', 'point_count'], 12, 10, 15, 30, 19, 100, 24],
        'circle-color': '#1b2638',
        'circle-opacity': 0.88,
        'circle-stroke-color': '#8d9bb3',
        'circle-stroke-width': 1.5,
      } }, 'players-circle');
      map.addLayer({ id: 'crowd-count', type: 'symbol', source: 'crowd', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 11.5, 'text-font': ['Noto Sans Regular'], 'text-allow-overlap': true }, paint: { 'text-color': '#e8eef7' } }, 'players-circle');
      map.addLayer({ id: 'crowd-dot', type: 'circle', source: 'crowd', maxzoom: 6.5, filter: single, paint: {
        'circle-radius': 3.5,
        'circle-color': ['get', 'fill'],
        'circle-stroke-color': ['get', 'ring'],
        'circle-stroke-width': 1.6,
        'circle-opacity': ['case', ['get', 'moving'], 0.95, 0.6],
      } }, 'players-circle');
      map.addLayer({ id: 'crowd-icon', type: 'symbol', source: 'crowd', minzoom: 6.5, filter: single, layout: {
        'icon-image': ['get', 'icon'],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 6.5, 0.75, 9, 1.05],
        'icon-allow-overlap': true,
      }, paint: { 'icon-opacity': ['case', ['get', 'moving'], 1, 0.75] } }, 'players-circle');
      map.addLayer({ id: 'crowd-label', type: 'symbol', source: 'crowd', minzoom: 8, filter: single, layout: { 'text-field': ['get', 'label'], 'text-size': 10.5, 'text-offset': [0, -1.5], 'text-font': ['Noto Sans Regular'], 'text-optional': true }, paint: { 'text-color': '#e8eef7', 'text-halo-color': '#05070b', 'text-halo-width': 1.4 } }, 'players-circle');
      // The rest of the current leg of the truck in focus.
      map.addSource('focus-route', { type: 'geojson', data: empty });
      map.addLayer({ id: 'focus-route', type: 'line', source: 'focus-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#f6c343', 'line-width': 3.5, 'line-opacity': 0.9, 'line-dasharray': [2, 1.5] } }, 'crowd-cluster');

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
    for (const layer of ['players', 'crowd-icon', 'crowd-dot', 'crowd-cluster']) {
      map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
    }
    for (const layer of ['players', 'crowd-icon', 'crowd-dot']) {
      map.on('click', layer, (e) => {
        const id = e.features?.[0]?.properties?.id;
        const truck = worldRef.current?.trucks.find((t) => t.id === id);
        if (truck) {
          setCity(null);
          setPickedId(truck.id);
        }
      });
    }
    // A numbered bubble opens up: the map zooms in until its trucks come apart.
    map.on('click', 'crowd-cluster', async (e) => {
      const f = e.features?.[0];
      const id = f?.properties?.cluster_id;
      if (id === undefined || f?.geometry.type !== 'Point') return;
      const zoom = await (map.getSource('crowd') as GeoJSONSource).getClusterExpansionZoom(id);
      map.easeTo({ center: f.geometry.coordinates as [number, number], zoom: zoom + 0.3, duration: 600 });
    });
    map.on('mouseenter', 'cities-dot', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'cities-dot', () => (map.getCanvas().style.cursor = ''));
    map.on('click', 'cities-dot', async (e) => {
      const id = e.features?.[0]?.properties?.id;
      if (!id) return;
      const res = await fetch(`/api/geo/city/${id}`);
      if (res.ok) {
        setPickedId(null);
        setCity((await res.json()) as CityDetails);
      }
    });
    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, [styleUrl]);

  // The stork of the day (Баба Марта): a marker; a click tells the server it was spotted.
  const [storkNote, setStorkNote] = useState<string | null>(null);
  useEffect(() => {
    if (!ready || !stork || !mapRef.current) return;
    const el = document.createElement('button');
    el.type = 'button';
    el.setAttribute('aria-label', tr('Щъркел'));
    el.style.cssText = 'background:none;border:0;cursor:pointer;padding:0;filter:drop-shadow(0 2px 3px rgba(0,0,0,.6))';
    // A white stork with black wing tips, red beak and legs (original drawing).
    el.innerHTML = '<svg width="38" height="38" viewBox="0 0 40 40"><path d="M8 22 Q14 14 24 16 L30 13 L34 14 L30 17 Q28 24 20 25 Z" fill="#fff" stroke="#0b1220" stroke-width="1"/><path d="M10 21 Q14 18 20 20 L16 24 Z" fill="#111827"/><path d="M33 14 L39 16 L33 15.5 Z" fill="#dc2626"/><circle cx="31" cy="14" r="0.9" fill="#0b1220"/><path d="M18 25 L17 36 M21 25 L22 36" stroke="#dc2626" stroke-width="1.4"/></svg>';
    el.onclick = async () => {
      try {
        const data = await api<{ coins: number; city: string }>('/api/game/action', { type: 'spotStork' });
        setStorkNote(tr('Видя щъркела над {0}! +{1} TC 🔴⚪', data.city, data.coins));
      } catch (e) {
        setStorkNote((e as Error).message);
      }
    };
    const marker = new maplibregl.Marker({ element: el }).setLngLat(toLngLat(stork.position)).addTo(mapRef.current);
    return () => {
      marker.remove();
    };
  }, [ready, stork]);

  // The company's base and its allies' bases (v1.5): a flag in the company colour.
  useEffect(() => {
    if (!ready || !bases.length || !mapRef.current) return;
    const markers = bases.map((b) => {
      const el = document.createElement('div');
      el.title = `${b.own ? tr('Базата на компанията') : tr('Съюзна база')}: ${b.name} · ${b.city}`;
      el.setAttribute('aria-label', el.title);
      el.style.cssText = 'filter:drop-shadow(0 2px 3px rgba(0,0,0,.6));pointer-events:auto';
      const c = /^#[0-9a-f]{6}$/i.test(b.color ?? '') ? b.color! : b.own ? '#22d3ee' : '#a78bfa';
      el.innerHTML = `<svg width="26" height="30" viewBox="0 0 26 30"><path d="M5 28 V3" stroke="#e5e7eb" stroke-width="2"/><path d="M6 4 H22 L18 9 L22 14 H6 Z" fill="${c}" stroke="#0b1220" stroke-width="1"/>${b.own ? '<circle cx="5" cy="28" r="2.5" fill="#f6c343"/>' : ''}</svg>`;
      return new maplibregl.Marker({ element: el, anchor: 'bottom-left' }).setLngLat(toLngLat(b.position)).addTo(mapRef.current!);
    });
    return () => {
      for (const m of markers) m.remove();
    };
  }, [ready, bases]);

  // Road reports (v1.8): an emoji sign where a driver saw it.
  useEffect(() => {
    if (!ready || !reports.length || !mapRef.current) return;
    const markers = reports.map((r) => {
      const el = document.createElement('a');
      el.href = '/game/road';
      el.title = tr('{0} край {1} (сигнал от шофьор)', r.label, r.near);
      el.setAttribute('aria-label', el.title);
      el.textContent = r.emoji;
      el.style.cssText = 'font-size:20px;line-height:1;padding:3px;border-radius:9999px;background:rgba(11,18,32,.85);border:1px solid #f59e0b;pointer-events:auto;text-decoration:none';
      return new maplibregl.Marker({ element: el }).setLngLat(toLngLat(r.position)).addTo(mapRef.current!);
    });
    return () => {
      for (const m of markers) m.remove();
    };
  }, [ready, reports]);

  // Data layers follow server refreshes without recreating the map.
  useEffect(() => {
    if (!ready) return;
    (mapRef.current?.getSource('routes') as GeoJSONSource | undefined)?.setData(routeFeatures(vehicles, preview));
    (mapRef.current?.getSource('depots') as GeoJSONSource | undefined)?.setData(depotFeatures(depots));
  }, [ready, vehicles, depots, preview]);

  // Other players: loaded from the server when something changes in the world (live event),
  // with a slow safety refresh; positions are animated locally from their schedules.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const res = await fetch('/api/world');
      if (!res.ok || cancelled) return;
      const data = (await res.json()) as WorldSnapshot;
      worldRef.current = data;
      setWorld(data);
    };
    const soon = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 1500);
    };
    void load();
    window.addEventListener('tv:world', soon);
    const interval = setInterval(() => void load(), 45_000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('tv:world', soon);
    };
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const ownIds = new Set(vehicles.map((v) => v.id));
    const tick = () => {
      const map = mapRef.current;
      const now = Date.now();
      const c = map?.getCenter();
      const data = world ? playerFeatures(world, ownIds, now, shown, c ? [c.lat, c.lng] : null, focusId) : null;
      (map?.getSource('players') as GeoJSONSource | undefined)?.setData(data?.circle ?? EMPTY);
      (map?.getSource('crowd') as GeoJSONSource | undefined)?.setData(data?.crowd ?? EMPTY);
      (map?.getSource('focus-route') as GeoJSONSource | undefined)?.setData(data?.focusLine ?? EMPTY);
      setHidden(data?.hidden ?? 0);
      setClock(now);
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, [ready, world, shown, vehicles, focusId]);

  // 1.2.3.6: the chosen layers, and the focus (one truck and its route; the rest fades).
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer('crowd-icon')) return;
    const vis = (ids: string[], on: boolean) => {
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
    };
    const f = focusId;
    vis(['vehicles-halo', 'vehicles'], shown.mine || !!f);
    vis(['vehicles-label'], (shown.mine || !!f) && shown.plates);
    vis(['players-circle-label', 'crowd-label'], shown.plates);
    vis(['depots'], shown.depots && !f);
    vis(['routes-glow', 'routes-line'], shown.routes || !!f);
    vis(['weather-snow'], shown.weather);
    const own: maplibregl.FilterSpecification | null = shown.movingOnly ? ['get', 'moving'] : null;
    map.setFilter('vehicles', own);
    map.setFilter('vehicles-label', own);
    map.setFilter('vehicles-halo', f ? ['==', ['get', 'id'], f] : own);
    const mine = (on: number, off: number): maplibregl.DataDrivenPropertyValueSpecification<number> => (f ? ['case', ['==', ['get', 'id'], f], on, off] : on);
    map.setPaintProperty('vehicles', 'icon-opacity', mine(1, 0.15));
    map.setPaintProperty('vehicles-label', 'text-opacity', mine(1, 0.15));
    map.setFilter('routes-glow', f ? ['==', ['get', 'vid'], f] : null);
    map.setFilter('routes-line', f ? ['==', ['get', 'vid'], f] : null);
    const fade = (on: number, off: number): maplibregl.DataDrivenPropertyValueSpecification<number> => (f ? ['case', ['get', 'focus'], on, off] : on);
    map.setPaintProperty('players', 'icon-opacity', f ? fade(1, 0.12) : ['case', ['get', 'moving'], 1, 0.75]);
    map.setPaintProperty('crowd-icon', 'icon-opacity', f ? fade(1, 0.12) : ['case', ['get', 'moving'], 1, 0.75]);
    map.setPaintProperty('crowd-dot', 'circle-opacity', f ? fade(1, 0.1) : ['case', ['get', 'moving'], 0.95, 0.6]);
    map.setPaintProperty('crowd-dot', 'circle-stroke-opacity', fade(1, 0.1));
    map.setPaintProperty('players-circle', 'circle-opacity', fade(0.35, 0.04));
    map.setPaintProperty('players-circle', 'circle-stroke-opacity', fade(1, 0.12));
    map.setPaintProperty('players-circle-label', 'text-opacity', fade(1, 0.15));
    map.setPaintProperty('crowd-label', 'text-opacity', fade(1, 0.15));
    map.setPaintProperty('crowd-cluster', 'circle-opacity', f ? 0.12 : 0.88);
    map.setPaintProperty('crowd-cluster', 'circle-stroke-opacity', f ? 0.15 : 1);
    map.setPaintProperty('crowd-count', 'text-opacity', f ? 0.15 : 1);
  }, [ready, shown, focusId]);

  /** Puts one truck (own or another player's) in focus and flies to it; the same truck again ends the focus. */
  const focusOn = (id: string | null, point?: LatLon) => {
    setFocusId((cur) => (cur === id ? null : id));
    if (id && point && focusId !== id) mapRef.current?.flyTo({ center: toLngLat(point), zoom: Math.max(mapRef.current.getZoom(), 7.6), duration: 900 });
  };

  /** Centres the map on a friend's truck and opens its card. */
  const follow = (t: WorldTruck) => {
    const { point } = truckPoint(t, worldRef.current?.routes ?? {}, clock);
    mapRef.current?.flyTo({ center: toLngLat(point), zoom: Math.max(mapRef.current.getZoom(), 7.5), duration: 900 });
    setCity(null);
    setPickedId(t.id);
    if (window.innerWidth < 640) setCircleOpen(false);
  };
  const circle = (world?.trucks ?? [])
    .filter((t) => t.relation)
    .sort((a, b) => Number(!!b.delivery) - Number(!!a.delivery) || Number(b.online) - Number(a.online) || a.player.localeCompare(b.player));

  // Animate vehicle positions from their schedules.
  useEffect(() => {
    if (!ready) return;
    const tick = () => {
      const src = mapRef.current?.getSource('vehicles') as GeoJSONSource | undefined;
      const now = Date.now();
      src?.setData({
        type: 'FeatureCollection',
        features: vehicles.map((v) => {
          const { point, west } = vehiclePoint(v, now);
          return { type: 'Feature', properties: { id: v.id, plate: v.plate, moving: !!v.delivery && now < scheduleEnd(v.delivery.schedule), icon: truckIcon(HEX.test(v.color) ? v.color : '#f8fafc', '#22d3ee', ownVip, west) }, geometry: { type: 'Point', coordinates: toLngLat(point) } };
        }),
      });
      if (smooth && mapRef.current?.getLayer('vehicles-halo')) {
        const k = (Math.sin(now / 450) + 1) / 2;
        mapRef.current.setPaintProperty('vehicles-halo', 'circle-radius', 11 + k * 6);
        mapRef.current.setPaintProperty('vehicles-halo', 'circle-opacity', 0.32 - k * 0.2);
      }
    };
    const smooth = fx && motionEnabled();
    tick();
    const id = setInterval(tick, smooth ? 200 : 2000);
    return () => clearInterval(id);
  }, [ready, vehicles, ownVip, fx]);

  // 1.2.8: the snowy countries of today on the map.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map?.getLayer('weather-snow')) return;
    map.setFilter('weather-snow', ['in', ['get', 'country'], ['literal', live ? snowy : []]]);
  }, [ready, live, snowy.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  // 1.2.8: the camera follows one of the player's moving trucks until the map is dragged.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !followId) return;
    const v = vehicles.find((x) => x.id === followId);
    if (!v) return;
    const stop = () => setFollowId(null);
    map.on('dragstart', stop);
    const step = () => map.easeTo({ center: toLngLat(vehiclePoint(v, Date.now()).point), duration: 900, easing: (k) => k });
    map.flyTo({ center: toLngLat(vehiclePoint(v, Date.now()).point), zoom: Math.max(map.getZoom(), 8.5), pitch: tilted ? 60 : map.getPitch(), duration: 1500 });
    // The steps start once the flight has landed (an ease would cut the zoom short).
    let id: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => (id = setInterval(step, 1000)), 1600);
    return () => {
      clearTimeout(start);
      clearInterval(id);
      map.off('dragstart', stop);
    };
  }, [ready, followId, vehicles, tilted]);
  const moving = vehicles.filter((v) => v.delivery && clock < scheduleEnd(v.delivery.schedule));
  const followNext = () => {
    if (!moving.length) return;
    const i = moving.findIndex((v) => v.id === followId);
    const next = i >= 0 && i === moving.length - 1 ? null : moving[(i + 1) % moving.length]!.id;
    setFollowId(next);
    // 1.2.3.6: following one of the player's trucks puts it in focus as well.
    if (layersLive) setFocusId(next);
  };

  /** Tilts the map and raises the buildings (where the style has them), or back to flat. */
  const toggle3d = () => {
    const map = mapRef.current;
    if (!map) return;
    const next = !tilted;
    setTilted(next);
    map.easeTo({ pitch: next ? 55 : 0, bearing: next ? -15 : 0, duration: 800 });
    // 1.2.8: real relief (the mountains rise), shaded slopes and a sky by the time of day.
    if (live) {
      try {
        if (next) {
          if (!map.getSource('dem')) map.addSource('dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12, attribution: tr('Релеф: AWS Terrain Tiles') });
          if (!map.getSource('dem-shade')) map.addSource('dem-shade', { type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12 });
          if (!map.getLayer('hillshade')) map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem-shade', paint: { 'hillshade-shadow-color': '#0b1220', 'hillshade-highlight-color': '#cfe3ff', 'hillshade-exaggeration': 0.45 } }, map.getLayer('weather-snow') ? 'weather-snow' : 'cities-dot');
          map.setTerrain({ source: 'dem', exaggeration: 1.6 });
          map.setSky(shade > 0.5
            ? { 'sky-color': '#0a1530', 'horizon-color': '#1d2c52', 'fog-color': '#0b1220', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.7 }
            : { 'sky-color': '#5d9de6', 'horizon-color': '#cfe3ff', 'fog-color': '#dbe8f7', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.6 });
        } else {
          map.setTerrain(null);
          if (map.getLayer('hillshade')) map.removeLayer('hillshade');
        }
      } catch {
        // No WebGL2 / terrain: the tilt alone.
      }
    }
    try {
      const source = Object.entries(map.getStyle().sources ?? {}).find(([, src]) => src.type === 'vector')?.[0];
      if (next && source && !map.getLayer('buildings-3d')) {
        map.addLayer({ id: 'buildings-3d', type: 'fill-extrusion', source, 'source-layer': 'building', minzoom: 13, paint: { 'fill-extrusion-color': '#8b95a7', 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 8], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 0.75 } }, 'cities-dot');
      } else if (!next && map.getLayer('buildings-3d')) {
        map.removeLayer('buildings-3d');
      }
    } catch {
      // A style without buildings: the tilt alone.
    }
  };

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-asphalt-700 ${compact ? 'h-[260px] sm:h-[340px]' : 'h-[calc(100dvh-210px)] min-h-[420px]'}`}>
      <div ref={container} className="h-full w-full" />
      {mapLook && shade > 0 && <div aria-hidden className="pointer-events-none absolute inset-0 transition-colors duration-1000" style={{ background: `rgba(4, 8, 28, ${0.45 * shade})` }} />}
      {mapLook && (
        <button type="button" onClick={() => toggle3d()} className="absolute right-12 top-2.5 rounded-lg bg-asphalt-950/85 px-2.5 py-1.5 text-xs font-semibold text-mist-100 backdrop-blur hover:bg-asphalt-900" aria-pressed={tilted}>
          {tilted ? '2D' : '3D'} {shade > 0.5 ? '🌙' : '☀️'}
        </button>
      )}
      {live && tilted && snowy.length > 0 && shown.weather && <SnowFall />}
      {live && moving.length > 0 && (
        <button type="button" onClick={followNext} className={`absolute right-12 top-11 rounded-lg px-2.5 py-1.5 text-xs font-semibold backdrop-blur ${followId ? 'bg-cyan-glow text-asphalt-950' : 'bg-asphalt-950/85 text-mist-100 hover:bg-asphalt-900'}`} aria-pressed={!!followId} data-testid="map-follow">
          🎥 {followId ? tr('Следиш {0}', vehicles.find((v) => v.id === followId)?.plate ?? '') : tr('Следи камион')}
        </button>
      )}
      {error && <div className="absolute left-3 top-3 rounded-lg bg-loss/90 px-3 py-2 text-sm text-white">{error}</div>}
      {storkNote && <button type="button" onClick={() => setStorkNote(null)} className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-lg bg-asphalt-900/95 px-3 py-2 text-sm text-white shadow-lg">{storkNote}</button>}
      {/* 1.2.2: the compact map on top of „Курсове“ stays clean — the legend and the panels are on the big map. */}
      <div className={`absolute bottom-3 left-3 flex-wrap gap-3 rounded-xl bg-asphalt-950/85 px-3 py-2 text-[11px] text-mist-300 backdrop-blur ${compact ? 'hidden' : 'flex'}`}>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gold-400" />{tr('Град с товарен пазар (число = поръчки)')}</span>
        <span className="flex items-center gap-1.5"><TruckGlyph ring="#22d3ee" fill="#f8fafc" />{tr('Твоите камиони')}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-cyan-glow" />{tr('С товар')}</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dotted border-mist-400" />{tr('Празен курс')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border-2 border-prestige" />{tr('Депо')}</span>
        <span className="flex items-center gap-1.5">
          <TruckGlyph ring="#ef4444" />
          {tr('Други играчи{0}', world ? tr(' ({0}, {1} в играта)', world.players, world.online) : '')}
        </span>
        <span className="flex items-center gap-1.5"><span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-mist-400 bg-asphalt-800 px-0.5 text-[9px] text-white">12</span>{tr('Група камиони (натисни, за да я разтвориш)')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: RELATION_COLOR.friend, background: `${RELATION_COLOR.friend}55` }} />{tr('Приятели')}</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full border" style={{ borderColor: RELATION_COLOR.company, background: `${RELATION_COLOR.company}55` }} />{tr('Компанията')}</span>
        <span className="flex items-center gap-1.5">
          <TruckGlyph ring="#34d399" />{tr('в играта сега')}
        </span>
        <span className="flex items-center gap-1.5">
          <TruckGlyph ring="#d4af37" />VIP
        </span>
      </div>
      <div className={`absolute left-3 top-3 max-h-[calc(100%-120px)] w-[min(280px,calc(100%-70px))] flex-col gap-2 ${compact ? 'hidden' : 'flex'}`}>
        {layersLive && (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setLayersOpen((v) => !v)} aria-expanded={layersOpen} data-testid="map-layers" className={`rounded-full border px-3 py-1 text-[11px] font-semibold backdrop-blur ${layersOpen ? 'border-volt-500 bg-volt-500 text-white' : 'border-asphalt-700 bg-asphalt-950/85 text-mist-100 hover:bg-asphalt-900'}`}>
                🗂️ {tr('Слоеве')}
              </button>
              {focusId && (
                <button type="button" onClick={() => setFocusId(null)} data-testid="map-focus-off" className="rounded-full border border-gold-400 bg-asphalt-950/85 px-3 py-1 text-[11px] font-semibold text-gold-400 backdrop-blur">
                  🎯 {tr('Фокус')} ✕
                </button>
              )}
            </div>
            {layersOpen && (
              <fieldset className="grid max-h-[50vh] gap-0.5 overflow-y-auto rounded-2xl border border-asphalt-700 bg-asphalt-950/95 p-2 text-[12px] backdrop-blur" data-testid="map-layers-panel">
                <legend className="sr-only">{tr('Слоеве')}</legend>
                {layerLabels.map(([k, label]) => (
                  <label key={k} className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-asphalt-800">
                    <input type="checkbox" checked={chosen[k]} onChange={() => toggleLayer(k)} className="h-4 w-4 accent-volt-500" />
                    {label}
                  </label>
                ))}
                <p className="px-1.5 pt-1 text-[10px] text-mist-400">{hidden > 0 ? tr('Показани са най-близките {0} чужди камиона. Приближи картата, за да видиш другите.', CROWD_CAP) : tr('Изборът се пази в профила ти и важи и на телефона.')}</p>
              </fieldset>
            )}
          </div>
        )}
        {circleLive && !layersLive && <div role="radiogroup" aria-label={tr('Кои играчи да се виждат')} className="flex rounded-full border border-asphalt-700 bg-asphalt-950/85 p-0.5 text-[11px] backdrop-blur">
          {([['all', tr('Всички')], ['circle', tr('Моите хора')], ['none', tr('Само аз')]] as const).map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={mode === id} title={id === 'circle' ? tr('Приятели и компания') : undefined} onClick={() => setMode(id)} className={`flex-1 whitespace-nowrap rounded-full px-2 py-1 transition ${mode === id ? 'bg-volt-500 text-white' : 'text-mist-300 hover:text-white'}`}>{label}</button>
          ))}
        </div>}
        {world && (shown.friends || shown.company) && circleLive && (
          <section className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-asphalt-700 bg-asphalt-950/90 text-sm backdrop-blur" aria-label={tr('Заедно на пътя')}>
            <button type="button" onClick={() => setCircleOpen((v) => !v)} aria-expanded={circleOpen} className="flex items-center justify-between gap-2 px-3 py-2 font-semibold">
              <span className="flex items-center gap-2"><Users className="h-4 w-4 text-prestige" />{tr('Заедно на пътя')}</span>
              <span className="num text-xs text-mist-400">{tx(circle.length)} {circleOpen ? '▴' : '▾'}</span>
            </button>
            {circleOpen && (
              circle.length ? (
                <ul className="min-h-0 overflow-y-auto border-t border-asphalt-800 py-1">
                  {circle.map((t) => (
                    <li key={t.id}>
                      <button type="button" onClick={() => follow(t)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-asphalt-800">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: RELATION_COLOR[t.relation!] }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{tx(t.player)}{t.online && <span className="ml-1 text-profit">●</span>}</span>
                          <span className="block truncate text-[11px] text-mist-400">{roadsideLive && t.delivery?.deliveryId && clock && helpableStop(t.delivery.schedule, clock) ? <span className="font-semibold text-amber-sig">{tr('Чака помощ на пътя')}</span> : truckStatus(t, clock || 0)}</span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-asphalt-800 px-3 py-2 text-xs text-mist-400">{tr('Тук ще виждаш камионите на приятелите си и на компанията. Добави приятели от профила им или с търсачката горе.')}</p>
              )
            )}
          </section>
        )}
      </div>
      {picked && <TruckCard truck={picked} now={clock} onClose={() => setPickedId(null)} focused={focusId === picked.id} onFocus={layersLive ? () => focusOn(picked.id, truckPoint(picked, world?.routes ?? {}, clock).point) : undefined} />}
      {city && (
        <aside className="absolute right-3 top-14 w-[min(320px,calc(100%-24px))] rounded-2xl border border-asphalt-600 bg-asphalt-950/95 p-4 text-sm shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="font-display text-lg font-bold">{tx(city.name)}</div>
              <div className="text-xs text-mist-400">{tx(city.nameLatin)} · {tx(city.country)} ({tx(city.countryCode)}){city.region ? ` · ${city.region}` : ''}</div>
            </div>
            <button className="text-mist-400 hover:text-white" onClick={() => setCity(null)} aria-label={tr('Затвори')}>✕</button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div><dt className="text-mist-400">{tr('Население')}</dt><dd className="num">{int(city.population)}</dd></div>
            <div><dt className="text-mist-400">{tr('Координати')}</dt><dd className="num">{city.lat.toFixed(4)}, {city.lon.toFixed(4)}</dd></div>
            <div><dt className="text-mist-400">{tr('Отворени поръчки')}</dt><dd className="num">{tx(city.openContracts)}</dd></div>
            <div><dt className="text-mist-400">{tr('Пристанища')}</dt><dd>{city.ports.length ? city.ports.join(', ') : '—'}</dd></div>
          </dl>
          {city.market.length > 0 && (
            <div className="mt-3">
              <div className="label">{tr('Игрови пазарен профил')}</div>
              <ul className="mt-1.5 space-y-1 text-xs">
                {city.market.map((m) => (
                  <li key={m.cargo} className="flex justify-between gap-2">
                    <span>{tx(m.cargo)}</span>
                    <span className="text-mist-400">{[m.produces && tr('произвежда'), m.consumes && tr('търси ({0}×)', m.demand.toFixed(2))].filter(Boolean).join(' · ')}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[10px] text-mist-400">{tr('Симулирани данни на играта, не реална статистика.')}</p>
            </div>
          )}
        </aside>
      )}
    </div>
  );
}

const SEGMENT_LABEL: Record<string, string> = { drive: 'Кара', break: 'Почивка (45 мин)', rest: 'Дневна почивка', border: 'На границата', loading: 'Товари', unloading: 'Разтоварва', incident: 'Спрял по пътя' };

/** Quick look at another player's truck: lane, load (friends and company), progress, arrival; drive in convoy. */
function TruckCard({ truck: t, now, onClose, focused = false, onFocus }: { truck: WorldTruck; now: number; onClose: () => void; focused?: boolean; onFocus?: () => void }) {
  const d = t.delivery;
  const s = d && now ? stateAt(d.schedule, now) : null;
  const left = d && now ? Math.max(0, Math.round((scheduleEnd(d.schedule) - now) / 60_000)) : 0;
  const roadside = useFeature('roadside');
  const oldConvoy = useFeature('convoy');
  const lobby = useFeature('convoy_lobby');
  const convoy = oldConvoy && !lobby;
  const convoyOpen = !!(convoy && d && t.relation && now && now - new Date(d.startedAt).getTime() < CONVOY_RULES.windowMs && !s?.done);
  return (
    <aside className="absolute right-3 top-14 z-10 w-[min(310px,calc(100%-24px))] rounded-2xl border border-asphalt-600 bg-asphalt-950/95 p-4 text-sm shadow-2xl backdrop-blur" aria-label={tr('Камион на играч')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-lg font-bold"><PlayerName name={t.player} role={t.role} vip={t.vip} /></div>
          <div className="truncate text-xs text-mist-400">{t.company ? `${t.tag ? `[${t.tag}] ` : ''}${t.company}` : tr('Самостоятелен шофьор')}</div>
          {t.relation && <div className="mt-1 text-xs font-semibold" style={{ color: RELATION_COLOR[t.relation] }}>{t.relation === 'friend' ? tr('Приятел') : tr('От твоята компания')}</div>}
        </div>
        <button className="text-mist-400 hover:text-white" onClick={onClose} aria-label={tr('Затвори')}>✕</button>
      </div>
      {d ? (
        <div className="mt-3 space-y-2">
          <div className="font-semibold">{tx(d.origin)} → {tx(d.destination)}</div>
          {d.cargo && <div className="text-xs text-mist-300">{tr('{0} · {1} т', d.cargo.goods, int(Math.round(d.cargo.tons)))}</div>}
          <div className="h-1.5 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-glow to-volt-500" style={{ width: `${Math.round((s?.progress ?? 0) * 100)}%` }} /></div>
          <div className="flex justify-between text-xs text-mist-400">
            <span>{s?.done ? tr('Пристига') : s?.segment ? `${s.leg === 'empty' ? tr('Към товара · ') : ''}${tx(SEGMENT_LABEL[s.segment.kind]) ?? ''}` : ''}</span>
            <span>{left > 0 ? tr('пристига след {0}', duration(left)) : tr('пристига сега')}</span>
          </div>
          {roadside && d.deliveryId && now && helpableStop(d.schedule, now) && (
            <div className="rounded-xl border border-amber-sig/40 bg-amber-sig/10 p-2.5">
              <p className="text-xs text-amber-sig">{tr('Камионът стои: {0}. Ако имаш камион до {1} км, помогни — оставащият престой пада наполовина, а ти получаваш хонорар {2}', helpableStop(d.schedule, now)!.note, ROADSIDE.radiusKm, money(ROADSIDE.feeCents))}</p>
              <ActionButton action={{ type: 'helpOnRoad', deliveryId: d.deliveryId }} onDone={() => window.dispatchEvent(new Event('tv:world'))} className="btn-primary mt-2 w-full justify-center text-xs">{tr('Помогни на пътя')}</ActionButton>
            </div>
          )}
          {convoyOpen && (
            <a href={`/game/contracts?lane=${d.originCityId}-${d.destCityId}`} className="btn-primary mt-1 w-full justify-center text-xs">{tr('Тръгни в конвой · +{0}%', Math.round(CONVOY_RULES.bonusShare * 100))}</a>
          )}
          {convoy && t.relation && !convoyOpen && !s?.done && <p className="text-[11px] text-mist-400">{tr('Конвой може до {0} мин след тръгването.', Math.round(CONVOY_RULES.windowMs / 60_000))}</p>}
        </div>
      ) : (
        <p className="mt-3 text-sm">{tr('Паркиран в {0}', t.city)}</p>
      )}
      <p className={`mt-2 text-xs ${t.online ? 'text-profit' : 'text-mist-400'}`}>{t.online ? tr('● В играта сега') : tr('○ Не е в играта в момента')}</p>
      {onFocus && (
        <button type="button" onClick={onFocus} aria-pressed={focused} data-testid="map-focus" className={`mt-2 w-full rounded-lg border px-2 py-1.5 text-xs font-semibold ${focused ? 'border-gold-400 bg-gold-400 text-asphalt-950' : 'border-asphalt-600 text-mist-100 hover:bg-asphalt-800'}`}>
          🎯 {focused ? tr('Покажи всички камиони') : tr('Фокус: само този камион и маршрутът му')}
        </button>
      )}
    </aside>
  );
}

/** Legend sample of the map truck icon (same shape as drawTruck). */
function TruckGlyph({ ring, fill = '#e8eef7' }: { ring: string; fill?: string }) {
  return (
    <svg width="22" height="14" viewBox="0 0 34 22" aria-hidden="true">
      <g stroke={ring} strokeWidth="2" strokeLinejoin="round">
        <rect x="2" y="3" width="20" height="12" rx="1.5" fill={fill} />
        <path d="M23 15V6h5.5L32 10v5z" fill={fill} />
        {[7, 13, 28].map((x) => <circle key={x} cx={x} cy="17" r="2.6" fill="#0b1220" />)}
      </g>
    </svg>
  );
}


/** 1.2.8: light snow over the 3D map when some countries have snow today (off with reduced motion). */
function SnowFall() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !motionEnabled()) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let frame = 0;
    const flakes = Array.from({ length: 90 }, () => ({ x: Math.random(), y: Math.random(), r: 0.8 + Math.random() * 2.2, v: 0.0008 + Math.random() * 0.0016, d: Math.random() * Math.PI * 2 }));
    const draw = () => {
      const w = (canvas.width = canvas.clientWidth);
      const h = (canvas.height = canvas.clientHeight);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      for (const f of flakes) {
        f.y += f.v;
        f.d += 0.01;
        if (f.y > 1) Object.assign(f, { y: -0.02, x: Math.random() });
        ctx.beginPath();
        ctx.arc((f.x + Math.sin(f.d) * 0.01) * w, f.y * h, f.r, 0, Math.PI * 2);
        ctx.fill();
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />;
}
