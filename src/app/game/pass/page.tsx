import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { TruckPass } from '@/components/game/TruckPass';
import { date, int } from '@/lib/format';
import { PASS_LEVELS, PASS_POINTS_PER_LEVEL, PASS_PRICE_COINS } from '@/lib/game/season-pass';
import { gameContext } from '@/server/game/context';
import { passView } from '@/server/game/season-pass';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Сезонен пропуск') };
}

/** Before 1.2 its own page; from 1.2 „Truck Pass“ lives on the season page. */
export default async function PassPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (features.truck_pass) redirect('/game/seasons#pass');
  const p = await passView(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Сезонен пропуск')}
        subtitle={t('{0} · до {1}', p.season.name, date(p.season.endsAt))}
        help={t('Пропускът се пълни със сезонните точки от доставките ти ({0} точки на ниво, {1} нива). Всяко второ ниво има безплатна награда. Премиум линията ({2} TC за сезона) добавя награда на всяко ниво: пари, ТрансКоин, VIP дни и ×2 опит. Премиумът не дава сезонни точки и не влияе на класациите. Невзетите награди изгарят в края на сезона.', int(PASS_POINTS_PER_LEVEL), PASS_LEVELS, PASS_PRICE_COINS)}
      />
      <TruckPass db={db} userId={user.id} coins={user.coins} now={now} />
    </div>
  );
}
