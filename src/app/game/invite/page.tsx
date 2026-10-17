import { CheckCircle2, Clock, Gift, UserPlus, XCircle } from 'lucide-react';
import { headers } from 'next/headers';
import { InviteLink } from '@/components/game/InviteLink';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { date, money } from '@/lib/format';
import { REFERRAL } from '@/lib/game/referrals';
import { gameContext } from '@/server/game/context';
import { ensureReferralCode, referralStats } from '@/server/game/referrals';
import { mailConfig } from '@/server/mail';

export const metadata = { title: 'Покани приятел' };

export default async function InvitePage() {
  const { db, user } = await gameContext();
  const code = await ensureReferralCode(db, user.id);
  const h = await headers();
  const origin = process.env.APP_URL?.trim().replace(/\/$/, '') || `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('x-forwarded-host') ?? h.get('host')}`;
  const stats = await referralStats(db, user.id);
  const steps = [
    'Изпрати линка на приятел.',
    'Той се регистрира през него.',
    `Прави ${REFERRAL.deliveriesNeeded} доставки${mailConfig().enabled ? ' и потвърждава имейла си' : ''}.`,
    'Двамата получавате наградите автоматично.',
  ];
  return (
    <div className="space-y-6">
      <PageHeader title="Покани приятел" subtitle="Карайте заедно — и двамата печелите." help={`Наградата се дава веднъж за всеки поканен играч, след като направи ${REFERRAL.deliveriesNeeded} доставки. Покани от същата мрежа (един и същ интернет адрес при регистрацията) не се награждават. До ${REFERRAL.monthlyLimit} наградени покани на 30 дни.`} />
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/15 blur-3xl" aria-hidden="true" />
        <div className="relative grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <h2 className="flex items-center gap-2 font-display text-xl font-bold"><Gift className="h-5 w-5 text-gold-400" />Твоят линк за покана</h2>
            <p className="mt-1 text-sm text-mist-300">Ти получаваш <span className="font-semibold text-gold-400">{money(REFERRAL.inviterCents)}</span> и <span className="font-semibold text-cyan-glow">{REFERRAL.inviterCoins} TC</span>, приятелят ти — <span className="font-semibold text-gold-400">{money(REFERRAL.inviteeCents)}</span> бонус за старта.</p>
            <div className="mt-4"><InviteLink url={`${origin}/r/${code}`} /></div>
          </div>
          <div className="grid grid-cols-2 gap-2 text-center md:w-56">
            <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/80 p-3"><div className="num font-display text-2xl font-bold">{stats.invited.length}</div><div className="text-xs text-mist-400">поканени</div></div>
            <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/80 p-3"><div className="num font-display text-2xl font-bold text-profit">{stats.rewarded}</div><div className="text-xs text-mist-400">наградени</div></div>
          </div>
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <Card title="Как работи">
          <ol className="space-y-3 text-sm">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3"><span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-volt-500/20 text-xs font-bold text-cyan-glow">{i + 1}</span><span className="pt-0.5">{s}</span></li>
            ))}
          </ol>
        </Card>
        <Card title="Поканени играчи">
          {stats.invited.length === 0 ? (
            <Empty icon={UserPlus} title="Още никой">Сподели линка в чат, група или с колегите си.</Empty>
          ) : (
            <ul className="divide-y divide-asphalt-800">
              {stats.invited.map((u) => (
                <li key={u.id} className="flex items-center gap-3 py-2.5 text-sm first:pt-0 last:pb-0">
                  {u.outcome === 'rewarded' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-profit" /> : u.outcome === 'declined' ? <XCircle className="h-4 w-4 shrink-0 text-mist-400" /> : <Clock className="h-4 w-4 shrink-0 text-amber-sig" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">{u.username}</div>
                    <div className="text-xs text-mist-400">от {date(u.createdAt)}</div>
                    {!u.outcome && <Meter value={(u.deliveries / REFERRAL.deliveriesNeeded) * 100} tone="cyan" className="mt-1.5 max-w-48" />}
                  </div>
                  {u.outcome === 'rewarded' ? <Badge tone="green">наградено</Badge> : u.outcome === 'declined' ? <Badge>без награда</Badge> : <span className="num text-xs text-mist-400">{u.deliveries} / {REFERRAL.deliveriesNeeded} доставки</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
