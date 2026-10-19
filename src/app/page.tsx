import { ArrowRight, Bell, BellOff, CalendarRange, Coins, Download, Gavel, Globe2, MapPinned, MessagesSquare, Route, ScrollText, ShieldCheck, Smartphone, Sparkles, Ticket, Trophy, Truck, UserPlus, Users } from 'lucide-react';
import Link from 'next/link';
import { Logo } from '@/components/brand/Logo';
import { ReleaseBody, ReleaseTitle } from '@/components/game/ReleaseNotes';
import { FeatureTour } from '@/components/landing/FeatureTour';
import { GameMockup } from '@/components/landing/GameMockup';
import { RouteShowcase } from '@/components/landing/RouteShowcase';
import { tourTabs } from '@/components/landing/tour';
import { duration, int, km, money } from '@/lib/format';
import { ECONOMY } from '@/lib/game/economy';
import { LEAGUE_GROUP_SIZE, LEAGUE_TIERS } from '@/lib/game/leagues';
import { REFERRAL } from '@/lib/game/referrals';
import { visibleReleases } from '@/lib/game/releases';
import { gameDurationMinutes } from '@/lib/game/schedule';
import { VIP_PERKS } from '@/lib/game/vip';
import { DEFAULT_SEASON_RULES } from '@/server/game/seasons';
import { requestSeason } from '@/server/seasonal';
import { requestNow } from '@/server/site';
import { countryNames, liveWorld, publicStats, showcaseRoutes, type LiveWorld } from '@/server/showcase';

export const dynamic = 'force-dynamic';

const left = (until: Date, now: Date) => {
  const min = Math.max(0, Math.round((until.getTime() - now.getTime()) / 60_000));
  if (min >= 2 * 1440) return `${Math.floor(min / 1440)} дни`;
  return duration(min);
};

