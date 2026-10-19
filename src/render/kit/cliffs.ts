// Cliffs: displaced, strata-banded rock walls where the analysis found a face between two
// levels (or a rocky block mass), with a grass lip on top and rock side panels; ledges become
// small rounded grassy drops along their jump edge.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../overworld/claims';
import type { GridEvents } from './events';
import { bgr555ToSrgb, classifyGroundColor, dominantColor, luma, mix, saturation, soften, toLinear, type RGB } from './palette';
import { hashCell, noise2, QuadWriter, type V3 } from './geom';
import { kitMaterial } from './materials';
import { cellLook, GroundMat, type CellLook } from './terrain';
import type { Family, KitContext, SemanticContext } from './semantics';

/** A face column: a vertical wall at Z = zf from its foot hB up to topH (X from x to x + 1). */
export interface CliffRun { x: number; zf: number; hB: number; topH: number; tint: RGB; lip: RGB | null }
/** A side wall at X = px facing `dir` (±1): its top edge spans Z [zt, zb] at height y1 and slides
 *  down at 45° (the un-projection's slant, like the terrain banks) to height y0. */
export interface SidePanel { px: number; dir: number; zb: number; zt: number; y0: number; y1: number; tint: RGB }
export interface LedgeLip { x: number; y: number; h: number; dir: 'S' | 'N' | 'E' | 'W'; grass: RGB }
export interface CliffPlacement { runs: CliffRun[]; sides: SidePanel[]; ledges: LedgeLip[] }

/** Curated rock ids (set by the General table, Task 14). */
export let rockIds: (m: number) => boolean = () => false;
export function setRockIds(f: (m: number) => boolean): void { rockIds = f; }

/** Tiles with this fraction of green pixels hold foliage (tree crowns, grass rims), not bare rock. */
const FOLIAGE = 0.2;

/** Rock-looking metatile: brown/grey/beige or a muted dark rock shade, little foliage, not water.
 *  `dom`: its dominant lit colour, if already known. */
export function isRocky(a: MapAnalysis, m: number, dom = litDominant(a, m)): boolean {
  if (a.isGeneralId(m) && rockIds(m)) return true;
  if (a.info.green[m] >= FOLIAGE) return false;
  const c = dom;
  if (!c) return false;
  const cls = classifyGroundColor(c);
  if (cls === 'dirt' || cls === 'rock' || cls === 'gravel') return true;
  // The shadow side of a rock mass: dark and muted, reddish-grey (not a navy window or a green shade).
  return cls === 'path' && luma(c) < 0.45 && saturation(c) < 0.2 && c[2] <= c[0] && c[1] <= c[0];
}

/**
 * Block masses standing on a door the analysis did not flood (a warp on walkable ground with a
 * block cell north of it, no door behaviour): Devon Corp, Fortree's treehouses, the Game Corner,
 * cave mouths. Their columns (block runs through the row above the door that end by the door's
 * row, contiguous with the door, up to 14 rows tall and 9 columns either side) are buildings,
 * never cliffs. A wall running on past the door's row (a cliff beside the building) is not.
 */
export function doorStructures(a: MapAnalysis, events: GridEvents): Uint8Array {
  const out = new Uint8Array(a.N);
  const block = (x: number, y: number) => a.inside(x, y) && a.kind[a.idx(x, y)] === K.Block;
  for (const w of events.warps) {
    const y = w.y - 1;
    if (!a.inside(w.x, w.y) || block(w.x, w.y) || !block(w.x, y)) continue;
    for (const dir of [-1, 1]) {
      for (let x = dir < 0 ? w.x : w.x + 1; Math.abs(x - w.x) <= 9 && block(x, y) && !block(x, w.y + 1); x += dir) {
        for (let r = block(x, w.y) ? w.y : y; r > y - 14 && block(x, r); r--) out[a.idx(x, r)] = 1;
      }
    }
  }
  return out;
}

/** Most frequent colour of a metatile, outlines excluded. */
const litDominant = (a: MapAnalysis, m: number) => dominantColor(a.info.both, [m], (k) => luma(k) > 0.15);

const LEDGE_DIR: Record<number, LedgeLip['dir']> = {
  [MB.JUMP_SOUTH]: 'S', [MB.JUMP_SOUTHEAST]: 'S', [MB.JUMP_SOUTHWEST]: 'S',
  [MB.JUMP_NORTH]: 'N', [MB.JUMP_NORTHEAST]: 'N', [MB.JUMP_NORTHWEST]: 'N',
  [MB.JUMP_EAST]: 'E', [MB.JUMP_WEST]: 'W',
};

