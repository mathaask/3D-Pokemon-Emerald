// Service furniture geometry (Phase 4 Task 10, pure): the Pokémon Center's healing machine and nurse's counter, shop and
// reception counters, computers, the Mart's double-sided gondolas, and stairs up / down. Each builder writes triangle
// soups (kit/soup.ts) from plain parameters — a footprint rectangle in world units, the part's tile colours, a seed, a
// quality — so that furnitureService.ts only adapts a FurniturePiece to them (Phase B).
//
// Heights are real-world (D6): the footprint's `height` (FURNITURE_SPEC: counter / pcCounter 0.88, pc 1.2, healer
// 1.3, martShelf 1.6, stairsUp 1.6). Low pieces (≤ 1.2: counters, computers, the stairwell) write to `low` (screens to
// `glowLow`), tall ones (healer, gondola, stairs up) to `tall` (`glow`): D7, nothing low fades. Every glowing part is in
// a glow soup of its own (one glowMesh per soup: its material has a single user). Colours: the tile's part colours
// through soften(), made linear; the healing machine's Poké Balls are fixed red / white. Style: soft rounded shapes
// (plan-rounded corners on every exposed corner), clean colours.

import { lathe, lin, tube, type Soup } from '../../soup';
import { rng, type V3 } from '../../geom';
import * as THREE from 'three';
import { mix, scale, soften, type RGB } from '../../palette';
import { isOutline } from './homeFurniture';
import type { Quality } from '../../../post';
import type { PartColors } from '../colors';
import type { WallDir } from '../room';

/** A footprint in world units: x [x0, x1], z [z0, z1] on the floor at height y (Task 6's Footprint fits it). */
export interface Rect { x0: number; x1: number; z0: number; z1: number; y: number }
/** A footprint with the piece's real-world height. */
export interface Sized extends Rect { height: number }
/** The soups the builders write (Task 6's FurnitureOut fits it). */
export interface ServiceSoups { tall: Soup; low: Soup; glow: Soup; glowLow: Soup }
/** Which sides of a block are open (seen): an open side is inset and its corners rounded; a closed one meets a neighbour
 *  flush. */
export interface Sides { n: boolean; e: boolean; s: boolean; w: boolean }
export const ALL_OPEN: Readonly<Sides> = { n: true, e: true, s: true, w: true };

/** Lathe sides per quality (as the home kit), the small goods' and rails' sides, rounded-corner segments. */
export const LATHE_SIDES: Readonly<Record<Quality, number>> = { low: 8, medium: 12, high: 16 };
export const SMALL_SIDES: Readonly<Record<Quality, number>> = { low: 6, medium: 8, high: 10 };
export const CORNER_SEGS: Readonly<Record<Quality, number>> = { low: 2, medium: 3, high: 4 };

/** The healing machine's Poké Balls (sRGB, used as they are: the test finds them by colour). */
export const BALL_RED: RGB = [0.85, 0.15, 0.15];
export const BALL_WHITE: RGB = [0.96, 0.96, 0.94];
/** The healing machine's lit panel and the computers' screens (sRGB vertex colours; glowMesh adds the emissive). */
export const PANEL_GLOW: RGB = [0.62, 0.95, 0.82];
export const SCREEN_GLOW: RGB = [0.6, 0.82, 0.95];

/** Stairs: each step rises / falls this much; the flight climbs to (or falls to) STAIRS_TOP. */
export const STEP_RISE = 0.2;
export const STAIRS_TOP = 1.6;
/** A rail's top over the floor or the treads, its post and tube sizes. */
export const RAIL = { height: 0.9, post: 0.045, radius: 0.025, inset: 0.05 };

/** A top / tread of the body's colour is lifted this far towards white (and tinted this much towards the accent); an
 *  outline-coloured body with no other surface colour, OUTLINE_LIFT. */
export const TOP_LIFT = 0.3, TOP_TINT = 0.12, OUTLINE_LIFT = 0.55;

/** The part's colours for surfaces, softened and made linear. The GBA rings its counters, shelves, machines and stairs
 *  in a dark blue-grey outline (0x52526b, 0x424a6b …: the kit's one `isOutline` rule, geom/homeFurniture.ts) that is
 *  often a part's most frequent colour: never a surface. `main` the body (the tile's main; an outline main gives way to
 *  the second, or is lifted towards white), `second` the top (the tile's second when it is no outline and apart from the
 *  body, else the body lifted towards white with a hint of accent), `accent` (an outline accent gives way to the top),
 *  `dark`, and `goods` (a shop's packaging: the accent, its lighter tone and three other hues round it). */
