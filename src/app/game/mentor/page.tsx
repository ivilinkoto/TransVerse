import { Clock, GraduationCap, HandHeart, Sparkles } from 'lucide-react';
import { PlayerName } from '@/components/game/PlayerName';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, money } from '@/lib/format';
import { MENTOR } from '@/lib/game/mentor';
import { xpForLevel } from '@/lib/game/progression';
import { gameContext } from '@/server/game/context';
import { availableMentors, mentorOverview } from '@/server/game/mentor';

export const metadata = { title: 'Наставник' };

const daysLeft = (end: Date, now: Date) => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));

export default async function MentorPage() {
  const { db, user, now } = await gameContext();
  const o = await mentorOverview(db, user.id, now);
  const mentors = o.canPick ? await availableMentors(db, user.id, now) : [];
  const goalXp = xpForLevel(MENTOR.goalLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Наставник"
        subtitle="Опитните шофьори помагат на новите — и двамата печелят."
        help={`Нов играч (до ${MENTOR.newcomerDays} дни в играта, под ниво ${MENTOR.goalLevel}) избира наставник от ниво ${MENTOR.mentorLevel}+. Докато трае наставничеството, ученикът получава +${Math.round(MENTOR.xpBonus * 100)} % опит. Ако стигне ниво ${MENTOR.goalLevel} до ${MENTOR.days} дни, наставникът получава ${money(MENTOR.mentorCents)}, ${MENTOR.mentorCoins} TC и значка „Наставник“, а ученикът — ${money(MENTOR.menteeCents)} и ${MENTOR.menteeCoins} TC. Наградата за всеки нов играч е веднъж; наставник и ученик от една и съща мрежа не може.`}
      />

      {o.mentor && (
        <Card title={<span className="inline-flex items-center gap-2"><GraduationCap className="h-4 w-4 text-cyan-glow" />Твоят наставник</span>}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-lg font-bold"><PlayerName name={o.mentor.username} /> <span className="text-sm font-normal text-mist-400">· ниво {o.mentor.level}{o.mentor.online ? ' · онлайн' : ''}</span></div>
              <p className="mt-1 text-sm text-mist-300">Пиши му в чата, питай за линии и камиони. Получаваш +{Math.round(MENTOR.xpBonus * 100)} % опит от курсовете.</p>
            </div>
            <Badge tone="cyan"><Clock className="h-3 w-3" />още {daysLeft(o.mentor.endsAt, now)} дни</Badge>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-mist-400"><span>Към ниво {MENTOR.goalLevel}</span><span className="num">{user.xp.toLocaleString('bg-BG')} / {goalXp.toLocaleString('bg-BG')} опит</span></div>
            <Meter value={(user.xp / goalXp) * 100} tone="cyan" />
          </div>
          <div className="mt-3"><ActionButton action={{ type: 'endMentorship', id: o.mentor.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm="Да прекратим ли наставничеството? Наградата за ниво 5 се губи.">Прекрати</ActionButton></div>
        </Card>
      )}

      {o.canPick && (
        <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold-400" />Избери наставник</span>}>
          <p className="mb-3 text-sm text-mist-300">Нов си в играта — опитен шофьор може да те води до ниво {MENTOR.goalLevel}. Получаваш +{Math.round(MENTOR.xpBonus * 100)} % опит, а при успех и двамата печелите награда.</p>
          {mentors.length === 0 ? (
            <Empty icon={GraduationCap} title="В момента няма свободни наставници">Провери пак по-късно — играчите от ниво 15 нагоре се записват като наставници от тази страница.</Empty>
          ) : (
            <ul className="divide-y divide-asphalt-800">
              {mentors.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <PlayerName name={m.username} className="font-semibold" />
                    <div className="text-xs text-mist-400">ниво {m.level}{m.online ? ' · онлайн' : ''}{m.helped ? ` · помогнал на ${m.helped}` : ''} · {m.active}/{MENTOR.maxMentees} ученици</div>
                  </div>
                  <ActionButton action={{ type: 'chooseMentor', mentorId: m.userId }} className="btn-primary px-3 py-1.5 text-sm">Избери</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(o.canMentor || o.students.length > 0) && (
        <Card
          title={<span className="inline-flex items-center gap-2"><HandHeart className="h-4 w-4 text-gold-400" />Моите ученици</span>}
          actions={o.canMentor ? <ActionButton action={{ type: 'mentorOpen', on: !o.mentorOpen }} className={o.mentorOpen ? 'btn-ghost px-3 py-1.5 text-xs' : 'btn-primary px-3 py-1.5 text-xs'}>{o.mentorOpen ? 'Не приемам нови' : 'Приемам ученици'}</ActionButton> : undefined}
        >
          <p className="mb-3 text-sm text-mist-300">{o.mentorOpen ? `Нови играчи могат да те изберат (до ${MENTOR.maxMentees} едновременно).` : 'В момента не приемаш нови ученици.'} За всеки, който стигне ниво {MENTOR.goalLevel} до {MENTOR.days} дни: {money(MENTOR.mentorCents)} и {MENTOR.mentorCoins} TC.</p>
          {o.students.length === 0 ? (
            <Empty icon={GraduationCap} title="Още нямаш ученици">Щом нов играч те избере, ще получиш известие.</Empty>
          ) : (
            <ul className="space-y-3">
              {o.students.map((s) => (
                <li key={s.id} className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><PlayerName name={s.username} className="font-semibold" /> <span className="text-xs text-mist-400">· ниво {s.level} · {s.trips} курса{s.online ? ' · онлайн' : ''}</span></span>
                    {s.status === 'done' ? <Badge tone="green">Стигна ниво {MENTOR.goalLevel} · {s.finishedAt ? date(s.finishedAt) : ''}</Badge> : <Badge tone="cyan"><Clock className="h-3 w-3" />още {daysLeft(s.endsAt, now)} дни</Badge>}
                  </div>
                  {s.status === 'active' && (
                    <>
                      <Meter className="mt-2" value={(s.xp / goalXp) * 100} tone="gold" />
                      <div className="mt-2 flex justify-end"><ActionButton action={{ type: 'endMentorship', id: s.id }} className="btn-ghost px-3 py-1 text-xs" confirm={`Да прекратим ли наставничеството на ${s.username}?`}>Прекрати</ActionButton></div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {!o.mentor && !o.canPick && !o.canMentor && o.students.length === 0 && (
        <Card>
          <Empty icon={GraduationCap} title="Наставничеството е за новите и за опитните">{`Нов играч си избира наставник през първите ${MENTOR.newcomerDays} дни (под ниво ${MENTOR.goalLevel}). От ниво ${MENTOR.mentorLevel} ти също можеш да станеш наставник.`}</Empty>
        </Card>
      )}
    </div>
  );
}
