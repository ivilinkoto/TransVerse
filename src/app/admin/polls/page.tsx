import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { TeamPollForm } from '@/components/admin/TeamPollForm';
import { dateTime } from '@/lib/format';
import { adminContext } from '@/server/admin-context';
import { allTeamPolls, isOpen, tally, TEAM_POLL } from '@/server/game/team-polls';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Анкети') };
}
export const dynamic = 'force-dynamic';

/** The team's polls: start one (dashboard + #анкети), the results with the game and Discord votes apart, end one early. */
export default async function AdminPolls() {
  await initLocale();
  const { db, now } = await adminContext({ admin: true });
  const polls = await allTeamPolls(db);
  return (
    <div className="space-y-5">
      <PageHeader title={t('Анкети')} subtitle={t('Анкетите на екипа: на таблото в играта и в #анкети в Discord. В играта играчите виждат само въпроса; пълните резултати са тук.')} />
      <Card title={t('Нова анкета')}>
        <TeamPollForm maxOptions={TEAM_POLL.maxOptions} hours={[6, 12, 24, 48, 72, 168]} />
        <p className="mt-2 text-xs text-mist-400">{t('В Discord екипът пуска анкета и с /анкета в #анкети — тя също идва тук и на таблото.')}</p>
      </Card>
      {polls.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма анкети.')}</p> : polls.map((p) => {
        const open = isOpen(p, now);
        const r = tally(p);
        return (
          <Card key={p.id} title={p.question}>
            <div className="space-y-3 text-sm" data-testid="team-poll-result">
              <p className="text-xs text-mist-400">
                <span className={`font-semibold ${open ? 'text-profit' : 'text-mist-300'}`}>{open ? t('Тече до {0}', dateTime(new Date(p.endsAt))) : t('Приключи {0}', dateTime(new Date(p.endsAt)))}</span>
                {' · '}{(r.total === 1 ? t('1 глас (в играта {0}, в Discord {1})', r.game.reduce((a, b) => a + b, 0), r.discord.reduce((a, b) => a + b, 0)) : t('{0} гласа (в играта {1}, в Discord {2})', r.total, r.game.reduce((a, b) => a + b, 0), r.discord.reduce((a, b) => a + b, 0)))}
                {p.createdBy && <> · {p.source === 'discord' ? t('пусната в Discord от {0}', p.createdBy) : t('пусната от {0}', p.createdBy)}</>}
              </p>
              <ul className="space-y-2">
                {p.options.map((o, i) => {
                  const share = r.total ? r.all[i]! / r.total : 0;
                  return (
                    <li key={o}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="font-medium">{o}</span>
                        <span className="num shrink-0 text-mist-300">{Math.round(share * 100)}% · {r.all[i]} <span className="text-xs text-mist-400">({t('игра {0}, Discord {1}', r.game[i], r.discord[i])})</span></span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-cyan-glow" style={{ width: `${Math.round(share * 100)}%` }} /></div>
                    </li>
                  );
                })}
              </ul>
              {open && <ActionButton endpoint="/api/admin/action" action={{ type: 'teamPollClose', pollId: p.id }} confirm={t('Да приключим ли анкетата сега?')} className="btn-ghost px-3 py-1.5 text-xs">{t('Приключи сега')}</ActionButton>}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