export interface LinColors { main: RGB; second: RGB; accent: RGB; dark: RGB; goods: RGB[] }
export function serviceColors(c: PartColors): LinColors {
  const body = !isOutline(c.main) ? c.main : !isOutline(c.second) ? c.second : mix(c.main, [1, 1, 1], OUTLINE_LIFT);
  const accent0 = isOutline(c.accent) ? null : c.accent;
  const top = body !== c.second && !isOutline(c.second) ? c.second
    : mix(mix(body, [1, 1, 1], TOP_LIFT), accent0 ?? body, TOP_TINT);
  const accent = accent0 ?? (top !== body ? top : mix(body, [1, 1, 1], 0.5));
  const goods: RGB[] = [accent, mix(accent, [1, 1, 1], 0.4), hueShift(accent, 0.1), hueShift(accent, -0.12), hueShift(accent, 0.4)];
  const L = (x: RGB) => lin(soften(x));
  return { main: L(body), second: L(top), accent: L(accent), dark: L(c.dark), goods: goods.map(L) };
}

const _c = new THREE.Color(), _hsl = { h: 0, s: 0, l: 0 };
/** `c` (sRGB) with its hue turned by `dh` (turns), its saturation kept at least 0.45 and its lightness in 0.4..0.7 (bright
 *  packaging). */
function hueShift(c: RGB, dh: number): RGB {
  _c.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace).getHSL(_hsl, THREE.SRGBColorSpace);
  _c.setHSL((_hsl.h + dh + 1) % 1, Math.max(0.45, _hsl.s), Math.min(0.7, Math.max(0.4, _hsl.l)), THREE.SRGBColorSpace);
  const o = { r: 0, g: 0, b: 0 }; _c.getRGB(o, THREE.SRGBColorSpace);
  return [o.r, o.g, o.b];
}

// ---------------------------------------------------------------------------------------------------------------------
// Rounded blocks

/** A lathe (kit/soup.ts) in one colour. */
export function solid(s: Soup, at: V3, prof: readonly (readonly [number, number])[], col: RGB, sides: number): void {
  lathe(s, at, prof, prof.slice(1).map(() => col), sides);
}

/** A block over `r` from y0 to y1 (over r.y): its open sides inset by `inset`, the corners between two open sides
 *  rounded (radius clamped to the block), smooth round the corners; top and sides, no underside. */
