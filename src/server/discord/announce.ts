import { and, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { featureLive } from '@/lib/game/features';
import { dec, int, km, money } from '@/lib/format';
import { weekKey } from '@/lib/game/leagues';
import { headline, type NewsIssue } from '@/lib/game/news';
import { RELEASES, type Release } from '@/lib/game/releases';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyBattles, globalEvents, jobState, newspapers, organizations, users } from '@/server/db/schema';
import { LIVERY_CONTEST } from '@/lib/game/together';
import { appUrl, BRAND, discordConfig } from './config';
import { announce } from './outbox';
import { button, linkButton, rows, STYLE } from './ui';
import { t, tx } from '@/i18n/t';

const HOUR = 3_600_000;
/** A release is announced while it is the newest one and at most this many days old. */
export const RELEASE_ANNOUNCE_DAYS = 14;
const footer = { text: 'TransVerse · игрови данни' };

/** A building finished (from finishConstructions). */
export async function announceBuild(db: DbOrTx, buildId: string, company: { name: string; tag: string | null; id: string }, label: string, level: number, now: Date) {
  if (!featureLive('discord_bot', now)) return;
  await announce(db, `build:${buildId}`, 'builds', () => ({
    embeds: [{ title: level > 1 ? t('🏗️ {0} вдигна „{1}“ на ниво {2}', company.name, label, level) : t('🏗️ {0} построи „{1}“', company.name, label), url: `${appUrl()}/game/companies/${company.id}`, color: BRAND, footer }],
    // "Браво" is a like for the base in the game (market.ts).
    components: rows(button(t('Браво'), `cheer:${company.id}`, STYLE.success, '👍')),
  }), now);
}

/** "Строител на седмицата" (from awardBuildersOfWeek). */
export async function announceBuilderOfWeek(db: DbOrTx, key: string, company: string, username: string, tons: number, rewardCents: number, now: Date) {
  if (!featureLive('discord_bot', now)) return;
  await announce(db, `builder-week:${key}:${company}`, 'builds', () => ({
    embeds: [{ title: t('👷 Строител на седмицата в „{0}“: {1}', company, username), description: t('{0} т материали за базата{1}', dec(tons), rewardCents ? t(' · награда {0}', money(rewardCents)) : ''), color: 0xf6c343, footer }],
  }), now);
}

/** 1.1.3.1: a player earned a gold or prestige achievement (from checkAchievements). */
export async function announceAchievement(db: DbOrTx, userId: string, key: string, title: string, tier: 'gold' | 'prestige', now = new Date()) {
  if (!featureLive('discord_bot', now) || !featureLive('more_achievements', now)) return;
  const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId));
  if (!u) return;
  await announce(db, `achievement:${userId}:${key}`, 'rankings', () => ({
    embeds: [{ title: tier === 'prestige' ? t('💎 {0} взе престижното постижение „{1}“', u.username, tx(title)) : t('🥇 {0} взе златното постижение „{1}“', u.username, tx(title)), url: `${appUrl()}/game/progress`, color: tier === 'prestige' ? 0xa855f7 : 0xf6c343, footer }],
  }), now);
}

/** 1.1.3.1: a gold season medal for a player (places 1–3) or a company (first place). */
export async function announceGoldMedal(db: DbOrTx, who: { kind: 'player' | 'company'; id: string; name: string }, season: { id: number; name: string }, rank: number, now = new Date()) {
  if (!featureLive('discord_bot', now) || !featureLive('season_medals', now)) return;
  await announce(db, `medal:${season.id}:${who.kind}:${who.id}`, 'rankings', () => ({
    embeds: [{
      title: who.kind === 'player' ? t('🥇 {0} спечели златен медал — {1}. място', who.name, rank) : t('🥇 „{0}“ спечели златен медал за компании', who.name),
      description: tx(season.name),
      url: `${appUrl()}/game/seasons${who.kind === 'company' ? '?tab=companies' : ''}`,
      color: 0xf6c343,
      footer,
    }],
  }), now);
}

/** 1.1.3.1: a company earned a gold or prestige company achievement. */
export async function announceCompanyAchievement(db: DbOrTx, organizationId: string, name: string, key: string, title: string, tier: 'gold' | 'prestige', now = new Date()) {
  if (!featureLive('discord_bot', now) || !featureLive('company_achievements', now)) return;
  await announce(db, `company-achievement:${organizationId}:${key}`, 'rankings', () => ({
    embeds: [{ title: tier === 'prestige' ? t('💎 „{0}“ взе престижното фирмено постижение „{1}“', name, tx(title)) : t('🥇 „{0}“ взе златното фирмено постижение „{1}“', name, tx(title)), url: `${appUrl()}/game/companies/${organizationId}`, color: tier === 'prestige' ? 0xa855f7 : 0xf6c343, footer }],
  }), now);
}

