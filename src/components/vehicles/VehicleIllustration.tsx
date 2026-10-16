import { useId } from 'react';
import { powerUnitModel, trailerModel } from '@/lib/game/catalog';
import { Defs, GroundShadow, type Ids } from './parts';
import { Trailer, type TrailerBody } from './trailers';
import { Rigid, Tractor, Van } from './units';

export interface VehicleIllustrationProps {
  /** Power unit model id from the catalogue. */
  modelId: string;
  /** Coupled trailer model id (tractors only). */
  trailerModelId?: string | null;
  color?: string;
  trailerColor?: string;
  className?: string;
  title?: string;
}

/**
 * Side-view illustration of a catalogue vehicle at true proportions
 * (1 unit = 1 cm). Original artwork for TransVerse.
 */
export function VehicleIllustration({ modelId, trailerModelId, color = '#1d4ed8', trailerColor, className, title }: VehicleIllustrationProps) {
  const uid = useId().replace(/[:«»]/g, '');
  const ids: Ids = {
    body: `b${uid}`, metal: `m${uid}`, glass: `g${uid}`, tire: `t${uid}`, rim: `r${uid}`, chrome: `c${uid}`, white: `w${uid}`, shadow: `s${uid}`, corrugation: `k${uid}`,
  };
  const unit = powerUnitModel(modelId);
  const trailer = unit.kind === 'tractor' && trailerModelId ? trailerModel(trailerModelId) : null;

  let content;
  let width: number;
  let height = 440;
  if (unit.kind === 'van') {
    width = 620;
    height = 300;
    content = (
      <>
        <GroundShadow from={0} to={600} />
        <Van ids={ids} color={color} />
      </>
    );
  } else if (unit.kind === 'rigid') {
    width = 920;
    content = (
      <>
        <GroundShadow from={0} to={900} />
        <Rigid ids={ids} color={color} body={unit.body === 'reefer' ? 'reefer' : 'box'} />
      </>
    );
  } else {
    const tractorX = trailer ? 1080 : 0; // kingpin 160 cm behind the nose → fifth wheel at x = 120
    width = tractorX + 640;
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
      <title>{title ?? `${unit.brand} ${unit.name}${trailer ? ` + ${trailer.name}` : ''}`}</title>
      <Defs ids={ids} color={color} />
      {content}
    </svg>
  );
}

/** Stand-alone trailer illustration (garage / market cards). */
export function TrailerIllustration({ modelId, color = '#1d4ed8', className }: { modelId: string; color?: string; className?: string }) {
  const uid = useId().replace(/[:«»]/g, '');
  const ids: Ids = { body: `b${uid}`, metal: `m${uid}`, glass: `g${uid}`, tire: `t${uid}`, rim: `r${uid}`, chrome: `c${uid}`, white: `w${uid}`, shadow: `s${uid}`, corrugation: `k${uid}` };
  const t = trailerModel(modelId);
  const fill = t.body === 'container' ? '#b45309' : t.body === 'tipper' ? '#ca8a04' : color;
  return (
    <svg viewBox="-10 -450 1420 470" className={className} role="img" aria-label={t.name} preserveAspectRatio="xMidYMax meet">
      <title>{`${t.brand} ${t.name}`}</title>
      <Defs ids={ids} color={color} />
      <GroundShadow from={0} to={1360} />
      <Trailer body={t.body as TrailerBody} ids={ids} color={fill} />
    </svg>
  );
}
