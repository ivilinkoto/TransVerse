import { Medal } from 'lucide-react';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import type { showcaseOf } from '@/server/game/community';
import { tx } from '@/i18n/t';

/** The trucks and badges a player shows on their profile (v1.5). */
export function ProfileShowcase({ showcase }: { showcase: Awaited<ReturnType<typeof showcaseOf>> }) {
  if (!showcase.trucks.length && !showcase.badges.length) return null;
  return (
    <div className="space-y-4">
      {showcase.trucks.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {showcase.trucks.map((t) => (
            <figure key={t.id} className="rounded-xl bg-gradient-to-b from-sky-900/30 to-asphalt-900 p-2">
              <VehicleIllustration {...t.truck} className="h-auto w-full" title={tx(t.name)} />
              <figcaption className="mt-1 truncate text-center text-xs text-mist-300">{tx(t.name)} · <span className="num">{tx(t.plate)}</span></figcaption>
            </figure>
          ))}
        </div>
      )}
      {showcase.badges.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {showcase.badges.map((b) => (
            <li key={b.id} title={tx(b.description)} className="inline-flex items-center gap-1.5 rounded-full border border-gold-400/40 bg-gold-400/10 px-3 py-1 text-xs text-gold-400"><Medal className="h-3.5 w-3.5" />{tx(b.label)}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
