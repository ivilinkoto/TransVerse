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
  const v = await tournamentView(db, user.id, now);
  const short = v.players < TOURNAMENT.minPlayers;
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('Турнир на седмицата')}
        subtitle={t('Влез с {0} TC и докарай най-много тонове до неделя.', TOURNAMENT.feeCoins)}
        help={t('Точките са тоновете, които камионите ти докарат от записването до края на седмицата (понеделник 00:00). {0}% от входовете са наградният фонд — в ТрансКоин за първите три места ({1}). Ако се запишат по-малко от {2} играчи, входът се връща.', Math.round(TOURNAMENT.poolShare * 100), TOURNAMENT.split.map((s) => `${Math.round(s * 100)}%`).join(' / '), TOURNAMENT.minPlayers)}
      />
      <section className="grid gap-3 sm:grid-cols-3" data-testid="tournament-pool">
        <div className="stat-tile rounded-2xl p-4"><p className="text-xs text-mist-400">{t('Наградният фонд')}</p><p className="font-display text-2xl font-bold text-gold-300">{v.pool} TC</p><p className="text-xs text-mist-400">{t('{0} участници', v.players)}</p></div>
        <div className="stat-tile rounded-2xl p-4"><p className="text-xs text-mist-400">{t('Награди')}</p><p className="font-display text-lg font-bold text-white">{v.prizes.length ? v.prizes.map((p, i) => `${MEDAL[i]} ${p}`).join(' · ') : t('от {0} участници нагоре', TOURNAMENT.minPlayers)}</p></div>
        <div className="stat-tile rounded-2xl p-4"><p className="text-xs text-mist-400">{t('Край')}</p><p className="font-display text-lg font-bold text-white">{dateTime(v.endsAt)}</p></div>
      </section>
      {v.me ? (
        <p className="rounded-xl border border-gold-400/40 bg-gold-400/10 px-4 py-3 text-sm text-gold-300" data-testid="tournament-me">🏁 {t('Участваш: {0} място с {1} т.', v.me.place, dec(v.me.tons))}{short ? ` ${t('Още {0} участници и турнирът се състои.', TOURNAMENT.minPlayers - v.players)}` : ''}</p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-gold-400/40 bg-gold-400/5 p-4" data-testid="tournament-join">
          <p className="text-sm text-mist-200">{t('Тоновете се броят от момента, в който влезеш — колкото по-рано, толкова по-добре.')}</p>
          <ActionButton action={{ type: 'joinTournament' }} disabled={user.coins < TOURNAMENT.feeCoins} confirm={t('Вход в турнира за {0} TC?', TOURNAMENT.feeCoins)} className="game-action game-action-gold flex-row px-5 py-2 text-sm">🏆 {t('Влез · {0} TC', TOURNAMENT.feeCoins)}</ActionButton>
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
    </div>
  );
}
