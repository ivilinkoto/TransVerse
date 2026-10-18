import { ScrollText } from 'lucide-react';
import { ReleaseBody, ReleaseTitle } from '@/components/game/ReleaseNotes';
import { Card, Empty, PageHeader } from '@/components/ui';
import { visibleReleases } from '@/lib/game/releases';
import { isStaff } from '@/server/auth/roles';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Обновления' };

export default async function UpdatesPage() {
  const { user, now } = await gameContext();
  const staff = isStaff(user.role);
  const releases = visibleReleases(now, staff);
  return (
    <div className="space-y-6">
      <PageHeader title="Обновления" subtitle="Какво ново във всяка версия на TransVerse." />
      {releases.length === 0 ? (
        <Card><Empty icon={ScrollText} title="Още няма обновления">Описанията ще се появяват тук.</Empty></Card>
      ) : (
        releases.map((r, i) => (
          <Card key={r.version} id={`v${r.version}`}>
            {staff && new Date(r.publishedAt) > now && <p className="mb-3 rounded-xl border border-amber-sig/40 bg-amber-sig/10 px-3 py-2 text-sm text-amber-sig">Предварителен преглед за персонала — играчите ще го видят от {new Date(r.publishedAt).toLocaleString('bg-BG', { timeZone: 'Europe/Sofia' })}.</p>}
            <ReleaseTitle release={r} as={i === 0 ? 'h2' : 'h3'} />
            <div className="mt-5"><ReleaseBody release={r} /></div>
          </Card>
        ))
      )}
    </div>
  );
}
