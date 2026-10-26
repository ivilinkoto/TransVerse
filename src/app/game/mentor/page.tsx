import { notFound } from 'next/navigation';
import { Clock, GraduationCap, HandHeart, Sparkles } from 'lucide-react';
import { PlayerName } from '@/components/game/PlayerName';
import { Badge, Card, Empty, Meter, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { date, money } from '@/lib/format';
import { MENTOR } from '@/lib/game/mentor';
import { xpForLevel } from '@/lib/game/progression';
import { gameContext } from '@/server/game/context';
import { availableMentors, mentorOverview } from '@/server/game/mentor';
import { t, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Наставник') };
}

const daysLeft = (end: Date, now: Date) => Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000));

export default async function MentorPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.mentor) notFound();
  const o = await mentorOverview(db, user.id, now);
  const mentors = o.canPick ? await availableMentors(db, user.id, now) : [];
  const goalXp = xpForLevel(MENTOR.goalLevel);

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Наставник')}
        subtitle={t('Опитните шофьори помагат на новите — и двамата печелят.')}
        help={t('Нов играч (до {0} дни в играта, под ниво {1}) избира наставник от ниво {2}+. Докато трае наставничеството, ученикът получава +{3} % опит. Ако стигне ниво {4} до {5} дни, наставникът получава {6}, {7} TC и значка „Наставник“, а ученикът — {8} и {9} TC. Наградата за всеки нов играч е веднъж; наставник и ученик от една и съща мрежа не може.', MENTOR.newcomerDays, MENTOR.goalLevel, MENTOR.mentorLevel, Math.round(MENTOR.xpBonus * 100), MENTOR.goalLevel, MENTOR.days, money(MENTOR.mentorCents), MENTOR.mentorCoins, money(MENTOR.menteeCents), MENTOR.menteeCoins)}
      />

      {o.mentor && (
        <Card title={<span className="inline-flex items-center gap-2"><GraduationCap className="h-4 w-4 text-cyan-glow" />{t('Твоят наставник')}</span>}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-display text-lg font-bold"><PlayerName name={o.mentor.username} /> <span className="text-sm font-normal text-mist-400">{t('· ниво {0}{1}', o.mentor.level, o.mentor.online ? t(' · онлайн') : '')}</span></div>
              <p className="mt-1 text-sm text-mist-300">{t('Пиши му в чата, питай за линии и камиони. Получаваш +{0} % опит от курсовете.', Math.round(MENTOR.xpBonus * 100))}</p>
            </div>
            <Badge tone="cyan"><Clock className="h-3 w-3" />{t('още {0} дни', daysLeft(o.mentor.endsAt, now))}</Badge>
          </div>
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-xs text-mist-400"><span>{t('Към ниво {0}', MENTOR.goalLevel)}</span><span className="num">{t('{0} / {1} опит', user.xp.toLocaleString(intlLocale()), goalXp.toLocaleString(intlLocale()))}</span></div>
            <Meter value={(user.xp / goalXp) * 100} tone="cyan" />
          </div>
          <div className="mt-3"><ActionButton action={{ type: 'endMentorship', id: o.mentor.id }} className="btn-ghost px-3 py-1.5 text-xs" confirm={t('Да прекратим ли наставничеството? Наградата за ниво 5 се губи.')}>{t('Прекрати')}</ActionButton></div>
        </Card>
      )}

      {o.canPick && (
        <Card title={<span className="inline-flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold-400" />{t('Избери наставник')}</span>}>
          <p className="mb-3 text-sm text-mist-300">{t('Нов си в играта — опитен шофьор може да те води до ниво {0}. Получаваш +{1} % опит, а при успех и двамата печелите награда.', MENTOR.goalLevel, Math.round(MENTOR.xpBonus * 100))}</p>
          {mentors.length === 0 ? (
            <Empty icon={GraduationCap} title={t('В момента няма свободни наставници')}>{t('Провери пак по-късно — играчите от ниво 15 нагоре се записват като наставници от тази страница.')}</Empty>
          ) : (
            <ul className="divide-y divide-asphalt-800">
              {mentors.map((m) => (
                <li key={m.userId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <PlayerName name={m.username} className="font-semibold" />
                    <div className="text-xs text-mist-400">{t('ниво {0}{1}{2} · {3}/{4} ученици', m.level, m.online ? t(' · онлайн') : '', m.helped ? t(' · помогнал на {0}', m.helped) : '', m.active, MENTOR.maxMentees)}</div>
                  </div>
                  <ActionButton action={{ type: 'chooseMentor', mentorId: m.userId }} className="btn-primary px-3 py-1.5 text-sm">{t('Избери')}</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {(o.canMentor || o.students.length > 0) && (
        <Card
          title={<span className="inline-flex items-center gap-2"><HandHeart className="h-4 w-4 text-gold-400" />{t('Моите ученици')}</span>}
          actions={o.canMentor ? <ActionButton action={{ type: 'mentorOpen', on: !o.mentorOpen }} className={o.mentorOpen ? 'btn-ghost px-3 py-1.5 text-xs' : 'btn-primary px-3 py-1.5 text-xs'}>{o.mentorOpen ? t('Не приемам нови') : t('Приемам ученици')}</ActionButton> : undefined}
        >
          <p className="mb-3 text-sm text-mist-300">{t('{0} За всеки, който стигне ниво {1} до {2} дни: {3} и {4} TC.', o.mentorOpen ? t('Нови играчи могат да те изберат (до {0} едновременно).', MENTOR.maxMentees) : t('В момента не приемаш нови ученици.'), MENTOR.goalLevel, MENTOR.days, money(MENTOR.mentorCents), MENTOR.mentorCoins)}</p>
          {o.students.length === 0 ? (
            <Empty icon={GraduationCap} title={t('Още нямаш ученици')}>{t('Щом нов играч те избере, ще получиш известие.')}</Empty>
          ) : (
            <ul className="space-y-3">
              {o.students.map((s) => (
                <li key={s.id} className="rounded-xl border border-asphalt-700 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span><PlayerName name={s.username} className="font-semibold" /> <span className="text-xs text-mist-400">{t('· ниво {0} · {1} курса{2}', s.level, s.trips, s.online ? t(' · онлайн') : '')}</span></span>
                    {s.status === 'done' ? <Badge tone="green">{t('Стигна ниво {0} · {1}', MENTOR.goalLevel, s.finishedAt ? date(s.finishedAt) : '')}</Badge> : <Badge tone="cyan"><Clock className="h-3 w-3" />{t('още {0} дни', daysLeft(s.endsAt, now))}</Badge>}
                  </div>
                  {s.status === 'active' && (
                    <>
                      <Meter className="mt-2" value={(s.xp / goalXp) * 100} tone="gold" />
                      <div className="mt-2 flex justify-end"><ActionButton action={{ type: 'endMentorship', id: s.id }} className="btn-ghost px-3 py-1 text-xs" confirm={t('Да прекратим ли наставничеството на {0}?', s.username)}>{t('Прекрати')}</ActionButton></div>
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
          <Empty icon={GraduationCap} title={t('Наставничеството е за новите и за опитните')}>{t('Нов играч си избира наставник през първите {0} дни (под ниво {1}). От ниво {2} ти също можеш да станеш наставник.', MENTOR.newcomerDays, MENTOR.goalLevel, MENTOR.mentorLevel)}</Empty>
        </Card>
      )}
    </div>
  );
}
