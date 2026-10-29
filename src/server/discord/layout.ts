import { eq } from 'drizzle-orm';
import type { DbOrTx } from '@/server/db/client';
import { jobState } from '@/server/db/schema';
import { discord } from './api';
import { discordConfig, DISCORD_ROLES } from './config';
import { channelKey, ensureRole, forgetGuild, guild } from './guild';

/**
 * The layout of the TransVerse Discord server: categories and channels with
 * emoji, topics and permissions. "Подреди сървъра" (admin panel) shows the
 * plan first, then creates what is missing, renames and moves what exists
 * (matched by name without emoji and decorations) and puts everything in
 * order. It never deletes a channel: the ones outside the layout stay where
 * they are and are listed, so the team can remove them by hand.
 */

const P = {
  addReactions: 1n << 6n,
  view: 1n << 10n,
  send: 1n << 11n,
  manageMessages: 1n << 13n,
  embed: 1n << 14n,
  attach: 1n << 15n,
  history: 1n << 16n,
  connect: 1n << 20n,
  speak: 1n << 21n,
  createPublicThreads: 1n << 35n,
  createPrivateThreads: 1n << 36n,
  sendInThreads: 1n << 38n,
};
const bits = (...b: bigint[]) => b.reduce((a, x) => a | x, 0n).toString();

export type ChannelType = 'text' | 'voice';
export type Access = 'public' | 'readonly' | 'staff' | 'private' | 'stats';

export interface ChannelSpec {
  key: string;
  name: string;
  type?: ChannelType;
  topic?: string;
  access?: Access;
  /** Older names of the same channel (matched like the key). */
  aliases?: string[];
}

export interface CategorySpec {
  key: string;
  name: string;
  access?: Access;
  aliases?: string[];
  channels: ChannelSpec[];
}

/** Voice channels whose names show live numbers from the game (renamed by the worker). */
export const STAT_CHANNELS = ['stat-online', 'stat-road', 'stat-players', 'stat-companies', 'stat-next'] as const;
export type StatChannel = (typeof STAT_CHANNELS)[number];

