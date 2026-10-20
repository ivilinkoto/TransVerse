import type { DbOrTx } from '@/server/db/client';
import { discord, DiscordError } from './api';
import { answer, type Answer, type Ctx } from './context';
import { appUrl, BRAND, discordConfig, PING_ROLES, type PingRole } from './config';
import { ensureRole } from './guild';
import { layoutChannel, layoutState, saveLayoutState } from './layout';
import { button, linkButton, rows, say, STYLE, type MessageData } from './ui';

/**
 * The bot's fixed messages in the layout's channels: the welcome, the rules,
 * "свържи акаунта", the roles to pick and the ticket button. Posted once and
 * edited afterwards (their ids are kept with the layout).
 */

export const SERVER_RULES = [
  'Уважавай останалите — без обиди, тормоз, расизъм и политика.',
  'Без спам, флуд и реклама на други сървъри, игри или услуги.',
  'Без NSFW съдържание — нито в текст, нито в снимки, аватари или имена.',
  'Пиши в правилния канал: въпроси за играта в #тикети, идеи в #идеи, команди в #бот-команди.',
  'Не се представяй за член на екипа и не искай пароли — екипът никога не пита за тях.',
  'Измами, ботове и използване на грешки в играта водят до бан и тук, и в играта.',
  'Търговията с акаунти и ТрансКоин срещу истински пари е забранена.',
  'Решенията на екипа се обжалват спокойно, с тикет — не в общия чат.',
];

const PANELS: { key: string; channel: string; onlyNew?: boolean; build: () => Promise<MessageData> }[] = [
  {
    key: 'welcome',
    channel: 'добре-дошли',
    onlyNew: true,
    build: async () => ({
      embeds: [{
        title: '🚚 Добре дошъл в TransVerse!',
        color: BRAND,
        description: [
          'TransVerse е онлайн транспортна стратегия по истински пътища: започваш с един нает камион и изграждаш компания заедно с други шофьори.',
          '',
          '**Първи стъпки**',
          '1️⃣ Прочети #правила',
          '2️⃣ Свържи акаунта си в #свържи-акаунта — получаваш роли, канал на компанията и 10 ТрансКоин',
          '3️⃣ Избери известията си в #роли',
          '4️⃣ Нужна ти е помощ? Отвори тикет в #тикети',
        ].join('\n'),
        footer: { text: 'TransVerse · transverse-bg.com' },
      }],
      components: rows(linkButton('Играй', appUrl(), '🎮'), linkButton('Свържи Discord', `${appUrl()}/game/settings#discord`, '🔗')),
    }),
  },
  {
    key: 'rules',
    channel: 'правила',
    onlyNew: true,
    build: async () => ({
      embeds: [{
        title: '📜 Правила на сървъра',
        color: BRAND,
        description: `${SERVER_RULES.map((r, n) => `**${n + 1}.** ${r}`).join('\n')}\n\nЗа нарушение: предупреждение, заглушаване или бан — според случая. Правилата на играта важат и тук.`,
        footer: { text: 'Екипът на TransVerse' },
      }],
    }),
  },
  {
    key: 'link',
    channel: 'свържи-акаунта',
    build: async () => ({
      embeds: [{
        title: '🔗 Свържи Discord с играта',
        color: BRAND,
        description: [
          'С един клик в **Настройки → Discord** в играта получаваш:',
          '• роли според нивото, VIP и компанията си',
          '• частния канал на компанията, свързан с чата в играта',
          '• известията от играта като лично съобщение (по избор)',
          '• командите `/камиони`, `/курс`, `/дневна`, `/ивент`, `/битка`',
          '• **10 ТрансКоин** и значка „Discord шофьор“ първия път',
        ].join('\n'),
      }],
      components: rows(linkButton('Свържи акаунта', `${appUrl()}/game/settings#discord`, '🔗'), linkButton('Регистрация', `${appUrl()}/register`, '🚚')),
    }),
  },
  {
    key: 'roles',
    channel: 'роли',
    build: async () => ({
      embeds: [{
        title: '🎭 Избери известията си',
        color: BRAND,
        description: `Натисни бутон, за да получаваш (или да спреш) споменаване при ново обявление:\n\n${Object.values(PING_ROLES).map((r) => `${r.emoji} **${r.label}**`).join('\n')}`,
      }],
      components: rows(...(Object.entries(PING_ROLES) as [PingRole, (typeof PING_ROLES)[PingRole]][]).map(([key, r]) => button(r.label, `ping:${key}`, STYLE.secondary, r.emoji))),
    }),
  },
  {
    key: 'tickets',
    channel: 'тикети',
    build: async () => ({
      embeds: [{
        title: '🎫 Нужна ти е помощ?',
        color: BRAND,
        description: 'Натисни **Отвори тикет** — отваря се частен канал само за теб и екипа.\n\nАко акаунтът ти е свързан, тикетът се появява и в играта (Поддръжка), а отговорите идват и на двете места.',
      }],
      components: rows(button('Отвори тикет', 'ticket:open', STYLE.primary, '🎫')),
    }),
  },
];

/** Posts the panels that are missing and refreshes the others. `created`: channels just made by the layout. */
export async function postPanels(db: DbOrTx, created: string[] = []) {
  const state = await layoutState(db);
  const done: string[] = [];
  for (const p of PANELS) {
    const channelId = await layoutChannel(db, p.channel);
    if (!channelId) continue;
    const data = await p.build();
    const stored = state.panels[p.key];
    if (stored) {
      try {
        await discord('PATCH', `/channels/${channelId}/messages/${stored}`, data);
        done.push(p.key);
        continue;
      } catch (error) {
        if (!(error instanceof DiscordError && error.status === 404)) throw error;
      }
    }
    // The welcome and the rules only in a channel the layout made (the server's own rules stay).
    if (p.onlyNew && !created.includes(p.channel)) continue;
    const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, data);
    state.panels[p.key] = msg.id;
    done.push(p.key);
  }
  await saveLayoutState(db, state);
  return done;
}

/** The id of a pick-your-pings role (made when missing). */
export const pingRole = (key: PingRole) => ensureRole(PING_ROLES[key].name, 0x9aa3b2);

/** #роли: a button gives or takes one pick-your-pings role. */
export async function togglePing(ctx: Ctx, key: string): Promise<Answer> {
  if (!(key in PING_ROLES)) return answer(say('Няма такава роля.'));
  const roleId = await pingRole(key as PingRole);
  const has = ctx.i.member?.roles?.includes(roleId);
  await discord(has ? 'DELETE' : 'PUT', `/guilds/${discordConfig().guildId}/members/${ctx.discordId}/roles/${roleId}`);
  const label = PING_ROLES[key as PingRole].label;
  return answer(say(has ? `🔕 Спрях споменаванията за **${label}**.` : `🔔 Ще те споменаваме при нови **${label}**.`));
}
