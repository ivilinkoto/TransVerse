import Link from 'next/link';
import { CheckCircle2, Circle, Flag } from 'lucide-react';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, Meter, PageHeader } from '@/components/ui';
import { BIG_RUN } from '@/lib/game/big-run';
import { bigRunOf, bigRunProgress } from '@/server/game/big-run';
import { gameContext } from '@/server/game/context';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Голям рейс') };
}

/** 1.1.4.1 „Голям рейс“: the week's three legs through Europe. Game data. */
export default async function BigRunPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.big_run) notFound();
  const run = await bigRunOf(db, now);
  const done = await bigRunProgress(db, user.id, run);
  const count = done.filter(Boolean).length;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Голям рейс')} subtitle={t('Три етапа през Европа тази седмица — в какъвто ред искаш. Игрови данни.')} />
      <Card title={t('Седмица {0}', run.week.slice(1))} actions={<span className="num text-sm text-gold-400">{t('{0} от {1}', count, run.legs.length)}</span>}>
        {!run.legs.length ? <p className="text-sm text-mist-400">{t('Рейсът за седмицата още се подготвя.')}</p> : (
          <>
            <Meter value={(count / run.legs.length) * 100} tone="gold" />
            <ol className="mt-4 space-y-2">
              {run.legs.map((leg, i) => (
                <li key={`${leg.from.id}-${leg.to.id}`} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${done[i] ? 'border-profit/40 bg-profit/5' : 'border-asphalt-700'}`}>
                  {done[i] ? <CheckCircle2 className="h-5 w-5 shrink-0 text-profit" /> : <Circle className="h-5 w-5 shrink-0 text-mist-500" />}
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="label mr-2">{t('Етап {0}', i + 1)}</span>
                    <span className="font-semibold">{tx(leg.from.nameBg)} ({leg.from.countryCode}) → {tx(leg.to.nameBg)} ({leg.to.countryCode})</span>
                  </span>
                  {!done[i] && <Link href={`/game/contracts?repeat=${leg.from.id}-${leg.to.id}`} className="btn-primary px-3 py-1.5 text-xs"><Flag className="h-3.5 w-3.5" />{t('Товари')}</Link>}
                </li>
              ))}
            </ol>
          </>
        )}
      </Card>
      <Card title={t('Награда')}>
        <p className="text-sm text-mist-300">{t('+{0} ТрансКоин всяка седмица и значка „Голям рейс“ първия път. Товарите по етапите плащат +{1}%.', BIG_RUN.coins, Math.round((BIG_RUN.multiplier - 1) * 100))}</p>
      </Card>
    </div>
  );
}
