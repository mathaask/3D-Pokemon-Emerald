// An in-scope interior's room layout (Phase 4, D4/D12), pure: where the room floor is, which cells are the back wall's
// art band, where the walls stand, the wall art to model (windows, clocks, decals) and the doorways.
//
// The GBA draws a room's back wall as 1–3 blocked rows of wall art under the black void. Per column, each maximal run of
// non-void cells [t, b] has a *back line*: its first room row. Rows t … backLine − 1 are the band (the back wall's art),
// the rest is the room (inside). The 3D back wall's inner face stands RECESS north of the back line, so furniture drawn in
// the wall rows (fridges, sinks, bookcases) stands in the recess without reaching the walkable row. Side and front walls
// follow every boundary between room cells and the rest (void, band).
//
// Partitions (`RoomLayout.partition`, a subset of the band; their runs carry `partition: true`): a dividing wall drawn
// across a room (1–3 rows of wall art with room on both sides: the Weather Institute, Rustboro's flats) and a wall-art
// strip standing in the room (a north–south partition: Dewford Hall, Wanda's house). Their runs follow the partition
// cells' own outline (no recess), so the shell can build them as half-height partitions with thickness.
//
// Lines are in grid units: world x for E/W runs, world z at floor height 0 for N/S runs (the builder adds `floorY`).

import { MB } from '../../../game/behaviors';
import { K, type MapAnalysis } from '../../overworld/analyze';
import type { GridWarp } from '../events';
import { FURNITURE_KINDS, interiorIds, type InteriorId } from '../tables/building';

export const RECESS = 0.5;     // the back wall's inner face this far north of the back line
export const WALL_H = 2.6;     // wall height over the room floor
export const WALL_T = 0.3;     // wall thickness (outwards)
export const BAND_MAX = 3;     // at most this many wall-art rows under the void
export type WallDir = 'N' | 'E' | 'S' | 'W';   // the side of the room the wall closes (N = back wall, looks south)
/** A straight wall: its inner face on `line` (world z for N/S, world x for E/W), from `from` to `to` along the other axis.
 *  `partition`: the face of a partition (a dividing wall in the room), present only then. */
export interface WallRun { dir: WallDir; line: number; from: number; to: number; floorY: number; partition?: true }
/** Wall art on a back wall: columns [x0, x1), art rows row0..row1 (0 = the band's top) of a band `rows` tall. */
export interface WallFeature { kind: 'window' | 'clock' | 'decor'; x0: number; x1: number; row0: number; row1: number; rows: number; cells: number[] }
/** An exit's opening in the wall of direction `dir`: on its run's `line`, from `from` to `to` along the run. */
export interface DoorGap { dir: WallDir; line: number; from: number; to: number }
export interface RoomLayout {
  rooms: number;
  inside: Uint8Array;    // per analysis cell: room floor area (walkable, furniture, stairs, mats)
  band: Uint8Array;      // per cell: back-wall art (non-void, above the back line), partitions included
  partition: Uint8Array; // per cell: a partition's cell (a subset of `band`)
  backLine: Int32Array;  // per column (x − a.minX): grid row of the first room row of its northernmost room; −1 none
  runs: WallRun[]; features: WallFeature[]; doors: DoorGap[];
  floorTile: number;     // the most common walkable floor metatile (boards / tiles / carpet)
}

/** The layout's rules, each switchable for the mutation check (tests/smoke/interiorRooms.test.ts: switching any one off
 *  changes a pinned map). Test seam only: the app never switches them; a layout already memoised is not rebuilt. */
export const ROOM_RULES = {
  /** A column deeper than the mode takes the mode when its extra rows are furniture (F8). */
  furnitureMode: true,
  /** The mode is voted by the columns whose band is plain wall art. */
  plainVote: true,
  /** Only each column's northernmost segment in its room votes; the others take mode 0. */
  firstSegment: true,
  /** Walkable furniture tops (a plant's leaves over the wall rows) are no room row. */
  furnitureTops: true,
  /** Wall art left in the room (dividing walls, north–south strips) is partitions. */
  partitions: true,
  /** A top row's E/W run reaches into the recess only when no room lies beside it there. */
  corner: true,
};

