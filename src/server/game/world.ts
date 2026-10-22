import { and, eq, gt, lte, sql } from 'drizzle-orm';
import type { Database } from '@/server/db/client';
import { countries, jobState, marketEvents, rateLimits, sessions } from '@/server/db/schema';
import { upgradeApproximateRoutes } from '@/server/geo/route-service';
import type { RoutingProvider } from '@/server/geo/routing';
import { settleClientContracts } from './clients';
import { driverMoods } from './moods';
import { ensureRally, settleRallies } from './rally';
import { ensureOversizeLoads, ensureRoadWorks } from './roads';
import { announceRally, syncScheduledEvents } from '@/server/discord/scheduled';
import { ensureHalloweenEvent } from './halloween';
import { ensureChristmasEvent } from './christmas';
import { ensureMartaEvent } from './marta';
import { collectOverdueFines } from './fines';
import { publishWeeklyNews } from './news';
import { autoDispatchTick } from './dispatch';
import { ensureAuction, settleAuctions } from './auctions';
import { ensureDailyLoad, ensureLocalJobsForFleet, replenishMarket } from './contracts';
import { migrateToGameTime, recoverDemand, settleDueDeliveries } from './deliveries';
import { dispatchPush, pruneSubscriptions } from '@/server/push';
import { autoUrgentTick } from './auto-urgent';
import { settleTenders } from './tenders';
import { dailyReminders } from './daily';
import { ensureAutoEvent, settleDueEvents } from './events';
import { expireMentorships } from './mentor';
import { paymentConfig, reconcilePaypal } from '@/server/payments';
import { broadcast } from './notify';
import { pick, randInt } from './random';
import { activeSeason, rotateSeasons } from './seasons';
import { applyDueRoadEvents } from './road-events';
import { expireListings } from './used-market';
import { settleLeagues } from './leagues';
import { expireProjects } from './projects';
import { ensureWeeklyBattles, settleBattles } from './battles';
import { pruneFeed } from './feed';
import { settleEcoWeek } from './eco';
import { collectLeases } from './leasing';
import { finishConstructions } from './plot';
import { awardBuildersOfWeek } from './base-life';
import { announceFromGame } from '@/server/discord/announce';
import { processOutbox } from '@/server/discord/outbox';
import { bridgeCompanyChat, relayArrivingSoon, relayNotifications } from '@/server/discord/relay';
import { syncCompanyPolls } from '@/server/discord/company-polls';
import { awardMostActive, treasuryReports, welcomeCompanyMembers } from '@/server/discord/company-life';
import { voiceXp } from '@/server/discord/levels';
import { photoContest } from '@/server/discord/photos';
import { runQuiz } from '@/server/discord/quiz';
import { sweepRooms } from '@/server/discord/rooms';
import { drawGiveaways } from '@/server/discord/giveaways';
import { registerCommands } from '@/server/discord/register';
import { updateStats } from '@/server/discord/stats';
import { syncTickets } from '@/server/discord/tickets';
import { announceWeeklyRanking } from '@/server/discord/weekly';
import { syncAllRoles } from '@/server/discord/sync';
import { announceDailyLoad, announceLiveryWinner } from '@/server/discord/announce';
import { dailyLoadLane, liveBattles, postLiveryEntries } from '@/server/discord/together';
import { announceShipCall, liveShipCalls } from '@/server/discord/ports';
import { DAILY_LOAD } from '@/lib/game/together';
import { closeExpiredSharedLoads, settleDuels } from './together';
import { ensurePortLoads, settleShipCalls, startShipCall } from './ports';
import { fetchWeather } from './weather';
import { runFactories } from './factory';
import { collectLoans, ensureBranchLoads } from './business';
import { expireFreight } from './trade';
import { settleLiveryContest } from './livery-contest';
import { featureLive } from '@/lib/game/features';
import { runPayroll } from './staff';

/**
 * Background simulation of the persistent world. Every job is idempotent and
 * catches up after downtime, so restarting the worker never loses or doubles
 * anything. The browser plays no part in game time.
 */

