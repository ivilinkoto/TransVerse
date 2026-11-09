import type { Metadata } from 'next';
import { t as tr } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import { ShopView } from './ShopView';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: tr('Магазин') };
}

/** The shop as a page (a direct link or a payment return); inside the game it opens as a window (1.2.3.6). */
export default async function ShopPage({ searchParams }: { searchParams: Promise<{ payment?: string }> }) {
  await initLocale();
  return <ShopView cancelled={(await searchParams).payment === 'cancelled'} />;
}
