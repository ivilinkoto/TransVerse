import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { notFound, redirect } from 'next/navigation';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { TextAction } from '@/components/ui/TextAction';
import { HOLDING } from '@/lib/game/empire';
import { int, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { holdingInvitesFor, holdingNetwork, holdingOf, holdingTable } from '@/server/game/holdings';
import { can, membershipOf } from '@/server/game/membership';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Холдинг') };
}

/** v2.0: the company's holding — its companies, the network, invitations and the ranking. */
export default async function HoldingPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.holdings) notFound();
  const m = await membershipOf(db, user.id);
  if (!m) redirect('/game/company');
  const manage = can(m.rank, 'manage_upgrades');
  const holding = await holdingOf(db, m.company.id);
  const [invites, network, table] = await Promise.all([holding ? [] : holdingInvitesFor(db, m.company.id, now), holding ? holdingNetwork(db, holding.id) : new Set<number>(), holdingTable(db, 20)]);
  const parent = holding?.parentId === m.company.id;
  return (
    <div className="space-y-6">
      <PageHeader title={t('Холдинг')} subtitle={t('Компания-майка и до {0} дъщерни компании. Товар до база или филиал на която и да е от тях носи +{1} % на шофьора; всеки понеделник дъщерните плащат на майката {2} % от вноските си за седмицата (игрови данни).', HOLDING.maxSubsidiaries, Math.round(HOLDING.networkShare * 100), Math.round(HOLDING.feeShare * 100))} />
      <Card title={<span className="flex items-center gap-2"><Building2 className="h-5 w-5 text-cyan-glow" />{holding ? tx(holding.name) : t('Без холдинг')}</span>}>
        {holding ? (
          <div className="space-y-3 text-sm">
            <ul className="divide-y divide-asphalt-800">
              {holding.companies.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/game/companies/${c.id}`} className="font-semibold hover:underline">{c.tag ? `[${c.tag}] ` : ''}{tx(c.name)}</Link>
                  <span className="flex items-center gap-2 text-xs text-mist-400">
                    {c.id === holding.parentId ? t('компания-майка') : t('дъщерна')} · {t('ниво {0}', c.level)}
                    {manage && parent && c.id !== holding.parentId && <ActionButton action={{ type: 'leaveHolding', organizationId: c.id }} className="btn-ghost text-loss py-1 text-xs" confirm={t('Да пуснем ли „{0}“ от холдинга?', c.name)}>{t('Пусни')}</ActionButton>}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-mist-300">{t('Мрежа: {0} града с база или филиал.', int(network.size))}</p>
            {manage && parent && holding.companies.length - 1 < HOLDING.maxSubsidiaries && <TextAction label={t('Покани')} action={{ type: 'inviteToHolding' }} field="target" placeholder={t('Таг или име на компания')} ariaLabel={t('Компания за холдинга')} />}
            {manage && (parent ? holding.companies.length === 1 : true) && (
              <ActionButton action={{ type: 'leaveHolding' }} className="btn-ghost text-loss" confirm={parent ? t('Да закрием ли холдинга?') : t('Компанията да напусне холдинга?')}>{parent ? t('Закрий холдинга') : t('Напусни холдинга')}</ActionButton>
            )}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            {invites.map((i) => (
              <div key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 p-3">
                <span>{t('Покана в холдинга „{0}“', i.holding)}</span>
                {manage && (
                  <span className="flex gap-2">
                    <ActionButton action={{ type: 'respondHoldingInvite', inviteId: i.id, accept: true }} className="btn-primary py-1">{t('Приеми')}</ActionButton>
                    <ActionButton action={{ type: 'respondHoldingInvite', inviteId: i.id, accept: false }} className="btn-ghost py-1">{t('Откажи')}</ActionButton>
                  </span>
                )}
              </div>
            ))}
            {manage && m.company.companyLevel >= HOLDING.minCompanyLevel ? (
              <TextAction label={t('Основи холдинг ({0})', money(HOLDING.foundCents))} action={{ type: 'foundHolding' }} field="name" placeholder={t('Име на холдинга')} ariaLabel={t('Име на холдинга')} maxLength={HOLDING.nameMax} />
            ) : (
              <p className="text-xs text-mist-400">{t('Холдинг основава компания от ниво {0} (длъжност с право „Развитие“), с {1} от касата.', HOLDING.minCompanyLevel, money(HOLDING.foundCents))}</p>
            )}
          </div>
        )}
      </Card>
      <Card title={t('Холдингите')}>
        <ol className="divide-y divide-asphalt-800 text-sm">
          {table.map((h, i) => (
            <li key={h.id} className="flex items-center justify-between gap-2 py-2">
              <span><span className="num mr-2 text-mist-400">{i + 1}.</span>{tx(h.name)}</span>
              <span className="text-xs text-mist-400">{t('Компании: {0}', int(h.companies))} · {t('общо ниво {0}', int(h.levels))}</span>
            </li>
          ))}
        </ol>
        {!table.length && <p className="text-sm text-mist-400">{t('Още няма холдинги.')}</p>}
      </Card>
    </div>
  );
}
