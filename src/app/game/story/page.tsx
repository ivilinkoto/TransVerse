import { BookOpen, Lock } from 'lucide-react';
import { notFound } from 'next/navigation';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { money } from '@/lib/format';
import { STORY } from '@/lib/game/story';
import { gameContext } from '@/server/game/context';
import { storyOf } from '@/server/game/story';

export const metadata = { title: 'Историята' };

export default async function StoryPage() {
  const { db, user, features } = await gameContext();
  if (!features.story) notFound();
  const p = await storyOf(db, user.id);
  const current = STORY[p.chapter];
  return (
    <div className="space-y-6">
      <PageHeader title="Историята" subtitle="Бай Стоян, Мария от диспечерската и фирма „Сив Вълк“ — глава по глава. Героите са измислени." />
      {current ? (
        <Card title={<span className="inline-flex items-center gap-2"><BookOpen className="h-4 w-4 text-mist-400" />Глава {p.chapter + 1}: {current.title}</span>} actions={<Badge tone="violet">{current.who}</Badge>}>
          {user.level < current.minLevel ? (
            <p className="flex items-center gap-2 text-sm text-mist-300"><Lock className="h-4 w-4" />Главата се отключва от ниво {current.minLevel}.</p>
          ) : (
            <>
              <blockquote className="border-l-2 border-violet-400/60 pl-3 text-sm italic text-mist-200">{current.intro}</blockquote>
              <ul className="mt-4 space-y-3 text-sm">
                {current.tasks.map((t, i) => {
                  const n = p.counts[i] ?? 0;
                  return (
                    <li key={i}>
                      <div className="flex justify-between"><span>{n >= t.target ? '✅' : '◻️'} {t.label}</span><span className="num text-xs text-mist-400">{Math.min(n, t.target).toLocaleString('bg-BG')} / {t.target.toLocaleString('bg-BG')}</span></div>
                      <Meter value={(Math.min(n, t.target) / t.target) * 100} tone="violet" className="mt-1" />
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs text-mist-400">Награда: {money(current.rewardCents)}, +{current.xp} опит и {current.coins} TC.</p>
            </>
          )}
        </Card>
      ) : (
        <Card title="Историята е изпълнена 🎉"><p className="text-sm text-mist-300">„{STORY[STORY.length - 1]!.outro}“</p></Card>
      )}
      <Card title="Главите">
        <ol className="space-y-2 text-sm">
          {STORY.map((c, i) => (
            <li key={c.title} className="flex flex-wrap items-center justify-between gap-2">
              <span>{i + 1}. {c.title} <span className="text-xs text-mist-400">· от ниво {c.minLevel}</span></span>
              <Badge tone={i < p.chapter ? 'green' : i === p.chapter ? 'violet' : 'neutral'}>{i < p.chapter ? 'изпълнена' : i === p.chapter ? 'сега' : 'предстои'}</Badge>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
