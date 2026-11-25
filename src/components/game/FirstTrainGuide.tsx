import Link from 'next/link';
import { money } from '@/lib/format';
import { LICENCES } from '@/lib/game/licences';
import { TRAINS } from '@/lib/game/trains';
import { t } from '@/i18n/t';

interface Step {
  done: boolean;
  text: string;
  href?: string;
  cta?: string;
}

/**
 * 1.3.3 „Жп линия“: the first-train guide — the steps to the first run, by
 * hiring a train (from level 10) or with an own one (from VIP3), each ticked
 * as the player gets there. It goes away after the first finished run.
 */
export function FirstTrainGuide({ level, vipLevel, ownLevel, licensed, trains, wagons, line }: {
  level: number;
  vipLevel: number;
  /** The level an own train needs (lower in a company with the rail licence). */
  ownLevel: number;
  licensed: boolean;
  trains: number;
  wagons: number;
  line: boolean;
}) {
  const hire: Step[] = [
    { done: level >= TRAINS.hire.minLevel, text: t('Ниво {0}', TRAINS.hire.minLevel) },
    { done: false, text: t('Курсове → Влакове: избери гара и поръчка'), href: '/game/contracts/trains', cta: t('Към поръчките') },
    { done: false, text: t('Наеми влак на играта ({0}% от поръчката) или влак на играч — получаваш поръчката при пристигане', Math.round(TRAINS.hire.gameShare * 100)) },
  ];
  const own: Step[] = [
    { done: vipLevel >= TRAINS.vipLevel, text: t('VIP{0}', TRAINS.vipLevel), href: '/game/shop', cta: t('Магазин') },
    { done: level >= ownLevel, text: ownLevel > TRAINS.company.minLevel ? t('Ниво {0} (в компания с ЖП лиценз — от ниво {1})', ownLevel, TRAINS.company.minLevel) : t('Ниво {0}', ownLevel) },
    { done: licensed, text: t('ЖП лиценз ({0})', money(LICENCES.rail.priceCents)), href: '/game/licences', cta: t('Лицензи') },
    { done: trains > 0, text: t('Купи локомотив: Автопарк → Влакове'), href: '/game/trains', cta: t('Влакове') },
    { done: wagons > 0, text: t('Купи вагони: прозорецът на влака → Вагони') },
    { done: line, text: t('Вземи поръчка или пусни редовна линия, за да кара сам') },
  ];
  const list = (steps: Step[]) => (
    <ol className="space-y-1.5 text-sm">
      {steps.map((s, i) => (
        <li key={i} className={`flex items-start gap-2 ${s.done ? 'text-mist-400' : 'text-mist-100'}`}>
          <span className={`num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${s.done ? 'bg-profit/20 text-profit' : 'bg-white/10 text-mist-200'}`} aria-hidden>{s.done ? '✓' : i + 1}</span>
          <span className={s.done ? 'line-through decoration-mist-500/60' : ''}>{s.text}</span>
          {!s.done && s.href && s.cta && <Link href={s.href} className="ml-auto shrink-0 text-xs font-semibold text-cyan-glow hover:underline">{s.cta} →</Link>}
        </li>
      ))}
    </ol>
  );
  return (
    <section className="panel space-y-3 p-4" data-testid="first-train-guide">
      <div>
        <h2 className="font-display text-lg font-bold text-white">🚆 {t('Първият ти влак')}</h2>
        <p className="text-sm text-mist-300">{t('Два пътя до първия курс с влак. Тази карта изчезва след първия завършен курс.')}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2 rounded-xl bg-asphalt-900/60 p-3" data-testid="first-train-hire">
          <h3 className="text-sm font-semibold text-white">🤝 {t('Наеми влак — без собствен')}</h3>
          {list(hire)}
        </div>
        <div className="space-y-2 rounded-xl bg-asphalt-900/60 p-3" data-testid="first-train-own">
          <h3 className="text-sm font-semibold text-white">👑 {t('Собствен влак — от VIP{0}', TRAINS.vipLevel)}</h3>
          {list(own)}
        </div>
      </div>
    </section>
  );
}
