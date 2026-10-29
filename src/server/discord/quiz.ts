import { randomInt } from 'node:crypto';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import { km } from '@/lib/format';
import type { Database } from '@/server/db/client';
import { discordQuizAnswers, discordQuizzes } from '@/server/db/schema';
import { postCoins } from '@/server/game/coins';
import { notify } from '@/server/game/notify';
import { discord } from './api';
import { answer, stop, type Answer, type Ctx } from './context';
import { BRAND, discordConfig } from './config';
import { pingRoleFor } from './guild';
import { layoutChannel } from './layout';
import { button, rows, say, STYLE, update, type MessageData } from './ui';
import { t } from '@/i18n/t';

/**
 * #викторина: a question about the real map of the game every few hours
 * (bigger city, which country, how long the road is by truck — from the
 * GeoNames cities and the routed roads). One answer per member; the first
 * right answer of a linked player wins ТрансКоин. Closes after an hour.
 */

export const QUIZ = { prizeCoins: 5, everyMs: 3 * 3_600_000, openMs: 3_600_000, fromHour: 10, toHour: 22 } as const;
const LETTERS = ['🇦', '🇧', '🇨', '🇩'];
const sofiaHour = (now: Date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', hourCycle: 'h23' }).format(now));
const shuffle = <T,>(list: T[]) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
};

interface Question {
  question: string;
  options: string[];
  correct: number;
}

/** A question from the game's real geography: the kinds in random order, the first one the data allows (null when none). */
export async function makeQuestion(db: Database): Promise<Question | null> {
  for (const kind of shuffle([0, 1, 2])) {
    const q = await questionOfKind(db, kind);
    if (q) return q;
  }
  return null;
}

async function questionOfKind(db: Database, kind: number): Promise<Question | null> {
  if (kind === 0) {
    const { rows: cs } = await db.execute<{ name: string; population: number }>(sql`select name_bg as name, population from cities where population > 30000 order by random() limit 3`);
    if (cs.length < 3 || new Set(cs.map((c) => c.population)).size < 3) return null;
    const options = shuffle(cs);
    const best = options.reduce((m, c, i) => (c.population > options[m]!.population ? i : m), 0);
    return { question: t('Кой от тези градове има най-много жители?'), options: options.map((c) => c.name), correct: best };
  }
  if (kind === 1) {
    const { rows: c } = await db.execute<{ name: string; code: string; country: string }>(sql`select ci.name_bg as name, ci.country_code as code, co.name_bg as country from cities ci join countries co on co.code = ci.country_code where ci.population > 20000 order by random() limit 1`);
    const { rows: others } = await db.execute<{ country: string }>(sql`select co.name_bg as country from countries co where co.code <> ${c[0]?.code ?? ''} and exists (select 1 from cities where country_code = co.code) order by random() limit 3`);
    if (!c[0] || others.length < 3) return null;
    const options = shuffle([c[0].country, ...others.map((o) => o.country)]);
    return { question: t('В коя държава е град {0}?', c[0].name), options, correct: options.indexOf(c[0].country) };
  }
  // Only roads routed on the real network (not straight-line approximations).
  const { rows: r } = await db.execute<{ a: string; b: string; km: number }>(sql`select oc.name_bg as a, dc.name_bg as b, r.distance_km::float as km from routes r join cities oc on oc.id = r.from_city_id join cities dc on dc.id = r.to_city_id where r.provider = 'valhalla' and r.distance_km > 80 order by random() limit 1`);
  if (!r[0]) return null;
  const real = Math.round(r[0].km / 10) * 10;
  const wrong = [0.6, 1.4, 1.9].map((f) => Math.round((real * f) / 10) * 10).filter((x) => x !== real);
  const options = shuffle([real, ...wrong].slice(0, 4));
  return { question: t('Колко е пътят с камион от {0} до {1}?', r[0].a, r[0].b), options: options.map((x) => km(x)), correct: options.indexOf(real) };
}