const EVENT_TEMPLATES = [
  { title: 'Жътва', description: 'Сезонът на жътвата вдига търсенето на превоз на насипни товари.', cargoType: 'bulk', multiplier: 1.35 },
  { title: 'Строителен бум', description: 'Големи инфраструктурни проекти търсят специализиран транспорт.', cargoType: 'special', multiplier: 1.3 },
  { title: 'Горещи дни', description: 'Високите температури увеличават търсенето на хладилен транспорт.', cargoType: 'refrigerated', multiplier: 1.25 },
  { title: 'Пиково търсене в търговията', description: 'Веригите зареждат складове — палетите плащат повече.', cargoType: 'pallets', multiplier: 1.2 },
  { title: 'Задръстени пристанища', description: 'Пристанищата наваксват — контейнерните превози са по-скъпи.', cargoType: 'container', multiplier: 1.3 },
  { title: 'Отоплителен сезон', description: 'Търсенето на горива расте.', cargoType: 'liquid', multiplier: 1.25 },
] as const;
const EVENT_COUNTRIES = ['BG', 'RO', 'GR', 'TR', 'RS', 'MK', 'HU', 'AT', 'DE'];

async function lastRun(db: Database, key: string): Promise<number> {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, key));
  return row ? Number((row.value as { at: number }).at) : 0;
}
async function markRun(db: Database, key: string, at: number) {
  await db.insert(jobState).values({ key, value: { at } }).onConflictDoUpdate({ target: jobState.key, set: { value: { at }, updatedAt: new Date() } });
}

/** Last outcome of every worker job (admin "Система" page): when it ran, and the last error if it failed. */
export interface JobHealth {
  okAt: number | null;
  errorAt: number | null;
  error: string | null;
  failures: number;
}
const HEALTH_PREFIX = 'health:';

async function recordHealth(db: Database, key: string, error: unknown, at: number) {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, HEALTH_PREFIX + key));
  const prev = (row?.value as JobHealth | undefined) ?? { okAt: null, errorAt: null, error: null, failures: 0 };
  const value: JobHealth = error
    ? { ...prev, errorAt: at, error: String((error as Error)?.stack ?? error).slice(0, 2000), failures: prev.failures + 1 }
    : { ...prev, okAt: at, failures: 0 };
  // Success is recorded at most once a minute per job (keeps writes low on a 15 s tick).
  if (!error && prev.okAt && at - prev.okAt < 60_000 && !prev.failures) return;
  await db.insert(jobState).values({ key: HEALTH_PREFIX + key, value }).onConflictDoUpdate({ target: jobState.key, set: { value, updatedAt: new Date(at) } });
}

/**
 * Runs one job of the tick. A failing job is logged and recorded but never
 * stops the others (one broken job used to stop everything after it,
 * phone notifications included).
 */
export async function job(db: Database, key: string, now: Date, fn: () => Promise<unknown>) {
  try {
    await fn();
    await recordHealth(db, key, null, now.getTime());
  } catch (error) {
    console.error(`[worker] ${key} failed`, error);
    await recordHealth(db, key, error, now.getTime()).catch(() => undefined);
  }
}

async function every(db: Database, key: string, intervalMs: number, now: Date, fn: (elapsedMs: number) => Promise<unknown>) {
  const last = await lastRun(db, key);
  if (now.getTime() - last < intervalMs) return;
  await job(db, key, now, async () => {
    await fn(last ? now.getTime() - last : intervalMs);
    await markRun(db, key, now.getTime());
  });
}

export async function jobHealth(db: Database) {
  const rows = await db.select().from(jobState).where(sql`${jobState.key} like ${HEALTH_PREFIX + '%'}`);
  return rows.map((r) => ({ key: r.key.slice(HEALTH_PREFIX.length), ...(r.value as JobHealth) })).sort((a, b) => (b.errorAt ?? 0) - (a.errorAt ?? 0) || a.key.localeCompare(b.key));
}

export async function spawnMarketEvent(db: Database, now: Date) {
  const active = await db.select({ id: marketEvents.id }).from(marketEvents).where(and(lte(marketEvents.startsAt, now), gt(marketEvents.endsAt, now)));
  if (active.length >= 3) return;
  const t = pick(EVENT_TEMPLATES);
  const country = pick(EVENT_COUNTRIES);
  const [c] = await db.select({ nameBg: countries.nameBg }).from(countries).where(eq(countries.code, country));
  await db.insert(marketEvents).values({
    title: `${t.title}: ${c?.nameBg ?? country}`,
    description: `${t.description} (игрово събитие)`,
    countryCode: country,
    cargoType: t.cargoType,
    multiplier: t.multiplier,
    startsAt: now,
    endsAt: new Date(now.getTime() + randInt(24, 72) * 3_600_000),
  });
  await broadcast(db, 'market');
}