const FURNITURE = new Set<InteriorId>(FURNITURE_KINDS);
const DIR_ORDER: Record<WallDir, number> = { N: 0, E: 1, S: 2, W: 3 };
const DIRS: readonly WallDir[] = ['N', 'E', 'S', 'W'];

/** Per feature: the z of the wall it hangs on (by reference: a copied feature falls back in `windowRect`). */
const featureZ = new WeakMap<WallFeature, number>();
const memo = new WeakMap<MapAnalysis, { ids: readonly (InteriorId | null)[]; warps: readonly GridWarp[]; L: RoomLayout }>();

/** Room material: an in-map cell (a map whose border is no void, the Department Store's rooftop, ends at its edge)
 *  that is non-void, or a block of metatile 0x3FF the classifier reads as the border (`real3ff`: Sootopolis' houses
 *  floor parts of their rooms with it). */
function nonVoid(a: MapAnalysis, i: number): boolean {
  const m = a.opts.margin, x = a.cellX(i), y = a.cellY(i);
  if (x < a.minX + m || y < a.minY + m || x >= a.maxX - m || y >= a.maxY - m) return false;
  return a.kind[i] !== K.Void || a.real3ff[i] > 0;
}

/** Walkable: room material the game lets the player stand on. */
function walkable(a: MapAnalysis, i: number): boolean {
  return a.kind[i] !== K.Void ? a.col[i] === 0 : a.real3ff[i] === 1;
}

/** Walkable and not a piece of furniture's top that the game lets one stand on (a plant's leaves drawn over the wall
 *  rows, out of reach behind its pot); stairs are room (they open an alcove). */
function standable(a: MapAnalysis, ids: readonly (InteriorId | null)[], i: number): boolean {
  const id = ids[i];
  return walkable(a, i) && !(ROOM_RULES.furnitureTops && id != null && FURNITURE.has(id) && id !== 'stairsUp' && id !== 'stairsDown');
}

/** Wall art: a blocked cell with a wall-part id. */
function isArt(a: MapAnalysis, ids: readonly (InteriorId | null)[], i: number): boolean {
  const id = ids[i];
  return !walkable(a, i) && (id === 'wall' || id === 'window' || id === 'clock' || id === 'decor');
}

/** Wall art's feature kind for a band cell's id: window / clock / decor; unknown cells (null, `legacy`) are decals too
 *  (D4: band cells are never left to legacy). Paint (`wall`), furniture and floor ids are no feature. */
function featureKind(id: InteriorId | null): WallFeature['kind'] | null {
  if (id === 'window' || id === 'clock' || id === 'decor') return id;
  if (id === null || id === 'legacy') return 'decor';
  return null;
}

interface Edge { line: number; from: number; to: number; partition: boolean }
/** A unit boundary edge of inside cell (x, y) towards `dir` (the run it needs), or null when the neighbour is room.
 *  `bl`: per cell, its segment's back line (for band cells: of the room rows below them). */
function edgeOf(a: MapAnalysis, inside: Uint8Array, band: Uint8Array, part: Uint8Array, bl: Int32Array, x: number, y: number, dir: WallDir): Edge | null {
  const dx = dir === 'E' ? 1 : dir === 'W' ? -1 : 0, dy = dir === 'S' ? 1 : dir === 'N' ? -1 : 0;
  const nx = x + dx, ny = y + dy;
  const n = a.inside(nx, ny) ? a.idx(nx, ny) : -1;
  if (n >= 0 && inside[n]) return null;
  const partition = n >= 0 && part[n] === 1;
  // a partition's faces follow its cells' outline; the back wall stands in the recess
  if (dir === 'N') return { line: partition ? y : y - RECESS, from: x, to: x + 1, partition };
  if (dir === 'S') return { line: y + 1, from: x, to: x + 1, partition };
  const i = a.idx(x, y);
  // the room's top row reaches back into the recess under a back wall (unless room lies there beside it: its own wall
  // closes the corner); beside a back wall's band the run ends at that band's own back wall
  const up = a.inside(x, y - 1) ? a.idx(x, y - 1) : -1;
  const diag = a.inside(nx, y - 1) ? a.idx(nx, y - 1) : -1;
  const recess = y === bl[i] && !(up >= 0 && part[up]) && !(ROOM_RULES.corner && diag >= 0 && inside[diag]);
  const to = n >= 0 && band[n] && !partition && y + 1 === bl[n] ? bl[n] - RECESS : y + 1;
  return { line: dir === 'E' ? x + 1 : x, from: recess ? y - RECESS : y, to, partition };
}