/** 1.1.3.2: the Discord side of the ideas (the ideas themselves come with 1.1.4). */
export const ideasOn = (now: Date) => featureLive('discord_bot', now) && featureLive('discord_ideas', now) && featureLive('ideas', now);

/** A new idea from the game, with a vote button (from runAction). */
export async function announceIdea(db: DbOrTx, idea: { id: string; title: string; body: string }, author: string, now = new Date()) {
  if (!ideasOn(now)) return;
  await announce(db, `idea:${idea.id}`, 'ideas', () => ({
    ping: false,
    embeds: [{ title: `💡 ${idea.title}`, description: idea.body || undefined, color: BRAND, footer: { text: t('Идея от {0} · гласувай с бутона (свързан акаунт)', author) } }],
    components: rows(button(t('Гласувай'), `idea:vote:${idea.id}`, STYLE.success, '👍'), linkButton(t('Всички идеи'), `${appUrl()}/game/ideas`)),
  }), now);
}

const STATUS_LINE: Record<string, string> = { planned: '🗓️ Планирана', done: '✅ Направена', declined: '❌ Отхвърлена' };

/** The team marked an idea planned, done or declined (from setIdeaStatus). */
export async function announceIdeaStatus(db: DbOrTx, idea: { id: string; title: string }, status: string, note: string, now = new Date()) {
  if (!ideasOn(now) || !(status in STATUS_LINE)) return;
  await announce(db, `idea-status:${idea.id}:${status}`, 'ideas', () => ({
    ping: false,
    embeds: [{ title: `${tx(STATUS_LINE[status]!)}: ${idea.title}`, description: note ? t('Екипът: {0}', note) : undefined, color: status === 'declined' ? 0x9aa3b2 : 0x2fd27a, url: `${appUrl()}/game/ideas` }],
  }), now);
}

/** A used truck or trailer on the market (from createListing): "Купи" buys it from Discord. */
export async function announceListing(db: DbOrTx, listing: { id: string; kind: string; modelId: string; priceCents: number; expiresAt: Date }, details: { city: string; condition: number; seller: string }, now: Date) {
  if (!featureLive('discord_bot', now)) return;
  const model = listing.kind === 'vehicle' ? powerUnitModel(listing.modelId) : trailerModel(listing.modelId);
  await announce(db, `listing:${listing.id}`, 'usedMarket', () => ({
    embeds: [{
      title: `🏷️ ${model.brand} ${model.name}`,
      url: `${appUrl()}/game/market`,
      color: BRAND,
      description: t('**{0}** · състояние {1} % · {2}\nПродава: {3} · до <t:{4}:d>', money(listing.priceCents), Math.round(details.condition), details.city, details.seller, Math.floor(listing.expiresAt.getTime() / 1000)),
      footer,
    }],
    components: rows(button(t('Купи'), `used:buy:${listing.id}`, STYLE.success, '🛒')),
  }), now);
}

/** "Товар на деня" (from the worker): the first one to take it gets it. */
export async function announceDailyLoad(db: DbOrTx, load: { id: string; goods: string; weightTons: number; distanceKm: number; rewardCents: number; expiresAt: Date }, lane: { from: string; to: string }, coins: number, now: Date) {
  if (!featureLive('daily_load', now)) return;
  await announce(db, `daily-load:${load.id}`, 'dailyLoad', () => ({
    embeds: [{
      title: t('⭐ Товар на деня: {0} → {1}', lane.from, lane.to),
      url: `${appUrl()}/game/contracts?load=${load.id}`,
      color: 0xf6c343,
      description: t('{0} · {1} т · {2}\n**{3}** + **{4} ТрансКоин** при доставка навреме.\nВзима го първият — до <t:{5}:t>.', load.goods, dec(load.weightTons), km(load.distanceKm), money(load.rewardCents), coins, Math.floor(load.expiresAt.getTime() / 1000)),
      footer,
    }],
    components: rows(button(t('Поеми'), `take:${load.id}`, STYLE.success, '🚚')),
  }), now);
}

