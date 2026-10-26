import { ShieldCheck } from 'lucide-react';
import { dateTime } from '@/lib/format';
import { ROLE_LABELS, type Role } from '@/server/auth/roles';
import { t, tx } from '@/i18n/t';

export function Thread({ messages }: { messages: { id: number; body: string; staff: boolean; createdAt: Date; author: string; authorRole: string }[] }) {
  return (
    <ol className="space-y-3">
      {messages.map((m) => (
        <li key={m.id} className={`max-w-3xl rounded-2xl border p-4 ${m.staff ? 'ml-auto border-prestige/40 bg-prestige/5' : 'border-asphalt-700 bg-asphalt-850'}`}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-semibold">
              {m.staff && <ShieldCheck className="h-3.5 w-3.5 text-prestige" />}
              {tx(m.author)}
              {m.staff && <span className="font-normal text-prestige">· {tx(ROLE_LABELS[m.authorRole as Role] ?? t('Поддръжка'))}</span>}
            </span>
            <time className="text-mist-400">{dateTime(m.createdAt)}</time>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm text-mist-100">{tx(m.body)}</p>
        </li>
      ))}
    </ol>
  );
}
