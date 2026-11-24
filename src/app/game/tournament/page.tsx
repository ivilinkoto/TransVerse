import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Trophy } from 'lucide-react';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, dec } from '@/lib/format';
import { TOURNAMENT } from '@/lib/game/tournament';
import { gameContext } from '@/server/game/context';
import { tournamentView } from '@/server/game/tournament';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Турнир на седмицата') };
}

const MEDAL = ['🥇', '🥈', '🥉'];

/** 1.3.2.4 „Турнир на седмицата“: the entry, the pool and prizes, the table and the player's place. */
export default async function TournamentPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.tournaments) notFound();
  const tiers = await tournamentView(db, user.id, now);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Турнир на седмицата')}
        subtitle={t('Влез, докарай най-много тонове до неделя и вземи наградата в ТрансКоин.')}
        help={t('Точките са тоновете, които камионите ти докарат от записването до края на седмицата (понеделник 00:00). {0}% от входовете са наградният фонд — в ТрансКоин за първите три места ({1}). Ако се запишат по-малко от {2} играчи, входът се връща. Може да участваш и в двата турнира.', Math.round(TOURNAMENT.poolShare * 100), TOURNAMENT.split.map((s) => `${Math.round(s * 100)}%`).join(' / '), TOURNAMENT.minPlayers)}
      />
      {tiers.map((v) => {
        const short = v.players < TOURNAMENT.minPlayers;
        const locked = user.level < v.minLevel;
        return (
          <section key={v.tier} className="space-y-3" data-testid={`tournament-${v.tier}`}>
            <h2 className="font-display text-xl font-bold text-white">{v.emoji} {tx(v.label)} <span className="text-sm font-normal text-mist-400">· {t('вход {0} TC', v.feeCoins)}{v.minLevel > 1 ? ` · ${t('от ниво {0}', v.minLevel)}` : ''}</span></h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="stat-tile rounded-2xl p-4"><p className="text-xs text-mist-400">{t('Наградният фонд')}</p><p className="font-display text-2xl font-bold text-gold-300">{v.pool} TC</p><p className="text-xs text-mist-400">{t('{0} участници', v.players)}</p></div>
              <div className="stat-tile rounded-2xl p-4"><p className="text-xs text-mist-400">{t('Награди')}</p><p className="font-display text-lg font-bold text-white">{v.prizes.length ? v.prizes.map((p, i) => `${MEDAL[i]} ${p}`).join(' · ') : t('от {0} участници нагоре', TOURNAMENT.minPlayers)}</p></div>
              <div className="stat-tile rounded-2xl p-4"><p className="text-xs text-mist-400">{t('Край')}</p><p className="font-display text-lg font-bold text-white">{dateTime(v.endsAt)}</p></div>
            </div>
            {v.me ? (
              <p className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm text-gold-300" data-testid="tournament-me">🏁 {t('Участваш: {0} място с {1} т.', v.me.place, dec(v.me.tons))}{short ? ` ${t('Още {0} участници и турнирът се състои.', TOURNAMENT.minPlayers - v.players)}` : ''}</p>
            ) : locked ? (
              <p className="text-sm text-mist-300">🔒 {t('{0} е от ниво {1}.', tx(v.label), v.minLevel)}</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-400/40 bg-gold-400/5 p-4" data-testid="tournament-join">
                <p className="text-sm text-mist-200">{t('Тоновете се броят от момента, в който влезеш — колкото по-рано, толкова по-добре.')}</p>
                <ActionButton action={{ type: 'joinTournament', tier: v.tier }} disabled={user.coins < v.feeCoins} confirm={t('Вход в „{0}“ за {1} TC?', tx(v.label), v.feeCoins)} className="game-action game-action-gold flex-row px-5 py-2 text-sm">{v.emoji} {t('Влез · {0} TC', v.feeCoins)}</ActionButton>
              </div>
            )}
            <Card title={t('Класиране')} actions={<Trophy className="h-4 w-4 text-gold-400" />}>
              {v.table.length === 0 ? <p className="text-sm text-mist-400">{t('Още никой не е влязъл тази седмица. Бъди първият.')}</p> : (
                <ol className="space-y-1.5 text-sm" data-testid="tournament-table">
                  {v.table.map((r, i) => (
                    <li key={r.userId} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${r.userId === user.id ? 'border border-gold-400/50 bg-gold-400/10' : 'bg-asphalt-850'}`}>
                      <span><span className="inline-block w-8">{MEDAL[i] ?? `${i + 1}.`}</span><b>{tx(r.name)}</b></span>
                      <span className="num font-semibold">{t('{0} т', dec(r.tons))}{v.prizes[i] ? <span className="ml-2 text-gold-300">+{v.prizes[i]} TC</span> : null}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          </section>
        );
      })}
    </div>
  );
}
