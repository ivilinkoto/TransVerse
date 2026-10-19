import { BarChart3, Gavel, Handshake, Package, Truck, UserRound, Warehouse } from 'lucide-react';
import type { ReactNode } from 'react';
import { VehicleIllustration } from '@/components/vehicles/VehicleIllustration';
import { AUCTION_RULES } from '@/lib/game/auctions';
import { CLIENT_RULES } from '@/lib/game/clients';
import { POWER_UNITS, TRAILERS } from '@/lib/game/catalog';
import { TRAITS } from '@/lib/game/crew';
import type { TourTab } from './FeatureTour';

/** Frame for the drawn pictures in the tour (example data, labelled). */
function Shot({ children, caption }: { children: ReactNode; caption: string }) {
  return (
    <figure>
      <div className="rounded-xl border border-asphalt-700 bg-asphalt-950 p-3 sm:p-4">{children}</div>
      <figcaption className="mt-1.5 text-right text-[10px] text-mist-400">{caption}</figcaption>
    </figure>
  );
}

const Row = ({ children, tone = '' }: { children: ReactNode; tone?: string }) => <div className={`flex items-center justify-between gap-3 rounded-lg border border-asphalt-800 bg-asphalt-900/50 px-3 py-2 text-xs ${tone}`}>{children}</div>;
const Bar = ({ share, color = 'bg-cyan-glow' }: { share: number; color?: string }) => (
  <div className="h-1.5 overflow-hidden rounded-full bg-asphalt-800"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.round(share * 100)}%` }} /></div>
);

function BoardShot() {
  const rows = [
    { lane: 'София → Букурещ', goods: 'Палети с напитки', t: 18, km: 388, pay: '1 420 лв.', fav: true },
    { lane: 'Пловдив → Истанбул', goods: 'Мебели', t: 12, km: 412, pay: '1 380 лв.', fav: false },
    { lane: 'Варна → Констанца', goods: 'Замразена риба', t: 20, km: 152, pay: '760 лв.', fav: false, urgent: true },
    { lane: 'Мюнхен → Виена', goods: 'Авточасти', t: 9, km: 435, pay: '1 190 лв.', fav: true },
  ];
  return (
    <Shot caption="Борса за поръчки · примерни данни">
      <div className="mb-2 flex flex-wrap gap-1.5 text-[10px]">
        {['★ Любими', 'Без лиценз', 'До 2 ч път', 'Над 3 лв./км'].map((c, i) => <span key={c} className={`rounded-full border px-2 py-0.5 ${i === 0 ? 'border-gold-400/50 text-gold-400' : 'border-asphalt-700 text-mist-300'}`}>{c}</span>)}
      </div>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <Row key={r.lane}>
            <span className="min-w-0 truncate">{r.fav ? <span className="text-gold-400">★ </span> : null}{r.lane} <span className="text-mist-400">· {r.goods} · {r.t} т · {r.km} км</span>{r.urgent && <span className="ml-1.5 rounded bg-amber-sig/15 px-1 text-[10px] text-amber-sig">спешна</span>}</span>
            <span className="num shrink-0 font-semibold text-profit">{r.pay}</span>
          </Row>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg border border-volt-500/40 bg-volt-500/10 px-3 py-2 text-xs">
        <span>Диспечер: 3 свободни камиона → 3 предложения</span>
        <span className="rounded-md bg-volt-500 px-2 py-0.5 text-[10px] font-semibold text-white">Изпрати</span>
      </div>
    </Shot>
  );
}

function DriversShot() {
  const drivers = [
    { name: 'Георги Петров', skill: 4, trait: TRAITS.eco.short, hours: 0.35, state: 'На път', tone: 'text-cyan-glow' },
    { name: 'Мария Иванова', skill: 3, trait: TRAITS.long.short, hours: 0.8, state: 'Почивка 2 ч', tone: 'text-amber-sig' },
    { name: 'Ивайло Стоянов', skill: 5, trait: TRAITS.safe.short, hours: 0.1, state: 'Свободен', tone: 'text-profit' },
  ];
  return (
    <Shot caption="Шофьори · примерни данни">
      <div className="space-y-2">
        {drivers.map((d) => (
          <div key={d.name} className="rounded-lg border border-asphalt-800 bg-asphalt-900/50 p-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{d.name} <span className="text-gold-400">{'★'.repeat(d.skill)}</span></span>
              <span className={d.tone}>{d.state}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-mist-400"><span>Умение: {d.trait}</span><span>Кормуване днес</span></div>
            <div className="mt-1"><Bar share={d.hours} color={d.hours > 0.7 ? 'bg-amber-sig' : 'bg-cyan-glow'} /></div>
          </div>
        ))}
        <Row tone="border-prestige/40"><span>Двоен екипаж: Георги + Мария</span><span className="text-prestige">без спиране за почивка</span></Row>
      </div>
    </Shot>
  );
}

function FleetShot({ livery }: { livery?: 'pumpkin' | 'christmas' }) {
  const rigs = [
    { modelId: 'hemus-r12-box', trailerModelId: 'drawbar-box', color: '#b91c1c', caption: 'Соло + прикачно ремарке' },
    { modelId: 'danubia-t440', trailerModelId: 'car-carrier', color: '#e5e7eb', caption: 'Влекач + автовоз' },
    { modelId: 'rila-xt620', trailerModelId: 'flatbed-13', color: '#7c3aed', caption: 'Влекач + платформа' },
  ];
  return (
    <Shot caption="Автопарк · илюстрации на моделите в играта">
      <div className="space-y-3">
        {rigs.map((r, i) => (
          <div key={r.caption} className="flex items-center gap-3 rounded-lg border border-asphalt-800 bg-asphalt-900/50 px-3 py-2">
            <VehicleIllustration modelId={r.modelId} trailerModelId={r.trailerModelId} color={r.color} livery={i === 0 ? livery : undefined} className="h-12 w-2/3" />
            <span className="text-[11px] text-mist-300">{r.caption}</span>
          </div>
        ))}
      </div>
    </Shot>
  );
}

function ClientsShot() {
  return (
    <Shot caption="Договор с клиент · примерни данни">
      <div className="rounded-lg border border-asphalt-800 bg-asphalt-900/50 p-3 text-xs">
        <div className="flex items-center justify-between"><span className="font-semibold">Родопа Мебел АД</span><span className="text-mist-400">остават 31 ч</span></div>
        <div className="mt-1 text-mist-400">Смолян → Солун · мебели · 6 курса по 11 т</div>
        <div className="mt-3 flex gap-1.5">{Array.from({ length: 6 }, (_, i) => <span key={i} className={`h-2 flex-1 rounded-full ${i < 4 ? 'bg-profit' : 'bg-asphalt-700'}`} />)}</div>
        <div className="mt-2 flex justify-between text-[11px]"><span>4 от 6 доставени</span><span className="text-gold-400">бонус +{Math.round(CLIENT_RULES.bonusShare * 100)}% при пълен договор</span></div>
      </div>
      <div className="mt-2 space-y-1.5">
        <Row><span>Дунав Агро ЕООД · 3 курса · зърно</span><span className="text-mist-400">репутация 0+</span></Row>
        <Row><span>Тракия Стийл · 8 курса · стомана</span><span className="text-amber-sig">репутация 40+</span></Row>
      </div>
    </Shot>
  );
}

function AuctionShot() {
  return (
    <Shot caption="Търг за специален товар · примерни данни">
      <div className="rounded-lg border border-gold-400/40 bg-gold-400/5 p-3 text-xs">
        <div className="flex items-center justify-between"><span className="font-semibold">Трансформатор за подстанция</span><span className="num rounded bg-loss/15 px-1.5 py-0.5 text-loss">04:12</span></div>
        <div className="mt-1 text-mist-400">Русе → Белград · 34 т · 512 км · +40 TC при доставка</div>
        <div className="mt-3 flex items-end justify-between">
          <div><div className="text-[10px] text-mist-400">Най-ниска оферта</div><div className="num font-display text-xl font-bold text-profit">6 480 лв.</div></div>
          <span className="rounded-md bg-gold-400 px-2.5 py-1 text-[11px] font-semibold text-asphalt-950">Оферирай 6 410 лв.</span>
        </div>
      </div>
      <div className="mt-2 space-y-1">
        {[['Балкан Карго', '6 480 лв.'], ['Север Транс', '6 560 лв.'], ['Еко Лоджистик', '6 900 лв.']].map(([n, v]) => <Row key={n}><span>{n}</span><span className="num">{v}</span></Row>)}
      </div>
    </Shot>
  );
}

function TradeShot() {
  const stock = [
    { goods: 'Зърно', city: 'Русе', share: 0.8, price: '210 лв./т', trend: '▲', tone: 'text-profit' },
    { goods: 'Вино', city: 'Мелник', share: 0.35, price: '1 450 лв./т', trend: '▼', tone: 'text-loss' },
    { goods: 'Цимент', city: 'Девня', share: 0.55, price: '95 лв./т', trend: '▲', tone: 'text-profit' },
  ];
  return (
    <Shot caption="Складове и търговия · примерни данни">
      <div className="space-y-2">
        {stock.map((s) => (
          <div key={s.goods} className="rounded-lg border border-asphalt-800 bg-asphalt-900/50 p-2.5 text-xs">
            <div className="flex justify-between"><span className="font-semibold">{s.goods} · склад {s.city}</span><span className={`num ${s.tone}`}>{s.price} {s.trend}</span></div>
            <div className="mt-1.5"><Bar share={s.share} color="bg-gold-400" /></div>
          </div>
        ))}
        <Row><span>Пазар на употребявана техника</span><span className="text-cyan-glow">Danubia T440 · 2 г. · 61 000 лв.</span></Row>
      </div>
    </Shot>
  );
}

function AnalyticsShot() {
  const days = [0.42, 0.55, 0.38, 0.7, 0.62, 0.85, 0.74];
  return (
    <Shot caption="Анализ на компанията · примерни данни">
      <div className="flex h-28 items-end gap-2 rounded-lg border border-asphalt-800 bg-asphalt-900/50 p-3" aria-hidden="true">
        {days.map((d, i) => <div key={i} className="flex-1 rounded-t bg-gradient-to-t from-volt-500 to-cyan-glow" style={{ height: `${d * 100}%` }} />)}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        {[['Нетно / км', '0.94 лв.'], ['Навреме', '96 %'], ['л / 100 км', '29.8']].map(([k, v]) => (
          <div key={k} className="rounded-lg border border-asphalt-800 bg-asphalt-900/50 px-2.5 py-1.5"><div className="text-[10px] text-mist-400">{k}</div><div className="num font-bold">{v}</div></div>
        ))}
      </div>
      <div className="mt-2 space-y-1"><Row><span>Най-печеливша линия: София → Букурещ</span><span className="num text-profit">+18 240 лв.</span></Row></div>
    </Shot>
  );
}

const icon = (I: typeof Truck) => <I className="h-4 w-4" />;

/** Tabs of the public tour; the numbers in the text come from the game rules. */
export function tourTabs(livery?: 'pumpkin' | 'christmas'): TourTab[] {
  return [
    {
      id: 'board', label: 'Борса и диспечер', icon: icon(Package),
      title: 'Общ пазар на поръчки',
      text: 'Всички играчи виждат една и съща борса. Поръчката, която вземеш ти, изчезва за останалите. Избираш товар по цена, разстояние, срок и вид ремарке — или оставяш диспечера да предложи най-изгодния курс за всеки свободен камион.',
      points: ['Любими линии със звезда и известие за нова поръчка по тях', 'Бързи филтри: без лиценз, до 2 часа път, над 3 лв./км', 'Спешни поръчки с по-висока цена и кратък срок', 'Рискове по избор: претоварване или каране без почивка — с шанс за глоба'],
      mockup: <BoardShot />,
    },
    {
      id: 'drivers', label: 'Шофьори', icon: icon(UserRound),
      title: 'Наемай, обучавай, пази от умора',
      text: 'Всеки шофьор има ниво, заплата и умение. Часовете на волана се трупат и след дълъг курс шофьорът трябва да почине — или пращаш двоен екипаж, който кара без спиране.',
      points: [`Умения: ${Object.values(TRAITS).map((t) => t.label.toLowerCase()).join(', ')}`, 'Шофьорите растат с опита и искат по-висока заплата', 'Двоен екипаж за дългите линии', 'Курсовете се изпълняват и докато не си в играта'],
      mockup: <DriversShot />,
    },
    {
      id: 'fleet', label: 'Камиони и ремаркета', icon: icon(Truck),
      title: `${POWER_UNITS.length} модела и ${TRAILERS.length} вида ремаркета`,
      text: 'От куриерски ван до тежкотоварен 6×4. Всеки товар иска подходяща надстройка: хладилно за храни, цистерна за горива, автовоз за коли, платформа за стомана, нискорамно за извънгабаритни товари.',
      points: ['Соло камиони с прикачни ремаркета (тандем)', 'Сервиз, подобрения, застраховка и пътна помощ', 'Собствени цветове, табели и празнични бои', 'Нает камион в началото — без пари за покупка'],
      mockup: <FleetShot livery={livery} />,
    },
    {
      id: 'clients', label: 'Клиенти', icon: icon(Handshake),
      title: 'Договори с постоянни клиенти',
      text: `Клиентите предлагат серия от ${CLIENT_RULES.loads[0]} до ${CLIENT_RULES.loads[1]} курса по една линия със срок. Всеки курс плаща малко над пазара, а изпълненият договор носи бонус и репутация. Провалът струва репутация.`,
      points: ['По-големите договори искат по-висока репутация', `До ${CLIENT_RULES.maxActive} активни договора наведнъж`, 'Репутацията отваря по-изгодни поръчки'],
      mockup: <ClientsShot />,
    },
    {
      id: 'auctions', label: 'Търгове', icon: icon(Gavel),
      title: 'Специални товари на търг',
      text: `${AUCTION_RULES.hours.length} пъти на ден (${AUCTION_RULES.hours.map((h) => `${h}:00`).join(', ')}) излиза рядък товар — трансформатор, яхта, хеликоптер, музеен експонат. ${AUCTION_RULES.minutes} минути наддаване надолу: печели най-ниската цена за превоза.`,
      points: ['Оферта в последната минута удължава търга', `Победителят има ${AUCTION_RULES.sendHours} часа да изпрати камион`, 'ТрансКоин при доставка', 'Фирмени търгове за компании'],
      mockup: <AuctionShot />,
    },
    {
      id: 'trade', label: 'Складове и търговия', icon: icon(Warehouse),
      title: 'Купи евтино, продай скъпо',
      text: 'Купуваш стока там, където е евтина, пазиш я в склад и я караш до града, където се търси. Цените се движат с търсенето, сезона и събитията. Употребяваните камиони се продават между играчите.',
      points: ['Склад във всяко твое депо', 'Цени, които реагират на доставките на всички играчи', 'Пазар на употребявана техника'],
      mockup: <TradeShot />,
    },
    {
      id: 'analytics', label: 'Финанси и анализ', icon: icon(BarChart3),
      title: 'Всеки километър се отчита',
      text: 'Гориво по цените на всяка държава, пътни такси, поддръжка, заплати, наем. Всичко е в счетоводната книга, а страницата „Анализ“ показва кой камион, шофьор и линия носят най-много.',
      points: ['Нетен резултат по дни за 7, 30 или 90 дни', 'Навременност и разход на гориво', 'Глоби, застраховки и обжалване'],
      mockup: <AnalyticsShot />,
    },
  ];
}
