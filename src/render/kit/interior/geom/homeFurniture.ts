// Home furniture geometry (Phase 4 Task 9): beds, tables, chairs, TVs, bookcases, plants, fridges, kitchen counters,
// cabinets, crates, bins and vases as soft, rounded models (Let's Go / BDSP rooms), coloured from the tiles. Pure: each
// builder writes Soup geometry for one piece given its footprint rectangles, colours, facing and seed — the piece shape
// is structurally Task 6's FurniturePiece, so furnitureHome.ts only routes the soups (low kinds into out.low / glassLow /
// glowLow, tall ones into out.tall / glass / glow, by isLow).
//
// Rules built in (controller rulings):
// - Real-world heights: each builder tops out at its footprint's `height` (FURNITURE_SPEC through fitFurniture), the
//   tallest part exactly there.
// - Chairs, plants, crates, vases and bins are one item per column of the piece (the family already makes one piece per
//   cell / column object: stacked ones never merge); tables, counters, cabinets, shelves and beds span their cells.
// - A chair at most LOW_SEAT high (on walkable cells: the family caps its height) is a low lounge seat (base, cushion,
//   arms, a low back) that still shows its facing; taller chairs get legs, a cushioned seat at 0.45 and a back.
// - A bed takes the lowest of its cells' heights: a head cell the player can step onto (capped like a seat) makes the
//   whole bed a low platform bed, so its pillow end never clips the player.
// - Counters, cabinets, TVs, fridges and bookcases span the piece's south row (non-rectangular components: the row
//   that meets the room) at the footprint's depth; the bookcase is addShelf sized to it (F4).

import { Soup, lathe, tube, lin, type LatheColor } from '../../soup';
import { luma, mix, saturation, scale, soften, type RGB } from '../../palette';
import { rng, type V3 } from '../../geom';
import type { Quality } from '../../../post';
import type { FurnitureKind } from '../../tables/building';
import type { PartColors } from '../colors';
import type { WallDir } from '../room';
import { addShelf, wallFrameAt } from '../wallParts';

/** A footprint (world): x [x0, x1], z [z0, z1] on the floor at y, `height` tall (Task 6's Footprint). */
export interface HomeRect { x0: number; x1: number; z0: number; z1: number; y: number; height: number }
/** What a builder reads of a furniture piece (structurally Task 6's FurniturePiece). */
export interface HomePiece {
  foot: HomeRect; cellFeet: readonly HomeRect[]; facing: WallDir | null; colors: PartColors; seed: number;
}
/** Where a builder writes: the solid body, glass and glowing screens (the low or the tall set). */
export interface HomeSoups { body: Soup; glass: Soup; glow: Soup }
export type HomeBuilder = (p: HomePiece, s: HomeSoups, q: Quality) => void;

export const HOME_KINDS = ['bed', 'table', 'chair', 'tv', 'bookshelf', 'plant', 'fridge', 'sink', 'cabinet', 'crate',
  'trashCan', 'vase'] as const satisfies readonly FurnitureKind[];
export type HomeKind = (typeof HOME_KINDS)[number];

/** Per quality: lathe / blob sides, and segments per rounded edge. */
export const HOME_DETAIL: Readonly<Record<Quality, { sides: number; segs: number }>> = {
  low: { sides: 8, segs: 1 }, medium: { sides: 12, segs: 2 }, high: { sides: 16, segs: 3 },
};
/** A chair this high or lower is a low lounge seat (a walkable seat: the family caps it at WALKABLE_SEAT = 0.45). */
export const LOW_SEAT = 0.5;
/** A full chair's seat height. */
const SEAT_Y = 0.45;
/** The bed's nominal height (FURNITURE_SPEC.bed): its parts' levels below are at this height, scaled to the piece's. */
const BED_H = 0.55;

// ---------------------------------------------------------------- colours

const WOOD: RGB = [0.74, 0.55, 0.37];
const LINEN: RGB = [0.96, 0.95, 0.91];
const LEAF: RGB = [0.4, 0.66, 0.33];
const POT: RGB = [0.82, 0.52, 0.36];
const SOIL: RGB = [0.36, 0.26, 0.19];
const STEEL: RGB = [0.74, 0.77, 0.8];
const SCREEN: RGB = [0.32, 0.5, 0.72];
const INK: RGB = [0.17, 0.18, 0.21];
const BLANKET: RGB = [0.52, 0.62, 0.86];
const CUSHION: RGB = [0.88, 0.5, 0.38];
const BIN: RGB = [0.55, 0.64, 0.6];
const WHITE: RGB = [1, 1, 1];

/** The GBA's dark blue-grey outline (0x424a6b, 0x52526b …): the most frequent colour of small objects, never a surface. */
export const isOutline = (c: RGB) => luma(c) < 0.4 && saturation(c) < 0.3;
/** Warm wood / yellow (red ≥ green ≥ blue, red well over blue). */
export const isWood = (c: RGB) => c[0] >= c[1] - 0.02 && c[1] >= c[2] - 0.02 && c[0] - c[2] >= 0.15;
const isWhite = (c: RGB) => luma(c) > 0.85 && saturation(c) < 0.12;
const isGreen = (c: RGB) => c[1] > c[0] + 0.05 && c[1] > c[2] + 0.02;
const same = (a: RGB, b: RGB) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 0.06;

/** The part's candidate colours (main, second, accent), outline left out. */
const candidates = (c: PartColors) => [c.main, c.second, c.accent].filter((x) => !isOutline(x));
const pick = (c: PartColors, test: (x: RGB) => boolean) => candidates(c).find(test) ?? null;
/** The most saturated candidate at least `min` saturated (not white), passing `test`. */
function vivid(c: PartColors, min = 0.15, test: (x: RGB) => boolean = () => true): RGB | null {
  let best: RGB | null = null;
  for (const x of candidates(c)) if (!isWhite(x) && test(x) && saturation(x) >= min && (!best || saturation(x) > saturation(best))) best = x;
  return best;
}