export const LAYOUT: CategorySpec[] = [
  {
    key: 'добре-дошли',
    name: '🚚 ┃ ДОБРЕ ДОШЛИ',
    aliases: ['информация'],
    channels: [
      { key: 'добре-дошли', name: '👋┃добре-дошли', access: 'readonly', topic: 'Добре дошъл в TransVerse — онлайн транспортната стратегия по реални пътища. Започни от #свържи-акаунта.' },
      { key: 'правила', name: '📜┃правила', access: 'readonly', aliases: ['дискорд-правила'], topic: 'Правилата на сървъра и на играта.' },
      { key: 'свържи-акаунта', name: '🔗┃свържи-акаунта', access: 'readonly', topic: 'Свържи Discord с профила си в играта: роли, канал на компанията, известия и команди.' },
      { key: 'роли', name: '🎭┃роли', access: 'readonly', topic: 'Избери за кои обявления да те известяваме.' },
    ],
  },
  {
    key: 'новини',
    name: '📢 ┃ НОВИНИ И ИГРАТА',
    channels: [
      { key: 'обновления', name: '🆕┃обновления', access: 'readonly', topic: 'Новите обновления на TransVerse — какво има и кога излиза.' },
      { key: 'новини', name: '📣┃новини', access: 'readonly', topic: 'Новини от екипа.' },
      { key: 'статус', name: '🛠️┃статус', access: 'readonly', topic: 'Работи ли играта, планирани прекъсвания.' },
      { key: 'ивенти', name: '🎯┃ивенти', access: 'readonly', topic: 'Ивентите на общността: кога започват, как вървят и кой спечели.' },
      { key: 'битки', name: '⚔️┃битки', access: 'readonly', topic: 'Седмичните битки на компаниите — двойки и резултати.' },
      { key: 'строежи', name: '🏗️┃строежи', access: 'readonly', topic: 'Новите сгради в базите на компаниите и строителите на седмицата.' },
      { key: 'седмичник', name: '📰┃седмичник', access: 'readonly', topic: 'Седмичник TransVerse — новият брой всяка седмица.' },
      { key: 'класации', name: '🏆┃класации', access: 'readonly', topic: 'Най-добрите на седмицата — всяка неделя вечер.' },
      { key: 'раздавания', name: '🎁┃раздавания', access: 'readonly', topic: 'Раздавания на ТрансКоин — натисни „Участвам“.' },
      { key: 'анкети', name: '📊┃анкети', access: 'readonly', topic: 'Анкети на екипа.' },
    ],
  },
  {
    key: 'на-пътя',
    name: '🚛 ┃ НА ПЪТЯ',
    channels: [
      { key: 'товар-на-деня', name: '⭐┃товар-на-деня', access: 'readonly', topic: 'Всеки ден в 12:00 — добре платен товар и ТрансКоин. Взима го първият.' },
      { key: 'конвои', name: '🚚┃конвои', access: 'readonly', topic: 'Обявени конвои (/конвой) — тръгни по същия път и карате заедно за бонус.' },
      { key: 'пазар-камиони', name: '🏷️┃пазар-камиони', access: 'readonly', topic: 'Употребявани камиони и ремаркета от играчите — купи с един бутон.' },
      { key: 'ливреи', name: '🎨┃ливреи', access: 'readonly', topic: 'Конкурсът за ливрея на месеца — дай 👍 на най-красивия камион.' },
      { key: 'пристанище', name: '🚢┃пристанище', access: 'readonly', topic: 'Кораб пристига: контейнерите, които чакат, и компаниите, които карат най-много — на живо.' },
      { key: 'рали', name: '🏁┃рали', access: 'readonly', topic: 'Седмичното рали на живо: кой финишира, най-бързите и най-икономичните.' },
      { key: 'рали-глас', name: '🏁 Рали — на живо', type: 'voice' },
    ],
  },
  {
    key: 'общност',
    name: '💬 ┃ ОБЩНОСТ',
    aliases: ['чат-канали'],
    channels: [
      { key: 'главен-чат', name: '💬┃главен-чат', topic: 'Общият чат на TransVerse. Бъди готин с останалите шофьори.' },
      { key: 'снимки', name: '📸┃снимки', topic: 'Снимки на камиони, бази и маршрути от играта. Конкурс всяка седмица: най-много ⭐ печели ТрансКоин.' },
      { key: 'идеи', name: '💡┃идеи', aliases: ['предложения'], topic: 'Идеи за играта — най-харесваните влизат в обновленията.' },
      { key: 'бот-команди', name: '🤖┃бот-команди', topic: 'Тук пиши командите на бота: /профил, /курс, /ивент, /битка, /ранг…' },
      { key: 'викторина', name: '🧠┃викторина', access: 'readonly', topic: 'Въпроси за градовете и пътищата — първият верен отговор печели ТрансКоин.' },
      { key: 'спам-чат', name: '🎲┃спам-чат', topic: 'Всичко останало.' },
    ],
  },
  // v2.0: the same announcements in English and Russian (LOCALE_CHANNELS in config.ts), and a chat for each.
  {
    key: 'english',
    name: '🇬🇧 ┃ ENGLISH',
    channels: [
      { key: 'en-chat', name: '💬┃en-chat', topic: 'TransVerse in English — chat with the other drivers.' },
      { key: 'en-updates', name: '🆕┃en-updates', access: 'readonly', topic: 'New TransVerse updates — what they bring and when.' },
      { key: 'en-events', name: '🎯┃en-events', access: 'readonly', topic: 'Community events: when they start, how they go and who won.' },
      { key: 'en-battles', name: '⚔️┃en-battles', access: 'readonly', topic: 'The weekly company battles — pairs and results.' },
      { key: 'en-weekly', name: '📰┃en-weekly', access: 'readonly', topic: 'TransVerse Weekly — the new issue every week.' },
      { key: 'en-rankings', name: '🏆┃en-rankings', access: 'readonly', topic: 'Weekly rankings, records and winners.' },
      { key: 'en-load-of-the-day', name: '⭐┃en-load-of-the-day', access: 'readonly', topic: 'The load of the day at 12:00 — the first to take it gets it.' },
      { key: 'en-convoys', name: '🚚┃en-convoys', access: 'readonly', topic: 'Announced convoys — take the same road and drive together for a bonus.' },
      { key: 'en-rally', name: '🏁┃en-rally', access: 'readonly', topic: 'The weekly rally live.' },
    ],
  },
  {
    key: 'русский',
    name: '🇷🇺 ┃ РУССКИЙ',
    channels: [
      { key: 'ru-чат', name: '💬┃ru-чат', topic: 'TransVerse на русском — общение с другими водителями.' },
      { key: 'ru-обновления', name: '🆕┃ru-обновления', access: 'readonly', topic: 'Новые обновления TransVerse — что в них и когда выходят.' },
      { key: 'ru-ивенты', name: '🎯┃ru-ивенты', access: 'readonly', topic: 'Ивенты сообщества: когда начинаются, как идут и кто победил.' },
      { key: 'ru-битвы', name: '⚔️┃ru-битвы', access: 'readonly', topic: 'Еженедельные битвы компаний — пары и результаты.' },
      { key: 'ru-еженедельник', name: '📰┃ru-еженедельник', access: 'readonly', topic: 'Еженедельник TransVerse — новый номер каждую неделю.' },
      { key: 'ru-рейтинги', name: '🏆┃ru-рейтинги', access: 'readonly', topic: 'Еженедельные рейтинги, рекорды и победители.' },
      { key: 'ru-груз-дня', name: '⭐┃ru-груз-дня', access: 'readonly', topic: 'Груз дня в 12:00 — достаётся тому, кто возьмёт первым.' },
      { key: 'ru-колонны', name: '🚚┃ru-колонны', access: 'readonly', topic: 'Объявленные колонны — езжай той же дорогой и получай бонус вместе.' },
      { key: 'ru-ралли', name: '🏁┃ru-ралли', access: 'readonly', topic: 'Еженедельное ралли в реальном времени.' },
    ],
  },
  {
    key: 'поддръжка',
    name: '🛟 ┃ ПОДДРЪЖКА',
    aliases: ['support'],
    channels: [
      { key: 'тикети', name: '🎫┃тикети', access: 'readonly', topic: 'Нужна ти е помощ? Натисни „Отвори тикет“ — отговаряме и в играта, и тук.' },
      { key: 'докладвай-бъг', name: '🐞┃докладвай-бъг', topic: 'Намери ли грешка? Опиши какво стана и как да го повторим.' },
    ],
  },
  { key: 'отворени-тикети', name: '🎫 ┃ ОТВОРЕНИ ТИКЕТИ', access: 'private', channels: [] },
  {
    key: 'статистика',
    name: '📊 ┃ СТАТИСТИКА',
    access: 'stats',
    channels: [
      { key: 'stat-online', name: '🟢 Онлайн: …', type: 'voice', access: 'stats' },
      { key: 'stat-road', name: '🚚 На пътя: …', type: 'voice', access: 'stats' },
      { key: 'stat-players', name: '👥 Шофьори: …', type: 'voice', access: 'stats' },
      { key: 'stat-companies', name: '🏢 Компании: …', type: 'voice', access: 'stats' },
      { key: 'stat-next', name: '🆕 Следва: …', type: 'voice', access: 'stats' },
    ],
  },
  {
    key: 'гласови',
    name: '🔊 ┃ ГЛАСОВИ КАНАЛИ',
    aliases: ['voicechannels'],
    channels: [
      { key: 'създай-стая', name: '➕ Създай стая', type: 'voice' },
      { key: 'говорилня1', name: '🔊 Говорилня #1', type: 'voice' },
      { key: 'говорилня2', name: '🔊 Говорилня #2', type: 'voice' },
      { key: 'говорилня3', name: '🔊 Говорилня #3', type: 'voice' },
      { key: 'конвой', name: '🚚 Конвой', type: 'voice' },
      { key: 'afk', name: '💤 AFK', type: 'voice' },
    ],
  },
  {
    key: 'екип',
    name: '🛡️ ┃ ЕКИП',
    access: 'staff',
    aliases: ['staffекип'],
    channels: [
      { key: 'екип-чат', name: '🛡️┃екип-чат', access: 'staff', aliases: ['чат-админи'] },
      { key: 'логове', name: '📋┃логове', access: 'staff', topic: 'Влизания, излизания, изтрити и редактирани съобщения, роли — от бота.' },
      { key: 'предупреждения', name: '⚠️┃предупреждения', access: 'staff', topic: 'Предупреждения и заглушавания (/предупреждение, /заглуши).' },
      { key: 'банове', name: '🔨┃банове', access: 'staff', topic: 'Банове (/бан).' },
      { key: 'сигнали', name: '🚨┃сигнали', access: 'staff', topic: 'Сигнали от играта за екипа: възможни измами и бързо растяща икономика. Само за проверка — нищо не се наказва автоматично.' },
      { key: 'админ-войс', name: '🎙️ Админ войс', type: 'voice', access: 'staff', aliases: ['админвойс'] },
    ],
  },
  { key: 'компании', name: '🏢 ┃ КОМПАНИИ', access: 'private', channels: [] },
];

