import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { Card, PageHeader } from '@/components/ui';
import { Workshop } from '@/components/game/Workshop';
import { ItemArt } from '@/components/game/ItemArt';
import { ITEMS, RECIPES, type ItemId } from '@/lib/game/items';
import { gameContext } from '@/server/game/context';
import { inventoryOf } from '@/server/game/inventory';
import { knownRecipes } from '@/server/game/item-trade';
import { t, tx } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Работилница') };
}

/** 1.2.1 „Работилница“ and „Тетрадка на механика“. */
export default async function WorkshopPage({ searchParams }: { searchParams: Promise<{ item?: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  if (!features.workshop) notFound();
  const { item } = await searchParams;
  const [items, known] = await Promise.all([inventoryOf(db, user.id), knownRecipes(db, user.id)]);
  const mine = items.filter((i): i is { itemId: ItemId; qty: number } => i.itemId in ITEMS);
  return (
    <div className="space-y-6">
      <PageHeader title={t('Работилница')} subtitle={t('Сглоби по-редки предмети от повторените и открий рецептите на механика.')} />
      <Workshop items={mine} start={item && item in ITEMS ? (item as ItemId) : null} />
      <Card title={t('Тетрадка на механика ({0}/{1})', known.length, RECIPES.length)}>
        <ul className="grid gap-2 sm:grid-cols-2">
          {RECIPES.map((r) => {
            const open = known.includes(r.id);
            const parts = Object.entries(r.needs) as [ItemId, number][];
            return (
              <li key={r.id} className={`flex items-center gap-3 rounded-xl border p-3 ${open ? 'border-gold-400/40 bg-gold-400/5' : 'border-asphalt-800 bg-asphalt-900/40'}`}>
                <span className="flex items-center gap-0.5">
                  {parts.map(([id, n]) => (
                    <span key={id} className="relative">
                      {open ? <ItemArt id={id} className="h-8 w-8" /> : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-asphalt-800 text-mist-500">?</span>}
                      {n > 1 && <span className="num absolute -right-1 -top-1 rounded-full bg-asphalt-950 px-1 text-[9px] font-bold">×{n}</span>}
                    </span>
                  ))}
                  <span className="mx-1 text-mist-500">→</span>
                  {open ? <ItemArt id={r.makes} className="h-9 w-9" /> : <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-asphalt-800 text-mist-500">?</span>}
                </span>
                <span className="min-w-0 text-xs">
                  {open ? <span className="font-semibold">{tx(ITEMS[r.makes].name)}</span> : <span className="italic text-mist-400">{tx(r.hint)}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
