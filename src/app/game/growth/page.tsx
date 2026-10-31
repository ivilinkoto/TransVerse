import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { brandColor } from '@/lib/game/ads';
import { CO2 } from '@/lib/game/co2';
import { dateTime, dec, int, money } from '@/lib/format';
import { MAX_TECH_LEVEL, TECHS, techCost, techEffect } from '@/lib/game/research';
import { OFFICE_MAX_LEVEL, OFFICE_ROLES, OFFICE_ROLE_IDS, OFFICE_TRAITS, officeSalaryCents, officeTrainCents } from '@/lib/game/office';
import { adsFor } from '@/server/game/ads';
import { co2Of } from '@/server/game/co2';
import { gameContext } from '@/server/game/context';
import { FUEL_LOCK, averageDieselCents, fuelLocksOf } from '@/server/game/fuel-hedge';
import { officeOf } from '@/server/game/office';
import { researchOf } from '@/server/game/research';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Развитие') };
}

/** 1.1.4.2: how the company grows besides more trucks — research, the office, adverts, fuel and CO₂. Game data. */
export default async function GrowthPage() {
  await initLocale();
  const { db, company, now, features } = await gameContext();
  if (!features.research && !features.office && !features.trailer_ads && !features.fuel_hedge && !features.co2) notFound();
  const [tech, office, ads, locks, co2] = await Promise.all([
    features.research ? researchOf(db, company.id, now) : [],
    features.office ? officeOf(db, company.id) : [],
    features.trailer_ads ? adsFor(db, company.id, now) : { offers: [], ads: [] },
    features.fuel_hedge ? fuelLocksOf(db, company.id, now) : [],
    features.co2 ? co2Of(db, company.id, now) : null,
  ]);
  const busy = tech.find((r) => r.busyUntil);
  const diesel = averageDieselCents(now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Развитие')} subtitle={t('Технологии, офис, реклама, гориво и CO₂ — компанията расте не само с камиони. Игрови данни.')} />

      {features.research && (
        <Card title={t('🔬 Развойна дейност')} actions={busy ? <Badge tone="cyan">{t('Изследва се до {0}', dateTime(busy.busyUntil!))}</Badge> : null}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {tech.map((r) => {
              const info = TECHS[r.tech];
              const next = techCost(r.level + 1);
              return (
                <li key={r.tech} className="rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{info.emoji} {tx(info.label)}</span>
                    <span className="num text-xs text-mist-400">{t('ниво {0} от {1}', r.level, MAX_TECH_LEVEL)}</span>
                  </div>
                  <p className="mt-1 text-xs text-mist-400">{tx(info.effect)} · {t('сега {0}%', dec(techEffect(r.tech, r.level) * 100))}</p>
                  <Meter value={(r.level / MAX_TECH_LEVEL) * 100} className="mt-2" />
                  {r.busyUntil ? <p className="mt-2 text-xs text-cyan-glow">{t('Изследва се — готово {0}', dateTime(r.busyUntil))}</p> : r.level < MAX_TECH_LEVEL ? (
                    <div className="mt-2"><ActionButton action={{ type: 'startResearch', tech: r.tech }} disabled={!!busy} className="btn-ghost px-3 py-1 text-xs">{t('Ниво {0}: {1} · {2} ч', r.level + 1, money(next.cents), next.hours)}</ActionButton></div>
                  ) : <p className="mt-2 text-xs text-profit">{t('✓ Най-високо ниво')}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {features.office && (
        <Card title={t('🏢 Офис')}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {OFFICE_ROLE_IDS.map((role) => {
              const info = OFFICE_ROLES[role];
              const p = office.find((o) => o.role === role);
              const trait = p ? OFFICE_TRAITS.find((x) => x.id === p.trait) : null;
              return (
                <li key={role} className="rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{info.emoji} {tx(info.label)}</span>
                    {p && <span className="num text-xs text-mist-400">{t('ниво {0}', p.level)}</span>}
                  </div>
                  <p className="mt-1 text-xs text-mist-400">{tx(info.effect)}</p>
                  {p ? (
                    <>
                      <p className="mt-2">{p.name}{trait && <span className="text-xs text-mist-400"> · {tx(trait.label)} — {tx(trait.line)}</span>}</p>
                      <p className="num text-xs text-mist-400">{t('Заплата {0} на ден', money(p.salaryCentsPerDay))}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {p.level < OFFICE_MAX_LEVEL && <ActionButton action={{ type: 'officeTrain', role }} className="btn-ghost px-3 py-1 text-xs">{t('Обучи ({0})', money(officeTrainCents(p.level + 1)))}</ActionButton>}
                        <ActionButton action={{ type: 'officeFire', role }} confirm={t('Да освободим ли {0}?', p.name)} className="btn-ghost px-3 py-1 text-xs">{t('Освободи')}</ActionButton>
                      </div>
                    </>
                  ) : (
                    <div className="mt-2"><ActionButton action={{ type: 'officeHire', role }} className="btn-primary px-3 py-1 text-xs">{t('Назначи ({0} на ден)', money(officeSalaryCents(1)))}</ActionButton></div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-xs text-mist-400">{t('Заплатите се плащат всеки ден заедно с тези на шофьорите (не и в отпуска).')}</p>
        </Card>
      )}

      {features.trailer_ads && (
        <Card title={t('📣 Реклама по ремаркето')}>
          {ads.ads.length > 0 && (
            <ul className="mb-4 space-y-2">
              {ads.ads.map((a) => (
                <li key={a.id} className="rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: brandColor(a.brand) }} />{tx(a.brand)}</span>
                    {a.status === 'done' ? <Badge tone="green">{t('Изпълнена')}</Badge> : a.status === 'failed' ? <Badge tone="red">{t('Изтекла')}</Badge> : <span className="text-xs text-mist-400">{t('до {0}', dateTime(a.endsAt))}</span>}
                  </div>
                  <p className="num mt-1 text-xs text-mist-400">{t('{0} / {1} км в {2}{3} · {4}', int(a.progressKm), int(a.targetKm), a.country, a.rule === 'on_time' ? t(' (само навреме)') : '', money(a.payCents))}</p>
                  <Meter value={(a.progressKm / a.targetKm) * 100} tone="gold" className="mt-1" />
                </li>
              ))}
            </ul>
          )}
          <p className="label mb-2">{t('Оферти тази седмица')}</p>
          <ul className="grid gap-2 sm:grid-cols-3">
            {ads.offers.map((o) => (
              <li key={o.key} className="rounded-xl border border-asphalt-700 p-3 text-sm">
                <p className="flex items-center gap-2 font-semibold"><span className="h-3 w-3 rounded-full" style={{ background: o.color }} />{tx(o.brand)}</p>
                <p className="num mt-1 text-xs text-mist-400">{t('{0} км в {1} за 7 дни{2}', int(o.targetKm), o.country, o.rule === 'on_time' ? t(' · само курсове навреме') : '')}</p>
                <p className="num mt-1 text-profit">{money(o.payCents)}</p>
                <div className="mt-2"><ActionButton action={{ type: 'takeAd', key: o.key }} className="btn-ghost px-3 py-1 text-xs">{t('Приеми')}</ActionButton></div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mist-400">{t('Марките са измислени. Броят се километрите с товар по маршрути през държавата.')}</p>
        </Card>
      )}

      {features.fuel_hedge && (
        <Card title={t('⛽ Гориво напред')}>
          <p className="text-sm text-mist-300">{t('Днес: {0} / л. Курсовете за 7 дни горят първо купеното, остатъкът се връща по цената на деня.', money(diesel))}</p>
          {locks.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {locks.map((l) => <li key={l.id} className="num">{t('{0} от {1} л по {2} · до {3}', int(l.litresLeft), int(l.litres), money(l.priceCents), dateTime(l.endsAt))}</li>)}
            </ul>
          )}
          <div className="mt-3"><FormAction action={{ type: 'lockFuel' }} fields={[{ name: 'litres', label: t('Литри'), type: 'number', defaultValue: 2000, min: FUEL_LOCK.minLitres, max: FUEL_LOCK.maxLitres, step: 100 }]} submit={t('Купи')} /></div>
        </Card>
      )}

      {co2 && (
        <Card title={t('🌱 CO₂ квоти')}>
          <p className="num text-sm">{t('Тази седмица: {0} от {1} т', dec(co2.kg / 1000), dec(co2.quotaKg / 1000))}</p>
          <Meter value={Math.min(100, (co2.kg / co2.quotaKg) * 100)} className="mt-1" />
          <p className="mt-2 text-xs text-mist-400">{t('Дизел: 2,64 кг CO₂ на литър, електрическите: 0. В понеделник неизползваното става кредити, надвишението струва {0}/т.', money(CO2.marketSellCents))}</p>
          <p className="num mt-3 text-sm">{t('Твоите кредити: {0} т', dec(co2.credits))}</p>
          {co2.credits > 0 && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <FormAction action={{ type: 'co2Sell' }} fields={[{ name: 'tonnes', label: t('Продай на пазара по {0}/т', money(CO2.marketBuyCents)), type: 'number', defaultValue: Math.floor(co2.credits * 10) / 10, step: 0.1, min: 0.1 }]} submit={t('Продай')} />
              <FormAction action={{ type: 'co2List' }} fields={[{ name: 'tonnes', label: t('Тона за играчите'), type: 'number', defaultValue: Math.floor(co2.credits * 10) / 10, step: 0.1, min: 0.1 }, { name: 'priceLev', label: t('Цена лв./т'), type: 'number', defaultValue: 80, min: CO2.minPriceCents / 100, max: CO2.maxPriceCents / 100 }]} submit={t('Обяви')} />
            </div>
          )}
          {co2.listings.length > 0 && (
            <>
              <p className="label mb-1 mt-4">{t('Оферти на играчите')}</p>
              <ul className="space-y-1 text-sm">
                {co2.listings.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2">
                    <span className="num">{t('{0} т по {1}', dec(l.tonnes), money(l.priceCents))}</span>
                    {l.companyId === company.id ? <ActionButton action={{ type: 'co2Cancel', id: l.id }} className="btn-ghost px-2 py-0.5 text-xs">{t('Махни')}</ActionButton> : <ActionButton action={{ type: 'co2Buy', id: l.id }} className="btn-ghost px-2 py-0.5 text-xs">{t('Купи за {0}', money(Math.round(l.tonnes * l.priceCents)))}</ActionButton>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      )}
    </div>
  );
}
