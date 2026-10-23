'use client';

import { AtSign, Building2, CornerUpLeft, Flag, Globe2, MessageCircle, Pin, Send, Shield, Smile, Store, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client/api';
import { CHAT_EMOJI, splitMentions, typingMention } from '@/lib/game/mentions';
import { unreadLabel } from '@/lib/game/social';
import { PinnedBar, ReactionPicker, Reactions, ReplyBar, ReplyQuote, jumpToMessage, type ReplyQuoteData } from './ChatReply';
import type { FeedMessage } from '@/server/game/messages';
import { PlayerName, openPlayerCard } from './PlayerName';
import { openReport } from './ReportDialog';
import { ScrollStrip } from './ScrollStrip';
import { useFeature } from './Features';

interface Conversation {
  userId: string;
  username: string;
  role: string;
  vip: boolean;
  online: boolean;
  lastSeen: string;
  unread: number;
  last: string;
}
interface Inbox {
  conversations: Conversation[];
  company: string | null;
  /** The alliance of the player's company (v1.5). */
  alliance?: string | null;
  me: string;
  meName: string;
  /** New messages in the channels (counted up to 100). */
  unread?: { global: number; trade: number; company: number };
}
interface Tab {
  id: string;
  label: string;
  icon?: typeof Globe2;
  unread?: number;
  online?: boolean;
}

const time = (iso: string) => new Date(iso).toLocaleString('bg-BG', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Europe/Sofia' });
const STORE = 'tv-chat';

function remember(state: { open: boolean; tab: string }) {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch {
    /* storage blocked */
  }
}

/**
 * Floating chat: one button that opens a panel with tabs — global, company,
 * trade and one tab per private conversation. Live through the events stream.
 */
export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('global');
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [extra, setExtra] = useState<{ id: string; title: string } | null>(null);
  const [messages, setMessages] = useState<FeedMessage[]>([]);
  const [canModerate, setCanModerate] = useState(false);
  // Company tab: the pinned message, who may pin and who is online.
  const [company, setCompany] = useState<{ canPin: boolean; pinned: { id: number; username: string; body: string } | null; online: { count: number; names: string[] } } | null>(null);
  const reactions = useFeature('chat_reactions');
  const pins = useFeature('chat_pin');
  const presence = useFeature('chat_online');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const extras = useFeature('chat_extras');
  const replies = useFeature('chat_replies');
  // A reply belongs to the tab it was started in.
  const [replyState, setReplyTo] = useState<(ReplyQuoteData & { tab: string }) | null>(null);
  const replyTo = replyState?.tab === tab ? replyState : null;
  const [suggest, setSuggest] = useState<{ query: string; names: string[] } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const tabRef = useRef(tab);
  const openRef = useRef(open);
  useEffect(() => {
    tabRef.current = tab;
    openRef.current = open;
  }, [tab, open]);

  const loadInbox = useCallback(async () => {
    try {
      setInbox(await api<Inbox>('/api/chat/inbox'));
    } catch {
      /* offline or logged out */
    }
  }, []);

  // Many messages in a busy channel: refresh the counters at most every few seconds.
  const inboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soonInbox = useCallback(() => {
    if (inboxTimer.current) return;
    inboxTimer.current = setTimeout(() => {
      inboxTimer.current = null;
      void loadInbox();
    }, 3000);
  }, [loadInbox]);

  const loadFeed = useCallback(async (which: string) => {
    try {
      const data = await api<{ messages: FeedMessage[]; canModerate: boolean; canPin?: boolean; pinned?: { id: number; username: string; body: string } | null; online?: { count: number; names: string[] } }>(`/api/chat/feed?tab=${encodeURIComponent(which)}`);
      if (tabRef.current !== which) return;
      setMessages(data.messages);
      setCanModerate(data.canModerate);
      setCompany(which === 'company' ? { canPin: !!data.canPin, pinned: data.pinned ?? null, online: data.online ?? { count: 0, names: [] } } : null);
      setError(null);
      // Opening a tab marks it read — refresh the unread badges.
      void loadInbox();
    } catch (e) {
      if (tabRef.current === which) setError((e as Error).message);
    }
  }, [loadInbox]);

  // Restore the last state, or open a chat asked for in the URL (?chat=dm:<id>) — e.g. from a notification.
  useEffect(() => {
    void Promise.resolve().then(() => {
      const fromUrl = new URLSearchParams(window.location.search).get('chat');
      let saved: { open?: boolean; tab?: string } = {};
      try {
        saved = JSON.parse(localStorage.getItem(STORE) ?? '{}');
      } catch {
        /* ignore */
      }
      if (fromUrl && /^(global|trade|company|dm:[0-9a-f-]{36})$/.test(fromUrl)) {
        setTab(fromUrl);
        setOpen(true);
      } else {
        if (saved.tab) setTab(saved.tab);
        if (saved.open && window.innerWidth >= 1024) setOpen(true);
      }
      void loadInbox();
    });
  }, [loadInbox]);

  useEffect(() => remember({ open, tab }), [open, tab]);

  useEffect(() => {
    if (!open) return;
    stick.current = true;
    void Promise.resolve().then(() => {
      setMessages([]);
      void loadFeed(tab);
    });
  }, [open, tab, loadFeed]);

  // Live: new messages in a channel, the company chat or a private conversation.
  useEffect(() => {
    const onChannel = (e: Event) => {
      const ch = (e as CustomEvent<{ channel?: string }>).detail?.channel;
      if (openRef.current && ch === tabRef.current) void loadFeed(tabRef.current);
      else soonInbox();
    };
    const onCompany = () => {
      if (openRef.current && tabRef.current === 'company') void loadFeed('company');
      else soonInbox();
    };
    const onDm = (e: Event) => {
      const other = (e as CustomEvent<{ with?: string }>).detail?.with;
      if (openRef.current && other && tabRef.current === `dm:${other}`) void loadFeed(tabRef.current);
      void loadInbox();
    };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent<{ tab: string; title?: string }>).detail;
      if (d.title && d.tab.startsWith('dm:')) setExtra({ id: d.tab, title: d.title });
      setTab(d.tab);
      setOpen(true);
    };
    window.addEventListener('tv:channel', onChannel);
    window.addEventListener('tv:chat', onCompany);
    window.addEventListener('tv:dm', onDm);
    window.addEventListener('tv:chat-open', onOpen);
    // Another panel (the account menu, "Още") opens over the same corner: fold the chat.
    const onClose = () => setOpen(false);
    window.addEventListener('tv:chat-close', onClose);
    const safety = setInterval(() => {
      void loadInbox();
      if (openRef.current) void loadFeed(tabRef.current);
    }, 45_000);
    return () => {
      window.removeEventListener('tv:channel', onChannel);
      window.removeEventListener('tv:chat', onCompany);
      window.removeEventListener('tv:dm', onDm);
      window.removeEventListener('tv:chat-open', onOpen);
      window.removeEventListener('tv:chat-close', onClose);
      clearInterval(safety);
    };
  }, [loadFeed, loadInbox, soonInbox]);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const tabs: Tab[] = useMemo(() => {
    const u = inbox?.unread;
    const out: Tab[] = [{ id: 'global', label: 'Глобален', icon: Globe2, unread: u?.global }];
    if (inbox?.company) out.push({ id: 'company', label: 'Компания', icon: Building2, unread: u?.company });
    if (inbox?.alliance) out.push({ id: 'alliance', label: 'Съюз', icon: Shield });
    out.push({ id: 'trade', label: 'Търговия', icon: Store, unread: u?.trade });
    for (const c of inbox?.conversations ?? []) out.push({ id: `dm:${c.userId}`, label: c.username, unread: c.unread, online: c.online });
    if (extra && !out.some((t) => t.id === extra.id)) out.push({ id: extra.id, label: extra.title });
    return out;
  }, [inbox, extra]);

  // Everything new: private messages and the channels.
  const unread = tabs.reduce((s, t) => s + (t.unread ?? 0), 0);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  const dm = tab.startsWith('dm:') ? tab.slice(3) : null;
  const partner = dm ? inbox?.conversations.find((c) => c.userId === dm) : null;
  const me = inbox?.me;

  /** Inserts text at the caret (emoji) and keeps the focus in the box. */
  const insertAt = (piece: string, replaceBack = 0) => {
    const el = input.current;
    const at = el?.selectionStart ?? text.length;
    const next = text.slice(0, at - replaceBack) + piece + text.slice(el?.selectionEnd ?? at);
    setText(next);
    requestAnimationFrame(() => {
      el?.focus();
      const caret = at - replaceBack + piece.length;
      el?.setSelectionRange(caret, caret);
    });
  };

  /** "@na…" before the caret: names from this chat first, then the player search. */
  const lookUp = async (value: string, caret: number) => {
    const query = extras ? typingMention(value.slice(0, caret)) : null;
    if (query === null) return setSuggest(null);
    const q = query.toLowerCase();
    const local = [...new Set([...messages.map((m) => m.username), ...(inbox?.conversations.map((c) => c.username) ?? [])])].filter((n) => n !== inbox?.meName && n.toLowerCase().startsWith(q));
    setSuggest({ query, names: local.slice(0, 6) });
    if (q.length < 2) return;
    try {
      const res = await api<{ players: { username: string }[] }>(`/api/players/search?q=${encodeURIComponent(q)}`);
      const names = [...new Set([...local, ...res.players.map((p) => p.username)])].filter((n) => n !== inbox?.meName).slice(0, 6);
      setSuggest((cur) => (cur && cur.query === query ? { query, names } : cur));
    } catch {
      // keep the local names
    }
  };

  const send = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const reply = replyTo?.id ?? null;
      if (dm) await api('/api/game/action', { type: 'sendDirect', userId: dm, body: text, replyTo: reply });
      else if (tab === 'company') await api('/api/game/action', { type: 'sendChat', body: text, replyTo: reply });
      else if (tab === 'alliance') await api('/api/game/action', { type: 'allianceMessage', body: text });
      else await api('/api/game/action', { type: 'sendChannel', channel: tab, body: text, replyTo: reply });
      setText('');
      setReplyTo(null);
      setSuggest(null);
      setEmojiOpen(false);
      stick.current = true;
      await loadFeed(tab);
      if (dm) void loadInbox();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: FeedMessage) => {
    try {
      if (dm) await api('/api/game/action', { type: 'unsendDirect', messageId: m.id });
      else if (tab === 'company') await api('/api/game/action', { type: 'deleteChat', messageId: m.id });
      else await api('/api/game/action', { type: 'deleteChannel', messageId: m.id });
      await loadFeed(tab);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const react = async (m: FeedMessage, emoji: string) => {
    try {
      await api('/api/game/action', { type: 'reactChat', tab, messageId: m.id, emoji });
      await loadFeed(tab);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const pin = async (messageId: number | null) => {
    try {
      await api('/api/game/action', { type: 'pinChat', messageId });
      await loadFeed('company');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const deleteConversation = async () => {
    if (!dm || !window.confirm('Да изтрием ли целия разговор? Изчезва само при теб.')) return;
    try {
      await api('/api/game/action', { type: 'deleteConversation', userId: dm });
      if (extra?.id === tab) setExtra(null);
      setTab('global');
      await loadInbox();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-volt-500 to-cyan-glow/80 text-white shadow-[0_10px_30px_-6px_rgba(47,123,255,0.8)] transition hover:scale-105 lg:bottom-6 lg:right-6"
          aria-label={unread ? `Чат (${unread} непрочетени)` : 'Чат'}
          title="Чат"
        >
          <MessageCircle className="h-6 w-6" />
          {unread > 0 && <span className="num absolute -right-0.5 -top-0.5 min-w-[22px] rounded-full border-2 border-asphalt-950 bg-amber-sig px-1 text-center text-xs font-bold leading-[18px] text-asphalt-950">{unreadLabel(unread)}</span>}
        </button>
      )}

      {open && (
        <section
          aria-label="Чат"
          className="fixed inset-x-0 bottom-0 top-[calc(3.5rem+env(safe-area-inset-top))] z-50 flex flex-col border-t border-asphalt-700 bg-asphalt-900/98 shadow-2xl backdrop-blur lg:inset-x-auto lg:bottom-6 lg:right-6 lg:top-auto lg:h-[min(640px,calc(100dvh-7rem))] lg:w-[400px] lg:rounded-2xl lg:border"
        >
          <header className="flex items-center gap-2 border-b border-asphalt-800 px-2 pt-2">
            <ScrollStrip label="Раздели на чата" activeKey={current.id}>
              {tabs.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={t.id === current.id ? 'page' : undefined}
                  className={`relative flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition ${t.id === current.id ? 'bg-volt-500 text-white' : 'bg-asphalt-800 text-mist-300 hover:text-white'}`}
                >
                  {t.icon ? <t.icon className="h-3.5 w-3.5" /> : <span className={`h-2 w-2 rounded-full ${t.online ? 'bg-profit' : 'bg-asphalt-500'}`} />}
                  <span className="max-w-[110px] truncate">{t.label}</span>
                  {!!t.unread && t.id !== current.id && <span className="num rounded-full bg-amber-sig px-1.5 text-[10px] font-bold text-asphalt-950" aria-label={`${unreadLabel(t.unread)} нови`}>{unreadLabel(t.unread)}</span>}
                </button>
              ))}
            </ScrollStrip>
            <button type="button" onClick={() => setOpen(false)} className="mb-2 shrink-0 rounded-full p-1.5 text-mist-400 hover:bg-asphalt-800 hover:text-white" aria-label="Затвори чата"><X className="h-5 w-5" /></button>
          </header>

          {dm && (
            <div className="flex items-center justify-between gap-2 border-b border-asphalt-800 px-3 py-2 text-xs">
              <span className="min-w-0">
                <button type="button" className="font-semibold hover:underline" onClick={() => openPlayerCard(partner?.username ?? current.label)}>{partner?.username ?? current.label}</button>
                <span className={partner?.online ? 'text-profit' : 'text-mist-400'}> · {partner ? partner.lastSeen : 'нов разговор'}</span>
              </span>
              {partner && <button type="button" className="inline-flex items-center gap-1 text-mist-400 hover:text-loss" onClick={() => void deleteConversation()}><Trash2 className="h-3.5 w-3.5" />Изтрий чата</button>}
            </div>
          )}
          {tab === 'company' && company && presence && (
            <p className="border-b border-asphalt-800 px-3 py-1.5 text-[11px] text-mist-400" title={company.online.names.join(', ')}>
              <span className="mr-1 inline-block h-2 w-2 rounded-full bg-profit" />{company.online.count} {company.online.count === 1 ? 'член е' : 'членове са'} в играта{company.online.names.length ? `: ${company.online.names.slice(0, 5).join(', ')}${company.online.count > 5 ? '…' : ''}` : ''}
            </p>
          )}
          {tab === 'company' && company?.pinned && pins && <PinnedBar pinned={company.pinned} canPin={company.canPin} onUnpin={() => void pin(null)} onJump={(id) => jumpToMessage(list.current, id)} />}
          {tab === 'trade' && <p className="border-b border-asphalt-800 px-3 py-2 text-[11px] text-mist-400">Само обяви: купувам / продавам. Самата сделка с техника става през Автопарк → Пазар → Употребявани.</p>}

          <div
            ref={list}
            onScroll={(e) => {
              const el = e.currentTarget;
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
            }}
            className="flex-1 space-y-2.5 overflow-y-auto px-3 py-3"
            aria-live="polite"
          >
            {messages.length === 0 && <p className="py-10 text-center text-sm text-mist-400">{dm ? 'Напиши първото съобщение.' : tab === 'trade' ? 'Още няма обяви. Предложи нещо!' : 'Още няма съобщения. Поздрави всички!'}</p>}
            {messages.map((m) => {
              const mine = m.userId === me;
              return (
                <div key={m.id} data-message={m.id} className={`group flex rounded-2xl ${mine ? 'justify-end' : ''}`}>
                  <div className={`max-w-[85%] rounded-2xl px-3 py-1.5 ${mine ? 'bg-volt-500/25' : 'bg-asphalt-800'}`}>
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                      {tab === 'company' && presence && <span className={`h-1.5 w-1.5 rounded-full ${m.online ? 'bg-profit' : 'bg-asphalt-500'}`} title={m.online ? 'В играта' : 'Не е в играта'} />}
                      {!dm && <PlayerName name={m.username} role={m.role} vip={m.vip} className="font-semibold" />}
                      <span className="text-mist-400">{time(m.createdAt)}</span>
                      {mine && dm && m.read && !m.deleted && <span className="text-cyan-glow">· видяно</span>}
                      {replies && !m.deleted && (
                        <button type="button" className="text-mist-400 opacity-60 transition hover:text-cyan-glow group-hover:opacity-100" onClick={() => { setReplyTo({ id: m.id, username: m.username, body: (m.body ?? '').slice(0, 90), tab }); input.current?.focus(); }} aria-label={`Отговори на ${m.username}`} title="Отговори"><CornerUpLeft className="h-3 w-3" /></button>
                      )}
                      {reactions && !m.deleted && <ReactionPicker mine={(m.reactions ?? []).filter((r) => r.mine).map((r) => r.emoji)} onPick={(e) => void react(m, e)} />}
                      {pins && tab === 'company' && company?.canPin && !m.deleted && company.pinned?.id !== m.id && (
                        <button type="button" className="text-mist-400 opacity-60 transition hover:text-gold-400 group-hover:opacity-100" onClick={() => void pin(m.id)} aria-label="Закачи съобщението" title="Закачи"><Pin className="h-3 w-3" /></button>
                      )}
                      {!m.deleted && !mine && (
                        <button type="button" className="text-mist-400 opacity-60 transition hover:text-loss group-hover:opacity-100" onClick={() => openReport({ targetUserId: m.userId, username: m.username, kind: dm ? 'dm' : tab === 'company' ? 'company' : 'channel', messageId: m.id, snippet: m.body })} aria-label="Докладвай съобщението"><Flag className="h-3 w-3" /></button>
                      )}
                      {!m.deleted && (mine || canModerate) && (
                        <button type="button" className="text-mist-400 opacity-60 transition hover:text-loss group-hover:opacity-100" onClick={() => void remove(m)} aria-label="Изтрий съобщението"><Trash2 className="h-3 w-3" /></button>
                      )}
                    </div>
                    {m.reply && !m.deleted && <ReplyQuote reply={m.reply} onJump={(id) => jumpToMessage(list.current, id)} />}
                    <p className={`whitespace-pre-wrap break-words text-sm ${m.deleted ? 'italic text-mist-400' : ''}`}>
                      {m.deleted || !m.body
                        ? 'Съобщението е изтрито.'
                        : (extras ? splitMentions(m.body) : [{ text: m.body }]).map((part, i) =>
                            part.mention ? (
                              <button key={i} type="button" onClick={() => openPlayerCard(part.mention!)} className={`rounded px-0.5 font-semibold ${part.mention.toLowerCase() === inbox?.meName.toLowerCase() ? 'bg-gold-400/25 text-gold-400' : 'text-cyan-glow hover:underline'}`}>
                                {part.text}
                              </button>
                            ) : (
                              <span key={i}>{part.text}</span>
                            ),
                          )}
                    </p>
                    {!m.deleted && <Reactions items={m.reactions ?? []} canReact={reactions} onToggle={(e) => void react(m, e)} />}
                  </div>
                </div>
              );
            })}
          </div>

          {suggest && suggest.names.length > 0 && (
            <ul className="flex flex-wrap gap-1.5 border-t border-asphalt-800 px-2 pt-2" aria-label="Споменай играч">
              {suggest.names.map((n) => (
                <li key={n}>
                  <button type="button" className="inline-flex items-center gap-1 rounded-full border border-asphalt-600 bg-asphalt-800 px-2 py-0.5 text-xs hover:border-cyan-glow/60" onClick={() => { insertAt(`@${n} `, suggest.query.length + 1); setSuggest(null); }}>
                    <AtSign className="h-3 w-3 text-cyan-glow" />{n}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {emojiOpen && (
            <div className="grid grid-cols-8 gap-1 border-t border-asphalt-800 p-2" role="listbox" aria-label="Емоджи">
              {CHAT_EMOJI.map((e) => (
                <button key={e} type="button" role="option" aria-selected={false} className="rounded-lg py-1 text-lg hover:bg-asphalt-800" onClick={() => insertAt(e)}>{e}</button>
              ))}
            </div>
          )}
          {replyTo && <ReplyBar to={replyTo} onCancel={() => setReplyTo(null)} />}
          <form onSubmit={(e) => void send(e)} className="flex gap-2 border-t border-asphalt-800 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:pb-2">
            {extras && <button type="button" className={`shrink-0 rounded-xl px-2 transition ${emojiOpen ? 'bg-asphalt-700 text-gold-400' : 'text-mist-400 hover:bg-asphalt-800 hover:text-white'}`} onClick={() => setEmojiOpen((o) => !o)} aria-label="Емоджи" aria-expanded={emojiOpen}><Smile className="h-5 w-5" /></button>}
            <textarea
              ref={input}
              className="input min-h-10 flex-1 resize-none py-2 text-sm"
              rows={1}
              maxLength={500}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                void lookUp(e.target.value, e.target.selectionStart ?? e.target.value.length);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSuggest(null);
                  setReplyTo(null);
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  // Enter picks the first suggested name while one is offered.
                  if (suggest?.names.length) {
                    insertAt(`@${suggest.names[0]} `, suggest.query.length + 1);
                    setSuggest(null);
                  } else void send();
                }
              }}
              placeholder={dm ? `Съобщение до ${current.label}…` : tab === 'trade' ? 'Продавам / купувам…' : tab === 'company' ? (extras ? 'До компанията… (@име споменава)' : 'До компанията…') : tab === 'alliance' ? 'До целия съюз…' : (extras ? 'До всички играчи… (@име споменава)' : 'До всички играчи…')}
              aria-label="Съобщение"
            />
            <button className="btn-primary px-3" disabled={busy || !text.trim()} aria-label="Изпрати"><Send className="h-4 w-4" /></button>
          </form>
          {error && <p role="alert" className="px-3 pb-2 text-xs text-loss">{error}</p>}
        </section>
      )}
    </>
  );
}
