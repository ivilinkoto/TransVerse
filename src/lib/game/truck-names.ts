/** v1.1.1: truck names — a short name the owner gives a vehicle, shown next to the plate. */
export const TRUCK_NAME_MAX = 24;

/** The name as stored: one line, no control characters, single spaces, at most TRUCK_NAME_MAX characters; empty clears it. */
export function cleanTruckName(raw: string): string | null {
  const name = [...raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, TRUCK_NAME_MAX).join('').trim();
  return name || null;
}

/** "Бисер · CA 1234 AB" — the name first when there is one. */
export const truckLabel = (v: { plate: string; nickname?: string | null }) => (v.nickname ? `${v.nickname} · ${v.plate}` : v.plate);
