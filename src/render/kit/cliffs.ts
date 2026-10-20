// Cliffs: displaced, strata-banded rock walls where the analysis found a face between two
// levels (or a rocky block mass), with a grass lip on top and rock side panels; ledges become
// small rounded grassy drops along their jump edge.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { attrLayerType, LayerType } from '../../game/rom/tileset';
import { K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../overworld/claims';
import { buildingLayout } from './footprints';
import type { GridEvents } from './events';
import { bgr555ToSrgb, classifyGroundColor, dominantColor, luma, mix, saturation, soften, toLinear, type RGB } from './palette';
import { hashCell, noise2, QuadWriter, type V3 } from './geom';
import { kitMaterial } from './materials';
import { cellLook, GroundMat, type CellLook } from './terrain';
import { isSecretBaseSpot, type Family, type KitContext, type SemanticContext } from './semantics';
import { SECONDARY_ROCK, SECONDARY_ROCK_TOPS } from './tables/secondary';

/** A face column: a vertical wall at Z = zf from its foot hB up to topH (X from x to x + 1).
 *  `wall`: free-standing, with ground of its foot's level behind it (a capped slab, no plateau). */
export interface CliffRun { x: number; zf: number; hB: number; topH: number; tint: RGB; lip: RGB | null; wall?: boolean }
/** A side wall at X = px facing `dir` (±1): its top edge spans Z [zt, zb] at height y1 and slides
 *  down at 45° (the un-projection's slant, like the terrain banks) to height y0. */
export interface SidePanel { px: number; dir: number; zb: number; zt: number; y0: number; y1: number; tint: RGB }
export interface LedgeLip { x: number; y: number; h: number; dir: 'S' | 'N' | 'E' | 'W'; grass: RGB }
export interface CliffPlacement { runs: CliffRun[]; sides: SidePanel[]; ledges: LedgeLip[] }

/** Curated rock ids (set by the General table, Task 14). */
export let rockIds: (m: number) => boolean = () => false;
export function setRockIds(f: (m: number) => boolean): void { rockIds = f; }
/** General ids of brown rock standing in the sea (set by the General table). */
export let seaRockIds: (m: number) => boolean = () => false;
export function setSeaRockIds(f: (m: number) => boolean): void { seaRockIds = f; }
/** General ids of the tops of the rocks on the shoals (sea rocks too; set by the General table). */
export let shoalTopIds: (m: number) => boolean = () => false;
export function setShoalTopIds(f: (m: number) => boolean): void { shoalTopIds = f; }

/** Tiles with this fraction of green pixels hold foliage (tree crowns, grass rims), not bare rock. */
const FOLIAGE = 0.2;
/** The tallest face of one terrace step, in rows (as a block mass's face). */
const MAX_STEP = 3;
/** Thickness of a free-standing wall (its cap covers this much of the ground behind it on screen). */
const WALL_T = 0.3;

/** Rock by a curated table: the General rock ids, or the map's secondary tileset's (Sootopolis'
 *  white crater rock, which its colours alone would call paving). */
export function curatedRock(a: MapAnalysis, m: number): boolean {
  return (a.isGeneralId(m) && rockIds(m)) || (m >= 512 && !!SECONDARY_ROCK.get(a.opts.secondaryTileset ?? 0)?.has(m));
}

/** A rock mass's top by its tileset's table (Lavaridge's pink top, whatever the ground's colour). */
const tableTop = (a: MapAnalysis, m: number) => m >= 512 && !!SECONDARY_ROCK_TOPS.get(a.opts.secondaryTileset ?? 0)?.has(m);

/** A secondary id of a tileset with a rock table that the table does not list: never rock, whatever
 *  its colour (Sootopolis' houses, fences and railings in the crater's colours). */
const unlisted = (a: MapAnalysis, m: number) => m >= 512 && !(SECONDARY_ROCK.get(a.opts.secondaryTileset ?? 0)?.has(m) ?? true);

/** Brown rock standing in the sea (General): never a cliff, it keeps its legacy art. */
const isSeaRock = (a: MapAnalysis, m: number) => a.isGeneralId(m) && seaRockIds(m);
/** The top of a rock on the shoals: the rows under it are that rock's own. */
const isShoalTop = (a: MapAnalysis, m: number) => a.isGeneralId(m) && shoalTopIds(m);
/** A sea cliff (not a shoal rock): rock meeting the water, a coast's waterline. */
const isSeaCliff = (a: MapAnalysis, m: number) => isSeaRock(a, m) && !isShoalTop(a, m);

/** Rock-looking metatile: brown/grey/beige or a muted dark rock shade, little foliage, not water.
 *  `dom`: its dominant lit colour, if already known. */
export function isRocky(a: MapAnalysis, m: number, dom = litDominant(a, m)): boolean {
  if (isSeaRock(a, m) || unlisted(a, m)) return false;
  if (curatedRock(a, m) || tableTop(a, m)) return true;
  if (a.info.green[m] >= FOLIAGE) return false;
  const c = dom;
  // (and not molten: Mt Chimney's lava is far more saturated than any rock, which stays under 0.5)
  if (!c || saturation(c) > 0.6) return false;
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
 * never cliffs. A wall running on past the door's row (a cliff beside the building) is not, but
 * the post closing either end of a structure is: a column running on one or two rows past the
 * door's row and stopping there (the trunk-side walls of Fortree's treehouses, standing on the
 * deck in front of the door).
 */
export function doorStructures(a: MapAnalysis, events: GridEvents): Uint8Array {
  const out = new Uint8Array(a.N);
  // (a building flood fill's cells outside every building are blocks: the treehouse beside
  // Fortree's Pokémon Center)
  const { stray } = buildingLayout(a, events);
  const block = (x: number, y: number) => a.inside(x, y) && (a.kind[a.idx(x, y)] === K.Block || stray[a.idx(x, y)] === 1);
  for (const w of events.warps) {
    const y = w.y - 1;
    if (!a.inside(w.x, w.y) || block(w.x, w.y) || !block(w.x, y)) continue;
    for (const dir of [-1, 1]) {
      const x0 = dir < 0 ? w.x : w.x + 1;
      let x = x0;
      for (; Math.abs(x - w.x) <= 9 && block(x, y) && !block(x, w.y + 1); x += dir) {
        for (let r = block(x, w.y) ? w.y : y; r > y - 14 && block(x, r); r--) out[a.idx(x, r)] = 1;
      }
      // (a post stands through the door row: blocked above, at and below it)
      if (x === x0 || Math.abs(x - w.x) > 9 || !block(x, y) || !block(x, w.y)) continue;
      // (at most four rows, no higher than the structure beside it: a cliff beside a cave mouth runs on)
      let e = w.y + 1, t = y, top = y;
      while (block(x, e + 1)) e++;
      while (block(x, t - 1)) t--;
      while (out[a.idx(x - dir, top - 1)]) top--;
      if (e > w.y + 2 || t < top || e - t > 3) continue;
      for (let r = t; r <= e; r++) out[a.idx(x, r)] = 1;
    }
  }
  return out;
}

/** Two colours are one tile colour (within one BGR555 step per channel). */
const near = (c: RGB, g: RGB) => Math.max(Math.abs(c[0] - g[0]), Math.abs(c[1] - g[1]), Math.abs(c[2] - g[2])) < 0.04;

/** Most frequent colour of a metatile, outlines excluded. */
const litDominant = (a: MapAnalysis, m: number) => dominantColor(a.info.both, [m], (k) => luma(k) > 0.15);

const LEDGE_DIR: Record<number, LedgeLip['dir']> = {
  [MB.JUMP_SOUTH]: 'S', [MB.JUMP_SOUTHEAST]: 'S', [MB.JUMP_SOUTHWEST]: 'S',
  [MB.JUMP_NORTH]: 'N', [MB.JUMP_NORTHEAST]: 'N', [MB.JUMP_NORTHWEST]: 'N',
  [MB.JUMP_EAST]: 'E', [MB.JUMP_WEST]: 'W',
};

/** Hash of a lattice point in [-1, 1]. */
const jitter = (x: number, y: number) => (hashCell(x, y, 0x5c1) / 4294967296) * 2 - 1;

const FACE_N: V3 = [0, 0, 1], EAST_N: V3 = [1, 0, 0], WEST_N: V3 = [-1, 0, 0], UP_N: V3 = [0, 1, 0], BACK_N: V3 = [0, 0, -1];

/** A run while extracting: rows y..e of column x, top rows y..e-F and face rows e-F+1..e. */
interface Run {
  r: CliffRun; y: number; e: number; F: number;
  /** Metatile of the plateau above a face between two levels (-1: a free-standing rock mass). */
  above: number;
  mts: number[];
  /** A band of a terraced mass topped in its ground's colour: index of the band it stands on in
   *  its column (-1: the lowest); undefined for every other run. */
  below?: number;
  /** For a wall at the water: the waterline row, where the sea begins in front of it (its own foot
   *  row over water; the last sea rock below a coastline standing on sea rocks). Walls side by side
   *  share a line at the waterline too, whichever of them stands on sea rocks. */
  line?: number;
}

/** Roles of a block tile in a rock mass. */
const enum Role {
  Other,
  /** In the colour of the map's ground (no foliage): a mass's top, or something standing on the ground. */
  Top,
  /** Rock face: a band of these raises the mass. */
  Face,
  /** Rock drawn in vertical strips (a terrace's east or west edge): part of the top it borders. */
  Side,
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
    // Blocks, and listed rock of a tileset's table that a door's flood fill swallowed outside the
    // building the buildings family modelled (Sootopolis' crater walls by its houses; a building left
    // to the legacy art keeps its whole flood fill). A secret-base spot breaks a run (the hole in the
    // rock keeps its legacy art), and so do a sea rock and what a tileset's rock table leaves out.
    const { stray } = buildingLayout(a, events);
    const modelled = a.buildings.map((b) => b.cells.some((c) => claims.has(c, CLAIM_OBJECT)));
    const blockKind = (i: number) => kind[i] === K.Block ||
      (stray[i] === 1 && modelled[a.building[i]] && a.mt[i] >= 512 && (curatedRock(a, a.mt[i]) || tableTop(a, a.mt[i])));
    const breaks = new Uint8Array(1024);
    for (let m = 0; m < 1024; m++) breaks[m] = isSeaRock(a, m) || unlisted(a, m) ? 1 : 0;
    // (the earlier families' claims, once; the cliffs' own claims are checked as they are made)
    const blocks = new Uint8Array(a.N);
    for (let i = 0; i < a.N; i++) {
      blocks[i] = blockKind(i) && !claims.has(i, CLAIM_OBJECT) && !structure[i] && !sign[i] && !isSecretBaseSpot(a, i) && !breaks[a.mt[i]] ? 1 : 0;
    }
    const isBlock = (i: number) => blocks[i] === 1 && !claims.has(i, CLAIM_OBJECT);
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
    /** The common walkable floor tiles (a mountain's rock top is often one of them). */
    const floorIds = new Set<number>();
    for (const [m, n] of floorCount) {
      if (n < floors * 0.03) continue;
      floorIds.add(m);
      const c = dom(m);
      if (c) ground.push(c);
    }
    const isGround = (c: RGB | null) => !!c && ground.some((g) => near(c, g));
    const rockFace = (m: number) => curatedRock(a, m) || (rock(m) && !isGround(dom(m)));
    /** Most rows of column x from y to e have rock (`rocky`) beside them (a mass, not a 1-wide strip). */
    const wide = (x: number, y: number, e: number, rocky = rockFace) => {
      let n = 0;
      for (let r = y; r <= e; r++) {
        const side = (nx: number) => inside(nx, r) && blockKind(idx(nx, r)) && rocky(a.mt[idx(nx, r)]);
        if (side(x - 1) || side(x + 1)) n++;
      }
      return n * 2 > e - y + 1;
    };

    // Tile roles in a rock mass. A tile in the ground's colour counts as rock only where it stands
    // on a rock face (the top of a mass: Mt Chimney's pink, Sootopolis' white, the General mountain
    // top): the same colour at a run's foot is a trunk, a boulder or the ground itself.
    // Not water-coloured (Sky Pillar's cloud backdrop, which is also a floor tile there); and if it
    // has art over its sprites (a top layer drawn above them), its ground layer shows that colour too:
    // not other ground under rock art standing up (Route 134's rock ridges drawn over a shoal).
    const isTop = (m: number) => {
      if (tableTop(a, m)) return true;
      const c = dom(m);
      if (a.info.green[m] >= FOLIAGE || !isGround(c) || classifyGroundColor(c!) === 'water') return false;
      if (attrLayerType(a.info.attributes[m]) === LayerType.COVERED || !a.info.topCover[m]) return true;
      const g = dominantColor(a.info.bottom, [m], (k) => luma(k) > 0.15);
      return !!g && near(c!, g);
    };
    // (cached per metatile: 0 not known yet, 1 no, 2 yes)
    const topCache = new Uint8Array(1024), faceCache = new Uint8Array(1024);
    const top = (m: number) => (topCache[m] ||= isTop(m) ? 2 : 1) === 2;
    const faceTile = (m: number) => (faceCache[m] ||= rockFace(m) && !top(m) ? 2 : 1) === 2;
    // A face tile drawn in vertical strips (no face beside it in most of its cells) is a terrace's
    // east or west edge: it does not raise the mass.
    const faceCells = new Map<number, number>(), besideFace = new Map<number, number>();
    const blockFace = (x: number, y: number) => inside(x, y) && isBlock(idx(x, y)) && faceTile(a.mt[idx(x, y)]);
    for (let i = 0; i < a.N; i++) {
      if (!faceTile(a.mt[i]) || !isBlock(i)) continue;
      const m = a.mt[i], x = a.cellX(i), y = a.cellY(i);
      faceCells.set(m, (faceCells.get(m) ?? 0) + 1);
      if (blockFace(x - 1, y) || blockFace(x + 1, y)) besideFace.set(m, (besideFace.get(m) ?? 0) + 1);
    }
    const roles = new Map<number, Role>();
    const role = (m: number) => {
      let v = roles.get(m);
      if (v === undefined) {
        v = top(m) ? Role.Top : !faceTile(m) ? Role.Other : (besideFace.get(m) ?? 0) * 2 < (faceCells.get(m) ?? 0) ? Role.Side : Role.Face;
        roles.set(m, v);
      }
      return v;
    };
    const massTile = (m: number) => role(m) !== Role.Other;

    /** A terraced mass standing on its face (rows y..e of column x, foot at hB): from the foot up,
     *  each band of face rows rises from the height reached so far and carries the top rows above it
     *  (the ground-coloured top, side strips). Stops at anything else. Rock that makes no step of its
     *  own (the face the run ends on; a face taller than a step: ridge edges zigzagging down one
     *  column) is part of the flat top of the band below, up to anything that is not rock. */
    const bands = (x: number, y: number, e: number, hB: number, foot: number): Run[] => {
      const list: Run[] = [];
      const at = (r: number) => role(a.mt[idx(x, r)]);
      /** The last band's top runs on from row r up through the rock above it. */
      const flatten = (r: number) => {
        const last = list[list.length - 1];
        if (!last) return;
        let t = r;
        while (t >= y && at(t) !== Role.Other) t--;
        for (let k = last.y - 1; k > t; k--) last.mts.unshift(a.mt[idx(x, k)]);
        last.y = t + 1;
      };
      let h = hB, r = e;
      while (r >= y && at(r) === Role.Face) {
        let f = r;
        while (f - 1 >= y && at(f - 1) === Role.Face) f--;
        if (r - f + 1 > MAX_STEP) { flatten(r); break; }
        let t = f - 1;
        while (t >= y && (at(t) === Role.Top || at(t) === Role.Side)) t--;
        if (t + 1 > f - 1) {
          if (t < y) flatten(r);
          break;
        }
        const F = r - f + 1, mts: number[] = [];
        for (let k = t + 1; k <= r; k++) mts.push(a.mt[idx(x, k)]);
        list.push({ r: { x, zf: r + 1 + h, hB: list.length ? h : foot, topH: h + F, tint: [0, 0, 0], lip: null }, y: t + 1, e: r, F, above: -1, mts, below: -1 });
        h += F;
        r = t;
      }
      return list;
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
        // (rows under a shoal rock's top are that rock's lower part: it stays legacy, whatever its size)
        if (ai >= 0 && isShoalTop(a, a.mt[ai])) { y = e + 1; continue; }
        const mts: number[] = [];
        for (let r = y; r <= e; r++) mts.push(a.mt[idx(x, r)]);
        // A coastline: a land rock face standing on a sea cliff at the waterline stands on the water
        // behind it (the sea rock keeps its legacy art in front). Land tops on a sea rock (an islet's)
        // are no face: they stay legacy with it.
        const onSeaRock = bi >= 0 && kind[bi] === K.Block && isSeaCliff(a, a.mt[bi]) && !claims.has(bi, CLAIM_OBJECT) &&
          role(mts[L - 1]) === Role.Face;
        const hB = walk(bi) ? Math.max(groundOf(bi), 0) : onSeaRock ? 0 : NaN;
        let line: number | undefined = bi >= 0 && kind[bi] === K.Water ? e : undefined;
        if (onSeaRock) {
          line = e + 1;
          while (line + 1 < a.maxY && kind[idx(x, line + 1)] === K.Block && isSeaCliff(a, a.mt[idx(x, line + 1)])) line++;
        }
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
        // (tops in the ground's colour count where the run stands on a rock face)
        const onFace = faceTile(mts[L - 1]);
        const nRock = mts.filter((m) => rockFace(m) || (onFace && top(m))).length;
        const level = !Number.isNaN(hA) && !Number.isNaN(hB) && hA > hB + 0.01;
        // A face over water (or a sea rock) reaches down to the water surface.
        const foot = bi >= 0 && kind[bi] === K.Water ? Math.min(hB, height[bi]) : onSeaRock ? Math.min(hB, a.waterLevel[bi]) : hB;
        // A free-standing mass topped in the colour of its ground (the walkable ground's own tile, on
        // mountain maps) or edged with strips: its terraces, if it stands on a face and is a mass, not
        // a 1-wide strip.
        if (!Number.isNaN(hB) && !level && mts.some((m) => role(m) === Role.Top || role(m) === Role.Side)) {
          const list = bands(x, y, e, hB, foot);
          if (list.length && wide(x, list[list.length - 1].y, e, massTile)) {
            list.forEach((b, k) => { b.below = k ? cands.length - 1 : -1; cands.push(b); });
            list[0].line = line;
            y = e + 1;
            continue;
          }
        }
        // A one-row wall of a tileset's listed rock between two walkways the analysis put at one level
        // (Sootopolis' terraces): a free-standing rock wall, a level tall.
        if (L === 1 && !Number.isNaN(hB) && walk(ai) && !level && mts[0] >= 512 && curatedRock(a, mts[0]) && role(mts[0]) === Role.Face) {
          cands.push({ r: { x, zf: e + 1 + hB, hB: foot, topH: hB + 1, tint: [0, 0, 0], lip: null, wall: true }, y, e, F: 1, above: -1, mts });
          y = e + 1;
          continue;
        }
        let F = 0;
        // A face between two levels: mostly rock (and, if the face is shorter than the run, a
        // mass rather than a 1-wide ridge: the edge of a terrace wall). A free-standing block mass
        // (no level change) needs stronger evidence: rock by a clear majority, at least two
        // columns wide and no foliage on its face (a grass rim on top is fine).
        if (!Number.isNaN(hB) && level && nRock * 2 >= L) {
          F = Math.min(L, Math.max(1, Math.round(hA - hB)));
          if (L - F >= 2 && !wide(x, y, e)) F = 0;
        } else if (!Number.isNaN(hB) && L >= 2 && mts.filter(rockFace).length * 3 >= L * 2 && wide(x, y, e)) {
          F = Math.min(L, Math.max(1, Math.min(3, Math.round(L / 2))));
          if (mts.slice(-F).some((m) => a.info.green[m] >= FOLIAGE)) F = 0;
        }
        if (F === 0) { y = e + 1; continue; }
        const topH = hB + F;
        cands.push({ r: { x, zf: e + 1 + hB, hB: foot, topH, tint: [0, 0, 0], lip: null }, y, e, F, above: level ? above : -1, mts, line });
        y = e + 1;
      }
    }

    // A wall stands on a line: keep runs with a neighbour column whose face has the same foot.
    // Diagonal staircases of short runs (Mossdeep's rock ridges) and lone columns stay legacy. A
    // terrace band without such a neighbour joins the top of the band it stands on (its rows and
    // every band above it: a flat top, as a mass without terraces), unless it is the lowest.
    const footing = (x: number, e: number, hB: number) => `${x},${e},${hB}`;
    const keep = cands.map(() => true);
    const up = new Int32Array(cands.length).fill(-1);
    cands.forEach((c, k) => { if (c.below !== undefined && c.below >= 0) up[c.below] = k; });
    for (let changed = true; changed;) {
      changed = false;
      const kept = cands.filter((_, k) => keep[k]);
      const feet = new Set(kept.map((c) => footing(c.r.x, c.e, c.r.hB)));
      const lines = new Set(kept.filter((c) => c.line !== undefined).map((c) => footing(c.r.x, c.line!, c.r.hB)));
      cands.forEach((c, k) => {
        const on = (set: Set<string>, l: number) => set.has(footing(c.r.x - 1, l, c.r.hB)) || set.has(footing(c.r.x + 1, l, c.r.hB));
        if (!keep[k] || on(feet, c.e) || (c.line !== undefined && on(lines, c.line))) return;
        changed = true;
        let t = k;
        for (let u = k; u >= 0; u = up[u]) { keep[u] = false; t = u; }
        const b = c.below !== undefined && c.below >= 0 ? cands[c.below] : null;
        if (!b) return;
        // (the band below now tops out where its column's bands did)
        b.y = cands[t].y;
        b.mts = [];
        for (let r = b.y; r <= b.e; r++) b.mts.push(a.mt[idx(b.r.x, r)]);
        up[c.below!] = -1;
      });
    }
    const runIndex = new Int32Array(cands.length).fill(-1);
    const runs: Run[] = [];
    cands.forEach((c, k) => { if (keep[k]) { runIndex[k] = runs.length; runs.push(c); } });
    /** Per cell: index of the run whose face covers it (-1 = none). */
    const faceRun = new Int32Array(a.N).fill(-1);
    /** Per cell: index of the run whose top rows include it (-1 = none). */
    const topRun = new Int32Array(a.N).fill(-1);
    runs.forEach((run, k) => {
      for (let r = run.e - run.F + 1; r <= run.e; r++) faceRun[idx(run.r.x, r)] = k;
      for (let r = run.y; r <= run.e - run.F; r++) topRun[idx(run.r.x, r)] = k;
    });

    // 2. Cliffs: runs side by side whose faces share a row are one wall, in one rock colour (the
    // tiles' own shading would change it column by column); so are a terrace's bands.
    const parent = Int32Array.from(runs, (_, k) => k);
    const find = (k: number): number => { while (parent[k] !== k) k = parent[k] = parent[parent[k]]; return k; };
    for (let i = 0; i < a.N; i++) {
      const k = faceRun[i];
      if (k < 0 || a.cellX(i) + 1 >= a.maxX) continue;
      const j = faceRun[i + 1];
      if (j >= 0) parent[find(k)] = find(j);
    }
    runs.forEach((run, k) => { if (run.below !== undefined && run.below >= 0) parent[find(k)] = find(runIndex[run.below]); });
    const groups = new Map<number, number[]>();
    const sums = new Map<number, Float64Array>();
    for (let k = 0; k < runs.length; k++) {
      const g = find(k);
      const list = groups.get(g) ?? [];
      list.push(k);
      groups.set(g, list);
    }
    const byCount = [...floorIds].sort((p, q) => floorCount.get(q)! - floorCount.get(p)!);
    const looksOf = new Map<number, number>();
    /** The ground's look for a tile in its colour: itself if it is a floor tile, else the most common
     *  floor tile of its colour. */
    const lookOf = (m: number) => {
      let v = looksOf.get(m);
      if (v === undefined) {
        const c = dom(m);
        v = floorIds.has(m) || !c ? m : byCount.find((n) => { const g = dom(n); return !!g && near(c, g); }) ?? m;
        looksOf.set(m, v);
      }
      return v;
    };
    /** Most frequent key of a count map (-1: none). */
    const most = (counts: Map<number, number>) => {
      let m = -1, best = 0;
      for (const [k, n] of counts) if (n > best) { best = n; m = k; }
      return m;
    };
    const count = (counts: Map<number, number>, m: number) => counts.set(m, (counts.get(m) ?? 0) + 1);
    for (const list of groups.values()) {
      const faceMts: number[] = [];
      const tops = new Map<number, number>(), floorTops = new Map<number, number>(), groundTops = new Map<number, number>();
      for (const k of list) {
        const run = runs[k];
        faceMts.push(...run.mts.slice(-run.F));
        // a rock mass's top: its rock tile whose ground layer shows rock (not the ground under the rim art)
        if (run.below === undefined && run.above < 0) for (const m of run.mts) if (rockFace(m) && !isGround(cellLook(a, m, looks).tint)) count(tops, m);
        // a terrace topped in the colour of its ground: the walkable ground's own tile, else its top tile
        if (run.below !== undefined) {
          for (const m of run.mts.slice(0, -run.F)) {
            if (floorIds.has(m)) count(floorTops, m);
            else if (top(m)) count(groundTops, m);
          }
        }
      }
      // lifted a little: the shaded, strata-banded wall reads darker than the tiles' flat pixels
      const mean = rockColor(a.info.both, faceMts.filter(rockFace), sums) ?? rockColor(a.info.both, faceMts, sums) ?? [0.6, 0.5, 0.4];
      const tint = soften(mean.map((v) => Math.min(1, v * 1.12)) as RGB);
      const rockTop = most(tops), terraceTop = floorTops.size ? most(floorTops) : most(groundTops);
      for (const k of list) {
        const run = runs[k];
        run.r.tint = tint;
        for (let r = run.y; r <= run.e - run.F; r++) {
          const i = idx(run.r.x, r);
          claims.claim(i, CLAIM_OBJECT);
          claims.groundY[i] = run.r.topH;
          // the plateau above runs on to the face; a rock mass is rock on top; a terrace is its ground,
          // cell by cell (Sootopolis' white top and its pink slope), its strips and flattened rock the
          // terrace's own ground
          const m = a.mt[i];
          claims.groundMt[i] = run.above >= 0 ? run.above
            : run.below !== undefined ? (top(m) ? lookOf(m) : terraceTop >= 0 ? terraceTop : m)
            : rockTop >= 0 ? rockTop : m;
        }
        for (let r = run.e - run.F + 1; r <= run.e; r++) claims.claim(idx(run.r.x, r), CLAIM_OBJECT | CLAIM_SURFACE);
      }
    }
    // Footless mass tops: a block run with nothing in front of it (it runs off the map's edge, or
    // into a tree or another family's model) all in the ground's colour (a mountain's top, the
    // border beyond the map) is ground, at the level legacy lays it flat at: the level behind it,
    // else its ground's. It takes the ground's look: the floor tile of its colour.
    for (let x = a.minX; x < a.maxX; x++) {
      let y = a.minY;
      while (y < a.maxY) {
        if (!isBlock(idx(x, y))) { y++; continue; }
        let e = y;
        while (e + 1 < a.maxY && isBlock(idx(x, e + 1))) e++;
        const bi = e + 1 < a.maxY ? idx(x, e + 1) : -1;
        const ai = y > a.minY ? idx(x, y - 1) : -1;
        const front = bi < 0 || kind[bi] === K.Tree || (claims.has(bi, CLAIM_OBJECT) && faceRun[bi] < 0 && topRun[bi] < 0);
        let tops = 0, clean = front;
        for (let r = y; r <= e && clean; r++) {
          const v = role(a.mt[idx(x, r)]);
          if (v === Role.Top) tops++;
          else if (v !== Role.Side) clean = false;
        }
        if (clean && tops) {
          const h = walk(ai) ? Math.max(groundOf(ai), 0) : a.groundH[idx(x, e)];
          let look = -1;
          for (let r = y; r <= e && look < 0; r++) if (role(a.mt[idx(x, r)]) === Role.Top) look = lookOf(a.mt[idx(x, r)]);
          for (let r = y; r <= e; r++) {
            const i = idx(x, r);
            claims.claim(i, CLAIM_OBJECT);
            claims.groundY[i] = h;
            claims.groundMt[i] = role(a.mt[i]) === Role.Top ? lookOf(a.mt[i]) : look;
          }
        }
        y = e + 1;
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
      // A free-standing wall: a slab behind its face. Only what can be seen: its cap (the face's top
      // edge is its front), its back, and its ends from the displaced face back, where no wall of the
      // same height goes on along its line.
      if (r.wall) {
        const z0 = r.zf - WALL_T, k = base(r.topH - r.hB) * strata(r.x + 0.5, r.topH);
        quads.quad([r.x, r.topH, z0], [r.x + 1, r.topH, z0], [r.x + 1, r.topH, r.zf], [r.x, r.topH, r.zf], UP_N, tint, k);
        quads.quad([r.x, r.topH, z0], [r.x + 1, r.topH, z0], [r.x + 1, r.hB, z0], [r.x, r.hB, z0], BACK_N, tint, k);
        for (const side of [0, 1]) {
          const n = faces.get(`${r.x + (side ? 1 : -1)},${r.zf}`);
          if (n?.wall && Math.abs(n.topH - r.topH) < 0.01 && Math.abs(n.hB - r.hB) < 0.01) continue;
          const X = r.x + side;
          for (let v = 0; v < ny; v++) {
            const f0 = P(side * NX, v), f1 = P(side * NX, v + 1);
            quads.quad([X, f1[1], z0], f1, f0, [X, f0[1], z0], side ? EAST_N : WEST_N, tint, k);
          }
        }
        continue;
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
