import { and, asc, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { bracketSeeds, cupSignupOpen, matchWinner, SPRING_CUP } from '@/lib/game/tournament';
import type { Database, DbOrTx, Tx } from '@/server/db/client';
import { companies, deliveries, jobState, tournamentEntries, tournamentMatches, userBadges, users } from '@/server/db/schema';
import { featureLive } from '@/lib/game/features';
import { announce } from '@/server/discord/outbox';
import { appUrl } from '@/server/discord/config';
import { featureFor } from '@/server/features';
import { postCoins } from './coins';
import { fail } from './errors';
import { notify } from './notify';

const T = SPRING_CUP.key;

/** Signs the player up for the cup (until the first round; the first sixteen). */
export async function joinCup(db: Database, userId: string, now = new Date()) {
  if (!(await featureFor(db, userId, 'spring_cup', now))) fail('not_released', 'Това идва със следващото обновление.', 403);
  if (!cupSignupOpen(now)) fail('closed', 'Записването за купата е затворено.');
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ level: users.level }).from(users).where(eq(users.id, userId));
    if ((u?.level ?? 0) < SPRING_CUP.minLevel) fail('level', `Купата е за шофьори от ниво ${SPRING_CUP.minLevel} нагоре.`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cup:${T}`}))`);
    const [{ n = 0 } = {}] = await tx.select({ n: sql<number>`count(*)::int` }).from(tournamentEntries).where(eq(tournamentEntries.tournament, T));
    if (n >= SPRING_CUP.size) fail('full', `Местата (${SPRING_CUP.size}) са заети.`);
    const [row] = await tx.insert(tournamentEntries).values({ tournament: T, userId, createdAt: now }).onConflictDoNothing().returning();
    if (!row) fail('already', 'Вече си записан.');
    return { place: n + 1 };
  });
}

/** On-time loaded kilometres of a player in a window (the score of a round). */
async function roundKm(db: DbOrTx, userId: string, from: Date, to: Date) {
  const [row] = await db
    .select({ km: sql<number>`coalesce(sum(${deliveries.loadedKm}), 0)::float` })
    .from(deliveries)
    .innerJoin(companies, eq(companies.id, deliveries.companyId))
    .where(and(eq(companies.ownerId, userId), eq(deliveries.status, 'completed'), eq(deliveries.late, false), gte(deliveries.completedAt, from), lt(deliveries.completedAt, to)));
  return Math.round(row?.km ?? 0);
}

async function seedsOf(db: DbOrTx) {
  const rows = await db.select({ userId: tournamentEntries.userId, seed: tournamentEntries.seed }).from(tournamentEntries).where(eq(tournamentEntries.tournament, T));
  return new Map(rows.map((r) => [r.userId, r.seed ?? SPRING_CUP.size]));
}