export default async function HomePage() {
  const [stats, routes, world, season] = await Promise.all([
    publicStats().catch(() => null),
    showcaseRoutes().catch(() => []),
    liveWorld().catch(() => null),
    requestSeason(),
  ]);
  const names = await countryNames([...new Set(routes.flatMap((r) => r.route?.countries ?? []))]).catch(() => new Map<string, string>());
  const now = world?.now ?? requestNow();
  const latest = world ? visibleReleases(now)[0] : undefined;
  const livery = season === 'halloween' ? 'pumpkin' : season === 'christmas' ? 'christmas' : undefined;

  return (
    <div className="relative overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-asphalt-800/80 bg-asphalt-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-6 text-sm text-mist-300 lg:flex" aria-label="Основна навигация">
            <a href="#how" className="hover:text-white">Как се играе</a>
            <a href="#tour" className="hover:text-white">Играта</a>
            <a href="#live" className="hover:text-white">Светът сега</a>
            <a href="#together" className="hover:text-white">Заедно</a>
            <a href="#faq" className="hover:text-white">Въпроси</a>
            <Link href="/updates" className="hover:text-white">Обновления</Link>
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
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:items-center lg:pt-16">
          <div>
            {latest ? (
              <Link href="/updates" className="inline-flex items-center gap-2 rounded-full border border-cyan-glow/40 bg-cyan-glow/10 px-3 py-1 text-xs text-cyan-glow hover:bg-cyan-glow/15">
                <Sparkles className="h-3.5 w-3.5" /> Ново: версия {latest.version} „{latest.name}“ <ArrowRight className="h-3 w-3" />
              </Link>
            ) : (
              <p className="label text-cyan-glow">Мултиплейър логистична стратегия · браузър</p>
            )}
            <h1 className="mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl">
              Пътищата са истински.
              <span className="block bg-gradient-to-r from-cyan-glow via-volt-400 to-gold-400 bg-clip-text text-transparent">Империята е твоя.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-mist-300">
              Безплатна мултиплейър стратегия в браузъра. Започваш като шофьор с нает камион, караш товари по реални пътища между {stats ? int(stats.cities) : 'хиляди'} града и изграждаш транспортна компания в общ свят с други играчи — на компютър или телефон.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn-primary px-6 py-3 text-base">
                Започни безплатно <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how" className="btn-ghost px-6 py-3 text-base">Как се играе</a>
            </div>
            <dl className="mt-10 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                world && world.online > 0 ? { label: 'Онлайн сега', value: int(world.online), dot: true } : { label: 'Отворени поръчки', value: stats ? int(stats.openContracts) : '—' },
                { label: 'Шофьори', value: world ? int(world.players) : '—' },
                { label: 'Доставки днес', value: world ? int(world.deliveriesToday) : '—' },
                { label: 'Км за седмицата', value: world ? int(world.kmWeek) : '—' },
              ].map((s) => (
                <div key={s.label} className="rounded-xl border border-asphalt-700 bg-asphalt-900/70 px-3 py-2.5">
                  <dt className="flex items-center gap-1.5 text-[11px] text-mist-400">{s.dot && <span className="h-1.5 w-1.5 rounded-full bg-profit shadow-[0_0_6px] shadow-profit" />}{s.label}</dt>
                  <dd className="num font-display text-xl font-bold">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <GameMockup livery={livery} />
        </div>
      </section>

      {/* ── How to play ──────────────────────────────────────── */}
      <section id="how" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <p className="label">Как се играе</p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">От първия курс до своя компания</h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[
            { icon: UserPlus, title: 'Регистрирай се', text: `Избираш български град за начало. Получаваш ${money(ECONOMY.startingBalanceCents)} и нает камион — без покупка, плащаш наем от всеки курс.` },
            { icon: Route, title: 'Вземи първата поръчка', text: 'От борсата избираш товар, който камионът ти може да превози. Маршрутът е по истинските пътища, с такси и граници. Обучението те води стъпка по стъпка.' },
            { icon: Truck, title: 'Камионът тръгва', text: `Курсът трае от ${gameDurationMinutes(0)} минути за кратко разстояние до около ${duration(gameDurationMinutes(2000))} за 2 000 км. Можеш да затвориш играта — камионът пристига и без теб.` },
            { icon: Trophy, title: 'Расти', text: `От ниво ${ECONOMY.foundingMinLevel} основаваш компания: купуваш камиони, наемаш шофьори, откриваш депа и се състезаваш в класациите.` },
          ].map((s, i) => (
            <li key={s.title} className="panel relative p-5">
              <span className="num absolute right-4 top-4 font-display text-4xl font-extrabold text-asphalt-700">{i + 1}</span>
              <s.icon className="h-6 w-6 text-cyan-glow" />
              <h3 className="mt-4 font-display text-base font-bold">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-300">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ── Feature tour ─────────────────────────────────────── */}
      <section id="tour" className="scroll-mt-20 border-y border-asphalt-800 bg-asphalt-900/40">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
          <p className="label">Играта</p>
          <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">Всяко решение има цена. Всеки километър се отчита.</h2>
          <p className="mt-4 max-w-2xl text-mist-300">Разгледай основните системи. Картинките са илюстрации с примерни данни.</p>
          <FeatureTour tabs={tourTabs(livery)} />
        </div>
      </section>

      {/* ── Real map ─────────────────────────────────────────── */}
      <section id="map" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div>
            <p className="label">Реалната география</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Истински градове. Истински пътища. Истински граници.</h2>
            <p className="mt-4 text-mist-300">
              {stats ? int(stats.countries) : 'Няколко'} държави, {stats ? int(stats.cities) : 'хиляди'} града с координати от GeoNames и {stats ? int(stats.ports) : 'десетки'} пристанища. Маршрутите се изчисляват по пътната мрежа на OpenStreetMap с профил за тежкотоварни камиони, с пътни такси, гранични преходи и цена на горивото във всяка държава.
            </p>
            <ul className="mt-6 space-y-3 text-sm">
              {routes.map((r) => (
                <li key={`${r.from.id}-${r.to.id}`} className="flex items-center justify-between gap-3 rounded-xl border border-asphalt-700 bg-asphalt-900/60 px-4 py-3">
                  <span className="flex items-center gap-2">
                    <Route className="h-4 w-4 shrink-0 text-cyan-glow" />
                    {r.from.nameBg} → {r.to.nameBg}
                  </span>
                  <span className="num text-right text-mist-300">
                    {r.route ? (
                      <>
                        {km(r.route.distanceKm)}
                        <span className="ml-2 hidden text-[11px] text-mist-400 sm:inline">
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

      {/* ── Live world ───────────────────────────────────────── */}
      {world && <LiveSection world={world} />}

      {/* ── Together ─────────────────────────────────────────── */}
      <section id="together" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <p className="label">Заедно</p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-bold sm:text-4xl">Един свят. Общ пазар. Истински съперници.</h2>
        <p className="mt-4 max-w-2xl text-mist-300">Всички играчи споделят един и същ товарен пазар, а светът продължава да работи и когато не си онлайн.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[
            { icon: Users, color: 'text-volt-400', title: 'Компании', text: 'Основи компания или се присъедини към чужда: обща каса, фирмени мисии и търгове, депа в различни държави и класация на компаниите.' },
            { icon: MessagesSquare, color: 'text-cyan-glow', title: 'Чат и приятели', text: 'Глобален чат, чат на компанията, канал за търговия и лични съобщения. Добавяй приятели и виж кой е онлайн.' },
            { icon: Trophy, color: 'text-gold-400', title: `Сезони от ${DEFAULT_SEASON_RULES.lengthDays} дни`, text: `Сезонни точки и награден фонд до ${money(DEFAULT_SEASON_RULES.prizesCents[0]!)} за първото място. Компанията и активите ти остават.` },
            { icon: CalendarRange, color: 'text-prestige', title: 'Седмични лиги', text: `Всяка седмица — група до ${LEAGUE_GROUP_SIZE} играчи в твоята лига. Най-добрите се качват, последните слизат: ${LEAGUE_TIERS.map((t) => t.name).join(' → ')}.` },
            { icon: Ticket, color: 'text-amber-sig', title: 'Ивенти и сезонен пропуск', text: 'Общи цели за всички играчи с награди за участие, празнични ивенти, мисии всеки ден и сезонен пропуск с награди по нива.' },
            { icon: UserPlus, color: 'text-profit', title: 'Покани приятел', text: `Изпрати личния си линк: след първите ${REFERRAL.deliveriesNeeded} доставки приятелят ти получава ${money(REFERRAL.inviteeCents)}, а ти — ${money(REFERRAL.inviterCents)} и ${REFERRAL.inviterCoins} TC.` },
          ].map((c) => (
            <div key={c.title} className="panel p-5">
              <c.icon className={`h-6 w-6 ${c.color}`} />
              <h3 className="mt-4 font-display text-base font-bold">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-mist-300">{c.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Latest update ────────────────────────────────────── */}
      {latest && (
        <section id="updates" className="scroll-mt-20 border-y border-asphalt-800 bg-asphalt-900/40">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="label">Последно обновление</p>
                <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Играта непрекъснато расте</h2>
              </div>
              <Link href="/updates" className="btn-ghost"><ScrollText className="h-4 w-4" /> Всички обновления</Link>
            </div>
            <div className="panel mt-8 p-5 sm:p-7">
              <ReleaseTitle release={latest} as="h3" />
              <div className="mt-5"><ReleaseBody release={{ ...latest, highlights: latest.highlights.slice(0, 4), sections: [] }} /></div>
              <Link href={`/updates#v${latest.version}`} className="mt-5 inline-flex items-center gap-1.5 text-sm text-cyan-glow hover:underline">Пълното описание <ArrowRight className="h-3.5 w-3.5" /></Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Phone ────────────────────────────────────────────── */}
      <section id="phone" className="mx-auto max-w-7xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
          <div>
            <p className="label">На телефона</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Компанията ти е в джоба ти</h2>
            <p className="mt-4 max-w-xl text-mist-300">TransVerse работи в браузъра на всяко устройство — без изтегляне от магазин. Можеш да го добавиш на началния екран като приложение и да получаваш известия.</p>
            <ul className="mt-6 grid gap-3 sm:grid-cols-2">
              {[
                { icon: Download, title: 'Инсталирай като приложение', text: 'От менюто на браузъра — „Добави към началния екран“.' },
                { icon: Bell, title: 'Известия', text: 'Камионът пристигна, нова поръчка по любима линия, съобщение от приятел.' },
                { icon: BellOff, title: 'Тихи часове', text: 'Избираш кога телефонът да мълчи и кои известия искаш.' },
                { icon: Smartphone, title: 'Пълна игра', text: 'Борса, автопарк, карта и чат — всичко е пригодено за малък екран.' },
              ].map((f) => (
                <li key={f.title} className="flex gap-3 rounded-xl border border-asphalt-700 bg-asphalt-900/60 p-3.5">
                  <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-cyan-glow" />
                  <span><span className="block text-sm font-semibold">{f.title}</span><span className="mt-0.5 block text-sm text-mist-300">{f.text}</span></span>
                </li>
              ))}
            </ul>
          </div>
          <PhoneMockup />
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────────── */}
      <section id="faq" className="scroll-mt-20 border-t border-asphalt-800">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <p className="label">Въпроси и отговори</p>
          <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Често питат</h2>
          <div className="mt-8 space-y-3">
            {[
              { q: 'Безплатна ли е играта?', a: 'Да. Цялата игра е безплатна. ТрансКоин (TC) и VIP може да се купят, но TC се печелят и в играта — от мисии, ивенти, дневната награда, търговете и поканите.' },
              { q: 'Какво дава VIP?', a: `Удобства и престиж: +${Math.round((VIP_PERKS.xpMultiplier - 1) * 100)}% опит, по-нисък наем, отстъпка в сервиза, допълнителни мисии, ранен достъп до спешните поръчки, златно име и ексклузивни цветове. VIP никога не дава сезонни точки и не вдига мястото в класациите.` },
              { q: 'Трябва ли да съм онлайн, докато камионът кара?', a: `Не. Курсовете се изпълняват на сървъра — от ${gameDurationMinutes(0)} минути за кратък курс до около ${duration(gameDurationMinutes(2000))} за 2 000 км. Камионът пристига и парите влизат, дори ако играта е затворена.` },
              { q: 'Мога ли да играя на телефон?', a: 'Да. Играта работи в браузъра на телефона и може да се инсталира като приложение с известия.' },
              { q: 'Истински ли са градовете и пътищата?', a: 'Да. Градовете и пристанищата са от GeoNames, а маршрутите — по пътната мрежа на OpenStreetMap, с граници и пътни такси. Цените, компаниите, клиентите и събитията в играта са симулирани (игрови данни).' },
              { q: 'Мога ли да играя с приятели?', a: `Да — в обща компания, в чата или като съперници в лигите. Ако поканиш приятел с личния си линк, и двамата получавате награда след първите му ${REFERRAL.deliveriesNeeded} доставки.` },
              { q: 'Какво се случва в края на сезона?', a: `Най-добрите получават наградите, а точките се нулират. Парите, камионите, шофьорите и депата ти остават — сезонът е ново състезание, не нов старт.` },
            ].map((f) => (
              <details key={f.q} className="panel group p-0">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold">
                  {f.q}
                  <span className="text-xl leading-none text-mist-400 transition group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-5 text-sm leading-relaxed text-mist-300">{f.a}</p>
              </details>
            ))}
          </div>
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
            <p className="mt-3 max-w-sm">Браузърна мултиплейър транспортна и икономическа симулация върху реалната география на Европа.</p>
            {latest && <p className="mt-3 text-xs">Версия {latest.version} „{latest.name}“</p>}
          </div>
          <div>
            <p className="label">Играта</p>
            <ul className="mt-3 space-y-2">
              <li><Link href="/register" className="hover:text-white">Регистрация</Link></li>
              <li><Link href="/login" className="hover:text-white">Вход</Link></li>
              <li><Link href="/updates" className="hover:text-white">Обновления</Link></li>
              <li><a href="#map" className="hover:text-white"><MapPinned className="mr-1 inline h-3.5 w-3.5" />Картата</a></li>
              <li><a href="#faq" className="hover:text-white">Въпроси и отговори</a></li>
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
        <div className="border-t border-asphalt-800 py-4 text-center text-xs text-mist-400">© {now.getFullYear()} TransVerse. Всички права запазени.</div>
      </footer>
    </div>
  );
}

/** "Светът сега": live game data (labelled as such). */
function LiveSection({ world }: { world: LiveWorld }) {
  const { now } = world;
  const ago = (t: Date | null) => {
    const min = t ? Math.max(0, Math.round((now.getTime() - t.getTime()) / 60_000)) : 0;
    return min < 1 ? 'току-що' : min < 60 ? `преди ${min} мин` : min < 1440 ? `преди ${Math.round(min / 60)} ч` : `преди ${Math.round(min / 1440)} дни`;
  };
  const eventLive = world.event && world.event.startsAt <= now;
  return (
    <section id="live" className="scroll-mt-20 border-y border-asphalt-800 bg-asphalt-900/40">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-profit" /> Светът сега</p>
            <h2 className="mt-3 font-display text-3xl font-bold sm:text-4xl">Какво се случва на пътя в момента</h2>
          </div>
          <p className="text-xs text-mist-400">Игрови данни от TransVerse, на живо</p>
        </div>
        <div className="mt-10 grid gap-4 lg:grid-cols-3">
          <div className={`panel p-5 ${world.recent.length >= 4 ? 'lg:row-span-2' : ''}`}>
            <h3 className="flex items-center gap-2 font-display text-base font-bold"><Truck className="h-5 w-5 text-cyan-glow" /> Последни доставки</h3>
            {world.recent.length ? (
              <ul className="mt-4 space-y-2.5">
                {world.recent.map((d) => (
                  <li key={d.id} className="rounded-xl border border-asphalt-700 bg-asphalt-900/60 px-3.5 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold">{d.from} → {d.to}</span>
                      <span className="shrink-0 text-[11px] text-mist-400">{ago(d.at)}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-mist-400">{d.goods} · {int(Math.round(d.tons))} т · {km(d.km)}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-mist-400">Още няма доставки днес — първият курс може да е твоят.</p>
            )}
          </div>
          <div className="panel p-5">
            <h3 className="flex items-center gap-2 font-display text-base font-bold"><Trophy className="h-5 w-5 text-gold-400" /> {world.season ? world.season.name : 'Сезон'}</h3>
            {world.season && <p className="mt-1 text-xs text-mist-400">Остават {left(world.season.endsAt, now)}</p>}
            {world.season?.top.length ? (
              <ol className="mt-4 space-y-2">
                {world.season.top.map((c, i) => (
                  <li key={`${c.name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`num w-5 text-center font-bold ${i === 0 ? 'text-gold-400' : 'text-mist-400'}`}>{i + 1}</span>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color ?? '#2f7bff' }} />
                      <span className="truncate">{c.name}</span>
                      {c.tag && <span className="shrink-0 text-[11px] text-mist-400">[{c.tag}]</span>}
                    </span>
                    <span className="num shrink-0 text-mist-300">{int(c.points)} т.</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-4 text-sm text-mist-400">Класацията на компаниите тепърва се оформя.</p>
            )}
          </div>
          <div className="panel p-5">
            <h3 className="flex items-center gap-2 font-display text-base font-bold"><Globe2 className="h-5 w-5 text-prestige" /> {world.event ? (eventLive ? 'Ивент в момента' : 'Предстоящ ивент') : 'Ивенти'}</h3>
            {world.event ? (
              <>
                <p className="mt-3 font-semibold">{world.event.name}</p>
                <p className="mt-1 line-clamp-2 text-sm text-mist-300">{world.event.description}</p>
                {eventLive ? (
                  <>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-asphalt-800"><div className="h-full rounded-full bg-gradient-to-r from-prestige to-cyan-glow" style={{ width: `${Math.min(100, Math.round((world.event.progress / Math.max(1, world.event.target)) * 100))}%` }} /></div>
                    <p className="mt-1.5 text-xs text-mist-400">{Math.min(100, Math.round((world.event.progress / Math.max(1, world.event.target)) * 100))}% от целта · остават {left(world.event.endsAt, now)}</p>
                  </>
                ) : (
                  <p className="mt-3 text-xs text-mist-400">Започва след {left(world.event.startsAt, now)}</p>
                )}
              </>
            ) : (
              <p className="mt-3 text-sm text-mist-400">Общи цели за всички играчи с награди за всеки участник — следващият идва скоро.</p>
            )}
          </div>
          <div className="panel p-5 lg:col-span-2">
            <h3 className="flex items-center gap-2 font-display text-base font-bold"><Gavel className="h-5 w-5 text-gold-400" /> Специален товар на търг</h3>
            {world.auction ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{world.auction.title}</p>
                  <p className="text-sm text-mist-300">{world.auction.goods} · {int(Math.round(world.auction.tons))} т · {km(world.auction.km)} · +{world.auction.coins} TC при доставка</p>
                </div>
                <span className="rounded-full bg-loss/15 px-3 py-1 text-sm text-loss">Търгът е отворен · още {left(world.auction.endsAt, now)}</span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-mist-300">Следващият търг е {world.nextAuction.tomorrow ? 'утре' : 'днес'} в <span className="font-semibold text-white">{world.nextAuction.hour}:00</span> — трансформатор, яхта, хеликоптер или музеен експонат. Печели най-ниската оферта за превоза.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/** A drawn phone with a notification (illustration). */
function PhoneMockup() {
  return (
    <figure className="mx-auto w-full max-w-[280px]" aria-label="Илюстрация на известие на телефон">
      <div className="rounded-[2.5rem] border border-asphalt-600 bg-asphalt-900 p-2.5 shadow-[0_40px_80px_-30px_rgba(0,0,0,0.8)]">
        <div className="relative overflow-hidden rounded-[2rem] bg-[radial-gradient(80%_60%_at_50%_0%,rgba(47,123,255,0.35),transparent_70%)] bg-asphalt-950 px-3 pb-6 pt-3">
          <div className="mx-auto h-5 w-24 rounded-full bg-asphalt-900" />
          <p className="num mt-6 text-center font-display text-5xl font-bold">09:41</p>
          <p className="text-center text-xs text-mist-400">понеделник</p>
          <div className="mt-8 space-y-2">
            {[
              { title: 'Камионът пристигна', body: 'СВ 4821 КТ достави плодове във Виена · +3 860 лв.' },
              { title: 'Нова поръчка по любима линия', body: 'София → Букурещ · 18 т · 1 420 лв.' },
              { title: 'Седмичник TransVerse', body: 'Излезе новият брой — виж шофьорите на седмицата.' },
            ].map((n) => (
              <div key={n.title} className="rounded-2xl border border-asphalt-700/80 bg-asphalt-850/90 p-2.5 backdrop-blur">
                <div className="flex items-center gap-2 text-[10px] text-mist-400"><ShieldCheck className="h-3 w-3 text-cyan-glow" /> TransVerse · сега</div>
                <p className="mt-0.5 text-xs font-semibold">{n.title}</p>
                <p className="text-[11px] text-mist-300">{n.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <figcaption className="mt-2 text-center text-[10px] text-mist-400">Илюстрация · примерни известия</figcaption>
    </figure>
  );
}
