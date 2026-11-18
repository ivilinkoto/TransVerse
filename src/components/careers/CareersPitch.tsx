import { CAREER_FAQ, CAREER_STEPS, CAREER_TIPS, CAREER_TRAITS, CAREERS } from '@/lib/game/careers';
import { t, tx } from '@/i18n/t';

/** 1.3.1 „Екипът“: the top of the „Кариери в TransVerse“ page — who we look for and how applying works. */
export function CareersIntro() {
  const facts = [
    { icon: '🏠', title: t('От вкъщи'), body: t('Работиш дистанционно, когато ти е удобно.') },
    { icon: '🧭', title: t('Не е нужен опит'), body: t('За тестерите и модераторите стигат желание и редовност.') },
    { icon: '🎂', title: t('От {0} години', CAREERS.minAge), body: t('Кандидатстват играчи на {0} или повече години.', CAREERS.minAge) },
  ];
  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-glow">{t('Екипът на TransVerse')}</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-white">{t('TransVerse набира екип')}</h2>
        <p className="mt-2 max-w-3xl text-mist-300">{t('Събираме малък и сериозен екип, който да прави TransVerse по-добра и по-стабилна. Търсим най-вече от нашите играчи — хора, които познават и обичат играта.')}</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-3">
        {facts.map((f) => (
          <li key={f.title} className="rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-3">
            <p className="font-semibold text-white"><span aria-hidden className="mr-1.5">{f.icon}</span>{f.title}</p>
            <p className="mt-1 text-xs text-mist-400">{f.body}</p>
          </li>
        ))}
      </ul>
      <div>
        <p className="font-semibold text-white">{t('Как протича')}</p>
        <ol className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="career-steps">
          {CAREER_STEPS.map((s, i) => (
            <li key={s.title} className="rounded-xl border border-cyan-glow/20 bg-cyan-glow/5 p-3">
              <p className="flex items-center gap-2 font-semibold text-white">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cyan-glow/15 text-xs font-bold text-cyan-glow">{i + 1}</span>
                {tx(s.title)}
              </p>
              <p className="mt-1.5 text-xs text-mist-300">{tx(s.body)}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** Beside the form: what we look for and how to write a good application. */
export function CareersGuide() {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="font-semibold text-white">{t('Какво търсим')}</p>
        <ul className="mt-2 space-y-1.5 text-mist-300">
          {CAREER_TRAITS.map((x) => <li key={x} className="flex gap-2"><span aria-hidden className="text-emerald-300">✓</span><span>{tx(x)}</span></li>)}
        </ul>
      </div>
      <div>
        <p className="font-semibold text-white">{t('Как да напишеш добра кандидатура')}</p>
        <ul className="mt-2 list-disc space-y-1.5 pl-5 text-mist-300">{CAREER_TIPS.map((x) => <li key={x}>{tx(x)}</li>)}</ul>
      </div>
    </div>
  );
}

/** The questions players ask about joining. */
export function CareersFaq() {
  return (
    <div className="divide-y divide-asphalt-800 text-sm" data-testid="career-faq">
      {CAREER_FAQ.map((f) => (
        <details key={f.q} className="group py-2.5 first:pt-0 last:pb-0">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 font-semibold text-white">
            {tx(f.q)}
            <span aria-hidden className="text-mist-500 transition group-open:rotate-45">+</span>
          </summary>
          <p className="mt-1.5 text-mist-300">{tx(f.a)}</p>
        </details>
      ))}
    </div>
  );
}
