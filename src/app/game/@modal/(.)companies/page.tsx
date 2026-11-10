import Page from '../../companies/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: all companies open as a game window over the current page. */
export default async function CompaniesWindow({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  const params = await searchParams;
  return (
    <RouteWindow title={t('Всички компании')} icon="🏢" live={live} href={params.q ? `/game/companies?q=${encodeURIComponent(params.q)}` : '/game/companies'} size="lg" testId="companies-window">
      {live && <Page searchParams={Promise.resolve(params)} />}
    </RouteWindow>
  );
}
