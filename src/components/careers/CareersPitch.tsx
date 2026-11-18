import { CAREER_OFFER, CAREER_ROLES, CAREERS } from '@/lib/game/careers';
import { t, tx } from '@/i18n/t';

/** 1.3.1 „Екипът“: who we look for, what they do and get, how we choose (the „Кариери“ page). */
export function CareersPitch() {
  return (
    <div className="space-y-5 text-sm">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-cyan-glow">{t('Екипът на TransVerse')}</p>
        <h2 className="mt-1 font-display text-2xl font-bold text-white">{t('TransVerse търси хора')}</h2>
        <p className="mt-2 text-mist-300">{t('Събираме малък и сериозен екип, който да прави TransVerse по-добра и по-стабилна. Търсим най-вече от нашите играчи — хора, които познават и обичат играта.')}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
          <p className="font-semibold text-emerald-300">{t('Получаваш сега')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-mist-200">{CAREER_OFFER.now.map((x) => <li key={x}>{tx(x)}</li>)}</ul>
        </div>
        <div className="rounded-2xl border border-gold-400/30 bg-gold-400/5 p-4">
          <p className="font-semibold text-gold-300">{t('Честно за заплащането')}</p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-mist-200">{CAREER_OFFER.later.map((x) => <li key={x}>{tx(x)}</li>)}</ul>
        </div>
      </div>
      <div>
        <p className="font-semibold text-white">{t('Отворени позиции')}</p>
        <ul className="mt-2 space-y-2" data-testid="career-roles">
          {CAREER_ROLES.filter((r) => r.open || r.invite).map((r) => (
            <li key={r.id} className={`rounded-xl border p-3 ${r.invite ? 'border-gold-400/30 bg-gold-400/5' : 'border-asphalt-700 bg-asphalt-900/60'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold text-white">{r.emoji} {tx(r.label)}{r.invite && <span className="ml-2 rounded-full border border-gold-400/40 bg-gold-400/10 px-2 py-0.5 align-middle text-[11px] font-semibold text-gold-300">{t('по покана')}</span>}</span>
                <span className="text-xs text-mist-400">{tx(r.hours)}</span>
              </div>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-mist-300">{r.does.map((d) => <li key={d}>{tx(d)}</li>)}</ul>
              <p className="mt-1.5 text-xs text-mist-400">{tx(r.fits)}</p>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="font-semibold text-white">{t('Как избираме')}</p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-mist-300">{CAREER_OFFER.process.map((x) => <li key={x}>{tx(x)}</li>)}</ol>
        <p className="mt-2 text-xs text-mist-400">{t('За тестерите и модераторите не е нужен опит — нужни са желание и редовност. Кандидатстват играчи на {0} или повече години.', CAREERS.minAge)}</p>
      </div>
    </div>
  );
}
