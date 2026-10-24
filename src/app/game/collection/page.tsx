import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { Badge, Card, Meter, PageHeader } from '@/components/ui';
import { ALBUM, PERFECT, perfectBonusShare } from '@/lib/game/competition';
import { users } from '@/server/db/schema';
import { albumOf } from '@/server/game/competition';
import { gameContext } from '@/server/game/context';
import { t, tx, intlLocale } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Албум „Градове“') };
}

export default async function CollectionPage() {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.city_album) notFound();
  const [pages, [me]] = await Promise.all([albumOf(db, user.id), db.select({ streak: users.perfectStreak, best: users.bestPerfectStreak }).from(users).where(eq(users.id, user.id))]);
  const total = pages.reduce((s, p) => s + p.cities.length, 0);
  const have = pages.reduce((s, p) => s + p.cities.filter((c) => c.at).length, 0);
  return (
    <div className="space-y-6">
      <PageHeader
        title={t('Албум „Градове“')}
        subtitle={t('Картичка за всеки голям град, до който доставиш. Събрани: {0} от {1}.', have, total)}
        help={t('Всяка държава има страница с {0}-те си най-големи града от товарния пазар (истински градове). Първата доставка до град отключва картичката му. Пълна страница — {1} ТрансКоин и значка „Албум“.', ALBUM.citiesPerCountry, ALBUM.coins)}
      />
      {features.perfect_run && (
        <Card title={t('Перфектна серия')}>
          <p className="text-sm text-mist-300">{t('Перфектен курс: навреме, без повреда или полиция по пътя, без глоба и с камион, пълен поне {0} %. Всеки поред добавя +{1} % към заплащането (до +{2} %). Значки на', Math.round(PERFECT.minFill * 100), Math.round(PERFECT.bonusPerStep * 100), Math.round(PERFECT.maxBonus * 100))}{' '}{PERFECT.badges.map(([n]) => n).join(', ')}{' '}{t('подред.')}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm"><Badge tone="gold">{t('Сега: {0} подред · +{1} %', me?.streak ?? 0, Math.round(perfectBonusShare(me?.streak ?? 0) * 100))}</Badge><Badge tone="violet">{t('Най-добра: {0}', me?.best ?? 0)}</Badge></div>
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
                  <li key={c.id} className={`truncate rounded-lg border px-2 py-1 ${c.at ? 'border-gold-400/50 bg-gold-400/10 text-white' : 'border-dashed border-asphalt-700 text-mist-500'}`} title={c.at ? t('Първа доставка: {0}', c.at.toLocaleDateString(intlLocale())) : t('Още не си доставял тук')}>
                    {c.at ? '★ ' : ''}{tx(c.name)}
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
