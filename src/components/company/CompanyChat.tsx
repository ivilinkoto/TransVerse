'use client';

import { Send, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PlayerName } from '@/components/game/PlayerName';
import { api } from '@/lib/client/api';
import type { ChatMessage } from '@/server/game/chat';

const time = (iso: string) => new Date(iso).toLocaleString('bg-BG', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Sofia' });

/** Company chat: live via the events stream (tv:chat), with a slow safety refresh. */
export function CompanyChat({ me, initial, canModerate, canClear = false }: { me: string; initial: ChatMessage[]; canModerate: boolean; canClear?: boolean }) {
  const [messages, setMessages] = useState(initial);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const reload = useCallback(async () => {
    try {
      const data = await api<{ messages: ChatMessage[] }>('/api/company/chat');
      setMessages(data.messages);
    } catch {
      /* keep what we have */
    }
  }, []);

  useEffect(() => {
    const onChat = () => void reload();
    window.addEventListener('tv:chat', onChat);
    const interval = setInterval(onChat, 30_000);
    return () => {
      window.removeEventListener('tv:chat', onChat);
      clearInterval(interval);
    };
  }, [reload]);

  // Keep the newest message in view unless the player scrolled up to read.
  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api('/api/game/action', { type: 'sendChat', body: text });
      setText('');
      stick.current = true;
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Да изтрием ли всички съобщения в чата на компанията? Това не може да се върне.')) return;
    setError(null);
    try {
      await api('/api/game/action', { type: 'clearChat' });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const remove = async (id: number) => {
    try {
      await api('/api/game/action', { type: 'deleteChat', messageId: id });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-[min(70dvh,640px)] flex-col">
      {canClear && messages.length > 0 && (
        <div className="mb-2 flex justify-end">
          <button type="button" className="btn-ghost px-3 py-1 text-xs text-loss" onClick={clearAll}>
            <Trash2 className="h-3.5 w-3.5" />Изчисти целия чат
          </button>
        </div>
      )}
      <div
        ref={list}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="flex-1 space-y-3 overflow-y-auto pr-2"
        aria-live="polite"
        aria-label="Съобщения"
      >
        {messages.length === 0 && <p className="py-10 text-center text-sm text-mist-400">Още няма съобщения. Поздрави колегите си!</p>}
        {messages.map((m) => {
          const mine = m.userId === me;
          return (
            <div key={m.id} className={`group flex ${mine ? 'justify-end' : ''}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 ${mine ? 'bg-volt-500/20' : 'bg-asphalt-800'}`}>
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  <PlayerName name={m.username} role={m.role} vip={m.vip} className="font-semibold" />
                  {m.rank && <span className="text-mist-400">· {m.rank}</span>}
                  <span className="text-mist-400">· {time(m.createdAt)}</span>
                  {!m.deleted && (mine || canModerate) && (
                    <button className="ml-1 text-mist-400 opacity-0 transition hover:text-loss group-hover:opacity-100 focus:opacity-100" onClick={() => remove(m.id)} aria-label="Изтрий съобщението">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className={`mt-0.5 whitespace-pre-wrap break-words text-sm ${m.deleted ? 'italic text-mist-400' : ''}`}>{m.deleted ? 'Съобщението е изтрито.' : m.body}</p>
              </div>
            </div>
          );
        })}
      </div>
      <form onSubmit={send} className="mt-3 flex gap-2 border-t border-asphalt-800 pt-3">
        <textarea
          className="input min-h-11 flex-1 resize-none py-2"
          rows={1}
          maxLength={500}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(e as unknown as React.FormEvent);
            }
          }}
          placeholder="Съобщение до компанията… (Enter изпраща, Shift+Enter — нов ред)"
          aria-label="Съобщение"
        />
        <button className="btn-primary" disabled={busy || !text.trim()} aria-label="Изпрати"><Send className="h-4 w-4" /></button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-loss">{error}</p>}
    </div>
  );
}