/** What "Подреди сървъра" keeps: the ids of the layout's channels and of the bot's panel messages. */
export interface LayoutState {
  channels: Record<string, string>;
  categories: Record<string, string>;
  panels: Record<string, string>;
  appliedAt?: number;
  /** Admin switches: automatic moderation (on unless false), the new members' check (off unless true). */
  settings?: { automod?: boolean; verification?: boolean };
}
const STATE = 'discord-layout';

export async function layoutState(db: DbOrTx): Promise<LayoutState> {
  const [row] = await db.select().from(jobState).where(eq(jobState.key, STATE));
  const v = (row?.value ?? {}) as Partial<LayoutState>;
  return { channels: v.channels ?? {}, categories: v.categories ?? {}, panels: v.panels ?? {}, appliedAt: v.appliedAt, settings: v.settings ?? {} };
}
export async function saveLayoutState(db: DbOrTx, state: LayoutState) {
  await db.insert(jobState).values({ key: STATE, value: state }).onConflictDoUpdate({ target: jobState.key, set: { value: state, updatedAt: new Date() } });
}

interface GuildChannel {
  id: string;
  name: string;
  type: number;
  parent_id?: string | null;
  position: number;
  topic?: string | null;
}

export interface PlanStep {
  kind: 'category' | 'channel';
  action: 'create' | 'rename' | 'move' | 'keep';
  name: string;
  from?: string;
  category?: string;
}
export interface LayoutPlan {
  steps: PlanStep[];
  /** Channels outside the layout (left as they are). */
  others: string[];
}

