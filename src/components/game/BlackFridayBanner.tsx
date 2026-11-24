import Link from 'next/link';
import { BLACK_FRIDAY, BLACK_FRIDAY_MORE, blackFridayPhase } from '@/lib/game/prewinter';
import { t } from '@/i18n/t';

/** 1.3.2.4: the dashboard banner — Black Friday is coming (the last days before), then on (to the shop). */
export function BlackFridayBanner({ now }: { now: Date }) {
  const phase = blackFridayPhase(now);
  if (!phase) return null;
  const off = Math.round(BLACK_FRIDAY.discount * 100);
  const more = Math.round(BLACK_FRIDAY_MORE.packBonus * 100);
  return (
    <Link href="/game/shop" className="block overflow-hidden rounded-2xl border border-gold-400/60 bg-gradient-to-r from-black via-asphalt-950 to-gold-400/20 p-4 transition hover:border-gold-300" data-testid="black-friday-banner">
      <p className="font-display text-lg font-bold text-gold-300">🛍 {phase.phase === 'on' ? t('Черен петък тече — до 30 ноември') : phase.days === 1 ? t('Черен петък започва утре') : t('Черен петък идва след {0} дни', phase.days)}</p>
      <p className="mt-1 text-sm text-mist-200">{t('−{0}% на почти всичко за ТрансКоин (и на частите и премиум камионите), +{1}% TC на всеки пакет и Пакет „Черен петък“ само за 4 дни.', off, more)}</p>
      <p className="mt-2 text-xs font-semibold text-gold-300">{phase.phase === 'on' ? t('Към магазина →') : t('Запиши си датата: 27–30 ноември')}</p>
    </Link>
  );
}
