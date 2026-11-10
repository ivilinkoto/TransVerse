import Page from '../../../players/[username]/page';
import { RouteWindow } from '@/components/gameui/RouteWindow';
import { gameContext } from '@/server/game/context';
import { t } from '@/i18n/t';
import { initLocale } from '@/i18n/server';

/** 1.3 „Нов облик“: a player's card opens as a game window — from the chat, the rankings or a search. */
export default async function PlayerWindow({ params }: { params: Promise<{ username: string }> }) {
  await initLocale();
  const { features } = await gameContext();
  const live = !!features.game_ui;
  const { username } = await params;
  const name = decodeURIComponent(username);
  return (
    <RouteWindow title={name} icon="🧑‍✈️" live={live} href={`/game/players/${encodeURIComponent(name)}`} size="lg" testId="player-window">
      {live && <Page params={Promise.resolve({ username })} />}
    </RouteWindow>
  );
}
