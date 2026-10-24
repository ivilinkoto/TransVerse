import { and, asc, desc, eq, gt, gte, isNotNull, lt, sql } from 'drizzle-orm';
import { int, money } from '@/lib/format';
import { periodWindow } from '@/lib/game/missions';
import type { Database } from '@/server/db/client';
import { companyMembers, discordCompanyActivity, jobState, organizations, treasuryEntries, users } from '@/server/db/schema';
import { postTreasury, TREASURY_LABELS, type TreasuryCategory } from '@/server/game/finance';
import { featureLive } from '@/lib/game/features';
import { appUrl, BRAND, discordConfig } from './config';
import { reportToken } from './map-token';
import { announce, enqueue } from './outbox';
import { t } from '@/i18n/t';

/**
 * Companies in Discord: the most active company channel of the week (a prize
 * into its treasury), a welcome for new members in the company channel and a
 * weekly treasury report there. Game data.
 */

export const ACTIVITY = { prizeCents: 2_000_00, minMessages: 20 } as const;
const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
const lastWeek = (now: Date) => {
  const w = periodWindow('weekly', new Date(now.getTime() - 7 * 86_400_000));
  return { key: w.key, from: new Date(w.endsAt.getTime() - 7 * 86_400_000), to: w.endsAt };
};

/** The gateway: a message in a company's channel counts for its week. */
export async function countCompanyMessage(db: Database, channelId: string, now = new Date()) {
  const [org] = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.discordChannelId, channelId));
  if (!org) return false;
  const week = periodWindow('weekly', now).key;
  await db
    .insert(discordCompanyActivity)
    .values({ organizationId: org.id, weekKey: week, messages: 1 })
    .onConflictDoUpdate({ target: [discordCompanyActivity.organizationId, discordCompanyActivity.weekKey], set: { messages: sql`${discordCompanyActivity.messages} + 1` } });
  return true;
}

/** Worker, Monday from 10:00: last week's most active company channel gets its prize (once). */
export async function awardMostActive(db: Database, now = new Date()) {
  if (!discordConfig().bot || periodWindow('weekly', now).endsAt.getTime() - now.getTime() < 6 * 86_400_000 || sofiaHour(now) < 10) return null;
  const w = lastWeek(now);
  const [top] = await db
    .select({ id: organizations.id, name: organizations.name, tag: organizations.tag, channelId: organizations.discordChannelId, messages: discordCompanyActivity.messages })
    .from(discordCompanyActivity)
    .innerJoin(organizations, eq(organizations.id, discordCompanyActivity.organizationId))
    .where(and(eq(discordCompanyActivity.weekKey, w.key), gte(discordCompanyActivity.messages, ACTIVITY.minMessages)))
    .orderBy(desc(discordCompanyActivity.messages))
    .limit(1);
  if (!top) return null;
  const paid = await db.transaction((tx) => postTreasury(tx, top.id, [{ category: 'discord_activity', amountCents: ACTIVITY.prizeCents, description: t('Най-активна компания в Discord ({0})', w.key), idempotencyKey: `discord-activity:${w.key}` }]));
  if (!paid) return null;
  await announce(db, `most-active:${w.key}`, 'rankings', {
    ping: false,
    embeds: [{ title: t('💬 Най-активна компания в Discord: {0}{1}', top.name, top.tag ? ` [${top.tag}]` : ''), url: `${appUrl()}/game/companies/${top.id}`, description: t('{0} съобщения в канала на компанията миналата седмица · {1} в касата.', int(top.messages), money(ACTIVITY.prizeCents)), color: BRAND, footer: { text: t('Брои се каналът на компанията в Discord · игрови данни') } }],
  }, now);
  if (top.channelId) await enqueue(db, `most-active-company:${w.key}`, `msg:${top.channelId}`, { embeds: [{ color: 0x2fd27a, description: t('🏆 Вие сте най-активната компания в Discord миналата седмица! **{0}** влязоха в касата.', money(ACTIVITY.prizeCents)) }] }, now);
  return top.id;
}

