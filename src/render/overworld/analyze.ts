// Turns the 2D metatile grid into 3D geometry by "un-projecting" the GBA's oblique view.
//
// The GBA draws a point at ground row y and height h on screen row y - h. Every surface
// that depicts something raised by h is therefore placed at Z = y + h (and Y = h): from
// the default camera the result lines up with the original pixel art, while orbiting
// reveals real volume. The classifier's job is to decide, per cell, what height and
// orientation (floor / vertical face / roof slope / standing card) its pixels depict.
// Heuristics follow docs/notes/metatile-analysis.md.

import { MB } from '../../game/behaviors';
import type { TileInfo } from './tileInfo';
import type { GridData } from './world';

export interface ClassifyOptions {
  info: TileInfo;
  /** Primary tileset is gTileset_General, so the analysed General ids apply. */
  generalPrimary: boolean;
  indoor: boolean;
  underground: boolean;
  /** Dive map (map type 5). Read only by the kit: its seabed is drawn in water colours. */
  underwater: boolean;
  /** ROM address of the secondary tileset (0 / absent: unknown). Read only by the kit: it picks the
   *  curated tables of that tileset's ids (512+). */
  secondaryTileset?: number;
  /** ROM address of the primary tileset (0 / absent: unknown). Read only by the kit: the interior scope
   *  (`kit/interior/scope.ts`) needs `gTileset_Building`. */
  primaryTileset?: number;
  margin: number;
}

// ---------------------------------------------------------------- id tables (General tileset)

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
export const NARROW_TREE = new Set([0x016, 0x017, 0x0c6, 0x0c7, 0x0ce, 0x040, 0x083, 0x084, 0x132, 0x133, 0x139]);
export const ROUND_TREE = new Set([...range(0x1d4, 0x1d7), ...range(0x1dc, 0x1df), ...range(0x1e4, 0x1e7), 0x1ec, 0x1ed,
  ...range(0x1f2, 0x1f5), 0x1fc, 0x1fd]);
export const RIM = new Set([0x068, 0x069, 0x06a, 0x080, 0x081, 0x082, 0x173]);
export const STAIRS = new Set([0x0af, 0x0cf]);

export const WATER_BEHAVIORS = new Set<number>([
  MB.POND_WATER, MB.INTERIOR_DEEP_WATER, MB.DEEP_WATER, MB.SOOTOPOLIS_DEEP_WATER, MB.OCEAN_WATER,
  MB.NO_SURFACING, MB.SEAWEED, MB.SEAWEED_NO_SURFACING, MB.EASTWARD_CURRENT, MB.WESTWARD_CURRENT,
  MB.NORTHWARD_CURRENT, MB.SOUTHWARD_CURRENT, MB.UNUSED_SOOTOPOLIS_DEEP_WATER, MB.UNUSED_SOOTOPOLIS_DEEP_WATER_2,
  MB.WATERFALL,
]);
export const DOOR_BEHAVIORS = new Set<number>([
  MB.ANIMATED_DOOR, MB.PETALBURG_GYM_DOOR, MB.CLOSED_SOOTOPOLIS_DOOR, MB.TRICK_HOUSE_PUZZLE_DOOR,
  MB.SKY_PILLAR_CLOSED_DOOR, MB.WATER_DOOR,
]);

export function isWaterBehavior(b: number): boolean {
  return WATER_BEHAVIORS.has(b);
}

export const enum K { Void, Floor, Water, Ledge, Block, Tree, Building, Stairs }

export const ROOF_SLOPE = 0.45;
export const WATER_DROP = 0.3;

export interface BuildingRegion { cells: number[]; doorRow: number }

