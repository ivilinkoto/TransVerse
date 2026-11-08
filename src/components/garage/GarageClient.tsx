'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { UPGRADES, type UpgradeId } from '@/lib/game/catalog';
import { COSMETIC_PARTS, type Cosmetics } from '@/lib/game/cosmetics';
import { GARAGE, TUNING_IDS, TUNING_PARTS, ownedKey, truckStats, type Tuning, type TuningPart } from '@/lib/game/garage';
import { STANDARD_COLORS } from '@/lib/game/vip';
import { int, money } from '@/lib/format';
import type { GarageView } from '@/server/game/showroom';
import type { GarageMode, GarageScenery } from './GarageScene';
import { t, tx } from '@/i18n/t';

// three.js loads only on this page.
const GarageScene = dynamic(() => import('./GarageScene').then((m) => m.GarageScene), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-mist-400">{t('Зареждане на 3D…')}</div>,
});

type Tab = 'tuning' | 'upgrades' | 'paint' | 'service' | 'sets' | 'history';
const TABS: { id: Tab; label: string }[] = [
  { id: 'tuning', label: '🔧 Тунинг' },
  { id: 'upgrades', label: '⚙️ Подобрения' },
  { id: 'paint', label: '🎨 Боя и части' },
  { id: 'service', label: '🛠️ Сервиз' },
  { id: 'sets', label: '💾 Сглобки' },
  { id: 'history', label: '📜 История' },
];
const SCENES: { id: GarageScenery; label: string }[] = [
  { id: 'hall', label: '🏁 Хале' },
  { id: 'snow', label: '❄️ Сняг' },
  { id: 'sunset', label: '🌅 Залез' },
  { id: 'highway', label: '🛣️ Магистрала' },
];
const STAT_LABELS: [keyof ReturnType<typeof truckStats>, string][] = [
  ['economy', 'Икономичност'],
  ['durability', 'Издръжливост'],
  ['comfort', 'Комфорт (опит)'],
  ['winter', 'Зимно сцепление'],
];

