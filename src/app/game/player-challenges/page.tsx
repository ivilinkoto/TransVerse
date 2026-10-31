import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Flag } from 'lucide-react';
import { Badge, Card, Empty, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { FormAction } from '@/components/ui/FormAction';
import { dateTime, money } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { loadHubs } from '@/server/game/contracts';
import { PLAYER_CHALLENGE, challengeBoard, openChallenges } from '@/server/game/player-challenges';
import { cities } from '@/server/db/schema';
import { inArray } from 'drizzle-orm';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Предизвикателства от играчи') };
}

/** 1.1.4.2: challenges players set for each other — the fastest loaded run on a lane. */
export default async function PlayerChallengesPage() {
  await initLocale();
  const { db, user, now, features } = await gameContext();
  if (!features.player_challenges) notFound();
  const list = await openChallenges(db, user.id, now);
  const boards = await Promise.all(list.map((c) => challengeBoard(db, c.id)));
  const hubs = (await loadHubs(db, { now })).sort((a, b) => b.population - a.population).slice(0, 80);
  const names = await db.select({ id: cities.id, nameBg: cities.nameBg, cc: cities.countryCode }).from(cities).where(inArray(cities.id, hubs.map((h) => h.id)));
  const options = names.sort((a, b) => a.nameBg.localeCompare(b.nameBg, 'bg')).map((c) => ({ value: String(c.id), label: `${tx(c.nameBg)} (${c.cc})` }));
  return (
    <div className="space-y-6">
      <PageHeader title={t('Предизвикателства от играчи')} subtitle={t('Задай линия и награда — най-бързият курс с товар печели. Популярно предизвикателство (5+ играчи) носи на създателя {0} ТрансКоин.', PLAYER_CHALLENGE.creatorCoins)} />
      <Card title={t('Ново предизвикателство')}>
        <FormAction
          action={{ type: 'createPlayerChallenge' }}
          fields={[
            { name: 'title', label: t('Име'), type: 'text', defaultValue: t('Най-бърз до морето') },
            { name: 'originCityId', label: t('От'), type: 'select', options },
            { name: 'destCityId', label: t('До'), type: 'select', options, defaultValue: options[1]?.value },
            { name: 'days', label: t('Дни'), type: 'number', defaultValue: 3, min: 1, max: PLAYER_CHALLENGE.maxDays },
            { name: 'prizeLev', label: t('Награда, лв.'), type: 'number', defaultValue: 500, min: PLAYER_CHALLENGE.minPrizeCents / 100, max: PLAYER_CHALLENGE.maxPrizeCents / 100 },
            { name: 'soloOnly', label: t('Само с един шофьор'), type: 'checkbox' },
          ]}
          submit={t('Създай')}
        />
        <p className="mt-2 text-xs text-mist-400">{t('Наградата се плаща сега. Ако никой не измине линията, се връща при теб.')}</p>
      </Card>
      {!list.length ? <Empty icon={Flag} title={t('Няма отворени предизвикателства')}>{t('Създай първото.')}</Empty> : list.map((c, i) => (
        <Card key={c.id} title={c.title} actions={<span className="num text-profit">{money(c.prizeCents)}</span>}>
          <p className="text-sm">{tx(c.from)} → {tx(c.to)} {c.soloOnly && <Badge tone="violet">{t('само соло')}</Badge>}</p>
          <p className="mt-1 text-xs text-mist-400">{t('От {0} · до {1} · {2} играчи', c.creator, dateTime(c.endsAt), c.players)}</p>
          {boards[i]!.length > 0 && (
            <ol className="mt-2 space-y-0.5 text-sm">
              {boards[i]!.map((b, j) => <li key={b.username} className="num">{j + 1}. {b.username} — {t('{0} мин', Math.round(b.minutes ?? 0))}</li>)}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {c.creatorId !== user.id && !c.joined && <ActionButton action={{ type: 'joinPlayerChallenge', id: c.id }} className="btn-primary px-3 py-1 text-xs">{t('Включи се')}</ActionButton>}
            {c.joined && <Badge tone="green">{t('Участваш — вземи товар по линията')}</Badge>}
            <a href={`/game/contracts?repeat=${c.originCityId}-${c.destCityId}`} className="btn-ghost px-3 py-1 text-xs">{t('Товари по линията')}</a>
          </div>
        </Card>
      ))}
    </div>
  );
}
