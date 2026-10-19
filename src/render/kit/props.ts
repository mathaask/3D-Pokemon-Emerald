// Props: sign posts and mailboxes (from sign events and the General table), fences built as
// continuous posts and rails along their runs (around corners too), lamp posts that glow at night,
// rocks and bushes.
//
// A prop only replaces cells that hold nothing but props: every blocked cell of its column's
// block run must be a prop (a fence over a sign, a 2x2 rock), but for at most two cells below them
// (a fence ending at a wall), so a prop id drawn as part of a cliff face, a building or a hedge
// stays theirs. The analysis' building flood fill swallows
// fences, lamp posts and signs beside buildings: those cells (`stray`, outside every footprint)
// are blocks here. Some fence posts and cone rocks are tree ids for the analysis (NARROW_TREE):
// the table wins over that.

import * as THREE from 'three';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { bgr555ToSrgb, dominantColor, luma, mix, saturation, soften, toLinear, scale, type RGB } from './palette';
import { QuadWriter, hashCell, noise3, type V3 } from './geom';
import { kitMaterial } from './materials';
import { blobCrown } from './trees';
import { isRocky } from './cliffs';
import { buildingKind, buildingLayout } from './footprints';
import { GENERAL_BIG_ROCKS, GENERAL_FENCE_SHAPES, GENERAL_PROPS, type FenceShape, type PropKind } from './tables/general';
import { SECONDARY_PROPS } from './tables/secondary';
import type { Family, KitContext, SemanticContext } from './semantics';

export interface PropPlacement {
  kind: PropKind;
  /** Columns x0..x1 of row y (the prop's front row; it stands on the ground in front of it). */
  x0: number; x1: number; y: number;
  /** Ground level it stands on. */
  h: number;
  /** Main colour (sRGB): a sign's board, a fence's posts, a rock. */
  color: RGB;
  /** Second colour (sRGB): a sign's face, a mailbox's slot, a bollard's cap. */
  trim?: RGB;
  /** Rows above y it covers too (a 2x2 rock: 1; a N-S fence run: its length - 1). */
  rows?: number;
  /** Fences: ground level under the run's last cell (default h; the rails slope between the first
   *  and the last cell's centres: a run beside a ramp). */
  h1?: number;
  /** Signs: posts under the board (1: one in the middle; default 2). */
  posts?: 1 | 2;
  /** Fences: the rails' line in grid units, (x, z) of both ends (z = grid row: the model adds the
   *  ground height). Default: E-W along the middle of row y, from x0 to x1 + 1. */
  line?: [number, number, number, number];
}

/** Inclusive [top, bottom] rows of the vertical run of `isB` cells containing (x, y). */
export function blockRun(a: MapAnalysis, x: number, y: number, isB: (i: number) => boolean): [number, number] {
  let t = y, b = y;
  while (t - 1 >= a.minY && isB(a.idx(x, t - 1))) t--;
  while (b + 1 < a.maxY && isB(a.idx(x, b + 1))) b++;
  return [t, b];
}

const FENCES = new Set<PropKind>(['fenceWhite', 'fenceWood', 'fenceMetal']);
/** A fence piece the table gives no shape: a straight E-W run along the cell's middle. */
const STRAIGHT: FenceShape = { arms: 'EW', fx: 0.5, fz: 0.5 };
/** Boulders of the table: single cells, or 2x2 by their four tiles. */
const BIG_ROCK = new Map<number, number>(); // metatile -> its 2x2 rock's index * 4 + corner
GENERAL_BIG_ROCKS.forEach((q, k) => q.forEach((m, c) => BIG_ROCK.set(m, k * 4 + c)));
/** A sign tile whose own pixels are more than this share foliage is a mossy stone, not a sign. */
const MOSSY = 0.3;

