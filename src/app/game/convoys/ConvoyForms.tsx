'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { CONVOYS, CONVOY_ROLES } from '@/lib/game/convoys';

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (body: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id?: string }>('/api/game/action', body);
      router.refresh();
      return r ?? {};
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, send, router };
}

type City = { id: number; name: string };

export function NewConvoy({ origins, destinations, maxSeats, company, cargo }: { origins: City[]; destinations: City[]; maxSeats: number; company: boolean; cargo: { id: string; label: string }[] }) {
  const { busy, error, send, router } = useSend();
  const [kind, setKind] = useState<'personal' | 'company'>('personal');
  const [access, setAccess] = useState<'open' | 'friends' | 'link'>('open');
  const [from, setFrom] = useState(origins[0]?.id ?? 0);
  const [to, setTo] = useState(destinations.find((d) => d.id !== origins[0]?.id)?.id ?? 0);
  const [depart, setDepart] = useState(60);
  const [seats, setSeats] = useState(Math.min(4, maxSeats));
  const [minLevel, setMinLevel] = useState(1);
  const [shared, setShared] = useState('');
  const [tons, setTons] = useState(12);
  const [title, setTitle] = useState('');
  if (!origins.length) return <p className="text-sm text-mist-400">Конвой тръгва от град, където имаш камион.</p>;
  return (
    <form
      className="grid gap-3 text-sm sm:grid-cols-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await send({ type: 'createConvoy', kind, access, originCityId: from, destCityId: to, departInMin: depart, seats, minLevel, sharedCargo: shared || null, sharedTons: shared ? tons : null, title: title || undefined });
        if (r?.id) router.push(`/game/convoys/${r.id}`);
      }}
    >
      {company && (
        <label className="space-y-1"><span className="label">Вид</span>
          <select className="input w-full" value={kind} onChange={(e) => setKind(e.target.value as 'personal' | 'company')}><option value="personal">Личен</option><option value="company">Фирмен (само членове)</option></select>
        </label>
      )}
      {kind === 'personal' && (
        <label className="space-y-1"><span className="label">Кой може да се включи</span>
          <select className="input w-full" value={access} onChange={(e) => setAccess(e.target.value as 'open' | 'friends' | 'link')}><option value="open">Всички</option><option value="friends">Само приятели</option><option value="link">Само с линк</option></select>
        </label>
      )}
      <label className="space-y-1"><span className="label">От (град с твой камион)</span>
        <select className="input w-full" value={from} onChange={(e) => setFrom(Number(e.target.value))}>{origins.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <label className="space-y-1"><span className="label">До</span>
        <select className="input w-full" value={to} onChange={(e) => setTo(Number(e.target.value))}>{destinations.filter((c) => c.id !== from).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      </label>
      <label className="space-y-1"><span className="label">Тръгване след</span>
        <select className="input w-full" value={depart} onChange={(e) => setDepart(Number(e.target.value))}>{[15, 30, 60, 120, 180, 360, 720, 1440].map((m) => <option key={m} value={m}>{m < 60 ? `${m} мин` : `${m / 60} ч`}</option>)}</select>
      </label>
      <label className="space-y-1"><span className="label">Места (до {maxSeats})</span>
        <input type="number" className="input w-full" min={CONVOYS.seats.min} max={maxSeats} value={seats} onChange={(e) => setSeats(Number(e.target.value) || CONVOYS.seats.min)} />
      </label>
      <label className="space-y-1"><span className="label">Минимално ниво</span>
        <input type="number" className="input w-full" min={1} max={100} value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value) || 1)} />
      </label>
      <label className="space-y-1"><span className="label">Общ товар (по избор)</span>
        <select className="input w-full" value={shared} onChange={(e) => setShared(e.target.value)}><option value="">Без — всеки със свой товар</option>{cargo.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
      </label>
      {shared && (
        <label className="space-y-1"><span className="label">Тонове на камион</span>
          <input type="number" className="input w-full" min={CONVOYS.sharedTons.min} max={CONVOYS.sharedTons.max} value={tons} onChange={(e) => setTons(Number(e.target.value) || CONVOYS.sharedTons.min)} />
        </label>
      )}
      <label className="space-y-1 sm:col-span-2"><span className="label">Име (по избор)</span>
        <input className="input w-full" maxLength={60} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Нощна колона към морето" />
      </label>
      <div className="sm:col-span-2"><button className="btn-primary" disabled={busy || !to}>Създай конвой</button></div>
      {error && <p role="alert" className="text-loss sm:col-span-2">{error}</p>}
    </form>
  );
}

export function JoinConvoy({ convoyId, vehicles, loads, shared, roles }: { convoyId: string; vehicles: { id: string; label: string }[]; loads: { id: string; label: string }[]; shared: string | null; roles: ('tail' | 'scout')[] }) {
  const { busy, error, send } = useSend();
  const [vehicleId, setVehicle] = useState(vehicles[0]?.id ?? '');
  const [load, setLoad] = useState(shared ? '' : (loads[0]?.id ?? ''));
  const [role, setRole] = useState<'member' | 'tail' | 'scout'>('member');
  if (!vehicles.length) return <p className="text-sm text-mist-400">Нужен е свободен камион в града на тръгване.</p>;
  if (!shared && !loads.length) return <p className="text-sm text-mist-400">По линията няма свободен товар сега — погледни пак след малко или избери конвой с общ товар.</p>;
  return (
    <form className="grid gap-2 text-sm sm:grid-cols-3" onSubmit={async (e) => { e.preventDefault(); await send({ type: 'joinConvoy', convoyId, vehicleId, contractId: load || null, role }); }}>
      <select className="input" aria-label="Камион" value={vehicleId} onChange={(e) => setVehicle(e.target.value)}>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}</select>
      <select className="input" aria-label="Товар" value={load} onChange={(e) => setLoad(e.target.value)}>
        {shared && <option value="">Част от общия товар · {shared}</option>}
        {loads.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
      <select className="input" aria-label="Роля" value={role} onChange={(e) => setRole(e.target.value as 'member' | 'tail' | 'scout')}>
        <option value="member">{CONVOY_ROLES.member.emoji} {CONVOY_ROLES.member.label}</option>
        {roles.map((r) => <option key={r} value={r}>{CONVOY_ROLES[r].emoji} {CONVOY_ROLES[r].label} (+1 %)</option>)}
      </select>
      <div className="sm:col-span-3"><button className="btn-primary" disabled={busy || !vehicleId}>🚚 Включи се</button></div>
      {error && <p role="alert" className="text-loss sm:col-span-3">{error}</p>}
    </form>
  );
}

export function ConvoyChat({ convoyId }: { convoyId: string }) {
  const { busy, error, send } = useSend();
  const [body, setBody] = useState('');
  return (
    <form className="flex gap-2 text-sm" onSubmit={async (e) => { e.preventDefault(); if (await send({ type: 'convoyMessage', convoyId, body })) setBody(''); }}>
      <input className="input min-w-0 flex-1" maxLength={CONVOYS.messageMax} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Готови сме, тръгваме в 20:00!" aria-label="Съобщение до колоната" />
      <button className="btn-ghost" disabled={busy || !body.trim()}>Прати</button>
      {error && <p role="alert" className="text-loss">{error}</p>}
    </form>
  );
}
