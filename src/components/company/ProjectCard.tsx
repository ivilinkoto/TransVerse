import { Building, Clock, Hammer, Landmark } from 'lucide-react';
import { PlayerName } from '@/components/game/PlayerName';
import { Card, Meter } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { duration, int, money } from '@/lib/format';
import { CARGO, type CargoType } from '@/lib/game/cargo';
import { PROJECT_RULES } from '@/lib/game/projects';

interface Choice {
  id: string;
  title: string;
  goods: string;
  cargo: CargoType;
  cityBg: string;
  target: number;
  reward: { cents: number; xp: number };
}
interface Running {
  title: string;
  cargo: CargoType;
  city: string;
  progress: number;
  target: number;
  rewardCents: number;
  rewardXp: number;
  endsAt: Date;
  helpers: { username: string; tons: number }[];
}

/** The company project: the running one with its helpers, or this week's choice. */
export function ProjectCard({ running, choices, canStart, now, startedThisWeek }: { running: Running | null; choices: Choice[]; canStart: boolean; now: Date; startedThisWeek: boolean }) {
  return (
    <Card title={<span className="inline-flex items-center gap-2"><Hammer className="h-4 w-4 text-gold-400" />Фирмен проект</span>} actions={<span className="text-xs text-mist-400">{PROJECT_RULES.days} дни · {PROJECT_RULES.helperCoins} TC за всеки, който помогне</span>}>
      {running ? (
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-display text-lg font-bold">{running.title}</h3>
            <span className="inline-flex items-center gap-1 text-xs text-mist-400"><Clock className="h-3.5 w-3.5" />остават {duration((running.endsAt.getTime() - now.getTime()) / 60_000)}</span>
          </div>
          <p className="mt-1 text-sm text-mist-300">Карайте {CARGO[running.cargo].label.toLowerCase()} до <b>{running.city}</b> — всяка доставка на член се брои с тоновете си.</p>
          <div className="mt-3"><Meter value={(running.progress / running.target) * 100} tone="gold" /></div>
          <div className="mt-1.5 flex justify-between text-xs text-mist-400">
            <span className="num">{int(Math.floor(running.progress))} / {int(running.target)} т</span>
            <span className="num text-gold-400"><Landmark className="mr-1 inline h-3.5 w-3.5" />{money(running.rewardCents)} · +{int(running.rewardXp)} опит</span>
          </div>
          {running.helpers.length > 0 && (
            <ol className="mt-4 space-y-1 text-sm">
              {running.helpers.map((h, i) => (
                <li key={h.username} className="flex justify-between"><span><span className="num mr-2 text-mist-400">{i + 1}.</span><PlayerName name={h.username} /></span><span className="num text-mist-300">{int(Math.round(h.tons))} т</span></li>
              ))}
            </ol>
          )}
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-mist-400">
            Голяма цел за всички: за {PROJECT_RULES.days} дни превозете заедно определен товар до един град. Наградата е за касата и фирмения опит, а всеки, който е превозил поне {Math.round(PROJECT_RULES.helperShare * 100)}% от целта, получава {PROJECT_RULES.helperCoins} ТрансКоин.
            {startedThisWeek ? ' Тази седмица компанията вече имаше проект — нови предложения от понеделник.' : canStart ? ' Избери проект за седмицата:' : ' Проект започва член с право „Търгове и възлагане“.'}
          </p>
          {!startedThisWeek && (
            <ul className="grid gap-3 lg:grid-cols-3">
              {choices.map((c) => (
                <li key={c.id} className="flex flex-col rounded-xl border border-asphalt-700 p-4">
                  <div className="flex items-start gap-2 font-semibold"><Building className="mt-0.5 h-4 w-4 shrink-0 text-gold-400" />{c.title}</div>
                  <p className="mt-1 text-sm text-mist-300">{int(c.target)} т {c.goods} до {c.cityBg}</p>
                  <p className="mt-1 text-xs text-gold-400">{money(c.reward.cents)} в касата · +{int(c.reward.xp)} опит</p>
                  {canStart && <ActionButton action={{ type: 'startProject', templateId: c.id }} className="btn-primary mt-3 justify-center text-sm" confirm={`Да започнем ли „${c.title}“? Имате ${PROJECT_RULES.days} дни.`}>Започни</ActionButton>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
