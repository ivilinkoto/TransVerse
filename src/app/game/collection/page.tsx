import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ALBUM, PERFECT, perfectBonusShare } from '@/lib/game/competition';
import { users } from '@/server/db/schema';
import { albumOf } from '@/server/game/competition';
import { gameContext } from '@/server/game/context';

export const metadata = { title: 'Албум „Градове“' };

export default async function CollectionPage() {
  const { db, user, features } = await gameContext();
  if (!features.city_album) notFound();
  const [pages, [me]] = await Promise.all([albumOf(db, user.id), db.select({ streak: users.perfectStreak, best: users.bestPerfectStreak }).from(users).where(eq(users.id, user.id))]);
  const total = pages.reduce((s, p) => s + p.cities.length, 0);
  const have = pages.reduce((s, p) => s + p.cities.filter((c) => c.at).length, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Албум „Градове“"
        subtitle={`Картичка за всеки голям град, до който доставиш. Събрани: ${have} от ${total}.`}
        help={`Всяка държава има страница с ${ALBUM.citiesPerCountry}-те си най-големи града от товарния пазар (истински градове). Първата доставка до град отключва картичката му. Пълна страница — ${ALBUM.coins} ТрансКоин и значка „Албум“.`}
      />
      {features.perfect_run && (
        <Card title="Перфектна серия">
          <p className="text-sm text-mist-300">Перфектен курс: навреме, без повреда или полиция по пътя, без глоба и с камион, пълен поне {Math.round(PERFECT.minFill * 100)} %. Всеки поред добавя +{Math.round(PERFECT.bonusPerStep * 100)} % към заплащането (до +{Math.round(PERFECT.maxBonus * 100)} %). Значки на {PERFECT.badges.map(([n]) => n).join(', ')} подред.</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm"><Badge tone="gold">Сега: {me?.streak ?? 0} подред · +{Math.round(perfectBonusShare(me?.streak ?? 0) * 100)} %</Badge><Badge tone="violet">Най-добра: {me?.best ?? 0}</Badge></div>
        </Card>
      )}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {pages.map((p) => {
          const got = p.cities.filter((c) => c.at).length;
          return (
            <Card key={p.code} title={`${p.name} · ${got}/${p.cities.length}`}>
              <Meter value={(got / p.cities.length) * 100} tone="gold" />
              <ul className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
                {p.cities.map((c) => (
                  <li key={c.id} className={`truncate rounded-lg border px-2 py-1 ${c.at ? 'border-gold-400/50 bg-gold-400/10 text-white' : 'border-dashed border-asphalt-700 text-mist-500'}`} title={c.at ? `Първа доставка: ${c.at.toLocaleDateString('bg-BG')}` : 'Още не си доставял тук'}>
                    {c.at ? '★ ' : ''}{c.name}
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
