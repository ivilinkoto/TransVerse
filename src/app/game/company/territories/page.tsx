import { Flag } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { TERRITORY } from '@/lib/game/empire';
import { dec } from '@/lib/format';
import { countries } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { currentTerritories, weekRace } from '@/server/game/territories';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Територии') };
}

/** v2.0: the regions the company holds this week, the race for next week, and who holds what. */
export default async function TerritoriesPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.territories) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const [held, race, names] = await Promise.all([currentTerritories(db, now), weekRace(db, m.company.id, now), db.select({ code: countries.code, nameBg: countries.nameBg }).from(countries)]);
  const country = (code: string) => tx(names.find((n) => n.code === code)?.nameBg ?? code);
  const mine = held.filter((h) => h.organizationId === m.company.id);
  const regionName = (r: { region: string; regionBg?: string | null }) => tx(r.regionBg ?? r.region);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Територии')} subtitle={t('Компанията, докарала най-много тонове в една област за седмицата (поне {0} т), я държи следващата седмица: товарите на членовете ѝ дотам носят +{1} %. Игрови данни върху реалните области.', TERRITORY.minTons, Math.round(TERRITORY.bonusShare * 100))} />
      <Card title={<span className="flex items-center gap-2"><Flag className="h-5 w-5 text-gold-400" />{t('Нашите територии')}</span>}>
        {mine.length ? (
          <ul className="grid gap-2 text-sm sm:grid-cols-2">
            {mine.map((h) => <li key={`${h.countryCode}|${h.region}`} className="rounded-xl border border-asphalt-700 p-3"><b>{regionName(h)}</b> · {country(h.countryCode)} <span className="num text-mist-400">{t('{0} т', dec(h.tons))}</span></li>)}
          </ul>
        ) : (
          <p className="text-sm text-mist-400">{t('Тази седмица компанията не държи територия.')}</p>
        )}
      </Card>
      <Card title={t('Битката тази седмица')}>
        {race.length ? (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {race.map((r) => (
              <li key={`${r.countryCode}|${r.region}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{regionName(r)}</b> · {country(r.countryCode)}</span>
                <span className="text-xs text-mist-400">{t('Ние: {0} т · води „{1}“ с {2} т', dec(r.mine), r.leader, dec(r.leaderTons))}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mist-400">{t('Още няма доставки на членовете тази седмица.')}</p>
        )}
      </Card>
      <Card title={t('Кой какво държи')}>
        {held.length ? (
          <ul className="divide-y divide-asphalt-800 text-sm">
            {held.map((h) => (
              <li key={`${h.countryCode}|${h.region}`} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{regionName(h)} · {country(h.countryCode)}</span>
                <span className="font-semibold" style={{ color: h.color ?? undefined }}>{h.tag ? `[${h.tag}] ` : ''}{tx(h.name)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mist-400">{t('Още никой не държи територия.')}</p>
        )}
      </Card>
    </div>
  );
}
