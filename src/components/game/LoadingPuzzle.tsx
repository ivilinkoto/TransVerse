'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import { PUZZLE, puzzleFill, puzzlePieces, type Placement } from '@/lib/game/loading-puzzle';
import { intlLocale, t } from '@/i18n/t';

/**
 * 1.1.4.2 „Подреди ремаркето“: pick a piece, then tap a cell of the trailer
 * floor to put it there (↻ turns it). The server checks the result again.
 */
export function LoadingPuzzle({ deliveryId, endsAt }: { deliveryId: string; endsAt: string }) {
  const router = useRouter();
  const pieces = useMemo(() => puzzlePieces(deliveryId), [deliveryId]);
  const [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState<Placement[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);
  const [turn, setTurn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cells = useMemo(() => {
    const grid: (number | null)[][] = Array.from({ length: PUZZLE.rows }, () => Array<number | null>(PUZZLE.cols).fill(null));
    for (const p of placed) {
      const piece = pieces.find((x) => x.id === p.id)!;
      const w = p.r ? piece.h : piece.w;
      const h = p.r ? piece.w : piece.h;
      for (let y = p.y; y < p.y + h; y++) for (let x = p.x; x < p.x + w; x++) grid[y]![x] = p.id;
    }
    return grid;
  }, [placed, pieces]);
  const fill = (() => {
    try {
      return puzzleFill(pieces, placed);
    } catch {
      return 0;
    }
  })();

  const put = (x: number, y: number) => {
    setError(null);
    const at = cells[y]![x];
    // Tapping a placed piece takes it back.
    if (at != null) return setPlaced((ps) => ps.filter((p) => p.id !== at));
    if (chosen == null) return;
    const next = [...placed, { id: chosen, x, y, r: turn }];
    try {
      puzzleFill(pieces, next);
      setPlaced(next);
      setChosen(null);
    } catch {
      setError(t('Не се побира тук.'));
    }
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ fill: number; share: number }>('/api/game/action', { type: 'loadPuzzle', deliveryId, placements: placed });
      setNote(r.share > 0 ? t('✓ {0}% пълно — +{1}% от плащането при пристигане.', Math.round(r.fill * 100), (r.share * 100).toFixed(1)) : t('✓ {0}% пълно — под 70% няма бонус.', Math.round(r.fill * 100)));
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (note) return <p className="mt-2 text-xs text-profit">{note}</p>;
  if (!open)
    return (
      <button type="button" className="btn-ghost mt-2 px-3 py-1 text-xs" onClick={() => setOpen(true)}>
        {t('📦 Подреди ремаркето (до {0})', new Date(endsAt).toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' }))}
      </button>
    );
  const colors = ['#38bdf8', '#f59e0b', '#a3e635', '#f472b6', '#c084fc', '#fb7185', '#2dd4bf', '#facc15'];
  return (
    <div className="mt-2 rounded-xl border border-asphalt-700 bg-asphalt-900/70 p-3 text-xs">
      <p className="mb-2 text-mist-300">{t('Избери палет, после докосни място в ремаркето. Докосни поставен палет, за да го махнеш.')}</p>
      <div className="grid gap-px rounded-md bg-asphalt-700 p-px" style={{ gridTemplateColumns: `repeat(${PUZZLE.cols}, minmax(0, 1fr))` }} role="grid" aria-label={t('Пода на ремаркето')}>
        {cells.flatMap((row, y) =>
          row.map((id, x) => (
            <button key={`${x}:${y}`} type="button" role="gridcell" aria-label={t('Място {0}, {1}', x + 1, y + 1)} onClick={() => put(x, y)} className="aspect-square min-h-6 bg-asphalt-950" style={id != null ? { background: colors[id % colors.length] } : undefined} />
          )),
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {pieces.filter((p) => !placed.some((x) => x.id === p.id)).map((p) => (
          <button key={p.id} type="button" aria-pressed={chosen === p.id} onClick={() => setChosen(p.id)} className={`rounded border px-2 py-1 ${chosen === p.id ? 'border-volt-500 bg-volt-500/20 text-white' : 'border-asphalt-700 text-mist-300'}`}>
            {turn ? `${p.h}×${p.w}` : `${p.w}×${p.h}`}
          </button>
        ))}
        <button type="button" className="btn-ghost px-2 py-1" aria-pressed={turn} onClick={() => setTurn((v) => !v)}>↻ {t('Завърти')}</button>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="num text-mist-300">{t('Пълно: {0}%', Math.round(fill * 100))}</span>
        <span className="flex items-center gap-2">
          {error && <span role="alert" className="text-loss">{error}</span>}
          <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy || !placed.length} onClick={send}>{busy ? '…' : t('Готово')}</button>
        </span>
      </div>
    </div>
  );
}