/** A piece's colours by role (sRGB, soften()ed): wood (frames, tops, legs), body (a cabinet's, an appliance's), cushion,
 *  blanket and linen, leaf, pot and soil, cloth (a table's, when the art shows one), metal, dark. */
export interface HomeColors {
  wood: RGB; body: RGB; cushion: RGB; blanket: RGB; linen: RGB; leaf: RGB; pot: RGB; soil: RGB; cloth: RGB | null;
  metal: RGB; dark: RGB;
}

/** Colour rules per kind. Pixels only pick colours: the most frequent lit colour of a small object is usually the
 *  GBA's outline (skipped); wood is the first warm candidate; a table whose main colour is a soft non-wood tint (pink,
 *  teal) wears it as a cloth; plants keep a leaf green when the art's frequent colours have none. */
export function homeColors(kind: HomeKind, c: PartColors): HomeColors {
  const first = candidates(c)[0] ?? null;
  const wood = pick(c, isWood) ?? WOOD;
  const out: HomeColors = {
    wood, body: first ?? mix(c.main, WHITE, 0.45), cushion: vivid(c) ?? CUSHION, blanket: BLANKET, linen: LINEN,
    leaf: LEAF, pot: POT, soil: SOIL, cloth: null, metal: STEEL, dark: INK,
  };
  switch (kind) {
    case 'bed': {
      // a coloured blanket (the warm wood / gold of the GBA's frames stays the frame)
      out.blanket = vivid(c, 0.2, (x) => !isWood(x)) ?? pick(c, (x) => !isWhite(x)) ?? BLANKET;
      out.wood = pick(c, (x) => isWood(x) && !same(x, out.blanket)) ?? WOOD;
      out.linen = pick(c, isWhite) ? mix(pick(c, isWhite)!, LINEN, 0.5) : LINEN;
      break;
    }
    case 'table': {
      const m = c.main;
      if (!isOutline(m) && !isWood(m) && !isWhite(m) && saturation(m) >= 0.15) out.cloth = m;
      out.wood = pick(c, (x) => isWood(x) && !(out.cloth && same(x, out.cloth))) ?? WOOD;
      break;
    }
    case 'chair': {
      out.cushion = vivid(c) ?? first ?? CUSHION;
      out.wood = pick(c, (x) => isWood(x) && !same(x, out.cushion)) ?? WOOD;
      break;
    }
    case 'bookshelf': {
      // wood, else the outline's blue-grey lightened: a painted case (the GBA's teal-grey bookcases)
      out.wood = pick(c, isWood) ?? mix(isOutline(c.main) ? c.main : [0.4, 0.45, 0.52], WHITE, 0.4);
      break;
    }
    case 'plant': {
      out.leaf = pick(c, isGreen) ?? LEAF;
      out.pot = pick(c, (x) => !isGreen(x)) ?? POT;
      break;
    }
    case 'fridge': case 'sink': {
      out.body = mix(first ?? [0.8, 0.8, 0.76], WHITE, kind === 'fridge' ? 0.35 : 0.15);
      break;
    }
    case 'tv': {
      out.body = INK;
      out.wood = pick(c, isWood) ?? mix(pick(c, (x) => !isWhite(x)) ?? [0.58, 0.58, 0.6], WHITE, 0.25);
      break;
    }
    case 'trashCan': {
      out.body = first ?? BIN;
      break;
    }
    case 'vase': {
      out.body = vivid(c) ?? first ?? [0.74, 0.55, 0.2];
      break;
    }
    default:
      break;
  }
  const o = out as unknown as Record<string, RGB | null>;
  for (const k of Object.keys(o)) { const v = o[k]; if (v) o[k] = soften(clamp01(v)); }
  return out;
}
const clamp01 = (c: RGB): RGB => [Math.min(1, Math.max(0, c[0])), Math.min(1, Math.max(0, c[1])), Math.min(1, Math.max(0, c[2]))];

// ---------------------------------------------------------------- shapes

/** A vertical gradient (bottom, top) or one colour; linear. */
type Shade = RGB | readonly [RGB, RGB];
const isPair = (c: Shade): c is readonly [RGB, RGB] => typeof c[0] !== 'number';
/** sRGB → a soft linear gradient: `dim` darker at the bottom. */
const grad = (c: RGB, dim = 0.86): readonly [RGB, RGB] => [lin(scale(c, dim)), lin(c)];

/** A box x [x0, x1] × y [y0, y1] × z [z0, z1] with every top and vertical edge rounded by `r` (the bottom too when
 *  `roundBottom`: a cushion, a pillow), `segs` segments per rounded edge; open underneath unless rounded. Colour: one, or a
 *  (bottom, top) gradient; linear. */
