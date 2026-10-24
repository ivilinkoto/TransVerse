'use client';

import { useState } from 'react';
import { GLOSSARY } from '@/lib/game/glossary';
import { useFeature } from './Features';

/** v1.9: a game word with a small ⓘ that explains it in one or two sentences. */
export function Term({ id, children }: { id: string; children?: React.ReactNode }) {
  const live = useFeature('glossary');
  const [open, setOpen] = useState(false);
  const g = GLOSSARY[id];
  if (!g) return <>{children}</>;
  return (
    <span className="relative inline-flex items-baseline gap-0.5">
      {children ?? g.term}
      {live && (
        <>
          <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} onBlur={() => setOpen(false)} className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-mist-500 text-[9px] font-bold leading-none text-mist-400 hover:border-cyan-glow hover:text-cyan-glow" aria-label={`Какво е „${g.term}“?`} aria-expanded={open}>i</button>
          {open && <span role="tooltip" className="absolute left-0 top-full z-40 mt-1 w-64 rounded-lg border border-asphalt-600 bg-asphalt-900 p-2.5 text-xs font-normal normal-case leading-relaxed text-mist-200 shadow-xl"><b className="text-white">{g.term}</b> — {g.text}</span>}
        </>
      )}
    </span>
  );
}
