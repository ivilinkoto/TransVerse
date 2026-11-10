import Page from '../../staff/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: the drivers open as a game window over the current page. */
export default async function StaffWindow({ searchParams }: { searchParams: Promise<{ driver?: string }> }) {
  await initLocale();
  const { features } = await gameContext();
  const live = !!features.game_ui;
  const { driver } = await searchParams;
  return (
    <RouteWindow title={t('Шофьори')} icon="🧑‍✈️" live={live} href={driver ? `/game/staff?driver=${encodeURIComponent(driver)}` : '/game/staff'} size="xl" testId="staff-window">
      {live && <Page searchParams={Promise.resolve({ driver })} />}
    </RouteWindow>
  );
}
