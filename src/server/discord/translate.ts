import { featureLive } from '@/lib/game/features';
import { currentLocale, t } from '@/i18n/t';
import { answer, stop, type Answer, type Ctx } from './context';
import { say } from './ui';

/**
 * 1.1.3.4: "Преведи" (right click on a message → Apps): the message in the
 * reader's language, only for them. Through DeepL when DEEPL_API_KEY is set
 * (GitHub Secrets → the server); without it the command says it is off.
 */

const TARGET = { bg: 'BG', en: 'EN-GB', ru: 'RU' } as const;
export const translatorReady = () => !!process.env.DEEPL_API_KEY?.trim();

/** One text into one language; null when the service did not answer. */
export async function translateText(text: string, to: keyof typeof TARGET): Promise<{ text: string; from: string } | null> {
  const key = process.env.DEEPL_API_KEY?.trim();
  if (!key) return null;
  // Free keys end with ":fx" and have their own address.
  const base = key.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
  const res = await fetch(`${base}/v2/translate`, {
    method: 'POST',
    headers: { Authorization: `DeepL-Auth-Key ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ text, target_lang: TARGET[to] }).toString(),
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!res?.ok) return null;
  const data = (await res.json().catch(() => null)) as { translations?: { text: string; detected_source_language?: string }[] } | null;
  const first = data?.translations?.[0];
  return first ? { text: first.text, from: (first.detected_source_language ?? '').toUpperCase() } : null;
}

/** The message command. */
export async function translateMessage(ctx: Ctx): Promise<Answer> {
  if (!featureLive('discord_plus', ctx.now)) stop(t('Командата идва със следващото обновление.'));
  if (!translatorReady()) stop(t('Преводът още не е включен в този сървър.'));
  const id = ctx.i.data?.target_id ?? '';
  const content = (ctx.i.data?.resolved?.messages?.[id]?.content ?? '').trim();
  if (!content) stop(t('В това съобщение няма текст за превод.'));
  const lang = currentLocale();
  const done = await translateText(content.slice(0, 1500), lang);
  if (!done) stop(t('Преводът не стана — опитай пак след малко.'));
  return answer(say(t('🌐 Превод (от {0}):\n{1}', done!.from || '?', done!.text.slice(0, 1900))));
}
