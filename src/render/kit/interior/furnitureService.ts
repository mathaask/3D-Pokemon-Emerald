// Furniture kit II — Pokémon Center, Mart, computers, stairs (Phase 4 Task 10): the pieces adapted to the pure builders
// of geom/serviceFurniture.ts.
//
// - Counters (`pcCounter`, `counter`) are built cell by cell from `cellFeet` (counterRects): the nurse's U, the Mart's
//   L, the Dept Store's rings never reach over the walkable cells they enclose (the bounding `foot` would).
// - A Mart shelf against a wall (its footprint shallower than the spec allows its rows: the wall cut it) is a one-sided
//   wall unit; any other a double-sided gondola.
// - Stairs rise / fall away from the side they are entered from (`facing`; none: north). The flight up reaches north
//   into the back wall's recess (it climbs into the wall); its footprint keeps height 1.6 although its cell is walkable.
//   The stairwell covers its cells' whole area (Task 8 leaves those cells without floor), a rail round its open sides.

import type { FurnitureKind } from '../tables/building';
import { FURNITURE_SPEC, isLow, type FurnitureGenerator, type FurniturePiece } from './furniture';
import { RECESS, type WallDir } from './room';
import {
  OPPOSITE, buildCounter, buildHealer, buildMartShelf, buildPc, buildStairsDown, buildStairsUp, counterRects, type Rect,
} from './geom/serviceFurniture';

/** The direction a flight runs: away from the side it is entered from (none: north, into the back wall). */
export const flightDir = (p: FurniturePiece): WallDir => (p.facing ? OPPOSITE[p.facing] : 'N');

/** The cells' whole area (x0..x1 + 1, rows y0..y1 + 1 over the floor). */
export function cellsArea(p: FurniturePiece): Rect {
  const xs = p.xy.map((c) => c[0]), ys = p.xy.map((c) => c[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs) + 1, z0: Math.min(...ys) + p.floorY, z1: Math.max(...ys) + 1 + p.floorY, y: p.floorY };
}

/** A footprint cut by a wall: shallower than its kind's depth over its rows allows. */
export function againstWall(p: FurniturePiece): boolean {
  const ys = p.xy.map((c) => c[1]), rows = Math.max(...ys) - Math.min(...ys) + 1;
  return p.foot.z1 - p.foot.z0 < Math.min(FURNITURE_SPEC[p.kind].depth, rows) - 1e-6;
}

const counter = (band: boolean): FurnitureGenerator => (p, out, q) =>
  buildCounter(isLow(p.kind) ? out.low : out.tall, counterRects(p.xy, p.cellFeet), p.foot.height, p.colors, q, band);

export const SERVICE_GENERATORS: Partial<Record<FurnitureKind, FurnitureGenerator>> = {
  pc: (p, out, q) => buildPc(out, p.foot, p.colors, q),
  healer: (p, out, q) => buildHealer(out, p.foot, p.colors, q),
  pcCounter: counter(true),
  counter: counter(false),
  martShelf: (p, out, q) => buildMartShelf(out, p.foot, p.colors, p.seed, q, againstWall(p)),
  stairsUp: (p, out, q) => {
    const dir = flightDir(p), f = { ...p.foot };
    if (dir === 'N' && !againstWall(p)) f.z0 -= RECESS;     // up into the recess, to the back wall's face
    buildStairsUp(out, f, dir, p.colors, q);
  },
  stairsDown: (p, out, q) => buildStairsDown(out, cellsArea(p), flightDir(p), p.colors, q),
};
