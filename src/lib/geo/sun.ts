/**
 * The sun's altitude for a place and a moment (v2.0, the map's day and
 * night), from the usual low-precision solar formulas (about ±1°).
 */
export function sunAltitude(at: Date, lat: number, lon: number): number {
  const rad = Math.PI / 180;
  const days = at.getTime() / 86_400_000 - 10_957.5; // since J2000
  const meanLon = (280.46 + 0.9856474 * days) % 360;
  const anomaly = ((357.528 + 0.9856003 * days) % 360) * rad;
  const eclLon = (meanLon + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * rad;
  const obliquity = (23.439 - 0.0000004 * days) * rad;
  const decl = Math.asin(Math.sin(obliquity) * Math.sin(eclLon));
  const ra = Math.atan2(Math.cos(obliquity) * Math.sin(eclLon), Math.cos(eclLon));
  const gmst = (18.697374558 + 24.06570982441908 * days) % 24;
  const hourAngle = (gmst * 15 + lon) * rad - ra;
  const alt = Math.asin(Math.sin(lat * rad) * Math.sin(decl) + Math.cos(lat * rad) * Math.cos(decl) * Math.cos(hourAngle));
  return alt / rad;
}

/** How dark it is: 0 in daylight, 1 once the sun is 12° below the horizon. */
export const nightShade = (altitude: number) => Math.min(1, Math.max(0, -altitude / 12));