export function roundBox(s: Soup, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, r: number,
  col: Shade, segs: number, roundBottom = false): void {
  const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, hy = y1 - y0;
  if (hx <= 0 || hz <= 0 || hy <= 0) return;
  r = Math.max(0, Math.min(r, hx, hz, roundBottom ? hy / 2 : hy));
  const [cb, ct] = isPair(col) ? col : [col, col];
  const colAt = (y: number) => mix(cb, ct, (y - y0) / hy);
  if (r < 1e-4) {
    if (!isPair(col)) { s.box([0, 0, 0], [1, 0, 0], [0, 0, 1], x0, x1, y0, y1, z0, z1, col, roundBottom); return; }
  }
  // the profile: (h = the corner arcs' radius, y, normal's horizontal and vertical parts), bottom to top
  const prof: { h: number; y: number; c: number; sn: number }[] = [];
  if (roundBottom && r > 0) {
    for (let i = 0; i <= segs; i++) { const t = -Math.PI / 2 + (i / segs) * (Math.PI / 2); prof.push({ h: r * Math.cos(t), y: y0 + r + r * Math.sin(t), c: Math.cos(t), sn: Math.sin(t) }); }
  } else prof.push({ h: r, y: y0, c: 1, sn: 0 });
  for (let i = 0; i <= segs; i++) { const t = (i / segs) * (Math.PI / 2); prof.push({ h: r * Math.cos(t), y: y1 - r + r * Math.sin(t), c: Math.cos(t), sn: Math.sin(t) }); }
  const ccx = [x1 - r, x0 + r, x0 + r, x1 - r], ccz = [z1 - r, z1 - r, z0 + r, z0 + r];
  const ring = (k: number) => {
    const p = prof[k], pts: { p: V3; n: V3 }[] = [];
    for (let j = 0; j < 4; j++) {
      for (let m = 0; m <= segs; m++) {
        const a = (j + m / segs) * (Math.PI / 2), ca = Math.cos(a), sa = Math.sin(a);
        pts.push({ p: [ccx[j] + p.h * ca, p.y, ccz[j] + p.h * sa], n: [p.c * ca, p.sn, p.c * sa] });
      }
    }
    return pts;
  };
  let prev = ring(0);
  for (let k = 1; k < prof.length; k++) {
    const cur = ring(k), n = cur.length;
    const c0 = colAt(prof[k - 1].y), c1 = colAt(prof[k].y);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, A = prev[i], B = prev[j], C = cur[j], D = cur[i];
      const face: V3 = [A.n[0] + B.n[0] + C.n[0] + D.n[0], A.n[1] + B.n[1] + C.n[1] + D.n[1], A.n[2] + B.n[2] + C.n[2] + D.n[2]];
      s.quadN(A.p, B.p, C.p, D.p, face, [A.n, B.n, C.n, D.n], [c0, c0, c1, c1]);
    }
    prev = cur;
  }
  const top: V3[] = [[x0 + r, y1, z0 + r], [x1 - r, y1, z0 + r], [x1 - r, y1, z1 - r], [x0 + r, y1, z1 - r]];
  if (r < hx && r < hz) s.quad(top[0], top[1], top[2], top[3], [0, 1, 0], ct);
  if (roundBottom && r < hx && r < hz) s.quad([x0 + r, y0, z0 + r], [x1 - r, y0, z0 + r], [x1 - r, y0, z1 - r], [x0 + r, y0, z1 - r], [0, -1, 0], cb);
}

/** An ellipsoid blob at `c` with radii (rx, ry, rz), `sides` round (a multiple of 4: its extents are exactly the radii)
 *  and sides / 2 rings; colour bottom → top (linear). */
export function blob(s: Soup, c: V3, rx: number, ry: number, rz: number, col: Shade, sides: number): void {
  const rings = Math.max(2, Math.round(sides / 2));
  const [cb, ct] = isPair(col) ? col : [col, col];
  const at = (i: number, q: number) => {
    const phi = -Math.PI / 2 + (i / rings) * Math.PI, lam = (q / sides) * Math.PI * 2;
    const cp = Math.cos(phi), sp = Math.sin(phi), cl = Math.cos(lam), sl = Math.sin(lam);
    const nx = (cp * cl) / rx, ny = sp / ry, nz = (cp * sl) / rz, l = Math.hypot(nx, ny, nz) || 1;
    return { p: [c[0] + rx * cp * cl, c[1] + ry * sp, c[2] + rz * cp * sl] as V3, n: [nx / l, ny / l, nz / l] as V3, col: mix(cb, ct, (sp + 1) / 2) };
  };
  for (let i = 0; i < rings; i++) {
    for (let q = 0; q < sides; q++) {
      const A = at(i, q), B = at(i, q + 1), C = at(i + 1, q + 1), D = at(i + 1, q);
      const m = at(i + 0.5, q + 0.5);
      s.quadN(A.p, B.p, C.p, D.p, m.n, [A.n, B.n, C.n, D.n], [A.col, B.col, C.col, D.col]);
    }
  }
}

/** A tapered round leg from y0 to y1 at (x, z): radius r1 at the top, r0 at the foot. */
function leg(s: Soup, x: number, z: number, y0: number, y1: number, r0: number, r1: number, col: LatheColor, sides: number): void {
  lathe(s, [x, y0, z], [[0, 0], [r0, 0], [r1, y1 - y0], [0, y1 - y0]], [col, col, col], sides);
}

// ---------------------------------------------------------------- piece helpers

/** The piece's south row: the x span of the cells whose footprint meets the room (the largest z1), at the piece's depth
 *  and height. A rectangular piece: its footprint. */
function southRow(p: HomePiece): HomeRect {
  const f = p.foot, row = p.cellFeet.filter((c) => Math.abs(c.z1 - f.z1) < 1e-6);
  if (!row.length) return f;
  return { ...f, x0: Math.min(...row.map((c) => c.x0)), x1: Math.max(...row.map((c) => c.x1)) };
}

/** One rectangle per column of the piece (single items: chairs, plants, crates …), at the piece's depth; its height the
 *  lowest of the column's cells. No cells: the footprint. */