/** Worker: seeds the bracket when the first round starts, then settles each round after its week (and pays the prizes after the final). */
export async function runCup(db: Database, now = new Date()) {
  const [first] = SPRING_CUP.rounds;
  if (now < first.from) return null;
  await db.transaction(async (tx) => {
    const [any] = await tx.select({ slot: tournamentMatches.slot }).from(tournamentMatches).where(eq(tournamentMatches.tournament, T)).limit(1);
    if (any) return;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`cup:${T}`}))`);
    const entries = await tx
      .select({ userId: tournamentEntries.userId })
      .from(tournamentEntries)
      .innerJoin(users, eq(users.id, tournamentEntries.userId))
      .where(eq(tournamentEntries.tournament, T))
      .orderBy(desc(users.level), asc(tournamentEntries.createdAt));
    if (entries.length < 2) {
      // Too few drivers: the cup is called off (once) and the one who signed up hears it (v1.7).
      const [first] = await tx.insert(jobState).values({ key: `cup-cancelled:${T}`, value: { entries: entries.length } }).onConflictDoNothing().returning();
      if (first) for (const e of entries) await notify(tx, e.userId, 'info', `${SPRING_CUP.title} се отменя`, 'Записаха се твърде малко шофьори. Следващата купа — със следващото обновление.', '/game/cup');
      return;
    }
    for (const [i, e] of entries.entries()) await tx.update(tournamentEntries).set({ seed: i + 1 }).where(and(eq(tournamentEntries.tournament, T), eq(tournamentEntries.userId, e.userId)));
    const bySeed = (s: number) => entries[s - 1]?.userId ?? null;
    const pairs = bracketSeeds(SPRING_CUP.size);
    await tx.insert(tournamentMatches).values(pairs.map(([a, b], slot) => ({ tournament: T, round: 1, slot, aUserId: bySeed(a), bUserId: bySeed(b) }))).onConflictDoNothing();
    for (const e of entries) await notify(tx, e.userId, 'info', `${SPRING_CUP.title} започва`, `${first.title}: повече километри с товар навреме тази седмица — и продължаваш.`, '/game/cup');
  });
  for (const [i, round] of SPRING_CUP.rounds.entries()) {
    if (now.getTime() < round.to.getTime() + SPRING_CUP.graceMs) break;
    await db.transaction((tx) => settleRound(tx, i + 1, round, now));
  }
  return true;
}

async function settleRound(tx: Tx, r: number, round: { from: Date; to: Date; title: string }, now: Date) {
  const open = await tx.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournament, T), eq(tournamentMatches.round, r), isNull(tournamentMatches.settledAt))).orderBy(asc(tournamentMatches.slot)).for('update');
  if (!open.length) return;
  const seeds = await seedsOf(tx);
  for (const m of open) {
    const a = m.aUserId ? { id: m.aUserId, seed: seeds.get(m.aUserId) ?? 99, km: await roundKm(tx, m.aUserId, round.from, round.to) } : null;
    const b = m.bUserId ? { id: m.bUserId, seed: seeds.get(m.bUserId) ?? 99, km: await roundKm(tx, m.bUserId, round.from, round.to) } : null;
    const winnerId = matchWinner(a, b);
    await tx.update(tournamentMatches).set({ aKm: a?.km ?? null, bKm: b?.km ?? null, winnerId, settledAt: now }).where(and(eq(tournamentMatches.tournament, T), eq(tournamentMatches.round, r), eq(tournamentMatches.slot, m.slot)));
    if (a && b) {
      const loser = winnerId === a.id ? b : a;
      await notify(tx, winnerId!, 'success', `${SPRING_CUP.title}: продължаваш!`, `${round.title}: ${winnerId === a.id ? a.km : b.km} срещу ${loser.km} км.`, '/game/cup');
      await notify(tx, loser.id, 'info', `${SPRING_CUP.title}: отпадна`, `${round.title}: ${loser.km} срещу ${winnerId === a.id ? a.km : b.km} км. Благодарим за играта!`, '/game/cup');
    }
  }
  const all = await tx.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournament, T), eq(tournamentMatches.round, r))).orderBy(asc(tournamentMatches.slot));
  if (r < SPRING_CUP.rounds.length) {
    const next = [];
    for (let s = 0; s < all.length; s += 2) next.push({ tournament: T, round: r + 1, slot: s / 2, aUserId: all[s]?.winnerId ?? null, bUserId: all[s + 1]?.winnerId ?? null });
    const made = await tx.insert(tournamentMatches).values(next).onConflictDoNothing().returning();
    // Each driver of the new round hears who they meet (v1.7).
    const nextRound = SPRING_CUP.rounds[r]!;
    const names = new Map((await tx.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, [...all, ...made].flatMap((m) => [m.aUserId, m.bUserId]).filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000'])))).map((u) => [u.id, u.username]));
    for (const m of made) {
      for (const [me, other] of [[m.aUserId, m.bUserId], [m.bUserId, m.aUserId]] as const) {
        if (me) await notify(tx, me, 'info', `${SPRING_CUP.title}: ${nextRound.title}`, other ? `Срещу ${names.get(other) ?? '—'} — до ${nextRound.to.toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' })}.` : 'Без съперник този кръг — продължаваш.', '/game/cup');
      }
    }
    await announceRound(tx, r, round.title, all, names, now);
    return;
  }
  // The final: the prizes (once — the coin keys are unique).
  const final = all[0]!;
  const semis = await tx.select().from(tournamentMatches).where(and(eq(tournamentMatches.tournament, T), eq(tournamentMatches.round, r - 1)));
  const finalist = final.winnerId === final.aUserId ? final.bUserId : final.aUserId;
  const semifinalists = semis.map((m) => (m.winnerId === m.aUserId ? m.bUserId : m.aUserId)).filter((u): u is string => !!u);
  const pay = async (userId: string | null, coins: number, what: string) => {
    if (!userId) return;
    await postCoins(tx, userId, { amount: coins, reason: 'tournament', description: `${SPRING_CUP.title}: ${what}`, idempotencyKey: `cup:${T}:${userId}` });
    await notify(tx, userId, 'achievement', `${SPRING_CUP.title}: ${what}! 🏆`, `Награда: ${coins} TC.`, '/game/cup');
  };
  await pay(final.winnerId, SPRING_CUP.prizes.champion, 'шампион');
  await announceRound(tx, r, round.title, all, new Map((await tx.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, [final.aUserId, final.bUserId].filter((x): x is string => !!x).concat(['00000000-0000-0000-0000-000000000000'])))).map((u) => [u.id, u.username])), now);
  if (final.winnerId) await tx.insert(userBadges).values({ userId: final.winnerId, badge: SPRING_CUP.badge, awardedAt: now }).onConflictDoNothing();
  await pay(finalist, SPRING_CUP.prizes.finalist, 'финалист');
  for (const u of semifinalists) await pay(u, SPRING_CUP.prizes.semifinal, 'полуфиналист');
}

