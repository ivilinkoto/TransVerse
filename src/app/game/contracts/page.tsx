import { ContractsView, type ContractsParams } from './ContractsView';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';
import type { Metadata } from 'next';

export async function generateMetadata(): Promise<Metadata> {
  await initLocale();
  return { title: t('Поръчки') };
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<ContractsParams> }) {
  await initLocale();
  return <ContractsView params={await searchParams} />;
}