function columns(p: HomePiece): HomeRect[] {
  const f = p.foot;
  if (!p.cellFeet.length) return [f];
  const byX = new Map<number, HomeRect[]>();
  for (const c of p.cellFeet) { const k = Math.round(c.x0 * 1000); if (!byX.has(k)) byX.set(k, []); byX.get(k)!.push(c); }
  return [...byX.values()].sort((a, b) => a[0].x0 - b[0].x0)
    .map((cs) => ({ ...f, x0: cs[0].x0, x1: cs[0].x1, height: Math.min(f.height, ...cs.map((c) => c.height)) }));
}

const DIR: Readonly<Record<WallDir, [number, number]>> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// ---------------------------------------------------------------- builders

function bed(p: HomePiece, s: HomeSoups, q: Quality): void {
  const f = p.foot, { segs } = HOME_DETAIL[q], C = homeColors('bed', p.colors);
  const H = Math.min(f.height, ...p.cellFeet.map((c) => c.height)), t = H / BED_H, Y = f.y;
  const { x0, x1, z0, z1 } = f, W = x1 - x0, D = z1 - z0;
  const wood = grad(C.wood, 0.8), linen = grad(C.linen, 0.9), blanket = grad(C.blanket, 0.82);
  // legs, frame and the headboard at the head (north) end
  for (const [lx, lz] of [[x0 + 0.1, z0 + 0.14], [x1 - 0.1, z0 + 0.14], [x0 + 0.1, z1 - 0.1], [x1 - 0.1, z1 - 0.1]]) {
    roundBox(s.body, lx - 0.045, lx + 0.045, Y, Y + 0.08 * t, lz - 0.045, lz + 0.045, 0.015, lin(scale(C.wood, 0.7)), segs);
  }
  roundBox(s.body, x0 + 0.05, x1 - 0.05, Y + 0.07 * t, Y + 0.26 * t, z0 + 0.06, z1 - 0.04, 0.04, wood, segs);
  roundBox(s.body, x0 + 0.03, x1 - 0.03, Y, Y + H, z0 + 0.01, z0 + 0.1, 0.045, wood, segs);
  // mattress, pillows, blanket with its turned-down sheet
  roundBox(s.body, x0 + 0.08, x1 - 0.08, Y + 0.24 * t, Y + 0.4 * t, z0 + 0.1, z1 - 0.06, 0.06, linen, segs);
  const pd = Math.min(0.36, D * 0.2), pz0 = z0 + 0.13, n = W >= 1.6 ? 2 : 1, gap = 0.06;
  const pw = (W - 0.26 - (n - 1) * gap) / n;
  for (let k = 0; k < n; k++) {
    const px0 = x0 + 0.13 + k * (pw + gap);
    roundBox(s.body, px0, px0 + pw, Y + 0.38 * t, Y + 0.5 * t, pz0, pz0 + pd, 0.06, linen, segs, true);
  }
  const bz0 = pz0 + pd + 0.05;
  roundBox(s.body, x0 + 0.065, x1 - 0.065, Y + 0.22 * t, Y + 0.46 * t, bz0, z1 - 0.05, 0.06, blanket, segs);
  roundBox(s.body, x0 + 0.06, x1 - 0.06, Y + 0.3 * t, Y + 0.475 * t, bz0 - 0.01, bz0 + Math.min(0.15, (z1 - bz0) * 0.25), 0.05, linen, segs);
}

function table(p: HomePiece, s: HomeSoups, q: Quality): void {
  const f = p.foot, { sides, segs } = HOME_DETAIL[q], C = homeColors('table', p.colors), Y = f.y, H = f.height;
  const tx0 = f.x0 + 0.05, tx1 = f.x1 - 0.05, tz0 = f.z0 + 0.05, tz1 = f.z1 - 0.05;
  const wood = grad(C.wood, 0.85), legC = lin(scale(C.wood, 0.78));
  if (C.cloth) {
    // a cloth over the top, hanging a hand's width over its edge
    roundBox(s.body, tx0 - 0.03, tx1 + 0.03, Y + H - 0.13, Y + H, tz0 - 0.03, tz1 + 0.03, 0.03, grad(C.cloth, 0.8), segs);
  } else {
    roundBox(s.body, tx0, tx1, Y + H - 0.06, Y + H, tz0, tz1, 0.03, wood, segs);
  }
  roundBox(s.body, tx0 + 0.07, tx1 - 0.07, Y + H - 0.15, Y + H - 0.05, tz0 + 0.07, tz1 - 0.07, 0.015, lin(scale(C.wood, 0.85)), segs);
  // legs at the corners, and every ≤ 2 units along a long side
  const lx = spaced(tx0 + 0.11, tx1 - 0.11), lz = spaced(tz0 + 0.11, tz1 - 0.11);
  for (const x of lx) for (const z of lz) {
    if (x !== lx[0] && x !== lx[lx.length - 1] && z !== lz[0] && z !== lz[lz.length - 1]) continue;
    leg(s.body, x, z, Y, Y + H - 0.1, 0.03, 0.045, legC, sides);
  }
}
/** Positions from a to b, at most 2 apart (both ends included). */
function spaced(a: number, b: number): number[] {
  const n = Math.max(1, Math.ceil((b - a) / 2 - 1e-9));
  return Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
}

