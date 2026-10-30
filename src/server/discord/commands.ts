import { and, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm';
import { ALL_EVENT_TEMPLATES } from '@/lib/game/events';
import { featureDate, featureLive } from '@/lib/game/features';
import { dec, int, km, money, moneyPrecise } from '@/lib/format';
import { testsUnreleased } from '@/server/auth/roles';
import type { DbOrTx } from '@/server/db/client';
import { allianceMembers, alliances, cities, companies, contracts, organizations, routes, users } from '@/server/db/schema';
import { allianceHall, allianceWeekView, playerAlliance } from '@/server/game/alliances';
import { companyShowcase } from '@/server/game/base-life';
import { membershipOf } from '@/server/game/membership';
import { topBases } from '@/server/game/plot';
import { companyLeaderboard, fleetView, leaderboard } from '@/server/game/queries';
import { playerCard } from '@/server/game/social';
import { playerCareer } from '@/server/game/career';
import { laneRecordsView } from '@/server/game/community';
import { albumOf } from '@/server/game/competition';
import { openBigConvoys, weeklyChallenge } from '@/server/game/challenges';
import { openConvoysList } from '@/server/game/convoys';
import { cupView } from '@/server/game/tournament';
import { approximateProvider, routeOpen } from '@/server/geo/routing';
import { countryOpen, GAME_COUNTRIES, type GameCountry } from '@/lib/geo/scope';
import { countryInfo, findCountry } from '@/server/game/countries';
import { BIG_CONVOY, WEEKLY_CHALLENGE } from '@/lib/game/challenges';
import type { Embed } from './api';
import type { Row } from './ui';
import { appUrl, BRAND } from './config';
import { t as tr, intlLocale } from '@/i18n/t';
import { remindCommand } from './remind';

const MODERATE = String(1n << 40n);
const BAN = String(1n << 2n);
const MANAGE_GUILD = String(1n << 5n);
const user = { type: 6, name: 'потребител', description: 'Член на сървъра', required: true };
const reason = (required: boolean) => ({ type: 3, name: tr('причина'), description: tr('Причина (вижда я и членът)'), required, max_length: 500 });

/** Slash commands of the bot (registered in the server by `registerCommands`). Names are Bulgarian. */
export const COMMANDS = [
  { name: 'профил', description: 'Профилът на играч в TransVerse (без име — твоят)', options: [{ type: 3, name: 'играч', description: 'Име в играта', required: false }] },
  { name: 'компания', description: 'Компания в TransVerse (без име — твоята)', options: [{ type: 3, name: 'име', description: 'Име или таг на компанията', required: false }] },
  { name: 'статистика', description: 'Картичка на компания: курсове, сезон, медали, постижения (без име — твоята)', options: [{ type: 3, name: 'компания', description: 'Име или таг на компанията', required: false }] },
  { name: 'сравни', description: 'Ти срещу друг играч: курсове, км, тонове, навреме, държави, постижения', options: [{ type: 3, name: 'играч', description: 'Име в играта', required: true }] },
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
  { name: 'напомни', description: 'Лично съобщение, когато камионът ти пристигне (свързан акаунт)', options: [{ type: 3, name: 'камион', description: 'Номер или име (без — всички на курс)', required: false, max_length: 30 }] },
  { name: 'курс', description: 'Пусни камион на курс: избираш камион и товар (свързан акаунт)' },
  { name: 'пазар', description: 'Стоката в складовете ти и къде да я продадеш (свързан акаунт)' },
  { name: 'търг', description: 'Търгът за специален товар — виж и дай оферта (свързан акаунт)' },
  { name: 'мисии', description: 'Мисиите ти и наградите за изпълнените (свързан акаунт)' },
  { name: 'покани', description: 'Покани член на сървъра в компанията си (свързан акаунт)', options: [{ type: 6, name: 'потребител', description: 'Кого каниш', required: true }] },
  { name: 'ранг', description: 'Нивото ти в сървъра (или на друг член)', options: [{ type: 6, name: 'потребител', description: 'Член на сървъра', required: false }] },
  { name: 'топ', description: 'Най-активните в сървъра' },
  { name: 'карта', description: 'Картинка с камионите ти на картата (свързан акаунт)' },
  { name: 'конвой', description: 'Обяви в #конвои курса, с който току-що тръгна — другите се включват (свързан акаунт)' },
  { name: 'финанси', description: 'Приходи, нетно и най-добрите линии за последните 7 дни (свързан акаунт)' },
  { name: 'дуел', description: 'Дуел 1 срещу 1: кой ще превози повече тонове за седмица (без член — твоите дуели)', options: [{ type: 6, name: 'потребител', description: 'Кого предизвикваш', required: false }] },
  { name: 'пропуск', description: 'Сезонният пропуск: ниво и наградите, които те чакат (свързан акаунт)' },
  { name: 'борса', description: 'Най-добре платените товари от град', options: [{ type: 3, name: 'град', description: 'Град (напр. София)', required: true }] },
  { name: 'дневна', description: 'Вземи дневната награда' },
  { name: 'рекорди', description: 'Рекордите на линиите този месец (с име — на играч)', options: [{ type: 3, name: 'играч', description: 'Име в играта', required: false }] },
  { name: 'камион', description: 'Картичка с твой камион — боя, ливрея, части (свързан акаунт)', options: [{ type: 3, name: 'номер', description: 'Регистрационен номер (без него — последно купеният)', required: false }] },
  { name: 'съюз', description: 'Съюзът на компанията ти (или съюз по име): компании, седмица и съюзна база', options: [{ type: 3, name: 'име', description: 'Име на съюза', required: false }] },
  { name: 'конвой-голям', description: 'Обявените конвои, в които има място (голям конвой — до 5 камиона)' },
  { name: 'турнир', description: 'Пролетната купа: кръгът, двойките и километрите' },
  {
    name: 'маршрут',
    description: 'Път с камион между два града: километри, време, граници, тол',
    options: [{ type: 3, name: 'от', description: 'Начален град', required: true }, { type: 3, name: 'до', description: 'Краен град', required: true }],
  },
  { name: 'държава', description: 'Държава в играта: дизел днес, тол, забрани, празник, крал и най-добрите товари', options: [{ type: 3, name: 'име', description: 'Държава (напр. Италия)', required: true }] },
  { name: 'предизвикателство', description: 'Предизвикателството на седмицата: мярката, първите и твоето място' },
  { name: 'албум', description: 'Колекцията от градове (без име — твоята)', options: [{ type: 3, name: 'играч', description: 'Име в играта', required: false }] },
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
      { type: 3, name: 'шаблон', description: 'Кой ивент', required: true, choices: ALL_EVENT_TEMPLATES.slice(0, 25).map((t) => ({ name: t.name.slice(0, 100), value: t.id })) },
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
  // 1.1.3.4: a message command (right click on a message → Apps → Преведи).
  { name: 'Преведи', type: 3 },
  {
    name: 'новина',
    description: 'Новина от екипа в #новини',
    default_member_permissions: MANAGE_GUILD,
    options: [
      { type: 3, name: 'заглавие', description: 'Заглавие', required: true, max_length: 200 },
      { type: 3, name: 'текст', description: 'Текстът (нов ред: \\n)', required: true, max_length: 3800 },
    ],
  },
  {
    name: 'анкета',
    description: 'Анкета от екипа в #анкети',
    default_member_permissions: MANAGE_GUILD,
    options: [
      { type: 3, name: 'въпрос', description: 'Въпросът', required: true, max_length: 200 },
      { type: 3, name: 'отговори', description: 'От 2 до 5 отговора, разделени с „;“', required: true, max_length: 400 },
      { type: 4, name: 'часове', description: 'Колко часа (24 по подразбиране)', required: false, min_value: 1, max_value: 168 },
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

const linkHint = () => tr('Свържи акаунта си от **Настройки → Discord** в играта: {0}/game/settings#discord', appUrl());
const footer = { text: 'TransVerse · игрови данни' };

async function linkedUser(db: DbOrTx, discordUserId: string) {
  const [u] = await db.select().from(users).where(and(eq(users.discordId, discordUserId), isNull(users.bannedAt)));
  return u ?? null;
}

/** Answers a slash command (read-only: nothing in the game changes from Discord). */
export async function runCommand(db: DbOrTx, input: CommandInput, now = new Date()): Promise<CommandReply> {
  const me = await linkedUser(db, input.discordUserId);
  // Before the release only the staff (linked) can use the bot, to test it.
  if (!featureLive('discord_bot', now, !!me && testsUnreleased(me))) {
    const at = featureDate('discord_bot');
    return { ephemeral: true, content: tr('Ботът на TransVerse тръгва с обновлението{0}. 🚚', at ? tr(' на {0}', at.toLocaleDateString(intlLocale(), { timeZone: 'Europe/Sofia', day: 'numeric', month: 'long' })) : '') };
  }
  switch (input.name) {
    case 'профил':
      return profile(db, input.options['играч'] ?? me?.username ?? null, me?.id ?? null, now);
    case 'компания':
      return company(db, input.options['име'] ?? null, me?.id ?? null);
    case 'статистика':
      if (!featureLive('discord_plus', now)) return { ephemeral: true, content: tr('Командата идва със следващото обновление.') };
      return companyCard(db, input.options['компания'] ?? null, me?.id ?? null);
    case 'сравни':
      if (!featureLive('discord_plus', now)) return { ephemeral: true, content: tr('Командата идва със следващото обновление.') };
      return compare(db, me?.id ?? null, me?.username ?? null, input.options['играч'] ?? '', now);
    case 'класация':
      return ranking(db, (input.options['вид'] ?? 'season') as RankingKind, now);
    case 'камиони':
      return me ? trucks(db, me.id) : { ephemeral: true, content: tr('Не знам кой си в играта. {0}', linkHint()) };
    case 'напомни':
      return me ? remindCommand(db, me.id, input.discordUserId, input.options['камион'] ?? null, now) : { ephemeral: true, content: tr('Не знам кой си в играта. {0}', linkHint()) };
    case 'борса':
      return board(db, input.options['град'] ?? '', now);
    case 'участък':
      return plot(db, input.options['компания'] ?? null, me?.id ?? null);
    case 'рекорди':
      return records(db, input.options['играч'] ?? null, now);
    case 'камион':
      return me ? truckCard(db, me.id, input.options['номер'] ?? null, now) : { ephemeral: true, content: tr('Не знам кой си в играта. {0}', linkHint()) };
    case 'съюз':
      return alliance(db, input.options['име'] ?? null, me?.id ?? null, now);
    case 'конвой-голям':
      return bigConvoys(db, now);
    case 'турнир':
      return cup(db, now);
    case 'маршрут':
      return route(db, input.options['от'] ?? '', input.options['до'] ?? '', now);
    case 'държава':
      return country(db, input.options['име'] ?? '', now);
    case 'предизвикателство':
      return challenge(db, me?.id ?? null, now);
    case 'албум':
      return album(db, input.options['играч'] ?? me?.username ?? null, now);
    case 'свързване':
      return { ephemeral: true, content: me ? tr('Свързан си като **{0}**. Отвързваш от Настройки → Discord.', me.username) : linkHint() };
    default:
      return { ephemeral: true, content: tr('Непозната команда — виж `/помощ`.') };
  }
}

async function profile(db: DbOrTx, username: string | null, viewerId: string | null, now: Date): Promise<CommandReply> {
  if (!username) return { ephemeral: true, content: tr('Напиши име на играч или свържи акаунта си. {0}', linkHint()) };
  const card = await playerCard(db, viewerId ?? '00000000-0000-0000-0000-000000000000', username.trim(), now);
  if (!card) return { ephemeral: true, content: tr('Няма играч „{0}“.', username) };
  return {
    embeds: [{
      title: `${card.username}${card.vip ? ' · VIP' : ''}`,
      url: `${appUrl()}/game/players/${encodeURIComponent(card.username)}`,
      color: BRAND,
      image: { url: `${appUrl()}/api/discord/card/player/${encodeURIComponent(card.username)}?v=${pictureVersion()}` },
      fields: [
        { name: tr('Ниво'), value: `${card.level} (${Math.round(card.levelShare * 100)} %)`, inline: true },
        { name: tr('Курсове'), value: int(card.deliveries), inline: true },
        { name: tr('Репутация'), value: `${Math.floor(card.reputation)} · ${card.reputationTier}`, inline: true },
        { name: tr('Компания'), value: card.company ? `${card.company.name} [${card.company.tag}] · ${card.company.rank}` : '—', inline: true },
        { name: tr('Приятели'), value: int(card.friends), inline: true },
        { name: tr('В играта'), value: card.online ? tr('онлайн') : card.lastSeen, inline: true },
        ...(card.badges.length ? [{ name: tr('Значки ({0})', card.badges.length), value: card.badges.slice(0, 8).map((b) => b.label).join(' · ') }] : []),
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

/** 1.1.3.4: /статистика — the public card of a company as a picture. */
async function companyCard(db: DbOrTx, name: string | null, viewerId: string | null): Promise<CommandReply> {
  const org = await findCompany(db, name, viewerId);
  if (!org) return { ephemeral: true, content: name ? tr('Няма компания „{0}“.', name) : tr('Напиши име на компания или свържи акаунта си. {0}', linkHint()) };
  return {
    embeds: [{
      title: `📊 ${org.name}${org.tag ? ` [${org.tag}]` : ''}`,
      url: `${appUrl()}/game/companies/${org.id}`,
      color: org.liveryColor ? parseInt(org.liveryColor.slice(1), 16) : BRAND,
      image: { url: `${appUrl()}/api/discord/card/company/${org.id}?v=${pictureVersion()}` },
      footer,
    }],
  };
}

/** 1.1.3.4: /сравни — you against another player (no money), like "Сравни се" in the game. */
async function compare(db: DbOrTx, meId: string | null, meName: string | null, other: string, now: Date): Promise<CommandReply> {
  if (!meId || !meName) return { ephemeral: true, content: tr('Не знам кой си в играта. {0}', linkHint()) };
  const card = await playerCard(db, meId, other.trim(), now);
  if (!card) return { ephemeral: true, content: tr('Няма играч „{0}“.', other) };
  if (card.id === meId) return { ephemeral: true, content: tr('Избери друг играч — със себе си винаги е равно. 🙂') };
  const [a, b] = await Promise.all([playerCareer(db, meId), playerCareer(db, card.id)]);
  if (!a || !b) return { ephemeral: true, content: tr('Няма данни за сравнение.') };
  const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
  const rows: [string, number, number, (v: number) => string][] = [
    [tr('Курсове'), a.trips, b.trips, (v) => int(v)],
    [tr('Километри'), a.km, b.km, (v) => km(v)],
    [tr('Тонове'), a.tons, b.tons, (v) => tr('{0} т', int(v))],
    [tr('Навреме'), a.onTimeShare ?? -1, b.onTimeShare ?? -1, (v) => pct(v < 0 ? null : v)],
    [tr('Държави'), a.countries, b.countries, (v) => int(v)],
    [tr('Постижения'), a.achievements, b.achievements, (v) => int(v)],
  ];
  const wins = rows.filter(([, x, y]) => x > y).length;
  const losses = rows.filter(([, x, y]) => y > x).length;
  const mark = (x: number, y: number) => (x > y ? '**' : '');
  return {
    embeds: [{
      title: tr('⚖️ {0} срещу {1}', meName, card.username),
      url: `${appUrl()}/game/players/${encodeURIComponent(card.username)}/compare`,
      color: BRAND,
      description: wins > losses ? tr('{0} води в {1} от {2} показателя.', meName, wins, rows.length) : wins < losses ? tr('{0} води в {1} от {2} показателя.', card.username, losses, rows.length) : tr('Равни сте — следващият курс решава.'),
      fields: rows.map(([label, x, y, show]) => ({ name: label, value: `${mark(x, y)}${show(x)}${mark(x, y)} · ${mark(y, x)}${show(y)}${mark(y, x)}`, inline: true })),
      footer,
    }],
  };
}

async function plot(db: DbOrTx, name: string | null, viewerId: string | null): Promise<CommandReply> {
  const org = await findCompany(db, name, viewerId);
  if (!org) return { ephemeral: true, content: name ? tr('Няма компания „{0}“.', name) : tr('Напиши име на компания или свържи акаунта си. {0}', linkHint()) };
  return {
    embeds: [{
      title: tr('🏗️ Базата на {0}{1}', org.name, org.tag ? ` [${org.tag}]` : ''),
      url: `${appUrl()}/game/companies/${org.id}`,
      color: org.liveryColor ? parseInt(org.liveryColor.slice(1), 16) : BRAND,
      image: { url: `${appUrl()}/api/discord/card/plot/${org.id}?v=${pictureVersion()}` },
      footer,
    }],
  };
}

async function company(db: DbOrTx, name: string | null, viewerId: string | null): Promise<CommandReply> {
  const org = await findCompany(db, name, viewerId);
  if (!org) return { ephemeral: true, content: name ? tr('Няма компания „{0}“.', name) : tr('Напиши име на компания или свържи акаунта си. {0}', linkHint()) };
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
        { name: tr('Ниво'), value: String(org.companyLevel), inline: true },
        { name: tr('Членове'), value: int(Number(members)), inline: true },
        { name: tr('База'), value: hq?.name ?? '—', inline: true },
        { name: tr('Битки'), value: tr('{0} победи', show.battles), inline: true },
        { name: tr('Проекти'), value: String(show.projects), inline: true },
        { name: tr('Нива на сградите'), value: String(show.levels), inline: true },
        ...(show.latestBuilder?.username ? [{ name: tr('Строител на седмицата'), value: tr('{0} · {1} т', show.latestBuilder.username, dec(show.latestBuilder.tons)) }] : []),
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
    title = tr('Компании');
    lines = (await companyLeaderboard(db, 10)).map((r, i) => tr('{0} **{1}** [{2}] · ниво {3} · {4} членове', medal(i), r.company, r.tag, r.level, r.members));
  } else if (kind === 'bases') {
    title = tr('Най-красиви бази');
    lines = (await topBases(db, now, 10)).map((r, i) => tr('{0} **{1}** [{2}] · 👍 {3} · {4} нива', medal(i), r.name, r.tag, r.likes, r.buildings));
  } else {
    const { rows, season } = await leaderboard(db, kind, 10);
    title = kind === 'season' ? tr('Сезон{0}', season ? ` „${season.name}“` : '') : kind === 'wealth' ? tr('Най-богати') : tr('Най-много курсове');
    lines = rows.map((r, i) => `${medal(i)} **${r.owner}** · ${kind === 'wealth' ? money(Number(r.value)) : kind === 'deliveries' ? tr('{0} курса', int(Number(r.value))) : tr('{0} т.', int(Number(r.value)))}`);
  }
  return { embeds: [{ title: tr('Класация · {0}', title), url: `${appUrl()}/game/leaderboards`, color: BRAND, description: lines.join('\n') || tr('Още няма класирани.'), footer }] };
}

async function trucks(db: DbOrTx, userId: string): Promise<CommandReply> {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return { ephemeral: true, content: tr('Нямаш игрови акаунт.') };
  const fleet = await fleetView(db, account.id);
  const lines = fleet.vehicles.slice(0, 15).map((v) => {
    const d = v.delivery;
    const where = d?.etaAt ? tr('на път към {0} · пристига <t:{1}:R>', d.destination.nameBg, Math.floor(new Date(d.etaAt).getTime() / 1000)) : tr('в {0}', v.city.nameBg);
    return `🚚 **${v.plate}** · ${v.model.name} · ${where} · ${Math.round(v.condition)} %`;
  });
  return { ephemeral: true, embeds: [{ title: tr('Твоите камиони'), url: `${appUrl()}/game/fleet`, color: BRAND, description: lines.join('\n') || tr('Нямаш камиони.'), footer }] };
}

async function board(db: DbOrTx, cityName: string, now: Date): Promise<CommandReply> {
  const q = cityName.trim();
  if (!q) return { ephemeral: true, content: tr('Напиши град.') };
  const [city] = await db.select({ id: cities.id, name: cities.nameBg }).from(cities).where(or(ilike(cities.nameBg, q), ilike(cities.name, q))).orderBy(desc(cities.population)).limit(1);
  if (!city) return { ephemeral: true, content: tr('Няма град „{0}“ в играта.', q) };
  const dest = sql<string>`(select name_bg from cities c where c.id = ${contracts.destCityId})`;
  const rows = await db
    .select({ goods: contracts.goods, tons: contracts.weightTons, km: contracts.distanceKm, reward: contracts.rewardCents, dest, minLevel: contracts.minLevel })
    .from(contracts)
    .where(and(eq(contracts.originCityId, city.id), eq(contracts.status, 'open'), eq(contracts.shady, false), gt(contracts.expiresAt, now), isNull(contracts.constructionId), isNull(contracts.trade)))
    .orderBy(desc(contracts.rewardCents))
    .limit(8);
  const lines = rows.map((r) => tr('📦 **{0}** {1} т → {2} · {3} · **{4}**{5}', r.goods, dec(r.tons), r.dest, km(r.km), money(r.reward), r.minLevel > 1 ? tr(' · ниво {0}+', r.minLevel) : ''));
  return { embeds: [{ title: tr('Борса · {0}', city.name), url: `${appUrl()}/game/contracts`, color: BRAND, description: lines.join('\n') || tr('В момента няма свободни товари оттук.'), footer: { text: tr('Поемането на товар става в играта · игрови данни') } }] };
}

async function playerByName(db: DbOrTx, username: string) {
  const [u] = await db.select({ id: users.id, username: users.username }).from(users).where(and(sql`lower(${users.username}) = lower(${username.trim()})`, isNull(users.bannedAt)));
  return u ?? null;
}

/** /рекорди — the fastest loaded runs on the lanes this month (v1.5). */
async function records(db: DbOrTx, username: string | null, now: Date): Promise<CommandReply> {
  if (!featureLive('lane_records', now)) return { ephemeral: true, content: tr('Рекордите на линиите идват с обновление 1.5.') };
  const who = username ? await playerByName(db, username) : null;
  if (username && !who) return { ephemeral: true, content: tr('Няма играч „{0}“.', username) };
  const rows = await laneRecordsView(db, now, 10, who?.id);
  const time = (m: number) => tr('{0} ч {1} мин', Math.floor(m / 60), m % 60);
  return {
    embeds: [{
      title: who ? tr('🏁 Рекордите на {0} този месец', who.username) : tr('🏁 Рекорди на линиите този месец'),
      url: `${appUrl()}/game/leaderboards?tab=records`,
      color: BRAND,
      description: rows.length ? rows.map((r) => tr('**{0} → {1}** · {2} · {3} км{4}', r.from, r.to, time(r.minutes), int(Math.round(r.km)), who ? '' : ` · ${r.username}`)).join('\n') : tr('Този месец още няма рекорди.'),
      footer,
    }],
  };
}

/** /конвой-голям — announced convoys that still have a seat (v1.6). */
async function bigConvoys(db: DbOrTx, now: Date): Promise<CommandReply> {
  if (!featureLive('big_convoy', now)) return { ephemeral: true, content: tr('Големият конвой идва с обновление 1.6.') };
  if (featureLive('convoy_lobby', now)) {
    const open = await openConvoysList(db, now);
    return {
      embeds: [{
        title: tr('🚚 Конвои с място'),
        url: `${appUrl()}/game/convoys`,
        color: BRAND,
        description: open.length ? open.map((c) => tr('**{0} → {1}** · {2}/{3} камиона · тръгва <t:{4}:R>', c.from, c.to, c.taken, c.seats, Math.floor(c.departAt.getTime() / 1000))).join('\n') : tr('Сега няма отворен конвой. Създай в играта: Поръчки → Конвои.'),
        footer,
      }],
    };
  }
  const rows = await openBigConvoys(db, now);
  return {
    embeds: [{
      title: tr('🚚🚚🚚 Конвои с място'),
      url: `${appUrl()}/game/challenges`,
      color: BRAND,
      description: rows.length
        ? rows.map((r) => tr('**{0} → {1}** · {2} · {3}/{4} камиона · до <t:{5}:t>', r.from, r.to, r.username, r.size, BIG_CONVOY.maxTrucks, Math.floor(r.expiresAt.getTime() / 1000))).join('\n')
        : tr('Сега няма отворен конвой. Тръгни на курс и го обяви с `/конвой`.'),
      footer,
    }],
  };
}

/** /турнир — the spring cup (v1.6). */
async function cup(db: DbOrTx, now: Date): Promise<CommandReply> {
  if (!featureLive('spring_cup', now)) return { ephemeral: true, content: tr('Пролетната купа идва с обновление 1.6.') };
  const c = await cupView(db, now);
  const round = c.rounds.find((r) => r.live) ?? [...c.rounds].reverse().find((r) => r.matches.length);
  const side = (n: string | null, km: number | null) => (n ? `${n}${km != null ? tr(' ({0} км)', int(km)) : ''}` : '—');
  const lines = round
    ? round.matches.map((m) => tr('{0}{1}{2} срещу {3}{4}{5}', m.settled && m.winner === m.a ? '**' : '', side(m.a, m.aKm), m.settled && m.winner === m.a ? '**' : '', m.settled && m.winner === m.b ? '**' : '', side(m.b, m.bKm), m.settled && m.winner === m.b ? '**' : ''))
    : [tr('Записани: {0} / {1}{2}', c.entries.length, c.size, c.signupOpen ? tr(' · записване в играта до <t:{0}:f>', Math.floor(c.rounds[0]!.from.getTime() / 1000)) : '')];
  return { embeds: [{ title: `🏆 ${c.title}${round ? ` · ${round.title}` : ''}`, url: `${appUrl()}/game/cup`, color: BRAND, description: lines.join('\n'), footer }] };
}

/** /маршрут — the truck route between two cities (the stored one, else an approximation; v1.6). */
async function route(db: DbOrTx, fromName: string, toName: string, now: Date): Promise<CommandReply> {
  if (!featureLive('my_map', now)) return { ephemeral: true, content: tr('Командата идва с обновление 1.6.') };
  const find = async (q: string) => (q.trim() ? (await db.select().from(cities).where(or(ilike(cities.nameBg, q.trim()), ilike(cities.name, q.trim()))).orderBy(desc(cities.population)).limit(1))[0] : undefined);
  const [a, b] = [await find(fromName), await find(toName)];
  if (!a || !b) return { ephemeral: true, content: tr('Няма град „{0}“ в играта.', !a ? fromName : toName) };
  if (![a.countryCode, b.countryCode].every((c) => countryOpen(c, featureLive('europe', now), featureLive('open_world', now)))) return { ephemeral: true, content: tr('Тези държави идват със следващото обновление.') };
  if (a.id === b.id) return { ephemeral: true, content: tr('Избери два различни града.') };
  const [stored] = await db.select().from(routes).where(and(eq(routes.fromCityId, a.id), eq(routes.toCityId, b.id), eq(routes.profile, 'truck'))).limit(1);
  const r = stored ?? (await routeOpen(approximateProvider, { lat: a.lat, lon: a.lon, country: a.countryCode }, { lat: b.lat, lon: b.lon, country: b.countryCode }, 'truck'));
  const approx = r.provider === 'approximate';
  const hours = r.durationS / 3600;
  return {
    embeds: [{
      title: `🛣️ ${a.nameBg} → ${b.nameBg}`,
      color: BRAND,
      fields: [
        { name: tr('Разстояние'), value: `${approx ? '≈ ' : ''}${km(r.distanceKm)}`, inline: true },
        { name: tr('Шофиране'), value: tr('{0}{1} ч {2} мин', approx ? '≈ ' : '', Math.floor(hours), Math.round((hours % 1) * 60)), inline: true },
        { name: tr('Тол'), value: r.hasToll ? tr('да') : tr('не'), inline: true },
        { name: tr('Държави'), value: r.countries.join(' → ') || '—', inline: true },
        { name: tr('Граници'), value: String(r.borders.length), inline: true },
      ],
      footer: { text: approx ? tr('Приблизително (маршрутът още не е изчислен в играта) · без почивки и опашки') : tr('Истински път (Valhalla / OSM) · без почивки и опашки') },
    }],
  };
}

/** /държава — one country in short (v1.7). */
async function country(db: DbOrTx, name: string, now: Date): Promise<CommandReply> {
  if (!featureLive('discord_country', now)) return { ephemeral: true, content: tr('Командата идва с обновление 1.7.') };
  const code = await findCountry(db, name);
  if (!code || !countryOpen(code, featureLive('europe', now), featureLive('open_world', now)) || !GAME_COUNTRIES.includes(code as GameCountry)) return { ephemeral: true, content: tr('Няма държава „{0}“ в играта.', name) };
  const c = (await countryInfo(db, code, now))!;
  return {
    embeds: [{
      title: `🌍 ${c.name}`,
      url: `${appUrl()}/game/countries/${c.code}`,
      color: BRAND,
      fields: [
        { name: tr('Дизел днес'), value: tr('{0}/л', moneyPrecise(c.fuelCents)), inline: true },
        { name: tr('Тол за камион'), value: c.toll.kind === 'vignette' ? tr('винетка {0}', money(c.toll.cents)) : tr('{0}/км', moneyPrecise(c.toll.centsPerKm)), inline: true },
        ...(c.zones.length ? [{ name: tr('Нискоемисионни зони'), value: c.zones.join(', '), inline: true }] : []),
        ...(c.nationalDay ? [{ name: tr('Национален празник'), value: `${c.nationalDay.label} (${c.nationalDay.day.split('-').reverse().join('.')})`, inline: true }] : []),
        { name: tr('Крал'), value: c.king ? tr('👑 {0} · {1} т', c.king.username, dec(c.king.tons)) : tr('още няма'), inline: true },
        { name: tr('Най-добрите товари към държавата'), value: c.loads.length ? c.loads.map((l) => tr('{0} → {1} · {2} т · {3}', l.from, l.to, dec(l.tons), money(l.rewardCents))).join('\n') : tr('Няма отворени сега.') },
      ],
      footer,
    }],
  };
}

/** /предизвикателство — the challenge of the week (v1.6). */
async function challenge(db: DbOrTx, userId: string | null, now: Date): Promise<CommandReply> {
  if (!featureLive('weekly_challenge', now)) return { ephemeral: true, content: tr('Предизвикателството на седмицата идва с обновление 1.6.') };
  const w = await weeklyChallenge(db, now, userId, 5);
  return {
    embeds: [{
      title: tr('🏆 Предизвикателство на седмицата: {0}', w.title),
      url: `${appUrl()}/game/challenges`,
      color: BRAND,
      description: [
        w.description,
        tr('Награди: {0} · до <t:{1}:f>', WEEKLY_CHALLENGE.prizes.map((c, i) => `${i + 1}. ${c} TC`).join(' · '), Math.floor(w.endsAt.getTime() / 1000)),
        '',
        w.top.length ? w.top.map((r, i) => `**${i + 1}.** ${r.username} · ${int(r.value)} ${w.unit}`).join('\n') : tr('Още няма курс навреме тази седмица.'),
        ...(w.mine ? ['', tr('Ти си **{0}.** от {1} · {2} {3}', w.mine.place, int(w.players), int(w.mine.value), w.unit)] : []),
      ].join('\n'),
      footer,
    }],
  };
}

/** /албум — the city album: cards per country (v1.5). */
async function album(db: DbOrTx, username: string | null, now: Date): Promise<CommandReply> {
  if (!featureLive('city_album', now)) return { ephemeral: true, content: tr('Колекцията от градове идва с обновление 1.5.') };
  if (!username) return { ephemeral: true, content: tr('Напиши име на играч или свържи акаунта си. {0}', linkHint()) };
  const who = await playerByName(db, username);
  if (!who) return { ephemeral: true, content: tr('Няма играч „{0}“.', username) };
  const pages = await albumOf(db, who.id);
  const have = pages.reduce((s, p) => s + p.cities.filter((c) => c.at).length, 0);
  const all = pages.reduce((s, p) => s + p.cities.length, 0);
  return {
    embeds: [{
      title: tr('📒 Албумът на {0}: {1} / {2} града', who.username, have, all),
      url: `${appUrl()}/game/collection`,
      color: BRAND,
      fields: pages.map((p) => {
        const n = p.cities.filter((c) => c.at).length;
        return { name: `${n === p.cities.length ? '✅ ' : ''}${p.name}`, value: `${n} / ${p.cities.length}`, inline: true };
      }).slice(0, 24),
      footer,
    }],
  };
}

/** /съюз — an alliance: its companies, the week and the hall (v1.5). */
async function alliance(db: DbOrTx, name: string | null, viewerId: string | null, now: Date): Promise<CommandReply> {
  if (!featureLive('alliances', now)) return { ephemeral: true, content: tr('Съюзите идват с обновление 1.5.') };
  let id: string | null = null;
  if (name) id = (await db.select({ id: alliances.id }).from(alliances).where(sql`lower(${alliances.name}) = lower(${name.trim()})`))[0]?.id ?? null;
  else if (viewerId) id = (await playerAlliance(db, viewerId, now))?.id ?? null;
  if (!id) return { ephemeral: true, content: name ? tr('Няма съюз „{0}“.', name) : tr('Компанията ти не е в съюз (или акаунтът ти не е свързан). {0}', linkHint()) };
  const [a] = await db.select().from(alliances).where(eq(alliances.id, id));
  const members = await db.select({ name: organizations.name, tag: organizations.tag }).from(allianceMembers).innerJoin(organizations, eq(organizations.id, allianceMembers.organizationId)).where(eq(allianceMembers.allianceId, id));
  const week = await allianceWeekView(db, id, members.length, now);
  const hall = await allianceHall(db, id);
  return {
    embeds: [{
      title: tr('🛡 Съюз „{0}“', a!.name),
      url: `${appUrl()}/game/company/alliance`,
      color: 0xa78bfa,
      fields: [
        { name: tr('Компании'), value: members.map((m) => (m.tag ? `[${m.tag}] ${m.name}` : m.name)).join('\n') || '—' },
        { name: tr('Седмична цел'), value: tr('{0} / {1} т', dec(week.tons), dec(week.targetTons)), inline: true },
        { name: tr('Битка'), value: week.rival ? tr('срещу {0}: {1} : {2} т', week.rival.name, dec(week.tons), dec(week.rival.tons)) : tr('още няма противник'), inline: true },
        ...(hall && featureLive('alliance_hall', now) ? [{ name: tr('Съюзна база'), value: tr('ниво {0} в {1}{2}', hall.level, hall.city, hall.next ? tr(' · {0} / {1} т до следващото', dec(hall.tons), hall.next) : tr(' · максимално')), inline: true }] : []),
      ],
      footer,
    }],
  };
}

/** /камион — a card of the player's truck (v1.5). */
async function truckCard(db: DbOrTx, userId: string, plate: string | null, now: Date): Promise<CommandReply> {
  if (!featureLive('discord_truck', now)) return { ephemeral: true, content: tr('Командата идва със следващото обновление.') };
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  const fleet = account ? (await fleetView(db, account.id)).vehicles : [];
  const norm = (s: string) => s.replace(/\s+/g, '').toUpperCase();
  const v = plate ? fleet.find((x) => norm(x.plate) === norm(plate)) : fleet.at(-1);
  if (!v) return { ephemeral: true, content: plate ? tr('Нямаш камион с номер „{0}“.', plate) : tr('Още нямаш камион.') };
  return {
    embeds: [{
      title: `🚚 ${v.model.brand} ${v.model.name} · ${v.plate}`,
      url: `${appUrl()}/game/garage/${v.id}`,
      color: BRAND,
      image: { url: `${appUrl()}/api/discord/card/truck/${v.id}?v=${now.getTime()}` },
      footer,
    }],
  };
}
