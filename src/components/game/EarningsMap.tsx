'use client';

import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import { t } from '@/i18n/t';

export interface EarningsPoint {
  name: string;
  lat: number;
  lon: number;
  cents: number;
  trips: number;
}

/** 1.1.4.2 „Къде печеля“: a circle on each destination city, bigger for more net money. */
export function EarningsMap({ styleUrl, center, points }: { styleUrl: string; center: [number, number]; points: EarningsPoint[] }) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!container.current) return;
    const map = new maplibregl.Map({ container: container.current, style: styleUrl, center: [center[1], center[0]], zoom: 4.6, attributionControl: { compact: true, customAttribution: t('Градове: GeoNames') } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(container.current);
    const max = Math.max(1, ...points.map((p) => Math.abs(p.cents)));
    map.on('load', () => {
      map.addSource('earn', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: points.map((p) => ({ type: 'Feature', properties: { name: p.name, size: Math.sqrt(Math.max(0, p.cents) / max), loss: p.cents < 0 ? 1 : 0 }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] } })) },
      });
      map.addLayer({ id: 'earn', type: 'circle', source: 'earn', paint: { 'circle-radius': ['+', 4, ['*', 22, ['get', 'size']]], 'circle-color': ['case', ['==', ['get', 'loss'], 1], '#f87171', '#34d399'], 'circle-opacity': 0.55, 'circle-stroke-color': '#05070b', 'circle-stroke-width': 1 } });
      map.addLayer({ id: 'earn-label', type: 'symbol', source: 'earn', layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-font': ['Noto Sans Regular'] }, paint: { 'text-color': '#e8eef7', 'text-halo-color': '#05070b', 'text-halo-width': 1.4 } });
      if (points.length > 1) {
        const lons = points.map((p) => p.lon);
        const lats = points.map((p) => p.lat);
        map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: 50, maxZoom: 8, duration: 0 });
      }
    });
    return () => {
      observer.disconnect();
      map.remove();
    };
  }, [styleUrl, center, points]);
  return <div ref={container} className="h-[60dvh] min-h-[340px] w-full overflow-hidden rounded-2xl border border-asphalt-700" />;
}