/** Merges collinear adjacent spans (same dir, line, floorY and partition flag): sorted by dir, from, line. */
function mergeSpans<T extends { dir: WallDir; line: number; from: number; to: number; floorY?: number; partition?: true }>(spans: T[]): T[] {
  const same = (p: T, q: T) => p.dir === q.dir && p.line === q.line && p.floorY === q.floorY && p.partition === q.partition;
  spans.sort((p, q) => DIR_ORDER[p.dir] - DIR_ORDER[q.dir] || p.line - q.line || (p.floorY ?? 0) - (q.floorY ?? 0)
    || Number(p.partition ?? 0) - Number(q.partition ?? 0) || p.from - q.from);
  const out: T[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && same(last, s) && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out.sort((p, q) => DIR_ORDER[p.dir] - DIR_ORDER[q.dir] || p.from - q.from || p.line - q.line);
}

/**
 * The room layout of an in-scope interior (memoised per analysis, ids and warps: pass the build's own `warps` from every
 * caller, or the layout is rebuilt).
 * Per column, each maximal non-void segment [t, b]: its back line is the first walkable row in [t, min(b, t + BAND_MAX)]
 * (a walkable furniture cell other than stairs does not count: a plant's leaves drawn over the wall rows),
 * else t + the room's mode band height (a room = a 4-connected component of non-void cells; the mode is taken over the
 * columns' northernmost segments whose band is plain wall art, see below; a room with no walkable row in any column's
 * window has mode 0: all room). A column whose band is deeper than its room's mode takes the mode when every extra row
 * (below the mode) carries a furniture id (a bookcase drawn in and below the wall rows stands on the floor); otherwise
 * (wall art, unknown) it keeps its own back line (the back wall steps forward there). A segment below a void gap inside
 * its room (not its column's northernmost) takes mode 0: only wall art above its first room row is band. Then the
 * partitions (see the header).
 */
export function roomLayout(a: MapAnalysis, ids: readonly (InteriorId | null)[], warps: readonly GridWarp[]): RoomLayout {
  const hit = memo.get(a);
  if (hit && hit.ids === ids && hit.warps === warps) return hit.L;
  const R = ROOM_RULES;
  const { N, GW, minX, minY, maxX, maxY } = a;

  // rooms: 4-connected components of non-void cells
  const room = new Int32Array(N).fill(-1);
  let rooms = 0;
  for (let s = 0; s < N; s++) {
    if (!nonVoid(a, s) || room[s] >= 0) continue;
    const id = rooms++;
    room[s] = id;
    const stack = [s];
    while (stack.length) {
      const c = stack.pop()!;
      const cx = a.cellX(c), cy = a.cellY(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!a.inside(nx, ny)) continue;
        const j = a.idx(nx, ny);
        if (nonVoid(a, j) && room[j] < 0) { room[j] = id; stack.push(j); }
      }
    }
  }

  // column segments and their own back lines (−1: no room row in the window)
  interface Seg { x: number; t: number; b: number; room: number; own: number; bl: number; first: boolean }
  const segs: Seg[] = [];
  for (let x = minX; x < maxX; x++) {
    const seen = new Set<number>();
    let y = minY;
    while (y < maxY) {
      if (!nonVoid(a, a.idx(x, y))) { y++; continue; }
      const t = y;
      while (y + 1 < maxY && nonVoid(a, a.idx(x, y + 1))) y++;
      const b = y;
      y++;
      let own = -1;
      for (let r = t; r <= Math.min(b, t + BAND_MAX); r++) if (standable(a, ids, a.idx(x, r))) { own = r; break; }
      const r = room[a.idx(x, t)];
      segs.push({ x, t, b, room: r, own, bl: -1, first: !R.firstSegment || !seen.has(r) });
      seen.add(r);
    }
  }
  // each room's mode band height (ties: the shallower). Voters: each column's northernmost segment in the room (a
  // segment under a void gap inside the room starts at its own room row and would drag the mode to 0) whose band is
  // plain wall art (furniture drawn in the wall rows deepens its column's band: the kitchen counters, the fridges); a
  // room with no such column: every northernmost segment.
  const isFurniture = (x: number, r: number) => { const id = ids[a.idx(x, r)]; return id !== null && FURNITURE.has(id); };
  const plain = (s: Seg) => { for (let r = s.t; r < s.own; r++) if (isFurniture(s.x, r)) return false; return true; };
  const votesOf = (pick: (s: Seg) => boolean) => {
    const votes = Array.from({ length: rooms }, () => new Map<number, number>());
    for (const s of segs) if (s.own >= 0 && s.first && pick(s)) votes[s.room].set(s.own - s.t, (votes[s.room].get(s.own - s.t) ?? 0) + 1);
    return votes.map((m) => {
      let best = -1, bestN = 0;
      for (const [d, n] of m) if (n > bestN || (n === bestN && d < best)) { best = d; bestN = n; }
      return best;
    });
  };
  const plainMode = R.plainVote ? votesOf(plain) : [], anyMode = votesOf(() => true);
  const mode = anyMode.map((m, r) => (plainMode[r] >= 0 ? plainMode[r] : m));
  for (const s of segs) {
    // a segment under a void gap has no back wall of its own: its band is only the wall art above its first room row
    const md = s.first ? mode[s.room] : 0;
    if (s.own < 0) s.bl = Math.min(s.t + Math.max(md, 0), s.b + 1);
    else if (R.furnitureMode && md >= 0 && s.own - s.t > md) {
      let furniture = true;
      for (let r = s.t + md; r < s.own && furniture; r++) furniture = isFurniture(s.x, r);
      s.bl = furniture ? s.t + md : s.own;
    } else s.bl = s.own;
  }

  const inside = new Uint8Array(N), band = new Uint8Array(N), part = new Uint8Array(N);
  const bl = new Int32Array(N).fill(-1);       // per cell: its segment's back line (−1: it has no room row)
  const top = new Int32Array(N).fill(-1);      // per cell: its segment's (a partition cell: its partition's) top row
  const bot = new Int32Array(N).fill(-1);      // per cell: its segment's (a partition cell: its partition's) bottom row
  const backLine = new Int32Array(GW).fill(-1);
  for (const s of segs) {
    for (let y = s.t; y <= s.b; y++) {
      const i = a.idx(s.x, y);
      bl[i] = s.bl <= s.b ? s.bl : -1;
      top[i] = s.t; bot[i] = s.b;
      if (y < s.bl) band[i] = 1; else inside[i] = 1;
    }
    if (s.bl <= s.b && backLine[s.x - minX] < 0) backLine[s.x - minX] = s.bl;
  }
  // Partitions: wall art left in the room, a dividing wall drawn across it (1–3 rows with room on both sides: the
  // Weather Institute, Rustboro's flats) or a north–south strip (Dewford Hall, Wanda's house). Pillars and other ids
  // in a dividing wall stay room: the wall stops beside them. Per column, a partition's cells know its own rows.
  if (R.partitions) {
    for (let x = minX; x < maxX; x++) {
      for (let y = minY; y < maxY; y++) {
        if (!inside[a.idx(x, y)] || !isArt(a, ids, a.idx(x, y))) continue;
        let e = y;
        while (e + 1 < maxY && inside[a.idx(x, e + 1)] && isArt(a, ids, a.idx(x, e + 1))) e++;
        for (let r = y; r <= e; r++) {
          const i = a.idx(x, r);
          inside[i] = 0; band[i] = 1; part[i] = 1; bl[i] = -1; top[i] = y; bot[i] = e;
        }
        y = e;
      }
    }
  }

  // each room's floor height: the mode of its walkable floor cells' heights
  const hv = Array.from({ length: rooms }, () => new Map<number, number>());
  for (let i = 0; i < N; i++) {
    if (!inside[i] || a.kind[i] !== K.Floor || Number.isNaN(a.height[i])) continue;
    hv[room[i]].set(a.height[i], (hv[room[i]].get(a.height[i]) ?? 0) + 1);
  }
  const floorY = hv.map((m) => {
    let best = 0, bestN = 0;
    for (const [h, n] of m) if (n > bestN || (n === bestN && h < best)) { best = h; bestN = n; }
    return best;
  });

  // wall runs: every boundary edge of an inside cell, merged
  const edges: WallRun[] = [];
  for (let i = 0; i < N; i++) {
    if (!inside[i]) continue;
    const x = a.cellX(i), y = a.cellY(i);
    for (const dir of DIRS) {
      const e = edgeOf(a, inside, band, part, bl, x, y, dir);
      if (!e) continue;
      const run: WallRun = { dir, line: e.line, from: e.from, to: e.to, floorY: floorY[room[i]] };
      if (e.partition) run.partition = true;
      edges.push(run);
    }
  }
  const runs = mergeSpans(edges);

  // wall art: band cells of one id in one row-run, merged downward (same id and columns on the next row)
  const features: WallFeature[] = [];
  const open = new Map<string, { f: WallFeature; y: number }>();
  for (let y = minY; y < maxY; y++) {
    let x = minX;
    while (x < maxX) {
      const i = a.idx(x, y);
      const kind = band[i] ? featureKind(ids[i]) : null;
      if (!kind) { x++; continue; }
      const id = ids[i];
      const x0 = x, cells: number[] = [];
      while (x < maxX) {
        const j = a.idx(x, y);
        if (!band[j] || ids[j] !== id) break;
        cells.push(j);
        x++;
      }
      const key = `${String(id)}:${x0}:${x}`;
      const prev = open.get(key);
      // the band's depth under each of its columns (a segment with no room row: band to its bottom)
      let rows = 0;
      for (const j of cells) rows = Math.max(rows, (bl[j] < 0 ? bot[j] + 1 : bl[j]) - top[j]);
      const row = y - top[cells[0]];
      if (prev && prev.y === y - 1) {
        prev.f.row1 = row;
        prev.f.cells.push(...cells);
        prev.f.rows = Math.max(prev.f.rows, rows);
        prev.y = y;
      } else {
        const f: WallFeature = { kind, x0, x1: x, row0: row, row1: row, rows, cells };
        // the wall it hangs on: the back wall in the recess, a dividing wall's south face
        const c = a.idx(Math.min(x - 1, Math.floor((x0 + x) / 2)), y);
        if (part[c]) featureZ.set(f, bot[c] + 1);
        else if (bl[c] >= 0) featureZ.set(f, bl[c] - RECESS);
        features.push(f);
        open.set(key, { f, y });
      }
    }
  }

  // doorways: exit mats on a room's boundary
  const gaps: DoorGap[] = [];
  const outside = (x: number, y: number) => !a.inside(x, y) || !inside[a.idx(x, y)];
  for (const w of warps) {
    if (!a.inside(w.x, w.y)) continue;
    const i = a.idx(w.x, w.y);
    if (ids[i] !== 'mat' || !inside[i]) continue;
    const { x, y } = w, beh = a.beh[i];
    if (beh === MB.EAST_ARROW_WARP && outside(x + 1, y)) gaps.push({ dir: 'E', line: x + 1, from: y, to: y + 1 });
    else if (beh === MB.WEST_ARROW_WARP && outside(x - 1, y)) gaps.push({ dir: 'W', line: x, from: y, to: y + 1 });
    else if (beh === MB.NORTH_ARROW_WARP && outside(x, y - 1)) gaps.push({ dir: 'N', line: y - RECESS, from: x, to: x + 1 });
    else if (outside(x, y + 1)) gaps.push({ dir: 'S', line: y + 1, from: x, to: x + 1 });
  }
  const doors = mergeSpans(gaps);

  // the room floor's metatile: the most common boards / tiles / carpet cell, else the most common walkable one
  const floorCount = new Map<number, number>(), anyCount = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    if (!inside[i] || !walkable(a, i) || a.kind[i] === K.Void) continue;   // (a 0x3FF block's mt is the border's)
    const id = ids[i];
    const m = a.mt[i];
    anyCount.set(m, (anyCount.get(m) ?? 0) + 1);
    if (id === 'boards' || id === 'tiles' || id === 'carpet') floorCount.set(m, (floorCount.get(m) ?? 0) + 1);
  }
  const mostCommon = (m: Map<number, number>) => {
    let best = -1, bestN = 0;
    for (const [k, n] of m) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n; }
    return best;
  };
  const floorTile = floorCount.size ? mostCommon(floorCount) : mostCommon(anyCount);

  const L: RoomLayout = { rooms, inside, band, partition: part, backLine, runs, features, doors, floorTile };
  memo.set(a, { ids, warps, L });
  return L;
}

