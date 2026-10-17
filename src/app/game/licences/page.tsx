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

export const metadata = { title: 'Лицензи' };

export default async function LicencesPage() {
  const { db, user, company } = await gameContext();
  const owned = new Map((await db.select().from(userLicences).where(eq(userLicences.userId, user.id))).map((l) => [l.licence, l]));
  const membership = await membershipOf(db, user.id);
  const viaCompany = new Set(membership ? (await companyLicenceSet(db, membership.company.id)).map((l) => l.licence) : []);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Лицензи"
        subtitle="Някои поръчки изискват лиценз: международни курсове, митница извън ЕС, хладилни, опасни (ADR) и извънгабаритни товари. Лицензът се купува веднъж с личните ти пари и е завинаги. Компаниите също могат да купуват лицензи (на двойна цена) — тогава важат за всички членове."
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {LICENCE_IDS.map((id) => {
          const l = LICENCES[id];
          const have = owned.get(id);
          const fromCompany = viaCompany.has(id);
          const needsPrereq = l.requires && !owned.has(l.requires) && !viaCompany.has(l.requires);
          const lowLevel = user.level < l.minLevel;
          return (
            <Card key={id} className={!l.available ? 'opacity-70' : ''} title={<span className="inline-flex items-center gap-2"><BadgeCheck className={`h-4 w-4 ${have || fromCompany ? 'text-profit' : 'text-mist-400'}`} />{l.label}</span>}>
              <p className="min-h-10 text-sm text-mist-300">{l.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <Badge tone="gold">{money(l.priceCents)}</Badge>
                <Badge tone={lowLevel ? 'violet' : 'neutral'}>от ниво {l.minLevel}</Badge>
                {l.requires && <Badge tone={needsPrereq ? 'orange' : 'neutral'}>изисква {LICENCES[l.requires].short}</Badge>}
              </div>
              <div className="mt-4">
                {have ? (
                  <p className="flex items-center gap-2 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />Притежавате го{have.source === 'legacy' ? ' (запазен от предишни курсове)' : ''} · от {date(have.acquiredAt)}</p>
                ) : fromCompany ? (
                  <p className="flex items-center gap-2 text-sm text-profit"><CheckCircle2 className="h-4 w-4" />Имаш го чрез компанията „{membership!.company.name}“ — важи, докато си член.</p>
                ) : !l.available ? (
                  <p className="flex items-center gap-2 text-sm text-mist-400"><Clock className="h-4 w-4" />Скоро — когато в играта се появи този вид транспорт.</p>
                ) : lowLevel ? (
                  <p className="flex items-center gap-2 text-sm text-prestige"><Lock className="h-4 w-4" />Достигнете ниво {l.minLevel}.</p>
                ) : needsPrereq ? (
                  <p className="flex items-center gap-2 text-sm text-amber-sig"><Lock className="h-4 w-4" />Първо купете {LICENCES[l.requires!].label}.</p>
                ) : (
                  <ActionButton action={{ type: 'buyLicence', licence: id }} className="btn-gold" disabled={company.balanceCents < l.priceCents} confirm={`Да платите ${money(l.priceCents)} за ${l.label}?`}>
                    {company.balanceCents < l.priceCents ? 'Недостатъчно средства' : `Купи · ${money(l.priceCents)}`}
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
