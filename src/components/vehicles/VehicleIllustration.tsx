import { useId } from 'react';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { Defs, GroundShadow, type Ids } from './parts';
import { DrawbarTrailer, Trailer, type TrailerBody } from './trailers';
import { Rigid, Tractor, Van } from './units';

export interface VehicleIllustrationProps {
  /** Power unit model id from the catalogue. */
  modelId: string;
  /** Coupled trailer model id (a semi-trailer behind a tractor, a drawbar trailer behind a rigid truck). */
  trailerModelId?: string | null;
  color?: string;
  trailerColor?: string;
  className?: string;
  title?: string;
  /** Special paint scheme drawn on top ('pumpkin' — Halloween 2026). */
  livery?: string | null;
}

/**
 * Side-view illustration of a catalogue vehicle at true proportions
 * (1 unit = 1 cm). Original artwork for TransVerse.
 */
export function VehicleIllustration({ modelId, trailerModelId, color = '#1d4ed8', trailerColor, className, title, livery }: VehicleIllustrationProps) {
  const uid = useId().replace(/[:«»]/g, '');
  const ids: Ids = {
    body: `b${uid}`, metal: `m${uid}`, glass: `g${uid}`, tire: `t${uid}`, rim: `r${uid}`, chrome: `c${uid}`, white: `w${uid}`, shadow: `s${uid}`, corrugation: `k${uid}`,
  };
  const unit = powerUnitModel(modelId);
  const coupled = trailerModelId ? trailerModel(trailerModelId) : null;
  const trailer = unit.kind === 'tractor' && coupled?.kind === 'semi' ? coupled : null;
  const drawbar = unit.kind === 'rigid' && coupled?.kind === 'drawbar' ? coupled : null;

  let content;
  let width: number;
  // Where the livery decals go (centre x, centre y, size) in this drawing.
  let decals: [number, number, number][] = [];
  let height = 440;
  if (unit.kind === 'van') {
    width = 620;
    height = 300;
    decals = [[370, -236, 60]];
    content = (
      <>
        <GroundShadow from={0} to={600} />
        <Van ids={ids} color={color} />
      </>
    );
  } else if (unit.kind === 'rigid') {
    const rigidX = drawbar ? 910 : 0;
    const body = unit.body === 'reefer' ? 'reefer' : 'box';
    width = rigidX + 920;
    decals = [[rigidX + 600, -175, 80], ...(drawbar ? ([[690, -175, 80]] as [number, number, number][]) : [])];
    content = (
      <>
        <GroundShadow from={0} to={rigidX + 900} />
        {drawbar && <DrawbarTrailer body={body} ids={ids} color={trailerColor ?? color} />}
        <g transform={`translate(${rigidX} 0)`}>
          <Rigid ids={ids} color={color} body={body} />
        </g>
      </>
    );
  } else {
    const tractorX = trailer ? 1080 : 0; // kingpin 160 cm behind the nose → fifth wheel at x = 120
    width = tractorX + 640;
    decals = trailer ? [[1250, -205, 110]] : [[tractorX + 300, -330, 110]];
    if (trailer?.body === 'tanker') height = 450;
    content = (
      <>
        <GroundShadow from={0} to={tractorX + 602} />
        {trailer && <Trailer body={trailer.body as TrailerBody} ids={ids} color={trailerColor ?? (trailer.body === 'container' ? '#b45309' : trailer.body === 'tipper' ? '#ca8a04' : color)} />}
        <g transform={`translate(${tractorX} 0)`}>
          <Tractor ids={ids} color={color} cab={unit.cab === 'day' || unit.cab === 'van' ? 'day' : unit.cab} heavy={unit.heavyHaul} coupled={!!trailer} />
        </g>
      </>
    );
  }

  return (
    <svg viewBox={`-10 ${-height} ${width + 20} ${height + 20}`} className={className} role="img" aria-label={title ?? unit.name} preserveAspectRatio="xMidYMax meet">
      <title>{title ?? `${unit.brand} ${unit.name}${coupled && (trailer || drawbar) ? ` + ${coupled.name}` : ''}`}</title>
      <Defs ids={ids} color={color} />
      {content}
      {livery === 'pumpkin' && decals.map(([x, y, size], i) => <PumpkinDecal key={i} x={x} y={y} size={size} />)}
    </svg>
  );
}

/** Stand-alone trailer illustration (garage / market cards). */
export function TrailerIllustration({ modelId, color = '#1d4ed8', className }: { modelId: string; color?: string; className?: string }) {
  const uid = useId().replace(/[:«»]/g, '');
  const ids: Ids = { body: `b${uid}`, metal: `m${uid}`, glass: `g${uid}`, tire: `t${uid}`, rim: `r${uid}`, chrome: `c${uid}`, white: `w${uid}`, shadow: `s${uid}`, corrugation: `k${uid}` };
  const t = trailerModel(modelId);
  const fill = t.body === 'container' ? '#b45309' : t.body === 'tipper' ? '#ca8a04' : color;
  if (t.kind === 'drawbar') {
    return (
      <svg viewBox="-10 -450 940 470" className={className} role="img" aria-label={t.name} preserveAspectRatio="xMidYMax meet">
        <title>{`${t.brand} ${t.name}`}</title>
        <Defs ids={ids} color={color} />
        <GroundShadow from={0} to={900} />
        <DrawbarTrailer body={t.body === 'reefer' ? 'reefer' : 'box'} ids={ids} color={fill} />
      </svg>
    );
  }
  return (
    <svg viewBox="-10 -450 1420 470" className={className} role="img" aria-label={t.name} preserveAspectRatio="xMidYMax meet">
      <title>{`${t.brand} ${t.name}`}</title>
      <Defs ids={ids} color={color} />
      <GroundShadow from={0} to={1360} />
      <Trailer body={t.body as TrailerBody} ids={ids} color={fill} />
    </svg>
  );
}

/** Jack-o'-lantern decal of the "Тиква" paint (Halloween 2026), centred on (x, y). */
function PumpkinDecal({ x, y, size }: { x: number; y: number; size: number }) {
  const k = size / 32;
  return (
    <g transform={`translate(${x - 16 * k} ${y - 16 * k}) scale(${k})`} opacity="0.95">
      <path d="M16 6c-1-2.4-.4-4 1.6-4.6l.5 1.6c-.9.3-1.1 1-.6 2.4z" fill="#4d7c0f" />
      <ellipse cx="10.5" cy="18" rx="7.5" ry="10" fill="#c2410c" stroke="#1c1917" strokeWidth="0.6" />
      <ellipse cx="21.5" cy="18" rx="7.5" ry="10" fill="#c2410c" stroke="#1c1917" strokeWidth="0.6" />
      <ellipse cx="16" cy="18" rx="6.5" ry="10.5" fill="#f97316" stroke="#1c1917" strokeWidth="0.6" />
      <path d="M10 15l3 2.5-3.5.5zM22 15l-3 2.5 3.5.5z" fill="#fde047" />
      <path d="M9.5 21.5c2 2.4 4.3 3.2 6.5 3.2s4.5-.8 6.5-3.2l-2 .4-1.4 1.2-1.4-1.2-1.7 1.4-1.7-1.4-1.4 1.2-1.4-1.2z" fill="#fde047" />
    </g>
  );
}
