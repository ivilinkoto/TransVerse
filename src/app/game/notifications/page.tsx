import { NotificationsView } from './NotificationsView';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Известия') };
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ f?: string }> }) {
  await initLocale();
  return <NotificationsView wanted={(await searchParams).f} />;
}
