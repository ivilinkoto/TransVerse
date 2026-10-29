import { randomInt } from 'node:crypto';
import type { Database, DbOrTx } from '@/server/db/client';
import { discord } from './api';
import { answer, field, type Answer, type Ctx } from './context';
import { BRAND, discordConfig } from './config';
import { forgetGuild, giveVerified, guild, verifiedRole } from './guild';
import { LAYOUT, layoutChannel, layoutState, saveLayoutState } from './layout';
import { enqueue } from './outbox';
import { button, modal, rows, say, STYLE, textInput } from './ui';
import { t } from '@/i18n/t';

/**
 * The new members' check (off until switched on in the admin panel): only
 * "🚚 ДОБРЕ ДОШЛИ" is open; "✅ Не съм бот" asks a small sum and gives the
 * "✅ Проверен" role, which opens the rest of the layout. Linked players and
 * everyone already in the server when it is switched on get the role too.
 * Switched off, the channels are as before.
 */

const VIEW = 1n << 10n;
const HISTORY = 1n << 16n;
/** Categories that stay as they are: the welcome (open to all) and the private ones. */
const OPEN = new Set(['добре-дошли']);
const PRIVATE = new Set(['отворени-тикети', 'компании', 'екип']);

interface Overwrite {
  id: string;
  type: number;
  allow: string;
  deny: string;
}
interface Channel {
  id: string;
  parent_id?: string | null;
  permission_overwrites?: Overwrite[];
}


/** The channels the check closes: everything in the layout's public categories. */
async function closable(db: DbOrTx) {
  const state = await layoutState(db);
  const cats = LAYOUT.filter((c) => !OPEN.has(c.key) && !PRIVATE.has(c.key)).map((c) => state.categories[c.key]).filter((x): x is string => !!x);
  const { channels } = await guild(true);
  return (channels as Channel[]).filter((c) => cats.includes(c.id) || (c.parent_id && cats.includes(c.parent_id)));
}

export async function setVerification(db: Database, on: boolean) {
  const { guildId } = discordConfig();
  const role = await verifiedRole();
  const errors: string[] = [];
  for (const c of await closable(db)) {
    const everyone = c.permission_overwrites?.find((o) => o.id === guildId);
    const allow = BigInt(everyone?.allow ?? '0');
    const deny = BigInt(everyone?.deny ?? '0');
    try {
      if (on) {
        await discord('PUT', `/channels/${c.id}/permissions/${guildId}`, { type: 0, allow: String(allow & ~VIEW), deny: String(deny | VIEW) });
        await discord('PUT', `/channels/${c.id}/permissions/${role}`, { type: 0, allow: String(VIEW | HISTORY), deny: '0' });
      } else {
        const nextDeny = deny & ~VIEW;
        if (allow === 0n && nextDeny === 0n) await discord('DELETE', `/channels/${c.id}/permissions/${guildId}`).catch(() => undefined);
        else await discord('PUT', `/channels/${c.id}/permissions/${guildId}`, { type: 0, allow: String(allow), deny: String(nextDeny) });
        await discord('DELETE', `/channels/${c.id}/permissions/${role}`).catch(() => undefined);
      }
    } catch (error) {
      errors.push((error as Error).message.slice(0, 200));
    }
  }
  const state = await layoutState(db);
  await saveLayoutState(db, { ...state, settings: { ...state.settings, verification: on } });
  forgetGuild();
  if (on) {
    await giveEveryoneVerified(db);
    await postVerifyPanel(db);
  }
  return { errors };
}

/** Everyone already in the server keeps seeing the channels (the role is given through the queue). */
async function giveEveryoneVerified(db: Database) {
  const { guildId } = discordConfig();
  let after = '0';
  for (let page = 0; page < 50; page++) {
    const members = await discord<{ user: { id: string; bot?: boolean } }[]>('GET', `/guilds/${guildId}/members?limit=1000&after=${after}`);
    for (const m of members) if (!m.user.bot) await enqueue(db, `verified:${m.user.id}`, 'job:verified', { discordId: m.user.id });
    if (members.length < 1000) break;
    after = members.at(-1)!.user.id;
  }
}

async function postVerifyPanel(db: Database) {
  const channelId = await layoutChannel(db, 'добре-дошли');
  if (!channelId) return;
  const state = await layoutState(db);
  if (state.panels.verify) return;
  const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, {
    embeds: [{ title: t('✅ Влез в сървъра'), color: BRAND, description: t('За да видиш останалите канали, натисни бутона и реши една сметка. Така пазим сървъра от ботове.') }],
    components: rows(button(t('Не съм бот'), 'verify:start', STYLE.success, '✅')),
  });
  await saveLayoutState(db, { ...state, panels: { ...state.panels, verify: msg.id } });
}

/** "Не съм бот": a small sum in a form. */
export function verifyStart(ctx: Ctx): Answer {
  const a = 2 + randomInt(8);
  const b = 2 + randomInt(8);
  return answer(modal(`verify:sum:${a + b}`, t('Проверка'), [textInput('sum', t('Колко е {0} + {1}?', a, b), { max: 3, placeholder: t('число') })]));
}

export async function verifyAnswer(ctx: Ctx, expected: string): Promise<Answer> {
  if (field(ctx.i, 'sum').trim() !== expected) return answer(say(t('Грешен отговор — натисни „Не съм бот“ и опитай пак.')));
  await giveVerified(ctx.discordId);
  return answer(say(t('✅ Готово — добре дошъл! Вече виждаш всички канали.')));
}
