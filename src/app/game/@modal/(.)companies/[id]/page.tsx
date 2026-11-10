import Page from '../../../companies/[id]/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { windowsLive } from '@/server/game/tutorial-flags';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: a company's public profile opens as a game window. */
export default async function CompanyWindow({ params }: { params: Promise<{ id: string }> }) {
  await initLocale();
  const { db, user, features } = await gameContext();
  const live = await windowsLive(db, user.id, features);
  const { id } = await params;
  return (
    <RouteWindow title={t('Компания')} icon="🏢" live={live} href={`/game/companies/${encodeURIComponent(id)}`} size="lg" testId="company-window">
      {live && <Page params={Promise.resolve({ id })} />}
    </RouteWindow>
  );
}
