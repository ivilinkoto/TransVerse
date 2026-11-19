import { BarChart3 } from 'lucide-react';
import { ActionButton } from '@/components/ui/ActionButton';
import type { DbOrTx } from '@/server/db/client';
import { pollsToAnswer } from '@/server/game/team-polls';
import { t } from '@/i18n/t';

/**
 * The team's poll on the dashboard (the same one as in #анкети in Discord). Only polls the player
 * has not answered show; once they vote it is gone — the results are for the team (admin panel).
 */
export async function TeamPolls({ db, userId, now }: { db: DbOrTx; userId: string; now: Date }) {
  const [poll] = await pollsToAnswer(db, userId, now);
  if (!poll) return null;
  const hours = Math.max(1, Math.round((poll.endsAt - now.getTime()) / 3_600_000));
  return (
    <section className="panel border-cyan-glow/40 p-3.5" aria-label={t('Анкета на екипа')} data-testid="team-poll">
      <div className="flex items-start gap-3">
        <BarChart3 className="mt-0.5 h-6 w-6 shrink-0 text-cyan-glow" />
        <div className="min-w-0 flex-1">
          <p className="label">{t('Анкета на екипа · още {0} ч', hours)}</p>
          <p className="mt-0.5 font-semibold">{poll.question}</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {poll.options.map((o, i) => (
              <ActionButton key={o} action={{ type: 'voteTeamPoll', pollId: poll.id, option: i }} className="btn-ghost px-3 py-1.5 text-sm">
                {o}
              </ActionButton>
            ))}
          </div>
          <p className="mt-2 text-xs text-mist-400">{t('Гласът ти се брои заедно с гласовете от Discord.')}</p>
        </div>
      </div>
    </section>
  );
}