export interface MapAnalysis {
  opts: ClassifyOptions;
  info: TileInfo;
  minX: number; minY: number; maxX: number; maxY: number;
  GW: number; GH: number; N: number;
  idx(x: number, y: number): number;
  inside(x: number, y: number): boolean;
  cellX(i: number): number;
  cellY(i: number): number;
  mt: Int16Array; col: Uint8Array; elev: Uint8Array; beh: Uint8Array; layer: Uint8Array;
  kind: Uint8Array;
  roundTree: Uint8Array;
  building: Int16Array;
  buildings: BuildingRegion[];
  height: Float32Array;
  waterLevel: Float32Array;
  groundOf: Int16Array;
  groundH: Float32Array;
  groundRefs: Int16Array;
  /** Per cell: 1 (walkable) / 2 (blocked) where the map's block is metatile 0x3FF with collision or elevation bits of its
   *  own: the game draws the secondary tileset's metatile 0x3FF there (only MAPGRID_UNDEFINED, 0x3FF exactly, means the
   *  border); the classifier reads the border there as it always has (today's look, kept). Read only by the interior kit:
   *  Sootopolis' houses floor parts of their rooms with it. */
  real3ff: Uint8Array;
  /** NORMAL/SPLIT metatile with top-layer pixels (an overhang drawn over objects). */
  hasTop(i: number): boolean;
  isGeneralId(m: number): boolean;
}

export interface CellQueries {
  /** Per metatile: the ground metatile its cutout variant is compared against (-1 = none). */
  groundRefs: Int16Array;
  /** Most common walkable metatile (for the base ground plane colour). */
  dominantFloor: number;
  heightAt(x: number, y: number): number;
  waterLevelAt(x: number, y: number): number;
  isWater(x: number, y: number): boolean;
  /** Debug: ASCII map of cell kinds. */
  debugMap(): string;
  minX: number; minY: number; maxX: number; maxY: number;
}

