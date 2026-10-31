'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { api } from '@/lib/client/api';
import { t } from '@/i18n/t';

export interface FormField {
  name: string;
  label: string;
  type: 'number' | 'text' | 'select' | 'checkbox';
  options?: { value: string; label: string }[];
  defaultValue?: string | number | boolean;
  min?: number;
  max?: number;
  step?: number;
}

/** 1.1.4.2: a small form that posts one game action (numbers sent as numbers). */
export function FormAction({ action, fields, submit, success, endpoint = '/api/game/action' }: { action: Record<string, unknown>; fields: FormField[]; submit: string; success?: string; endpoint?: string }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string | boolean>>(() => Object.fromEntries(fields.map((f) => [f.name, f.type === 'checkbox' ? !!f.defaultValue : String(f.defaultValue ?? f.options?.[0]?.value ?? '')])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const body: Record<string, unknown> = { ...action };
      for (const f of fields) {
        const v = values[f.name];
        body[f.name] = f.type === 'number' ? Number(v) : f.type === 'select' && /^\d+$/.test(String(v)) && f.options?.every((o) => /^\d+$/.test(o.value)) ? Number(v) : v;
      }
      await api(endpoint, body);
      setNote(success ?? t('Готово.'));
      startTransition(() => router.refresh());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={send} className="flex flex-wrap items-end gap-2 text-sm">
      {fields.map((f) => (
        <label key={f.name} className={f.type === 'checkbox' ? 'flex items-center gap-2 py-2 text-mist-300' : 'flex min-w-[8rem] flex-1 flex-col gap-1'}>
          {f.type !== 'checkbox' && <span className="label">{f.label}</span>}
          {f.type === 'select' ? (
            <select className="input text-sm" value={String(values[f.name])} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}>
              {f.options!.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === 'checkbox' ? (
            <>
              <input type="checkbox" className="h-4 w-4 accent-cyan-500" checked={!!values[f.name]} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))} />
              {f.label}
            </>
          ) : (
            <input className="input text-sm" type={f.type} min={f.min} max={f.max} step={f.step} value={String(values[f.name])} onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))} />
          )}
        </label>
      ))}
      <button type="submit" className="btn-primary px-3 py-2 text-sm" disabled={busy}>{busy ? '…' : submit}</button>
      {note && <span className="basis-full text-xs text-profit">{note}</span>}
      {error && <span role="alert" className="basis-full text-xs text-loss">{error}</span>}
    </form>
  );
}
