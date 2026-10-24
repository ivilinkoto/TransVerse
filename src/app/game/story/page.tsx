import { BookOpen, Lock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { STORY } from '@/lib/game/story';
import { gameContext } from '@/server/game/context';
import { storyOf } from '@/server/game/story';
import { t as tr, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Историята') };
}

export default async function StoryPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.story) notFound();
  const p = await storyOf(db, user.id);
  const current = STORY[p.chapter];
  return (
    <div className="space-y-6">
      <PageHeader title={tr('Историята')} subtitle={tr('Бай Стоян, Мария от диспечерската и фирма „Сив Вълк“ — глава по глава. Героите са измислени.')} />
      {current ? (
        <Card title={<span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-mist-400" />{tr('Глава {0}: {1}', p.chapter + 1, current.title)}</span>} actions={<Badge tone="violet">{tx(current.who)}</Badge>}>
          {user.level < current.minLevel ? (
            <p className="flex items-center gap-2 text-sm text-mist-300"><Lock className="h-4 w-4" />{tr('Главата се отключва от ниво {0}.', current.minLevel)}</p>
          ) : (
            <>
              <blockquote className="border-l-2 border-violet-400/60 pl-3 text-sm italic text-mist-200">{tx(current.intro)}</blockquote>
              <ul className="mt-4 space-y-3 text-sm">
                {current.tasks.map((t, i) => {
                  const n = p.counts[i] ?? 0;
                  return (
                    <li key={i}>
                      <div className="flex justify-between"><span>{n >= t.target ? '✅' : '◻️'} {tx(t.label)}</span><span className="num text-xs text-mist-400">{Math.min(n, t.target).toLocaleString(intlLocale())} / {t.target.toLocaleString(intlLocale())}</span></div>
                      <Meter value={(Math.min(n, t.target) / t.target) * 100} tone="violet" className="mt-1" />
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-mist-400">{tr('Награда: {0}, +{1} опит и {2} TC.', money(current.rewardCents), current.xp, current.coins)}</p>
            </>
          )}
        </Card>
      ) : (
        <Card title={tr('Историята е изпълнена 🎉')}><p className="text-sm text-mist-300">„{tx(STORY[STORY.length - 1]!.outro)}“</p></Card>
      )}
      <Card title={tr('Главите')}>
        <ol className="space-y-2 text-sm">
          {STORY.map((c, i) => (
            <li key={c.title} className="flex flex-wrap items-center justify-between gap-2">
              <span>{i + 1}. {tx(c.title)} <span className="text-xs text-mist-400">{tr('· от ниво {0}', c.minLevel)}</span></span>
              <Badge tone={i < p.chapter ? 'green' : i === p.chapter ? 'violet' : 'neutral'}>{i < p.chapter ? tr('изпълнена') : i === p.chapter ? tr('сега') : tr('предстои')}</Badge>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
