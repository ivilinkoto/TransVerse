import { and, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { EVENT_TEMPLATES } from '@/lib/game/events';
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
import type { Row } from './ui';
import { appUrl, BRAND } from './config';

const MODERATE = String(1n << 40n);
const BAN = String(1n << 2n);
const MANAGE_GUILD = String(1n << 5n);
const user = { type: 6, name: 'потребител', description: 'Член на сървъра', required: true };
const reason = (required: boolean) => ({ type: 3, name: 'причина', description: 'Причина (вижда я и членът)', required, max_length: 500 });

/** Slash commands of the bot (registered in the server by `registerCommands`). Names are Bulgarian. */
export const COMMANDS = [
  { name: 'профил', description: 'Профилът на играч в TransVerse (без име — твоят)', options: [{ type: 3, name: 'играч', description: 'Име в играта', required: false }] },
  { name: 'компания', description: 'Компания в TransVerse (без име — твоята)', options: [{ type: 3, name: 'име', description: 'Име или таг на компанията', required: false }] },
  { name: 'участък', description: 'Снимка на базата на компания (без име — твоята)', options: [{ type: 3, name: 'компания', description: 'Име или таг на компанията', required: false }] },
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
  { name: 'курс', description: 'Пусни камион на курс: избираш камион и товар (свързан акаунт)' },
  { name: 'пазар', description: 'Стоката в складовете ти и къде да я продадеш (свързан акаунт)' },
  { name: 'търг', description: 'Търгът за специален товар — виж и дай оферта (свързан акаунт)' },
  { name: 'мисии', description: 'Мисиите ти и наградите за изпълнените (свързан акаунт)' },
  { name: 'покани', description: 'Покани член на сървъра в компанията си (свързан акаунт)', options: [{ type: 6, name: 'потребител', description: 'Кого каниш', required: true }] },
  { name: 'ранг', description: 'Нивото ти в сървъра (или на друг член)', options: [{ type: 6, name: 'потребител', description: 'Член на сървъра', required: false }] },
  { name: 'топ', description: 'Най-активните в сървъра' },
  { name: 'борса', description: 'Най-добре платените товари от град', options: [{ type: 3, name: 'град', description: 'Град (напр. София)', required: true }] },
  { name: 'дневна', description: 'Вземи дневната награда' },
  { name: 'ивент', description: 'Текущият ивент на общността и твоят принос' },
  { name: 'битка', description: 'Битката на компанията ти тази седмица' },
  { name: 'тикет', description: 'Отвори тикет към екипа на TransVerse' },
  { name: 'свързване', description: 'Свържи Discord с акаунта си в играта' },
  { name: 'помощ', description: 'Какво може ботът на TransVerse' },
  { name: 'предупреждение', description: 'Предупреди член на сървъра', default_member_permissions: MODERATE, options: [user, reason(true)] },
  {
    name: 'заглуши',
    description: 'Заглуши член на сървъра за определено време',
    default_member_permissions: MODERATE,
    options: [user, { type: 4, name: 'минути', description: 'За колко минути (до 28 дни)', required: true, min_value: 1, max_value: 40_320 }, reason(true), { type: 5, name: 'и-в-играта', description: 'Заглуши и чата в играта (свързан акаунт)', required: false }],
  },
  { name: 'бан', description: 'Бан от сървъра', default_member_permissions: BAN, options: [user, reason(true), { type: 5, name: 'изтрий-съобщенията', description: 'Изтрий съобщенията му от последното денонощие', required: false }] },
  { name: 'разбани', description: 'Свали бан', default_member_permissions: BAN, options: [user, reason(false)] },
  { name: 'наказания', description: 'Наказанията на член на сървъра', default_member_permissions: MODERATE, options: [user] },
  { name: 'екип-статистика', description: 'Тикети, отговори и наказания за последните 30 дни', default_member_permissions: MODERATE },
  {
    name: 'ивент-старт',
    description: 'Пусни ивент в играта от готов шаблон (администратор в играта)',
    default_member_permissions: MANAGE_GUILD,
    options: [
      { type: 3, name: 'шаблон', description: 'Кой ивент', required: true, choices: EVENT_TEMPLATES.slice(0, 25).map((t) => ({ name: t.name.slice(0, 100), value: t.id })) },
      { type: 4, name: 'часове', description: 'Колко часа (72 по подразбиране)', required: false, min_value: 1, max_value: 336 },
    ],
  },
  {
    name: 'раздаване',
    description: 'Раздаване на ТрансКоин в #раздавания',
    default_member_permissions: MANAGE_GUILD,
    options: [
      { type: 4, name: 'награда', description: 'ТрансКоин за всеки победител', required: true, min_value: 1, max_value: 100_000 },
      { type: 4, name: 'часове', description: 'Колко часа трае', required: true, min_value: 1, max_value: 336 },
      { type: 3, name: 'заглавие', description: 'Заглавие (напр. „Коледно раздаване“)', required: true, max_length: 100 },
      { type: 4, name: 'победители', description: 'Брой победители (1 по подразбиране)', required: false, min_value: 1, max_value: 20 },
    ],
  },
] as const;

export interface CommandInput {
  name: string;
  options: Record<string, string>;
  discordUserId: string;
}
export interface CommandReply {
  content?: string;
  embeds?: Embed[];
  components?: Row[];
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
    case 'участък':
      return plot(db, input.options['компания'] ?? null, me?.id ?? null);
    case 'свързване':
      return { ephemeral: true, content: me ? `Свързан си като **${me.username}**. Отвързваш от Настройки → Discord.` : linkHint() };
    default:
      return { ephemeral: true, content: 'Непозната команда — виж `/помощ`.' };
  }
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
      image: { url: `${appUrl()}/api/discord/card/player/${encodeURIComponent(card.username)}?v=${pictureVersion()}` },
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

/** A company by name or tag (exact first, then a part of the name), or the viewer's own. */
async function findCompany(db: DbOrTx, name: string | null, viewerId: string | null) {
  let org: typeof organizations.$inferSelect | undefined;
  if (name?.trim()) {
    const q = name.trim();
    [org] = await db.select().from(organizations).where(or(ilike(organizations.name, q), ilike(organizations.tag, q))).limit(1);
    if (!org) [org] = await db.select().from(organizations).where(ilike(organizations.name, `%${q.replace(/[%_]/g, '')}%`)).orderBy(desc(organizations.companyXp)).limit(1);
  } else if (viewerId) {
    org = (await membershipOf(db, viewerId))?.company;
  }
  return org ?? null;
}

/** Changes every ten minutes, so Discord fetches a fresh picture now and then. */
const pictureVersion = () => Math.floor(Date.now() / 600_000);

async function plot(db: DbOrTx, name: string | null, viewerId: string | null): Promise<CommandReply> {
  const org = await findCompany(db, name, viewerId);
  if (!org) return { ephemeral: true, content: name ? `Няма компания „${name}“.` : `Напиши име на компания или свържи акаунта си. ${linkHint()}` };
  return {
    embeds: [{
      title: `🏗️ Базата на ${org.name}${org.tag ? ` [${org.tag}]` : ''}`,
      url: `${appUrl()}/game/companies/${org.id}`,
      color: org.liveryColor ? parseInt(org.liveryColor.slice(1), 16) : BRAND,
      image: { url: `${appUrl()}/api/discord/card/plot/${org.id}?v=${pictureVersion()}` },
      footer,
    }],
  };
}

async function company(db: DbOrTx, name: string | null, viewerId: string | null): Promise<CommandReply> {
  const org = await findCompany(db, name, viewerId);
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
