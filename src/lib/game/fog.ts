import { seededRandom } from './road-events';

/**
 * 1.1.4.2 „Ноемврийска мъгла“: in November the river plains and valleys of the
 * region often wake up in fog. A load from or to a foggy area pays more, and
 * five of them make the badge „Пилот в мъглата“. The areas are real plains
 * known for their fog; which of them is foggy on a day is game data.
 */
export const FOG = {
  month: 10, // November (0-based)
  payShare: 0.12,
  /** On a given day each area is foggy with this chance. */
  chance: 0.55,
  missionTrips: 5,
  coins: 25,
  badge: 'fog-pilot',
};

export const FOG_AREAS = [
  { id: 'danube', label: 'Дунавската равнина', lat: [43.3, 44.4], lon: [22.4, 28.2] },
  { id: 'thrace', label: 'Горнотракийската низина', lat: [41.9, 42.5], lon: [24.2, 26.2] },
  { id: 'po', label: 'Паданската низина', lat: [44.5, 45.9], lon: [7.4, 12.6] },
  { id: 'pannonia', label: 'Панонската низина', lat: [45.4, 47.9], lon: [17.4, 22.6] },
  { id: 'wallachia', label: 'Влашката низина', lat: [44.0, 45.2], lon: [23.0, 27.5] },
] as const;

const sofiaDay = (now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(now);
const sofiaMonth = (now: Date) => Number(sofiaDay(now).slice(5, 7)) - 1;

export const isFogSeason = (now: Date) => sofiaMonth(now) === FOG.month;

/** The foggy areas today (none outside November). */
export function foggyAreas(now: Date) {
  if (!isFogSeason(now)) return [];
  const day = sofiaDay(now);
  return FOG_AREAS.filter((a) => seededRandom(`fog:${day}:${a.id}`)() < FOG.chance);
}

/** The foggy area this place is in today, if any. */
export function fogAt(lat: number, lon: number, now: Date) {
  return foggyAreas(now).find((a) => lat >= a.lat[0] && lat <= a.lat[1] && lon >= a.lon[0] && lon <= a.lon[1]) ?? null;
}
