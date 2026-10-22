import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { ImageResponse } from 'next/og';
import { Children, Fragment, isValidElement, type ReactElement, type ReactNode } from 'react';
import { PlotScene, viewFor } from '@/components/company/plot/scene';
import { int } from '@/lib/format';
import { isChristmas } from '@/lib/game/christmas';
import { isWinter } from '@/lib/game/winter';
import type { Database } from '@/server/db/client';
import { getAvatar } from '@/server/game/avatars';
import { publicPlot } from '@/server/game/plot';
import { playerCard } from '@/server/game/social';
import { cities, companies, deliveries, liveryEntries, users } from '@/server/db/schema';
import { VehicleDrawing } from '@/components/vehicles/VehicleIllustration';
import { powerUnitModel } from '@/lib/game/catalog';
import { fleetView } from '@/server/game/queries';
import { companyWeekReport } from '@/server/game/company-report';
import { tripPosition } from '@/server/game/roadside';
import type { LatLon } from '@/lib/geo/geometry';
import { levelOf, rankOf } from './levels';

/**
 * Pictures for Discord embeds (PNG, made with next/og): the player card of
 * /профил and the company base of /участък. Game data. The fonts of the
 * site (Exo 2, Onest) are loaded once from Google Fonts; without them the
 * picture is not made and the embed simply has none.
 */

type Font = { name: string; data: ArrayBuffer; weight: 400 | 600 | 700; style: 'normal' };
let fonts: Promise<Font[]> | null = null;

async function loadFont(family: string, weight: number): Promise<ArrayBuffer> {
  // A plain user agent gets TrueType files, which next/og can read.
  const css = await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}`, { headers: { 'user-agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) }).then((r) => r.text());
  const url = /url\((https:[^)]+\.ttf)\)/.exec(css)?.[1];
  if (!url) throw new Error(`no font file for ${family}`);
  return fetch(url, { signal: AbortSignal.timeout(8000) }).then((r) => r.arrayBuffer());
}

function cardFonts() {
  fonts ??= Promise.all([loadFont('Exo 2', 700), loadFont('Onest', 400), loadFont('Onest', 600)])
    .then(([exo, onest, onestBold]) => [
      { name: 'Exo 2', data: exo, weight: 700 as const, style: 'normal' as const },
      { name: 'Onest', data: onest, weight: 400 as const, style: 'normal' as const },
      { name: 'Onest', data: onestBold, weight: 600 as const, style: 'normal' as const },
    ])
    .catch((error) => {
      fonts = null;
      throw error;
    });
  return fonts;
}

const BG = '#0b1018';
const PANEL = '#121a26';
const MIST = '#9aa3b2';
const ORANGE = '#f97316';
const CYAN = '#22d3ee';

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'Exo 2', fontSize: 30, color: 'white' }}>
      <svg width="40" height="40" viewBox="0 0 48 48">
        <rect width="48" height="48" rx="12" fill="#0e131b" stroke="#263347" />
        <path d="M10 34 L22 14 L26 14 L16 34 Z" fill={CYAN} />
        <path d="M22 34 L34 14 L38 14 L28 34 Z" fill="#f6c343" />
        <circle cx="36" cy="34" r="3" fill={CYAN} />
      </svg>
      <span>
        Trans<span style={{ color: CYAN }}>Verse</span>
      </span>
    </div>
  );
}

/** The player card for /профил. */
export async function playerCardImage(db: Database, username: string, now = new Date()) {
  const card = await playerCard(db, '00000000-0000-0000-0000-000000000000', username, now);
  if (!card) return null;
  const avatar = await getAvatar(db, card.id);
  const avatarSrc = avatar && /^image\/(png|jpeg)$/.test(avatar.mime) ? `data:${avatar.mime};base64,${Buffer.from(avatar.data).toString('base64')}` : null;
  const stat = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', background: PANEL, borderRadius: 18, padding: '16px 22px', minWidth: 200 }}>
      <span style={{ fontSize: 22, color: MIST }}>{label}</span>
      <span style={{ fontSize: 38, fontWeight: 600, color: 'white' }}>{value}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: `linear-gradient(135deg, ${BG} 0%, #141d2b 100%)`, padding: 48, fontFamily: 'Onest', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand />
          <span style={{ fontSize: 22, color: MIST }}>{card.online ? '🟢 онлайн' : card.lastSeen}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 40, marginTop: 36 }}>
          {avatarSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarSrc} width={180} height={180} style={{ borderRadius: 90, border: `6px solid ${card.vip ? '#f6c343' : ORANGE}` }} alt="" />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 180, height: 180, borderRadius: 90, background: ORANGE, fontFamily: 'Exo 2', fontSize: 90 }}>{card.username.slice(0, 1).toUpperCase()}</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontFamily: 'Exo 2', fontSize: 64, color: card.vip ? '#f6c343' : 'white' }}>{card.username}</span>
              {card.vip && <span style={{ fontSize: 24, fontWeight: 600, background: '#f6c343', color: BG, borderRadius: 10, padding: '4px 12px' }}>VIP</span>}
            </div>
            <span style={{ fontSize: 28, color: MIST }}>{card.company ? `${card.company.name} [${card.company.tag}] · ${card.company.rank}` : card.kind === 'company' ? 'Собствена фирма' : 'Независим шофьор'}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 6 }}>
              <span style={{ fontSize: 28, fontWeight: 600 }}>Ниво {card.level}</span>
              <div style={{ display: 'flex', width: 360, height: 16, background: '#263347', borderRadius: 8 }}>
                <div style={{ width: `${Math.round(card.levelShare * 100)}%`, height: 16, background: CYAN, borderRadius: 8 }} />
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 20, marginTop: 36 }}>
          {stat('Курсове', int(card.deliveries))}
          {stat('Репутация', `${Math.floor(card.reputation)}`)}
          {stat('Приятели', int(card.friends))}
          {stat('Значки', int(card.badges.length))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 24 }}>
          {card.badges.slice(0, 6).map((b) => (
            <span key={b.id} style={{ fontSize: 20, background: '#1d2838', color: '#d8dee8', borderRadius: 999, padding: '6px 14px' }}>{b.label}</span>
          ))}
        </div>
        <span style={{ marginTop: 'auto', fontSize: 18, color: MIST }}>transverse-bg.com · игрови данни</span>
      </div>
    ),
    { width: 1200, height: 675, fonts: await cardFonts(), headers: { 'cache-control': 'public, max-age=600' } },
  );
}

