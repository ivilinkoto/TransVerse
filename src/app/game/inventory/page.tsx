import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/ui';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import { InventoryView } from './InventoryView';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Инвентар') };
}

/** 1.2 „Инвентар“ as a page (a direct link); from inside the game it opens as a window (1.2.3.6). */
export default async function InventoryPage() {
  await initLocale();
  const { features } = await gameContext();
  if (!features.inventory) notFound();
  return (
    <div className="space-y-6">
      <PageHeader title={t('Инвентар')} subtitle={t('Предмети, кейсове и колекции. Кейсовете се печелят само с игра — шансът на всеки предмет се вижда.')} />
      <InventoryView />
    </div>
  );
}