/** The livery of the month (from settleLiveryContest). */
export async function announceLiveryWinner(db: DbOrTx, entry: { id: string; monthKey: string; userId: string; plate: string; votes: number }, now: Date) {
  if (!featureLive('livery_contest', now)) return;
  const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, entry.userId));
  await announce(db, `livery-win:${entry.monthKey}`, 'livery', () => ({
    embeds: [{ title: t('🎨 Ливрея на месеца: {0}', u?.username ?? ''), description: t('{0} събра {1} 👍 — +{2} ТрансКоин и значка „Ливрея на месеца“. Новият конкурс вече тече: покажи камиона си от Състезание → Ливреи.', entry.plate, entry.votes, LIVERY_CONTEST.coins), color: 0xa66bff, image: { url: `${appUrl()}/api/discord/card/livery/${entry.id}` }, footer }],
  }), now);
}

/** Discord's limits for one message (embed description, field value, fields, all text together). */
const LIMIT = { description: 4096, fieldValue: 1024, fields: 25, total: 6000 } as const;
const cut = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/**
 * 1.1.3: the whole release in one Discord message, in the channel's language
 * (the notes are translation keys): the tagline and the highlights, then every
 * section as a field. What does not fit Discord's limits ends with "…" and the
 * link to the full notes.
 */
export function releaseAnnouncement(r: Release) {
  const title = t('Обновление {0} — „{1}“', r.version, tx(r.name));
  const more = t('Всички бележки: {0}', `${appUrl()}/updates`);
  const highlights = r.highlights.map((h) => `• **${tx(h.title)}** — ${tx(h.body)}`);
  let description = `${tx(r.tagline)}\n\n${highlights.join('\n')}`;
  // Room is left for the sections (a big release has many highlights).
  description = cut(description, Math.min(LIMIT.description - more.length - 2, 3200));
  const fields: { name: string; value: string }[] = [];
  let used = title.length + description.length + more.length + 200;
  for (const section of r.sections.slice(0, LIMIT.fields)) {
    const name = cut(tx(section.title), 256);
    const value = cut(section.items.map((i) => `• ${tx(i)}`).join('\n'), LIMIT.fieldValue);
    if (used + name.length + value.length > LIMIT.total) break;
    used += name.length + value.length;
    fields.push({ name, value });
  }
  return {
    content: t('🚚 **Ново обновление в TransVerse — вече е в играта за всички!**'),
    embeds: [{ title, url: `${appUrl()}/updates`, description: `${description}\n\n${more}`, fields, color: BRAND, footer }],
  };
}