/**
 * next/og draws only plain SVG elements inside <svg>: the scene's components
 * (plain functions without hooks) are called here, fragments flattened.
 */
function plain(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(plain);
  if (!isValidElement(node)) return node;
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === 'function') return plain((el.type as (p: unknown) => ReactNode)(el.props));
  if ((el.type as unknown) === Fragment) return Children.toArray(el.props.children).map(plain);
  const children = el.props.children === undefined ? undefined : Children.toArray(el.props.children).map(plain);
  return { ...el, props: { ...el.props, ...(children === undefined ? {} : { children }) } } as ReactElement;
}

/** The company base for /участък (the same scene as in the game, without the labels). */
export async function plotImage(db: Database, organizationId: string, name: string, now = new Date()) {
  const base = await publicPlot(db, organizationId, '00000000-0000-0000-0000-000000000000');
  if (!base) return null;
  const v = viewFor(base.plotW);
  const c = base.construction;
  const scene = (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox={`${v.x} ${v.y} ${v.w} ${v.h}`} width={1200} height={867}>
      {plain(<PlotScene
        buildings={base.buildings}
        construction={c && { type: c.type, status: c.status, delivered: c.delivered, progress: c.startedAt && c.endsAt ? Math.min(1, (now.getTime() - c.startedAt.getTime()) / Math.max(1, c.endsAt.getTime() - c.startedAt.getTime())) : 0 }}
        ghost={null}
        selected={null}
        parkedTrucks={4}
        incoming={0}
        grid={false}
        liveryColor={base.liveryColor}
        plotW={base.plotW}
        labels={false}
        decor={base.decor}
        season={isChristmas(now) ? 'christmas' : isWinter(now) ? 'winter' : null}
      />)}
    </svg>
  );
  const levels = base.buildings.reduce((s, b) => s + b.level, 0);
  const built = base.buildings.filter((b) => b.level > 0).length;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: BG, fontFamily: 'Onest', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '22px 36px' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontFamily: 'Exo 2', fontSize: 44 }}>{name}</span>
            <span style={{ fontSize: 22, color: MIST }}>{`Базата · ${built} ${built === 1 ? 'сграда' : 'сгради'} · ${levels} ${levels === 1 ? 'ниво' : 'нива'} · 👍 ${base.likes}`}</span>
          </div>
          <Brand />
        </div>
        {scene}
      </div>
    ),
    { width: 1200, height: 980, fonts: await cardFonts(), headers: { 'cache-control': 'public, max-age=600' } },
  );
}