/** Hash of a lattice point in [-1, 1]. */
const jitter = (x: number, y: number) => (hashCell(x, y, 0x5c1) / 4294967296) * 2 - 1;

const FACE_N: V3 = [0, 0, 1], EAST_N: V3 = [1, 0, 0], WEST_N: V3 = [-1, 0, 0];

/** A run while extracting: rows y..e of column x, top rows y..e-F and face rows e-F+1..e. */
interface Run {
  r: CliffRun; y: number; e: number; F: number;
  /** Metatile of the plateau above a face between two levels (-1: a free-standing rock mass). */
  above: number;
  mts: number[];
}

/** Mean colour of the lit, earthy pixels of `mts` (outlines, foliage and water excluded). */
function rockColor(px: Uint16Array, mts: number[], cache: Map<number, Float64Array>): RGB | null {
  let r = 0, g = 0, b = 0, n = 0;
  for (const m of mts) {
    let sum = cache.get(m);
    if (!sum) {
      sum = new Float64Array(4);
      for (let p = 0; p < 256; p++) {
        const v = px[m * 256 + p];
        if (v & 0x8000) continue;
        const c = bgr555ToSrgb(v);
        if (luma(c) <= 0.2 || (c[1] > c[0] + 0.05 && c[1] >= c[2]) || c[2] > c[0] + 0.1) continue;
        sum[0] += c[0]; sum[1] += c[1]; sum[2] += c[2]; sum[3]++;
      }
      cache.set(m, sum);
    }
    r += sum[0]; g += sum[1]; b += sum[2]; n += sum[3];
  }
  return n ? [r / n, g / n, b / n] : null;
}