/** Worker: a welcome in the company channel for everyone who joined since the last run. */
export async function welcomeCompanyMembers(db: Database, now = new Date()) {
  if (!discordConfig().bot) return 0;
  const [cur] = await db.select().from(jobState).where(eq(jobState.key, 'discord-company-join-cursor'));
  const from = cur ? new Date(String((cur.value as { at: string }).at)) : now;
  const rows = await db
    .select({ userId: users.id, username: users.username, discordId: users.discordId, joinedAt: companyMembers.joinedAt, channelId: organizations.discordChannelId, company: organizations.name })
    .from(companyMembers)
    .innerJoin(users, eq(users.id, companyMembers.userId))
    .innerJoin(organizations, eq(organizations.id, companyMembers.companyId))
    .where(and(gt(companyMembers.joinedAt, from), lt(companyMembers.joinedAt, now), isNotNull(organizations.discordChannelId)))
    .orderBy(asc(companyMembers.joinedAt))
    .limit(50);
  for (const r of rows) {
    await enqueue(db, `company-welcome:${r.userId}:${r.joinedAt.getTime()}`, `msg:${r.channelId}`, {
      content: r.discordId ? `<@${r.discordId}>` : undefined,
      allowed_mentions: { parse: [], users: r.discordId ? [r.discordId] : [] },
      embeds: [{ color: 0x2fd27a, description: t('👋 **{0}** се присъедини към „{1}“. Добре дошъл в екипа!{2}', r.username, r.company, r.discordId ? '' : t('\n*(Без свързан Discord — ще вижда канала, щом свърже акаунта си.)*')) }],
    }, now);
  }
  const next = rows.length === 50 ? rows.at(-1)!.joinedAt : now;
  await db.insert(jobState).values({ key: 'discord-company-join-cursor', value: { at: next.toISOString() } }).onConflictDoUpdate({ target: jobState.key, set: { value: { at: next.toISOString() }, updatedAt: now } });
  return rows.length;
}

/** Worker, Monday from 9:00: last week's treasury in every company channel (once per week). */
export async function treasuryReports(db: Database, now = new Date()) {
  if (!discordConfig().bot || periodWindow('weekly', now).endsAt.getTime() - now.getTime() < 6 * 86_400_000 || sofiaHour(now) < 9) return 0;
  const w = lastWeek(now);
  const orgs = await db.select({ id: organizations.id, name: organizations.name, channelId: organizations.discordChannelId, balance: organizations.treasuryCents }).from(organizations).where(isNotNull(organizations.discordChannelId));
  for (const o of orgs) {
    const rows = await db
      .select({ category: treasuryEntries.category, total: sql<number>`sum(${treasuryEntries.amountCents})::bigint` })
      .from(treasuryEntries)
      .where(and(eq(treasuryEntries.organizationId, o.id), gte(treasuryEntries.createdAt, w.from), lt(treasuryEntries.createdAt, w.to)))
      .groupBy(treasuryEntries.category);
    if (!rows.length) continue;
    const income = rows.filter((r) => Number(r.total) > 0).sort((a, b) => Number(b.total) - Number(a.total));
    const spent = rows.filter((r) => Number(r.total) < 0).sort((a, b) => Number(a.total) - Number(b.total));
    const label = (c: string) => TREASURY_LABELS[c as TreasuryCategory] ?? c;
    const sum = (list: typeof rows) => list.reduce((s, r) => s + Number(r.total), 0);
    await enqueue(db, `treasury-report:${o.id}:${w.key}`, `msg:${o.channelId}`, {
      embeds: [{
        title: t('💰 Касата на „{0}“ миналата седмица', o.name),
        url: `${appUrl()}/game/company`,
        color: BRAND,
        fields: [
          { name: t('Приходи · {0}', money(sum(income))), value: income.map((r) => `${label(r.category)}: ${money(Number(r.total))}`).join('\n') || '—', inline: true },
          { name: t('Разходи · {0}', money(-sum(spent))), value: spent.map((r) => `${label(r.category)}: ${money(-Number(r.total))}`).join('\n') || '—', inline: true },
          { name: t('В касата сега'), value: money(o.balance) },
        ],
        footer: { text: t('Нетно: {0} · игрови данни', money(sum(rows))) },
        // The week in a picture (v1.4).
        ...(featureLive('company_report', now) ? { image: { url: `${appUrl()}/api/discord/card/report/${o.id}?f=${w.from.getTime()}&k=${reportToken(o.id, w.from.getTime())}` } } : {}),
      }],
    }, now);
  }
  return orgs.length;
}