function chair(p: HomePiece, s: HomeSoups, q: Quality): void {
  const C = homeColors('chair', p.colors);
  for (const R of columns(p)) chairAt(s.body, R, p.facing ?? 'S', C, q);
}
function chairAt(s: Soup, R: HomeRect, facing: WallDir, C: HomeColors, q: Quality): void {
  const { sides, segs } = HOME_DETAIL[q], H = R.height, Y = R.y, low = H <= LOW_SEAT + 1e-9;
  const f = DIR[facing], g: [number, number] = [-f[1], f[0]], alongX = f[0] !== 0;
  // the chair's size along its facing (la) and across it (lb), fitted to the rectangle
  const w = R.x1 - R.x0, d = R.z1 - R.z0;
  let la = low ? 0.56 : 0.5, lb = low ? 0.62 : 0.5;
  const ex = Math.min(alongX ? la : lb, w - 0.06), ez = Math.min(alongX ? lb : la, d - 0.04);
  la = alongX ? ex : ez; lb = alongX ? ez : ex;
  // pulled a little towards its table
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  const cx = clamp((R.x0 + R.x1) / 2 + f[0] * 0.1, R.x0 + ex / 2, R.x1 - ex / 2);
  const cz = clamp((R.z0 + R.z1) / 2 + f[1] * 0.1, R.z0 + ez / 2, R.z1 - ez / 2);
  /** A rounded box in the chair's frame: a along its facing (−la/2 = its back), b across. */
  const L = (a0: number, a1: number, b0: number, b1: number, y0: number, y1: number, r: number, col: Shade, rb = false) => {
    const xa = [cx + f[0] * a0 + g[0] * b0, cx + f[0] * a1 + g[0] * b1], za = [cz + f[1] * a0 + g[1] * b0, cz + f[1] * a1 + g[1] * b1];
    roundBox(s, Math.min(...xa), Math.max(...xa), Y + y0, Y + y1, Math.min(...za), Math.max(...za), r, col, segs, rb);
  };
  const A = la / 2, B = lb / 2;
  const cushion = grad(C.cushion, 0.82), light = grad(mix(C.cushion, WHITE, 0.3), 0.88);
  if (low) {
    // a low lounge seat: base, seat cushion, arms and a low back (top = H)
    L(-A + 0.02, A, -B + 0.02, B - 0.02, 0, 0.55 * H, 0.05, cushion);
    L(-A + 0.12, A - 0.01, -B + 0.1, B - 0.1, 0.5 * H, 0.7 * H, 0.05, light, true);
    L(-A, -A + 0.13, -B, B, 0, H, 0.05, cushion);
    L(-A, A - 0.02, -B, -B + 0.1, 0, 0.84 * H, 0.045, cushion);
    L(-A, A - 0.02, B - 0.1, B, 0, 0.84 * H, 0.045, cushion);
    return;
  }
  const wood = grad(C.wood, 0.82), legC = lin(scale(C.wood, 0.78));
  for (const a of [-A + 0.05, A - 0.05]) for (const b of [-B + 0.05, B - 0.05]) {
    leg(s, cx + f[0] * a + g[0] * b, cz + f[1] * a + g[1] * b, Y, Y + SEAT_Y - 0.06, 0.022, 0.03, legC, sides);
  }
  L(-A, A, -B, B, SEAT_Y - 0.07, SEAT_Y - 0.02, 0.02, wood);
  L(-A + 0.06, A - 0.02, -B + 0.03, B - 0.03, SEAT_Y - 0.04, SEAT_Y + 0.03, 0.035, cushion, true);
  L(-A, -A + 0.06, -B, B, SEAT_Y - 0.06, H, 0.03, wood);
  L(-A + 0.055, -A + 0.1, -B + 0.07, B - 0.07, SEAT_Y + 0.08, H - 0.08, 0.02, cushion, true);
}

function tv(p: HomePiece, s: HomeSoups, q: Quality): void {
  const R = southRow(p), { segs } = HOME_DETAIL[q], C = homeColors('tv', p.colors), Y = R.y, H = R.height;
  const { x0, x1, z0, z1 } = R, W = x1 - x0, cx = (x0 + x1) / 2;
  // the low cabinet with two drawers
  roundBox(s.body, x0 + 0.1, x1 - 0.1, Y, Y + 0.05, z0 + 0.04, z1 - 0.08, 0.01, lin(scale(C.wood, 0.55)), segs);
  roundBox(s.body, x0 + 0.04, x1 - 0.04, Y + 0.04, Y + 0.44, z0 + 0.01, z1 - 0.03, 0.035, grad(C.wood, 0.85), segs);
  const n = Math.max(2, Math.round((W - 0.08) / 0.5)), dw = (W - 0.08 - 0.06) / n;
  for (let k = 0; k < n; k++) {
    const dx0 = x0 + 0.07 + k * dw;
    roundBox(s.body, dx0 + 0.015, dx0 + dw - 0.015, Y + 0.1, Y + 0.38, z1 - 0.03, z1 - 0.012, 0.012, lin(mix(C.wood, WHITE, 0.12)), segs);
    roundBox(s.body, dx0 + dw / 2 - 0.06, dx0 + dw / 2 + 0.06, Y + 0.33, Y + 0.35, z1 - 0.012, z1, 0.006, lin(scale(C.wood, 0.6)), segs);
  }
  // a flat screen on a stand
  const zc = z0 + (z1 - z0) * 0.42, pw = Math.min(0.92, W - 0.12), body = grad(C.body, 0.9);
  roundBox(s.body, cx - 0.14, cx + 0.14, Y + 0.44, Y + 0.47, zc - 0.08, zc + 0.08, 0.02, body, segs);
  roundBox(s.body, cx - 0.03, cx + 0.03, Y + 0.46, Y + 0.6, zc - 0.02, zc + 0.02, 0.01, body, segs);
  const pz1 = zc + 0.025;
  roundBox(s.body, cx - pw / 2, cx + pw / 2, Y + 0.55, Y + H, zc - 0.025, pz1, 0.02, body, segs);
  const sx0 = cx - pw / 2 + 0.035, sx1 = cx + pw / 2 - 0.035, sy0 = Y + 0.585, sy1 = Y + H - 0.035, z = pz1 + 0.002;
  const lo = lin(scale(SCREEN, 0.7)), hi = lin(mix(SCREEN, WHITE, 0.35));
  s.glow.quadN([sx0, sy0, z], [sx1, sy0, z], [sx1, sy1, z], [sx0, sy1, z], [0, 0, 1], [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]], [lo, lo, hi, hi]);
}