/** BGR555 colours of a metatile's pixels that are not the ground behind it (the prop's own). */
function ownPixels(a: MapAnalysis, m: number): Map<number, number> {
  const g = a.groundRefs[m];
  const ground = new Set<number>();
  if (g >= 0 && g !== m) for (let p = 0; p < 256; p++) ground.add(a.info.both[g * 256 + p]);
  const counts = new Map<number, number>();
  for (let p = 0; p < 256; p++) {
    const v = a.info.both[m * 256 + p];
    if (v & 0x8000 || ground.has(v)) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return counts;
}

interface Look { color: RGB; board: RGB; mean: RGB; trim: RGB; leafy: boolean; posts: 1 | 2 }

const isLeaf = (c: RGB) => c[1] > c[0] + 0.06 && c[1] >= c[2];

/**
 * A prop tile's colours, from its own pixels less the grass around it: the most frequent, outlines
 * and shadows left out (a fence, a post), their mean (a rock's shades), a sign's board (dark frames
 * count) and its face (clearly unlike the board, saturated if there is such a colour); whether its
 * own pixels are mostly foliage; one post or two under a sign (its own pixels in the rows above
 * the shadow at its foot: a narrow band in the middle is one post).
 */
function lookOf(a: MapAnalysis, m: number): Look {
  const own = ownPixels(a, m);
  const sorted = [...own.entries()].sort((p, q) => q[1] - p[1]).map(([v, n]) => ({ c: bgr555ToSrgb(v), n }));
  let total = 0, leaf = 0;
  for (const { c, n } of sorted) {
    total += n;
    if (isLeaf(c)) leaf += n;
  }
  const body = sorted.filter(({ c }) => luma(c) > 0.35 && !isLeaf(c));
  const main = body[0]?.c ?? dominantColor(a.info.both, [m], (c) => luma(c) > 0.2) ?? [0.6, 0.6, 0.6];
  const board = sorted.find(({ c }) => luma(c) > 0.25 && !isLeaf(c))?.c ?? main;
  const far = (c: RGB) => Math.max(Math.abs(c[0] - board[0]), Math.abs(c[1] - board[1]), Math.abs(c[2] - board[2])) > 0.15;
  const trim = body.find(({ c }) => far(c) && saturation(c) > 0.2)?.c ?? body.find(({ c }) => far(c))?.c ?? mix(board, [1, 1, 1], 0.4);
  const mean: RGB = [0, 0, 0];
  let n = 0;
  for (const { c, n: k } of body) { mean[0] += c[0] * k; mean[1] += c[1] * k; mean[2] += c[2] * k; n += k; }
  // own pixels in rows 11-12: their horizontal extent
  let lo = 16, hi = -1;
  for (let p = 11 * 16; p < 13 * 16; p++) {
    const v = a.info.both[m * 256 + p];
    if (v & 0x8000 || !own.has(v)) continue;
    lo = Math.min(lo, p & 15);
    hi = Math.max(hi, p & 15);
  }
  return {
    color: soften(main), board: soften(board), mean: soften(n ? [mean[0] / n, mean[1] / n, mean[2] / n] : main), trim: soften(trim),
    leafy: total > 0 && leaf / total > MOSSY, posts: hi >= 0 && hi - lo <= 5 ? 1 : 2,
  };
}

const UP = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3(), _s = new THREE.Vector3(), _u = new THREE.Vector3();

export const propFamily: Family<PropPlacement[]> = {
  name: 'props',

  extract({ a, events }: SemanticContext, claims: Claims): PropPlacement[] {
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const out: PropPlacement[] = [];
    const { idx, inside, kind, mt } = a;
    const { stray, owner, footprints } = buildingLayout(a, events);
    const looks = new Map<number, Look>();
    const look = (m: number) => {
      let l = looks.get(m);
      if (!l) { l = lookOf(a, m); looks.set(m, l); }
      return l;
    };
    const secondary = SECONDARY_PROPS.get(a.opts.secondaryTileset ?? 0);
    /** The curated tables' kind of a cell's metatile (the General tileset's, its secondary tileset's). */
    const tableKind = (i: number) => (a.isGeneralId(mt[i]) ? GENERAL_PROPS.get(mt[i]) : mt[i] >= 512 ? secondary?.get(mt[i]) : undefined);
    /** A cell holding an object no family took yet: a blocked cell (a building's stray art too), or
     *  a table prop the analysis took for a tree. */
    const isB = (i: number) => !claims.has(i, CLAIM_OBJECT) &&
      (kind[i] === K.Block || stray[i] === 1 || (kind[i] === K.Tree && tableKind(i) !== undefined));
    const at = (x: number, y: number) => (inside(x, y) ? idx(x, y) : -1);

    // Sign events that are signs: blocked, no statue (its top drawn as an overhang on the walkable
    // cell above: the gyms' statues), no mossy stone.
    const signAt = new Set<number>();
    for (const s of events.signs) {
      const i = at(s.x, s.y);
      if (i < 0 || !isB(i)) continue;
      const above = at(s.x, s.y - 1);
      if (above >= 0 && kind[above] === K.Floor && a.hasTop(above)) continue;
      if (look(mt[i]).leafy) continue;
      signAt.add(i);
    }
    const isProp = (i: number) => signAt.has(i) || tableKind(i) !== undefined;
    /** The cell (x, y) is a prop standing free in its column's block run: every cell of the run is
     *  a prop, or the props are its top part and at most two cells of something else, no rock,
     *  stand below them (a fence coming down to a wall: the wall keeps the ground in front of it; a
     *  railing along a cliff's top stays the cliff's). Props below anything else stay its art (a sign
     *  at the foot of a cliff: the cliff stands on its row). */
    const freeProp = (x: number, y: number) => {
      const [t, b] = blockRun(a, x, y, isB);
      let p = t;
      while (p <= b && isProp(idx(x, p))) p++;
      for (let r = p; r <= b; r++) if (isProp(idx(x, r)) || isRocky(a, mt[idx(x, r)])) return false;
      return y < p && b - p < 2;
    };
    const land = (j: number) => j >= 0 && (kind[j] === K.Floor || kind[j] === K.Stairs || kind[j] === K.Ledge) &&
      !Number.isNaN(a.height[j]) && !owner[j]; // (a building's walled-in cell is no ground)
    /** The walkable land a prop at rows top..bottom of column x stands on: the nearest in front of
     *  it, else beside or behind it (a fence along a shore has the sea in front; a fence the
     *  building flood fill swallowed may have the building beside it); -1: none near. `side`:
     *  beside it first (a N-S fence along a walkway). */
    const landUnder = (x: number, bottom: number, top = bottom, side = false) => {
      for (let r = 1; r <= 6; r++) {
        const front = at(x, bottom + r), left = at(x - r, bottom), right = at(x + r, bottom), back = at(x, top - r);
        for (const j of side ? [left, right, front, back] : [front, left, right, back]) if (land(j)) return j;
      }
      return -1;
    };
    /** Ground level on land cell j (none: the analysis' ground level of cell (x, y)). */
    const level = (j: number, x: number, y: number) => Math.max(0, j >= 0 ? a.height[j] : a.groundH[idx(x, y)]);
    /** The analysis read the prop's blocked cells as a step between two levels (it takes any short
     *  blocked run between two walkable areas for a terrace face): walkable ground behind its top
     *  row a level above or below the ground it stands on (half a level is a ramp beside it). The
     *  legacy art keeps that face (a 3D prop there would leave the ground behind it floating). */
    const step = (x: number, top: number, h: number) => {
      const j = at(x, top - 1);
      return j >= 0 && (kind[j] === K.Floor || kind[j] === K.Stairs) && !Number.isNaN(a.height[j]) && Math.abs(Math.max(0, a.height[j]) - h) > 0.5;
    };
    /** Claims rows t..b of column x, the ground under them at h in the look of land cell `ground`
     *  (the analysis' ground reference may be the sea beside a fence). */
    const take = (x: number, t: number, b: number, h: number, ground: number) => {
      for (let y = t; y <= b; y++) {
        const i = idx(x, y);
        claims.claim(i, CLAIM_OBJECT);
        claims.groundY[i] = h;
        if (ground >= 0) claims.groundMt[i] = mt[ground];
      }
    };
    /** A sign beside a house's wall is its mailbox. */
    const beside = (x: number, y: number) => [-1, 1].some((d) => {
      const j = at(x + d, y);
      const fp = j >= 0 && owner[j] ? footprints[owner[j] - 1] : null;
      return !!fp && buildingKind(fp.dest, fp.x1 - fp.x0 + 1) === 'house';
    });
    const single = (k: PropKind, x: number, y: number) => {
      const i = idx(x, y), l = look(mt[i]), j = landUnder(x, y), h = level(j, x, y);
      if (step(x, y, h)) return;
      const pk: PropKind = k === 'sign' && beside(x, y) ? 'mailbox' : k;
      const color = pk === 'rock' ? l.mean : pk === 'sign' || pk === 'mailbox' ? l.board : l.color;
      const p: PropPlacement = { kind: pk, x0: x, x1: x, y, h, color, trim: l.trim };
      if (pk === 'sign') p.posts = l.posts;
      out.push(p);
      take(x, y, y, h, j);
      // its top drawn as an overhang on the walkable cell above (a lamp's lantern): the model's
      const above = at(x, y - 1);
      if (above >= 0 && (kind[above] === K.Floor || kind[above] === K.Stairs) && a.hasTop(above) && tableKind(above) === pk) {
        claims.claim(above, CLAIM_TOP);
      }
    };

    const shapeOf = (i: number) => GENERAL_FENCE_SHAPES.get(mt[i]) ?? STRAIGHT;
    /** A fence piece's land: a N-S piece takes the ground beside it first (a walkway's). */
    const fenceLand = (i: number) => {
      const s = shapeOf(i).arms;
      return landUnder(a.cellX(i), a.cellY(i), a.cellY(i), !s.includes('E') && !s.includes('W'));
    };
    const fenceLevel = (i: number) => level(fenceLand(i), a.cellX(i), a.cellY(i));

    // 1. Signs (events, then table signs without one) and the other single-cell props.
    const cells: number[] = [];
    for (let i = 0; i < a.N; i++) if (isB(i) && isProp(i)) cells.push(i);
    const fenceCells = new Map<number, PropKind>();
    for (const i of cells) {
      if (!isB(i)) continue; // (taken as part of a bigger rock)
      const x = a.cellX(i), y = a.cellY(i);
      if (!freeProp(x, y)) continue;
      const k = signAt.has(i) ? 'sign' : tableKind(i)!;
      if (FENCES.has(k)) {
        if (!step(x, y, fenceLevel(i))) fenceCells.set(i, k);
        continue;
      }
      const below = at(x, y + 1), above = at(x, y - 1);
      const alone = !(below >= 0 && isB(below)) && !(above >= 0 && isB(above));
      if (k === 'rock' && BIG_ROCK.has(mt[i])) {
        // a 2x2 rock: from its top-left tile, all four tiles where they belong, nothing else on top
        const q = GENERAL_BIG_ROCKS[BIG_ROCK.get(mt[i])! >> 2];
        if (mt[i] !== q[0]) continue;
        const cs = [i, at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
        if (cs.some((j, c) => j < 0 || !isB(j) || mt[j] !== q[c])) continue;
        const [t0, b0] = blockRun(a, x, y, isB), [t1, b1] = blockRun(a, x + 1, y, isB);
        if (t0 !== y || t1 !== y || b0 !== y + 1 || b1 !== y + 1) continue;
        const j0 = landUnder(x, y + 1, y), j1 = landUnder(x + 1, y + 1, y);
        const h = Math.max(level(j0, x, y + 1), level(j1, x + 1, y + 1));
        if (step(x, y, h) || step(x + 1, y, h)) continue;
        const color = mix(look(mt[cs[0]]).mean, look(mt[cs[2]]).mean, 0.5);
        out.push({ kind: 'rock', x0: x, x1: x + 1, y: y + 1, h, color, trim: look(mt[cs[2]]).trim, rows: 1 });
        take(x, y, y + 1, h, j0);
        take(x + 1, y, y + 1, h, j1);
        continue;
      }
      if (k === 'sign' && signAt.has(i)) { single(k, x, y); continue; }
      // table props stand free (a sign without its event, a boulder, a lamp...)
      if (alone) single(k, x, y);
    }

    // 2. Fences: each piece's rails (its own arms, and the arms its neighbours reach it with), then
    // straight runs along rows and columns.
    const DIRS: Record<string, [number, number, string]> = { N: [0, -1, 'S'], E: [1, 0, 'W'], S: [0, 1, 'N'], W: [-1, 0, 'E'] };
    const arms = new Map<number, Set<string>>();
    for (const i of fenceCells.keys()) arms.set(i, new Set(shapeOf(i).arms));
    for (const [i, k] of fenceCells) {
      const x = a.cellX(i), y = a.cellY(i);
      for (const d of arms.get(i)!) {
        const [dx, dy, back] = DIRS[d];
        const j = at(x + dx, y + dy);
        if (j >= 0 && fenceCells.get(j) === k) arms.get(j)!.add(back);
      }
    }
    const groundAt = new Map<number, number>();
    for (const i of fenceCells.keys()) {
      const j = fenceLand(i), h = level(j, a.cellX(i), a.cellY(i));
      groundAt.set(i, h);
      take(a.cellX(i), a.cellY(i), a.cellY(i), h, j);
    }
    const joined = (i: number, d: string) => {
      const [dx, dy] = DIRS[d];
      const j = at(a.cellX(i) + dx, a.cellY(i) + dy);
      return j >= 0 && fenceCells.get(j) === fenceCells.get(i) && arms.get(i)!.has(d) && arms.get(j)!.has(DIRS[d][2]);
    };
    /** One straight run (consecutive cells along a row, or a column if `ns`), split where the
     *  ground drops by more than a level (a cliff between them); from the first piece's post line or
     *  edge to the last one's. */
    const emit = (run: number[], k: PropKind, ns: boolean) => {
      let s0 = 0;
      for (let c = 1; c <= run.length; c++) {
        if (c < run.length && Math.abs(groundAt.get(run[c])! - groundAt.get(run[c - 1])!) <= 1.01) continue;
        const first = run[s0], last = run[c - 1], f0 = shapeOf(first), f1 = shapeOf(last);
        const x0 = a.cellX(first), y0 = a.cellY(first), x1 = a.cellX(last), y1 = a.cellY(last);
        const l = look(mt[first]), h = groundAt.get(first)!, h1 = groundAt.get(last)!;
        const p: PropPlacement = { kind: k, x0, x1, y: y1, h, color: l.color, trim: l.trim };
        if (h1 !== h) p.h1 = h1;
        if (ns) {
          const az = s0 > 0 || arms.get(first)!.has('N') ? y0 : y0 + f0.fz;
          const bz = c < run.length || arms.get(last)!.has('S') ? y1 + 1 : y1 + f1.fz;
          p.line = [x0 + f0.fx, az, x0 + f0.fx, bz];
          if (y1 > y0) p.rows = y1 - y0;
        } else {
          const ax = s0 > 0 || arms.get(first)!.has('W') ? x0 : x0 + f0.fx;
          const bx = c < run.length || arms.get(last)!.has('E') ? x1 + 1 : x1 + f1.fx;
          p.line = [ax, y0 + f0.fz, bx, y0 + f0.fz];
        }
        const [ax, az, bx, bz] = p.line;
        if (bx - ax > 0.01 || bz - az > 0.01) out.push(p);
        s0 = c;
      }
    };
    for (const [i, k] of fenceCells) {
      const x = a.cellX(i), y = a.cellY(i), s = arms.get(i)!;
      // the E-W run starting here (not continuing one from the west), the N-S one
      if ((s.has('E') || s.has('W')) && !joined(i, 'W')) {
        const run = [i];
        while (joined(run[run.length - 1], 'E')) run.push(idx(a.cellX(run[run.length - 1]) + 1, y));
        emit(run, k, false);
      }
      if ((s.has('N') || s.has('S')) && !joined(i, 'N')) {
        const run = [i];
        while (joined(run[run.length - 1], 'S')) run.push(idx(x, a.cellY(run[run.length - 1]) + 1));
        emit(run, k, true);
      }
    }
    return out;
  },

  build(list: PropPlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!list.length) return null;
    // Flat-shaded quads in typed arrays (thousands of fence posts: MeshBuilder's per-vertex pushes
    // cost more than the geometry); lanterns in a glowing mesh of their own.
    const qw = new QuadWriter();
    const glow = new QuadWriter();
    /** Axis-aligned box centred at (cx, cy, cz). */
    const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, c: RGB, into = qw) =>
      into.box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, c);
    /** Upright hexagonal post of radius r from y0 to y1, a low cone for its cap. */
    const post = (cx: number, y0: number, y1: number, cz: number, r: number, c: RGB, top: RGB = c) => {
      const n = 6, peak: V3 = [cx, y1 + r * 0.5, cz];
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
        const p0: V3 = [cx + Math.cos(a0) * r, y1, cz + Math.sin(a0) * r], p1: V3 = [cx + Math.cos(a1) * r, y1, cz + Math.sin(a1) * r];
        qw.quad(p0, p1, [p1[0], y0, p1[2]], [p0[0], y0, p0[2]], [Math.cos(am), 0, Math.sin(am)], c);
        qw.quad(peak, peak, p1, p0, [Math.cos(am), 1, Math.sin(am)], top);
      }
    };
    /** A rail of section w (across, level) x t (up) whose centre line runs from p to q. */
    const beam = (p: V3, q: V3, w: number, t: number, c: RGB) => {
      const d = _d.set(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
      const sv = _s.crossVectors(d, UP);
      if (sv.lengthSq() < 1e-8) sv.set(1, 0, 0);
      sv.normalize();
      const uv = _u.crossVectors(sv, d).normalize();
      const C = (o: V3, i: number, j: number): V3 => [
        o[0] + sv.x * i * w / 2 + uv.x * j * t / 2, o[1] + sv.y * i * w / 2 + uv.y * j * t / 2, o[2] + sv.z * i * w / 2 + uv.z * j * t / 2];
      const side = (i0: number, j0: number, i1: number, j1: number, n: V3) => qw.quad(C(p, i0, j0), C(q, i0, j0), C(q, i1, j1), C(p, i1, j1), n, c);
      side(-1, 1, 1, 1, [uv.x, uv.y, uv.z]);
      side(-1, -1, 1, -1, [-uv.x, -uv.y, -uv.z]);
      side(1, -1, 1, 1, [sv.x, sv.y, sv.z]);
      side(-1, -1, -1, 1, [-sv.x, -sv.y, -sv.z]);
      for (const [o, k] of [[p, -1], [q, 1]] as [V3, number][]) qw.quad(C(o, -1, -1), C(o, 1, -1), C(o, 1, 1), C(o, -1, 1), [d.x * k, d.y * k, d.z * k], c);
    };
    /** The triangles of `g` (indexed or not), moved by (tx, ty, tz), tinted by `c` × its own colours. */
    const mesh = (g: THREE.BufferGeometry, tx: number, ty: number, tz: number, c: RGB) => {
      const pos = g.getAttribute('position'), col = g.getAttribute('color'), index = g.index;
      const n = index ? index.count : pos.count;
      const P = (k: number): V3 => { const v = index ? index.getX(k) : k; return [pos.getX(v) + tx, pos.getY(v) + ty, pos.getZ(v) + tz]; };
      for (let k = 0; k + 2 < n; k += 3) {
        const a = P(k), b = P(k + 1), cc = P(k + 2);
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
        const v0 = index ? index.getX(k) : k;
        const tint: RGB = col ? [c[0] * col.getX(v0), c[1] * col.getY(v0), c[2] * col.getZ(v0)] : c;
        qw.quad(a, b, cc, cc, [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx], tint);
      }
    };
    const lin = new Map<RGB, RGB>();
    const L = (c: RGB) => { let v = lin.get(c); if (!v) { v = toLinear(c); lin.set(c, v); } return v; };
    const POST: RGB = toLinear([0.42, 0.3, 0.2]);
    const DARK: RGB = toLinear([0.25, 0.27, 0.3]);
    const RED: RGB = toLinear([0.85, 0.22, 0.2]);
    const GLASS: RGB = toLinear([1, 0.95, 0.82]);
    const posts = new Set<string>(); // fence posts already standing (corners shared by two runs)
    for (const p of list) {
      const c = L(p.color), trim = L(p.trim ?? p.color);
      // grid (x, row) at height y above the ground → world (x, h + y, row + h)
      const h = p.h;
      const cx = (p.x0 + p.x1 + 1) / 2;
      const z = p.y + 0.5 + h;
      switch (p.kind) {
        case 'sign': {
          const legs = p.posts === 1 ? [0] : [-0.28, 0.28];
          const leg = luma(p.color) > 0.45 ? DARK : POST; // metal signs stand on dark legs
          for (const dx of legs) post(cx + dx, h, h + 0.5, z, p.posts === 1 ? 0.055 : 0.04, leg);
          box(cx, h + 0.62, z, 0.82, 0.46, 0.07, c);
          box(cx, h + 0.62, z + 0.04, 0.64, 0.3, 0.012, trim); // its face
          break;
        }
        case 'mailbox': {
          // a box with a rounded top on a post, its flag up, its slot facing the street
          post(cx, h, h + 0.52, z, 0.05, DARK);
          const top = h + 0.74, r = 0.16, d = 0.46;
          box(cx, h + 0.63, z, 2 * r, 0.22, d, c);
          for (let k = 0; k < 6; k++) {
            const a0 = (k / 6) * Math.PI, a1 = ((k + 1) / 6) * Math.PI, am = (a0 + a1) / 2;
            const x0 = cx + Math.cos(a0) * r, y0 = top + Math.sin(a0) * r * 0.8, x1 = cx + Math.cos(a1) * r, y1 = top + Math.sin(a1) * r * 0.8;
            qw.quad([x0, y0, z - d / 2], [x1, y1, z - d / 2], [x1, y1, z + d / 2], [x0, y0, z + d / 2], [Math.cos(am), Math.sin(am), 0], c);
            for (const e of [-1, 1]) {
              const ze = z + (e * d) / 2;
              qw.quad([cx, top, ze], [cx, top, ze], [x1, y1, ze], [x0, y0, ze], [0, 0, e], c);
            }
          }
          box(cx + r + 0.02, h + 0.8, z - 0.06, 0.03, 0.24, 0.05, RED); // flag
          box(cx + r + 0.02, h + 0.9, z - 0.01, 0.03, 0.08, 0.14, RED);
          box(cx, h + 0.7, z + d / 2 + 0.004, 0.16, 0.05, 0.01, trim); // slot
          break;
        }
        case 'lamp': {
          // a dark post, a lantern (its glass glows at night) under a cap
          post(cx, h, h + 1.14, z, 0.045, DARK);
          box(cx, h + 1.14, z, 0.2, 0.04, 0.2, DARK);
          box(cx, h + 1.3, z, 0.18, 0.28, 0.18, GLASS, glow);
          for (const [dx, dz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(cx + dx * 0.095, h + 1.3, z + dz * 0.095, 0.03, 0.28, 0.03, DARK);
          box(cx, h + 1.47, z, 0.3, 0.06, 0.3, DARK);
          box(cx, h + 1.53, z, 0.16, 0.06, 0.16, DARK);
          break;
        }
        case 'rock': {
          const big = p.x1 > p.x0;
          const g = new THREE.IcosahedronGeometry(big ? 0.95 : 0.42, big ? 2 : 1);
          const pos = g.getAttribute('position');
          for (let i = 0; i < pos.count; i++) {
            const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
            const k = 1 + 0.18 * noise3(vx * 3 + cx, vy * 3, vz * 3 + z);
            // a big rock is a cone (narrower towards its peak); the base is flattened into the ground
            const taper = big ? 1 - 0.6 * THREE.MathUtils.clamp(vy / 0.95, 0, 1) : 1;
            pos.setXYZ(i, vx * k * taper, Math.max(vy * k * (big ? 1.15 : 0.75), big ? -0.25 : -0.12), vz * k * taper * (big ? 0.8 : 1));
          }
          mesh(g, cx, h + (big ? 0.25 : 0.12), big ? p.y + h + 0.1 : z, c);
          g.dispose();
          break;
        }
        case 'bush': {
          const g = blobCrown(hashCell(p.x0, p.y), 4, 0.2, 0.22, 0.3, 0.3, 0.1, 1);
          mesh(g, cx, h, z, c);
          g.dispose();
          break;
        }
        case 'bollard':
          post(cx, h, h + 0.55, z, 0.1, c, trim);
          break;
        default: {
          // fences: posts along the run (corners shared), rails between its ends; the ground rises
          // from the first cell's centre to the last one's (a run beside a ramp)
          const [ax, az, bx, bz] = p.line ?? [p.x0, p.y + 0.5, p.x1 + 1, p.y + 0.5];
          const ns = Math.abs(bx - ax) < 0.01;
          const c0 = ns ? p.y - (p.rows ?? 0) + 0.5 : p.x0 + 0.5, c1 = ns ? p.y + 0.5 : p.x1 + 0.5;
          const h1 = p.h1 ?? h;
          const ground = (gx: number, gz: number) => (c1 > c0 ? h + (h1 - h) * THREE.MathUtils.clamp(((ns ? gz : gx) - c0) / (c1 - c0), 0, 1) : h);
          /** World point over grid (gx, gz), `up` above the ground. */
          const at = (gx: number, gz: number, up: number): V3 => { const g = ground(gx, gz); return [gx, g + up, gz + g]; };
          const metal = p.kind === 'fenceMetal', white = p.kind === 'fenceWhite';
          const height = white ? 0.42 : metal ? 0.62 : 0.6;
          const n = Math.max(1, Math.round(Math.hypot(bx - ax, bz - az) / (metal ? 0.5 : 1)));
          const cap = L(mix(p.color, [1, 1, 1], 0.6));
          for (let k = 0; k <= n; k++) {
            const gx = ax + ((bx - ax) * k) / n, gz = az + ((bz - az) * k) / n;
            const [wx, wy, wz] = at(gx, gz, 0);
            const key = `${Math.round(wx * 20)},${Math.round(wy * 20)},${Math.round(wz * 20)}`;
            if (posts.has(key)) continue;
            posts.add(key);
            if (metal) post(wx, wy, wy + height, wz, 0.05, c, cap);
            else box(wx, wy + height / 2, wz, 0.1, height, 0.1, c);
          }
          const rail = (up: number, w: number, t: number, col: RGB) => beam(at(ax, az, up), at(bx, bz, up), w, t, col);
          if (white) { rail(height - 0.06, 0.1, 0.12, c); rail(0.16, 0.06, 0.06, scale(c, 0.8)); }
          else if (metal) { rail(0.48, 0.045, 0.045, c); rail(0.24, 0.045, 0.045, c); }
          else { rail(0.48, 0.05, 0.08, c); rail(0.22, 0.05, 0.08, c); }
        }
      }
    }
    const root = new THREE.Group();
    const body = new THREE.Mesh(qw.geometry(), kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, flatShading: true, fade: true }).material);
    body.castShadow = true;
    body.receiveShadow = true;
    root.add(body);
    if (!glow.empty) root.add(new THREE.Mesh(glow.geometry(), kitMaterial(kit.uniforms, { vertexColors: true, glow: 2.5, fade: true }).material));
    return root;
  },
};
