import { ArrowRight, Building2, CalendarRange, Coins, Fuel, Globe2, Landmark, LineChart, MapPinned, Route, ShieldCheck, Trophy, Users, Warehouse } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { RouteShowcase } from '@/components/landing/RouteShowcase';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { CARGO } from '@/lib/game/cargo';
import { POWER_UNITS, TRAILERS } from '@/lib/game/catalog';
import { ECONOMY } from '@/lib/game/economy';
import { int, km, money } from '@/lib/format';
import { DEFAULT_SEASON_RULES } from '@/server/game/seasons';
import { countryNames, publicStats, showcaseRoutes } from '@/server/showcase';

export const dynamic = 'force-dynamic';

const FLEET_SHOWCASE: { modelId: string; trailerModelId?: string; color: string; caption: string }[] = [
  { modelId: 'sokol-courier', color: '#2f7bff', caption: 'Куриерски ван · до 1.3 т' },
  { modelId: 'hemus-r12-frigo', color: '#0891b2', caption: 'Соло хладилен камион · 6.5 т' },
  { modelId: 'danubia-t500-eco', trailerModelId: 'reefer-13', color: '#1d4ed8', caption: 'Влекач + хладилно ремарке · 22 т' },
  { modelId: 'danubia-t440', trailerModelId: 'tanker-32', color: '#b91c1c', caption: 'Влекач + цистерна · 25 т' },
  { modelId: 'danubia-t440', trailerModelId: 'container-40', color: '#e5e7eb', caption: 'Контейнеровоз 40′ · 26 т' },
  { modelId: 'rila-xt620', trailerModelId: 'lowbed-4', color: '#7c3aed', caption: 'Тежък влекач 6×4 + нискорамно · 40 т' },
];

