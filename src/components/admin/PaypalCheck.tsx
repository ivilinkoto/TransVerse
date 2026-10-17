'use client';

import { Loader2, PlugZap } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client/api';

/** Asks the server to log in to PayPal with the configured keys and explains the result. */
export function PaypalCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      setResult(await api<{ ok: boolean; message: string }>('/api/admin/action', { type: 'checkPaypal' }));
    } catch (e) {
      setResult({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}Провери връзката с PayPal
      </button>
      {result && <p role="status" className={`mt-2 text-sm ${result.ok ? 'text-profit' : 'text-loss'}`}>{result.message}</p>}
    </div>
  );
}
