import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ThumbsUp } from 'lucide-react';
import { Badge, Card, PageHeader } from '@/components/ui';
import { ActionButton } from '@/components/ui/ActionButton';
import { IdeaForm, IdeaStatusForm } from '@/components/game/IdeaForms';
import { date } from '@/lib/format';
import { gameContext } from '@/server/game/context';
import { IDEAS, ideaBoard } from '@/server/game/ideas';
import { isStaff } from '@/server/auth/roles';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Идеи') };
}

const SORTS = [
  { id: 'top', label: 'Най-харесвани' },
  { id: 'new', label: 'Нови' },
  { id: 'planned', label: 'Планирани и направени' },
] as const;
const STATUS: Record<string, { label: string; tone: 'neutral' | 'cyan' | 'green' | 'red' | 'violet' }> = {
  open: { label: 'отворена', tone: 'neutral' },
  planned: { label: 'планирана', tone: 'cyan' },
  done: { label: 'направена', tone: 'green' },
  declined: { label: 'отхвърлена', tone: 'red' },
  hidden: { label: 'скрита', tone: 'violet' },
};

/** 1.1.4: players' ideas for the game, with votes. */
export default async function IdeasPage({ searchParams }: { searchParams: Promise<{ sort?: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.ideas) notFound();
  const { sort: raw } = await searchParams;
  const sort = SORTS.some((s) => s.id === raw) ? (raw as (typeof SORTS)[number]['id']) : 'top';
  const staff = isStaff(user.role);
  const list = await ideaBoard(db, user.id, sort, staff);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Идеи за играта')} subtitle={t('Предложи какво да добавим или променим и гласувай за идеите на другите. Най-харесваните идеи се виждат от екипа на първо място.')} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.6fr]">
        <Card title={t('Нова идея')}>
          {user.level >= IDEAS.minLevel ? <IdeaForm /> : <p className="text-sm text-mist-400">{t('Идеи се предлагат от ниво {0}. Дотогава можеш да гласуваш.', IDEAS.minLevel)}</p>}
          <p className="mt-3 text-xs text-mist-400">{t('До {0} идеи на ден. Една идея — едно нещо. Проблем или грешка? По-бързо е през „Помощ → Поддръжка“.', IDEAS.perDay)}</p>
        </Card>
        <div className="space-y-3">
          <nav className="flex flex-wrap gap-1.5" aria-label={t('Подреждане')}>
            {SORTS.map((s) => <Link key={s.id} href={`/game/ideas?sort=${s.id}`} aria-current={sort === s.id ? 'page' : undefined} className={`rounded-full border px-3 py-1 text-xs font-medium ${sort === s.id ? 'border-cyan-glow/50 bg-cyan-glow/10 text-cyan-glow' : 'border-asphalt-700 text-mist-400 hover:text-white'}`}>{tx(s.label)}</Link>)}
          </nav>
          {list.length === 0 ? <p className="text-sm text-mist-400">{t('Още няма идеи тук — бъди първият!')}</p> : list.map((idea) => {
            const st = STATUS[idea.status] ?? STATUS.open!;
            const closed = idea.status === 'done' || idea.status === 'declined';
            return (
              <Card key={idea.id}>
                <div className="flex gap-3">
                  <div className="flex shrink-0 flex-col items-center gap-1">
                    {idea.mine || closed ? (
                      <span className="flex h-10 w-12 items-center justify-center rounded-xl border border-asphalt-700 text-mist-400"><ThumbsUp className="h-4 w-4" /></span>
                    ) : (
                      <ActionButton action={{ type: 'voteIdea', ideaId: idea.id }} className={`flex h-10 w-12 items-center justify-center rounded-xl border ${idea.votedByMe ? 'border-cyan-glow/60 bg-cyan-glow/15 text-cyan-glow' : 'border-asphalt-700 text-mist-300 hover:text-white'}`}><ThumbsUp className="h-4 w-4" /></ActionButton>
                    )}
                    <span className="num text-sm font-semibold">{idea.votes}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{tx(idea.title)}</span>
                      {idea.status !== 'open' && <Badge tone={st.tone}>{tx(st.label)}</Badge>}
                    </div>
                    {idea.body && <p className="mt-1 whitespace-pre-line text-sm text-mist-300">{tx(idea.body)}</p>}
                    <p className="mt-1 text-xs text-mist-400">{t('от {0} · {1}', idea.author, date(idea.createdAt))}{idea.mine ? t(' · твоя идея') : ''}</p>
                    {idea.staffNote && <p className="mt-2 rounded-lg bg-cyan-glow/10 px-3 py-2 text-sm"><span className="font-semibold text-cyan-glow">{t('Екипът:')}</span>{' '}{tx(idea.staffNote)}</p>}
                    {staff && <IdeaStatusForm ideaId={idea.id} status={idea.status} note={idea.staffNote} />}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