export const cliffFamily: Family<CliffPlacement> = {
  name: 'cliffs',

  extract({ a, events }: SemanticContext, claims: Claims): CliffPlacement {
    const out: CliffPlacement = { runs: [], sides: [], ledges: [] };
    // (a Dive map's rock is the seabed, under water that is not drawn either)
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return out;
    const { idx, inside, kind, height } = a;
    const looks = new Map<number, CellLook>();
    const rocky = new Map<number, boolean>();
    const rock = (m: number) => {
      let v = rocky.get(m);
      if (v === undefined) { v = isRocky(a, m, dom(m)); rocky.set(m, v); }
      return v;
    };
    const doms = new Map<number, RGB | null>();
    const dom = (m: number) => {
      let c = doms.get(m);
      if (c === undefined) { c = litDominant(a, m); doms.set(m, c); }
      return c;
    };
    const structure = doorStructures(a, events);
    // Sign posts stand on the ground in front of a wall: the ground, for the run above them.
    const sign = new Uint8Array(a.N);
    for (const s of events.signs) if (inside(s.x, s.y) && kind[idx(s.x, s.y)] === K.Block) sign[idx(s.x, s.y)] = 1;
    const isBlock = (i: number) => kind[i] === K.Block && !claims.has(i, CLAIM_OBJECT) && !structure[i] && !sign[i];
    const walk = (i: number) => i >= 0 && (kind[i] === K.Floor || kind[i] === K.Stairs || kind[i] === K.Water || kind[i] === K.Ledge || sign[i] === 1);
    /** Ground height of a walkable cell (a sign's: the ground it stands on). */
    const groundOf = (i: number) => (sign[i] ? a.groundH[i] : height[i]);
    // A tile mostly in the colour of the map's ground is an object standing on that ground (a tree
    // trunk, a boulder, the rim art over a rock's top), not a rock face: the common floor colours.
    const floorCount = new Map<number, number>();
    let floors = 0;
    for (let i = 0; i < a.N; i++) {
      if (kind[i] !== K.Floor) continue;
      floors++;
      floorCount.set(a.mt[i], (floorCount.get(a.mt[i]) ?? 0) + 1);
    }
    const ground: RGB[] = [];
    for (const [m, n] of floorCount) {
      const c = n >= floors * 0.03 ? dom(m) : null;
      if (c) ground.push(c);
    }
    const isGround = (c: RGB | null) =>
      !!c && ground.some((g) => Math.max(Math.abs(c[0] - g[0]), Math.abs(c[1] - g[1]), Math.abs(c[2] - g[2])) < 0.04);
    const rockFace = (m: number) => (a.isGeneralId(m) && rockIds(m)) || (rock(m) && !isGround(dom(m)));
    /** Most rows of column x from y to e have rock beside them (a mass, not a 1-wide strip). */
    const wide = (x: number, y: number, e: number) => {
      let n = 0;
      for (let r = y; r <= e; r++) {
        const side = (nx: number) => inside(nx, r) && kind[idx(nx, r)] === K.Block && rockFace(a.mt[idx(nx, r)]);
        if (side(x - 1) || side(x + 1)) n++;
      }
      return n * 2 > e - y + 1;
    };

    // 1. Runs: block runs down each column with walkable ground below.
    const cands: Run[] = [];
    for (let x = a.minX; x < a.maxX; x++) {
      let y = a.minY;
      while (y < a.maxY) {
        if (!isBlock(idx(x, y))) { y++; continue; }
        let e = y;
        while (e + 1 < a.maxY && isBlock(idx(x, e + 1))) e++;
        const L = e - y + 1;
        const bi = e + 1 < a.maxY ? idx(x, e + 1) : -1;
        const ai = y > a.minY ? idx(x, y - 1) : -1;
        const hB = walk(bi) ? Math.max(groundOf(bi), 0) : NaN;
        let hA = walk(ai) ? Math.max(groundOf(ai), 0) : NaN;
        let above = walk(ai) ? a.mt[ai] : -1;
        // A run whose north end meets no ground (a tree, another block) takes the level of the
        // highest ground beside it: the corner column of a terrace.
        if (Number.isNaN(hA) && !Number.isNaN(hB)) {
          for (let r = y; r <= e; r++) {
            for (const nx of [x - 1, x + 1]) {
              const j = inside(nx, r) ? idx(nx, r) : -1;
              if (j < 0 || (kind[j] !== K.Floor && kind[j] !== K.Stairs) || !(height[j] > hB + 0.01) || height[j] <= hA) continue;
              hA = height[j];
              above = a.mt[j];
            }
          }
        }
        const mts: number[] = [];
        for (let r = y; r <= e; r++) mts.push(a.mt[idx(x, r)]);
        const nRock = mts.filter(rockFace).length;
        const level = !Number.isNaN(hA) && !Number.isNaN(hB) && hA > hB + 0.01;
        let F = 0;
        // A face between two levels: mostly rock (and, if the face is shorter than the run, a
        // mass rather than a 1-wide ridge: the edge of a terrace wall). A free-standing block mass
        // (no level change) needs stronger evidence: rock by a clear majority, at least two
        // columns wide and no foliage on its face (a grass rim on top is fine).
        if (!Number.isNaN(hB) && level && nRock * 2 >= L) {
          F = Math.min(L, Math.max(1, Math.round(hA - hB)));
          if (L - F >= 2 && !wide(x, y, e)) F = 0;
        } else if (!Number.isNaN(hB) && L >= 2 && nRock * 3 >= L * 2 && wide(x, y, e)) {
          F = Math.min(L, Math.max(1, Math.min(3, Math.round(L / 2))));
          if (mts.slice(-F).some((m) => a.info.green[m] >= FOLIAGE)) F = 0;
        }
        if (F === 0) { y = e + 1; continue; }
        const topH = hB + F;
        // A face over water reaches down to the water surface.
        const foot = bi >= 0 && kind[bi] === K.Water ? Math.min(hB, height[bi]) : hB;
        cands.push({ r: { x, zf: e + 1 + hB, hB: foot, topH, tint: [0, 0, 0], lip: null }, y, e, F, above: level ? above : -1, mts });
        y = e + 1;
      }
    }

    // A wall stands on a line: keep runs with a neighbour column whose face has the same foot.
    // Diagonal staircases of short runs (Mossdeep's rock ridges) and lone columns stay legacy.
    const footing = (x: number, e: number, hB: number) => `${x},${e},${hB}`;
    const feet = new Set(cands.map((c) => footing(c.r.x, c.e, c.r.hB)));
    const runs = cands.filter((c) => feet.has(footing(c.r.x - 1, c.e, c.r.hB)) || feet.has(footing(c.r.x + 1, c.e, c.r.hB)));
    /** Per cell: index of the run whose face covers it (-1 = none). */
    const faceRun = new Int32Array(a.N).fill(-1);
    /** Per cell: index of the run whose top rows include it (-1 = none). */
    const topRun = new Int32Array(a.N).fill(-1);
    runs.forEach((run, k) => {
      for (let r = run.e - run.F + 1; r <= run.e; r++) faceRun[idx(run.r.x, r)] = k;
      for (let r = run.y; r <= run.e - run.F; r++) topRun[idx(run.r.x, r)] = k;
    });

    // 2. Cliffs: runs side by side whose faces share a row are one wall, in one rock colour (the
    // tiles' own shading would change it column by column).
    const parent = Int32Array.from(runs, (_, k) => k);
    const find = (k: number): number => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
    for (let i = 0; i < a.N; i++) {
      const k = faceRun[i];
      if (k < 0 || a.cellX(i) + 1 >= a.maxX) continue;
      const j = faceRun[i + 1];
      if (j >= 0) parent[find(k)] = find(j);
    }
    const groups = new Map<number, number[]>();
    const sums = new Map<number, Float64Array>();
    for (let k = 0; k < runs.length; k++) {
      const g = find(k);
      const list = groups.get(g) ?? [];
      list.push(k);
      groups.set(g, list);
    }
    for (const list of groups.values()) {
      const faceMts: number[] = [];
      const tops = new Map<number, number>();
      for (const k of list) {
        const run = runs[k];
        faceMts.push(...run.mts.slice(-run.F));
        // a rock mass's top: its rock tile whose ground layer shows rock (not the ground under the rim art)
        if (run.above < 0) for (const m of run.mts) if (rockFace(m) && !isGround(cellLook(a, m, looks).tint)) tops.set(m, (tops.get(m) ?? 0) + 1);
      }
      // lifted a little: the shaded, strata-banded wall reads darker than the tiles' flat pixels
      const mean = rockColor(a.info.both, faceMts.filter(rockFace), sums) ?? rockColor(a.info.both, faceMts, sums) ?? [0.6, 0.5, 0.4];
      const tint = soften(mean.map((v) => Math.min(1, v * 1.12)) as RGB);
      let top = -1, best = 0;
      for (const [m, n] of tops) if (n > best) { best = n; top = m; }
      for (const k of list) {
        const run = runs[k];
        run.r.tint = tint;
        for (let r = run.y; r <= run.e - run.F; r++) {
          const i = idx(run.r.x, r);
          claims.claim(i, CLAIM_OBJECT);
          claims.groundY[i] = run.r.topH;
          // the plateau above runs on to the face; a rock mass is rock on top
          claims.groundMt[i] = run.above >= 0 ? run.above : top >= 0 ? top : a.mt[i];
        }
        for (let r = run.e - run.F + 1; r <= run.e; r++) claims.claim(idx(run.r.x, r), CLAIM_OBJECT | CLAIM_SURFACE);
      }
    }
    // A grass lip where the wall's top tile or the plateau above is grass.
    const grass = (m: number) => {
      if (a.info.green[m] < FOLIAGE) return null; // (no grass to speak of: skips the colour sampling)
      const look = cellLook(a, m, looks);
      return look.mat === GroundMat.Grass ? look.tint : null;
    };
    for (const run of runs) {
      const topTile = run.mts[Math.max(0, run.mts.length - run.F - 1)]; // last top row, else the face's first
      run.r.lip = grass(topTile) ?? (run.above >= 0 ? grass(run.above) : null);
      out.runs.push(run.r);
    }

    // 3. Side panels: rock walls down the side of higher ground beside a lower cliff face (the
    // terrain draws no bank against a face cell), and beside lower ground for the top rows of a
    // run (over the terrain's soil bank there).
    for (let i = 0; i < a.N; i++) {
      if (faceRun[i] >= 0) continue;
      const k = kind[i];
      const own = topRun[i] >= 0;
      if (!own && k !== K.Floor && k !== K.Stairs && k !== K.Ledge) continue;
      const hP = own ? runs[topRun[i]].r.topH : Math.max(0, height[i]);
      if (Number.isNaN(hP)) continue;
      const x = a.cellX(i), r = a.cellY(i);
      for (const dir of [-1, 1]) {
        const nx = x + dir;
        if (!inside(nx, r)) continue;
        const ni = idx(nx, r);
        let low = NaN;
        let tint: RGB | null = null;
        if (faceRun[ni] >= 0) {
          low = runs[faceRun[ni]].r.hB;
          tint = runs[faceRun[ni]].r.tint;
        } else if (own && (walk(ni) || topRun[ni] >= 0)) {
          low = topRun[ni] >= 0 ? runs[topRun[ni]].r.topH : kind[ni] === K.Water ? height[ni] : Math.max(0, groundOf(ni));
          tint = runs[topRun[i]].r.tint;
        }
        if (Number.isNaN(low) || !tint || low >= hP - 0.01) continue;
        out.sides.push({ px: dir > 0 ? x + 1 : x, dir, zt: r + hP, zb: r + 1 + hP, y0: low, y1: hP, tint });
      }
    }

    for (let i = 0; i < a.N; i++) {
      if (kind[i] !== K.Ledge) continue;
      const dir = LEDGE_DIR[a.beh[i]];
      if (!dir) continue;
      const look = cellLook(a, a.groundOf[i] >= 0 ? a.groundOf[i] : a.mt[i], looks);
      out.ledges.push({ x: a.cellX(i), y: a.cellY(i), h: Math.max(0, height[i]), dir, grass: look.tint });
    }
    return out;
  },

  build(p: CliffPlacement, { a }: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p.runs.length && !p.ledges.length && !p.sides.length) return null;
    const quads = new QuadWriter();
    const strata = (X: number, Y: number) => 0.9 + 0.12 * Math.sin(Y * 7 + noise2(X * 0.8, Y * 0.8, 9) * 2);
    /** Darker towards the foot of a wall. */
    const base = (dy: number) => 0.68 + 0.32 * Math.min(1, dy / 0.8);
    // Face relief: outward only (a face never recedes behind the ground in front of it) and none at
    // the top edge, so the wall meets the plateau. A smooth swell plus a jitter per lattice vertex,
    // both functions of the world position, so neighbouring columns share their edges.
    const disp = (X: number, Y: number) =>
      Math.max(0, 0.09 + 0.07 * noise2(X * 1.7, Y * 1.7, 5) + 0.03 * jitter(Math.round(X * 16), Math.round(Y * 16)));
    // Faces by column and wall line, to skip side wedges hidden by a neighbour as tall and as deep.
    const faces = new Map<string, CliffRun>();
    for (const r of p.runs) faces.set(`${r.x},${r.zf}`, r);
    const NX = 4, ROWS = 4;
    for (const r of p.runs) {
      const tint = toLinear(r.tint);
      // Vertex rows on the world lattice (every 1/ROWS of height) plus the foot and the top, so
      // walls side by side share their edge vertices whatever their feet and tops.
      const ys = [r.hB];
      for (let k = Math.floor(r.hB * ROWS + 1e-6) + 1; k / ROWS < r.topH - 1e-6; k++) if (k / ROWS > r.hB + 1e-6) ys.push(k / ROWS);
      ys.push(r.topH);
      const ny = ys.length - 1;
      // vertex grid (NX + 1) x (ny + 1), row-major from the foot up
      const grid: V3[] = [];
      for (let v = 0; v <= ny; v++) {
        const Y = ys[v];
        for (let u = 0; u <= NX; u++) {
          const X = r.x + u / NX;
          grid.push([X, Y, r.zf + (v === ny ? 0 : disp(X, Y))]);
        }
      }
      const P = (u: number, v: number) => grid[v * (NX + 1) + u];
      for (let v = 0; v < ny; v++) {
        const cy = (ys[v] + ys[v + 1]) / 2;
        const k = base(cy - r.hB) * strata(r.x + 0.5, cy); // one band per row and column
        for (let u = 0; u < NX; u++) quads.quad(P(u, v + 1), P(u + 1, v + 1), P(u + 1, v), P(u, v), FACE_N, tint, k);
      }
      // Side wedges: from the face's (displaced) edge back along the 45° slant under the plateau,
      // closing the wall where the neighbouring column is lower.
      for (const side of [0, 1]) {
        const n = faces.get(`${r.x + (side ? 1 : -1)},${r.zf}`);
        if (n && n.topH >= r.topH - 0.01 && n.hB <= r.hB + 0.01) continue;
        const X = r.x + side;
        for (let v = 0; v < ny; v++) {
          const f0 = P(side * NX, v), f1 = P(side * NX, v + 1);
          const b0: V3 = [X, f0[1], r.zf - (r.topH - f0[1])], b1: V3 = [X, f1[1], r.zf - (r.topH - f1[1])];
          const cy = (f0[1] + f1[1]) / 2;
          quads.quad(b1, f1, f0, b0, side ? EAST_N : WEST_N, tint, strata(X, cy) * base(cy - r.hB));
        }
      }
      // grass lip: a slab along the top edge, a hair proud of the wall
      if (r.lip) quads.box(r.x, r.x + 1, r.topH - 0.03, r.topH + 0.07, r.zf - 0.21, r.zf + 0.03, toLinear(r.lip));
    }
    // Side panels sit a hair outside their plane so they cover the terrain's soil bank there.
    for (const s of p.sides) {
      const tint = toLinear(s.tint);
      const px = s.px + s.dir * 0.01;
      const ny = Math.max(1, Math.round((s.y1 - s.y0) * 3));
      for (let v = 0; v < ny; v++) {
        const y0 = s.y0 + ((s.y1 - s.y0) * v) / ny, y1 = s.y0 + ((s.y1 - s.y0) * (v + 1)) / ny;
        const d0 = y0 - s.y1, d1 = y1 - s.y1; // the 45° slide below the top edge
        quads.quad([px, y1, s.zt + d1], [px, y1, s.zb + d1], [px, y0, s.zb + d0], [px, y0, s.zt + d0], s.dir > 0 ? EAST_N : WEST_N,
          tint, strata(s.px, (y0 + y1) / 2) * base((y0 + y1) / 2 - s.y0));
      }
    }
    // Ledges: a rounded grassy lip along the jump edge, its drop in the earth colour the tile draws
    // there. Profile: distance back from the edge, height above the cell (convex: caps fan from
    // the first point). Line ends get a cap.
    const PROFILE: [number, number][] = [[-0.55, 0], [-0.35, 0.14], [-0.15, 0.2], [-0.02, 0.17], [0.04, 0.06], [0.06, 0]];
    const GRASS_SEGMENTS = 3;
    const ledgeAt = new Set(p.ledges.map((l) => `${l.x},${l.y},${l.dir},${l.h}`));
    const earthOf = new Map<number, RGB>();
    for (const l of p.ledges) {
      const grass = toLinear(l.grass);
      const m = a.inside(l.x, l.y) ? a.mt[a.idx(l.x, l.y)] : -1;
      let earth = earthOf.get(m);
      if (!earth) {
        // the tile's most common colour that is neither grass nor its ground (on ash or sand maps the
        // ground is not green)
        const g = l.grass;
        const drawn = m >= 0 ? dominantColor(a.info.both, [m], (c) =>
          luma(c) > 0.12 && !(c[1] > c[0] + 0.05) && Math.max(Math.abs(c[0] - g[0]), Math.abs(c[1] - g[1]), Math.abs(c[2] - g[2])) > 0.08) : null;
        earth = toLinear(soften(drawn ?? mix(l.grass, [0.55, 0.42, 0.3], 0.6)));
        earthOf.set(m, earth);
      }
      const h = l.h;
      const ns = l.dir === 'S' || l.dir === 'N';
      const sgn = l.dir === 'S' || l.dir === 'E' ? 1 : -1;
      /** Profile point k at position t (0..1) along the edge. */
      const pt = (k: number, t: number): V3 => {
        const [d, y] = PROFILE[k];
        if (ns) return [l.x + t, h + y, (l.dir === 'S' ? l.y + 1 : l.y) + h + sgn * d];
        return [(l.dir === 'E' ? l.x + 1 : l.x) + sgn * d, h + y, l.y + h + t];
      };
      for (let k = 0; k + 1 < PROFILE.length; k++) {
        const n: V3 = ns ? [0, 1, sgn * 0.6] : [sgn * 0.6, 1, 0];
        quads.quad(pt(k, 0), pt(k, 1), pt(k + 1, 1), pt(k + 1, 0), n, k < GRASS_SEGMENTS ? grass : earth);
      }
      for (const t of [0, 1]) {
        const nx = ns ? l.x + (t ? 1 : -1) : l.x, ny = ns ? l.y : l.y + (t ? 1 : -1);
        if (ledgeAt.has(`${nx},${ny},${l.dir},${l.h}`)) continue;
        const n: V3 = ns ? [t ? 1 : -1, 0, 0] : [0, 0, t ? 1 : -1];
        quads.quad(pt(0, t), pt(1, t), pt(2, t), pt(3, t), n, earth);
        quads.quad(pt(0, t), pt(3, t), pt(4, t), pt(5, t), n, earth);
      }
    }
    const km = kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.95, flatShading: true });
    const mesh = new THREE.Mesh(quads.geometry(), km.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  },
};
