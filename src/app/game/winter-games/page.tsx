import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, int, money } from '@/lib/format';
import { BASE_CONTEST, DISCIPLINES, inWinterGames, WINTER_GAMES } from '@/lib/game/winter-games';
import { gameContext } from '@/server/game/context';
import { membershipOf } from '@/server/game/membership';
import { topBases } from '@/server/game/plot';
import { medals, winterGamesStandings, xmasBaseVotes } from '@/server/game/winter-games';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Зимни игри') };
}

const MEDAL = ['🥇', '🥈', '🥉'];

/** 1.4 „Зимни игри на компаниите“: the medal table, the five disciplines and „Най-красивата коледна база“. */
export default async function WinterGamesPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.winter_games) notFound();
  const from = new Date(WINTER_GAMES.from);
  const to = new Date(WINTER_GAMES.to);
  const open = inWinterGames(now);
  const [membership, standings, votes, bases] = await Promise.all([membershipOf(db, user.id), now >= from ? winterGamesStandings(db, now) : null, xmasBaseVotes(db, now, user.id), topBases(db, now, 12)]);
  const mine = membership?.company.id ?? null;
  const table = standings ? medals(standings) : [];
  return (
    <div className="space-y-5">
      <PageHeader title={t('Зимни игри на компаниите')} subtitle={t('{0} – {1}: пет дисциплини, медали и шампион.', date(from), date(new Date(to.getTime() - 1)))}
        help={t('В дневните дисциплини се броят най-добрите {0} членове за деня. Първите трима във всяка дисциплина взимат пари в касата.', WINTER_GAMES.topMembers)} />
      {now < from && <p className="rounded-2xl border border-cyan-glow/40 bg-cyan-glow/10 p-4 text-sm" data-testid="winter-games-soon">{t('Игрите започват на {0}. Подгответе се!', date(from))}</p>}
      {!mine && <p className="text-sm text-mist-400">{t('Игрите са за компании —')} <Link href="/game/company" className="text-cyan-glow hover:underline">{t('влез в компания')}</Link>.</p>}
      {standings && (
        <Card title={t('🏅 Класиране по медали')}>
          {table.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма медали.')}</p> : (
            <table className="w-full text-sm" data-testid="winter-games-medals">
              <thead className="text-left text-xs text-mist-400"><tr><th className="py-1">#</th><th>{t('Компания')}</th><th className="text-center">🥇</th><th className="text-center">🥈</th><th className="text-center">🥉</th></tr></thead>
              <tbody className="divide-y divide-asphalt-800">
                {table.map((r, i) => (
                  <tr key={r.orgId} className={r.orgId === mine ? 'font-semibold text-gold-300' : ''}><td className="py-1.5">{i + 1}</td><td>{r.name}</td><td className="num text-center">{r.gold}</td><td className="num text-center">{r.silver}</td><td className="num text-center">{r.bronze}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          {now >= to && <p className="mt-2 text-xs text-mist-400">{t('Игрите приключиха — наградите са в касите.')}</p>}
        </Card>
      )}
      {standings && (
        <div className="grid gap-4 md:grid-cols-2">
          {DISCIPLINES.map((d) => {
            const rows = standings[d.id];
            const me = mine ? rows.findIndex((r) => r.orgId === mine) : -1;
            return (
              <Card key={d.id} title={`${d.emoji} ${tx(d.label)}`}>
                <p className="mb-2 text-xs text-mist-400">{tx(d.about)}</p>
                {rows.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма резултати.')}</p> : (
                  <ol className="space-y-1 text-sm">
                    {rows.slice(0, 5).map((r, i) => <li key={r.orgId} className={`flex justify-between gap-2 ${r.orgId === mine ? 'font-semibold text-gold-300' : ''}`}><span>{MEDAL[i] ?? `${i + 1}.`} {r.name}</span><span className="num">{int(r.value)} {tx(d.unit)}</span></li>)}
                    {me >= 5 && <li className="flex justify-between gap-2 font-semibold text-gold-300"><span>{me + 1}. {rows[me]!.name}</span><span className="num">{int(rows[me]!.value)} {tx(d.unit)}</span></li>}
                  </ol>
                )}
              </Card>
            );
          })}
        </div>
      )}
      <Card title={t('🎄 Най-красивата коледна база')}>
        <p className="mb-3 text-sm text-mist-300">{t('Един глас на ден за база на друга компания. Първите три взимат {0}, {1} и {2}, а победителят — титла за всеки член.', money(BASE_CONTEST.prizesCents[0]), money(BASE_CONTEST.prizesCents[1]), money(BASE_CONTEST.prizesCents[2]))}</p>
        <ul className="divide-y divide-asphalt-800 text-sm" data-testid="xmas-bases">
          {bases.map((b) => {
            const v = votes.ranking.find((r) => r.orgId === b.id)?.votes ?? 0;
            return (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/game/companies/${b.id}`} className="hover:underline">{b.name} <span className="text-mist-400">[{b.tag}]</span></Link>
                <span className="flex items-center gap-2">
                  <span className="num text-mist-300">{t('{0} гласа', v)}</span>
                  {open && b.id !== mine && (votes.today === b.id
                    ? <span className="text-xs text-emerald-300">{t('✓ твоят глас днес')}</span>
                    : !votes.today && <ActionButton action={{ type: 'voteXmasBase', organizationId: b.id }} className="game-action flex-row px-3 py-1 text-xs">{t('🎄 Гласувай')}</ActionButton>)}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