export default async function HomePage() {
  const [stats, routes] = await Promise.all([publicStats().catch(() => null), showcaseRoutes().catch(() => [])]);
  const names = await countryNames([...new Set(routes.flatMap((r) => r.route?.countries ?? []))]).catch(() => new Map<string, string>());

  return (
    <div className="relative overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-asphalt-800/80 bg-asphalt-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-sm text-mist-300 md:flex" aria-label="Основна навигация">
            <a href="#map" className="hover:text-white">Картата</a>
            <a href="#fleet" className="hover:text-white">Автопарк</a>
            <a href="#economy" className="hover:text-white">Икономика</a>
            <a href="#seasons" className="hover:text-white">Сезони</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn-ghost">Вход</Link>
            <Link href="/register" className="btn-primary">Регистрация</Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="road-grid relative">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_70%_30%,rgba(47,123,255,0.22),transparent_70%),radial-gradient(40%_40%_at_10%_80%,rgba(246,195,67,0.10),transparent_70%)]" />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-10 pt-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div className="flex flex-col justify-center">
            <p className="label text-cyan-glow">Мултиплейър логистична стратегия · браузър</p>
            <h1 className="mt-4 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Пътищата са истински.
              <span className="block bg-gradient-to-r from-cyan-glow via-volt-400 to-gold-400 bg-clip-text text-transparent">Империята е твоя.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist-300">
              Изгради транспортна компания върху реалната карта на Европа. Поемай поръчки между реални градове, карай по истински пътни маршрути и се състезавай с други играчи в общ, постоянно развиващ се свят.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary px-6 py-3 text-base">
                Започни безплатно <ArrowRight className="h-4 w-4" />
              </Link>
              <Link href="/login" className="btn-ghost px-6 py-3 text-base">Имам акаунт</Link>
            </div>
            <dl className="mt-10 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: 'Реални градове', value: stats ? int(stats.cities) : '—' },
                { label: 'Държави', value: stats ? int(stats.countries) : '—' },
                { label: 'Отворени поръчки', value: stats ? int(stats.openContracts) : '—' },
                { label: 'Компании', value: stats ? int(stats.companies) : '—' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-asphalt-700 bg-asphalt-900/70 px-3 py-2.5">
                  <dt className="text-[11px] text-mist-400">{s.label}</dt>
                  <dd className="num font-display text-xl font-bold">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative flex items-end">
            <div className="absolute inset-x-0 bottom-6 h-24 rounded-[50%] bg-volt-500/20 blur-3xl" />
            <div className="relative w-full">
              <VehicleIllustration modelId="danubia-t500-eco" trailerModelId="curtain-13" color="#1d4ed8" className="w-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)]" />
              <div className="mx-auto mt-1 h-3 w-full rounded-full bg-gradient-to-r from-transparent via-asphalt-600 to-transparent" />
              <div className="mt-2 flex justify-between text-[11px] text-mist-400">
                <span>Danubia T500 Eco + завеса 13.6 м</span>
                <span className="num">16.5 м · 40 т · 500 к.с.</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Real map ─────────────────────────────────────────── */}
      <section id="map" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="label">Реалната география</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Истински градове. Истински пътища. Истински граници.</h2>
            <p className="mt-4 text-mist-300">
              Светът на TransVerse е реалният свят: държави с ISO кодове, {stats ? int(stats.cities) : 'хиляди'} града с координати от GeoNames, {stats ? int(stats.ports) : 'десетки'} пристанища. Маршрутите се изчисляват по пътната мрежа на OpenStreetMap с профил за тежкотоварни камиони, с пътни такси и гранични преходи.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {routes.map((r) => (
                <li key={`${r.from.id}-${r.to.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-asphalt-700 bg-asphalt-900/60 px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Route className="h-4 w-4 text-cyan-glow" />
                    {r.from.nameBg} → {r.to.nameBg}
                  </span>
                  <span className="num text-right text-mist-300">
                    {r.route ? (
                      <>
                        {km(r.route.distanceKm)}
                        <span className="ml-2 text-[11px] text-mist-400">
                          {r.route.provider === 'valhalla' ? `пътен маршрут · ${r.route.countries.map((c) => names.get(c) ?? c).join(' → ')}` : 'приблизителна оценка'}
                        </span>
                      </>
                    ) : (
                      <span className="text-[11px] text-mist-400">изчислява се при поръчка</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel relative min-h-[360px] overflow-hidden p-2">
            <RouteShowcase routes={routes} />
            <p className="absolute bottom-3 right-4 text-[10px] text-mist-400">Геометрия: OpenStreetMap / Valhalla · Градове: GeoNames</p>
          </div>
        </div>
      </section>

      {/* ── Fleet ────────────────────────────────────────────── */}
      <section id="fleet" className="scroll-mt-20 border-y border-asphalt-800 bg-asphalt-900/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="label">Автопарк</p>
              <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">От куриерски ван до тежкотоварен 6×4</h2>
              <p className="mt-4 max-w-2xl text-mist-300">
                {POWER_UNITS.length} модела превозни средства и {TRAILERS.length} вида ремаркета. Всеки товар изисква подходяща надстройка, а всяка комбинация има собствен капацитет, разход и поддръжка.
              </p>
            </div>
            <Link href="/register" className="btn-ghost">Купи първия си камион <ArrowRight className="h-4 w-4" /></Link>
          </div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FLEET_SHOWCASE.map((v) => (
              <figure key={`${v.modelId}-${v.trailerModelId}`} className="panel group overflow-hidden p-4 transition hover:border-volt-500/50">
                <div className="flex h-36 items-end rounded-xl bg-[linear-gradient(180deg,transparent_70%,rgba(255,255,255,0.04))] px-2">
                  <VehicleIllustration modelId={v.modelId} trailerModelId={v.trailerModelId} color={v.color} className="max-h-32 w-full transition group-hover:-translate-y-0.5" />
                </div>
                <figcaption className="mt-3 flex items-center justify-between text-sm">
                  <span className="font-semibold">{POWER_UNITS.find((p) => p.id === v.modelId)!.name}</span>
                  <span className="text-mist-400">{v.caption}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ── Economy ──────────────────────────────────────────── */}
      <section id="economy" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <p className="label">Икономика</p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">Всяко решение има цена. Всеки километър се отчита.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: LineChart, title: 'Жив пазар', text: 'Доставките намаляват търсенето в града дестинация за всички играчи. Пазарът се възстановява с времето, а сезоните и събитията движат цените.' },
            { icon: Fuel, title: 'Реални разходи', text: `Гориво по ${(ECONOMY.fuelPriceCentsPerLitre / 100).toFixed(2)} €/л според товара и състоянието, пътни такси, поддръжка на километър, заплати всеки ден.` },
            { icon: Landmark, title: 'Прозрачно счетоводство', text: 'Всяка операция е запис в счетоводната книга с баланс след нея. Сървърът изчислява наградите, а не браузърът.' },
            { icon: Warehouse, title: 'Логистична мрежа', text: `Открий депа в нови градове (${money(ECONOMY.depotPriceCents)}), разширявай капацитета и стигай по-далеч.` },
          ].map((c) => (
            <div key={c.title} className="panel p-5">
              <c.icon className="h-6 w-6 text-gold-400" />
              <h3 className="mt-4 font-display text-base font-bold">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-300">{c.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Object.values(CARGO).map((c) => (
            <div key={c.id} className="rounded-xl border border-asphalt-700 bg-asphalt-900/60 px-3 py-2.5 text-sm">
              <div className="font-semibold">{c.label}</div>
              <div className="text-[11px] text-mist-400">от ниво {c.minLevel}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Multiplayer & seasons ────────────────────────────── */}
      <section id="seasons" className="scroll-mt-20 border-t border-asphalt-800">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-20 sm:grid-cols-2 sm:px-6 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-3 lg:max-w-3xl">
            <p className="label">Мултиплейър</p>
            <h2 className="mt-3 font-display text-3xl font-bold">Един свят. Общ пазар. Сезонни класации.</h2>
            <p className="mt-4 text-mist-300">Всички играчи споделят един и същ товарен пазар. Поръчката, която вземеш ти, никой друг не може да изпълни. Светът продължава да работи и когато не си онлайн.</p>
          </div>
          {[
            { icon: Globe2, color: 'text-cyan-glow', title: 'Постоянен свят', text: 'Времето за курс зависи от разстоянието — от около 15 минути до няколко часа за най-дългите маршрути и се изпълняват на сървъра. Камионите ти пристигат и докато не си в играта.' },
            { icon: Trophy, color: 'text-gold-400', title: `Сезони от ${DEFAULT_SEASON_RULES.lengthDays} дни`, text: `Сезонни точки, класации и награден фонд до ${money(DEFAULT_SEASON_RULES.prizesCents[0]!)} за първото място. Компанията и активите ти остават.` },
            { icon: ShieldCheck, color: 'text-profit', title: 'Честна игра', text: 'Цените, наградите и балансът се изчисляват само от сървъра. Без купуване на предимство в класациите.' },
            { icon: Users, color: 'text-prestige', title: 'Компании и шофьори', text: 'Наемай шофьори с различни умения. Те растат с опита и искат по-висока заплата.' },
            { icon: CalendarRange, color: 'text-amber-sig', title: 'Сезонност', text: 'Жътва, туристически сезон, отоплителен сезон: търсенето следва календара.' },
            { icon: Building2, color: 'text-volt-400', title: 'Растеж', text: 'От ван в София до мрежа от депа между Мюнхен и Истанбул.' },
          ].map((c) => (
            <div key={c.title} className="panel p-5">
              <c.icon className={`h-6 w-6 ${c.color}`} />
              <h3 className="mt-4 font-display text-base font-bold">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-300">{c.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6">
        <div className="panel relative overflow-hidden p-8 sm:p-12">
          <div className="pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full bg-volt-500/20 blur-3xl" />
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div>
              <h2 className="font-display text-2xl font-bold sm:text-3xl">Първият курс е на една регистрация разстояние.</h2>
              <p className="mt-2 text-mist-300">Започваш като самостоятелен шофьор с нает камион в избран от теб български град. После основаваш своя компания.</p>
            </div>
            <Link href="/register" className="btn-gold px-6 py-3 text-base">
              <Coins className="h-4 w-4" /> Започни като шофьор
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-asphalt-800 bg-asphalt-950">
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-12 text-sm text-mist-400 sm:px-6 md:grid-cols-[1.2fr_1fr_1fr]">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm">Браузърна мултиплейър транспортна и икономическа симулация върху реалната география на света.</p>
          </div>
          <div>
            <p className="label">Играта</p>
            <ul className="mt-3 space-y-2">
              <li><Link href="/register" className="hover:text-white">Регистрация</Link></li>
              <li><Link href="/login" className="hover:text-white">Вход</Link></li>
              <li><a href="#map" className="hover:text-white"><MapPinned className="mr-1 inline h-3.5 w-3.5" />Картата</a></li>
              <li><Link href="/terms" className="hover:text-white">Общи условия</Link></li>
              <li><Link href="/privacy" className="hover:text-white">Поверителност</Link></li>
            </ul>
          </div>
          <div>
            <p className="label">Данни и лицензи</p>
            <ul className="mt-3 space-y-2">
              <li>Градове: <a className="underline hover:text-white" href="https://www.geonames.org" rel="noreferrer" target="_blank">GeoNames</a> (CC BY 4.0)</li>
              <li>Карти: © <a className="underline hover:text-white" href="https://www.openstreetmap.org/copyright" rel="noreferrer" target="_blank">OpenStreetMap</a>, OpenFreeMap, OpenMapTiles</li>
              <li>Маршрути: Valhalla върху данни на OpenStreetMap</li>
              <li>Икономиката, компаниите и събитията в играта са симулирани.</li>
            </ul>
          </div>
        </div>
        <div className="border-t border-asphalt-800 py-4 text-center text-xs text-mist-400">© {new Date().getFullYear()} TransVerse. Всички права запазени.</div>
      </footer>
    </div>
  );
}
