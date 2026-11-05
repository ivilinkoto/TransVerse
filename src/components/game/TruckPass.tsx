import { Check, Coins, Crown, Gift, ListChecks, Lock, Sparkles, Ticket } from 'lucide-react';
import { Card } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { int } from '@/lib/format';
import { TITLES } from '@/lib/game/first-snow';
import { ITEMS, type ItemId } from '@/lib/game/items';
import { eliteReward, levelStart, PASS_V2, passRewards, rewardLabelV2 } from '@/lib/game/season-pass';
import type { DbOrTx } from '@/server/db/client';
import { passTasksView } from '@/server/game/first-snow';
import { passView } from '@/server/game/season-pass';
import { ClaimRewards, PassProgress } from '@/components/fx/PassFx';
import { t, tx } from '@/i18n/t';

const itemName = (id: string) => tx(ITEMS[id as ItemId]?.name ?? id);
const titleName = (id: string) => tx(TITLES[id]?.label ?? id);

/** The season pass („Truck Pass“ from 1.2; from „Първи сняг“ on: 50 levels, weekly tasks and elite levels). */
export async function TruckPass({ db, userId, coins, now, fx = false }: { db: DbOrTx; userId: string; coins: number; now: Date; fx?: boolean }) {
  const p = await passView(db, userId, now);
  const v2 = p.version === 2;
  const tasks = v2 ? await passTasksView(db, userId, now) : null;
  const claimedFree = new Set(p.claimedFree);
  const claimedPremium = new Set(p.claimedPremium);
  const rewards = passRewards(p.version);
  return (
    <>
      <section className="panel relative overflow-hidden p-5 sm:p-6">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-gold-400/15 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-wrap items-center gap-5">
          <PassProgress season={String(p.season.id)} points={p.points} perLevel={v2 ? PASS_V2.base : 1000} step={v2 ? PASS_V2.step : 0} maxLevel={p.max} fx={fx} />
          <div className="flex w-full flex-wrap gap-2 sm:w-auto">
            {p.claimable > 0 && <ClaimRewards fx={fx}><Gift className="h-4 w-4" />{t('Вземи наградите ({0})', p.claimable)}</ClaimRewards>}
            {p.premium ? (
              <span className={`inline-flex items-center gap-1.5 rounded-xl border border-gold-400/50 bg-gold-400/10 px-3 py-2 text-sm font-semibold text-gold-400 ${fx ? 'fx-shimmer' : ''}`}><Crown className="h-4 w-4" />{t('Премиум активен')}</span>
            ) : (
              <ActionButton action={{ type: 'buySeasonPass' }} className="btn-primary" confirm={t('Отключваш премиум линията за {0} TC? Наградите от вече достигнатите нива се взимат веднага.', p.price)} disabled={coins < p.price}>
                <Crown className="h-4 w-4" />{t('Премиум · {0} TC', p.price)}
              </ActionButton>
            )}
          </div>
        </div>
        {v2 && p.level >= p.max && (
          <p className="relative mt-3 flex items-center gap-1.5 text-sm text-gold-300" data-testid="pass-elite">
            <Sparkles className="h-4 w-4" />{t('Елитни нива: {0} · следващото след {1} точки ({2})', p.elite, int(levelStart(p.max, 2) + (p.elite + 1) * PASS_V2.elitePoints - p.points), rewardLabelV2(eliteReward(p.elite + 1), itemName, titleName))}
          </p>
        )}
        {!p.premium && coins < p.price && <p className="relative mt-3 text-xs text-mist-400">{t('Имаш {0} TC. ТрансКоин се купуват от', int(coins))}{' '}<a href="/game/shop" className="text-cyan-glow underline">{t('магазина')}</a>.</p>}
      </section>

      {tasks && (
        <Card title={<span className="inline-flex items-center gap-2"><ListChecks className="h-4 w-4 text-cyan-glow" />{t('Задачи за седмицата')}</span>}>
          <ul className="grid gap-2 sm:grid-cols-3" data-testid="pass-tasks">
            {tasks.map((task) => (
              <li key={task.id} className={`rounded-xl border p-3 text-sm ${task.done ? 'border-profit/40 bg-profit/10' : 'border-asphalt-700 bg-asphalt-850'}`}>
                <div className="font-semibold">{tx(task.label)}</div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-asphalt-700"><div className="h-full rounded-full bg-cyan-glow" style={{ width: `${(task.progress / task.target) * 100}%` }} /></div>
                <div className="mt-1 flex justify-between text-xs text-mist-400"><span className="num">{int(task.progress)} / {int(task.target)}</span><span>{task.done ? t('✓ взето') : t('+{0} точки', int(task.points))}</span></div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-mist-400">{t('Броят се само курсовете, които караш сам. Задачите се сменят всеки понеделник.')}</p>
        </Card>
      )}

      <Card title={<span className="inline-flex items-center gap-2"><Ticket className="h-4 w-4 text-gold-400" />{t('Награди')}</span>} className="p-3 sm:p-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
          <ol className="flex min-w-max gap-2">
            {rewards.map((r) => {
              const reached = r.level <= p.level;
              const waiting = fx && reached && ((r.free && !claimedFree.has(r.level)) || (p.premium && !claimedPremium.has(r.level)));
              const special = !!(r.premium.truck || r.premium.title || r.free?.title);
              return (
                <li key={r.level} className={`flex w-36 shrink-0 flex-col gap-2 rounded-2xl border p-2 ${reached ? 'border-gold-400/50 bg-gold-400/5' : special ? 'border-cyan-glow/50' : 'border-asphalt-700'} ${waiting ? 'fx-pulse' : ''}`}>
                  <div className={`num text-center font-display text-sm font-bold ${reached ? 'text-gold-400' : 'text-mist-400'}`}>{t('Ниво {0}', r.level)}</div>
                  <div className="min-h-16 rounded-xl bg-asphalt-850 p-2 text-center text-xs">
                    <div className="label mb-1 text-[9px]">{t('Безплатно')}</div>
                    {r.free ? <div className={claimedFree.has(r.level) ? 'text-mist-400 line-through' : ''}>{rewardLabelV2(r.free, itemName, titleName)}</div> : <div className="text-mist-400">—</div>}
                    {claimedFree.has(r.level) && <Check className="mx-auto mt-1 h-3.5 w-3.5 text-profit" />}
                  </div>
                  <div className={`min-h-16 rounded-xl border p-2 text-center text-xs ${p.premium ? 'border-gold-400/40 bg-gold-400/10' : 'border-asphalt-700 bg-asphalt-850/60'} ${fx && p.premium ? 'fx-shimmer' : ''}`}>
                    <div className="label mb-1 flex items-center justify-center gap-1 text-[9px] text-gold-400">{p.premium ? <Crown className="h-3 w-3" /> : <Lock className="h-3 w-3" />}{t('Премиум')}</div>
                    <div className={claimedPremium.has(r.level) ? 'text-mist-400 line-through' : p.premium ? '' : 'text-mist-300'}>{rewardLabelV2(r.premium, itemName, titleName)}</div>
                    {claimedPremium.has(r.level) && <Check className="mx-auto mt-1 h-3.5 w-3.5 text-profit" />}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-mist-400"><Coins className="h-3.5 w-3.5 text-cyan-glow" />
          {v2 ? t('Нивата стават по-скъпи с всяко следващо: ниво 1 е {0} точки, ниво 50 — {1}. След ниво 50 идват елитни нива с кейсове.', int(PASS_V2.base), int(PASS_V2.base + PASS_V2.step * 49)) : t('Премиум линията връща общо 600 TC, 13 VIP дни и 3 бустера ×2 опит, ако стигнеш ниво {0}.', p.max)}
        </p>
      </Card>
    </>
  );
}
