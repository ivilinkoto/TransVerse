'use client';

import { CornerUpLeft, Pin, SmilePlus, X } from 'lucide-react';
import { useState } from 'react';
import { REACTIONS } from '@/lib/game/social';

export interface ReplyQuoteData {
  id: number;
  username: string;
  body: string | null;
}

/** The quoted message above a reply; clicking it jumps to the original when it is on screen. */
export function ReplyQuote({ reply, onJump }: { reply: ReplyQuoteData; onJump?: (id: number) => void }) {
  return (
    <button type="button" onClick={() => onJump?.(reply.id)} className="mb-1 flex w-full min-w-0 items-start gap-1 rounded-lg border-l-2 border-cyan-glow/70 bg-asphalt-950/40 px-2 py-1 text-left text-[11px] hover:bg-asphalt-950/60">
      <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0 text-cyan-glow" />
      <span className="min-w-0">
        <b className="text-cyan-glow">{reply.username}</b> <span className={`line-clamp-2 break-words ${reply.body === null ? 'italic text-mist-400' : 'text-mist-300'}`}>{reply.body ?? 'Съобщението е изтрито.'}</span>
      </span>
    </button>
  );
}

/** The bar over the message box while answering a message. */
export function ReplyBar({ to, onCancel }: { to: ReplyQuoteData; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 border-t border-asphalt-800 bg-asphalt-850/60 px-3 py-1.5 text-xs">
      <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-cyan-glow" />
      <span className="min-w-0 flex-1 truncate">Отговор на <b className="text-cyan-glow">{to.username}</b>: <span className="text-mist-300">{to.body ?? ''}</span></span>
      <button type="button" className="shrink-0 rounded-full p-0.5 text-mist-400 hover:text-white" onClick={onCancel} aria-label="Откажи отговора"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
}

/** Scrolls a message of the list into view and flashes it. */
export function jumpToMessage(container: HTMLElement | null, id: number) {
  const el = container?.querySelector<HTMLElement>(`[data-message="${id}"]`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.animate([{ backgroundColor: 'rgba(34,211,238,0.25)' }, { backgroundColor: 'transparent' }], { duration: 1400 });
}

/** Reactions under a message: chips with counts (who reacted on hover); a click toggles one's own. */
export function Reactions({ items, onToggle, canReact }: { items: { emoji: string; count: number; mine: boolean; names: string[] }[]; onToggle: (emoji: string) => void; canReact: boolean }) {
  if (!items.length) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {items.map((r) => (
        <button key={r.emoji} type="button" disabled={!canReact} onClick={() => onToggle(r.emoji)} title={r.names.join(', ')} aria-pressed={r.mine} aria-label={`${r.emoji} ${r.count}`} className={`flex items-center gap-1 rounded-full border px-1.5 py-0 text-xs ${r.mine ? 'border-cyan-glow/70 bg-cyan-glow/15' : 'border-asphalt-600 bg-asphalt-900/50'}`}>
          <span>{r.emoji}</span>
          <span className="num text-[10px] text-mist-300">{r.count}</span>
        </button>
      ))}
    </div>
  );
}

/** A button with the other buttons of a message that opens the reactions to pick. */
export function ReactionPicker({ onPick, mine }: { onPick: (emoji: string) => void; mine: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button type="button" className="text-mist-400 opacity-60 transition hover:text-gold-400 group-hover:opacity-100" onClick={() => setOpen((o) => !o)} aria-label="Реакция" aria-expanded={open} title="Реакция"><SmilePlus className="h-3 w-3" /></button>
      {open && (
        <span className="absolute bottom-full left-1/2 z-10 mb-1 flex -translate-x-1/2 gap-0.5 rounded-full border border-asphalt-600 bg-asphalt-900 px-1.5 py-1 shadow-lg">
          {REACTIONS.map((e) => (
            <button key={e} type="button" onClick={() => { onPick(e); setOpen(false); }} className={`rounded-full px-1 text-base leading-none hover:bg-asphalt-700 ${mine.includes(e) ? 'bg-cyan-glow/20' : ''}`} aria-label={`Реагирай с ${e}`}>{e}</button>
          ))}
        </span>
      )}
    </span>
  );
}

/** The message pinned on top of the company chat. */
export function PinnedBar({ pinned, canPin, onUnpin, onJump }: { pinned: { id: number; username: string; body: string }; canPin: boolean; onUnpin: () => void; onJump: (id: number) => void }) {
  return (
    <div className="flex items-start gap-2 border-b border-asphalt-800 bg-gold-400/10 px-3 py-2 text-xs">
      <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gold-400" />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onJump(pinned.id)}>
        <b className="text-gold-300">Закачено от {pinned.username}: </b>
        <span className="line-clamp-2 break-words text-mist-200">{pinned.body}</span>
      </button>
      {canPin && <button type="button" className="shrink-0 text-mist-400 hover:text-white" onClick={onUnpin} aria-label="Откачи съобщението"><X className="h-3.5 w-3.5" /></button>}
    </div>
  );
}