export function roundedBlock(s: Soup, r: Rect, y0: number, y1: number, inset: number, radius: number, open: Sides,
  side: RGB, top: RGB, segs: number): void {
  const X0 = r.x0 + (open.w ? inset : 0), X1 = r.x1 - (open.e ? inset : 0);
  const Z0 = r.z0 + (open.n ? inset : 0), Z1 = r.z1 - (open.s ? inset : 0);
  if (X1 - X0 < 1e-6 || Z1 - Z0 < 1e-6 || y1 - y0 < 1e-6) return;
  const rr = Math.max(0, Math.min(radius, (X1 - X0) / 2, (Z1 - Z0) / 2));
  const Y0 = r.y + y0, Y1 = r.y + y1;
  // corners SE, SW, NW, NE: θ walks (cos θ, sin θ) in (x, z) from east round through south
  const corners: [number, number, number, number, boolean][] = [
    [X1, Z1, 1, 1, open.e && open.s], [X0, Z1, -1, 1, open.s && open.w], [X0, Z0, -1, -1, open.w && open.n], [X1, Z0, 1, -1, open.n && open.e],
  ];
  const pts: { x: number; z: number; n: V3 }[] = [];
  corners.forEach(([cx, cz, sx, sz, round], k) => {
    const a0 = (k * Math.PI) / 2, rad = round ? rr : 0, steps = rad > 0 ? segs : 1;
    const ox = cx - sx * rad, oz = cz - sz * rad;
    for (let j = 0; j <= steps; j++) {
      const t = a0 + ((Math.PI / 2) * j) / steps, c = Math.cos(t), sn = Math.sin(t);
      const nx = Math.abs(c) < 1e-12 ? 0 : c, nz = Math.abs(sn) < 1e-12 ? 0 : sn;
      pts.push({ x: ox + rad * nx, z: oz + rad * nz, n: [nx, 0, nz] });
    }
  });
  const cx = (X0 + X1) / 2, cz = (Z0 + Z1) / 2;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    if (Math.hypot(b.x - a.x, b.z - a.z) < 1e-9) continue;
    const face: V3 = [a.n[0] + b.n[0], 0, a.n[2] + b.n[2]];
    s.quadN([a.x, Y0, a.z], [b.x, Y0, b.z], [b.x, Y1, b.z], [a.x, Y1, a.z], face, [a.n, b.n, b.n, a.n], [side, side, side, side]);
    s.tri([cx, Y1, cz], [a.x, Y1, a.z], [b.x, Y1, b.z], [0, 1, 0], top);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Counters (the nurse's and the shops')

/** A rectangle of a counter's cells: cells cx0..cx1 × cy0..cy1, its world rectangle, which sides are open, and its
 *  height cap (the lowest of its cells' footprints: a walkable cell's is low; Infinity when the feet carry none). */
export interface CounterRect extends Rect { cx0: number; cx1: number; cy0: number; cy1: number; open: Sides; height: number }

/** A counter component's cells (grid `xy`, with each cell's own footprint `feet` in the same order) as rectangles, cell
 *  by cell: row runs, merged down while their columns match. A rectangle with more rows than columns is a bar running
 *  north–south: it spans its north row's footprint to its south row's; any other runs east–west, anchored at its south
 *  row's footprints, COUNTER.bar deep at most (the clerk standing north of it shows from the chest up: I2). Two
 *  rectangles one over the other meet: the upper reaches south to the lower when its columns lie within the lower's (the
 *  U's arms reach the bar, which keeps its depth), else the lower reaches north to the upper (an L's arm, a ring's sides
 *  meet their bar); touching sides are closed. Nothing reaches over a cell that is not the component's (the walkable
 *  cells inside a ring, a U or an L stay clear). */
export function counterRects(xy: readonly (readonly [number, number])[], feet: readonly (Rect & { height?: number })[]): CounterRect[] {
  const foot = new Map<string, Rect & { height?: number }>();
  xy.forEach(([x, y], i) => foot.set(`${x},${y}`, feet[i]));
  const rows = new Map<number, number[]>();
  for (const [x, y] of xy) {
    if (!rows.has(y)) rows.set(y, []);
    rows.get(y)!.push(x);
  }
  const rects: CounterRect[] = [];
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const xs = [...new Set(rows.get(y)!)].sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      const cx0 = xs[i], cx1 = xs[j];
      const above = rects.find((r) => r.cx0 === cx0 && r.cx1 === cx1 && r.cy1 === y - 1);
      if (above) above.cy1 = y;
      else rects.push({ cx0, cx1, cy0: y, cy1: y, x0: 0, x1: 0, z0: 0, z1: 0, y: 0, open: { n: true, e: true, s: true, w: true }, height: Infinity });
      i = j + 1;
    }
  }
  for (const r of rects) {
    const row = (y: number) => { const fs: (Rect & { height?: number })[] = []; for (let x = r.cx0; x <= r.cx1; x++) fs.push(foot.get(`${x},${y}`)!); return fs; };
    const ns = r.cy1 - r.cy0 > r.cx1 - r.cx0, south = row(r.cy1), north = ns ? row(r.cy0) : south;
    r.x0 = Math.min(...south.map((f) => f.x0)); r.x1 = Math.max(...south.map((f) => f.x1));
    r.z1 = Math.max(...south.map((f) => f.z1));
    r.z0 = Math.max(...north.map((f) => f.z0), ns ? -Infinity : r.z1 - COUNTER.bar);
    r.y = south[0].y;
    for (let y = r.cy0; y <= r.cy1; y++) for (const f of row(y)) r.height = Math.min(r.height, f.height ?? Infinity);
  }
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0) > 1e-6;
  for (const a of rects) {
    for (const b of rects) {
      if (b.cy0 === a.cy1 + 1 && Math.min(a.cx1, b.cx1) >= Math.max(a.cx0, b.cx0)) {
        if (a.cx0 >= b.cx0 && a.cx1 <= b.cx1) a.z1 = Math.max(a.z1, b.z0);
        else b.z0 = Math.min(b.z0, a.z1);
        a.open.s = false; b.open.n = false;
      }
    }
  }
  for (const a of rects) {
    for (const b of rects) {
      if (b.cx0 === a.cx1 + 1 && overlap(a.z0, a.z1, b.z0, b.z1)) { a.open.e = false; b.open.w = false; }
    }
  }
  return rects;
}