/** One pass of the world simulation. Guarded by an advisory lock so only one runner works at a time. */
export async function worldTick(db: Database, now = new Date(), provider?: RoutingProvider) {
  const { rows } = await db.execute<{ locked: boolean }>(sql`select pg_try_advisory_lock(424242) as locked`);
  if (!rows[0]?.locked) return { skipped: true };
  try {
    let settled = 0;
    await job(db, 'game-time', now, () => migrateToGameTime(db));
    // Road events first: a jam or a breakdown can push an arrival past this tick.
    await job(db, 'road-events', now, () => applyDueRoadEvents(db, now));
    await job(db, 'deliveries', now, async () => {
      settled = await settleDueDeliveries(db, now);
    });
    // Global events: settle finished ones (after the deliveries above), keep the automatic ones going.
    await job(db, 'events-settle', now, () => settleDueEvents(db, now));
    await job(db, 'tenders', now, () => settleTenders(db, now));
    await every(db, 'client-contracts', 60_000, now, () => settleClientContracts(db, now));
    await every(db, 'fines', 5 * 60_000, now, () => collectOverdueFines(db, now));
    await every(db, 'newspaper', 10 * 60_000, now, () => publishWeeklyNews(db, now));
    await every(db, 'auto-dispatch', 60_000, now, () => autoDispatchTick(db, now));
    await every(db, 'auctions', 30_000, now, async () => {
      await ensureAuction(db, now, provider);
      await settleAuctions(db, now);
    });
    await every(db, 'global-events', 10 * 60_000, now, () => ensureAutoEvent(db, now));
    await every(db, 'halloween-event', 10 * 60_000, now, () => ensureHalloweenEvent(db, now));
    await every(db, 'christmas-event', 10 * 60_000, now, () => ensureChristmasEvent(db, now));
    if (featureLive('marta', now)) await every(db, 'marta-event', 10 * 60_000, now, () => ensureMartaEvent(db, now));
    await every(db, 'mentorships', 10 * 60_000, now, () => expireMentorships(db, now));
    // PayPal: finish approved orders whose buyer never came back; expire abandoned ones.
    if (paymentConfig().paypal.enabled) await every(db, 'paypal-reconcile', 2 * 60_000, now, () => reconcilePaypal(db, now));
    await every(db, 'market', 5 * 60_000, now, () => replenishMarket(db, now, provider));
    await every(db, 'local-jobs', 60_000, now, () => ensureLocalJobsForFleet(db, now, undefined, provider));
    await every(db, 'routes', 15 * 60_000, now, () => upgradeApproximateRoutes(db, 5, provider));
    await every(db, 'demand', 60 * 60_000, now, (elapsed) => recoverDemand(db, Math.min(48, elapsed / 3_600_000)));
    await every(db, 'events', 6 * 60 * 60_000, now, () => spawnMarketEvent(db, now));
    // Urgent shipments from the automatic dispatcher, at random intervals.
    await job(db, 'auto-urgent', now, () => autoUrgentTick(db, now, provider));
    await every(db, 'seasons', 10 * 60_000, now, async () => {
      await activeSeason(db, now);
      await rotateSeasons(db, now);
    });
    // Payroll for the previous UTC day, once per day (idempotent per company/day).
    await job(db, 'payroll', now, async () => {
      const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
      const [payroll] = await db.select().from(jobState).where(eq(jobState.key, 'payroll'));
      if ((payroll?.value as { day?: string } | undefined)?.day === yesterday) return;
      await runPayroll(db, yesterday);
      await db.insert(jobState).values({ key: 'payroll', value: { day: yesterday } }).onConflictDoUpdate({ target: jobState.key, set: { value: { day: yesterday }, updatedAt: now } });
    });
    await every(db, 'daily-reminders', 10 * 60_000, now, () => dailyReminders(db, now));
    await every(db, 'used-market', 10 * 60_000, now, () => expireListings(db, now));
    await every(db, 'leagues', 10 * 60_000, now, () => settleLeagues(db, now));
    await every(db, 'company-projects', 10 * 60_000, now, () => expireProjects(db, now));
    // Features of an update that is not out yet stay off for players (see lib/game/features).
    if (featureLive('eco', now)) await every(db, 'eco-week', 30 * 60_000, now, () => settleEcoWeek(db, now));
    await every(db, 'feed-prune', 6 * 3_600_000, now, () => pruneFeed(db, now));
    // Weekly lease instalments (and taking back trucks two instalments behind).
    await every(db, 'leases', 10 * 60_000, now, () => collectLeases(db, now));
    // Constructions on company plots whose time is up.
    await every(db, 'constructions', 60_000, now, () => finishConstructions(db, now));
    // "Строител на седмицата" in every company, after the week ends.
    if (featureLive('builder_week', now)) await every(db, 'builder-week', 30 * 60_000, now, () => awardBuildersOfWeek(db, now));
    // Company battles: settle last week's, pair this week's.
    await every(db, 'company-battles', 10 * 60_000, now, async () => {
      await settleBattles(db, now);
      if (featureLive('battles', now)) await ensureWeeklyBattles(db, now);
    });
    // v1.3 together: the load of the day, duels, shared loads that ran out, the livery contest.
    await every(db, 'daily-load', 10 * 60_000, now, async () => {
      const id = await ensureDailyLoad(db, now, provider);
      const made = id ? await dailyLoadLane(db, id) : null;
      if (made) await announceDailyLoad(db, made.load, made.lane, DAILY_LOAD.coins, now);
    });
    // v1.4: the real weather on the roads, port containers and ship calls.
    if (process.env.WEATHER !== 'off') await every(db, 'weather', 30 * 60_000, now, () => fetchWeather(db, now));
    await every(db, 'rally', 30 * 60_000, now, async () => {
      const rally = await ensureRally(db, now, provider);
      if (rally) await announceRally(db, rally.id, now);
      await settleRallies(db, now);
    });
    await every(db, 'roads', 30 * 60_000, now, async () => {
      // Made before the release too (staff test them); players see them from the release.
      await ensureRoadWorks(db, now);
      await ensureOversizeLoads(db, now, provider);
    });
    await every(db, 'driver-moods', 24 * 3_600_000, now, () => driverMoods(db, now));
    await every(db, 'factories', 5 * 60_000, now, () => runFactories(db, now));
    await every(db, 'branches-loans', 10 * 60_000, now, async () => {
      await collectLoans(db, now);
      await ensureBranchLoads(db, now, provider);
    });
    await every(db, 'freight-exchange', 10 * 60_000, now, () => expireFreight(db, now));
    await every(db, 'ports', 30 * 60_000, now, async () => {
      await settleShipCalls(db, now);
      await ensurePortLoads(db, now, provider);
      const call = await startShipCall(db, now, provider);
      if (call) await announceShipCall(db, call, now);
    });
    await every(db, 'together', 10 * 60_000, now, async () => {
      await settleDuels(db, now);
      await closeExpiredSharedLoads(db, now);
      const winner = await settleLiveryContest(db, now);
      if (winner) await announceLiveryWinner(db, winner, now);
    });
    await every(db, 'discord-live', 10 * 60_000, now, async () => {
      await liveBattles(db, now);
      await liveShipCalls(db, now);
      await postLiveryEntries(db, now);
      await syncScheduledEvents(db, now);
    });
    // The Discord bot: chat bridge and messages often, announcements and roles less often.
    await every(db, 'discord-chat', 15_000, now, async () => {
      await bridgeCompanyChat(db, now);
      await relayNotifications(db, now);
      await syncTickets(db, now);
      await processOutbox(db, now);
    });
    // Giveaways that ended and company polls in the company channels.
    await every(db, 'discord-community', 60_000, now, async () => {
      await drawGiveaways(db, now);
      await syncCompanyPolls(db, now);
      await voiceXp(db, now);
      await sweepRooms(db, now);
      await relayArrivingSoon(db, now);
      await welcomeCompanyMembers(db, now);
      await runQuiz(db, now);
    });
    // The numbers in the names of the statistics channels (Discord allows two renames per ten minutes).
    await every(db, 'discord-stats', 10 * 60_000, now, () => updateStats(db, now));
    await every(db, 'discord-weekly', 30 * 60_000, now, async () => {
      await announceWeeklyRanking(db, now);
      await awardMostActive(db, now);
      await treasuryReports(db, now);
      await photoContest(db, now);
    });
    await every(db, 'discord-announce', 5 * 60_000, now, () => announceFromGame(db, now));
    await every(db, 'discord-roles', 10 * 60_000, now, () => syncAllRoles(db, now));
    // Again now and then: the bot may have been added to the server after the worker started.
    await every(db, 'discord-commands', 30 * 60_000, now, () => registerCommands());
    // Push notifications for whatever happened above (in-game notifications and company chat).
    await job(db, 'push', now, () => dispatchPush(db, now));
    await every(db, 'push-prune', 24 * 60 * 60_000, now, () => pruneSubscriptions(db, now));
    await every(db, 'cleanup', 60 * 60_000, now, async () => {
      await db.delete(sessions).where(lte(sessions.expiresAt, now));
      await db.delete(rateLimits).where(lte(rateLimits.windowStart, new Date(now.getTime() - 86_400_000)));
    });
    return { skipped: false, settled };
  } finally {
    await db.execute(sql`select pg_advisory_unlock(424242)`);
  }
}
