import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { int } from '@/lib/format';
import { PASS_GUARDIAN, ROAD_SERVICE } from '@/lib/game/road-service';
import { gameContext } from '@/server/game/context';
import { passesToday, passGuardians, passLoads } from '@/server/game/road-service';
import { activeSeason } from '@/server/game/seasons';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Пътна служба') };
}

/** 1.4 „Пътна служба“: the real passes today, the salt and sand they need, and „Пазител на прохода“. */
export default async function RoadServicePage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.road_service) notFound();
  const [passes, loads, season] = await Promise.all([passesToday(db, now), passLoads(db, now), activeSeason(db, now)]);
  const guardians = await passGuardians(db, season.id);
  const label = { open: t('Отворен'), closed: t('Затворен'), opened: t('Отворен от играчите') } as const;
  const tone = { open: 'text-emerald-300', closed: 'text-red-300', opened: 'text-cyan-glow' } as const;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Пътна служба')} subtitle={t('Истинските планински проходи през зимата. Когато проход е затворен, сол и пясък до града под него го отварят за всички.')}
        help={t('Виелица, поледица или силен сняг затварят прохода, а курс през него чака снегорините. {0} т сол и пясък го отварят до края на деня.', ROAD_SERVICE.tonsToOpen)} />
      <Card title={t('Проходите днес')}>
        <ul className="divide-y divide-asphalt-800" data-testid="road-service-passes">
          {passes.map(({ pass, status, tons, need }) => (
            <li key={pass.id} className="py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-semibold">{tx(pass.name)} <span className="font-normal text-mist-400">· {int(pass.altitude)} м</span></span>
                <span className={`font-semibold ${tone[status]}`}>{label[status]}</span>
              </div>
              {status === 'closed' && (
                <>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-cyan-glow" style={{ width: `${Math.min(100, (tons / need) * 100)}%` }} /></div>
                  <p className="mt-1 text-xs text-mist-400">{t('{0} / {1} т сол и пясък · {2} товара на борсата', int(tons), int(need), loads.get(pass.id) ?? 0)}</p>
                </>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-mist-400">{t('Товарите са с етикет „❄️ Пътна служба“ в')} <Link href="/game/contracts" className="text-cyan-glow hover:underline">{t('Курсове')}</Link>. {t('Условията по пътищата са игрови данни по истинското време.')}</p>
      </Card>
      <Card title={t('🛡️ Пазител на прохода')}>
        <p className="mb-3 text-sm text-mist-300">{t('Тонове сол и пясък до затворени проходи този сезон. Първите трима взимат титли и {0}, {1} и {2} TC.', PASS_GUARDIAN.places[0].coins, PASS_GUARDIAN.places[1].coins, PASS_GUARDIAN.places[2].coins)}</p>
        {guardians.length === 0 ? <p className="text-sm text-mist-400">{t('Още никой не е отварял проход.')}</p> : (
          <ol className="space-y-1 text-sm" data-testid="pass-guardians">
            {guardians.map((k) => <li key={k.userId} className={`flex justify-between gap-2 ${k.userId === user.id ? 'font-semibold text-gold-300' : ''}`}><span>{k.place}. {k.username}</span><span className="num">{int(k.tons)} т</span></li>)}
          </ol>
        )}
      </Card>
    </div>
  );
}
