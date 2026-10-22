'use client';

import { useFeature } from './Features';
import { DuelChallenge } from './TogetherActions';
import { Award, Ban, Banknote, Building2, CalendarDays, Check, Flag, MessageSquare, Settings, Star, Truck, UserCheck, UserMinus, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import type { PlayerCard as Card } from '@/server/game/social';
import { GhostTruckIcon, PumpkinIcon } from '@/components/seasonal/icons';
import { Avatar } from './Avatar';
import { LeagueBadge } from './LeagueBadge';
import { PlayerName } from './PlayerName';
import { openReport } from './ReportDialog';
import { SendMoneyForm } from './SendMoneyForm';

/** The ring around the picture: the Halloween badge, then the Discord level frames (gold 25, cyan 10). */
const frameOf = (badges: { id: string }[]) =>
  badges.some((b) => b.id === 'pumpkin-2026') ? 'ring-2 ring-orange-500 ring-offset-2 ring-offset-asphalt-900'
  : badges.some((b) => b.id === 'discord-25') ? 'ring-[3px] ring-gold-400 ring-offset-2 ring-offset-asphalt-900 shadow-[0_0_18px_rgba(246,195,67,0.45)]'
  : badges.some((b) => b.id === 'discord-10') ? 'ring-2 ring-cyan-glow ring-offset-2 ring-offset-asphalt-900'
  : '';

/** Opens a private chat in the chat dock. */
export function openDirectChat(userId: string, username: string) {
  window.dispatchEvent(new CustomEvent('tv:chat-open', { detail: { tab: `dm:${userId}`, title: username } }));
}

function Stat({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-asphalt-850 px-3 py-2">
      <div className="text-[11px] text-mist-400">{label}</div>
      <div className="num font-display text-lg font-bold">{value}</div>
      {sub && <div className="text-[11px] text-mist-400">{sub}</div>}
    </div>
  );
}

/** A player's profile card: who they are, how they play, and what you can do with them. */
export function PlayerCardView({ card, onChange, onClose, careerLink = true }: { card: Card; onChange?: () => void; onClose?: () => void; careerLink?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const transfers = useFeature('transfers');
  const career = useFeature('career');
  const duels = useFeature('duels');
  const act = async (action: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', action);
      onChange?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const since = new Date(card.memberSince).toLocaleDateString('bg-BG', { month: 'long', year: 'numeric' });
  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Avatar userId={card.id} username={card.username} version={card.avatarVersion} vip={card.vip} className={`h-16 w-16 text-2xl ${frameOf(card.badges)}`} rounded="rounded-2xl" />
          <span className={`absolute -bottom-1 -right-1 h-4 w-4 rounded-full border-2 border-asphalt-900 ${card.online ? 'bg-profit' : 'bg-asphalt-500'}`} title={card.online ? 'Онлайн' : `Последно: ${card.lastSeen}`} />
        </div>
        <div className="min-w-0">
          <PlayerName name={card.username} role={card.role} vip={card.vip} card={false} className="font-display text-xl font-bold" />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <LeagueBadge tier={card.leagueTier} />
            {card.badges.map((b) => (
              <span key={b.id} title={b.description} className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${b.id === 'pumpkin-2026' ? 'border-orange-500/50 bg-orange-500/10 text-orange-300' : 'border-prestige/50 bg-prestige/10 text-prestige'}`}>
                {b.id === 'pumpkin-2026' ? <PumpkinIcon className="h-3.5 w-3.5" /> : b.id === 'ghost-hunter' ? <GhostTruckIcon className="h-3.5 w-3.5" /> : <Award className="h-3.5 w-3.5" />}
                {b.label}
              </span>
            ))}
          </div>
          <div className={`text-sm ${card.online ? 'text-profit' : 'text-mist-400'}`}>{card.online ? 'Онлайн сега' : `Последно онлайн: ${card.lastSeen}`}</div>
          <div className="mt-0.5 flex items-center gap-1 text-xs text-mist-400"><CalendarDays className="h-3.5 w-3.5" />В играта от {since}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Ниво" value={card.level} sub={<span className="mt-1 block h-1 overflow-hidden rounded-full bg-asphalt-700"><span className="block h-full bg-cyan-glow" style={{ width: `${Math.max(3, card.levelShare * 100)}%` }} /></span>} />
        <Stat label="Репутация" value={<span className="inline-flex items-center gap-1"><Star className="h-4 w-4 text-prestige" />{Math.floor(card.reputation)}</span>} sub={card.reputationTier} />
        <Stat label="Доставки" value={card.deliveries.toLocaleString('bg-BG')} sub={card.kind === 'company' ? 'собствен автопарк' : 'шофьор'} />
        <Stat label="Приятели" value={card.friends} />
      </div>
      {card.hauler && <p className="mt-2 text-sm text-mist-300">Превозвач на борсата: <span className="text-gold-400">★ {card.hauler.stars.toLocaleString('bg-BG')}</span> от {card.hauler.count} {card.hauler.count === 1 ? 'оценка' : 'оценки'}</p>}

      {careerLink && career && <Link href={`/game/players/${encodeURIComponent(card.username)}`} onClick={onClose} className="mt-3 inline-flex items-center gap-1.5 text-sm text-cyan-glow hover:underline"><Truck className="h-4 w-4" />Кариера: курсове, рекорди, любими линии →</Link>}

      <div className="mt-3 flex items-center gap-2 rounded-xl border border-asphalt-700 px-3 py-2 text-sm">
        <Building2 className="h-4 w-4 shrink-0 text-mist-400" />
        {card.company ? (
          <Link href={`/game/companies/${card.company.id}`} onClick={onClose} className="min-w-0 truncate hover:underline">
            {card.company.tag && <span style={{ color: card.company.color ?? undefined }}>[{card.company.tag}] </span>}
            <span className="font-semibold">{card.company.name}</span> <span className="text-mist-400">· {card.company.rank}</span>
          </Link>
        ) : (
          <span className="text-mist-400">Не е в компания</span>
        )}
      </div>

      {card.relation === 'self' ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/game/profile" onClick={onClose} className="btn-ghost"><Truck className="h-4 w-4" />Моят профил</Link>
          <Link href="/game/settings" onClick={onClose} className="btn-ghost"><Settings className="h-4 w-4" />Настройки</Link>
        </div>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="btn-primary" onClick={() => { openDirectChat(card.id, card.username); onClose?.(); }}><MessageSquare className="h-4 w-4" />Съобщение</button>
          {card.relation === 'none' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act({ type: 'friendRequest', userId: card.id })}><UserPlus className="h-4 w-4" />Добави приятел</button>}
          {duels && <DuelChallenge userId={card.id} username={card.username} />}
          {card.relation === 'sent' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act({ type: 'friendRemove', userId: card.id })}><X className="h-4 w-4" />Отмени поканата</button>}
          {card.relation === 'received' && card.friendshipId && (
            <>
              <button type="button" className="btn-gold" disabled={busy} onClick={() => void act({ type: 'friendRespond', friendshipId: card.friendshipId, accept: true })}><Check className="h-4 w-4" />Приеми приятелството</button>
              <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act({ type: 'friendRespond', friendshipId: card.friendshipId, accept: false })}>Откажи</button>
            </>
          )}
          {card.relation === 'friends' && (
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => { if (window.confirm(`Да премахнем ли ${card.username} от приятелите?`)) void act({ type: 'friendRemove', userId: card.id }); }}>
              <UserCheck className="h-4 w-4 text-profit" />Приятели<UserMinus className="h-3.5 w-3.5 text-mist-400" />
            </button>
          )}
          {card.canInvite && <button type="button" className="btn-ghost" disabled={busy} onClick={() => void act({ type: 'companyInvite', userId: card.id })}><Users className="h-4 w-4" />Покани в компанията</button>}
          {card.invited && <span className="inline-flex items-center gap-1 px-2 text-sm text-mist-400"><Check className="h-4 w-4" />Поканен в компанията</span>}
          {transfers && <button type="button" className="btn-ghost" aria-expanded={paying} onClick={() => setPaying((v) => !v)}><Banknote className="h-4 w-4 text-gold-400" />Изпрати пари</button>}
        </div>
      )}
      {paying && card.relation !== 'self' && <div className="mt-3"><SendMoneyForm userId={card.id} username={card.username} /></div>}
      {card.relation !== 'self' && (
        <div className="mt-3 flex flex-wrap gap-3 border-t border-asphalt-800 pt-3 text-xs">
          {card.blocked ? (
            <button type="button" className="inline-flex items-center gap-1 text-mist-300 hover:text-white" disabled={busy} onClick={() => void act({ type: 'unblockUser', userId: card.id })}><Ban className="h-3.5 w-3.5" />Отблокирай</button>
          ) : (
            <button type="button" className="inline-flex items-center gap-1 text-mist-400 hover:text-loss" disabled={busy} onClick={() => { if (window.confirm(`Да блокираме ли ${card.username}? Няма да виждаш съобщенията му и той няма да може да ти пише.`)) void act({ type: 'blockUser', userId: card.id }); }}><Ban className="h-3.5 w-3.5" />Блокирай</button>
          )}
          <button type="button" className="inline-flex items-center gap-1 text-mist-400 hover:text-loss" onClick={() => { onClose?.(); openReport({ targetUserId: card.id, username: card.username, kind: 'player' }); }}><Flag className="h-3.5 w-3.5" />Докладвай</button>
          {card.blocked && <span className="text-loss">Блокиран от теб</span>}
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-loss">{error}</p>}
    </div>
  );
}

/** Listens for clicks on player names and shows their card in a dialog. Mounted once in the game layout. */
export function PlayerCardHost() {
  const [username, setUsername] = useState<string | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (name: string) => {
    try {
      setCard(await api<Card>(`/api/players/card?u=${encodeURIComponent(name)}`));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    const open = (e: Event) => {
      const name = (e as CustomEvent<{ username: string }>).detail.username;
      setUsername(name);
      setCard(null);
      setError(null);
      void load(name);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setUsername(null);
    window.addEventListener('tv:player', open);
    document.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('tv:player', open);
      document.removeEventListener('keydown', key);
    };
  }, [load]);

  if (!username) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-modal="true" aria-label={`Профил на ${username}`}>
      <button type="button" className="absolute inset-0 bg-black/60 backdrop-blur-sm" aria-label="Затвори" onClick={() => setUsername(null)} />
      <div className="relative w-full max-w-lg rounded-t-3xl border border-asphalt-700 bg-asphalt-900 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:pb-5">
        <button type="button" className="absolute right-3 top-3 rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" onClick={() => setUsername(null)} aria-label="Затвори"><X className="h-5 w-5" /></button>
        {card ? <PlayerCardView card={card} onChange={() => void load(username)} onClose={() => setUsername(null)} /> : error ? <p className="py-6 text-center text-sm text-loss">{error}</p> : <p className="py-10 text-center text-sm text-mist-400">Зареждане…</p>}
      </div>
    </div>
  );
}
