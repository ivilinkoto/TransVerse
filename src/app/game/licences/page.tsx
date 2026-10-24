import { eq } from 'drizzle-orm';
import { BadgeCheck, CheckCircle2, Clock, Lock } from 'lucide-react';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, money } from '@/lib/format';
import { LICENCES, LICENCE_IDS } from '@/lib/game/licences';
import { userLicences } from '@/server/db/schema';
import { gameContext } from '@/server/game/context';
import { companyLicenceSet } from '@/server/game/licences';
import { membershipOf } from '@/server/game/membership';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Лицензи') };
}

export default async function LicencesPage() {
  await initLocale();
  const { db, user, company } = await gameContext();
  const owned = new Map((await db.select().from(userLicences).where(eq(userLicences.userId, user.id))).map((l) => [l.licence, l]));
  const membership = await membershipOf(db, user.id);
  const viaCompany = new Set(membership ? (await companyLicenceSet(db, membership.company.id)).map((l) => l.licence) : []);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Лицензи')}
        subtitle={t('Отключват международни, хладилни, опасни (ADR) и извънгабаритни товари.')}
        help={t('Някои поръчки изискват лиценз: международни курсове, митница извън ЕС, хладилни, опасни (ADR) и извънгабаритни товари. Лицензът се купува веднъж с личните ти пари и е завинаги. Компаниите също могат да купуват лицензи (на двойна цена) — тогава важат за всички членове.')}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {LICENCE_IDS.map((id) => {
          const l = LICENCES[id];
          const have = owned.get(id);
          const fromCompany = viaCompany.has(id);
          const needsPrereq = l.requires && !owned.has(l.requires) && !viaCompany.has(l.requires);
          const lowLevel = user.level < l.minLevel;
          return (
            <Card key={id} className={!l.available ? 'opacity-70' : ''} title={<span className="inline-flex items-center gap-2"><BadgeCheck className={`h-4 w-4 ${have || fromCompany ? 'text-profit' : 'text-mist-400'}`} />{tx(l.label)}</span>}>
              <p className="min-h-10 text-sm text-mist-300">{tx(l.description)}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <Badge tone="gold">{money(l.priceCents)}</Badge>
                <Badge tone={lowLevel ? 'violet' : 'neutral'}>{t('от ниво {0}', l.minLevel)}</Badge>
                {l.requires && <Badge tone={needsPrereq ? 'orange' : 'neutral'}>{t('изисква {0}', LICENCES[l.requires].short)}</Badge>}
              </div>
              <div className="mt-4">
                {have ? (
                  <p className="flex items-center gap-2 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />{t('Притежавате го{0} · от {1}', have.source === 'legacy' ? t(' (запазен от предишни курсове)') : '', date(have.acquiredAt))}</p>
                ) : fromCompany ? (
                  <p className="flex items-center gap-2 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />{t('Имаш го чрез компанията „{0}“ — важи, докато си член.', membership!.company.name)}</p>
                ) : !l.available ? (
                  <p className="flex items-center gap-2 text-sm text-mist-400"><Clock className="h-4 w-4" />{t('Скоро — когато в играта се появи този вид транспорт.')}</p>
                ) : lowLevel ? (
                  <p className="flex items-center gap-2 text-sm text-prestige"><Lock className="h-4 w-4" />{t('Достигнете ниво {0}.', l.minLevel)}</p>
                ) : needsPrereq ? (
                  <p className="flex items-center gap-2 text-sm text-amber-sig"><Lock className="h-4 w-4" />{t('Първо купете {0}.', LICENCES[l.requires!].label)}</p>
                ) : (
                  <ActionButton action={{ type: 'buyLicence', licence: id }} className="btn-gold" disabled={company.balanceCents < l.priceCents} confirm={t('Да платите {0} за {1}?', money(l.priceCents), l.label)}>
                    {company.balanceCents < l.priceCents ? t('Недостатъчно средства') : t('Купи · {0}', money(l.priceCents))}
                  </ActionButton>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
