import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t as tr, tx } from '@/i18n/t';

export function PageHeader({ title, subtitle, help, actions }: { title: ReactNode; subtitle?: ReactNode; help?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 sm:mb-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-[28px]">{title}</h1>
          {subtitle && <p className="mt-1 max-w-3xl text-sm text-mist-400">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {help && (
        <details className="group mt-2 max-w-3xl text-sm">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium text-cyan-glow/90 hover:text-cyan-glow [&::-webkit-details-marker]:hidden">
            <span className="flex h-4 w-4 items-center justify-center rounded-full border border-cyan-glow/50 text-[10px] font-bold">?</span>
            <span className="group-open:hidden">{tr('Как работи?')}</span>
            <span className="hidden group-open:inline">{tr('Скрий')}</span>
          </summary>
          <div className="mt-2 rounded-xl border border-asphalt-700 bg-asphalt-900/70 p-3 text-mist-300">{help}</div>
        </details>
      )}
    </div>
  );
}

const TONES = {
  default: 'text-mist-100',
  gold: 'text-gold-400',
  profit: 'text-profit',
  loss: 'text-loss',
  cyan: 'text-cyan-glow',
  prestige: 'text-prestige',
} as const;

export function Stat({ label, value, hint, icon: Icon, tone = 'default' }: { label: string; value: ReactNode; hint?: ReactNode; icon?: LucideIcon; tone?: keyof typeof TONES }) {
  return (
    <div className="panel min-w-0 p-3 sm:p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="label truncate">{label}</span>
        {Icon && <Icon className={`h-4 w-4 ${TONES[tone]}`} />}
      </div>
      <div className={`num mt-1.5 truncate font-display text-xl font-bold sm:mt-2 sm:text-2xl ${TONES[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-mist-400">{hint}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', id }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`panel min-w-0 p-4 sm:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="font-display text-base font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const BADGE = {
  neutral: 'border-asphalt-600 bg-asphalt-800 text-mist-300',
  blue: 'border-volt-500/40 bg-volt-500/10 text-volt-400',
  cyan: 'border-cyan-glow/40 bg-cyan-glow/10 text-cyan-glow',
  gold: 'border-gold-400/40 bg-gold-400/10 text-gold-400',
  green: 'border-profit/40 bg-profit/10 text-profit',
  red: 'border-loss/40 bg-loss/10 text-loss',
  violet: 'border-prestige/40 bg-prestige/10 text-prestige',
  orange: 'border-amber-sig/40 bg-amber-sig/10 text-amber-sig',
} as const;
export type BadgeTone = keyof typeof BADGE;

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${BADGE[tone]}`}>{children}</span>;
}

export function Meter({ value, tone = 'auto', className = '' }: { value: number; tone?: 'auto' | 'cyan' | 'gold' | 'violet'; className?: string }) {
  const v = Math.max(0, Math.min(100, value));
  const color = tone === 'cyan' ? 'bg-cyan-glow' : tone === 'gold' ? 'bg-gold-400' : tone === 'violet' ? 'bg-prestige' : v < 35 ? 'bg-loss' : v < 65 ? 'bg-amber-sig' : 'bg-profit';
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-asphalt-700 ${className}`} role="meter" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Empty({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-asphalt-600 px-6 py-10 text-center">
      <Icon className="h-8 w-8 text-mist-400" />
      <p className="mt-3 font-semibold">{title}</p>
      {children && <div className="mt-1 max-w-md text-sm text-mist-400">{children}</div>}
    </div>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b border-asphalt-700 text-left">
            {head.map((h, i) => (
              <th key={i} className="label px-3 py-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-asphalt-800">{children}</tbody>
      </table>
    </div>
  );
}

/** In-page switch between views of the same data (e.g. leaderboard kinds); links keep it server-rendered. */
export function Segmented({ items, active, label }: { items: { id: string; label: ReactNode; href: string }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <div className="inline-flex min-w-max gap-1 rounded-full border border-asphalt-700 bg-asphalt-900/70 p-1">
        {items.map((t) => (
          <Link key={t.id} href={t.href} aria-current={t.id === active ? 'page' : undefined} className={`rounded-full px-3.5 py-1.5 text-sm font-medium whitespace-nowrap transition ${t.id === active ? 'bg-volt-500 text-white shadow-[0_6px_20px_-8px_rgba(47,123,255,0.8)]' : 'text-mist-400 hover:text-white'}`}>
            {tx(t.label)}
          </Link>
        ))}
      </div>
    </nav>
  );
}