/** The rank card for /ранг (level in the Discord server). */
export async function rankCardImage(db: Database, discordId: string) {
  const r = await rankOf(db, discordId);
  if (!r) return null;
  const l = levelOf(r.xp);
  const avatar = r.avatar ? `https://cdn.discordapp.com/avatars/${discordId}/${r.avatar}.png?size=256` : null;
  const box = (label: string, value: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', background: PANEL, borderRadius: 16, padding: '12px 20px' }}>
      <span style={{ fontSize: 20, color: MIST }}>{label}</span>
      <span style={{ fontSize: 32, fontWeight: 600 }}>{value}</span>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ display: 'flex', alignItems: 'center', gap: 40, width: '100%', height: '100%', background: `linear-gradient(135deg, ${BG} 0%, #141d2b 100%)`, padding: 48, fontFamily: 'Onest', color: 'white' }}>
        {avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={avatar} width={200} height={200} style={{ borderRadius: 100, border: `6px solid ${ORANGE}` }} alt="" />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 200, height: 200, borderRadius: 100, background: ORANGE, fontFamily: 'Exo 2', fontSize: 96 }}>{(r.name || '?').slice(0, 1).toUpperCase()}</div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontFamily: 'Exo 2', fontSize: 54 }}>{r.name || 'Член'}</span>
            <span style={{ fontSize: 30, color: CYAN }}>#{r.place}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ fontFamily: 'Exo 2', fontSize: 40, color: ORANGE }}>Ниво {l.level}</span>
            <span style={{ fontSize: 22, color: MIST }}>{`${int(l.into)} / ${int(l.next)} опит`}</span>
          </div>
          <div style={{ display: 'flex', width: '100%', height: 22, background: '#263347', borderRadius: 11 }}>
            <div style={{ width: `${Math.max(2, Math.round((l.into / l.next) * 100))}%`, height: 22, background: `linear-gradient(90deg, ${CYAN}, ${ORANGE})`, borderRadius: 11 }} />
          </div>
          <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
            {box('Съобщения', int(r.messages))}
            {box('Гласов канал', `${Math.floor(r.voiceMinutes / 60)} ч`)}
            {box('Опит', int(r.xp))}
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 400, fonts: await cardFonts(), headers: { 'cache-control': 'public, max-age=600' } },
  );
}

/**
 * /карта: the player's trucks on their real coordinates (parked ones in their
 * city, moving ones where they are on the route now, with a line to where
 * they go) and the biggest cities around for orientation. Game data.
 */
