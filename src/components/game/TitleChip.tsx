import { TITLES } from '@/lib/game/first-snow';
import { tx } from '@/i18n/t';

/** 1.2.5: a player's title next to the name (the chat, the player card, the rankings). */
export function TitleChip({ id, className = '' }: { id: string; className?: string }) {
  const title = TITLES[id];
  if (!title) return null;
  return (
    <span className={`ml-1 inline-flex items-center rounded-md border px-1.5 py-px align-middle text-[10px] font-semibold ${className}`} style={{ color: title.color, borderColor: `${title.color}66`, background: `${title.color}14` }} data-testid="title-chip">
      ❄ {tx(title.label)}
    </span>
  );
}
