import { and, eq, gte, lte } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { featureLive } from '@/lib/game/features';
import { dec, int, km, money } from '@/lib/format';
import { weekKey } from '@/lib/game/leagues';
import { headline, type NewsIssue } from '@/lib/game/news';
import { RELEASES } from '@/lib/game/releases';
import type { Database, DbOrTx } from '@/server/db/client';
import { companyBattles, globalEvents, newspapers, organizations } from '@/server/db/schema';
import { appUrl, BRAND, discordConfig } from './config';
import { announce } from './outbox';
import { button, rows, STYLE } from './ui';

const HOUR = 3_600_000;
const footer = { text: 'TransVerse · игрови данни' };

/** A building finished (from finishConstructions). */
export async function announceBuild(db: DbOrTx, buildId: string, company: { name: string; tag: string | null; id: string }, label: string, level: number, now: Date) {
  if (!featureLive('discord_bot', now)) return;
  await announce(db, `build:${buildId}`, 'builds', {
    embeds: [{ title: level > 1 ? `🏗️ ${company.name} вдигна „${label}“ на ниво ${level}` : `🏗️ ${company.name} построи „${label}“`, url: `${appUrl()}/game/companies/${company.id}`, color: BRAND, footer }],
    // "Браво" is a like for the base in the game (market.ts).
    components: rows(button('Браво', `cheer:${company.id}`, STYLE.success, '👍')),
  }, now);
}

/** "Строител на седмицата" (from awardBuildersOfWeek). */
export async function announceBuilderOfWeek(db: DbOrTx, key: string, company: string, username: string, tons: number, rewardCents: number, now: Date) {
  if (!featureLive('discord_bot', now)) return;
  await announce(db, `builder-week:${key}:${company}`, 'builds', {
    embeds: [{ title: `👷 Строител на седмицата в „${company}“: ${username}`, description: `${dec(tons)} т материали за базата${rewardCents ? ` · награда ${money(rewardCents)}` : ''}`, color: 0xf6c343, footer }],
  }, now);
}

/** Worker: announcements that come from what is in the database (releases, events, battles, the newspaper). */
export async function announceFromGame(db: Database, now = new Date()) {
  if (!discordConfig().bot || !featureLive('discord_bot', now)) return;

  // A release that went live in the last three days.
  for (const r of RELEASES) {
    const at = new Date(r.publishedAt);
    if (at > now || now.getTime() - at.getTime() > 72 * HOUR) continue;
    await announce(db, `release:${r.version}`, 'updates', {
      content: '🚚 **Ново обновление в TransVerse!**',
      embeds: [{
        title: `Обновление ${r.version} — „${r.name}“`,
        url: `${appUrl()}/updates`,
        description: `${r.tagline}\n\n${r.highlights.slice(0, 10).map((h) => `• **${h.title}** — ${h.body}`).join('\n').slice(0, 3800)}`,
        color: BRAND,
        footer,
      }],
    }, now);
  }

  // Community events: started in the last two hours, settled in the last six.
  const started = await db.select().from(globalEvents).where(and(lte(globalEvents.startsAt, now), gte(globalEvents.startsAt, new Date(now.getTime() - 2 * HOUR))));
  for (const e of started) {
    await announce(db, `event:start:${e.id}`, 'events', {
      embeds: [{ title: `🎯 Започна ивент: ${e.name}`, url: `${appUrl()}/game/events`, description: e.description.slice(0, 1500), fields: [{ name: 'До', value: `<t:${Math.floor(e.endsAt.getTime() / 1000)}:f>`, inline: true }], color: 0x22d3ee, footer }],
    }, now);
  }
  const settled = await db.select().from(globalEvents).where(and(gte(globalEvents.settledAt, new Date(now.getTime() - 6 * HOUR)), lte(globalEvents.settledAt, now)));
  for (const e of settled) {
    const ok = e.outcome === 'success';
    await announce(db, `event:end:${e.id}`, 'events', {
      embeds: [{ title: ok ? `🏆 Ивентът „${e.name}“ е изпълнен!` : `Ивентът „${e.name}“ приключи`, url: `${appUrl()}/game/events`, description: ok ? 'Наградите са раздадени на участниците.' : `Целта не беше достигната (${int(e.progress)} от ${int(e.target)}).`, color: ok ? 0x2fd27a : 0x9aa3b2, footer }],
    }, now);
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
    await announce(db, `battles:pairs:${thisWeek}`, 'battles', {
      embeds: [{ title: '⚔️ Битките на компаниите тази седмица', url: `${appUrl()}/game/company/missions`, description: pairs.slice(0, 25).map((p) => `**${p.a}** срещу **${p.b}**`).join('\n') + (pairs.length > 25 ? `\n…и още ${pairs.length - 25}` : ''), color: 0xe04545, footer: { text: 'Броят се тоновете на членовете до неделя 24:00 · игрови данни' } }],
    }, now);
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
    await announce(db, `battles:results:${lastWeek}`, 'battles', {
      embeds: [{ title: '🏁 Резултати от битките на компаниите', description: results.slice(0, 25).map((r) => `${r.winner ? `🏆 **${r.winner}**` : '🤝 Равенство'} · ${r.a} ${dec(r.aTons)} т — ${dec(r.bTons)} т ${r.b}`).join('\n'), color: 0xf6c343, footer }],
    }, now);
  }

  // The weekly newspaper, when a new issue comes out.
  const issues = await db.select().from(newspapers).where(and(gte(newspapers.publishedAt, new Date(now.getTime() - 12 * HOUR)), lte(newspapers.publishedAt, now)));
  for (const n of issues) {
    const issue = n.content as NewsIssue;
    await announce(db, `news:${n.weekKey}`, 'news', {
      embeds: [{
        title: `📰 Седмичник TransVerse № ${n.number}: ${headline(issue)}`,
        url: `${appUrl()}/game/news`,
        color: BRAND,
        fields: [
          { name: 'Седмицата', value: `${int(issue.totals.deliveries)} курса · ${km(issue.totals.km)} · ${int(issue.totals.tons)} т`, inline: false },
          ...(issue.topDrivers[0] ? [{ name: 'Шофьор на седмицата', value: `${issue.topDrivers[0].username} · ${int(issue.topDrivers[0].value)} курса`, inline: true }] : []),
          ...(issue.topCompanies[0] ? [{ name: 'Компания на седмицата', value: `${issue.topCompanies[0].name} · ${int(issue.topCompanies[0].deliveries)} курса`, inline: true }] : []),
          ...(issue.longest ? [{ name: 'Най-дълъг курс', value: `${issue.longest.username}: ${issue.longest.from} → ${issue.longest.to}, ${km(issue.longest.km)}`, inline: false }] : []),
        ],
        footer,
      }],
    }, now);
  }
}
