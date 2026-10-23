import { EVENT_TEMPLATES } from '@/lib/game/events';
import { isAdmin } from '@/server/auth/roles';
import { GameError } from '@/server/game/errors';
import { startTemplateEvent } from '@/server/game/events';
import { answer, hasPerm, linked, opt, PERM, stop, type Answer, type Ctx } from './context';
import { appUrl, BRAND } from './config';
import { reply } from './ui';

/**
 * /помощ in two parts: the players' commands for everyone, and — only for
 * members with moderation rights — the team's commands. /ивент-старт for the
 * game's administrators.
 */

const footer = { text: 'TransVerse · transverse-bg.com' };

export const PLAYER_HELP = [
  '**Играта**',
  '`/профил [играч]` — картичка на играч',
  '`/компания [име]` · `/участък [компания]` — компания и снимка на базата ѝ',
  '`/класация [вид]` — сезон, богатство, курсове, компании, бази',
  '`/борса град` — най-добрите товари от град',
  '',
  '**Със свързан акаунт**',
  '`/камиони` — къде са камионите ти · `/курс` — пусни камион на курс',
  '`/пазар` — продай стока от склада · `/търг` — оферта за специален товар',
  '`/мисии` — мисиите и наградите · `/дневна` — дневната награда',
  '`/ивент` · `/битка` — ивентът и битката на компанията ти',
  '`/покани @член` — покани в компанията си',
  '`/карта` — камионите ти на картата · `/финанси` — седмицата в пари',
  '`/конвой` — обяви курса си в #конвои · `/дуел [@член]` — седмица 1 срещу 1',
  '`/пропуск` — сезонният пропуск и наградите',
  '`/рекорди [играч]` — рекордите на линиите · `/албум [играч]` — колекцията от градове',
  '',
  '**Сървърът**',
  '`/ранг [член]` · `/топ` — нивото ти в сървъра и най-активните',
  '`/тикет` — помощ от екипа · `/свързване` — свържи Discord с играта',
  '🎭 #роли — известията ти · 🎁 #раздавания · 🧠 #викторина · 📸 #снимки (конкурс всяка седмица)',
  '➕ „Създай стая“ — твой гласов канал · 🚚 „Конвой“ — бонус за конвой в играта',
  '⭐ #товар-на-деня (12:00) · 🏷️ #пазар-камиони · 🎨 #ливреи — конкурс всеки месец',
].join('\n');

export const STAFF_HELP = [
  '**Модерация** (право Moderate Members)',
  '`/предупреждение @член причина` · `/заглуши @член минути причина [и-в-играта]`',
  '`/наказания @член` — история · `/екип-статистика` — тикети, отговори, наказания',
  '',
  '**Банове** (право Ban Members)',
  '`/бан @член причина [изтрий-съобщенията]` · `/разбани @член`',
  '',
  '**Сървърът** (право Manage Server)',
  '`/раздаване награда часове заглавие [победители]` — раздаване на ТрансКоин',
  '`/ивент-старт шаблон [часове]` — ивент в играта (админ в играта)',
  '',
  '**Автоматично**',
  '🛡️ Автомодерация: покани, масово споменаване, линкове от нови, спам',
  '📝 Обжалванията идват в #банове и #предупреждения с бутони',
  `⚙️ Подреждане, проверка на новите и автомодерация: ${appUrl()}/admin/system`,
].join('\n');

export function helpView(ctx: Ctx): Answer {
  const staff = hasPerm(ctx, PERM.moderate) || hasPerm(ctx, PERM.ban) || hasPerm(ctx, PERM.manageGuild);
  return answer(reply({
    embeds: [
      { title: '🚚 Команди за играчите', color: BRAND, description: PLAYER_HELP, footer },
      ...(staff ? [{ title: '🛡️ Команди за екипа', color: 0xe04545, description: STAFF_HELP, footer: { text: 'Виждаш това, защото имаш права в сървъра' } }] : []),
    ],
  }, true));
}

/** /ивент-старт: one of the automatic events, now (administrators of the game). */
export async function eventStart(ctx: Ctx): Promise<Answer> {
  if (!hasPerm(ctx, PERM.manageGuild)) stop('Само за екипа.');
  const me = linked(ctx);
  if (!isAdmin(me.role)) stop('Ивентите в играта пускат администраторите на играта.');
  const id = opt(ctx.i, 'шаблон') ?? '';
  const hours = Math.round(Number(opt(ctx.i, 'часове') ?? 72));
  try {
    const e = await startTemplateEvent(ctx.db, { id: me.id, role: me.role, username: me.username }, id, hours, ctx.now);
    return answer(reply({ content: `🎯 Ивентът „${e.name}“ започна за ${hours} ч. Обявлението излиза в #ивенти до минута.` }, true));
  } catch (error) {
    if (error instanceof GameError) stop(`⚠️ ${error.message}`);
    throw error;
  }
}

export const EVENT_TEMPLATE_CHOICES = EVENT_TEMPLATES.slice(0, 25).map((t) => ({ name: t.name.slice(0, 100), value: t.id }));
