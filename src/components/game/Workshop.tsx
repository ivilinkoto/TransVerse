'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { api } from '@/lib/client/api';
import { CRAFT_SAME, ITEMS, RARITIES, craftUp, matchRecipe, type ItemId } from '@/lib/game/items';
import { burst } from '@/components/fx/fx';
import { playReveal } from '@/lib/client/motion';
import { ItemArt } from './ItemArt';
import { t, tx } from '@/i18n/t';

const SLOTS = 4;

/**
 * 1.2.1 „Работилница“: put 2–4 items on the bench. Three of a kind make one of
 * the next rarity; other mixes work only if they are a recipe (found by trying).
 */
export function Workshop({ items, start }: { items: { itemId: ItemId; qty: number }[]; start: ItemId | null }) {
  const router = useRouter();
  const [bench, setBench] = useState<ItemId[]>(() => (start && (items.find((i) => i.itemId === start)?.qty ?? 0) >= CRAFT_SAME ? Array(CRAFT_SAME).fill(start) : []));
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<{ item: ItemId; discovered: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const left = (id: ItemId) => (items.find((i) => i.itemId === id)?.qty ?? 0) - bench.filter((x) => x === id).length;
  const usable = items.filter((i) => ITEMS[i.itemId].kind !== 'coins');
  // What the bench would make, when the client can tell (a recipe stays a surprise until it is made).
  const preview = useMemo(() => {
    if (bench.length === CRAFT_SAME && bench.every((x) => x === bench[0])) {
      const up = craftUp(bench[0]!);
      if (!up) return { ok: false, text: t('{0} не може да стане по-рядък.', tx(ITEMS[bench[0]!].name)) };
      return { ok: true, text: up.kind === 'case' ? t('Ще получиш: {0}', tx(ITEMS[up.item].name)) : t('Ще получиш случаен предмет: {0}', tx(RARITIES[up.rarity].label)) };
    }
    if (bench.length >= 2) return matchRecipe(bench) ? { ok: true, text: t('Нещо се получава…') } : { ok: true, text: t('Опитай — може да е рецепта.') };
    return null;
  }, [bench]);

  const craft = async (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    setBusy(true);
    setError(null);
    setMade(null);
    try {
      const r = await api<{ item: ItemId; discovered: boolean }>('/api/game/action', { type: 'craftItems', items: bench });
      setMade(r);
      setBench([]);
      playReveal(Math.min(4, ['common', 'uncommon', 'rare', 'epic', 'legendary'].indexOf(ITEMS[r.item].rarity)));
      burst(el, { colors: [RARITIES[ITEMS[r.item].rarity].color, '#fde68a'], count: 24 });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="panel space-y-3 p-4">
        <p className="label">{t('Твоите предмети — натисни, за да сложиш на тезгяха')}</p>
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-6 xl:grid-cols-8">
          {usable.map((i) => (
            <li key={i.itemId}>
              <button type="button" disabled={left(i.itemId) < 1 || bench.length >= SLOTS} onClick={() => { setMade(null); setBench((b) => [...b, i.itemId]); }} className="relative flex w-full flex-col items-center gap-0.5 rounded-xl border-2 bg-asphalt-850 p-1.5 text-center transition hover:-translate-y-0.5 disabled:opacity-35" style={{ borderColor: RARITIES[ITEMS[i.itemId].rarity].color }} title={tx(ITEMS[i.itemId].name)}>
                <ItemArt id={i.itemId} className="h-10 w-10" />
                <span className="num absolute right-1 top-1 rounded-full bg-asphalt-950/90 px-1 text-[10px] font-bold">×{left(i.itemId)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="panel space-y-3 border-gold-400/30 bg-gradient-to-br from-violet-700/20 to-transparent p-4">
        <p className="font-display font-bold">{t('Тезгях')}</p>
        <div className="grid grid-cols-4 gap-2">
          {Array.from({ length: SLOTS }, (_, i) => bench[i]).map((id, i) => (
            <button key={i} type="button" disabled={!id} onClick={() => setBench((b) => b.filter((_, j) => j !== i))} className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-asphalt-600 bg-asphalt-900/70" aria-label={id ? t('Махни {0}', tx(ITEMS[id].name)) : t('Празно място')}>
              {id && <ItemArt id={id} className="h-12 w-12" />}
            </button>
          ))}
        </div>
        {preview && <p className={`text-xs ${preview.ok ? 'text-mist-300' : 'text-loss'}`}>{preview.text}</p>}
        <button type="button" className="btn-primary w-full" disabled={busy || bench.length < 2 || preview?.ok === false} onClick={craft}>{busy ? '…' : t('Комбинирай')}</button>
        {bench.length > 0 && <button type="button" className="btn-ghost w-full py-1 text-xs" onClick={() => setBench([])}>{t('Изчисти тезгяха')}</button>}
        {made && (
          <div role="status" className="fx-pop flex items-center gap-3 rounded-xl border-2 bg-asphalt-900 p-3" style={{ borderColor: RARITIES[ITEMS[made.item].rarity].color }}>
            <ItemArt id={made.item} className="h-14 w-14" />
            <div className="text-sm">
              <p className="font-bold">{tx(ITEMS[made.item].name)}</p>
              <p className="text-xs" style={{ color: RARITIES[ITEMS[made.item].rarity].color }}>{tx(RARITIES[ITEMS[made.item].rarity].label)}</p>
              {made.discovered && <p className="text-xs font-semibold text-gold-300">{t('📓 Нова рецепта в тетрадката!')}</p>}
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-loss">{error}</p>}
        <p className="text-xs text-mist-400">{t('Три еднакви → един по-рядък (бронзов → сребърен → златен кейс). Другите смеси работят само ако са рецепта.')}</p>
      </div>
    </div>
  );
}
