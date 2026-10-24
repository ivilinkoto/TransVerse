import { CheckCircle2, Clock, Gift, UserPlus, XCircle } from 'lucide-react';
import { InviteLink } from '@/components/game/InviteLink';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { date, money } from '@/lib/format';
import { REFERRAL } from '@/lib/game/referrals';
import { gameContext } from '@/server/game/context';
import { ensureReferralCode, referralStats } from '@/server/game/referrals';
import { mailConfig } from '@/server/mail';
import { publicOrigin } from '@/server/site';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Покани приятел') };
}

export default async function InvitePage() {
  await initLocale();
  const { db, user } = await gameContext();
  const code = await ensureReferralCode(db, user.id);
  const origin = await publicOrigin();
  const stats = await referralStats(db, user.id);
  const steps = [
    t('Изпрати линка на приятел.'),
    t('Той се регистрира през него.'),
    t('Прави {0} доставки{1}.', REFERRAL.deliveriesNeeded, mailConfig().enabled ? t(' и потвърждава имейла си') : ''),
    t('Двамата получавате наградите автоматично.'),
  ];
  return (
    <div className="space-y-6">
      <PageHeader title={t('Покани приятел')} subtitle={t('Карайте заедно — и двамата печелите.')} help={t('Наградата се дава веднъж за всеки поканен играч, след като направи {0} доставки. Покани от същата мрежа (един и същ интернет адрес при регистрацията) не се награждават. До {1} наградени покани на 30 дни.', REFERRAL.deliveriesNeeded, REFERRAL.monthlyLimit)} />
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/15 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Gift className="h-5 w-5 text-gold-400" />{t('Твоят линк за покана')}</h2>
            <p className="mt-1 text-sm text-mist-300">{t('Ти получаваш')}{' '}<span className="font-semibold text-gold-400">{money(REFERRAL.inviterCents)}</span>{' '}{t('и')}{' '}<span className="font-semibold text-cyan-glow">{tx(REFERRAL.inviterCoins)} TC</span>{t(', приятелят ти —')}{' '}<span className="font-semibold text-gold-400">{money(REFERRAL.inviteeCents)}</span>{' '}{t('бонус за старта.')}</p>
            <div className="mt-4"><InviteLink url={`${origin}/r/${code}`} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center md:w-56">
            <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/80 p-3"><div className="num font-display text-2xl font-bold">{tx(stats.invited.length)}</div><div className="text-xs text-mist-400">{t('поканени')}</div></div>
            <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/80 p-3"><div className="num font-display text-2xl font-bold text-profit">{tx(stats.rewarded)}</div><div className="text-xs text-mist-400">{t('наградени')}</div></div>
          </div>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card title={t('Как работи')}>
          <ol className="space-y-3 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3"><span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-volt-500/20 text-xs font-bold text-cyan-glow">{i + 1}</span><span className="pt-0.5">{s}</span></li>
            ))}
          </ol>
        </Card>
        <Card title={t('Поканени играчи')}>
          {stats.invited.length === 0 ? (
            <Empty icon={UserPlus} title={t('Още никой')}>{t('Сподели линка в чат, група или с колегите си.')}</Empty>
          ) : (
            <ul className="divide-y divide-asphalt-800">
              {stats.invited.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  {u.outcome === 'rewarded' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" /> : u.outcome === 'declined' ? <XCircle className="h-4 w-4 shrink-0 text-mist-400" /> : <Clock className="h-4 w-4 shrink-0 text-amber-sig" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{tx(u.username)}</div>
                    <div className="text-xs text-mist-400">{t('от {0}', date(u.createdAt))}</div>
                    {!u.outcome && <Meter value={(u.deliveries / REFERRAL.deliveriesNeeded) * 100} tone="cyan" className="mt-1.5 max-w-48" />}
                  </div>
                  {u.outcome === 'rewarded' ? <Badge tone="green">{t('наградено')}</Badge> : u.outcome === 'declined' ? <Badge>{t('без награда')}</Badge> : <span className="num text-xs text-mist-400">{t('{0} / {1} доставки', u.deliveries, REFERRAL.deliveriesNeeded)}</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
