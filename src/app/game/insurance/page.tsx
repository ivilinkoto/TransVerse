import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ShieldCheck } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { dateTime, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { INSURER, insuranceMarket } from '@/server/game/insurers';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Застрахователи') };
}

/** 1.1.4.2: companies that insure other players against late penalties. */
export default async function InsurancePage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.insurers) notFound();
  const m = await insuranceMarket(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Застрахователи')} subtitle={t('Компании продават 7-дневна застраховка срещу неустойки за закъснение. Премията отива в касата им, обезщетенията се плащат от нея.')} />
      {m.policy && (
        <Card title={t('Твоята застраховка')}>
          <p className="text-sm">{t('Покрива {0}% от неустойките, до {1} (изплатени {2}) · до {3}', m.policy.coverPct, money(m.policy.maxPayoutCents), money(m.policy.paidOutCents), dateTime(m.policy.endsAt))}</p>
        </Card>
      )}
      <Card title={t('Оферти')}>
        {!m.plans.length ? <Empty icon={ShieldCheck} title={t('Още никой не предлага застраховки')}>{t('Компания с право „Настройки“ може да започне.')}</Empty> : (
          <ul className="space-y-2">
            {m.plans.map((p) => (
              <li key={p.orgId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 p-3 text-sm">
                <span>
                  <span className="font-semibold">{p.name}</span>{p.tag && <span className="text-mist-400"> [{p.tag}]</span>}
                  <span className="block text-xs text-mist-400">{t('{0}% покритие · лимит {1} · каса {2}', p.coverPct, money(p.maxPayoutCents), money(p.treasuryCents))}</span>
                </span>
                {p.orgId === m.orgId ? <Badge tone="violet">{t('Твоята компания')}</Badge> : !m.policy && <ActionButton action={{ type: 'buyPolicy', orgId: p.orgId }} className="btn-primary px-3 py-1 text-xs">{t('Купи за {0}', money(p.premiumCents))}</ActionButton>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {m.orgId && (
        <Card title={t('Застрахователният отдел на компанията')}>
          <FormAction
            action={{ type: 'insurancePlan' }}
            fields={[
              { name: 'premiumLev', label: t('Премия за 7 дни, лв.'), type: 'number', defaultValue: (m.own?.premiumCents ?? 200_00) / 100, min: INSURER.minPremiumCents / 100, max: INSURER.maxPremiumCents / 100 },
              { name: 'coverPct', label: t('Покритие, %'), type: 'number', defaultValue: m.own?.coverPct ?? 50, min: INSURER.minCover, max: INSURER.maxCover },
              { name: 'maxPayoutLev', label: t('Лимит, лв.'), type: 'number', defaultValue: (m.own?.maxPayoutCents ?? 5_000_00) / 100, min: 1, max: INSURER.maxPayoutCents / 100 },
              { name: 'active', label: t('Предлагай'), type: 'checkbox', defaultValue: m.own?.active ?? true },
            ]}
            submit={t('Запази')}
          />
          <p className="mt-2 text-xs text-mist-400">{t('Нужно е право „Настройки“ в компанията. Обезщетенията се плащат само докато в касата има пари.')}</p>
        </Card>
      )}
    </div>
  );
}