export async function truckMapImage(db: Database, userId: string, now = new Date()) {
  const [account] = await db.select({ id: companies.id }).from(companies).where(eq(companies.ownerId, userId));
  if (!account) return null;
  const fleet = await fleetView(db, account.id);
  const trips = await db.select().from(deliveries).where(and(eq(deliveries.companyId, account.id), eq(deliveries.status, 'in_progress')));
  const trucks: { plate: string; at: LatLon; to: { name: string; at: LatLon } | null }[] = [];
  for (const v of fleet.vehicles) {
    const trip = trips.find((t) => t.vehicleId === v.id);
    const at = trip ? await tripPosition(db, trip, now) : ([v.city.lat, v.city.lon] as LatLon);
    if (!at) continue;
    const to = v.delivery ? { name: v.delivery.destination.nameBg, at: [v.delivery.destination.lat, v.delivery.destination.lon] as LatLon } : null;
    trucks.push({ plate: v.plate, at, to });
  }
  if (!trucks.length) return null;
  const W = 1200;
  const H = 700;
  const all = trucks.flatMap((t) => [t.at, ...(t.to ? [t.to.at] : [])]);
  let [south, north] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  let [west, east] = [Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[1]))];
  // At least ~3° around, and the shape of the picture (longitude shrinks with the latitude).
  const midLat = (south + north) / 2;
  const k = Math.cos((midLat * Math.PI) / 180);
  let spanLat = Math.max(3, (north - south) * 1.3);
  let spanLon = Math.max(3 / k, (east - west) * 1.3);
  if ((spanLon * k) / spanLat < W / H) spanLon = (spanLat * W) / H / k;
  else spanLat = (spanLon * k * H) / W;
  const midLon = (west + east) / 2;
  [south, north, west, east] = [midLat - spanLat / 2, midLat + spanLat / 2, midLon - spanLon / 2, midLon + spanLon / 2];
  const x = (p: LatLon) => ((p[1] - west) / (east - west)) * W;
  const y = (p: LatLon) => ((north - p[0]) / (north - south)) * H;
  const around = await db
    .select({ name: cities.nameBg, lat: cities.lat, lon: cities.lon })
    .from(cities)
    .where(and(gte(cities.lat, south), lte(cities.lat, north), gte(cities.lon, west), lte(cities.lon, east)))
    .orderBy(desc(cities.population))
    .limit(14);
  const moving = trucks.flatMap((t) => (t.to ? [{ ...t, to: t.to }] : []));
  const label = (left: number, top: number, text: string, style: Record<string, string | number>) => (
    <div style={{ position: 'absolute', left, top, display: 'flex', fontSize: 18, ...style }}>{text}</div>
  );
  return new ImageResponse(
    (
      <div style={{ display: 'flex', position: 'relative', width: '100%', height: '100%', background: `radial-gradient(circle at 30% 20%, #16243a 0%, ${BG} 75%)`, fontFamily: 'Onest', color: 'white' }}>
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute', left: 0, top: 0 }}>
          {Array.from({ length: Math.ceil(east) - Math.floor(west) + 1 }, (_, i) => Math.floor(west) + i).map((lon) => (
            <line key={`lon${lon}`} x1={x([0, lon])} y1={0} x2={x([0, lon])} y2={H} stroke="#1e2a3c" strokeWidth={1} />
          ))}
          {Array.from({ length: Math.ceil(north) - Math.floor(south) + 1 }, (_, i) => Math.floor(south) + i).map((lat) => (
            <line key={`lat${lat}`} x1={0} y1={y([lat, 0])} x2={W} y2={y([lat, 0])} stroke="#1e2a3c" strokeWidth={1} />
          ))}
          {around.map((c) => <circle key={c.name} cx={x([c.lat, c.lon])} cy={y([c.lat, c.lon])} r={4} fill="#3b4a60" />)}
          {moving.map((t, i) => <line key={`l${i}`} x1={x(t.at)} y1={y(t.at)} x2={x(t.to.at)} y2={y(t.to.at)} stroke={CYAN} strokeWidth={3} strokeDasharray="10 8" opacity={0.7} />)}
          {moving.map((t, i) => <circle key={`d${i}`} cx={x(t.to.at)} cy={y(t.to.at)} r={7} fill="none" stroke={CYAN} strokeWidth={3} />)}
          {trucks.map((t, i) => <circle key={`t${i}`} cx={x(t.at)} cy={y(t.at)} r={11} fill={t.to ? ORANGE : '#2fd27a'} stroke="#0b1018" strokeWidth={3} />)}
        </svg>
        {around.map((c) => label(x([c.lat, c.lon]) + 8, y([c.lat, c.lon]) - 12, c.name, { color: '#6b7a90', fontSize: 16 }))}
        {moving.map((t) => label(x(t.to.at) + 10, y(t.to.at) - 12, t.to.name, { color: CYAN, fontWeight: 600 }))}
        {trucks.map((t) => label(x(t.at) + 14, y(t.at) + 4, t.plate, { color: 'white', fontWeight: 600, background: 'rgba(11,16,24,0.75)', padding: '2px 8px', borderRadius: 8 }))}
        <div style={{ position: 'absolute', left: 32, top: 24, display: 'flex' }}><Brand /></div>
        <div style={{ position: 'absolute', right: 32, bottom: 24, display: 'flex', gap: 20, fontSize: 18, color: MIST }}>
          <span style={{ color: ORANGE }}>● на път</span>
          <span style={{ color: '#2fd27a' }}>● свободен</span>
          <span>Реални координати · игрови данни</span>
        </div>
      </div>
    ),
    { width: W, height: H, fonts: await cardFonts(), headers: { 'cache-control': 'public, max-age=300' } },
  );
}

/** The truck of a livery contest entry (#ливреи), as it looked when it entered. */
export async function liveryCardImage(db: Database, entryId: string) {
  const [e] = await db.select({ e: liveryEntries, username: users.username }).from(liveryEntries).innerJoin(users, eq(users.id, liveryEntries.userId)).where(eq(liveryEntries.id, entryId));
  if (!e) return null;
  const model = powerUnitModel(e.e.modelId);
  const drawn = plain(<VehicleDrawing uid="lv" modelId={e.e.modelId} trailerModelId={e.e.trailerModelId} color={e.e.color} livery={e.e.livery} />) as ReactElement<{ children?: ReactNode; viewBox?: string }>;
  // Satori wants a size on the <svg> and no <title> inside it.
  const children = Children.toArray(drawn.props.children).filter((c) => !(isValidElement(c) && c.type === 'title'));
  const svg = { ...drawn, props: { viewBox: drawn.props.viewBox, xmlns: 'http://www.w3.org/2000/svg', width: 1040, height: 420, preserveAspectRatio: 'xMidYMax meet', children } } as ReactElement;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: `linear-gradient(180deg, #1b2a40 0%, ${BG} 70%)`, padding: 40, fontFamily: 'Onest', color: 'white' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Brand />
          <span style={{ fontSize: 24, color: MIST }}>Конкурс за ливрея</span>
        </div>
        <div style={{ display: 'flex', flex: 1, alignItems: 'flex-end', justifyContent: 'center' }}>{svg}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
          <span style={{ fontFamily: 'Exo 2', fontSize: 40 }}>{e.username}</span>
          <span style={{ fontSize: 26, color: MIST }}>{`${model.brand} ${model.name} · ${e.e.plate}`}</span>
        </div>
      </div>
    ),
    { width: 1200, height: 675, fonts: await cardFonts(), headers: { 'cache-control': 'public, max-age=3600' } },
  );
}

