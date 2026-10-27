// Interior colours from the live tiles (Phase 4, D2: pixels decide colours, never what a cell is), pure: a part's main /
// second / accent / dark colours, a back wall's shell colours, a floor's tint. All sRGB.

import type { MapAnalysis } from '../../overworld/analyze';
import type { TileInfo } from '../../overworld/tileInfo';
import { bgr555ToSrgb, luma, mix, saturation, scale, soften, type RGB } from '../palette';
import type { InteriorId } from '../tables/building';
import type { ShellColors } from './wallParts';
import type { RoomLayout } from './room';

export interface PartColors { main: RGB; second: RGB; accent: RGB; dark: RGB }   // sRGB

/** Lit: luma at least this. */
const LIT = 0.2;
/** `second` differs from `main` by at least this in a channel. */
const SECOND_DIFF = 0.1;
/** `accent`: saturation at least this, on at least ACCENT_PX pixels. */
const ACCENT_SAT = 0.3, ACCENT_PX = 6;
/** A part with no pixel at all. */
const NO_COLOUR: RGB = [0.5, 0.5, 0.5];
/** A back wall with no wall art at all (a warm off-white). */
const PLAIN_WALL: RGB = [0.86, 0.82, 0.74];

/** main: most frequent lit colour (luma ≥ 0.2) of the metatiles' pixels; second: the next most frequent with a channel
 *  ≥ 0.1 from main (else main); accent: the most saturated colour (saturation ≥ 0.3) with ≥ 6 px (else second); dark:
 *  the most frequent with luma < 0.2 (else main × 0.5). A metatile listed twice counts twice. No lit pixel: main is
 *  the most frequent colour (grey when there is no pixel at all). */
export function partColors(info: TileInfo, metatiles: readonly number[], layer: 'both' | 'bottom' = 'both'): PartColors {
  const px = layer === 'both' ? info.both : info.bottom;
  const counts = new Map<number, number>();
  for (const m of metatiles) {
    for (let p = 0; p < 256; p++) {
      const v = px[m * 256 + p];
      if (!(v & 0x8000)) counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  // most frequent first (ties: the lower BGR555 value, for determinism)
  const ranked = [...counts].sort((p, q) => q[1] - p[1] || p[0] - q[0]).map(([v, n]) => ({ c: bgr555ToSrgb(v), n }));
  const lit = ranked.filter((e) => luma(e.c) >= LIT);
  const main = lit[0]?.c ?? ranked[0]?.c ?? NO_COLOUR;
  const second = lit.find((e) => e.c.some((v, k) => Math.abs(v - main[k]) >= SECOND_DIFF))?.c ?? main;
  let accent: RGB | null = null, accentSat = -1;
  for (const e of ranked) {
    const s = saturation(e.c);
    if (e.n >= ACCENT_PX && s >= ACCENT_SAT && s > accentSat) { accent = e.c; accentSat = s; }
  }
  const dark = ranked.find((e) => luma(e.c) < LIT)?.c ?? scale(main, 0.5);
  return { main, second, accent: accent ?? second, dark };
}

/** A back wall's colours: wall = main of its `wall` cells' top rows, wainscot = main of the band's lowest row's `wall`
 *  cells, base = wainscot × 0.6, panel = wainscot × 1.05, trim = mix(wall, white, 0.5); soften()ed.
 *  "Top rows": the band's `wall` cells above its lowest row (a one-row band: its own row). With no `wall` cell the
 *  band's cells stand in (all of them for both), with no band a plain warm off-white. */
export function wallColors(a: MapAnalysis, L: RoomLayout, ids: readonly (InteriorId | null)[]): ShellColors {
  const upper: number[] = [], lowest: number[] = [], any: number[] = [];
  for (let i = 0; i < a.N; i++) {
    if (!L.band[i] || L.partition[i]) continue;        // the back wall's band (partitions are no back wall)
    any.push(a.mt[i]);
    if (ids[i] !== 'wall') continue;
    const x = a.cellX(i), y = a.cellY(i);
    const j = a.inside(x, y + 1) ? a.idx(x, y + 1) : -1;
    const below = j >= 0 && L.band[j] === 1 && !L.partition[j];
    (below ? upper : lowest).push(a.mt[i]);
  }
  const mainOf = (mts: number[]) => (mts.length ? partColors(a.info, mts).main : null);
  const fallback = mainOf(any) ?? PLAIN_WALL;
  const wall = mainOf(upper) ?? mainOf(lowest) ?? fallback;
  const wainscot = mainOf(lowest) ?? mainOf(upper) ?? fallback;
  const clamp = (c: RGB): RGB => [Math.min(1, c[0]), Math.min(1, c[1]), Math.min(1, c[2])];
  return {
    wall: soften(wall),
    wainscot: soften(wainscot),
    base: soften(scale(wainscot, 0.6)),
    panel: soften(clamp(scale(wainscot, 1.05))),
    trim: soften(mix(wall, [1, 1, 1], 0.5)),
  };
}

/** A floor metatile's look: main of its bottom layer, soften()ed. */
export function floorLook(info: TileInfo, m: number): { tint: RGB } {
  return { tint: soften(partColors(info, [m], 'bottom').main) };
}
