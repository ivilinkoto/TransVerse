import polyline from '@mapbox/polyline';

interface City {
  id: number;
  nameBg: string;
  lat: number;
  lon: number;
  countryCode: string;
}
interface ShowRoute {
  from: City;
  to: City;
  route: { provider: string; geometry: string | null; distanceKm: number } | null;
}

/**
 * Schematic projection of real routes (equirectangular, latitude-corrected).
 * Road geometry comes from the routing engine; pairs without a cached road
 * route are drawn as dashed straight lines and labelled as approximate.
 */
export function RouteShowcase({ routes }: { routes: ShowRoute[] }) {
  const pts = routes.flatMap((r) => [r.from, r.to]);
  if (!pts.length) return null;
  const pad = 1.2;
  const minLat = Math.min(...pts.map((p) => p.lat)) - pad;
  const maxLat = Math.max(...pts.map((p) => p.lat)) + pad;
  const minLon = Math.min(...pts.map((p) => p.lon)) - pad;
  const maxLon = Math.max(...pts.map((p) => p.lon)) + pad;
  const k = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const S = 60;
  const W = (maxLon - minLon) * k * S;
  const H = (maxLat - minLat) * S;
  const P = (lat: number, lon: number) => [((lon - minLon) * k * S).toFixed(1), ((maxLat - lat) * S).toFixed(1)].join(',');
  const cities = new Map(pts.map((c) => [c.id, c]));

  return (
    <svg viewBox={`0 0 ${W.toFixed(0)} ${H.toFixed(0)}`} className="h-full w-full" role="img" aria-label="Реални маршрути между реални градове">
      <defs>
        <linearGradient id="route-grad" x1="0" x2="1">
          <stop offset="0" stopColor="#22d3ee" />
          <stop offset="1" stopColor="#2f7bff" />
        </linearGradient>
        <pattern id="map-grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M40 0H0V40" fill="none" stroke="#4f93ff" strokeOpacity="0.07" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#map-grid)" />
      {routes.map((r) => {
        const real = r.route?.geometry ? (polyline.decode(r.route.geometry, 6) as [number, number][]) : null;
        const d = real ? `M${real.filter((_, i) => i % 3 === 0 || i === real.length - 1).map(([la, lo]) => P(la, lo)).join('L')}` : `M${P(r.from.lat, r.from.lon)}L${P(r.to.lat, r.to.lon)}`;
        return (
          <g key={`${r.from.id}-${r.to.id}`}>
            <path d={d} fill="none" stroke="#2f7bff" strokeOpacity="0.25" strokeWidth={real ? 9 : 4} strokeLinecap="round" strokeLinejoin="round" />
            <path d={d} fill="none" stroke="url(#route-grad)" strokeWidth={real ? 3 : 2} strokeLinecap="round" strokeLinejoin="round" className={real ? 'route-anim' : undefined} strokeDasharray={real ? undefined : '6 8'} />
          </g>
        );
      })}
      {[...cities.values()].map((c) => {
        const [x, y] = P(c.lat, c.lon).split(',').map(Number) as [number, number];
        return (
          <g key={c.id}>
            <circle cx={x} cy={y} r={9} fill="#05070b" stroke="#f6c343" strokeWidth="3" />
            <circle cx={x} cy={y} r={3} fill="#f6c343" />
            <text x={x + 13} y={y - 10} fontSize="17" fontWeight="600" fill="#e8eef7" stroke="#05070b" strokeWidth="5" paintOrder="stroke" fontFamily="var(--font-onest), sans-serif">
              {c.nameBg}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