/** The cup for the page and Discord: entries, rounds with names, live km of the running round. */
export async function cupView(db: DbOrTx, now: Date, userId?: string | null) {
  const entries = await db.select({ userId: tournamentEntries.userId, seed: tournamentEntries.seed, username: users.username, level: users.level }).from(tournamentEntries).innerJoin(users, eq(users.id, tournamentEntries.userId)).where(eq(tournamentEntries.tournament, T)).orderBy(asc(tournamentEntries.createdAt));
  const matches = await db.select().from(tournamentMatches).where(eq(tournamentMatches.tournament, T)).orderBy(asc(tournamentMatches.round), asc(tournamentMatches.slot));
  const ids = [...new Set(matches.flatMap((m) => [m.aUserId, m.bUserId]).filter((x): x is string => !!x))];
  const names = ids.length ? await db.select({ id: users.id, username: users.username }).from(users).where(inArray(users.id, ids)) : [];
  const name = (id: string | null) => (id ? (names.find((n) => n.id === id)?.username ?? '—') : null);
  const current = SPRING_CUP.rounds.findIndex((r) => now >= r.from && now < r.to);
  const rounds = await Promise.all(SPRING_CUP.rounds.map(async (r, i) => ({
    ...r,
    live: i === current,
    matches: await Promise.all(matches.filter((m) => m.round === i + 1).map(async (m) => ({
      slot: m.slot,
      a: name(m.aUserId),
      b: name(m.bUserId),
      aId: m.aUserId,
      bId: m.bUserId,
      // The running round shows the kilometres so far.
      aKm: m.aKm ?? (i === current && m.aUserId ? await roundKm(db, m.aUserId, r.from, now) : null),
      bKm: m.bKm ?? (i === current && m.bUserId ? await roundKm(db, m.bUserId, r.from, now) : null),
      winner: name(m.winnerId),
      settled: !!m.settledAt,
    }))),
  })));
  const [cancelled] = await db.select({ key: jobState.key }).from(jobState).where(eq(jobState.key, `cup-cancelled:${T}`));
  return { ...SPRING_CUP, cancelled: !!cancelled, signupOpen: cupSignupOpen(now), entries, joined: !!userId && entries.some((e) => e.userId === userId), rounds };
}

/** The results of a round in Discord's #класации (v1.7). */
async function announceRound(tx: Tx, r: number, title: string, matches: (typeof tournamentMatches.$inferSelect)[], names: Map<string, string>, now: Date) {
  if (!featureLive('discord_bot', now)) return;
  const lines = matches
    .filter((m) => m.aUserId && m.bUserId)
    .map((m) => {
      const side = (id: string | null, km: number | null) => `${m.winnerId === id ? '**' : ''}${names.get(id ?? '') ?? '—'} (${Math.round(km ?? 0)} км)${m.winnerId === id ? '**' : ''}`;
      return `${side(m.aUserId, m.aKm)} срещу ${side(m.bUserId, m.bKm)}`;
    });
  const final = r === SPRING_CUP.rounds.length;
  await announce(tx, `cup:${T}:round-${r}`, 'rankings', {
    embeds: [{ title: final ? `🏆 ${SPRING_CUP.title}: шампион е ${names.get(matches[0]?.winnerId ?? '') ?? '—'}!` : `🏆 ${SPRING_CUP.title} · ${title}`, url: `${appUrl()}/game/cup`, color: 0xf6c343, description: lines.join('\n') || 'Всички продължиха без съперник.', footer: { text: 'TransVerse · игрови данни' } }],
  }, now);
}
