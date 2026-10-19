import { Bell, Coins, Gauge, LayoutDashboard, Map as MapIcon, Package, Truck, Users, Wallet } from 'lucide-react';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';

/**
 * A drawn picture of the game's dashboard for the public page (not a
 * screenshot: it does not go stale when the UI changes). Example numbers.
 */
export function GameMockup({ livery }: { livery?: 'pumpkin' | 'christmas' }) {
  const nav = [
    { icon: LayoutDashboard, label: 'Табло', on: true },
    { icon: Package, label: 'Поръчки' },
    { icon: Truck, label: 'Автопарк' },
    { icon: Users, label: 'Шофьори' },
    { icon: MapIcon, label: 'Карта' },
    { icon: Wallet, label: 'Финанси' },
  ];
  return (
    <figure className="relative" aria-label="Илюстрация на таблото в играта">
      <div className="overflow-hidden rounded-2xl border border-asphalt-700 bg-asphalt-950 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
        {/* window bar */}
        <div className="flex items-center gap-2 border-b border-asphalt-800 bg-asphalt-900/80 px-3 py-2">
          <span className="h-2.5 w-2.5 rounded-full bg-loss/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-sig/70" />
          <span className="h-2.5 w-2.5 rounded-full bg-profit/70" />
          <span className="ml-3 truncate rounded-md bg-asphalt-950 px-3 py-0.5 text-[10px] text-mist-400">transverse-bg.com/game</span>
        </div>
        <div className="grid grid-cols-[auto_1fr]">
          <nav className="hidden w-32 space-y-1 border-r border-asphalt-800 p-2 sm:block" aria-hidden="true">
            {nav.map((n) => (
              <div key={n.label} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[11px] ${n.on ? 'bg-volt-500/15 text-white' : 'text-mist-400'}`}>
                <n.icon className="h-3.5 w-3.5" /> {n.label}
              </div>
            ))}
          </nav>
          <div className="min-w-0 space-y-3 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[10px] text-mist-400">Добро утро,</div>
                <div className="font-display text-sm font-bold">Балкан Карго ООД</div>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <span className="num rounded-lg border border-asphalt-700 px-2 py-1 text-profit">48 320 лв.</span>
                <span className="num flex items-center gap-1 rounded-lg border border-asphalt-700 px-2 py-1 text-gold-400"><Coins className="h-3 w-3" />240</span>
                <span className="rounded-lg border border-asphalt-700 p-1 text-mist-300"><Bell className="h-3 w-3" /></span>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-[1.25fr_1fr]">
              {/* map with a route */}
              <div className="relative h-36 overflow-hidden rounded-xl border border-asphalt-800 bg-[#0b1220]">
                <svg viewBox="0 0 300 150" className="absolute inset-0 h-full w-full" aria-hidden="true">
                  <path d="M0 40 Q60 30 90 55 T170 70 T300 50" stroke="#1b2636" strokeWidth="10" fill="none" />
                  <path d="M20 140 Q80 100 140 110 T300 120" stroke="#1b2636" strokeWidth="8" fill="none" />
                  <path d="M60 120 C100 90 130 80 170 72 S240 40 270 30" stroke="#22d3ee" strokeWidth="2.5" fill="none" strokeDasharray="5 4" className="route-anim" />
                  <circle cx="60" cy="120" r="4" fill="#f6c343" />
                  <circle cx="270" cy="30" r="4" fill="#2f7bff" />
                  <circle cx="160" cy="75" r="5" fill="#22d3ee" stroke="#05070b" strokeWidth="2" />
                </svg>
                <span className="absolute bottom-2 left-2 rounded bg-asphalt-950/80 px-1.5 py-0.5 text-[10px]">София</span>
                <span className="absolute right-2 top-2 rounded bg-asphalt-950/80 px-1.5 py-0.5 text-[10px]">Виена</span>
              </div>
              {/* trip in progress */}
              <div className="rounded-xl border border-asphalt-800 bg-asphalt-900/60 p-2.5">
                <div className="flex items-center justify-between text-[10px] text-mist-400"><span>На път · СВ 4821 КТ</span><span className="text-cyan-glow">навреме</span></div>
                <VehicleIllustration modelId="danubia-t440" trailerModelId="reefer-13" color="#0f766e" livery={livery} className="mt-1 h-12 w-full" />
                <div className="mt-1 text-[11px] font-semibold">Плодове и зеленчуци · 21 т</div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full w-[58%] rounded-full bg-gradient-to-r from-cyan-glow to-volt-500" /></div>
                <div className="num mt-1 flex justify-between text-[10px] text-mist-400"><span>612 / 1 054 км</span><span>+3 860 лв.</span></div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Днес', value: '+6 140 лв.', tone: 'text-profit' },
                { label: 'Камиони на път', value: '4 / 5', tone: '' },
                { label: 'Ниво', value: '12 · 64%', tone: 'text-prestige' },
              ].map((k) => (
                <div key={k.label} className="rounded-lg border border-asphalt-800 bg-asphalt-900/50 px-2.5 py-1.5">
                  <div className="text-[10px] text-mist-400">{k.label}</div>
                  <div className={`num text-sm font-bold ${k.tone}`}>{k.value}</div>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {[
                { lane: 'Пловдив → Солун', goods: 'Мрамор', t: '24 т', pay: '2 310 лв.' },
                livery ? { lane: 'Русе → Букурещ', goods: livery === 'christmas' ? 'Коледни подаръци' : 'Тикви за празника', t: '9 т', pay: '640 лв.' } : { lane: 'Русе → Букурещ', goods: 'Мебели', t: '9 т', pay: '590 лв.' },
              ].map((c) => (
                <div key={c.lane} className="flex items-center justify-between gap-2 rounded-lg border border-asphalt-800 px-2.5 py-1.5 text-[11px]">
                  <span className="flex min-w-0 items-center gap-1.5 truncate"><Gauge className="h-3 w-3 shrink-0 text-gold-400" /> {c.lane} <span className="text-mist-400">· {c.goods} · {c.t}</span></span>
                  <span className="num shrink-0 font-semibold text-profit">{c.pay}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-right text-[10px] text-mist-400">Илюстрация на таблото · примерни данни</figcaption>
    </figure>
  );
}
