import { Trophy } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { dateTime, int } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { isStaff } from '@/server/auth/roles';
import { cupView } from '@/server/game/tournament';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Пролетна купа') };
}

/** v1.6: the spring cup — a four-week knockout by on-time loaded kilometres. Game data. */
export default async function CupPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.spring_cup) notFound();
  const cup = await cupView(db, now, user.id);
  const started = cup.rounds[0]!.matches.length > 0;
  return (
    <div className="space-y-6">
      <PageHeader
        title={tx(cup.title)}
        subtitle={t('Елиминации за до 16 шофьори: всяка седмица един кръг, продължава този с повече километри с товар навреме.')}
        help={t('Записване до {0} (ниво {1}+, първите {2}). Поставянето е по ниво. При равенство продължава по-високо поставеният. Награди: шампион {3} TC и значка, финалист {4} TC, полуфиналисти по {5} TC. Игрови данни.', dateTime(cup.rounds[0]!.from), cup.minLevel, cup.size, cup.prizes.champion, cup.prizes.finalist, cup.prizes.semifinal)}
      />
      {cup.cancelled && <Card><p className="text-sm text-mist-300">{t('Купата се отменя — записаха се твърде малко шофьори. Следващата купа идва със следващо обновление.')}</p></Card>}
      {!started && !cup.cancelled && (
        <Card title={t('Записани: {0} / {1}', cup.entries.length, cup.size)}>
          {cup.signupOpen && !cup.joined && cup.entries.length < cup.size && (
            <div className="mb-3"><ActionButton action={{ type: 'joinCup' }} className="btn-primary">{t('Запиши ме')}</ActionButton></div>
          )}
          {cup.joined && <p className="mb-3 text-sm text-profit">{t('Записан си. Първият кръг започва на {0}.', dateTime(cup.rounds[0]!.from))}</p>}
          {!cup.signupOpen && now < cup.rounds[0]!.from && <p className="mb-3 text-sm text-mist-400">{t('Записването започва с обновлението.')}</p>}
          <div className="flex flex-wrap gap-2">{cup.entries.map((e) => <Badge key={e.userId} tone={e.userId === user.id ? 'cyan' : 'neutral'}>{t('{0} · ниво {1}', e.username, e.level)}</Badge>)}</div>
          {isStaff(user.role) && cup.entries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-white/5 pt-3 text-xs">
              <span className="text-mist-400">{t('Екип:')}</span>
              {cup.entries.map((e) => <ActionButton key={e.userId} endpoint="/api/admin/action" action={{ type: 'removeCupEntrant', userId: e.userId }} className="btn-ghost px-2 py-1 text-xs" confirm={t('Да махнем ли {0} от купата?', e.username)}>{t('Махни {0}', e.username)}</ActionButton>)}
            </div>
          )}
        </Card>
      )}
      {started ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {cup.rounds.map((r) => (
            <Card key={r.title} title={<span className="inline-flex items-center gap-2">{tx(r.title)}{r.live ? <Badge tone="green">{t('тече')}</Badge> : null}</span>}>
              <p className="text-xs text-mist-400">{dateTime(r.from)} – {dateTime(r.to)}</p>
              {r.matches.length ? (
                <ul className="mt-2 space-y-2 text-sm">
                  {r.matches.map((m) => (
                    <li key={m.slot} className="rounded-lg border border-asphalt-700 px-2 py-1.5">
                      {[{ n: m.a, id: m.aId, km: m.aKm }, { n: m.b, id: m.bId, km: m.bKm }].map((s, i) => (
                        <div key={i} className={`flex justify-between ${m.settled && m.winner === s.n ? 'font-semibold text-profit' : ''} ${s.id === user.id ? 'text-cyan-glow' : ''}`}>
                          <span>{s.n ?? <span className="text-mist-500">{t('свободно')}</span>}</span>
                          <span className="num">{s.km != null ? t('{0} км', int(s.km)) : ''}</span>
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-mist-400">{t('Двойките се знаят след предишния кръг.')}</p>
              )}
            </Card>
          ))}
        </div>
      ) : (
        cup.entries.length === 0 && <Card><Empty icon={Trophy} title={t('Още няма записани')}>{t('Бъди първият!')}</Empty></Card>
      )}
    </div>
  );
}
