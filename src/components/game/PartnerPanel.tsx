'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/client/api';
import { t, tx } from '@/i18n/t';

export type PartnerLoadView = {
  id: string;
  lead: boolean;
  status: string;
  route: [string, string, string];
  relayCityId: number;
  goods: string;
  leader: string | null;
  partner: string | null;
  asked: boolean;
  leg2Open: boolean;
};

export type PartnerCardView = {
  id: string;
  route: [string, string, string];
  relayCityId: number;
  status: string;
  leader: string | null;
  partner: string | null;
  mine: boolean;
  lead: boolean;
  canJoin: boolean;
};

const routeText = (r: [string, string, string]) => r.map((c) => tx(c)).join(' → ');

/** 1.2.6: partner loads on the „Курсове“ page — the card from a link and the player's own. */
export type EscortView = { id: string; lead: boolean; status: string; route: [string, string]; other: string | null; runId: string | null };

export function PartnerPanel({ card, mine, escorts = [], bonus, points }: { card: PartnerCardView | null; mine: PartnerLoadView[]; escorts?: EscortView[]; bonus: number; points: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const run = async (key: string, body: Record<string, unknown>, done: string) => {
    setBusy(key);
    setError(null);
    setNote(null);
    try {
      await api('/api/game/action', body);
      setNote(done);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (!card && !mine.length && !escorts.length) return null;
  return (
    <section className="mb-4 rounded-2xl border border-emerald-400/40 bg-emerald-500/10 p-4 text-sm" data-testid="partner-panel">
      <p className="font-semibold">{t('🤝 Партньорски товари и ескорт')}</p>
      <p className="mt-1 text-xs text-mist-300">{t('Ти караш до средата, партньорът — до края. Навреме и двамата: +{0} % и +{1} точки за пропуска.', bonus, points)}</p>
      {card && !card.lead && !card.mine && (
        <div className="mt-3 rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-3" data-testid="partner-card">
          <p><b>{card.leader ?? '—'}</b>{' · '}{routeText(card.route)}</p>
          {card.canJoin ? (
            <button type="button" className="btn-primary mt-2 px-3 py-1.5 text-xs" disabled={!!busy} data-testid="partner-join" onClick={() => run('join', { type: 'acceptPartner', relayId: card.id }, t('Готово — втората част от {0} е запазена за теб.', tx(card.route[1])))}>
              {busy === 'join' ? '…' : t('Стани партньор')}
            </button>
          ) : (
            <p className="mt-1 text-xs text-mist-400">{card.partner ? t('Вече има партньор: {0}.', card.partner) : t('Товарът вече не търси партньор.')}</p>
          )}
        </div>
      )}
      {mine.length > 0 && (
        <ul className="mt-3 space-y-2">
          {mine.map((m) => (
            <li key={m.id} className="rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-3" data-testid="partner-load">
              <p>{routeText(m.route)}{m.goods ? <span className="text-mist-400">{' · '}{tx(m.goods)}</span> : null}</p>
              {m.lead ? (
                m.partner ? (
                  <p className="mt-1 text-xs text-profit">{t('Партньор: {0}', m.partner)}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input className="input w-40 py-1 text-sm" placeholder={t('Име на играч')} aria-label={t('Име на играч')} value={names[m.id] ?? ''} onChange={(e) => setNames({ ...names, [m.id]: e.target.value })} />
                    <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={!!busy || !(names[m.id] ?? '').trim()} data-testid="partner-invite" onClick={() => run(`inv:${m.id}`, { type: 'invitePartner', relayId: m.id, username: names[m.id] }, t('Поканата е изпратена в личните съобщения.'))}>
                      {busy === `inv:${m.id}` ? '…' : t('Покани')}
                    </button>
                    {!m.asked && (
                      <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={!!busy} data-testid="partner-ask" onClick={() => run(`ask:${m.id}`, { type: 'askPartner', relayId: m.id }, t('Обявата е в глобалния чат.'))}>
                        {busy === `ask:${m.id}` ? '…' : t('Потърси в чата')}
                      </button>
                    )}
                  </div>
                )
              ) : (
                <p className="mt-1 text-xs">
                  {t('С {0}', m.leader ?? '—')}
                  {' · '}
                  {m.leg2Open ? <Link href={`/game/contracts?from=${m.relayCityId}`} className="font-semibold text-cyan-glow hover:underline">{t('Твоят ред — поеми втората част')}</Link> : <span className="text-mist-400">{t('Чакаш първата част в {0}', tx(m.route[1]))}</span>}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {escorts.length > 0 && (
        <ul className="mt-3 space-y-2">
          {escorts.map((e) => (
            <li key={e.id} className="rounded-xl border border-orange-400/40 bg-asphalt-900/60 p-3" data-testid="escort-item">
              <p>🚓 {e.route.map((c) => tx(c)).join(' → ')}</p>
              {e.lead ? (
                e.other ? (
                  <p className="mt-1 text-xs text-profit">{t('Ескорт: {0}', e.other)}</p>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input className="input w-40 py-1 text-sm" placeholder={t('Име на играч')} aria-label={t('Име на играч')} value={names[e.id] ?? ''} onChange={(ev) => setNames({ ...names, [e.id]: ev.target.value })} />
                    <button type="button" className="btn-ghost px-3 py-1 text-xs" disabled={!!busy || !(names[e.id] ?? '').trim()} data-testid="escort-invite" onClick={() => run(`esc:${e.id}`, { type: 'inviteEscort', escortId: e.id, username: names[e.id] }, t('Поканата е изпратена в личните съобщения.'))}>
                      {busy === `esc:${e.id}` ? '…' : t('Покани за ескорт')}
                    </button>
                  </div>
                )
              ) : (
                <p className="mt-1 text-xs">{t('Ти си ескорт на {0}', e.other ?? '—')}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <p className="mt-2 text-profit">{note}</p>}
      {error && <p role="alert" className="mt-2 text-loss">{error}</p>}
    </section>
  );
}
