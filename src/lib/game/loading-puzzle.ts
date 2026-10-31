import { seededRandom } from './road-events';

/**
 * 1.1.4.2 „Товарене“: an optional little puzzle in the first minutes of a trip.
 * The trailer floor is a grid; the pieces (pallets and crates) come from the
 * trip, there are more of them than fit. The fuller the floor, the bigger the
 * bonus. The server checks every placement. Game data.
 */
export const PUZZLE = {
  cols: 10,
  rows: 3,
  /** Real minutes from the start of the trip to load it. */
  minutes: 15,
  /** From this fill the bonus starts, up to `maxShare` of the pay at a full floor. */
  minFill: 0.7,
  maxShare: 0.08,
};

export interface PuzzlePiece {
  id: number;
  w: number;
  h: number;
}
export interface Placement {
  id: number;
  x: number;
  y: number;
  /** Turned by 90°. */
  r?: boolean;
}

const SHAPES: [number, number][] = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [1, 3], [2, 3], [3, 2]];

/** The pieces of one trip (the same for the same trip). */
export function puzzlePieces(seed: string): PuzzlePiece[] {
  const rand = seededRandom(`puzzle:${seed}`);
  const pieces: PuzzlePiece[] = [];
  let area = 0;
  // A little more than the floor, so not everything fits and the choice matters.
  while (area < PUZZLE.cols * PUZZLE.rows * 1.3) {
    const [w, h] = SHAPES[Math.floor(rand() * SHAPES.length)]!;
    pieces.push({ id: pieces.length, w, h });
    area += w * h;
  }
  return pieces;
}

/** How full the floor is with these placements (0–1); throws on an invalid one. */
export function puzzleFill(pieces: readonly PuzzlePiece[], placements: readonly Placement[]): number {
  const grid = Array.from({ length: PUZZLE.rows }, () => Array<boolean>(PUZZLE.cols).fill(false));
  const used = new Set<number>();
  let filled = 0;
  for (const p of placements) {
    const piece = pieces.find((x) => x.id === p.id);
    if (!piece || used.has(p.id)) throw new Error('bad_piece');
    used.add(p.id);
    const w = p.r ? piece.h : piece.w;
    const h = p.r ? piece.w : piece.h;
    if (!Number.isInteger(p.x) || !Number.isInteger(p.y) || p.x < 0 || p.y < 0 || p.x + w > PUZZLE.cols || p.y + h > PUZZLE.rows) throw new Error('outside');
    for (let y = p.y; y < p.y + h; y++)
      for (let x = p.x; x < p.x + w; x++) {
        if (grid[y]![x]) throw new Error('overlap');
        grid[y]![x] = true;
        filled++;
      }
  }
  return filled / (PUZZLE.cols * PUZZLE.rows);
}

/** The bonus share of the pay for a fill (and a little more with „Умно товарене“). */
export function puzzleShare(fill: number, extra = 0): number {
  if (fill < PUZZLE.minFill) return 0;
  return Math.round(((fill - PUZZLE.minFill) / (1 - PUZZLE.minFill)) * (PUZZLE.maxShare + extra) * 1000) / 1000;
}