const keysOf = (spec: { key: string; aliases?: string[] }) => [spec.key, ...(spec.aliases ?? [])];
const isCategory = (c: GuildChannel) => c.type === 4;
const isVoice = (c: GuildChannel) => c.type === 2 || c.type === 13;

/** Finds the layout's categories and channels in the server (stored ids first, then by name). */
function match(channels: GuildChannel[], state: LayoutState) {
  const used = new Set<string>();
  const byId = new Map(channels.map((c) => [c.id, c]));
  const find = (spec: { key: string; aliases?: string[] }, stored: string | undefined, want: (c: GuildChannel) => boolean) => {
    const known = stored ? byId.get(stored) : undefined;
    if (known && want(known) && !used.has(known.id)) return used.add(known.id), known;
    for (const k of keysOf(spec)) {
      const found = channels.find((c) => !used.has(c.id) && want(c) && channelKey(c.name) === channelKey(k));
      if (found) return used.add(found.id), found;
    }
    return undefined;
  };
  const categories = new Map<string, GuildChannel | undefined>();
  const chans = new Map<string, GuildChannel | undefined>();
  for (const cat of LAYOUT) categories.set(cat.key, find(cat, state.categories[cat.key], isCategory));
  for (const cat of LAYOUT) {
    for (const ch of cat.channels) {
      const stored = state.channels[ch.key];
      if (STAT_CHANNELS.includes(ch.key as StatChannel)) {
        // The numbers in their names change: by the stored id, else by the start of the name ("🟢 Онлайн: 12").
        const label = channelKey(ch.name);
        const known = stored ? byId.get(stored) : undefined;
        const found = known && !used.has(known.id) ? known : channels.find((c) => !used.has(c.id) && isVoice(c) && channelKey(c.name).startsWith(label));
        if (found) used.add(found.id);
        chans.set(ch.key, found);
        continue;
      }
      chans.set(ch.key, find(ch, stored, (c) => !isCategory(c) && (ch.type === 'voice') === isVoice(c)));
    }
  }
  return { categories, chans, used };
}