export function analyze(grid: GridData, opts: ClassifyOptions): MapAnalysis {
  const { info, margin } = opts;
  const W = grid.width;
  const H = grid.height;
  const minX = -margin, minY = -margin, maxX = W + margin, maxY = H + margin;
  const GW = maxX - minX;
  const GH = maxY - minY;
  const N = GW * GH;
  const idx = (x: number, y: number) => (y - minY) * GW + (x - minX);
  const inside = (x: number, y: number) => x >= minX && y >= minY && x < maxX && y < maxY;

  // ---------------------------------------------------------------- raw cells
  const mt = new Int16Array(N);
  const col = new Uint8Array(N);
  const elev = new Uint8Array(N);
  const beh = new Uint8Array(N);
  const layer = new Uint8Array(N);
  const real3ff = new Uint8Array(N);
  const borderAt = (x: number, y: number) => {
    const bx = (((x + grid.borderPhase) % grid.borderW) + grid.borderW) % grid.borderW;
    const by = (((y + grid.borderPhase) % grid.borderH) + grid.borderH) % grid.borderH;
    return (grid.border[by * grid.borderW + bx] & 0x3ff) | 0x0400;
  };
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      let raw = x >= 0 && y >= 0 && x < W && y < H ? grid.cells[y * W + x] : borderAt(x, y);
      if ((raw & 0x3ff) === 0x3ff) {
        if (raw !== 0x3ff && x >= 0 && y >= 0 && x < W && y < H) real3ff[idx(x, y)] = (raw >> 10) & 3 ? 2 : 1;
        raw = borderAt(x, y);
      }
      const i = idx(x, y);
      mt[i] = raw & 0x3ff;
      col[i] = (raw >> 10) & 3 ? 1 : 0;
      elev[i] = raw >> 12;
      const attr = info.attributes[mt[i]];
      beh[i] = attr & 0xff;
      layer[i] = attr >> 12;
    }
  }

  // ---------------------------------------------------------------- kinds
  const kind = new Uint8Array(N);
  const voidAllowed = opts.indoor || opts.underground;
  for (let i = 0; i < N; i++) {
    const b = beh[i];
    if (voidAllowed && info.isVoid[mt[i]]) kind[i] = K.Void;
    else if (WATER_BEHAVIORS.has(b)) kind[i] = K.Water; // map-edge water is blocked but still water
    else if (b >= MB.JUMP_EAST && b <= MB.JUMP_SOUTHWEST) kind[i] = K.Ledge;
    else if (!col[i]) kind[i] = K.Floor;
    else kind[i] = K.Block;
  }
  // Blocked cells that are mostly water-coloured next to water (submerged rocks, map-edge sea)
  // lie flat at water level instead of standing up.
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = idx(x, y);
      if (kind[i] !== K.Block || info.blue[mt[i]] < 0.6) continue;
      let waterN = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (inside(nx, ny) && kind[idx(nx, ny)] === K.Water) waterN++;
      }
      if (waterN >= 1) kind[i] = K.Water;
    }
  }
  const isGeneralId = (m: number) => opts.generalPrimary && m < 512;
  const roundTree = new Uint8Array(N);
  if (!opts.indoor) {
    for (let i = 0; i < N; i++) {
      if (kind[i] !== K.Block) continue;
      const m = mt[i];
      if (isGeneralId(m)) {
        if (NARROW_TREE.has(m)) kind[i] = K.Tree;
        else if (ROUND_TREE.has(m)) { kind[i] = K.Tree; roundTree[i] = 1; }
      } else if (layer[i] === 0 && info.green[m] > 0.55) {
        kind[i] = K.Tree;
      }
    }
  }
  // Stairs: General stair ids, or passable cells squeezed between blocked terrain on W and E.
  for (let y = minY + 1; y < maxY - 1; y++) {
    for (let x = minX + 1; x < maxX - 1; x++) {
      const i = idx(x, y);
      if (kind[i] !== K.Floor) continue;
      const m = mt[i];
      const flanked = kind[idx(x - 1, y)] === K.Block && kind[idx(x + 1, y)] === K.Block;
      if ((isGeneralId(m) && STAIRS.has(m)) || (flanked && !opts.indoor && layer[i] !== 1 && beh[i] === MB.NORMAL &&
        (kind[idx(x, y - 1)] !== K.Block || kind[idx(x, y + 1)] !== K.Block))) {
        if (isGeneralId(m) ? STAIRS.has(m) : flanked) kind[i] = K.Stairs;
      }
    }
  }

  // ---------------------------------------------------------------- buildings (flood fill from doors)
  const building = new Int16Array(N).fill(-1);
  const buildings: { cells: number[]; doorRow: number }[] = [];
  if (!opts.indoor && !opts.underground) {
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX; x++) {
        const i = idx(x, y);
        if (!DOOR_BEHAVIORS.has(beh[i]) || kind[i] !== K.Block || building[i] >= 0) continue;
        const id = buildings.length;
        const cells: number[] = [];
        const queue: [number, number][] = [[x, y]];
        building[i] = id;
        while (queue.length) {
          const [cx, cy] = queue.pop()!;
          cells.push(idx(cx, cy));
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (!inside(nx, ny) || ny > y || ny < y - 14 || Math.abs(nx - x) > 9) continue;
            const j = idx(nx, ny);
            if (building[j] >= 0 || kind[j] !== K.Block) continue;
            // Don't leak into 1-row horizontal strips (fences) or rock rims.
            const above = inside(nx, ny - 1) ? kind[idx(nx, ny - 1)] : K.Block;
            const below = inside(nx, ny + 1) ? kind[idx(nx, ny + 1)] : K.Block;
            if (above !== K.Block && above !== K.Building && below !== K.Block && below !== K.Building && ny !== y) continue;
            if (isGeneralId(mt[j]) && RIM.has(mt[j])) continue;
            building[j] = id;
            queue.push([nx, ny]);
          }
        }
        for (const c of cells) kind[c] = K.Building;
        buildings.push({ cells, doorRow: y });
      }
    }
  }

  // ---------------------------------------------------------------- height solver
  // Walkable components (same elevation, 4-connected), linked by cliff-face constraints.
  const comp = new Int32Array(N).fill(-1);
  const compSize: number[] = [];
  const compElev: number[] = [];
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const s = idx(x, y);
      if (kind[s] !== K.Floor || comp[s] >= 0) continue;
      const id = compSize.length;
      let size = 0;
      const stack = [s];
      comp[s] = id;
      while (stack.length) {
        const c = stack.pop()!;
        size++;
        const cx = (c % GW) + minX, cy = ((c / GW) | 0) + minY;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny);
          if (comp[j] >= 0 || kind[j] !== K.Floor) continue;
          if (elev[c] !== elev[j]) continue; // join equal elevations only (transitions stay separate)
          comp[j] = id;
          stack.push(j);
        }
      }
      compSize.push(size);
      compElev.push(elev[s]);
    }
  }
  const C = compSize.length;
  const votes = new Map<string, Map<number, number>>();
  const vote = (a: number, b: number, d: number) => {
    if (a < 0 || b < 0 || a === b) return;
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const dd = a < b ? d : -d;
    let m = votes.get(key);
    if (!m) { m = new Map(); votes.set(key, m); }
    m.set(dd, (m.get(dd) ?? 0) + 1);
  };
  for (let x = minX; x < maxX; x++) {
    let y = minY;
    while (y < maxY) {
      const i = idx(x, y);
      if (kind[i] !== K.Floor && kind[i] !== K.Stairs) { y++; continue; }
      // find next walkable cell below, through a blocked run or a stairs run
      let e = y + 1;
      while (e < maxY && (kind[idx(x, e)] === K.Block || kind[idx(x, e)] === K.Stairs)) e++;
      if (e < maxY && e > y + 1 && kind[idx(x, e)] === K.Floor && kind[i] === K.Floor) {
        const runTop = idx(x, y + 1);
        let blocked = 0, stairs = 0;
        for (let k = y + 1; k < e; k++) {
          if (kind[idx(x, k)] === K.Block) blocked++;
          else stairs++;
        }
        const len = e - y - 1;
        const isRim = layer[runTop] === 1 && info.topCover[mt[runTop]] > 0 && kind[runTop] === K.Block;
        if (stairs === len) vote(comp[i], comp[idx(x, e)], len);
        else if (blocked === len && !isRim && len <= 4) vote(comp[i], comp[idx(x, e)], len);
        else if (blocked === len && isRim) vote(comp[i], comp[idx(x, e)], 0);
      }
      y = e;
    }
  }
  // weighted union-find with offsets: height(c) = height(root) + off[c]
  const parent = Int32Array.from({ length: C }, (_, i) => i);
  const off = new Float32Array(C);
  // iterative find with path compression that keeps offsets correct
  const root = (c: number): [number, number] => {
    let o = 0;
    let r = c;
    while (parent[r] !== r) { o += off[r]; r = parent[r]; }
    // compress
    let cur = c, acc = o;
    while (parent[cur] !== cur) {
      const next = parent[cur];
      const nextAcc = acc - off[cur];
      parent[cur] = r;
      off[cur] = acc;
      cur = next;
      acc = nextAcc;
    }
    return [r, o];
  };
  const pairs = [...votes.entries()].map(([key, m]) => {
    const [a, b] = key.split(',').map(Number);
    let bestD = 0, bestN = -1, total = 0;
    for (const [d, n] of m) { total += n; if (n > bestN || (n === bestN && Math.abs(d) < Math.abs(bestD))) { bestN = n; bestD = d; } }
    return { a, b, d: bestD, w: bestN * Math.min(compSize[a], compSize[b]) + total };
  }).sort((p, q) => q.w - p.w);
  for (const { a, b, d } of pairs) {
    // h(a) - h(b) = d
    const [ra, oa] = root(a);
    const [rb, ob] = root(b);
    if (ra === rb) continue;
    // attach rb under ra: h(rb) = h(ra) + off[rb]; h(b) = h(rb) + ob = h(a) - d = h(ra) + oa - d
    parent[rb] = ra;
    off[rb] = oa - d - ob;
  }
  const compHeight = new Float32Array(C);
  const rootMin = new Map<number, number>();
  for (let c = 0; c < C; c++) {
    const [r, o] = root(c);
    compHeight[c] = o;
    rootMin.set(r, Math.min(rootMin.get(r) ?? Infinity, o));
  }
  const constrained = new Uint8Array(C);
  for (const { a, b } of pairs) { constrained[a] = 1; constrained[b] = 1; }
  for (let c = 0; c < C; c++) {
    const [r] = root(c);
    compHeight[c] = Math.min(8, Math.max(0, compHeight[c] - (rootMin.get(r) ?? 0)));
  }
  // Unconstrained components (transition cells, small pockets) adopt their neighbours' height.
  for (let pass = 0; pass < 3; pass++) {
    const sum = new Float32Array(C), cnt = new Float32Array(C);
    for (let y = minY; y < maxY; y++) {
      for (let x = minX; x < maxX - 1; x++) {
        for (const [i, j] of [[idx(x, y), idx(x + 1, y)], ...(y + 1 < maxY ? [[idx(x, y), idx(x, y + 1)]] : [])]) {
          const a = comp[i], b = comp[j];
          if (a < 0 || b < 0 || a === b) continue;
          if (!constrained[a] && constrained[b]) { sum[a] += compHeight[b]; cnt[a]++; }
          if (!constrained[b] && constrained[a]) { sum[b] += compHeight[a]; cnt[b]++; }
        }
      }
    }
    for (let c = 0; c < C; c++) {
      if (!constrained[c] && cnt[c] > 0) { compHeight[c] = Math.round((sum[c] / cnt[c]) * 2) / 2; constrained[c] = 1; }
    }
  }
  // Raised decks (elevation 4) with no face constraint: lift to deck height.
  for (let c = 0; c < C; c++) {
    if (!opts.indoor && compElev[c] === 4 && compHeight[c] === 0) {
      const [r] = root(c);
      let alone = true;
      for (let k = 0; k < C; k++) if (k !== c && root(k)[0] === r) { alone = false; break; }
      if (alone) compHeight[c] = 2;
    }
  }

  // ---------------------------------------------------------------- per-cell heights
  const height = new Float32Array(N).fill(NaN);
  for (let i = 0; i < N; i++) if (kind[i] === K.Floor && comp[i] >= 0) height[i] = compHeight[comp[i]];
  // Stairs ramp between the floors above and below.
  for (let x = minX; x < maxX; x++) {
    for (let y = minY; y < maxY; y++) {
      if (kind[idx(x, y)] !== K.Stairs || (y > minY && kind[idx(x, y - 1)] === K.Stairs)) continue;
      let e = y;
      while (e + 1 < maxY && kind[idx(x, e + 1)] === K.Stairs) e++;
      const top = y > minY ? height[idx(x, y - 1)] : NaN;
      const bot = e + 1 < maxY ? height[idx(x, e + 1)] : NaN;
      const ht = Number.isNaN(top) ? (Number.isNaN(bot) ? 0 : bot) : top;
      const hb = Number.isNaN(bot) ? ht : bot;
      const n = e - y + 1;
      for (let k = y; k <= e; k++) height[idx(x, k)] = hb + ((ht - hb) * (e - k + 0.5)) / n;
    }
  }
  // Ledges and anything else walkable-adjacent: inherit the floor south (then north).
  const nearestFloorHeight = (x: number, y: number): number => {
    for (let r = 1; r <= 6; r++) {
      for (const [dx, dy] of [[0, r], [0, -r], [-r, 0], [r, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const h = height[idx(nx, ny)];
        if (!Number.isNaN(h) && (kind[idx(nx, ny)] === K.Floor || kind[idx(nx, ny)] === K.Stairs)) return h;
      }
    }
    return 0;
  };
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = idx(x, y);
      if (kind[i] === K.Ledge || (kind[i] === K.Floor && Number.isNaN(height[i]))) height[i] = nearestFloorHeight(x, y);
    }
  }
  // Water level: below the lowest adjacent floor.
  const waterLevel = new Float32Array(N).fill(-WATER_DROP);
  for (let i = 0; i < N; i++) {
    if (kind[i] !== K.Water) continue;
    const x = (i % GW) + minX, y = ((i / GW) | 0) + minY;
    let lo = Infinity;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (kind[j] === K.Floor && !Number.isNaN(height[j])) lo = Math.min(lo, height[j]);
    }
    if (lo !== Infinity) waterLevel[i] = lo - WATER_DROP;
  }
  // smooth water levels across connected water (a couple of passes)
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < N; i++) {
      if (kind[i] !== K.Water) continue;
      const x = (i % GW) + minX, y = ((i / GW) | 0) + minY;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (kind[j] === K.Water) waterLevel[i] = Math.min(waterLevel[i], waterLevel[j]);
      }
    }
  }
  for (let i = 0; i < N; i++) if (kind[i] === K.Water) height[i] = waterLevel[i];

  // ---------------------------------------------------------------- ground references
  // For every blocked cell, which ground metatile is "behind" it (cutout reference + fill floor).
  const groundOf = new Int16Array(N).fill(-1);
  const groundH = new Float32Array(N);
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const i = idx(x, y);
      if (kind[i] === K.Floor || kind[i] === K.Water || kind[i] === K.Stairs || kind[i] === K.Void) continue;
      let found = -1, fh = 0;
      for (let r = 1; r <= 8 && found < 0; r++) {
        for (const [dx, dy] of [[0, r], [-r, 0], [r, 0], [0, -r]]) {
          const nx = x + dx, ny = y + dy;
          if (!inside(nx, ny)) continue;
          const j = idx(nx, ny);
          const plainFloor = kind[j] === K.Floor && (layer[j] !== 0 || info.topCover[mt[j]] === 0);
          if (plainFloor || kind[j] === K.Water) {
            found = mt[j]; fh = height[j]; break;
          }
        }
      }
      groundOf[i] = found;
      groundH[i] = Number.isNaN(fh) ? 0 : fh;
    }
  }
  const groundRefs = new Int16Array(1024).fill(-1);
  {
    const votesRef = new Map<number, Map<number, number>>();
    for (let i = 0; i < N; i++) {
      if (groundOf[i] < 0) continue;
      let m = votesRef.get(mt[i]);
      if (!m) { m = new Map(); votesRef.set(mt[i], m); }
      m.set(groundOf[i], (m.get(groundOf[i]) ?? 0) + 1);
    }
    for (const [m, v] of votesRef) {
      let best = -1, bn = 0;
      for (const [g, n] of v) if (n > bn) { bn = n; best = g; }
      groundRefs[m] = best;
    }
  }

  const hasTop = (i: number) => layer[i] !== 1 && info.topCover[mt[i]] > 0;
  return {
    opts, info, minX, minY, maxX, maxY, GW, GH, N, idx, inside,
    cellX: (i) => (i % GW) + minX,
    cellY: (i) => ((i / GW) | 0) + minY,
    mt, col, elev, beh, layer, kind, roundTree, building, buildings,
    height, waterLevel, groundOf, groundH, groundRefs, real3ff, hasTop, isGeneralId,
  };
}