function bookshelf(p: HomePiece, s: HomeSoups, _q: Quality): void {
  const R = southRow(p), C = homeColors('bookshelf', p.colors), W = R.x1 - R.x0;
  const F = wallFrameAt([R.x0, R.y, R.z0], [1, 0, 0], [0, 0, 1], [0, W]);
  addShelf(s.body, F, W / 2, C.wood, p.seed, W, R.height, R.z1 - R.z0);
}

function plant(p: HomePiece, s: HomeSoups, q: Quality): void {
  const C = homeColors('plant', p.colors), r = rng(p.seed * 31 + 0x91a7);
  for (const R of columns(p)) plantAt(s.body, R, C, q, r);
}
function plantAt(s: Soup, R: HomeRect, C: HomeColors, q: Quality, r: () => number): void {
  const { sides } = HOME_DETAIL[q], Y = R.y, H = R.height;
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, hw = (R.x1 - R.x0) / 2 - 0.03, hd = (R.z1 - R.z0) / 2 - 0.02;
  // the pot: a soft-rimmed lathe with soil
  const P = Math.min(0.24, hw - 0.02, hd - 0.02), ph = Math.min(0.42, H * 0.32);
  const pot = lin(C.pot), potLo = lin(scale(C.pot, 0.78)), rim = lin(mix(C.pot, WHITE, 0.18));
  lathe(s, [cx, Y, cz], [[0, 0], [P * 0.7, 0], [P * 0.76, 0.02], [P * 0.96, ph - 0.05], [P, ph - 0.03], [P, ph], [P * 0.88, ph], [P * 0.86, ph - 0.03]],
    [potLo, [potLo, pot], pot, rim, rim, rim, rim], sides);
  lathe(s, [cx, Y, cz], [[P * 0.86, ph - 0.03], [0, ph - 0.03]], [lin(C.soil)], sides);
  // the stem and the leaf crown: blobs round the axis, the top one touching the plant's height
  const crownY = ph + (H - ph) * 0.55, maxR = Math.min(hw, hd);
  tube(s, [[cx, Y + ph - 0.03, cz], [cx, Y + crownY, cz]], 0.025, lin(scale(C.leaf, 0.55)), Math.max(6, sides / 2));
  const leaf = (k: number): readonly [RGB, RGB] => {
    const c = mix(C.leaf, k > 0.5 ? mix(C.leaf, [1, 1, 0.8], 0.4) : scale(C.leaf, 0.8), Math.abs(k - 0.5));
    return [lin(scale(c, 0.68)), lin(mix(c, WHITE, 0.12))];
  };
  const n = sides <= 8 ? 4 : sides <= 12 ? 5 : 6;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + r() * 0.6, rr = 0.15 + 0.05 * r(), ry = rr * (0.8 + 0.2 * r());
    const off = Math.max(0, Math.min(maxR - rr, 0.08 + 0.07 * r()));
    const by = Math.min(Y + crownY + (r() - 0.4) * 0.16, Y + H - ry);
    const rx = Math.min(rr, maxR), rz = Math.min(rr, hd);
    blob(s, [cx + Math.cos(a) * Math.min(off, hw - rx), by, cz + Math.sin(a) * Math.min(off, hd - rz)], rx, ry, rz, leaf(r()), sides);
  }
  const tr = Math.min(0.19, maxR), ty = Math.min(0.2, (H - ph) * 0.35);
  blob(s, [cx, Y + H - ty, cz], tr, ty, Math.min(tr, hd), leaf(0.9), sides);
}

function fridge(p: HomePiece, s: HomeSoups, q: Quality): void {
  const R = southRow(p), { segs } = HOME_DETAIL[q], C = homeColors('fridge', p.colors), Y = R.y, H = R.height;
  const { x0, x1, z0, z1 } = R, split = Y + H * 0.64;
  roundBox(s.body, x0 + 0.08, x1 - 0.08, Y, Y + 0.06, z0 + 0.02, z1 - 0.1, 0.01, lin(C.dark), segs);
  roundBox(s.body, x0 + 0.05, x1 - 0.05, Y + 0.05, Y + H, z0 + 0.01, z1 - 0.05, 0.06, grad(C.body, 0.9), segs);
  const door = grad(mix(C.body, WHITE, 0.15), 0.94), handle = lin(mix(C.metal, C.dark, 0.25));
  roundBox(s.body, x0 + 0.07, x1 - 0.07, split + 0.015, Y + H - 0.07, z1 - 0.06, z1 - 0.035, 0.03, door, segs);
  roundBox(s.body, x0 + 0.07, x1 - 0.07, Y + 0.1, split - 0.015, z1 - 0.06, z1 - 0.035, 0.03, door, segs);
  const hx0 = x1 - 0.2, hx1 = x1 - 0.16;
  roundBox(s.body, hx0, hx1, split + 0.06, split + 0.3, z1 - 0.035, z1 - 0.005, 0.015, handle, segs);
  roundBox(s.body, hx0, hx1, split - 0.45, split - 0.08, z1 - 0.035, z1 - 0.005, 0.015, handle, segs);
}