/** What "Подреди сървъра" would do now (nothing changes). */
export async function planLayout(db: DbOrTx): Promise<LayoutPlan> {
  const { channels } = await guild(true);
  const all = channels as GuildChannel[];
  const { categories, chans, used } = match(all, await layoutState(db));
  const steps: PlanStep[] = [];
  for (const cat of LAYOUT) {
    const c = categories.get(cat.key);
    steps.push({ kind: 'category', action: !c ? 'create' : c.name !== cat.name ? 'rename' : 'keep', name: cat.name, from: c && c.name !== cat.name ? c.name : undefined });
    for (const ch of cat.channels) {
      const x = chans.get(ch.key);
      const renamed = x && !STAT_CHANNELS.includes(ch.key as StatChannel) && x.name !== ch.name;
      const moved = x && (!c || x.parent_id !== c.id);
      steps.push({ kind: 'channel', action: !x ? 'create' : renamed ? 'rename' : moved ? 'move' : 'keep', name: ch.name, from: renamed ? x.name : undefined, category: cat.name });
    }
  }
  // Company and ticket channels live in their categories; they are not "others".
  const privateParents = new Set([categories.get('компании')?.id, categories.get('отворени-тикети')?.id].filter(Boolean));
  const others = all.filter((c) => !used.has(c.id) && !(c.parent_id && privateParents.has(c.parent_id))).map((c) => (isCategory(c) ? `📁 ${c.name}` : `#${c.name}`));
  return { steps, others };
}

/** Permission overwrites for a category or channel of the given access. */
function overwrites(access: Access | undefined, ids: { guild: string; bot: string; staff: string }) {
  const bot = { id: ids.bot, type: 1, allow: bits(P.view, P.send, P.embed, P.attach, P.history, P.manageMessages, P.connect), deny: '0' };
  const staff = { id: ids.staff, type: 0, allow: bits(P.view, P.send, P.embed, P.attach, P.history, P.connect, P.speak), deny: '0' };
  switch (access) {
    case 'readonly':
      return [{ id: ids.guild, type: 0, allow: bits(P.view, P.history, P.addReactions), deny: bits(P.send, P.createPublicThreads, P.createPrivateThreads, P.sendInThreads) }, staff, bot];
    case 'staff':
    case 'private':
      return [{ id: ids.guild, type: 0, allow: '0', deny: bits(P.view) }, staff, bot];
    case 'stats':
      return [{ id: ids.guild, type: 0, allow: bits(P.view), deny: bits(P.connect) }, bot];
    default:
      return undefined;
  }
}

/**
 * Applies the layout. `permissions`: also sets the layout's permissions on
 * channels that already existed (new ones always get them). A step Discord
 * refuses does not stop the rest: it is reported, and what was done is kept,
 * so applying again continues from there.
 */
