'use client';

import { ArrowRight, Building2, Flower2, Hammer, LandPlot, Maximize2, Minus, Move, Plus, Sparkles, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionButton } from '@/components/ui/ActionButton';
import { Meter } from '@/components/ui';
import { api } from '@/lib/client/api';
import { duration, money } from '@/lib/format';
import { BOOM, BUILDING_LINKS, BUILDINGS, BUILDING_TYPES, DECOR, DECOR_KINDS, decorError, EXPANSIONS, levelSpec, MATERIAL_IDS, MATERIALS, MAX_DECOR, materialCostCents, placementError, PLOT, plotWidth, type BuildingType, type DecorKind, type Materials } from '@/lib/game/plot';
import { PlotScene, toTile, viewFor } from './scene';

export interface PlotData {
  org: { name: string; level: number; treasuryCents: number; liveryColor?: string | null };
  hq: { nameBg: string } | null;
  buildings: { type: BuildingType; x: number; y: number; level: number }[];
  decor: { id: string; kind: DecorKind; x: number; y: number }[];
  expansions: number;
  plotW: number;
  /** "Строителен бум" is on: materials cost less. */
  boom: boolean;
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

type Mode = { kind: 'view' } | { kind: 'place' | 'move'; type: BuildingType } | { kind: 'decor'; decor: DecorKind };

export interface PlotFeatures {
  decor: boolean;
  expand: boolean;
  /** The factory (v1.4). */
  factory?: boolean;
}

/** The company plot: the scene, building on it and the running construction. */
export function PlotView({ data, canBuild, now: initialNow, parkedTrucks, incoming, season = null, ambience = { night: false, weather: null, visitors: [] }, features = { decor: false, expand: false }, coins = 0, children }: { data: PlotData; canBuild: boolean; now: number; parkedTrucks: number; incoming: number; season?: 'winter' | 'christmas' | null; ambience?: { night: boolean; weather: 'rain' | 'leaves' | null; visitors: string[] }; features?: PlotFeatures; coins?: number; children?: React.ReactNode }) {
  const router = useRouter();
  const svg = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [selected, setSelected] = useState<BuildingType | null>(null);
  const [selectedDecor, setSelectedDecor] = useState<string | null>(null);
  /** Where the building menu opens (pixels in the scene box). */
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
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
  const placing = mode.kind === 'place' || mode.kind === 'move' ? mode.type : null;
  const placingDecor = mode.kind === 'decor' ? mode.decor : null;
  const others = useMemo(() => data.buildings.filter((b) => b.type !== placing), [data.buildings, placing]);
  const W = data.plotW;
  const whyNot = (x: number, y: number) => (placing ? placementError(placing, x, y, others, { plotW: W, decor: data.decor }) : placingDecor ? decorError(placingDecor, x, y, data.buildings, data.decor, W) : null);
  /** The spot (top-left tile) of the thing being placed when the pointer is over tile t. */
  const spotAt = (t: { x: number; y: number }) => {
    const def = placing ? BUILDINGS[placing] : DECOR[placingDecor!];
    return { x: Math.round(t.x - def.w / 2), y: Math.round(t.y - def.h / 2) };
  };
  const ghost = (placing || placingDecor) && hover ? (() => {
    const { x, y } = spotAt(hover);
    return { type: placing ?? undefined, decor: placingDecor ?? undefined, x, y, valid: whyNot(x, y) === null };
  })() : null;
  // On a touch screen a tap shows where it goes; "Постави тук" confirms.
  const [touch, setTouch] = useState(false);
  // Placing starts from the panel (below the scene on a phone): bring the plot into view.
  useEffect(() => {
    if (mode.kind === 'view') return;
    const r = box.current?.getBoundingClientRect();
    if (r && (r.top < 0 || r.bottom > window.innerHeight)) box.current!.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [mode.kind]);

  const VIEW = viewFor(W);
  const vb = { w: VIEW.w / view.zoom, h: VIEW.h / view.zoom };
  // Labels keep about the same size on the screen: bigger in the drawing on a phone, smaller when zoomed in.
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 1000));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const labelScale = Math.min(2.6, Math.max(0.75, (vb.w / width) * 0.85));
  // Traffic drives unless the player asked the device for less motion.
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setMoving(!q.matches);
    on();
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
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
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > (e.pointerType === 'mouse' ? 4 : 12)) {
        d.moved = true;
        setMenuAt(null);
      }
      setView((v) => ({ ...v, x: d.vx - (e.clientX - d.x) * scale, y: d.vy - (e.clientY - d.y) * scale }));
      return;
    }
    const p = toSvg(e);
    if (p) setHover(toTile(p.x, p.y));
  };
  const place = async (x: number, y: number) => {
    setBusy(true);
    setError(null);
    try {
      if (placingDecor) await api('/api/game/action', { type: 'placeDecor', kind: placingDecor, x, y });
      else await api('/api/game/action', { type: mode.kind === 'move' ? 'moveBuilding' : 'placeBuilding', building: placing, x, y });
      // Decorations: keep placing until cancelled.
      if (!placingDecor) {
        setMode({ kind: 'view' });
        setSelected(placing);
        setHover(null);
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
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
    if (placing || placingDecor) {
      // The spot is where the pointer went up (a tap on a phone has no hover before it).
      const spot = spotAt(t);
      setHover(t);
      const why = whyNot(spot.x, spot.y);
      if (e.pointerType !== 'mouse') {
        setTouch(true);
        setError(why);
        return;
      }
      if (why) return setError(why);
      await place(spot.x, spot.y);
      return;
    }
    // The drawing under the pointer first (a tall building covers the tiles behind it), then the tile.
    const drawn = (e.target as Element).closest?.('[data-building]')?.getAttribute('data-building') as BuildingType | null | undefined;
    const hit = data.buildings.find((b) => b.type === drawn) ?? data.buildings.find((b) => t.x >= b.x && t.x < b.x + BUILDINGS[b.type].w && t.y >= b.y && t.y < b.y + BUILDINGS[b.type].h);
    const hitDecor = hit ? null : data.decor.find((d) => t.x >= d.x && t.x < d.x + DECOR[d.kind].w && t.y >= d.y && t.y < d.y + DECOR[d.kind].h);
    setSelected(hit?.type ?? null);
    setSelectedDecor(hitDecor?.id ?? null);
    const r = box.current?.getBoundingClientRect();
    setMenuAt(hit && r ? { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height } : null);
  };
  const zoom = (f: number) => {
    setMenuAt(null);
    setView((v) => ({ ...v, zoom: Math.min(2.5, Math.max(0.7, v.zoom * f)) }));
  };

  const sel = selected ? data.buildings.find((b) => b.type === selected) : null;
  // The factory comes with v1.4 (staff see it earlier).
  const notPlaced = BUILDING_TYPES.filter((t) => !data.buildings.some((b) => b.type === t) && (t !== 'factory' || !!features.factory));
  const decorSel = selectedDecor ? data.decor.find((d) => d.id === selectedDecor) : null;
  const nextLand = EXPANSIONS[data.expansions];
  const cost = (m: Materials) => materialCostCents(m, false, data.boom);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div ref={box} className="relative min-w-0 self-start overflow-hidden xl:sticky xl:top-20 rounded-2xl border border-asphalt-700 bg-[#9fd48c]">
        <svg
          ref={svg}
          viewBox={viewBox}
          className={`block aspect-[1080/780] w-full touch-none select-none ${placing || placingDecor ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
          onPointerMove={onMove}
          onPointerDown={onDown}
          onPointerUp={onUp}
          onPointerLeave={(e) => { drag.current = null; if (e.pointerType === 'mouse') setHover(null); }}
          role="img"
          aria-label={`Участъкът на „${data.org.name}“`}
        >
          <PlotScene buildings={data.buildings} construction={c ? { type: c.type, status: c.status, progress, delivered: c.delivered } : null} ghost={ghost} selected={selected} parkedTrucks={parkedTrucks} incoming={incoming} grid={!!(placing || placingDecor)} liveryColor={data.org.liveryColor ?? null} plotW={W} decor={data.decor} season={season} selectedDecor={selectedDecor} labelScale={labelScale} moving={moving} night={ambience.night} weather={ambience.weather} visitors={ambience.visitors} />
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
        {(placing || placingDecor) && (
          <div className="relative m-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-cyan-glow/40 bg-asphalt-950/90 px-3 py-2 text-sm backdrop-blur sm:absolute sm:inset-x-3 sm:bottom-3 sm:m-0 sm:bg-asphalt-950/85">
            {placing ? (
              <span>{mode.kind === 'move' ? 'Премести' : 'Постави'} <b>{BUILDINGS[placing].label}</b> — {touch ? 'докосни свободно място, после „Постави тук“' : 'натисни свободно място на участъка'} ({BUILDINGS[placing].w}×{BUILDINGS[placing].h}).{busy ? ' …' : ''}</span>
            ) : (
              <span>Постави <b>{DECOR[placingDecor!].label}</b> ({priceText(placingDecor!)}) — натисни свободно място; можеш да сложиш няколко.{busy ? ' …' : ''}</span>
            )}
            <span className="flex gap-2">
              {touch && ghost && <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={!ghost.valid || busy} onClick={() => place(ghost.x, ghost.y)}><Hammer className="h-3.5 w-3.5" />Постави тук</button>}
              <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => { setMode({ kind: 'view' }); setError(null); setHover(null); }}><X className="h-3.5 w-3.5" />Отказ</button>
            </span>
          </div>
        )}
        {sel && menuAt && !placing && !placingDecor && (
          <BuildingMenu
            building={sel}
            at={menuAt}
            upgrading={!!c && c.type === sel.type}
            canMove={canBuild && !(c?.type === sel.type && c.status === 'building')}
            onMove={() => { setMode({ kind: 'move', type: sel.type }); setMenuAt(null); setError(null); }}
            onClose={() => { setMenuAt(null); setSelected(null); }}
          />
        )}
        {error && <p role="alert" className="absolute inset-x-3 top-16 rounded-xl bg-loss/90 px-3 py-2 text-sm text-white">{error}</p>}
      </div>

      <div className="min-w-0 space-y-4">
        {data.boom && (
          <div className="panel flex items-start gap-3 border-gold-400/50 bg-gold-400/10 p-4 text-sm">
            <Sparkles className="mt-0.5 h-5 w-5 shrink-0 text-gold-400" />
            <div><b className="text-gold-300">Строителен бум!</b> Материалите са с {Math.round((1 - BOOM.priceFactor) * 100)} % по-евтини, а курсовете с материали дават {Math.round((BOOM.xpFactor - 1) * 100)} % повече опит.</div>
          </div>
        )}
        {c && <ConstructionCard c={c} canBuild={canBuild} progress={progress} leftMin={leftMin} />}
        {decorSel && (
          <div className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-display text-lg font-bold">{DECOR[decorSel.kind].label}</h3>
              <button type="button" className="text-mist-400 hover:text-white" onClick={() => setSelectedDecor(null)} aria-label="Затвори"><X className="h-4 w-4" /></button>
            </div>
            {canBuild && <ActionButton action={{ type: 'removeDecor', decorId: decorSel.id }} className="btn-ghost mt-2 w-full justify-center text-sm text-loss" confirm="Да махнем ли украсата? Парите не се връщат." onDone={() => setSelectedDecor(null)}><Trash2 className="h-4 w-4" />Махни</ActionButton>}
          </div>
        )}
        {sel && (
          <div id="plot-building" className="panel scroll-mt-24 p-4">
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
                  <div className="mt-1 text-xs text-mist-400">{materialsText(spec.materials)} · ~{money(cost(spec.materials))} · строеж {duration(spec.minutes)}{locked ? ` · нужно ниво ${spec.minCompanyLevel} на компанията` : ''}</div>
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
                    <div className="mt-0.5 text-xs text-mist-400">{materialsText(spec.materials)} · ~{money(cost(spec.materials))} · {duration(spec.minutes)}{reason ? ` · ${reason}` : ''}</div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {features.decor && (
          <div className="panel p-4">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><Flower2 className="h-5 w-5 text-cyan-glow" />Украса <span className="text-xs font-normal text-mist-400">{data.decor.length} / {MAX_DECOR}</span></h3>
            {!canBuild && <p className="mt-1 text-sm text-mist-400">Украсяват длъжностите с право „Строителство“.</p>}
            <div className="mt-2 grid grid-cols-2 gap-2">
              {DECOR_KINDS.map((kind) => {
                const d = DECOR[kind];
                const poor = d.coins ? coins < d.coins : (d.priceCents ?? 0) > data.org.treasuryCents;
                return (
                  <button key={kind} type="button" className={`rounded-xl border p-2 text-left text-xs transition ${placingDecor === kind ? 'border-cyan-glow bg-cyan-glow/10' : 'border-asphalt-700 hover:border-asphalt-500'}`} disabled={!canBuild || poor || data.decor.length >= MAX_DECOR} onClick={() => { setMode({ kind: 'decor', decor: kind }); setSelected(null); setSelectedDecor(null); setError(null); }}>
                    <b className="block text-sm text-mist-100">{d.label}</b>
                    <span className={poor ? 'text-loss' : 'text-mist-400'}>{priceText(kind)} · {d.w}×{d.h}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-mist-400">Лв. се плащат от касата, ТрансКоин — от твоя портфейл. Украсата е само за красота.</p>
          </div>
        )}
        {features.expand && (
          <div className="panel p-4 text-sm">
            <h3 className="flex items-center gap-2 font-display text-lg font-bold"><LandPlot className="h-5 w-5 text-cyan-glow" />Земя</h3>
            <p className="mt-1 text-mist-300">Участъкът е {W} на {PLOT.h} квадрата.</p>
            {nextLand ? (
              <>
                <p className="mt-1 text-xs text-mist-400">Следващата земя: +{plotWidth(data.expansions + 1) - W} квадрата широчина · {money(nextLand.costCents)} от касата · нужно ниво {nextLand.minCompanyLevel} на компанията.</p>
                {canBuild && <ActionButton action={{ type: 'expandPlot' }} className="btn-primary mt-2 w-full justify-center text-sm" disabled={data.org.level < nextLand.minCompanyLevel || data.org.treasuryCents < nextLand.costCents} confirm={`Да купим земя за ${money(nextLand.costCents)} от касата?`}>Купи земя · {money(nextLand.costCents)}</ActionButton>}
              </>
            ) : (
              <p className="mt-1 text-xs text-profit">Участъкът е с най-големия възможен размер.</p>
            )}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

/** The menu of a building clicked on the plot: where it leads in the game, its level and moving it. */
function BuildingMenu({ building, at, upgrading, canMove, onMove, onClose }: { building: { type: BuildingType; level: number }; at: { x: number; y: number; w: number; h: number }; upgrading: boolean; canMove: boolean; onMove: () => void; onClose: () => void }) {
  const def = BUILDINGS[building.type];
  const link = BUILDING_LINKS[building.type];
  const W = 248;
  // On a small scene (a phone) the menu is a compact bar along the bottom.
  const compact = at.w < 520;
  const left = Math.max(8, Math.min(at.x - W / 2, at.w - W - 8));
  const below = at.y < at.h / 2;
  const place = compact ? { left: 8, right: 8, bottom: 8 } : { left, width: W, ...(below ? { top: at.y + 12 } : { bottom: Math.max(8, at.h - at.y + 12) }) };
  return (
    <div role="dialog" aria-label={def.label} className={`absolute z-10 rounded-xl border border-cyan-glow/40 bg-asphalt-950/95 text-sm shadow-xl backdrop-blur ${compact ? 'p-2.5' : 'p-3'}`} style={place} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <b className="block text-white">{def.label}</b>
          <span className="text-xs text-gold-300">{building.level > 0 ? `Ниво ${building.level} от ${def.maxLevel}` : 'Строи се'}{upgrading && building.level > 0 ? ' · вдига се' : ''}</span>
        </div>
        <button type="button" className="text-mist-400 hover:text-white" onClick={onClose} aria-label="Затвори"><X className="h-4 w-4" /></button>
      </div>
      {building.level > 0 && !compact && <p className="mt-1 text-xs text-mist-300">{def.effect(building.level)}</p>}
      <div className={`mt-2 flex gap-1.5 ${compact ? 'flex-row flex-wrap [&>*]:flex-1' : 'flex-col'}`}>
        {building.level > 0 && <Link href={link.href} className="btn-primary justify-center py-1.5 text-sm">{link.label}<ArrowRight className="h-4 w-4" /></Link>}
        <a href="#plot-building" className="btn-ghost justify-center whitespace-nowrap py-1.5 text-xs" onClick={() => document.getElementById('plot-building')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Нива и подобрения</a>
        {canMove && <button type="button" className="btn-ghost justify-center py-1.5 text-xs" onClick={onMove}><Move className="h-3.5 w-3.5" />Премести</button>}
      </div>
    </div>
  );
}

const priceText = (kind: DecorKind) => (DECOR[kind].coins ? `${DECOR[kind].coins} ТрансКоин` : money(DECOR[kind].priceCents ?? 0));

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