function view(q: typeof discordQuizzes.$inferSelect, done?: { winner: string | null }): MessageData {
  return {
    embeds: [{
      title: `🧠 ${q.question}`,
      color: done ? 0x9aa3b2 : BRAND,
      description: `${q.options.map((o, i) => `${LETTERS[i]} ${i === q.correct && done ? `**${o}** ✅` : o}`).join('\n')}${done ? `\n\n${done.winner ? t('🏆 Първи позна <@{0}> — +{1} ТрансКоин', done.winner, q.prizeCoins) : t('Никой не позна навреме.')}` : t('\n\nПървият верен отговор (свързан акаунт) печели **{0} ТрансКоин**. Един опит.', q.prizeCoins)}`,
      footer: { text: t('Градовете и пътищата са истински (GeoNames, OpenStreetMap)') },
    }],
    components: done ? [] : rows(...q.options.map((o, i) => button(o, `quiz:${q.id}:${i}`, STYLE.secondary, LETTERS[i]))),
  };
}

/** Worker: a new question now and then (10:00–22:00), and closing the old one. */
export async function runQuiz(db: Database, now = new Date()) {
  if (!discordConfig().bot) return null;
  // Close what ran out without a winner.
  const stale = await db.select().from(discordQuizzes).where(and(isNull(discordQuizzes.closedAt), lte(discordQuizzes.closesAt, now)));
  for (const q of stale) {
    await db.update(discordQuizzes).set({ closedAt: now }).where(eq(discordQuizzes.id, q.id));
    if (q.channelId && q.messageId) await discord('PATCH', `/channels/${q.channelId}/messages/${q.messageId}`, view(q, { winner: null })).catch(() => undefined);
  }
  const hour = sofiaHour(now);
  if (hour < QUIZ.fromHour || hour >= QUIZ.toHour) return null;
  const [last] = await db.select({ at: discordQuizzes.createdAt }).from(discordQuizzes).orderBy(desc(discordQuizzes.createdAt)).limit(1);
  if (last && now.getTime() - last.at.getTime() < QUIZ.everyMs) return null;
  const channelId = await layoutChannel(db, 'викторина');
  if (!channelId) return null;
  const q = await makeQuestion(db);
  if (!q) return null;
  const [row] = await db.insert(discordQuizzes).values({ ...q, prizeCoins: QUIZ.prizeCoins, channelId, closesAt: new Date(now.getTime() + QUIZ.openMs), createdAt: now }).returning();
  const role = await pingRoleFor('quiz');
  const msg = await discord<{ id: string }>('POST', `/channels/${channelId}/messages`, { ...view(row!), ...(role ? { content: `<@&${role}>`, allowed_mentions: { parse: [], roles: [role] } } : {}) });
  await db.update(discordQuizzes).set({ messageId: msg.id }).where(eq(discordQuizzes.id, row!.id));
  return row!.id;
}

/** An answer button. */
export async function quizAnswer(ctx: Ctx, quizId: string, option: number): Promise<Answer> {
  const [q] = await ctx.db.select().from(discordQuizzes).where(eq(discordQuizzes.id, quizId));
  if (!q) stop(t('Няма такъв въпрос.'));
  if (q!.closedAt || q!.closesAt <= ctx.now) stop(t('Въпросът вече е затворен.'));
  const tried = await ctx.db.insert(discordQuizAnswers).values({ quizId, discordUserId: ctx.discordId, option, createdAt: ctx.now }).onConflictDoNothing().returning();
  if (!tried.length) stop(t('Вече отговори на този въпрос.'));
  if (option !== q!.correct) return answer(say(t('✖️ Грешно. Следващият въпрос е след няколко часа!')));
  if (!ctx.me) return answer(say(t('✅ Вярно! Свържи акаунта си в играта, за да печелиш ТрансКоин.')));
  const won = await ctx.db.transaction(async (tx) => {
    const [w] = await tx.update(discordQuizzes).set({ winnerUserId: ctx.me!.id, winnerDiscordId: ctx.discordId, closedAt: ctx.now }).where(and(eq(discordQuizzes.id, quizId), isNull(discordQuizzes.closedAt))).returning();
    if (!w) return null;
    await postCoins(tx, ctx.me!.id, { amount: w.prizeCoins, reason: 'quiz', description: t('Викторина в Discord'), idempotencyKey: `quiz:${quizId}` });
    await notify(tx, ctx.me!.id, 'success', () => t('Позна във викторината! 🧠'), () => t('+{0} ТрансКоин.', w.prizeCoins), '/game/shop');
    return w;
  });
  if (!won) return answer(say(t('✅ Вярно — но някой те изпревари!')));
  return answer(update(view(won, { winner: ctx.discordId })));
}