export async function applyLayout(db: DbOrTx, opts: { permissions: boolean }) {
  const { guildId } = discordConfig();
  const g = await guild(true);
  const all = g.channels as GuildChannel[];
  const state = await layoutState(db);
  const { categories, chans } = match(all, state);
  const staffRole = await ensureRole(DISCORD_ROLES.staff.name, DISCORD_ROLES.staff.color);
  const ids = { guild: guildId, bot: g.botId, staff: staffRole };
  const next: LayoutState = { channels: {}, categories: {}, panels: state.panels, appliedAt: Date.now(), settings: state.settings };
  const created: string[] = [];
  const errors: string[] = [];
  const positions: { id: string; position: number }[] = [];
  const step = async <T>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (error) {
      errors.push(`${label}: ${(error as Error).message.replace(/^Discord \w+ \S+: /, '').slice(0, 300)}`);
      return undefined;
    }
  };

  let catPos = 0;
  for (const cat of LAYOUT) {
    let c = categories.get(cat.key);
    const perms = overwrites(cat.access, ids);
    if (!c) {
      c = await step(cat.name, () => discord<GuildChannel>('POST', `/guilds/${guildId}/channels`, { name: cat.name, type: 4, ...(perms ? { permission_overwrites: perms } : {}) }));
      // Without its category the channels wait for the next try.
      if (!c) continue;
      created.push(cat.key);
    } else if (c.name !== cat.name || (opts.permissions && perms)) {
      const id = c.id;
      await step(cat.name, () => discord('PATCH', `/channels/${id}`, { name: cat.name, ...(opts.permissions && perms ? { permission_overwrites: perms } : {}) }));
    }
    const parent = c.id;
    next.categories[cat.key] = parent;
    positions.push({ id: c.id, position: catPos++ });

    let chPos = 0;
    for (const ch of cat.channels) {
      const voice = ch.type === 'voice';
      const access = ch.access ?? cat.access;
      const chPerms = overwrites(access, ids);
      let x = chans.get(ch.key);
      if (!x) {
        x = await step(ch.name, () => discord<GuildChannel>('POST', `/guilds/${guildId}/channels`, { name: ch.name, type: voice ? 2 : 0, parent_id: parent, ...(ch.topic && !voice ? { topic: ch.topic } : {}), ...(chPerms ? { permission_overwrites: chPerms } : {}) }));
        if (!x) continue;
        created.push(ch.key);
      } else {
        const stat = STAT_CHANNELS.includes(ch.key as StatChannel);
        const patch: Record<string, unknown> = {};
        if (!stat && x.name !== ch.name) patch.name = ch.name;
        if (x.parent_id !== parent) patch.parent_id = parent;
        // Only text channels have a topic here (forums, voice and stage channels keep theirs).
        if (ch.topic && (x.type === 0 || x.type === 5) && !x.topic) patch.topic = ch.topic;
        if (opts.permissions && chPerms) patch.permission_overwrites = chPerms;
        const id = x.id;
        if (Object.keys(patch).length) await step(ch.name, () => discord('PATCH', `/channels/${id}`, patch));
      }
      next.channels[ch.key] = x.id;
      // The category was already set above: Discord changes only one parent per bulk request.
      positions.push({ id: x.id, position: chPos++ });
    }
  }
  // The other categories go after the layout's, in their old order.
  const rest = all.filter((c) => isCategory(c) && !Object.values(next.categories).includes(c.id)).sort((a, b) => a.position - b.position);
  for (const c of rest) positions.push({ id: c.id, position: catPos++ });
  // What was made is kept even when something failed (the stat channels are found only by their ids).
  await saveLayoutState(db, { ...next, channels: { ...state.channels, ...next.channels }, categories: { ...state.categories, ...next.categories } });
  await step('Подредбата', () => discord('PATCH', `/guilds/${guildId}/channels`, positions));
  forgetGuild();
  return { created, errors };
}

/** A channel of the layout by key: the stored id, or by name for servers not laid out yet. */
export async function layoutChannel(db: DbOrTx, key: string) {
  const state = await layoutState(db);
  const { channels } = await guild();
  const stored = state.channels[key];
  if (stored && channels.some((c) => c.id === stored)) return stored;
  return channels.find((c) => c.type !== 4 && channelKey(c.name) === channelKey(key))?.id ?? null;
}

/** A layout category by key (stored id or by name). */
export async function layoutCategory(db: DbOrTx, key: string, fallbackName: string) {
  const state = await layoutState(db);
  const { channels } = await guild();
  const stored = state.categories[key];
  if (stored && channels.some((c) => c.id === stored)) return stored;
  return channels.find((c) => c.type === 4 && channelKey(c.name) === channelKey(fallbackName))?.id ?? null;
}
