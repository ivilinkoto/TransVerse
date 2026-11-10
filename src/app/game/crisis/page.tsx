import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { inArray } from 'drizzle-orm';
import { PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { CRISES, CRISIS_RULES } from '@/lib/game/crises';
import { date, dec, int } from '@/lib/format';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { crisisView } from '@/server/game/crises';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Световни кризи') };
}

/** 1.3 „Световни кризи“: the crisis now (story, goal, vote) or its week of effect, else the next one. */
export default async function CrisisPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.world_crises) notFound();
  const v = await crisisView(db, user.id, now);
  const codes = Object.values(CRISES).flatMap((c) => [c.country, c.options.a.country, c.options.b.country]);
  const names = new Map((await db.select({ code: countries.code, name: countries.nameBg }).from(countries).where(inArray(countries.code, codes))).map((c) => [c.code, tx(c.name)]));
  const header = <PageHeader title={t('Световни кризи')} subtitle={t('Три дни криза, общо гласуване и седмица последствия.')} help={t('Всеки ден: обща цел от {0} т до засегнатата държава. Изходът с повече гласове дава бонус за курсовете до своята държава {1} дни — пълен при поне {2} изпълнени цели.', CRISIS_RULES.dailyTons, CRISIS_RULES.effectDays, CRISIS_RULES.bonus.goalsForFull)} />;
  if (!v.moment) {
    const next = CRISES[v.next.id]!;
    return (
      <div className="space-y-4">
        {header}
        <section className="crisis-card rounded-3xl p-5" data-testid="crisis-next">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-amber-300">{t('Следващата криза')}</p>
          <h2 className="mt-1 font-display text-2xl font-bold text-white">{next.emoji} {tx(next.title)}</h2>
          <p className="text-sm text-mist-300">{t('Започва на {0} · {1}', v.next.day.split('-').reverse().join('.'), names.get(next.country) ?? next.country)}</p>
        </section>
      </div>
    );
  }
  const { moment: m, def, state, myVote, goalsMet, outcome } = v;
  const total = state.votes.a + state.votes.b;
  const pct = (n: number) => (total ? Math.round((n / total) * 100) : 0);
  const today = m.phase === 'crisis' ? state.tons[m.dayIndex] ?? 0 : 0;
  return (
    <div className="space-y-4">
      {header}
      <section className="crisis-card space-y-3 rounded-3xl p-5" data-testid="crisis-now">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-2xl font-bold text-white">{def.emoji} {tx(def.title)}</h2>
          <span className="rounded-full bg-black/30 px-3 py-1 text-xs font-bold text-amber-200">{m.phase === 'crisis' ? t('Ден {0} от {1}', m.dayIndex + 1, CRISIS_RULES.crisisDays) : t('Последствия до {0}', date(v.effectEnds))}</span>
        </div>
        <ol className="space-y-2">
          {def.days.slice(0, m.phase === 'crisis' ? m.dayIndex + 1 : 3).map((text, i) => (
            <li key={i} className={`crisis-day rounded-2xl p-3 text-sm ${m.phase === 'crisis' && i === m.dayIndex ? 'crisis-day-now text-white' : 'text-mist-300'}`}>
              <span className="mr-2 font-bold text-amber-300">{t('Ден {0}', i + 1)}</span>{tx(text)}
              <span className="ml-2 text-xs text-mist-400">{(state.tons[i] ?? 0) >= CRISIS_RULES.dailyTons ? '✅' : m.phase === 'crisis' && i === m.dayIndex ? '' : '✖'} {dec(state.tons[i] ?? 0)} / {CRISIS_RULES.dailyTons} т</span>
            </li>
          ))}
        </ol>
        {m.phase === 'crisis' && (
          <div>
            <div className="flex justify-between text-xs text-mist-300"><span>{t('Днешна цел: курсове до {0}', names.get(def.country) ?? def.country)}</span><span className="num">{dec(today)} / {CRISIS_RULES.dailyTons} т</span></div>
            <div className="stat-track mt-1"><div className="stat-fill" style={{ width: `${Math.min(100, (today / CRISIS_RULES.dailyTons) * 100)}%`, '--fill': '#f59e0b' } as React.CSSProperties} /></div>
          </div>
        )}
      </section>

      {outcome ? (
        <section className="panel space-y-1 p-4" data-testid="crisis-outcome">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-profit">{t('Общността реши')}</p>
          <p className="font-display text-xl font-bold text-white">{tx(def.options[outcome.option].label)}</p>
          <p className="text-sm text-mist-200">{t('+{0}% за курсовете до {1} до {2}.', Math.round(outcome.share * 100), names.get(def.options[outcome.option].country) ?? def.options[outcome.option].country, date(v.effectEnds))}</p>
          <p className="text-xs text-mist-400">{t('Изпълнени цели: {0} от {1}.', goalsMet, CRISIS_RULES.crisisDays)}</p>
        </section>
      ) : (
        <section className="grid gap-3 md:grid-cols-2" data-testid="crisis-vote">
          {(['a', 'b'] as const).map((k) => {
            const o = def.options[k];
            return (
              <div key={k} className={`crisis-option space-y-2 rounded-3xl p-4 ${myVote === k ? 'crisis-option-mine' : ''}`}>
                <p className="font-display text-lg font-bold text-white">{tx(o.label)}</p>
                <p className="text-sm text-mist-300">{tx(o.text)}</p>
                <div className="stat-track"><div className="stat-fill" style={{ width: `${pct(state.votes[k])}%`, '--fill': k === 'a' ? '#22d3ee' : '#a78bfa' } as React.CSSProperties} /></div>
                <p className="text-xs text-mist-400">{t('{0} гласа · {1}%', int(state.votes[k]), pct(state.votes[k]))}</p>
                {!myVote ? <ActionButton action={{ type: 'voteCrisis', option: k }} className="game-action game-action-main flex-row px-4 py-2 text-xs">{t('Гласувай')}</ActionButton> : myVote === k ? <p className="text-xs font-bold text-profit">✓ {t('Твоят глас')}</p> : null}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}