function sink(p: HomePiece, s: HomeSoups, q: Quality): void {
  const R = southRow(p), { sides, segs } = HOME_DETAIL[q], C = homeColors('sink', p.colors), Y = R.y, H = R.height;
  const { x0, x1, z0, z1 } = R, top = Y + H - 0.07;
  // the cupboard with doors, the worktop
  roundBox(s.body, x0 + 0.04, x1 - 0.04, Y, Y + 0.08, z0 + 0.02, z1 - 0.09, 0.01, lin(C.dark), segs);
  roundBox(s.body, x0 + 0.02, x1 - 0.02, Y + 0.07, top - 0.03, z0 + 0.01, z1 - 0.04, 0.02, grad(C.body, 0.86), segs);
  roundBox(s.body, x0, x1, top - 0.04, top, z0, z1, 0.015, grad(mix(C.body, WHITE, 0.45), 0.95), segs);
  const units = Math.max(1, Math.round(x1 - x0));
  const uw = (x1 - x0) / units, door = grad(mix(C.body, WHITE, 0.2), 0.9), knob = lin(mix(C.metal, C.dark, 0.3));
  for (let k = 0; k < units; k++) {
    const u0 = x0 + k * uw;
    for (const [a, b] of [[0.05, 0.495], [0.505, 0.95]]) {
      roundBox(s.body, u0 + uw * a, u0 + uw * b, Y + 0.13, top - 0.1, z1 - 0.04, z1 - 0.02, 0.015, door, segs);
    }
    roundBox(s.body, u0 + uw * 0.43, u0 + uw * 0.47, top - 0.24, top - 0.16, z1 - 0.02, z1, 0.008, knob, segs);
    roundBox(s.body, u0 + uw * 0.53, u0 + uw * 0.57, top - 0.24, top - 0.16, z1 - 0.02, z1, 0.008, knob, segs);
  }
  // the basin in the west unit (the GBA draws the sink west of the stove), a tap behind it
  const steel = lin(C.metal), deep = lin(scale(C.metal, 0.55));
  const bx0 = x0 + uw * 0.16, bx1 = x0 + uw * 0.84, bz0 = z0 + 0.1, bz1 = z1 - 0.07, rimH = 0.018;
  roundBox(s.body, bx0, bx1, top, top + rimH, bz0, bz0 + 0.03, 0.006, steel, segs);
  roundBox(s.body, bx0, bx1, top, top + rimH, bz1 - 0.03, bz1, 0.006, steel, segs);
  roundBox(s.body, bx0, bx0 + 0.03, top, top + rimH, bz0, bz1, 0.006, steel, segs);
  roundBox(s.body, bx1 - 0.03, bx1, top, top + rimH, bz0, bz1, 0.006, steel, segs);
  s.body.quad([bx0 + 0.03, top + 0.002, bz0 + 0.03], [bx1 - 0.03, top + 0.002, bz0 + 0.03], [bx1 - 0.03, top + 0.002, bz1 - 0.03],
    [bx0 + 0.03, top + 0.002, bz1 - 0.03], [0, 1, 0], deep);
  const tx = (bx0 + bx1) / 2, tz = z0 + 0.05, tr = 0.016, ty = Y + H - tr;
  tube(s.body, [[tx, top, tz], [tx, ty - 0.03, tz], [tx, ty, tz + 0.03], [tx, ty - 0.02, tz + 0.13], [tx, ty - 0.06, tz + 0.15]], tr, steel, Math.max(6, sides / 2));
  // the stove in the next unit: a dark hob with two burner rings
  if (units >= 2) {
    const u0 = x0 + uw, hob = lin(C.dark), ring = lin(scale(C.metal, 0.7));
    roundBox(s.body, u0 + 0.08, u0 + uw - 0.08, top, top + 0.012, z0 + 0.06, z1 - 0.05, 0.02, hob, segs);
    for (const fx of [0.32, 0.68]) {
      lathe(s.body, [u0 + uw * fx, top + 0.012, (z0 + z1) / 2], [[0.11, 0], [0.11, 0.012], [0.075, 0.012], [0.075, 0]], [ring, ring, ring], sides);
    }
  }
}

function cabinet(p: HomePiece, s: HomeSoups, q: Quality): void {
  const R = southRow(p), { segs } = HOME_DETAIL[q], C = homeColors('cabinet', p.colors), Y = R.y, H = R.height;
  const { x0, x1, z0, z1 } = R;
  roundBox(s.body, x0 + 0.05, x1 - 0.05, Y, Y + 0.07, z0 + 0.02, z1 - 0.08, 0.01, lin(C.dark), segs);
  roundBox(s.body, x0 + 0.03, x1 - 0.03, Y + 0.06, Y + H - 0.04, z0 + 0.01, z1 - 0.04, 0.03, grad(C.body, 0.85), segs);
  const topC = same(C.wood, C.body) ? mix(C.body, WHITE, 0.3) : C.wood;
  roundBox(s.body, x0 + 0.01, x1 - 0.01, Y + H - 0.05, Y + H, z0, z1 - 0.01, 0.02, grad(topC, 0.9), segs);
  // per cell-wide unit: two drawers over two doors, small knobs
  const units = Math.max(1, Math.round(x1 - x0)), uw = (x1 - x0) / units;
  const panel = grad(mix(C.body, WHITE, 0.14), 0.9), knob = lin(mix(C.metal, C.dark, 0.3)), fz = z1 - 0.04;
  for (let k = 0; k < units; k++) {
    const u0 = x0 + k * uw;
    for (const [a, b] of [[0.06, 0.495], [0.505, 0.94]]) {
      roundBox(s.body, u0 + uw * a, u0 + uw * b, Y + 0.12, Y + H * 0.62, fz, fz + 0.02, 0.015, panel, segs);
      roundBox(s.body, u0 + uw * a, u0 + uw * b, Y + H * 0.65, Y + H - 0.1, fz, fz + 0.02, 0.015, panel, segs);
      const m = u0 + uw * (a + b) / 2;
      roundBox(s.body, m - 0.04, m + 0.04, Y + H * 0.76, Y + H * 0.78, fz + 0.02, fz + 0.035, 0.006, knob, segs);
    }
    roundBox(s.body, u0 + uw * 0.44, u0 + uw * 0.475, Y + H * 0.42, Y + H * 0.52, fz + 0.02, fz + 0.035, 0.006, knob, segs);
    roundBox(s.body, u0 + uw * 0.525, u0 + uw * 0.56, Y + H * 0.42, Y + H * 0.52, fz + 0.02, fz + 0.035, 0.006, knob, segs);
  }
}

