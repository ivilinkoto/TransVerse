import { Check, Coins, Crown, Gift, Lock, Ticket } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, int } from '@/lib/format';
import { PASS_LEVELS, PASS_POINTS_PER_LEVEL, PASS_PRICE_COINS, PASS_REWARDS, rewardLabel } from '@/lib/game/season-pass';
import { gameContext } from '@/server/game/context';
import { passView } from '@/server/game/season-pass';

export const metadata = { title: 'Сезонен пропуск' };

export default async function PassPage() {
  const { db, user, now } = await gameContext();
  const p = await passView(db, user.id, now);
  const into = p.level >= PASS_LEVELS ? PASS_POINTS_PER_LEVEL : p.points - p.level * PASS_POINTS_PER_LEVEL;
  const claimedFree = new Set(p.claimedFree);
  const claimedPremium = new Set(p.claimedPremium);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Сезонен пропуск"
        subtitle={`${p.season.name} · до ${date(p.season.endsAt)}`}
        help={`Пропускът се пълни със сезонните точки от доставките ти (${int(PASS_POINTS_PER_LEVEL)} точки на ниво, ${PASS_LEVELS} нива). Всяко второ ниво има безплатна награда. Премиум линията (${PASS_PRICE_COINS} TC за сезона) добавя награда на всяко ниво: пари, ТрансКоин, VIP дни и ×2 опит. Премиумът не дава сезонни точки и не влияе на класациите. Невзетите награди изгарят в края на сезона.`}
      />

      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/15 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-5">
          <div className="flex h-20 w-20 flex-col items-center justify-center rounded-3xl border-2 border-gold-400/60 bg-gold-400/10">
            <span className="label text-[9px] text-gold-400">ниво</span>
            <span className="num font-display text-3xl font-bold text-gold-400">{p.level}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between text-sm"><span className="text-mist-300">{p.level >= PASS_LEVELS ? 'Пропускът е завършен!' : `До ниво ${p.level + 1}`}</span><span className="num text-mist-400">{int(into)} / {int(PASS_POINTS_PER_LEVEL)}</span></div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-asphalt-700"><div className="h-full rounded-full bg-gradient-to-r from-gold-500 to-gold-400" style={{ width: `${Math.max(2, (into / PASS_POINTS_PER_LEVEL) * 100)}%` }} /></div>
            <div className="num mt-1 text-xs text-mist-400">{int(p.points)} сезонни точки общо</div>
          </div>
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {p.claimable > 0 && <ActionButton action={{ type: 'claimSeasonPass' }} className="btn-gold"><Gift className="h-4 w-4" />Вземи наградите ({p.claimable})</ActionButton>}
            {p.premium ? (
              <span className="inline-flex items-center gap-1.5 rounded-xl border border-gold-400/50 bg-gold-400/10 px-3 py-2 text-sm font-semibold text-gold-400"><Crown className="h-4 w-4" />Премиум активен</span>
            ) : (
              <ActionButton action={{ type: 'buySeasonPass' }} className="btn-primary" confirm={`Отключваш премиум линията за ${PASS_PRICE_COINS} TC? Наградите от вече достигнатите нива се взимат веднага.`} disabled={user.coins < PASS_PRICE_COINS}>
                <Crown className="h-4 w-4" />Премиум · {PASS_PRICE_COINS} TC
              </ActionButton>
            )}
          </div>
        </div>
        {!p.premium && user.coins < PASS_PRICE_COINS && <p className="relative mt-3 text-xs text-mist-400">Имаш {int(user.coins)} TC. ТрансКоин се купуват от <a href="/game/shop" className="text-cyan-glow underline">магазина</a>.</p>}
      </section>

      <Card title={<span className="inline-flex items-center gap-2"><Ticket className="h-4 w-4 text-gold-400" />Награди</span>} className="p-3 sm:p-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          <ol className="flex min-w-max gap-2">
            {PASS_REWARDS.map((r) => {
              const reached = r.level <= p.level;
              return (
                <li key={r.level} className={`flex w-36 shrink-0 flex-col gap-2 rounded-2xl border p-2 ${reached ? 'border-gold-400/50 bg-gold-400/5' : 'border-asphalt-700'}`}>
                  <div className={`num text-center font-display text-sm font-bold ${reached ? 'text-gold-400' : 'text-mist-400'}`}>Ниво {r.level}</div>
                  <div className="min-h-16 rounded-xl bg-asphalt-850 p-2 text-center text-xs">
                    <div className="label mb-1 text-[9px]">Безплатно</div>
                    {r.free ? <div className={claimedFree.has(r.level) ? 'text-mist-400 line-through' : ''}>{rewardLabel(r.free)}</div> : <div className="text-mist-400">—</div>}
                    {claimedFree.has(r.level) && <Check className="mx-auto mt-1 h-3.5 w-3.5 text-profit" />}
                  </div>
                  <div className={`min-h-16 rounded-xl border p-2 text-center text-xs ${p.premium ? 'border-gold-400/40 bg-gold-400/10' : 'border-asphalt-700 bg-asphalt-850/60'}`}>
                    <div className="label mb-1 flex items-center justify-center gap-1 text-[9px] text-gold-400">{p.premium ? <Crown className="h-3 w-3" /> : <Lock className="h-3 w-3" />}Премиум</div>
                    <div className={claimedPremium.has(r.level) ? 'text-mist-400 line-through' : p.premium ? '' : 'text-mist-300'}>{rewardLabel(r.premium)}</div>
                    {claimedPremium.has(r.level) && <Check className="mx-auto mt-1 h-3.5 w-3.5 text-profit" />}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-mist-400"><Coins className="h-3.5 w-3.5 text-cyan-glow" />Премиум линията връща общо 600 TC, 13 VIP дни и 3 бустера ×2 опит, ако стигнеш ниво {PASS_LEVELS}.</p>
      </Card>
    </div>
  );
}