/** Invariant findings (empty = sound); the ids are `interiorIds(a)`:
 *  - runs: from ≥ to; a wall's body over a cell one can stand on (furniture tops aside, as the back line reads them);
 *    a boundary edge of the room without a run; a door not on a run of its own direction and line;
 *  - cells: a cell one can stand on that is not room; wall art left in the room; a back-wall band cell with room above
 *    it (only a partition's may have); a back-wall band deeper than BAND_MAX;
 *  - a window feature whose glass is on no N run; with `warps`: an exit mat in the room with no door on its edge. */
export function checkRoomLayout(a: MapAnalysis, L: RoomLayout, warps?: readonly GridWarp[]): string[] {
  const out: string[] = [];
  const ids = interiorIds(a);
  const fmt = (r: { dir: WallDir; line: number; from: number; to: number }) => `${r.dir} ${r.line} [${r.from}, ${r.to})`;
  for (const r of L.runs) {
    if (r.from >= r.to) { out.push(`run ${fmt(r)}: from ≥ to`); continue; }
    // the wall's body: from its inner face WALL_T outwards
    const ns = r.dir === 'N' || r.dir === 'S';
    const out0 = r.dir === 'N' || r.dir === 'W' ? r.line - WALL_T : r.line;
    const lo = [ns ? r.from : out0, ns ? out0 : r.from], hi = [ns ? r.to : out0 + WALL_T, ns ? out0 + WALL_T : r.to];
    for (let y = Math.floor(lo[1]); y < Math.ceil(hi[1]); y++) {
      for (let x = Math.floor(lo[0]); x < Math.ceil(hi[0]); x++) {
        if (a.inside(x, y) && standable(a, ids, a.idx(x, y))) out.push(`run ${fmt(r)} crosses walkable cell (${x}, ${y})`);
      }
    }
  }
  const covered = (dir: WallDir, line: number, from: number, to: number) =>
    L.runs.some((r) => r.dir === dir && r.line === line && r.from <= from && to <= r.to);
  // per cell, its segment's back line (the run ends depend on it): an inside cell's is the first room row of its run of
  // room cells, a band cell's that of the room cells under it
  const bl = new Int32Array(a.N).fill(-1);
  for (let x = a.minX; x < a.maxX; x++) {
    let cur = -1;
    for (let y = a.minY; y < a.maxY; y++) {
      const i = a.idx(x, y);
      if (!L.inside[i]) { cur = -1; continue; }
      if (cur < 0) cur = y;
      bl[i] = cur;
    }
    for (let y = a.maxY - 1, nb = -1; y >= a.minY; y--) {
      const i = a.idx(x, y);
      if (L.inside[i]) nb = bl[i];
      else if (L.band[i] && !L.partition[i]) bl[i] = nb;
      else nb = -1;
    }
  }
  for (let i = 0; i < a.N; i++) {
    const x = a.cellX(i), y = a.cellY(i);
    if (!L.inside[i]) {
      if (standable(a, ids, i)) out.push(`walkable cell (${x}, ${y}) not in the room`);
      continue;
    }
    if (isArt(a, ids, i)) out.push(`wall art (${x}, ${y}) left in the room`);
    for (const dir of DIRS) {
      const e = edgeOf(a, L.inside, L.band, L.partition, bl, x, y, dir);
      if (e && !covered(dir, e.line, e.from, e.to)) out.push(`edge ${dir} of (${x}, ${y}) without a run`);
    }
  }
  // the back wall's band hangs from the void: band or void above it, at most BAND_MAX rows
  for (let x = a.minX; x < a.maxX; x++) {
    let depth = 0;
    for (let y = a.minY; y < a.maxY; y++) {
      const i = a.idx(x, y);
      if (!L.band[i] || L.partition[i]) { depth = 0; continue; }
      if (depth === 0 && y > a.minY && L.inside[a.idx(x, y - 1)]) out.push(`band cell (${x}, ${y}) under room`);
      if (++depth === BAND_MAX + 1) out.push(`band at (${x}, ${y}) deeper than ${BAND_MAX}`);
    }
  }
  for (const d of L.doors) if (!covered(d.dir, d.line, d.from, d.to)) out.push(`door ${fmt(d)} not on a run`);
  for (const f of L.features) {
    if (f.kind !== 'window') continue;
    const w = windowRect(L, f);
    if (!L.runs.some((r) => r.dir === 'N' && r.line === w.z && r.from <= w.x0 && w.x1 <= r.to)) out.push(`window at ${f.x0}…${f.x1} on no N run`);
  }
  for (const w of warps ?? []) {
    if (!a.inside(w.x, w.y)) continue;
    const i = a.idx(w.x, w.y);
    if (ids[i] !== 'mat' || !L.inside[i]) continue;
    const onDoor = L.doors.some((d) => (d.dir === 'N' || d.dir === 'S'
      ? d.from <= w.x && w.x + 1 <= d.to && (d.line === w.y + 1 || d.line === w.y - RECESS)
      : d.from <= w.y && w.y + 1 <= d.to && (d.line === w.x || d.line === w.x + 1)));
    if (!onDoor) out.push(`exit mat (${w.x}, ${w.y}) without a door`);
  }
  return out;
}

/** A window feature's glass rectangle on its back wall (shared by the shell's window and the floor family's shaft):
 *  x centred on the feature, width x1 − x0 − 0.3; its art rows stretched over 0.2 … WALL_H − 0.3:
 *  y0 = 0.2 + (row0 / rows)·(WALL_H − 0.5), y1 = 0.2 + ((row1 + 1) / rows)·(WALL_H − 0.5); z = the N run's line there.
 *  Pass the feature itself (z is kept by reference); a copy falls back to the northernmost N run over its centre. */
export function windowRect(L: RoomLayout, f: WallFeature): { x0: number; x1: number; y0: number; y1: number; z: number } {
  const cx = (f.x0 + f.x1) / 2, hw = (f.x1 - f.x0 - 0.3) / 2;
  const span = WALL_H - 0.5;
  let z = featureZ.get(f);
  if (z === undefined) {
    const r = L.runs.filter((q) => q.dir === 'N' && q.from <= cx && cx < q.to).sort((p, q) => p.line - q.line)[0];
    z = r ? r.line : 0;
  }
  return { x0: cx - hw, x1: cx + hw, y0: 0.2 + (f.row0 / f.rows) * span, y1: 0.2 + ((f.row1 + 1) / f.rows) * span, z };
}
