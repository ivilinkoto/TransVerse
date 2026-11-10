import { ItemArt } from '@/components/game/ItemArt';
import { date, int, money } from '@/lib/format';
import type { winterTrekView } from '@/server/game/winter-trek';
import { t, tx } from '@/i18n/t';

type Trek = NonNullable<Awaited<ReturnType<typeof winterTrekView>>>;

/**
 * 1.3 „Зимен поход“: seven winter steps as a trail of pins — done, the current
 * one with its progress, the ones waiting for their day — and the paint „Скреж“
 * at the end.
 */
export function WinterTrek({ trek }: { trek: Trek }) {
  const current = trek.steps.find((s) => s.state === 'current');
  const next = trek.steps.find((s) => s.state === 'locked' || s.state === 'waiting');
  const share = current ? current.progress / current.target : 0;
  return (
    <section className="trek-card relative overflow-hidden rounded-3xl p-4 sm:p-5" data-testid="winter-trek">
      <div className="trek-snow pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-sky-200">❄️ {t('Зимен поход')}</p>
          <h2 className="font-display text-xl font-bold text-white">{trek.finished ? t('Извървян докрай!') : t('Стъпка {0} от {1}', Math.min(trek.done + 1, trek.total), trek.total)}</h2>
          <p className="text-xs text-sky-100/70">{t('По една нова стъпка всеки ден. Броят се курсовете, които караш сам. До {0}', date(trek.endsAt))}</p>
        </div>
        <div className="flex items-center gap-2 rounded-2xl bg-white/5 px-3 py-2">
          <ItemArt id="paint_frost" className="h-10 w-10" />
          <div className="text-xs">
            <div className="font-bold text-sky-100">{t('Боя „Скреж“')}</div>
            <div className="text-sky-100/60">{t('накрая')}</div>
          </div>
        </div>
      </div>

      <ol className="relative mt-4 flex items-start justify-between gap-1" aria-label={t('Стъпки')}>
        <span className="trek-line absolute left-4 right-4 top-[1.15rem]" aria-hidden />
        {trek.steps.map((s) => (
          <li key={s.index} className="relative flex min-w-0 flex-1 flex-col items-center text-center">
            <span className={`trek-pin trek-pin-${s.state} flex h-9 w-9 items-center justify-center rounded-full text-base`} title={tx(s.label)}>
              {s.state === 'done' ? '✓' : s.state === 'locked' ? '🔒' : s.emoji}
            </span>
            <span className="mt-1 text-[10px] font-semibold text-sky-100/70">{s.state === 'locked' ? s.opensOn.slice(8, 10) + '.' + s.opensOn.slice(5, 7) : int(s.index + 1)}</span>
          </li>
        ))}
      </ol>

      {current && (
        <div className="relative mt-4 rounded-2xl bg-white/5 p-3" data-testid="winter-trek-current">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-white">{current.emoji} {tx(current.label)}</span>
            <span className="num text-sm font-bold text-sky-200">{int(current.progress)} / {int(current.target)}</span>
          </div>
          <div className="trek-track mt-2 h-2.5 overflow-hidden rounded-full" role="meter" aria-valuemin={0} aria-valuemax={current.target} aria-valuenow={current.progress} aria-label={tx(current.label)}>
            <div className="trek-fill h-full rounded-full" style={{ width: `${Math.round(share * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-sky-100/70">
            {t('Награда: {0}', money(current.cents))}
            {current.coins > 0 && ` · ${t('{0} TC', current.coins)}`}
            {current.item && ` · ${t('Боя „Скреж“')}`}
          </p>
        </div>
      )}
      {!current && !trek.finished && next && (
        <p className="relative mt-4 rounded-2xl bg-white/5 p-3 text-sm text-sky-100/80" data-testid="winter-trek-wait">
          {t('Днешната стъпка е готова. Следващата — „{0}“ — се отваря на {1}.', tx(next.label), next.opensOn.split('-').reverse().join('.'))}
        </p>
      )}
      {trek.finished && <p className="relative mt-4 text-sm text-sky-100/80">{t('Боята „Скреж“ е в инвентара ти — сложи я на собствен камион.')}</p>}
    </section>
  );
}
