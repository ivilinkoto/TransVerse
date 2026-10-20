'use client';

import { Building2, Hammer, Maximize2, Minus, Move, Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { Meter } from '@/components/ui';
import { api } from '@/lib/client/api';
import { duration, money } from '@/lib/format';
import { BUILDINGS, BUILDING_TYPES, levelSpec, MATERIAL_IDS, MATERIALS, materialCostCents, placementError, type BuildingType, type Materials } from '@/lib/game/plot';
import { PlotScene, toTile, VIEW } from './scene';

export interface PlotData {
  org: { name: string; level: number; treasuryCents: number; liveryColor?: string | null };
  hq: { nameBg: string } | null;
  buildings: { type: BuildingType; x: number; y: number; level: number }[];
  construction: {
    id: string;
    type: BuildingType;
    targetLevel: number;
    status: 'materials' | 'building';
    needs: Materials;
    delivered: Materials;
    onTheWay: Materials;
    missing: Materials;
    orderCostCents: number;
    deliveredCostCents: number;
    complete: boolean;
    startedAt: string | null;
    endsAt: string | null;
    minutes: number;
  } | null;
}

type Mode = { kind: 'view' } | { kind: 'place' | 'move'; type: BuildingType };

/** The company plot: the scene, building on it and the running construction. */
export function PlotView({ data, canBuild, now: initialNow, parkedTrucks, incoming }: { data: PlotData; canBuild: boolean; now: number; parkedTrucks: number; incoming: number }) {
  const router = useRouter();
  const svg = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<BuildingType | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(initialNow);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  // The construction clock ticks every second while something is being built.
  useEffect(() => {
    if (data.construction?.status !== 'building') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data.construction?.status]);

  const c = data.construction;
  const progress = c?.status === 'building' && c.startedAt && c.endsAt ? Math.min(1, Math.max(0, (now - Date.parse(c.startedAt)) / (Date.parse(c.endsAt) - Date.parse(c.startedAt)))) : 0;
  const leftMin = c?.endsAt ? Math.max(0, Math.ceil((Date.parse(c.endsAt) - now) / 60_000)) : 0;
  const office = data.buildings.find((b) => b.type === 'office');
  const placing = mode.kind !== 'view' ? mode.type : null;
  const others = useMemo(() => data.buildings.filter((b) => b.type !== placing), [data.buildings, placing]);
  const ghost = placing && hover ? (() => {
    const def = BUILDINGS[placing];
    const x = Math.round(hover.x - def.w / 2), y = Math.round(hover.y - def.h / 2);
    return { type: placing, x, y, valid: placementError(placing, x, y, others) === null };
  })() : null;

  const vb = { w: VIEW.w / view.zoom, h: VIEW.h / view.zoom };
  const viewBox = `${VIEW.x + (VIEW.w - vb.w) / 2 + view.x} ${VIEW.y + (VIEW.h - vb.h) / 2 + view.y} ${vb.w} ${vb.h}`;

  const toSvg = (e: React.PointerEvent) => {
    const el = svg.current;
    if (!el) return null;
    const pt = el.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const m = el.getScreenCTM();
    return m ? pt.matrixTransform(m.inverse()) : null;
  };
  const onMove = (e: React.PointerEvent) => {
    if (drag.current) {
      const d = drag.current;
      const scale = vb.w / (svg.current?.clientWidth || VIEW.w);
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 4) d.moved = true;
      setView((v) => ({ ...v, x: d.vx - (e.clientX - d.x) * scale, y: d.vy - (e.clientY - d.y) * scale }));
      return;
    }
    const p = toSvg(e);
    if (p) setHover(toTile(p.x, p.y));
  };
  const onDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
  };
  const onUp = async (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) return;
    const p = toSvg(e);
    if (!p) return;
    const t = toTile(p.x, p.y);
    if (ghost && placing) {
      if (!ghost.valid) return setError(placementError(placing, ghost.x, ghost.y, others));
      setBusy(true);
      setError(null);
      try {
        await api('/api/game/action', { type: mode.kind === 'move' ? 'moveBuilding' : 'placeBuilding', building: placing, x: ghost.x, y: ghost.y });
        setMode({ kind: 'view' });
        setSelected(placing);
        router.refresh();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    const hit = data.buildings.find((b) => t.x >= b.x && t.x < b.x + BUILDINGS[b.type].w && t.y >= b.y && t.y < b.y + BUILDINGS[b.type].h);
    setSelected(hit?.type ?? null);
  };
  const zoom = (f: number) => setView((v) => ({ ...v, zoom: Math.min(2.5, Math.max(0.7, v.zoom * f)) }));

  const sel = selected ? data.buildings.find((b) => b.type === selected) : null;
  const notPlaced = BUILDING_TYPES.filter((t) => !data.buildings.some((b) => b.type === t));

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative min-w-0 overflow-hidden rounded-2xl border border-asphalt-700 bg-[#9fd48c]">
        <svg
          ref={svg}
          viewBox={viewBox}
          className={`block aspect-[1060/720] w-full touch-none select-none ${placing ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={() => { drag.current = null; setHover(null); }}
          role="img"
          aria-label={`Участъкът на „${data.org.name}“`}
        >
          <PlotScene buildings={data.buildings} construction={c ? { type: c.type, status: c.status, progress, delivered: c.delivered } : null} ghost={ghost} selected={selected} parkedTrucks={parkedTrucks} incoming={incoming} grid={!!placing} liveryColor={data.org.liveryColor ?? null} />
        </svg>
        <div className="pointer-events-none absolute left-3 top-3 rounded-xl border border-asphalt-700/60 bg-asphalt-950/80 px-3 py-2 text-xs text-mist-300 backdrop-blur">
          <b className="block text-sm text-white">Участък · {data.hq?.nameBg ?? ''}</b>
          {(() => { const n = data.buildings.filter((b) => b.level > 0).length; return `${n} ${n === 1 ? 'сграда' : 'сгради'}`; })()}{c ? ` · строи се: ${BUILDINGS[c.type].label}` : ''}
        </div>
        <div className="absolute right-3 top-3 flex flex-col gap-1.5">
          <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-asphalt-700/60 bg-asphalt-950/80 text-mist-100" onClick={() => zoom(1.25)} aria-label="Приближи"><Plus className="h-4 w-4" /></button>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-asphalt-700/60 bg-asphalt-950/80 text-mist-100" onClick={() => zoom(0.8)} aria-label="Отдалечи"><Minus className="h-4 w-4" /></button>
          <button type="button" className="grid h-9 w-9 place-items-center rounded-xl border border-asphalt-700/60 bg-asphalt-950/80 text-mist-100" onClick={() => setView({ x: 0, y: 0, zoom: 1 })} aria-label="Целият участък"><Maximize2 className="h-4 w-4" /></button>
        </div>
        {placing && (
          <div className="absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-glow/40 bg-asphalt-950/85 px-3 py-2 text-sm backdrop-blur">
            <span>{mode.kind === 'move' ? 'Премести' : 'Постави'} <b>{BUILDINGS[placing].label}</b> — натисни свободно място на участъка ({BUILDINGS[placing].w}×{BUILDINGS[placing].h}).{busy ? ' …' : ''}</span>
            <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setMode({ kind: 'view' }); setError(null); }}><X className="h-3.5 w-3.5" />Отказ</button>
          </div>
        )}
        {error && <p role="alert" className="absolute inset-x-3 top-16 rounded-xl bg-loss/90 px-3 py-2 text-sm text-white">{error}</p>}
      </div>

      <div className="min-w-0 space-y-4">
        {c && <ConstructionCard c={c} canBuild={canBuild} progress={progress} leftMin={leftMin} />}
        {sel && (
          <div className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display text-lg font-bold">{BUILDINGS[sel.type].label}{sel.level > 0 ? ` · ниво ${sel.level}` : ''}</h3>
                <p className="text-sm text-mist-300">{sel.level > 0 ? BUILDINGS[sel.type].effect(sel.level) : 'Строи се.'}</p>
              </div>
              <button type="button" className="text-mist-400 hover:text-white" onClick={() => setSelected(null)} aria-label="Затвори"><X className="h-4 w-4" /></button>
            </div>
            {sel.level > 0 && sel.level < BUILDINGS[sel.type].maxLevel && (() => {
              const spec = levelSpec(sel.type, sel.level + 1);
              const locked = data.org.level < spec.minCompanyLevel;
              return (
                <div className="mt-3 rounded-xl border border-asphalt-700 p-3 text-sm">
                  <div className="font-semibold">Ниво {sel.level + 1}: {BUILDINGS[sel.type].effect(sel.level + 1)}</div>
                  <div className="mt-1 text-xs text-mist-400">{materialsText(spec.materials)} · ~{money(materialCostCents(spec.materials))} · строеж {duration(spec.minutes)}{locked ? ` · нужно ниво ${spec.minCompanyLevel} на компанията` : ''}</div>
                  {canBuild && <ActionButton action={{ type: 'upgradeBuilding', building: sel.type }} className="btn-primary mt-2 w-full justify-center text-sm" disabled={locked || !!c}>{c ? 'Компанията вече строи' : `Вдигни на ниво ${sel.level + 1}`}</ActionButton>}
                </div>
              );
            })()}
            {sel.level >= BUILDINGS[sel.type].maxLevel && <p className="mt-2 text-xs text-profit">Най-високото ниво.</p>}
            {canBuild && !(c?.type === sel.type && c.status === 'building') && (
              <button type="button" className="btn-ghost mt-2 w-full justify-center text-sm" onClick={() => { setMode({ kind: 'move', type: sel.type }); setError(null); }}><Move className="h-4 w-4" />Премести</button>
            )}
          </div>
        )}
        <div className="panel p-4">
          <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Building2 className="h-5 w-5 text-cyan-glow" />Строй</h3>
          {!canBuild && <p className="mt-1 text-sm text-mist-400">Строят собственикът и длъжностите с право „Строителство“. Ти помагаш, като караш материалите от борсата.</p>}
          {notPlaced.length === 0 ? (
            <p className="mt-2 text-sm text-mist-400">Всички сгради са на участъка — вдигай нивата им.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {notPlaced.map((t) => {
                const def = BUILDINGS[t];
                const spec = levelSpec(t, 1);
                const reason = !office?.level && t !== 'office' ? 'първо офисът' : data.org.level < spec.minCompanyLevel ? `ниво ${spec.minCompanyLevel} на компанията` : c ? 'след текущия строеж' : null;
                return (
                  <li key={t} className={`rounded-xl border border-asphalt-700 p-3 text-sm ${reason ? 'opacity-60' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{def.label} <span className="text-xs font-normal text-mist-400">{def.w}×{def.h}</span></span>
                      {canBuild && <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={!!reason} onClick={() => { setMode({ kind: 'place', type: t }); setSelected(null); setError(null); }}><Hammer className="h-3.5 w-3.5" />Постави</button>}
                    </div>
                    <div className="mt-1 text-xs text-mist-300">{def.effect(1)}</div>
                    <div className="mt-0.5 text-xs text-mist-400">{materialsText(spec.materials)} · ~{money(materialCostCents(spec.materials))} · {duration(spec.minutes)}{reason ? ` · ${reason}` : ''}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

const materialsText = (m: Materials) => MATERIAL_IDS.filter((id) => m[id]).map((id) => `${m[id]} т ${MATERIALS[id].label.toLowerCase()}`).join(', ');

function ConstructionCard({ c, canBuild, progress, leftMin }: { c: NonNullable<PlotData['construction']>; canBuild: boolean; progress: number; leftMin: number }) {
  const def = BUILDINGS[c.type];
  const anyMissing = Object.keys(c.missing).length > 0;
  return (
    <div className="panel border-gold-400/40 p-4">
      <h3 className="font-display text-lg font-bold">{def.label}{c.targetLevel > 1 ? ` · ниво ${c.targetLevel}` : ''}</h3>
      <p className="text-sm text-mist-300">{def.effect(c.targetLevel)}</p>
      {c.status === 'building' ? (
        <div className="mt-3 flex items-center gap-3">
          <div className="grid h-16 w-16 place-items-center rounded-full" style={{ background: `conic-gradient(#f6c343 0 ${Math.round(progress * 100)}%, #1a2433 0)` }}>
            <span className="num grid h-12 w-12 place-items-center rounded-full bg-asphalt-850 text-sm font-bold">{Math.round(progress * 100)}%</span>
          </div>
          <div>
            <div className="font-semibold">Строи се</div>
            <div className="text-sm text-mist-400">{leftMin > 0 ? `готово след ${duration(leftMin)}` : 'завършва…'}</div>
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 space-y-2.5">
            {MATERIAL_IDS.filter((id) => c.needs[id]).map((id) => {
              const need = c.needs[id] ?? 0, got = c.delivered[id] ?? 0, way = c.onTheWay[id] ?? 0;
              return (
                <div key={id}>
                  <div className="flex justify-between text-sm">
                    <span>{MATERIALS[id].label}</span>
                    <span className={got >= need ? 'text-profit' : ''}>{got} / {need} т{got >= need ? ' ✓' : way > 0 ? ` · ${way} т на път` : ''}</span>
                  </div>
                  <Meter value={(got / need) * 100} tone="cyan" className="mt-1" />
                </div>
              );
            })}
          </div>
          {c.complete ? (
            canBuild ? <ActionButton action={{ type: 'startConstruction', buildId: c.id }} className="btn-gold mt-4 w-full justify-center">Започни строежа · {duration(c.minutes)}</ActionButton> : <p className="mt-3 text-sm text-profit">Материалите са доставени — строежът започва скоро.</p>
          ) : canBuild ? (
            <div className="mt-4 space-y-2">
              {anyMissing && <ActionButton action={{ type: 'orderMaterials', buildId: c.id }} className="btn-primary w-full justify-center" confirm={`Да купим материалите от касата за ${money(c.orderCostCents)}? Членовете ще ги карат от борсата.`}>Поръчай материалите · {money(c.orderCostCents)}</ActionButton>}
              {anyMissing && <ActionButton action={{ type: 'buyMaterialsDelivered', buildId: c.id }} className="btn-ghost w-full justify-center" confirm={`Да купим липсващото с доставка за ${money(c.deliveredCostCents)} (50 % по-скъпо)?`}>Поръчай с доставка · {money(c.deliveredCostCents)}</ActionButton>}
              {!anyMissing && <p className="text-sm text-mist-300">Всичко липсващо пътува към участъка — карай товарите от борсата.</p>}
              <a href="/game/contracts" className="block text-center text-xs text-cyan-glow hover:underline">Товарите за строежа на борсата →</a>
              {Object.keys(c.delivered).length === 0 && Object.keys(c.onTheWay).length === 0 && <ActionButton action={{ type: 'cancelBuild', buildId: c.id }} className="btn-ghost w-full justify-center text-xs text-loss" confirm="Да откажем ли строежа?">Откажи строежа</ActionButton>}
            </div>
          ) : (
            <a href="/game/contracts" className="btn-primary mt-4 w-full justify-center">Карай материали от борсата</a>
          )}
        </>
      )}
    </div>
  );
}
