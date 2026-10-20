import { and, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { dailyState, DAILY_REWARDS } from '@/lib/game/daily';
import { featureDate, featureLive } from '@/lib/game/features';
import { dec, int, km, money } from '@/lib/format';
import { isStaff } from '@/server/auth/roles';
import type { DbOrTx } from '@/server/db/client';
import { cities, companies, contracts, organizations, users } from '@/server/db/schema';
import { companyShowcase } from '@/server/game/base-life';
import { membershipOf } from '@/server/game/membership';
import { topBases } from '@/server/game/plot';
import { companyLeaderboard, fleetView, leaderboard } from '@/server/game/queries';
import { playerCard } from '@/server/game/social';
import type { Embed } from './api';
import { appUrl, BRAND } from './config';

/** Slash commands of the bot (registered in the server by `registerCommands`). Names are Bulgarian. */
export const COMMANDS = [
  { name: 'профил', description: 'Профилът на играч в TransVerse (без име — твоят)', options: [{ type: 3, name: 'играч', description: 'Име в играта', required: false }] },
  { name: 'компания', description: 'Компания в TransVerse (без име — твоята)', options: [{ type: 3, name: 'име', description: 'Име или таг на компанията', required: false }] },
  {
    name: 'класация',
    description: 'Класациите на TransVerse',
    options: [{ type: 3, name: 'вид', description: 'Коя класация', required: false, choices: [
      { name: 'Сезон', value: 'season' },
      { name: 'Най-богати', value: 'wealth' },
      { name: 'Най-много курсове', value: 'deliveries' },
      { name: 'Компании', value: 'companies' },
      { name: 'Най-красиви бази', value: 'bases' },
    ] }],
  },
  { name: 'камиони', description: 'Твоите камиони: къде са и кога пристигат (нужен е свързан акаунт)' },
  { name: 'борса', description: 'Най-добре платените товари от град', options: [{ type: 3, name: 'град', description: 'Град (напр. София)', required: true }] },
  { name: 'дневна', description: 'Чака ли те дневната награда?' },
  { name: 'свързване', description: 'Свържи Discord с акаунта си в играта' },
  { name: 'помощ', description: 'Какво може ботът на TransVerse' },
] as const;

export interface CommandInput {
  name: string;
  options: Record<string, string>;
  discordUserId: string;
}
export interface CommandReply {
  content?: string;
  embeds?: Embed[];
  /** Only the player who asked sees it. */
  ephemeral?: boolean;
}

const linkHint = () => `Свържи акаунта си от **Настройки → Discord** в играта: ${appUrl()}/game/settings#discord`;
const footer = { text: 'TransVerse · игрови данни' };

async function linkedUser(db: DbOrTx, discordUserId: string) {
  const [u] = await db.select().from(users).where(and(eq(users.discordId, discordUserId), isNull(users.bannedAt)));
  return u ?? null;
}

/** Answers a slash command (read-only: nothing in the game changes from Discord). */
export async function runCommand(db: DbOrTx, input: CommandInput, now = new Date()): Promise<CommandReply> {
  const me = await linkedUser(db, input.discordUserId);
  // Before the release only the staff (linked) can use the bot, to test it.
  if (!featureLive('discord_bot', now, !!me && isStaff(me.role))) {
    const at = featureDate('discord_bot');
    return { ephemeral: true, content: `Ботът на TransVerse тръгва с обновлението${at ? ` на ${at.toLocaleDateString('bg-BG', { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' })}` : ''}. 🚚` };
  }
  switch (input.name) {
    case 'профил':
      return profile(db, input.options['играч'] ?? me?.username ?? null, me?.id ?? null, now);
    case 'компания':
      return company(db, input.options['име'] ?? null, me?.id ?? null);
    case 'класация':
      return ranking(db, (input.options['вид'] ?? 'season') as RankingKind, now);
    case 'камиони':
      return me ? trucks(db, me.id) : { ephemeral: true, content: `Не знам кой си в играта. ${linkHint()}` };
    case 'борса':
      return board(db, input.options['град'] ?? '', now);
    case 'дневна':
      return me ? daily(me) : { ephemeral: true, content: `Не знам кой си в играта. ${linkHint()}` };
    case 'свързване':
      return { ephemeral: true, content: me ? `Свързан си като **${me.username}**. Отвързваш от Настройки → Discord.` : linkHint() };
    default:
      return { ephemeral: true, embeds: [help()] };
  }
}

function help(): Embed {
  return {
    title: 'Ботът на TransVerse',
    color: BRAND,
    description: [
      '`/профил [играч]` — ниво, курсове, значки, компания',
      '`/компания [име]` — ниво, членове, база и витрина',
      '`/класация [вид]` — сезон, богатство, курсове, компании, бази',
      '`/камиони` — твоите камиони (свързан акаунт)',
      '`/борса град` — най-добрите товари от град',
      '`/дневна` — дневната награда',
      '`/свързване` — свържи Discord с играта',
    ].join('\n'),
    footer,
  };
}

async function profile(db: DbOrTx, username: string | null, viewerId: string | null, now: Date): Promise<CommandReply> {
  if (!username) return { ephemeral: true, content: `Напиши име на играч или свържи акаунта си. ${linkHint()}` };
  const card = await playerCard(db, viewerId ?? '00000000-0000-0000-0000-000000000000', username.trim(), now);
  if (!card) return { ephemeral: true, content: `Няма играч „${username}“.` };
  return {
    embeds: [{
      title: `${card.username}${card.vip ? ' · VIP' : ''}`,
      url: `${appUrl()}/game/players/${encodeURIComponent(card.username)}`,
      color: BRAND,
      thumbnail: { url: `${appUrl()}/api/players/${card.id}/avatar?v=${card.avatarVersion}` },
      fields: [
        { name: 'Ниво', value: `${card.level} (${Math.round(card.levelShare * 100)} %)`, inline: true },
        { name: 'Курсове', value: int(card.deliveries), inline: true },
        { name: 'Репутация', value: `${Math.floor(card.reputation)} · ${card.reputationTier}`, inline: true },
        { name: 'Компания', value: card.company ? `${card.company.name} [${card.company.tag}] · ${card.company.rank}` : '—', inline: true },
        { name: 'Приятели', value: int(card.friends), inline: true },
        { name: 'В играта', value: card.online ? 'онлайн' : card.lastSeen, inline: true },
        ...(card.badges.length ? [{ name: `Значки (${card.badges.length})`, value: card.badges.slice(0, 8).map((b) => b.label).join(' · ') }] : []),
      ],
      footer,
    }],
  };
}

async function company(db: DbOrTx, name: string | null, viewerId: string | null): Promise<CommandReply> {
  let org: typeof organizations.$inferSelect | undefined;
  if (name?.trim()) {
    const q = name.trim();
    [org] = await db.select().from(organizations).where(or(ilike(organizations.name, q), ilike(organizations.tag, q))).limit(1);
    if (!org) [org] = await db.select().from(organizations).where(ilike(organizations.name, `%${q.replace(/[%_]/g, '')}%`)).orderBy(desc(organizations.companyXp)).limit(1);
  } else if (viewerId) {
    org = (await membershipOf(db, viewerId))?.company;
  }
  if (!org) return { ephemeral: true, content: name ? `Няма компания „${name}“.` : `Напиши име на компания или свържи акаунта си. ${linkHint()}` };
  const [{ members = 0 } = {}] = await db.execute<{ members: number }>(sql`select count(*)::int as members from company_members where company_id = ${org.id}`).then((r) => r.rows);
  const [hq] = await db.select({ name: cities.nameBg }).from(cities).where(eq(cities.id, org.hqCityId));
  const show = await companyShowcase(db, org.id);
  return {
    embeds: [{
      title: `${org.name} [${org.tag}]`,
      url: `${appUrl()}/game/companies/${org.id}`,
      color: org.liveryColor ? parseInt(org.liveryColor.slice(1), 16) : BRAND,
      description: org.description?.slice(0, 300) || undefined,
      fields: [
        { name: 'Ниво', value: String(org.companyLevel), inline: true },
        { name: 'Членове', value: int(Number(members)), inline: true },
        { name: 'База', value: hq?.name ?? '—', inline: true },
        { name: 'Битки', value: `${show.battles} победи`, inline: true },
        { name: 'Проекти', value: String(show.projects), inline: true },
        { name: 'Нива на сградите', value: String(show.levels), inline: true },
        ...(show.latestBuilder?.username ? [{ name: 'Строител на седмицата', value: `${show.latestBuilder.username} · ${dec(show.latestBuilder.tons)} т` }] : []),
      ],
      footer,
    }],
  };
}

type RankingKind = 'season' | 'wealth' | 'deliveries' | 'companies' | 'bases';
const medal = (i: number) => ['🥇', '🥈', '🥉'][i] ?? `${i + 1}.`;

async function ranking(db: DbOrTx, kind: RankingKind, now: Date): Promise<CommandReply> {
  let title = '';
  let lines: string[] = [];
  if (kind === 'companies') {
    title = 'Компании';
    lines = (await companyLeaderboard(db, 10)).map((r, i) => `${medal(i)} **${r.company}** [${r.tag}] · ниво ${r.level} · ${r.members} членове`);
  } else if (kind === 'bases') {
    title = 'Най-красиви бази';
    lines = (await topBases(db, now, 10)).map((r, i) => `${medal(i)} **${r.name}** [${r.tag}] · 👍 ${r.likes} · ${r.buildings} нива`);
  } else {
    const { rows, season } = await leaderboard(db, kind, 10);
    title = kind === 'season' ? `Сезон${season ? ` „${season.name}“` : ''}` : kind === 'wealth' ? 'Най-богати' : 'Най-много курсове';
    lines = rows.map((r, i) => `${medal(i)} **${r.owner}** · ${kind === 'wealth' ? money(Number(r.value)) : kind === 'deliveries' ? `${int(Number(r.value))} курса` : `${int(Number(r.value))} т.`}`);
  }
  return { embeds: [{ title: `Класация · ${title}`, url: `${appUrl()}/game/leaderboards`, color: BRAND, description: lines.join('\n') || 'Още няма класирани.', footer }] };
}

async function trucks(db: DbOrTx, userId: string): Promise<CommandReply> {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return { ephemeral: true, content: 'Нямаш игрови акаунт.' };
  const fleet = await fleetView(db, account.id);
  const lines = fleet.vehicles.slice(0, 15).map((v) => {
    const d = v.delivery;
    const where = d?.etaAt ? `на път към ${d.destination.nameBg} · пристига <t:${Math.floor(new Date(d.etaAt).getTime() / 1000)}:R>` : `в ${v.city.nameBg}`;
    return `🚚 **${v.plate}** · ${v.model.name} · ${where} · ${Math.round(v.condition)} %`;
  });
  return { ephemeral: true, embeds: [{ title: 'Твоите камиони', url: `${appUrl()}/game/fleet`, color: BRAND, description: lines.join('\n') || 'Нямаш камиони.', footer }] };
}

async function board(db: DbOrTx, cityName: string, now: Date): Promise<CommandReply> {
  const q = cityName.trim();
  if (!q) return { ephemeral: true, content: 'Напиши град.' };
  const [city] = await db.select({ id: cities.id, name: cities.nameBg }).from(cities).where(or(ilike(cities.nameBg, q), ilike(cities.name, q))).orderBy(desc(cities.population)).limit(1);
  if (!city) return { ephemeral: true, content: `Няма град „${q}“ в играта.` };
  const dest = sql<string>`(select name_bg from cities c where c.id = ${contracts.destCityId})`;
  const rows = await db
    .select({ goods: contracts.goods, tons: contracts.weightTons, km: contracts.distanceKm, reward: contracts.rewardCents, dest, minLevel: contracts.minLevel })
    .from(contracts)
    .where(and(eq(contracts.originCityId, city.id), eq(contracts.status, 'open'), gt(contracts.expiresAt, now), isNull(contracts.constructionId), isNull(contracts.trade)))
    .orderBy(desc(contracts.rewardCents))
    .limit(8);
  const lines = rows.map((r) => `📦 **${r.goods}** ${dec(r.tons)} т → ${r.dest} · ${km(r.km)} · **${money(r.reward)}**${r.minLevel > 1 ? ` · ниво ${r.minLevel}+` : ''}`);
  return { embeds: [{ title: `Борса · ${city.name}`, url: `${appUrl()}/game/contracts`, color: BRAND, description: lines.join('\n') || 'В момента няма свободни товари оттук.', footer: { text: 'Поемането на товар става в играта · игрови данни' } }] };
}

function daily(me: typeof users.$inferSelect): CommandReply {
  const s = dailyState(me.loginStreak, me.dailyClaimKey, new Date());
  if (s.claimedToday) return { ephemeral: true, content: `✅ Днешната награда е взета. Серия: **${s.streak}** дни. Ела утре за ден ${(s.cycleDay % DAILY_REWARDS.length) + 1}!` };
  return { ephemeral: true, content: `🎁 Наградата за днес те чака — ден ${s.cycleDay}: **${money(s.reward.cents)}**${s.reward.coins ? ` + ${s.reward.coins} ТрансКоин` : ''}. Серия: ${s.streak} дни.\n${appUrl()}/game#daily` };
}