function crate(p: HomePiece, s: HomeSoups, q: Quality): void {
  const C = homeColors('crate', p.colors), r = rng(p.seed * 13 + 0x3c5);
  for (const R of columns(p)) crateAt(s.body, R, C, q, r);
}
function crateAt(s: Soup, R: HomeRect, C: HomeColors, q: Quality, r: () => number): void {
  const { segs } = HOME_DETAIL[q], Y = R.y, H = R.height;
  const w = Math.min(0.86, R.x1 - R.x0 - 0.08), d = Math.min(0.78, R.z1 - R.z0 - 0.04);
  const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  const plank = () => lin(mix(scale(C.wood, 0.9), mix(C.wood, WHITE, 0.15), r()));
  const post = lin(scale(C.wood, 0.72)), P = 0.07, e = 0.022;
  // the core, the corner posts
  roundBox(s, x0 + e, x1 - e, Y, Y + H - e, z0 + e, z1 - e, 0.005, lin(scale(C.wood, 0.5)), segs);
  for (const [px, pz] of [[x0, z0], [x1 - P, z0], [x0, z1 - P], [x1 - P, z1 - P]]) roundBox(s, px, px + P, Y, Y + H, pz, pz + P, 0.012, post, segs);
  // three planks per side, three on top
  const n = 3, gap = 0.025, ph = (H - 0.04 - (n - 1) * gap) / n;
  for (let k = 0; k < n; k++) {
    const y0 = Y + 0.02 + k * (ph + gap), y1 = y0 + ph;
    roundBox(s, x0 + P, x1 - P, y0, y1, z1 - e, z1, 0.008, plank(), segs);
    roundBox(s, x0 + P, x1 - P, y0, y1, z0, z0 + e, 0.008, plank(), segs);
    roundBox(s, x0, x0 + e, y0, y1, z0 + P, z1 - P, 0.008, plank(), segs);
    roundBox(s, x1 - e, x1, y0, y1, z0 + P, z1 - P, 0.008, plank(), segs);
  }
  const tw = (w - 2 * P - (n - 1) * gap) / n;
  for (let k = 0; k < n; k++) {
    const a = x0 + P + k * (tw + gap);
    roundBox(s, a, a + tw, Y + H - e - 0.004, Y + H - 0.004, z0 + P * 0.5, z1 - P * 0.5, 0.008, plank(), segs);
  }
}

function trashCan(p: HomePiece, s: HomeSoups, q: Quality): void {
  const { sides } = HOME_DETAIL[q], C = homeColors('trashCan', p.colors);
  for (const R of columns(p)) {
    const H = R.height, Rr = Math.min(0.21, (R.x1 - R.x0) / 2 - 0.04, (R.z1 - R.z0) / 2 - 0.02);
    const body = lin(C.body), lo = lin(scale(C.body, 0.78)), lid = lin(mix(C.body, WHITE, 0.2));
    lathe(s.body, [(R.x0 + R.x1) / 2, R.y, (R.z0 + R.z1) / 2],
      [[0, 0], [Rr * 0.76, 0], [Rr * 0.8, 0.02], [Rr * 0.95, H - 0.08], [Rr, H - 0.07], [Rr, H - 0.04], [Rr * 0.92, H - 0.02],
        [Rr * 0.55, H - 0.005], [Rr * 0.2, H], [0, H]],
      [lo, [lo, body], body, body, lid, lid, lid, lid, lid], sides);
  }
}

function vase(p: HomePiece, s: HomeSoups, q: Quality): void {
  const { sides } = HOME_DETAIL[q], C = homeColors('vase', p.colors);
  for (const R of columns(p)) {
    const H = R.height, k = Math.min(1, ((R.z1 - R.z0) / 2 - 0.02) / 0.17, ((R.x1 - R.x0) / 2 - 0.03) / 0.17);
    const v = lin(C.body), lo = lin(scale(C.body, 0.72)), hi = lin(mix(C.body, WHITE, 0.22));
    const prof: [number, number][] = [[0, 0], [0.09, 0], [0.13, 0.05 * H / 0.6], [0.17, 0.18 * H / 0.6], [0.155, 0.31 * H / 0.6],
      [0.095, 0.43 * H / 0.6], [0.068, 0.5 * H / 0.6], [0.078, 0.56 * H / 0.6], [0.095, H], [0.07, H], [0.055, 0.5 * H / 0.6]];
    lathe(s.body, [(R.x0 + R.x1) / 2, R.y, (R.z0 + R.z1) / 2], prof.map(([rr, y]) => [rr * k, y] as [number, number]),
      [lo, [lo, v], [v, hi], [hi, v], v, v, hi, hi, lo, lo], sides);
  }
}

/** The builders, one per home kind. */
export const HOME_BUILDERS: Readonly<Record<HomeKind, HomeBuilder>> = {
  bed, table, chair, tv, bookshelf, plant, fridge, sink, cabinet, crate, trashCan, vase,
};
