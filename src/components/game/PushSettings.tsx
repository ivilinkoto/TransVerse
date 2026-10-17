'use client';

import { Bell, BellOff, Download, Send, Smartphone, Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { playChime, setSoundEnabled, soundEnabled, unlockSound } from '@/lib/client/sound';

const supported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** The browser's install offer, kept from the moment it fires (it may come before any banner mounts). */
type InstallPromptEvent = Event & { prompt: () => Promise<void> };
declare global {
  interface Window {
    __tvInstall?: InstallPromptEvent | null;
  }
}

/** Registers the service worker on game pages (needed to install the app and receive notifications). */
export function RegisterServiceWorker() {
  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    const keep = (e: Event) => {
      e.preventDefault();
      window.__tvInstall = e as InstallPromptEvent;
      window.dispatchEvent(new Event('tv:installable'));
    };
    const installed = () => {
      window.__tvInstall = null;
      window.dispatchEvent(new Event('tv:installable'));
    };
    window.addEventListener('beforeinstallprompt', keep);
    window.addEventListener('appinstalled', installed);
    return () => {
      window.removeEventListener('beforeinstallprompt', keep);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);
  return null;
}

const DISMISS_KEY = 'tv-install-dismissed';
const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

/** Banner for players in a normal browser tab: "we have an app" with an install button (or iPhone steps). */
export function InstallAppBanner() {
  const [mode, setMode] = useState<'hidden' | 'prompt' | 'ios'>('hidden');
  useEffect(() => {
    const decide = () => {
      if (isStandalone()) return setMode('hidden');
      try {
        const until = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
        if (until > Date.now()) return setMode('hidden');
      } catch {
        /* storage blocked — show anyway */
      }
      if (window.__tvInstall) return setMode('prompt');
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) && /Safari/.test(navigator.userAgent) && !/CriOS|FxiOS/.test(navigator.userAgent);
      setMode(ios ? 'ios' : 'hidden');
    };
    void Promise.resolve().then(decide);
    window.addEventListener('tv:installable', decide);
    return () => window.removeEventListener('tv:installable', decide);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now() + 14 * 86_400_000));
    } catch {
      /* ignore */
    }
    setMode('hidden');
  };
  const install = async () => {
    const e = window.__tvInstall;
    if (!e) return;
    await e.prompt().catch(() => undefined);
    window.__tvInstall = null;
    setMode('hidden');
  };

  if (mode === 'hidden') return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-cyan-glow/30 bg-cyan-glow/10 px-4 py-2 text-sm sm:px-6" role="region" aria-label="Приложение TransVerse">
      <Smartphone className="h-4 w-4 shrink-0 text-cyan-glow" />
      {mode === 'prompt' ? (
        <>
          <span className="flex-1">TransVerse има приложение — по-бързо стартиране, цял екран и известия, когато камионът пристигне.</span>
          <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={() => void install()}><Download className="h-4 w-4" />Изтегли приложението</button>
        </>
      ) : (
        <span className="flex-1">Инсталирай TransVerse на iPhone: натисни <span className="font-semibold">Сподели</span> (квадратчето със стрелка) → <span className="font-semibold">Добави към началния екран</span>. Така ще получаваш и известия.</span>
      )}
      <button type="button" className="text-mist-400 hover:text-white" onClick={dismiss} aria-label="Скрий">✕</button>
    </div>
  );
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
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const onPrompt = () => setInstall(window.__tvInstall ?? null);
    window.addEventListener('tv:installable', onPrompt);
    (async () => {
      onPrompt();
      setSound(soundEnabled());
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
      if (!supported()) return setState(ios && !standalone ? 'ios' : 'unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = await reg?.pushManager.getSubscription();
      setState(sub && Notification.permission === 'granted' ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
    return () => window.removeEventListener('tv:installable', onPrompt);
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

      <fieldset className="space-y-1.5 border-t border-asphalt-800 pt-3">
        <legend className="label mb-1">Звук</legend>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={sound}
            onChange={(e) => {
              setSound(e.target.checked);
              setSoundEnabled(e.target.checked);
              if (e.target.checked) {
                unlockSound();
                setTimeout(playChime, 50);
              }
            }}
          />
          <span>Кратък звук при ново известие, докато играта е отворена (на това устройство)</span>
        </label>
        <button type="button" className="btn-ghost px-3 py-1 text-xs" onClick={() => { unlockSound(); setTimeout(playChime, 50); }}><Volume2 className="h-3.5 w-3.5" />Чуй звука</button>
        <p className="text-xs text-mist-400">Когато играта е затворена, известието идва със звука и вибрацията на телефона (настройват се от известията на телефона за TransVerse).</p>
      </fieldset>

      {install && (
        <button type="button" className="btn-ghost" onClick={() => void install.prompt().then(() => { window.__tvInstall = null; setInstall(null); })}><Download className="h-4 w-4" />Инсталирай TransVerse като приложение</button>
      )}
    </div>
  );
}
