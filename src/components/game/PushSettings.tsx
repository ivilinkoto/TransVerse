'use client';

import { Bell, BellOff, Download, Send, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Registers the service worker on game pages (needed to install the app and receive notifications). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);
  return null;
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
}

/** Push notifications on this device: turn on/off, choose categories, test; plus "install the app". */
export function PushSettings({ publicKey, categories, prefs: initialPrefs, devices }: { publicKey: string; categories: Record<string, string>; prefs: Record<string, boolean | undefined>; devices: number }) {
  const [state, setState] = useState<'loading' | 'unsupported' | 'ios' | 'denied' | 'off' | 'on'>('loading');
  const [prefs, setPrefs] = useState(initialPrefs);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstall(e as InstallEvent);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    (async () => {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!supported()) return setState(ios && !standalone ? 'ios' : 'unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  const enable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setState(permission === 'denied' ? 'denied' : 'off');
        return;
      }
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      await api('/api/push/subscribe', sub.toJSON());
      setState('on');
      setMessage({ ok: true, text: 'Известията са включени на това устройство.' });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message || 'Неуспешно включване на известията.' });
    } finally {
      setBusy(false);
    }
  };

  const disable = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await api('/api/push/subscribe', { endpoint: sub.endpoint }, 'DELETE');
        await sub.unsubscribe();
      }
      setState('off');
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setMessage(null);
    try {
      const r = await api<{ sent: number }>('/api/push/test', {});
      setMessage(r.sent ? { ok: true, text: `Изпратено до ${r.sent} устройство(а).` } : { ok: false, text: 'Няма активно устройство — включи известията отново.' });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  };

  const toggle = async (key: string, value: boolean) => {
    setPrefs((p) => ({ ...p, [key]: value }));
    await api('/api/push/prefs', { [key]: value }).catch(() => setPrefs((p) => ({ ...p, [key]: !value })));
  };

  return (
    <div className="space-y-4 text-sm">
      {state === 'loading' && <p className="text-mist-400">Проверка на устройството…</p>}
      {state === 'unsupported' && <p className="text-mist-400">Този браузър не поддържа известия. Опитай с Chrome, Edge или Firefox, или инсталирай играта като приложение.</p>}
      {state === 'ios' && (
        <p className="rounded-lg border border-cyan-glow/30 bg-cyan-glow/5 p-3 text-mist-200">
          <Smartphone className="mr-1 inline h-4 w-4 text-cyan-glow" />На iPhone известията работят, когато играта е добавена на началния екран: в Safari натисни <span className="font-semibold">Сподели → Добави към началния екран</span>, отвори TransVerse оттам и включи известията тук.
        </p>
      )}
      {state === 'denied' && <p className="text-amber-sig">Известията са блокирани за този сайт. Разреши ги от настройките на браузъра (иконката с катинара до адреса) и опитай отново.</p>}
      {state === 'off' && (
        <button type="button" className="btn-primary" onClick={enable} disabled={busy}><Bell className="h-4 w-4" />{busy ? 'Включване…' : 'Включи известията на това устройство'}</button>
      )}
      {state === 'on' && (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 font-semibold text-profit"><Bell className="h-4 w-4" />Включени на това устройство</span>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={test}><Send className="h-3.5 w-3.5" />Изпрати пробно</button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={disable} disabled={busy}><BellOff className="h-3.5 w-3.5" />Изключи</button>
        </div>
      )}
      {message && <p role="status" className={message.ok ? 'text-profit' : 'text-loss'}>{message.text}</p>}
      {devices > 0 && <p className="text-xs text-mist-400">Устройства с включени известия: {devices}</p>}

      <fieldset className="space-y-1.5 border-t border-asphalt-800 pt-3">
        <legend className="label mb-1">Какво да получавам</legend>
        {Object.entries(categories).map(([key, label]) => (
          <label key={key} className="flex items-start gap-2">
            <input type="checkbox" className="mt-0.5" checked={prefs[key] !== false} onChange={(e) => void toggle(key, e.target.checked)} />
            <span>{label}</span>
          </label>
        ))}
        <p className="text-xs text-mist-400">Съобщения от чата не идват, докато си в играта — само когато я няма отворена.</p>
      </fieldset>

      {install && (
        <button type="button" className="btn-ghost" onClick={() => void install.prompt().then(() => setInstall(null))}><Download className="h-4 w-4" />Инсталирай TransVerse като приложение</button>
      )}
    </div>
  );
}
