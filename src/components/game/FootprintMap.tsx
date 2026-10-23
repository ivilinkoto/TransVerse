'use client';

import polyline from '@mapbox/polyline';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { greatCircle, type LatLon } from '@/lib/geo/geometry';
import type { Footprint } from '@/server/game/footprint';

const toLngLat = (p: LatLon): [number, number] => [p[1], p[0]];

/** "Картата ми" (v1.6): visited cities and the lanes driven with a load (thicker = more trips). */
export function FootprintMap({ styleUrl, center, data }: { styleUrl: string; center: LatLon; data: Pick<Footprint, 'cities' | 'lanes'> }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({ container: container.current, style: styleUrl, center: toLngLat(center), zoom: 4.6, attributionControl: { compact: true, customAttribution: 'Градове: GeoNames · Маршрути: Valhalla / OSM' } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    map.on('load', () => {
      const lanes: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: data.lanes.map((l) => ({
          type: 'Feature',
          properties: { name: l.name, trips: l.trips },
          geometry: { type: 'LineString', coordinates: (l.geometry ? polyline.decode(l.geometry, 6) : greatCircle(l.from, l.to)).map((p) => toLngLat(p as LatLon)) },
        })),
      };
      const points: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: data.cities.map((c) => ({ type: 'Feature', properties: { name: c.name }, geometry: { type: 'Point', coordinates: toLngLat(c.position) } })) };
      map.addSource('lanes', { type: 'geojson', data: lanes });
      map.addLayer({ id: 'lanes', type: 'line', source: 'lanes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#22d3ee', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['get', 'trips'], 1, 2, 10, 6] } });
      map.addSource('visited', { type: 'geojson', data: points });
      map.addLayer({ id: 'visited', type: 'circle', source: 'visited', paint: { 'circle-radius': 5, 'circle-color': '#f6c343', 'circle-stroke-color': '#05070b', 'circle-stroke-width': 1.5 } });
      map.addLayer({ id: 'visited-label', type: 'symbol', source: 'visited', minzoom: 5.5, layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#e8eef7', 'text-halo-color': '#05070b', 'text-halo-width': 1.4 } });
      const all = [...data.cities.map((c) => c.position), ...data.lanes.flatMap((l) => [l.from, l.to])];
      if (all.length > 1) {
        const lons = all.map((p) => p[1]);
        const lats = all.map((p) => p[0]);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 40, maxZoom: 8, duration: 0 });
      }
    });
    return () => {
      observer.disconnect();
      map.remove();
    };
  }, [styleUrl, center, data]);
  return <div ref={container} className="h-[calc(100dvh-320px)] min-h-[380px] w-full overflow-hidden rounded-2xl border border-asphalt-700" />;
}