/** Counter proportions (the height is the footprint's: FURNITURE_SPEC's serving counter, 0.88 — the nurse and the clerks
 *  behind it read from the chest up at the default camera, as on the GBA: controller ruling I2): an east–west bar's
 *  depth at most, top slab, toe kick, the nurse's front band, insets and corner radius. With the bar 0.72 deep its edge
 *  stands 0.28 south of the clerk's feet: at the Classic pitch (0.82 rad) a sprite shows from about 0.58 up. */
export const COUNTER = {
  bar: 0.72, top: 0.07, kick: 0.08, kickInset: 0.1, bodyInset: 0.05, bandInset: 0.035, band: [0.5, 0.64], radius: 0.12,
};

/** A counter over its rectangles, `top` tall (a rectangle's own cap lower): a toe kick in dark, a body in main, a top in
 *  second (overhanging the body on its open sides); `band` (the nurse's counter) adds a front band in accent round its
 *  open sides. Low. */
export function buildCounter(s: Soup, rects: readonly CounterRect[], top: number, c: PartColors, q: Quality, band: boolean): void {
  const k = serviceColors(c), segs = CORNER_SEGS[q], C = COUNTER;
  for (const r of rects) {
    const height = Math.min(top, r.height);
    roundedBlock(s, r, 0, C.kick, C.kickInset, C.radius - C.kickInset, r.open, k.dark, k.dark, segs);
    roundedBlock(s, r, C.kick, height - C.top, C.bodyInset, C.radius - C.bodyInset, r.open, k.main, k.main, segs);
    if (band && C.band[1] < height - C.top) roundedBlock(s, r, C.band[0], C.band[1], C.bandInset, C.radius - C.bandInset, r.open, k.accent, k.accent, segs);
    roundedBlock(s, r, height - C.top, height, 0, C.radius, r.open, k.second, k.second, segs);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Computers

/** Computer proportions: desk top height, monitor size, keyboard. */
export const PC = { desk: 0.74, deskTop: 0.05, monitorW: 0.62, monitorH: 0.38, monitorD: 0.12, neck: 0.06, bezel: 0.035, keyD: 0.14, keyH: 0.02 };

/** A computer desk over `f` (`f.height` tall: the monitors' tops): a cabinet desk in main with a top in second, one
 *  monitor per whole cell of width (at least one) in second with its screen in `glowLow`, a keyboard in front. All low. */
export function buildPc(out: ServiceSoups, f: Sized, c: PartColors, q: Quality): void {
  const k = serviceColors(c), segs = CORNER_SEGS[q], P = PC, s = out.low;
  roundedBlock(s, f, 0, 0.06, 0.08, 0.06, ALL_OPEN, k.dark, k.dark, segs);
  roundedBlock(s, f, 0.06, P.desk - P.deskTop, 0.04, 0.06, ALL_OPEN, k.main, k.main, segs);
  roundedBlock(s, f, P.desk - P.deskTop, P.desk, 0, 0.08, ALL_OPEN, k.second, k.second, segs);
  const w = f.x1 - f.x0, n = Math.max(1, Math.floor(w + 1e-6)), unit = w / n;
  const mw = Math.min(P.monitorW, unit * 0.8), top = f.height, mz0 = f.z0 + 0.06, mz1 = mz0 + P.monitorD;
  const shell = mix(k.second, k.dark, 0.35), keys = mix(k.dark, k.second, 0.4);
  for (let i = 0; i < n; i++) {
    const cx = f.x0 + unit * (i + 0.5);
    const mon: Rect = { x0: cx - mw / 2, x1: cx + mw / 2, z0: mz0, z1: mz1, y: f.y };
    roundedBlock(s, { ...mon, x0: cx - 0.05, x1: cx + 0.05, z0: mz0 + 0.03, z1: mz1 - 0.03 }, P.desk, top - P.monitorH, 0, 0.02, ALL_OPEN, shell, shell, segs);
    roundedBlock(s, mon, top - P.monitorH, top, 0, 0.03, ALL_OPEN, shell, shell, segs);
    const sy0 = f.y + top - P.monitorH + P.bezel, sy1 = f.y + top - P.bezel, sz = mz1 + 0.004;
    out.glowLow.quad([mon.x0 + P.bezel, sy0, sz], [mon.x1 - P.bezel, sy0, sz], [mon.x1 - P.bezel, sy1, sz], [mon.x0 + P.bezel, sy1, sz], [0, 0, 1], lin(SCREEN_GLOW));
    const kz1 = Math.min(f.z1 - 0.06, mz1 + 0.08 + P.keyD);
    roundedBlock(s, { x0: cx - mw * 0.4, x1: cx + mw * 0.4, z0: kz1 - P.keyD, z1: kz1, y: f.y }, P.desk, P.desk + P.keyH, 0, 0.02, ALL_OPEN, keys, keys, segs);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The healing machine

/** Healing machine proportions: console, deck, back panel (its lit screen), cradles. */
export const HEALER = { kick: 0.06, console: 0.85, deck: 0.07, panelD: 0.16, panelInset: 0.15, wallGap: 0.04, screen: 0.045, ball: 0.08 };

/** The healing machine over `f` (`f.height` tall: the back panel's top): a rounded console in main on a dark kick, a
 *  deck in second, six cradles (accent dishes) holding Poké Balls (red / white lathes with a dark band) — three by two
 *  across its longer side — and a back panel whose screen glows (`glow`). Tall. */
export function buildHealer(out: ServiceSoups, f: Sized, c: PartColors, q: Quality): void {
  const k = serviceColors(c), segs = CORNER_SEGS[q], sides = LATHE_SIDES[q], H = HEALER, s = out.tall;
  const deckY = H.console + H.deck;
  roundedBlock(s, f, 0, H.kick, 0.08, 0.1, ALL_OPEN, k.dark, k.dark, segs);
  roundedBlock(s, f, H.kick, H.console, 0.04, 0.14, ALL_OPEN, k.main, k.main, segs);
  roundedBlock(s, f, H.console, deckY, 0, 0.16, ALL_OPEN, k.second, k.second, segs);
  // the back panel and its lit screen
  const panel: Rect = { x0: f.x0 + H.panelInset, x1: f.x1 - H.panelInset, z0: f.z0 + H.wallGap, z1: f.z0 + H.wallGap + H.panelD, y: f.y };
  roundedBlock(s, panel, deckY, f.height, 0, 0.05, ALL_OPEN, k.main, k.main, segs);
  const gz = panel.z1 + 0.004, gy0 = f.y + deckY + H.screen, gy1 = f.y + f.height - H.screen;
  out.glow.quad([panel.x0 + H.screen, gy0, gz], [panel.x1 - H.screen, gy0, gz], [panel.x1 - H.screen, gy1, gz], [panel.x0 + H.screen, gy1, gz], [0, 0, 1], lin(PANEL_GLOW));
  // six cradles on the deck in front of the panel
  const dx0 = f.x0 + 0.2, dx1 = f.x1 - 0.2, dz0 = panel.z1 + 0.05, dz1 = f.z1 - 0.06;
  const wide = dx1 - dx0 >= dz1 - dz0, nu = wide ? 3 : 2, nv = wide ? 2 : 3;
  const su = (dx1 - dx0) / nu, sv = (dz1 - dz0) / nv;
  const r = Math.min(H.ball, Math.min(su, sv) * 0.34), dish = r * 1.3;
  const red = lin(BALL_RED), white = lin(BALL_WHITE), band = lin([0.18, 0.18, 0.2]), dishC = mix(k.accent, k.dark, 0.3);
  const arc = (from: number, to: number, n: number): [number, number][] =>
    Array.from({ length: n + 1 }, (_, i) => { const t = from + ((to - from) * i) / n; return [r * Math.cos(t), r * Math.sin(t)] as [number, number]; });
  const half = Math.max(3, Math.round(sides / 4));
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const x = dx0 + su * (i + 0.5), z = dz0 + sv * (j + 0.5), y = f.y + deckY;
      solid(s, [x, y, z], [[dish, 0], [dish, 0.02], [dish * 0.8, 0.04], [0, 0.04]], dishC, sides);
      const cy = y + 0.04 + r * 0.75;
      solid(s, [x, cy, z], arc(-Math.PI / 2, 0, half).map(([a, b]) => [Math.abs(a) < 1e-9 ? 0 : a, b]), white, sides);
      solid(s, [x, cy, z], arc(0, Math.PI / 2, half).map(([a, b]) => [Math.abs(a) < 1e-9 ? 0 : a, b]), red, sides);
      solid(s, [x, cy, z], [[r * 1.02, -0.012], [r * 1.02, 0.012]], band, sides);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The Mart's gondola

/** Gondola proportions: plinth, end panels, divider, shelf levels, top cap. */
export const GONDOLA = { plinth: 0.1, end: 0.05, divider: 0.06, shelf: 0.03, levels: [0.1, 0.5, 0.9, 1.3], cap: 0.08, edge: 0.04 };

/** A double-sided gondola over `f` (`f.height` tall), along its longer side: a dark plinth, end panels and a divider in
 *  main, shelves in second on both faces, a rounded top cap, and rows of goods (boxes and cans, seeded) in the tile's
 *  accent and second colours, front-aligned on every shelf. `oneSided` (a wall unit, the wall north of it): along x,
 *  its back panel at the north edge, one face looking south. Tall. */
export function buildMartShelf(out: ServiceSoups, f: Sized, c: PartColors, seed: number, q: Quality, oneSided = false): void {
  const k = serviceColors(c), G = GONDOLA, s = out.tall, rand = rng(seed >>> 0);
  const alongX = oneSided || f.x1 - f.x0 >= f.z1 - f.z0;
  const L = alongX ? f.x1 - f.x0 : f.z1 - f.z0, D = alongX ? f.z1 - f.z0 : f.x1 - f.x0;
  const o: V3 = [f.x0, f.y, f.z0], u: V3 = alongX ? [1, 0, 0] : [0, 0, 1], w: V3 = alongX ? [0, 0, 1] : [1, 0, 0];
  const box = (s0: number, s1: number, y0: number, y1: number, d0: number, d1: number, col: RGB) => s.box(o, u, w, s0, s1, y0, y1, d0, d1, col);
  const rect = (s0: number, s1: number, d0: number, d1: number): Rect => alongX
    ? { x0: f.x0 + s0, x1: f.x0 + s1, z0: f.z0 + d0, z1: f.z0 + d1, y: f.y }
    : { x0: f.x0 + d0, x1: f.x0 + d1, z0: f.z0 + s0, z1: f.z0 + s1, y: f.y };
  const capY = f.height - G.cap, mid = D / 2, e = G.end;
  box(e, L - e, 0, G.plinth, 0.08, D - 0.08, k.dark);
  box(0, e, 0, capY, G.edge / 2, D - G.edge / 2, k.main);
  box(L - e, L, 0, capY, G.edge / 2, D - G.edge / 2, k.main);
  const back: [number, number] = oneSided ? [0, G.divider] : [mid - G.divider / 2, mid + G.divider / 2];
  box(e, L - e, G.plinth, capY, back[0], back[1], k.main);
  roundedBlock(s, rect(0, L, 0, D), capY, f.height, 0, 0.06, ALL_OPEN, k.second, k.second, CORNER_SEGS[q]);
  const goods = k.goods;
  const can = SMALL_SIDES[q];
  for (const side of oneSided ? [1] : [0, 1]) {
    const d0 = side === 0 ? G.edge : back[1], d1 = side === 0 ? back[0] : D - G.edge;
    G.levels.forEach((lv, li) => {
      if (lv + G.shelf >= capY) return;
      box(e, L - e, lv, lv + G.shelf, d0, d1, k.second);
      const base = lv + G.shelf, next = li + 1 < G.levels.length ? Math.min(G.levels[li + 1], capY) : capY, avail = next - base - 0.04;
      if (avail < 0.06) return;
      for (let pos = e + 0.03 + rand() * 0.04; ;) {
        const gw = 0.1 + rand() * 0.12;
        if (pos + gw > L - e - 0.03) break;
        const gh = Math.min(avail, 0.12 + rand() * 0.18), gd = Math.min(d1 - d0 - 0.04, 0.15 + rand() * 0.15);
        const col = scale(goods[Math.floor(rand() * goods.length)], 0.85 + rand() * 0.3);
        const front = side === 0 ? d0 + 0.02 : d1 - 0.02, g0 = side === 0 ? front : front - gd, g1 = side === 0 ? front + gd : front;
        if (rand() < 0.35) {
          const rad = Math.min(gw, gd) / 2 * 0.9, cs = pos + gw / 2, cd = (g0 + g1) / 2;
          const p: V3 = alongX ? [f.x0 + cs, f.y + base, f.z0 + cd] : [f.x0 + cd, f.y + base, f.z0 + cs];
          solid(s, p, [[rad, 0], [rad, gh], [0, gh]], col, can);
        } else box(pos, pos + gw, base, base + gh, g0, g1, col);
        pos += gw + 0.02 + rand() * 0.03;
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Stairs

/** A rectangle's frame for a flight along `dir`: origin at the low end's left corner, `along` (unit, towards dir) and
 *  `across` (unit), their lengths. */
function flightFrame(f: Rect, dir: WallDir): { o: V3; along: V3; across: V3; len: number; wid: number } {
  switch (dir) {
    case 'N': return { o: [f.x0, f.y, f.z1], along: [0, 0, -1], across: [1, 0, 0], len: f.z1 - f.z0, wid: f.x1 - f.x0 };
    case 'S': return { o: [f.x1, f.y, f.z0], along: [0, 0, 1], across: [-1, 0, 0], len: f.z1 - f.z0, wid: f.x1 - f.x0 };
    case 'E': return { o: [f.x0, f.y, f.z0], along: [1, 0, 0], across: [0, 0, 1], len: f.x1 - f.x0, wid: f.z1 - f.z0 };
    case 'W': return { o: [f.x1, f.y, f.z1], along: [-1, 0, 0], across: [0, 0, -1], len: f.x1 - f.x0, wid: f.z1 - f.z0 };
  }
}
/** The world point at (a, h, c) of a flight frame. */
const at = (F: { o: V3; along: V3; across: V3 }, a: number, h: number, c: number): V3 =>
  [F.o[0] + F.along[0] * a + F.across[0] * c, F.o[1] + h, F.o[2] + F.along[2] * a + F.across[2] * c];

/** The side of a flight frame a world side is: 'lo' (across = 0), 'hi' (across = wid), or null (an end). */
function crossSide(dir: WallDir, side: WallDir): 'lo' | 'hi' | null {
  const lo: Record<WallDir, WallDir> = { N: 'W', S: 'E', E: 'N', W: 'S' };
  const hi: Record<WallDir, WallDir> = { N: 'E', S: 'W', E: 'S', W: 'N' };
  return side === lo[dir] ? 'lo' : side === hi[dir] ? 'hi' : null;
}

/** Steps (solid, risers in main, treads in second with a runner in accent) over the frame, step i's tread at
 *  `tread(i)`, from `bottom`. */
function steps(s: Soup, F: ReturnType<typeof flightFrame>, n: number, bottom: number, tread: (i: number) => number, k: LinColors): void {
  const run = F.len / n, side = Math.min(0.15, F.wid * 0.18), t = 0.025;
  for (let i = 0; i < n; i++) {
    const a0 = i * run, a1 = (i + 1) * run, top = tread(i);
    s.box(F.o, F.across, F.along, 0, F.wid, bottom, top - t, a0, a1, k.main);
    s.box(F.o, F.across, F.along, 0, side, top - t, top, a0, a1, k.second);
    s.box(F.o, F.across, F.along, side, F.wid - side, top - t, top, a0, a1, k.accent);
    s.box(F.o, F.across, F.along, F.wid - side, F.wid, top - t, top, a0, a1, k.second);
  }
}

/** A rail along a polyline (world points at the rail's top), posts down to `foot(i)` under each point. */
function rail(s: Soup, pts: readonly V3[], foot: readonly number[], col: RGB, q: Quality): void {
  const R = RAIL, hp = R.post / 2;
  pts.forEach((p, i) => s.box([p[0], 0, p[2]], [1, 0, 0], [0, 0, 1], -hp, hp, foot[i], p[1] - R.radius, -hp, hp, col));
  tube(s, pts, R.radius, col, SMALL_SIDES[q]);
}

/** A flight of stairs over `f` rising towards `dir` (N: into the back wall's recess) to `f.height` (STAIRS_TOP) in
 *  STEP_RISE steps; `railSide` (a side across the flight, null: none) gets a handrail RAIL.height over the treads, never
 *  above the flight's top. Tall (> 1.2). */
export function buildStairsUp(out: ServiceSoups, f: Sized, dir: WallDir, railSide: WallDir | null, c: PartColors, q: Quality): void {
  const k = serviceColors(c), s = out.tall, F = flightFrame(f, dir);
  const n = Math.max(1, Math.round(f.height / STEP_RISE)), rise = f.height / n, run = F.len / n;
  steps(s, F, n, 0, (i) => (i + 1) * rise, k);
  const cs = railSide && crossSide(dir, railSide);
  if (!cs) return;
  const c0 = cs === 'lo' ? RAIL.inset : F.wid - RAIL.inset, pts: V3[] = [], feet: number[] = [];
  for (let i = 0; i < n; i += 2) {
    const tread = (i + 1) * rise, top = Math.min(tread + RAIL.height, f.height - RAIL.radius);
    pts.push(at(F, (i + 0.5) * run, top, c0)); feet.push(f.y + tread);
  }
  rail(s, pts, feet, mix(k.dark, k.second, 0.3), q);
}

/** The stairwell's floor under its last step. */
export const WELL_BOTTOM = 0.1;

/** A stairwell over `r` (its cells' whole area: Task 8 leaves them without floor) falling towards `dir` (N: away from
 *  the viewer) below the floor in STEP_RISE steps to −STAIRS_TOP: steps, the well's walls (fading to dark) on the sides
 *  and the far end, a lip at the entry edge, and a rail round the hole on `railSides` (default: every side but the
 *  entry). Low. */
export function buildStairsDown(out: ServiceSoups, r: Rect, dir: WallDir, c: PartColors, q: Quality,
  railSides?: readonly WallDir[]): void {
  const k = serviceColors(c), s = out.low, F = flightFrame(r, dir);
  const n = Math.round(STAIRS_TOP / STEP_RISE), bottom = -STAIRS_TOP - WELL_BOTTOM, L = F.len, W = F.wid;
  steps(s, F, n, bottom, (i) => -(i + 1) * STEP_RISE, k);
  const wall = mix(k.main, k.dark, 0.25), deep = k.dark;
  // walls facing into the well: the two sides, the far end; a lip at the entry edge (floor down to the first tread)
  const wq = (a: V3, b: V3, face: V3, y0: number) => {
    const A0: V3 = [a[0], r.y + y0, a[2]], B0: V3 = [b[0], r.y + y0, b[2]], B1: V3 = [b[0], r.y, b[2]], A1: V3 = [a[0], r.y, a[2]];
    s.quadN(A0, B0, B1, A1, face, [face, face, face, face], [deep, deep, wall, wall]);
  };
  wq(at(F, 0, 0, 0), at(F, L, 0, 0), F.across, bottom);
  wq(at(F, 0, 0, W), at(F, L, 0, W), [-F.across[0], 0, -F.across[2]], bottom);
  wq(at(F, L, 0, 0), at(F, L, 0, W), [-F.along[0], 0, -F.along[2]], bottom);
  wq(at(F, 0, 0, 0), at(F, 0, 0, W), F.along, -STEP_RISE);
  // the rail round the hole
  const entry: Record<WallDir, WallDir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
  const sides = railSides ?? (['N', 'E', 'S', 'W'] as const).filter((d) => d !== entry[dir]);
  const col = mix(k.dark, k.second, 0.3), i = RAIL.inset, h = RAIL.height;
  const edge: Record<WallDir, [V3, V3]> = {
    N: [[r.x0 + i, h, r.z0 + i], [r.x1 - i, h, r.z0 + i]], S: [[r.x0 + i, h, r.z1 - i], [r.x1 - i, h, r.z1 - i]],
    W: [[r.x0 + i, h, r.z0 + i], [r.x0 + i, h, r.z1 - i]], E: [[r.x1 - i, h, r.z0 + i], [r.x1 - i, h, r.z1 - i]],
  };
  for (const d of sides) {
    const [a, b] = edge[d], len = Math.hypot(b[0] - a[0], b[2] - a[2]), np = Math.max(2, Math.ceil(len / 0.5) + 1);
    const pts: V3[] = Array.from({ length: np }, (_, j) => {
      const t = j / (np - 1);
      return [a[0] + (b[0] - a[0]) * t, r.y + h, a[2] + (b[2] - a[2]) * t];
    });
    rail(s, pts, pts.map(() => r.y), col, q);
  }
}