/** Worker: announcements that come from what is in the database (releases, events, battles, the newspaper). */
export async function announceFromGame(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('discord_bot', now)) return;

  // 1.1.4: the newest release that is live for everyone, if it is not older than two weeks —
  // also when the bot was down for days (it was three days before). Older ones are never posted late.
  const live = RELEASES.filter((r) => new Date(r.publishedAt) <= now).sort((x, y) => new Date(y.publishedAt).getTime() - new Date(x.publishedAt).getTime())[0];
  if (live && now.getTime() - new Date(live.publishedAt).getTime() <= RELEASE_ANNOUNCE_DAYS * 24 * HOUR) {
    // Remembered for good (the outbox forgets sent rows after two weeks).
    const [first] = await db.insert(jobState).values({ key: `announced:release:${live.version}`, value: { at: now.toISOString() } }).onConflictDoNothing().returning({ key: jobState.key });
    if (first) await announce(db, `release:${live.version}`, 'updates', () => releaseAnnouncement(live), now);
  }

  // Community events: started in the last two hours, settled in the last six.
  const started = await db.select().from(globalEvents).where(and(lte(globalEvents.startsAt, now), gte(globalEvents.startsAt, new Date(now.getTime() - 2 * HOUR))));
  for (const e of started) {
    await announce(db, `event:start:${e.id}`, 'events', () => ({
      embeds: [{ title: t('🎯 Започна ивент: {0}', e.name), url: `${appUrl()}/game/events`, description: e.description.slice(0, 1500), fields: [{ name: t('До'), value: `<t:${Math.floor(e.endsAt.getTime() / 1000)}:f>`, inline: true }], color: 0x22d3ee, footer }],
    }), now);
  }
  const settled = await db.select().from(globalEvents).where(and(gte(globalEvents.settledAt, new Date(now.getTime() - 6 * HOUR)), lte(globalEvents.settledAt, now)));
  for (const e of settled) {
    const ok = e.outcome === 'success';
    await announce(db, `event:end:${e.id}`, 'events', () => ({
      embeds: [{ title: ok ? t('🏆 Ивентът „{0}“ е изпълнен!', e.name) : t('Ивентът „{0}“ приключи', e.name), url: `${appUrl()}/game/events`, description: ok ? t('Наградите са раздадени на участниците.') : t('Целта не беше достигната ({0} от {1}).', int(e.progress), int(e.target)), color: ok ? 0x2fd27a : 0x9aa3b2, footer }],
    }), now);
  }

  // Company battles: this week's pairs (once they are all made), last week's results.
  const a = alias(organizations, 'a');
  const b = alias(organizations, 'b');
  const w = alias(organizations, 'w');
  const thisWeek = weekKey(now);
  const pairs = await db
    .select({ a: a.name, b: b.name, createdAt: companyBattles.createdAt })
    .from(companyBattles)
    .innerJoin(a, eq(a.id, companyBattles.aId))
    .innerJoin(b, eq(b.id, companyBattles.bId))
    .where(eq(companyBattles.weekKey, thisWeek));
  if (pairs.length && pairs.every((p) => now.getTime() - p.createdAt.getTime() > 20 * 60_000)) {
    await announce(db, `battles:pairs:${thisWeek}`, 'battles', () => ({
      embeds: [{ title: t('⚔️ Битките на компаниите тази седмица'), url: `${appUrl()}/game/company/missions`, description: pairs.slice(0, 25).map((p) => t('**{0}** срещу **{1}**', p.a, p.b)).join('\n') + (pairs.length > 25 ? t('\n…и още {0}', pairs.length - 25) : ''), color: 0xe04545, footer: { text: t('Броят се тоновете на членовете до неделя 24:00 · игрови данни') } }],
    }), now);
  }
  const lastWeek = weekKey(new Date(now.getTime() - 7 * 86_400_000));
  const results = await db
    .select({ a: a.name, b: b.name, aTons: companyBattles.aTons, bTons: companyBattles.bTons, winner: w.name, status: companyBattles.status })
    .from(companyBattles)
    .innerJoin(a, eq(a.id, companyBattles.aId))
    .innerJoin(b, eq(b.id, companyBattles.bId))
    .leftJoin(w, eq(w.id, companyBattles.winnerId))
    .where(eq(companyBattles.weekKey, lastWeek));
  if (results.length && results.every((r) => r.status === 'done')) {
    await announce(db, `battles:results:${lastWeek}`, 'battles', () => ({
      embeds: [{ title: t('🏁 Резултати от битките на компаниите'), description: results.slice(0, 25).map((r) => t('{0} · {1} {2} т — {3} т {4}', r.winner ? `🏆 **${r.winner}**` : t('🤝 Равенство'), r.a, dec(r.aTons), dec(r.bTons), r.b)).join('\n'), color: 0xf6c343, footer }],
    }), now);
  }

  // The weekly newspaper, when a new issue comes out.
  const issues = await db.select().from(newspapers).where(and(gte(newspapers.publishedAt, new Date(now.getTime() - 12 * HOUR)), lte(newspapers.publishedAt, now)));
  for (const n of issues) {
    const issue = n.content as NewsIssue;
    await announce(db, `news:${n.weekKey}`, 'news', () => ({
      embeds: [{
        title: t('📰 Седмичник TransVerse № {0}: {1}', n.number, headline(issue)),
        url: `${appUrl()}/game/news`,
        color: BRAND,
        fields: [
          { name: t('Седмицата'), value: t('{0} курса · {1} · {2} т', int(issue.totals.deliveries), km(issue.totals.km), int(issue.totals.tons)), inline: false },
          ...(issue.topDrivers[0] ? [{ name: t('Шофьор на седмицата'), value: t('{0} · {1} курса', issue.topDrivers[0].username, int(issue.topDrivers[0].value)), inline: true }] : []),
          ...(issue.topCompanies[0] ? [{ name: t('Компания на седмицата'), value: t('{0} · {1} курса', issue.topCompanies[0].name, int(issue.topCompanies[0].deliveries)), inline: true }] : []),
          ...(issue.longest ? [{ name: t('Най-дълъг курс'), value: `${issue.longest.username}: ${issue.longest.from} → ${issue.longest.to}, ${km(issue.longest.km)}`, inline: false }] : []),
        ],
        footer,
      }],
    }), now);
  }
}
