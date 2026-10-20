'use client';

import { CornerUpLeft, X } from 'lucide-react';

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
