import { sql } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';

/**
 * After 1.3, for the team: how many players use each new system. It counts what the
 * systems already keep in job_state (no new tracking), players only (not the staff), and
 * compares with the players seen in the last 7 days.
 */
export interface AdoptionRow { id: string; label: string; players: number }
export interface AdoptionDay { day: string; players: number }
export interface Adoption { active7: number; rows: AdoptionRow[]; nightRun: AdoptionDay[]; dailyRoute: AdoptionDay[]; busLines: number }

// Each system: the key pattern in job_state and which part of the key (or the value) holds the player.
const SYSTEMS: { id: string; label: string; pattern: string; part?: number; owner?: true }[] = [
  { id: 'winter_trek', label: 'Зимен поход', pattern: '^winter-trek:[^:]+$', part: 2 },
  { id: 'daily_route', label: 'Пътят на деня', pattern: '^daily-route:[^:]+:[^:]+$', part: 3 },
  { id: 'mascot', label: 'Талисман', pattern: '^mascot:[^:]+$', part: 2 },
  { id: 'night_run', label: 'Нощен рейс', pattern: '^night-run:[^:]+:[^:]+$', part: 3 },
  { id: 'driver_skills', label: 'Умения на шофьора', pattern: '^skills:[^:]+$', part: 2 },
  { id: 'player_workshops', label: 'Собствен сервиз', pattern: '^workshop:[^:]+$', part: 2 },
  { id: 'world_crises', label: 'Световни кризи (гласували)', pattern: '^crisis-vote:[^:]+:[^:]+$', part: 3 },
  { id: 'bus_lines', label: 'Автобусна компания', pattern: '^bus-line:', owner: true },
];

const num = (v: unknown) => Number(v ?? 0);

async function playersOf(db: DbOrTx, pattern: string, part?: number, owner?: true): Promise<number> {
  const who = owner ? sql`j.value->>'ownerId'` : sql`split_part(j.key, ':', ${part ?? 2})`;
  const res = await db.execute(sql`
    select count(distinct u.id)::int as n
    from job_state j join users u on u.id::text = ${who} and u.role = 'player'
    where j.key ~ ${pattern}`);
  return num((res.rows[0] as { n?: number } | undefined)?.n);
}

/** Players a day for the last 7 days of a daily game (`<prefix>:<day>:<player>`). */
async function byDay(db: DbOrTx, prefix: string): Promise<AdoptionDay[]> {
  const res = await db.execute(sql`
    select split_part(j.key, ':', 2) as day, count(distinct u.id)::int as n
    from job_state j join users u on u.id::text = split_part(j.key, ':', 3) and u.role = 'player'
    where j.key ~ ${`^${prefix}:[^:]+:[^:]+$`}
    group by 1 order by 1 desc limit 7`);
  return (res.rows as { day: string; n: number }[]).map((r) => ({ day: r.day, players: num(r.n) }));
}

export async function releaseAdoption(db: DbOrTx, now: Date): Promise<Adoption> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const active = await db.execute(sql`select count(*)::int as n from users where role = 'player' and last_seen_at >= ${since}`);
  const rows = await Promise.all(SYSTEMS.map(async (s) => ({ id: s.id, label: s.label, players: await playersOf(db, s.pattern, s.part, s.owner) })));
  const lines = await db.execute(sql`select count(*)::int as n from job_state where key ~ '^bus-line:'`);
  return {
    active7: num((active.rows[0] as { n?: number } | undefined)?.n),
    rows: rows.sort((a, b) => b.players - a.players),
    nightRun: await byDay(db, 'night-run'),
    dailyRoute: await byDay(db, 'daily-route'),
    busLines: num((lines.rows[0] as { n?: number } | undefined)?.n),
  };
}