/** Point queries the renderer asks of a built world (heights, water, debug map). */
export function queries(a: MapAnalysis): CellQueries {
  const { kind, height, waterLevel, groundH, mt, idx, inside, N, minX, minY, maxX, maxY } = a;
  const cellAt = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    return inside(xi, yi) ? idx(xi, yi) : -1;
  };
  return {
    groundRefs: a.groundRefs,
    heightAt(x, y) {
      const i = cellAt(x, y);
      if (i < 0) return 0;
      const h = height[i];
      if (!Number.isNaN(h)) return kind[i] === K.Water ? h : Math.max(0, h);
      return groundH[i];
    },
    waterLevelAt(x, y) {
      const i = cellAt(x, y);
      return i >= 0 ? waterLevel[i] : -WATER_DROP;
    },
    isWater(x, y) {
      const i = cellAt(x, y);
      return i >= 0 && kind[i] === K.Water;
    },
    minX, minY, maxX, maxY,
    dominantFloor: (() => {
      const counts = new Map<number, number>();
      for (let i = 0; i < N; i++) if (kind[i] === K.Floor) counts.set(mt[i], (counts.get(mt[i]) ?? 0) + 1);
      let best = -1, bn = 0;
      for (const [m, n] of counts) if (n > bn) { bn = n; best = m; }
      return best;
    })(),
    debugMap() {
      const ch = ' .~^#TBs';
      let out = '';
      for (let y = minY; y < maxY; y++) {
        let row = '';
        for (let x = minX; x < maxX; x++) row += ch[kind[idx(x, y)]];
        out += row + String.fromCharCode(10);
      }
      return out;
    },
  };
}