/** The weekly report of a company (its Discord channel, Monday): the week in numbers. */
export async function companyReportImage(db: Database, organizationId: string, from: Date) {
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const r = await companyWeekReport(db, organizationId, from, to);
  if (!r) return null;
  const tile = (label: string, value: string, color = 'white') => (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: PANEL, borderRadius: 18, padding: '18px 22px' }}>
      <span style={{ fontSize: 20, color: MIST }}>{label}</span>
      <span style={{ fontFamily: 'Exo 2', fontSize: 40, color }}>{value}</span>
    </div>
  );
  const day = (d: Date) => d.toLocaleDateString('bg-BG', { day: 'numeric', month: 'long', timeZone: 'Europe/Sofia' });
  const lv = (c: number) => `${int(Math.round(c / 100))} лв.`;
  return new ImageResponse(
    (
      <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: `radial-gradient(circle at 20% 0%, #1b2a40 0%, ${BG} 70%)`, fontFamily: 'Onest', color: 'white', padding: 36, gap: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span style={{ fontFamily: 'Exo 2', fontSize: 46 }}>{`${r.name}${r.tag ? ` [${r.tag}]` : ''}`}</span>
            <span style={{ fontSize: 22, color: MIST }}>{`Седмичен отчет · ${day(from)} – ${day(new Date(to.getTime() - 1))} · ниво ${r.level}`}</span>
          </div>
          <Brand />
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {tile('Курсове', int(r.trips))}
          {tile('Тонове', `${r.tons.toLocaleString('bg-BG')} т`)}
          {tile('Километри', int(r.km))}
        </div>
        <div style={{ display: 'flex', gap: 16 }}>
          {tile('Спечелено от членовете', lv(r.earnedCents), '#2fd27a')}
          {tile('Касата за седмицата', `${r.treasuryNetCents >= 0 ? '+' : '−'}${lv(Math.abs(r.treasuryNetCents))}`, r.treasuryNetCents >= 0 ? '#2fd27a' : '#f87171')}
          {tile('В касата', lv(r.treasuryCents), CYAN)}
        </div>
        <div style={{ display: 'flex', gap: 16, flex: 1 }}>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 2, background: PANEL, borderRadius: 18, padding: '18px 22px', gap: 8 }}>
            <span style={{ fontSize: 20, color: MIST }}>Най-много тонове</span>
            {r.top.length ? r.top.map((m, i) => (
              <div key={m.username} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28 }}>
                <span>{`${['🥇', '🥈', '🥉'][i]} ${m.username}`}</span>
                <span style={{ color: ORANGE }}>{`${m.tons.toLocaleString('bg-BG')} т · ${m.trips} курса`}</span>
              </div>
            )) : <span style={{ fontSize: 26, color: MIST }}>Тази седмица няма доставки.</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, background: PANEL, borderRadius: 18, padding: '18px 22px', justifyContent: 'center', alignItems: 'center' }}>
            <span style={{ fontSize: 20, color: MIST }}>Битка на компаниите</span>
            <span style={{ fontFamily: 'Exo 2', fontSize: 36, color: r.battle?.won ? '#f6c343' : 'white' }}>{!r.battle ? 'без битка' : !r.battle.done ? 'тече' : r.battle.won ? '🏆 победа' : r.battle.draw ? 'равенство' : 'загуба'}</span>
          </div>
        </div>
        <span style={{ fontSize: 16, color: MIST }}>Игрови данни · TransVerse</span>
      </div>
    ),
    { width: 1200, height: 760, fonts: await cardFonts(), headers: { 'cache-control': 'public, max-age=3600' } },
  );
}