export function GarageClient({ view, initialTruck, isVip }: { view: GarageView; initialTruck?: string | null; isVip?: boolean }) {
  const router = useRouter();
  const start = Math.max(0, view.trucks.findIndex((v) => v.id === initialTruck));
  const [index, setIndex] = useState(start);
  const [tab, setTab] = useState<Tab>('tuning');
  const [mode, setMode] = useState<GarageMode>('orbit');
  const [scenery, setScenery] = useState<GarageScenery>('hall');
  const [spin, setSpin] = useState(true);
  const [preview, setPreview] = useState<{ tuning?: Tuning; color?: string; cosmetics?: Cosmetics } | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visitorNote, setVisitorNote] = useState('');
  const [presetName, setPresetName] = useState('');
  const [hoverUpgrade, setHoverUpgrade] = useState<string | null>(null);
  const capture = useRef<(() => string | null) | null>(null);
  const truck = view.trucks[index];

  const run = async (body: Record<string, unknown>, done: string) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await api('/api/game/action', body);
      setNote(done);
      setPreview(null);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const others = useMemo(
    () => view.trucks.filter((_, i) => i !== index).slice(0, view.hall.platforms - 1).map((o) => ({ modelId: o.modelId, color: o.color, cosmetics: o.cosmetics, condition: o.condition, trailerModelId: o.trailerModelId, trailerColor: o.trailerColor })),
    [view.trucks, index, view.hall.platforms],
  );

  if (!truck) {
    return <p className="text-sm text-mist-400">{view.mine ? t('Гаражът е празен — купи камион от Пазара.') : t('Гаражът е празен.')}</p>;
  }
  const own = view.mine && truck.ownership === 'owned';
  const tuningNow: Tuning = truck.cosmetics.tuning ?? {};
  const owned = new Set(truck.cosmetics.owned ?? []);
  const shownTuning = preview?.tuning ?? tuningNow;
  const shownCosmetics: Cosmetics = { ...truck.cosmetics, ...(preview?.cosmetics ?? {}), tuning: shownTuning };
  const shownColor = preview?.color ?? truck.color;
  const stats = truck.stats;
  const after = hoverUpgrade ? truckStats([...truck.upgrades, hoverUpgrade], UPGRADES) : null;
  const chip = (on: boolean) => `rounded-full border px-2.5 py-1 text-xs ${on ? 'border-cyan-glow bg-cyan-glow/15 text-white' : 'border-asphalt-700 text-mist-300 hover:text-white'}`;
  const idle = truck.status === 'idle';

  const takePhoto = () => {
    const url = capture.current?.();
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${truck.plate.replace(/\s+/g, '-')}.png`;
    a.click();
  };

  return (
    <div className="space-y-4" data-testid="garage">
      {/* The truck picker. */}
      {view.trucks.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <button type="button" className="btn-ghost px-2 py-1 text-sm" aria-label={t('Предишен')} onClick={() => { setIndex((index - 1 + view.trucks.length) % view.trucks.length); setPreview(null); }}>◀</button>
          {view.trucks.map((v, i) => (
            <button key={v.id} type="button" onClick={() => { setIndex(i); setPreview(null); }} className={chip(i === index)} data-testid="garage-pick">
              {v.nickname ? `„${v.nickname}“` : v.plate}
            </button>
          ))}
          <button type="button" className="btn-ghost px-2 py-1 text-sm" aria-label={t('Следващ')} onClick={() => { setIndex((index + 1) % view.trucks.length); setPreview(null); }}>▶</button>
        </div>
      )}

      <div className="relative h-[360px] overflow-hidden rounded-2xl border border-asphalt-700 sm:h-[520px]">
        <GarageScene
          truck={{ modelId: truck.modelId, color: shownColor, cosmetics: shownCosmetics, tuning: shownTuning, condition: truck.condition, trailerModelId: truck.trailerModelId, trailerColor: truck.trailerColor }}
          others={others}
          tier={view.hall.tier}
          night={view.night}
          sign={view.owner.username}
          trophies={view.badges}
          retired={view.retired}
          charms={view.charms}
          mode={mode}
          scenery={scenery}
          spin={spin}
          onCapture={(fn) => { capture.current = fn; }}
        />
        <div className="pointer-events-none absolute left-3 top-2 text-white drop-shadow">
          <p className="text-sm font-semibold">{truck.nickname ? `„${truck.nickname}“ · ` : ''}{truck.name.startsWith(truck.brand) ? truck.name : `${truck.brand} ${truck.name}`}</p>
          <p className="text-[11px] text-white/80">{truck.plate} · {int(truck.odometerKm)} {t('км')} · {truck.condition} % · {tx(view.hall.label)}</p>
        </div>
        {preview && <span className="absolute right-3 top-2 rounded-full bg-amber-500/90 px-2 py-0.5 text-[11px] font-semibold text-black">{t('Проба')}</span>}
      </div>

      {/* Camera and scenes. */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" className={chip(mode === 'orbit')} onClick={() => setMode('orbit')}>{t('🔄 Около камиона')}</button>
        <button type="button" className={chip(mode === 'cab')} onClick={() => setMode('cab')} data-testid="garage-cab">{t('🪑 В кабината')}</button>
        <button type="button" className={chip(mode === 'drive')} onClick={() => setMode('drive')} data-testid="garage-drive">{t('🛞 Пробно каране')}</button>
        <span className="mx-1 h-4 w-px bg-asphalt-700" />
        {SCENES.map((s) => <button key={s.id} type="button" className={chip(scenery === s.id && mode !== 'drive')} onClick={() => { setScenery(s.id); if (mode === 'drive') setMode('orbit'); }}>{t(s.label)}</button>)}
        <span className="mx-1 h-4 w-px bg-asphalt-700" />
        {mode === 'orbit' && <button type="button" className={chip(spin)} onClick={() => setSpin((x) => !x)}>{spin ? t('⏸ Спри') : t('▶ Върти')}</button>}
        <button type="button" className={chip(false)} onClick={takePhoto} data-testid="garage-photo">{t('📸 Снимка')}</button>
        {view.mine && <button type="button" className={chip(false)} disabled={busy} onClick={() => run({ type: 'shareGarage' }, t('Гаражът е в глобалния чат.'))}>{t('💬 Покажи в чата')}</button>}
      </div>

      {/* The numbers the game uses. */}
      <div className="grid gap-2 rounded-2xl border border-asphalt-700 bg-asphalt-900/50 p-3 sm:grid-cols-2" data-testid="garage-stats">
        {STAT_LABELS.map(([k, label]) => (
          <div key={k} className="text-xs">
            <div className="flex justify-between text-mist-300"><span>{t(label)}</span><span className="num">{stats[k]}{after && after[k] !== stats[k] ? ` → ${after[k]}` : ''}</span></div>
            <div className="relative mt-1 h-2 overflow-hidden rounded-full bg-asphalt-800">
              {after && after[k] > stats[k] && <div className="absolute inset-y-0 left-0 rounded-full bg-profit/50" style={{ width: `${after[k]}%` }} />}
              <div className="absolute inset-y-0 left-0 rounded-full bg-cyan-glow" style={{ width: `${stats[k]}%` }} />
            </div>
          </div>
        ))}
        <p className="text-[11px] text-mist-400 sm:col-span-2">{t('Тунингът и боята са за красота. Числата се менят само от подобренията.')}</p>
      </div>

      {view.mine ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {TABS.map((x) => <button key={x.id} type="button" className={chip(tab === x.id)} onClick={() => { setTab(x.id); setPreview(null); }}>{t(x.label)}</button>)}
          </div>
          {!own && tab !== 'history' && <p className="text-xs text-amber-300">{t('Наетите и фирмените камиони не се променят — избери свой.')}</p>}

          {tab === 'tuning' && (
            <div className="space-y-2" data-testid="garage-tuning">
              {TUNING_IDS.filter((p) => TUNING_PARTS[p].kinds.includes(truck.kind)).map((p) => {
                const def = TUNING_PARTS[p];
                const on = shownTuning[p];
                return (
                  <div key={p} className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="label w-36 shrink-0">{t(def.label)}</span>
                    <button type="button" className={chip(!on)} onClick={() => setPreview({ ...preview, tuning: { ...shownTuning, [p]: undefined } })}>{t('Без')}</button>
                    {def.styles.map((s) => {
                      const mine = owned.has(ownedKey(p, s.id));
                      return (
                        <button key={s.id} type="button" className={chip(on === s.id)} onClick={() => setPreview({ ...preview, tuning: { ...shownTuning, [p]: s.id } })}>
                          {t(s.label)} <span className="text-mist-400">· {mine ? t('твоя') : money(s.priceCents)}</span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
              {own && preview?.tuning && <TuningApply truckId={truck.id} now={tuningNow} next={preview.tuning} owned={owned} busy={busy} run={run} />}
            </div>
          )}

          {tab === 'upgrades' && (
            <ul className="space-y-1.5 text-sm" data-testid="garage-upgrades">
              {(Object.keys(UPGRADES) as UpgradeId[]).filter((u) => UPGRADES[u].appliesTo.includes(truck.kind)).map((u) => {
                const def = UPGRADES[u];
                const has = truck.upgrades.includes(u);
                return (
                  <li key={u} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-900/50 px-3 py-2" onMouseEnter={() => !has && setHoverUpgrade(u)} onMouseLeave={() => setHoverUpgrade(null)}>
                    <span>{has ? '✔ ' : ''}{tx(def.label)} <span className="text-xs text-mist-400">· {tx(def.description)}</span></span>
                    {has ? (
                      <span className="text-xs text-profit">{t('Монтирано')}</span>
                    ) : (
                      <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy || !own || !idle} onFocus={() => setHoverUpgrade(u)} onClick={() => run({ type: 'installUpgrade', vehicleId: truck.id, upgradeId: u }, t('Монтирано: {0}', tx(def.label)))}>
                        {t('Монтирай · {0}', money(def.priceCents))}
                      </button>
                    )}
                  </li>
                );
              })}
              {!idle && <li className="text-xs text-mist-400">{t('Камионът е на курс — подобренията се монтират между курсовете.')}</li>}
            </ul>
          )}

          {tab === 'paint' && (
            <div className="space-y-3 text-xs" data-testid="garage-paint">
              <div className="flex flex-wrap items-center gap-2">
                <span className="label">{t('Боя')}</span>
                {STANDARD_COLORS.map((c) => <button key={c} type="button" onClick={() => setPreview({ ...preview, color: c })} className={`h-7 w-7 rounded-full border-2 ${shownColor === c ? 'border-cyan-glow' : 'border-asphalt-700'}`} style={{ background: c }} aria-label={c} />)}
                {own && preview?.color && preview.color !== truck.color && (
                  <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => run({ type: 'shopBuy', purchase: { item: 'paint', vehicleId: truck.id, color: preview.color } }, t('Камионът е пребоядисан.'))}>
                    {isVip ? t('Боядисай · безплатно (VIP)') : t('Боядисай · {0} TC', 50)}
                  </button>
                )}
              </div>
              {truck.kind !== 'van' && (['grille', 'lights', 'visor'] as const).map((part) => (
                <div key={part} className="flex flex-wrap items-center gap-1.5">
                  <span className="label w-36 shrink-0">{t(COSMETIC_PARTS[part].label)}</span>
                  {COSMETIC_PARTS[part].styles.map((s) => {
                    const on = (shownCosmetics[part] as string | undefined) === s.id;
                    const fitted = (truck.cosmetics[part] as string | undefined) === s.id;
                    return (
                      <span key={s.id} className="inline-flex items-center gap-1">
                        <button type="button" className={chip(on)} onClick={() => setPreview({ ...preview, cosmetics: { ...(preview?.cosmetics ?? {}), [part]: s.id } })}>{t(s.label)}</button>
                        {own && on && !fitted && (
                          <button type="button" className="btn-primary px-2 py-0.5 text-[11px]" disabled={busy} onClick={() => run({ type: 'shopBuy', purchase: { item: 'truck_part', vehicleId: truck.id, cosmetic: `${part}:${s.id}` } }, t('Частта е сложена.'))}>
                            {t('Купи · {0} TC', COSMETIC_PARTS[part].price)}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              ))}
              <p className="text-mist-400">{t('Боята и тези части се плащат с ТрансКоин, както в Магазина.')}</p>
            </div>
          )}

          {tab === 'service' && (
            <div className="space-y-2 text-sm" data-testid="garage-service">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-900/50 px-3 py-2">
                <span>{t('Състояние: {0} %', truck.condition)} {truck.condition < 55 ? <span className="text-xs text-amber-300">· {t('драскотини')}</span> : null}{truck.condition < 35 ? <span className="text-xs text-loss"> · {t('ръжда')}</span> : null}</span>
                <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy || !own || !idle || truck.repairCents <= 0} onClick={() => run({ type: 'repairVehicle', vehicleId: truck.id }, t('Камионът е ремонтиран.'))}>
                  {truck.repairCents > 0 ? t('Ремонт · до {0}', money(truck.repairCents)) : t('Като нов')}
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-asphalt-700 bg-asphalt-900/50 px-3 py-2">
                <span>{truck.service.overdue ? t('Профилактиката закъснява с {0} км', int(-truck.service.dueInKm)) : t('Профилактика след {0} км', int(Math.max(0, truck.service.dueInKm)))}</span>
                <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={busy || !own || !idle || truck.service.fresh} onClick={() => run({ type: 'serviceVehicle', vehicleId: truck.id }, t('Профилактиката е направена.'))}>
                  {truck.service.fresh ? t('Скоро е правена') : t('Профилактика · до {0}', money(truck.service.cents))}
                </button>
              </div>
              <p className="text-xs text-mist-400">{t('Цената е преди отстъпките (VIP и сервиза на компанията).')} <Link href="/game/garage" className="underline">{t('Целият сервиз')}</Link></p>
            </div>
          )}

          {tab === 'sets' && (
            <div className="space-y-2 text-sm" data-testid="garage-sets">
              <p className="text-xs text-mist-400">{t('Запази тунинга като сглобка и го сменяй с един клик. Връщат се само частите, които камионът вече има.')}</p>
              {Array.from({ length: GARAGE.presets }, (_, slot) => {
                const preset = truck.cosmetics.presets?.[slot];
                const parts = preset ? Object.values(preset.tuning).filter(Boolean).length : 0;
                return (
                  <div key={slot} className="flex flex-wrap items-center gap-2 rounded-xl border border-asphalt-700 bg-asphalt-900/50 px-3 py-2">
                    <span className="min-w-28 font-semibold">{preset ? preset.name : t('Празно място {0}', slot + 1)}</span>
                    {preset && <span className="text-xs text-mist-400">{t('{0} части', parts)}</span>}
                    {preset && <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy || !own} onClick={() => run({ type: 'applyTuningPreset', vehicleId: truck.id, slot }, t('Сглобката е сложена.'))}>{t('Сложи')}</button>}
                    <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={busy || !own} onClick={() => run({ type: 'saveTuningPreset', vehicleId: truck.id, slot, name: presetName }, t('Запазено.'))}>{preset ? t('Запиши сегашния отгоре') : t('Запази сегашния')}</button>
                  </div>
                );
              })}
              <input className="input w-56 py-1 text-sm" maxLength={GARAGE.presetName} placeholder={t('Име на сглобката (по желание)')} aria-label={t('Име на сглобката')} value={presetName} onChange={(e) => setPresetName(e.target.value)} />
            </div>
          )}

          {tab === 'history' && <History truck={truck} />}
        </div>
      ) : (
        <div className="space-y-3">
          <History truck={truck} />
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-asphalt-700 bg-asphalt-900/50 p-3 text-sm" data-testid="garage-like">
            <input className="input w-64 py-1 text-sm" maxLength={GARAGE.noteChars} placeholder={t('Бележка за {0} (по желание)', view.owner.username)} aria-label={t('Бележка')} value={visitorNote} onChange={(e) => setVisitorNote(e.target.value)} />
            <button type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} onClick={() => run({ type: 'likeGarage', username: view.owner.username, note: visitorNote }, t('Благодарим! {0} ще види 👍.', view.owner.username))}>
              {view.liked ? t('👍 Харесано · обнови бележката') : t('👍 Харесай гаража')}
            </button>
          </div>
        </div>
      )}

      {/* Likes and notes from visitors. */}
      <div className="rounded-2xl border border-asphalt-700 bg-asphalt-900/50 p-3 text-sm">
        <p className="font-semibold">{t('👍 {0} харесвания', view.likes)}</p>
        {view.notes.filter((n) => n.note).length > 0 ? (
          <ul className="mt-2 space-y-1 text-xs">{view.notes.filter((n) => n.note).map((n) => <li key={n.username}><b>{n.username}</b>: {n.note}</li>)}</ul>
        ) : (
          <p className="mt-1 text-xs text-mist-400">{view.mine ? t('Покажи гаража в чата — гостите оставят 👍 и бележки.') : t('Още няма бележки.')}</p>
        )}
      </div>

      {note && <p className="text-sm text-profit">{note}</p>}
      {error && <p role="alert" className="text-sm text-loss">{error}</p>}
    </div>
  );
}

function TuningApply({ truckId, now, next, owned, busy, run }: { truckId: string; now: Tuning; next: Tuning; owned: Set<string>; busy: boolean; run: (b: Record<string, unknown>, done: string) => Promise<void> }) {
  const changes = TUNING_IDS.filter((p) => (now[p] ?? null) !== (next[p] ?? null));
  if (!changes.length) return null;
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {changes.map((p: TuningPart) => {
        const style = next[p] ?? null;
        const def = style ? TUNING_PARTS[p].styles.find((s) => s.id === style) : null;
        const free = !style || owned.has(ownedKey(p, style));
        return (
          <button key={p} type="button" className="btn-primary px-3 py-1.5 text-xs" disabled={busy} data-testid="garage-fit" onClick={() => run({ type: 'fitTuning', vehicleId: truckId, part: p, style }, style ? t('Сложено: {0}', t(TUNING_PARTS[p].label)) : t('Свалено: {0}', t(TUNING_PARTS[p].label)))}>
            {style ? (free ? t('Сложи {0} · твоя е', t(TUNING_PARTS[p].label).toLowerCase()) : t('Купи {0} · {1}', t(TUNING_PARTS[p].label).toLowerCase(), money(def!.priceCents))) : t('Свали {0}', t(TUNING_PARTS[p].label).toLowerCase())}
          </button>
        );
      })}
    </div>
  );
}

function History({ truck }: { truck: GarageView['trucks'][number] }) {
  const h = truck.history;
  return (
    <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" data-testid="garage-history">
      <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/50 p-3"><p className="text-xs text-mist-400">{t('Курсове')}</p><p className="num text-lg font-semibold">{int(h.trips)}</p></div>
      <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/50 p-3"><p className="text-xs text-mist-400">{t('Изминати км')}</p><p className="num text-lg font-semibold">{int(truck.odometerKm)}</p></div>
      <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/50 p-3"><p className="text-xs text-mist-400">{t('Най-дълъг курс')}</p><p className="num text-lg font-semibold">{int(h.longestKm)} {t('км')}</p></div>
      <div className="rounded-xl border border-asphalt-700 bg-asphalt-900/50 p-3"><p className="text-xs text-mist-400">{t('Любим град')}</p><p className="text-lg font-semibold">{h.favouriteCity ? tx(h.favouriteCity) : '—'}</p></div>
      <p className="col-span-2 text-xs text-mist-400 sm:col-span-4">{t('Сега е в {0}.', tx(truck.city))} {h.trips >= 100 ? t('🏅 Ветеран на пътя.') : h.trips >= 25 ? t('🎖️ Опитен камион.') : ''}</p>
    </div>
  );
}
