// An in-scope interior's room layout (Phase 4, D4/D12; v2 Phase 4b, D7/D13), pure: where the room floor is, which cells
// are the back wall's art band, where the walls stand, the wall art to model (windows, clocks, paintings, decals), the
// masses and tier risers, and the doorways.
//
// Two shells (`MapProfile.shell`, D7):
// - `band` (Phase 4): the GBA draws a room's back wall as 1–bandMax blocked rows of wall art under the black void. Per
//   column, each maximal run of non-void cells [t, b] has a *back line*: its first room row. Rows t … backLine − 1 are the
//   band (the back wall's art), the rest is the room (inside). The 3D back wall's inner face stands RECESS north of the
//   back line, so furniture drawn in the wall rows (fridges, sinks, bookcases) stands in the recess without reaching the
//   walkable row. Side and front walls follow every boundary between room cells and the rest (void, band).
// - `perimeter` (the gyms whose walls are no band): every in-map non-void cell is room material; the walls stand on its
//   boundary with the void, no recess. Blocked wall art in the room becomes masses; there is no band and no feature.
//
// Partitions (`RoomLayout.partition`, a subset of the band; their runs carry `partition: true`): a dividing wall drawn
// across a room (1–3 rows of wall art with room on both sides: the Weather Institute, Rustboro's flats) and a wall-art
// strip standing in the room (a north–south partition: Dewford Hall, Wanda's house). Their runs follow the partition
// cells' own outline (no recess), so the shell can build them as half-height partitions with thickness.
//
// Masses (`RoomLayout.masses`, Phase 4b): 4-connected blocks of blocked maze walls (`mazeWall`), rock ridges (`ridge`) and,
// on a perimeter shell, any blocked wall art; the runs around them carry `mass: true` (their cells' outline). Tier faces
// (`tierFace`, on a `tiers` map) are risers, never masses (D13): the runs of the tiers beside them carry `tier: true`.
// Mechanic cells (a `PuzzleKind` id) are room floor whatever their collision (D4).
//
// Lines are in grid units: world x for E/W runs, world z at floor height 0 for N/S runs (the builder adds `floorY`).

import { MB } from '../../../game/behaviors';
import { DOOR_BEHAVIORS, K, type MapAnalysis } from '../../overworld/analyze';
import type { GridWarp } from '../events';
import { FLOOR_KINDS, FURNITURE_KINDS, PUZZLE_KINDS, interiorIds, type InteriorId } from '../tables/building';
import { DEFAULT_PROFILE, type MapProfile } from './scope';

export const RECESS = 0.5;     // the back wall's inner face this far north of the back line
export const WALL_H = 2.6;     // wall height over the room floor
export const WALL_T = 0.3;     // wall thickness (outwards)
/** At most this many wall-art rows under the void: Phase 4's rooms (DEFAULT_PROFILE.bandMax). A map's own is
 *  `MapProfile.bandMax` (`RoomLayout.profile`, F32). */
export const BAND_MAX = 3;
/** A dais' top over the tier it stands on (= FURNITURE_SPEC.dais.height, pinned by a test): the leaders' stages are raised
 *  walkable tiers (`tierPlan`). */
export const DAIS_H = 0.3;
/** A back wall's art rows are stretched over this height span (row 0, the band's top, at the top): its windows, clocks
 *  and decals (`bandRect`). */
export const WALL_SPAN: readonly [number, number] = [0.2, WALL_H - 0.3];
export type WallDir = 'N' | 'E' | 'S' | 'W';   // the side of the room the wall closes (N = back wall, looks south)
/** A straight wall: its inner face on `line` (world z for N/S, world x for E/W), from `from` to `to` along the other axis.
 *  `partition`: the face of a partition (a dividing wall in the room); `mass`: the face of a mass (a maze wall, a ridge,
 *  wall art on a perimeter shell: the mass' solid closes it, Task 10); `tier`: a tier's edge at a tier face (its riser
 *  closes it, Task 12). Each present only then. On a `tiers` map `floorY` is its own cell's floor height (F18). */
export interface WallRun { dir: WallDir; line: number; from: number; to: number; floorY: number; partition?: true; mass?: true; tier?: true }
/** Wall art on a back wall: columns [x0, x1), art rows row0..row1 (0 = the band's top) of a band `rows` tall. */
export interface WallFeature {
  kind: 'window' | 'clock' | 'decor' | 'painting' | 'blackboard';
  x0: number; x1: number; row0: number; row1: number; rows: number; cells: number[];
}
/** A doorway's opening in the wall of direction `dir`: on its run's `line`, from `from` to `to` along the run. `kind`
 *  (F5): `exit` (an exit mat, a door behaviour that warps out), `gymDoor` (a `gymDoor` cell: Task 9 draws its leaves, the
 *  shell its casing), `passage` (a NORMAL warp on a room's edge with void beyond: Petalburg's rooms, the E4 halls).
 *  Phase 4's rooms (DEFAULT_PROFILE itself) open for exit mats only, as in Phase 4. */
export interface DoorGap { dir: WallDir; line: number; from: number; to: number; kind: 'exit' | 'gymDoor' | 'passage' }
export type MassKind = 'maze' | 'ridge' | 'perimeter';
/** A solid block of blocked room cells the shell builds as a low solid (Task 10): `backed` = it touches the void on its
 *  north side (a perimeter wall's art, may stand to WALL_H); otherwise room lies north of it (≤ MASS_H_MAX, D6). */
export interface Mass { id: number; kind: MassKind; cells: number[]; backed: boolean }
/** A tier's face (D13, F17): `tierFace` cells between two tiers, an un-projected vertical face from y0 (lower tier) to y1
 *  (upper tier) on `line` (grid units, as runs: the face rows' south edge, world z = line + y0), facing `dir`, from `from`
 *  to `to` (world x). Built by Task 12. A face band with a tier on one side only stands from that tier (a back wall's
 *  band: up by its rows) or down by its rows to the void (`bandRiser`). */
export interface Riser { dir: WallDir; line: number; from: number; to: number; y0: number; y1: number }
export interface RoomLayout {
  rooms: number;
  room: Int32Array;      // per analysis cell: its room (a 4-connected component of room material), −1 none
  floorY: number[];      // per room: its floor height (the walls' `floorY`, the floor's `roomFloorHeights`)
  inside: Uint8Array;    // per analysis cell: room floor area (walkable, furniture, stairs, mats, mechanics)
  band: Uint8Array;      // per cell: back-wall art (non-void, above the back line), partitions included
  partition: Uint8Array; // per cell: a partition's cell (a subset of `band`)
  backLine: Int32Array;  // per column (x − a.minX): grid row of the first room row of its northernmost room; −1 none
  runs: WallRun[]; features: WallFeature[]; doors: DoorGap[];
  floorTile: number;     // the most common walkable floor metatile (a FLOOR_KINDS id; mechanics never count, F16)
  masses: Mass[];
  mass: Int32Array;      // per cell: its mass' id, −1 none
  risers: Riser[];
  /** Per cell: a mechanic (a PuzzleKind id): room floor whatever its state; it votes no height (F18). */
  mechanic: Uint8Array;
  profile: MapProfile;
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
const MECHANIC = new Set<InteriorId>(PUZZLE_KINDS);
const FLOOR_SET = new Set<InteriorId>(FLOOR_KINDS);
/** Wall art that is a band's / partition's / perimeter mass' art (features: `featureKind`). */
const ART = new Set<InteriorId>(['wall', 'window', 'clock', 'decor', 'painting', 'blackboard']);
const DIR_ORDER: Record<WallDir, number> = { N: 0, E: 1, S: 2, W: 3 };
const DIRS: readonly WallDir[] = ['N', 'E', 'S', 'W'];
const OPPOSITE: Record<WallDir, WallDir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
/** The order a door cell's sides are tried in (the GBA's doors are in the back and front walls). */
const DOOR_SIDES: readonly WallDir[] = ['S', 'N', 'E', 'W'];
/** One grid step towards each side (grid y grows south). */
export const DIR_STEP: Readonly<Record<WallDir, readonly [number, number]>> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

/** Per feature: the z of the wall it hangs on (by reference: a copied feature falls back in `windowRect`). */
const featureZ = new WeakMap<WallFeature, number>();
const memo = new WeakMap<MapAnalysis, { ids: readonly (InteriorId | null)[]; warps: readonly GridWarp[]; profile: MapProfile; L: RoomLayout }>();

/** Room material: an in-map cell (a map whose border is no void, the Department Store's rooftop, ends at its edge)
 *  that is non-void, or a block of metatile 0x3FF the classifier reads as the border (`real3ff`: Sootopolis' houses
 *  floor parts of their rooms with it). The one rule: the layout, the floor and the furniture all read it here. */
export function roomMaterial(a: MapAnalysis, i: number): boolean {
  const m = a.opts.margin, x = a.cellX(i), y = a.cellY(i);
  if (x < a.minX + m || y < a.minY + m || x >= a.maxX - m || y >= a.maxY - m) return false;
  return a.kind[i] !== K.Void || a.real3ff[i] > 0;
}

/** Walkable: room material the game lets the player stand on (a 0x3FF block: its own collision, `real3ff` 1). The one
 *  rule, as `roomMaterial`. */
export function walkable(a: MapAnalysis, i: number): boolean {
  return a.kind[i] !== K.Void ? a.col[i] === 0 : a.real3ff[i] === 1;
}

/** A mechanic id (D4): room floor for the layout whatever its collision. */
const isMechanic = (id: InteriorId | null): boolean => id !== null && MECHANIC.has(id);

/** Walkable for the layout: walkable, or a mechanic cell whatever its state (D4). */
function walk(a: MapAnalysis, ids: readonly (InteriorId | null)[], i: number): boolean {
  return isMechanic(ids[i]) || walkable(a, i);
}

/** Walkable (for the layout) and not a piece of furniture's top that the game lets one stand on (a plant's leaves drawn
 *  over the wall rows, out of reach behind its pot); stairs are room (they open an alcove). A gym door is drawn in the
 *  wall's art (Petalburg's in the back band): never a room row of its own. */
function standable(a: MapAnalysis, ids: readonly (InteriorId | null)[], i: number): boolean {
  const id = ids[i];
  if (id === 'gymDoor' || id === 'tierFace') return false;
  return walk(a, ids, i) && !(ROOM_RULES.furnitureTops && id != null && FURNITURE.has(id) && id !== 'stairsUp' && id !== 'stairsDown');
}

/** Wall art: a blocked cell (for the layout) with a wall-part id that is band / partition art: wall, window, clock,
 *  decor, painting, blackboard (mazeWall and ridge are masses, tierFace risers: never partitions, never features). */
function isArt(a: MapAnalysis, ids: readonly (InteriorId | null)[], i: number): boolean {
  const id = ids[i];
  return id !== null && ART.has(id) && !walk(a, ids, i);
}

/** Wall art's feature kind for a band cell's id: window / clock / decor / painting / blackboard; unknown cells (null,
 *  `legacy`) are decals too (D4: band cells are never left to legacy). Paint (`wall`), maze walls, ridges, tier faces,
 *  furniture, mechanic and floor ids are no feature (F11). */
function featureKind(id: InteriorId | null): WallFeature['kind'] | null {
  if (id === 'window' || id === 'clock' || id === 'decor' || id === 'painting' || id === 'blackboard') return id;
  if (id === null || id === 'legacy') return 'decor';
  return null;
}

/** A cell's floor height in the analysis: its solver height where it has one, else its ground (blocked cells; on a
 *  `tiers` map both are `prepareInterior`'s). */
function cellFloor(a: MapAnalysis, i: number): number {
  const h = a.height[i];
  return Number.isNaN(h) ? a.groundH[i] : h;
}

/** A face band's riser (D13): `rows` face rows with the cell north of them at `hN` and south of them at `hS` (NaN: void
 *  or the map's edge). It stands on the south side (or `rows` below the north side when the south is void) and rises by
 *  its rows, to the north side's tier at least: the un-projected face covers its art rows with no gap. Null: void on
 *  both sides. */
export function bandRiser(hN: number, hS: number, rows: number): { y0: number; y1: number } | null {
  const n = !Number.isNaN(hN), s = !Number.isNaN(hS);
  if (!n && !s) return null;
  const y0 = s ? hS : hN - rows;
  return { y0, y1: n ? Math.max(hN, y0 + rows) : y0 + rows };
}

/** What the edge rules read of a layout under construction (or of a finished one, in the check). */
interface EdgeCtx {
  a: MapAnalysis; perimeter: boolean;
  inside: Uint8Array; band: Uint8Array; part: Uint8Array; mass: Int32Array; face: Uint8Array; mat: Uint8Array;
  /** per cell: its segment's back line (for band cells: of the room rows below them); −1 none */
  bl: Int32Array;
}
interface Edge { line: number; from: number; to: number; partition: boolean; mass: boolean; tier: boolean }
/** A unit boundary edge of cell (x, y) towards `dir` (the run it needs), or null (no run: the neighbour is room, or the
 *  cell needs none). Band shell: the edges of inside cells. Perimeter shell: also the edges of every room-material cell
 *  towards the void (on its outline), and an inside cell's towards a mass or tier face. */
function edgeOf(c: EdgeCtx, x: number, y: number, dir: WallDir): Edge | null {
  const { a } = c;
  const i = a.idx(x, y);
  const [dx, dy] = DIR_STEP[dir];
  const nx = x + dx, ny = y + dy;
  const n = a.inside(nx, ny) ? a.idx(nx, ny) : -1;
  const outline = (flags: Pick<Edge, 'partition' | 'mass' | 'tier'>): Edge => {
    if (dir === 'N') return { line: y, from: x, to: x + 1, ...flags };
    if (dir === 'S') return { line: y + 1, from: x, to: x + 1, ...flags };
    return { line: dir === 'E' ? x + 1 : x, from: y, to: y + 1, ...flags };
  };
  const plain = { partition: false, mass: false, tier: false };
  if (c.perimeter) {
    if (!c.mat[i]) return null;
    if (n < 0 || !c.mat[n]) return outline(plain);
    if (!c.inside[i] || c.inside[n]) return null;
    if (c.mass[n] >= 0) return outline({ ...plain, mass: true });
    if (c.face[n]) return outline({ ...plain, tier: true });
    return null;
  }
  // the room's footprint: its cells and its masses (the outer walls go round both; a mass' faces close the room cells)
  const foot = (j: number) => c.inside[j] === 1 || c.mass[j] >= 0;
  if (!foot(i)) return null;
  if (n >= 0 && foot(n)) return c.inside[i] && c.mass[n] >= 0 ? outline({ ...plain, mass: true }) : null;
  const partition = n >= 0 && c.part[n] === 1, tier = n >= 0 && c.face[n] === 1;
  const flags = { partition, mass: false, tier };
  // a partition's and a riser's faces follow their cells' outline; the back wall stands in the recess
  if (dir === 'N') return { line: partition || tier ? y : y - RECESS, from: x, to: x + 1, ...flags };
  if (dir === 'S') return { line: y + 1, from: x, to: x + 1, ...flags };
  // the room's top row reaches back into the recess under a back wall (unless room lies there beside it: its own wall
  // closes the corner); beside a back wall's band the run ends at that band's own back wall
  const up = a.inside(x, y - 1) ? a.idx(x, y - 1) : -1;
  const diag = a.inside(nx, y - 1) ? a.idx(nx, y - 1) : -1;
  const solidUp = up >= 0 && (c.part[up] === 1 || c.mass[up] >= 0 || c.face[up] === 1);
  const recess = y === c.bl[i] && !solidUp && !(ROOM_RULES.corner && diag >= 0 && c.inside[diag]);
  const to = n >= 0 && c.band[n] && !partition && y + 1 === c.bl[n] ? c.bl[n] - RECESS : y + 1;
  return { line: dir === 'E' ? x + 1 : x, from: recess ? y - RECESS : y, to, ...flags };
}

type Span = { dir: WallDir; line: number; from: number; to: number; floorY?: number; partition?: true; mass?: true; tier?: true; kind?: string };
/** Merges collinear adjacent spans (same dir, line, floorY, flags and kind; sorts `spans` in place, returns new
 *  objects): sorted by dir, from, line. The layout's runs and doors, the shell's outer runs. */
export function mergeSpans<T extends Span>(spans: T[]): T[] {
  const same = (p: T, q: T) => p.dir === q.dir && p.line === q.line && p.floorY === q.floorY && p.partition === q.partition
    && p.mass === q.mass && p.tier === q.tier && p.kind === q.kind;
  spans.sort((p, q) => DIR_ORDER[p.dir] - DIR_ORDER[q.dir] || p.line - q.line || (p.floorY ?? 0) - (q.floorY ?? 0)
    || Number(p.partition ?? 0) - Number(q.partition ?? 0) || Number(p.mass ?? 0) - Number(q.mass ?? 0)
    || Number(p.tier ?? 0) - Number(q.tier ?? 0) || (p.kind ?? '').localeCompare(q.kind ?? '') || p.from - q.from);
  const out: T[] = [];
  for (const s of spans) {
    const last = out[out.length - 1];
    if (last && same(last, s) && s.from <= last.to) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out.sort((p, q) => DIR_ORDER[p.dir] - DIR_ORDER[q.dir] || p.from - q.from || p.line - q.line);
}

/** A floor height vote's winner: the most votes, ties the lower height; no votes 0. */
export function heightMode(votes: ReadonlyMap<number, number>): number {
  let best = 0, bestN = 0;
  for (const [h, n] of votes) if (n > bestN || (n === bestN && h < best)) { best = h; bestN = n; }
  return best;
}

/** Whether cell i votes for its room's floor height: a room cell of the floor with a height, not a mechanic (its
 *  collision follows its state, F18). */
export const votesHeight = (a: MapAnalysis, L: Pick<RoomLayout, 'inside'> & Partial<Pick<RoomLayout, 'mechanic'>>, i: number): boolean =>
  L.inside[i] === 1 && a.kind[i] === K.Floor && !Number.isNaN(a.height[i]) && !L.mechanic?.[i];

/** Per column, the maximal runs of cells with `on(i)` set: [x, t, b] (rows t…b). */
function columnRuns(a: MapAnalysis, on: (i: number) => boolean): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let x = a.minX; x < a.maxX; x++) {
    for (let y = a.minY; y < a.maxY; y++) {
      if (!on(a.idx(x, y))) continue;
      let b = y;
      while (b + 1 < a.maxY && on(a.idx(x, b + 1))) b++;
      out.push([x, y, b]);
      y = b;
    }
  }
  return out;
}

/** The tier faces of a `tiers` layout: per column each run of `face` cells, its riser from its two sides' floors in the
 *  analysis (`bandRiser`), merged along x. */
function risersOf(a: MapAnalysis, face: Uint8Array, mat: Uint8Array): Riser[] {
  const side = (x: number, y: number) => {
    if (!a.inside(x, y)) return NaN;
    const j = a.idx(x, y);
    return mat[j] && !face[j] ? cellFloor(a, j) : NaN;
  };
  const one: Riser[] = [];
  for (const [x, t, b] of columnRuns(a, (i) => face[i] === 1)) {
    const r = bandRiser(side(x, t - 1), side(x, b + 1), b - t + 1);
    if (r) one.push({ dir: 'S', line: b + 1, from: x, to: x + 1, ...r });
  }
  one.sort((p, q) => p.line - q.line || p.y0 - q.y0 || p.y1 - q.y1 || p.from - q.from);
  const out: Riser[] = [];
  for (const r of one) {
    const last = out[out.length - 1];
    if (last && last.line === r.line && last.y0 === r.y0 && last.y1 === r.y1 && last.to === r.from) last.to = r.to;
    else out.push({ ...r });
  }
  return out.sort((p, q) => p.line - q.line || p.from - q.from);
}

/**
 * The room layout of an in-scope interior (memoised per analysis, ids, warps and profile: pass the build's own `warps`
 * and the map's profile from every caller, or the layout is rebuilt; default DEFAULT_PROFILE: Phase 4's rooms).
 * Band shell: per column, each maximal non-void segment [t, b]: its back line is the first walkable row in
 * [t, min(b, t + bandMax)] (a walkable furniture cell other than stairs does not count: a plant's leaves drawn over the
 * wall rows; nor does a gym door: it is drawn in the wall), else t + the room's mode band height (a room = a 4-connected
 * component of non-void cells; the mode is taken over the columns' northernmost segments whose band is plain wall art,
 * see below; a room with no walkable row in any column's window has mode 0: all room). A column whose band is deeper
 * than its room's mode takes the mode when every extra row (below the mode) carries a furniture id (a bookcase drawn in
 * and below the wall rows stands on the floor); otherwise (wall art, unknown) it keeps its own back line (the back wall
 * steps forward there). A segment below a void gap inside its room (not its column's northernmost) takes mode 0: only
 * wall art above its first room row is band. Then the partitions (see the header), then the masses (blocked maze walls
 * and ridges in the room).
 * Perimeter shell: every room-material cell is room; blocked wall art (any wall part but tierFace) and ridges are masses.
 * On a `tiers` map, tier faces are neither room nor mass: risers.
 */
export function roomLayout(a: MapAnalysis, ids: readonly (InteriorId | null)[], warps: readonly GridWarp[],
  profile: MapProfile = DEFAULT_PROFILE): RoomLayout {
  const hit = memo.get(a);
  if (hit && hit.ids === ids && hit.warps === warps && hit.profile === profile) return hit.L;
  const R = ROOM_RULES;
  const { N, GW, minX, minY, maxX, maxY } = a;
  const perimeter = profile.shell === 'perimeter', bandMax = profile.bandMax;

  // room material and rooms: 4-connected components of non-void cells
  const mat = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (roomMaterial(a, i)) mat[i] = 1;
  const room = new Int32Array(N).fill(-1);
  let rooms = 0;
  for (let s = 0; s < N; s++) {
    if (!mat[s] || room[s] >= 0) continue;
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
        if (mat[j] && room[j] < 0) { room[j] = id; stack.push(j); }
      }
    }
  }
  const mechanic = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (mat[i] && isMechanic(ids[i])) mechanic[i] = 1;

  const inside = new Uint8Array(N), band = new Uint8Array(N), part = new Uint8Array(N);
  const bl = new Int32Array(N).fill(-1);       // per cell: its segment's back line (−1: it has no room row)
  const top = new Int32Array(N).fill(-1);      // per cell: its segment's (a partition cell: its partition's) top row
  const bot = new Int32Array(N).fill(-1);      // per cell: its segment's (a partition cell: its partition's) bottom row
  const backLine = new Int32Array(GW).fill(-1);
  if (perimeter) {
    inside.set(mat);
  } else {
    // column segments and their own back lines (−1: no room row in the window)
    interface Seg { x: number; t: number; b: number; room: number; own: number; bl: number; first: boolean }
    const segs: Seg[] = [];
    for (let x = minX; x < maxX; x++) {
      const seen = new Set<number>();
      let y = minY;
      while (y < maxY) {
        if (!mat[a.idx(x, y)]) { y++; continue; }
        const t = y;
        while (y + 1 < maxY && mat[a.idx(x, y + 1)]) y++;
        const b = y;
        y++;
        let own = -1;
        for (let r = t; r <= Math.min(b, t + bandMax); r++) if (standable(a, ids, a.idx(x, r))) { own = r; break; }
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
  }

  // tier faces (a `tiers` map): neither room nor mass, risers
  const face = new Uint8Array(N);
  // (whatever their collision: Hall 4's lamps on the landing's face are walkable in the ROM, walled in)
  if (profile.tiers) for (let i = 0; i < N; i++) if (inside[i] && ids[i] === 'tierFace') { face[i] = 1; inside[i] = 0; }

  // masses: 4-connected blocks of one class of blocked room cells — maze walls, ridges, and (perimeter) any other wall art
  const massClass = (i: number): number => {
    if (!inside[i] || walk(a, ids, i)) return 0;
    const id = ids[i];
    if (id === 'mazeWall') return 1;
    if (id === 'ridge') return 2;
    return perimeter && id !== null && ART.has(id) ? 3 : 0;
  };
  const mass = new Int32Array(N).fill(-1);
  const masses: Mass[] = [];
  for (let s = 0; s < N; s++) {
    const cls = massClass(s);
    if (!cls || mass[s] >= 0) continue;
    const id = masses.length, cells: number[] = [];
    mass[s] = id;
    const stack = [s];
    while (stack.length) {
      const c = stack.pop()!;
      cells.push(c);
      const cx = a.cellX(c), cy = a.cellY(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!a.inside(nx, ny)) continue;
        const j = a.idx(nx, ny);
        if (mass[j] < 0 && massClass(j) === cls) { mass[j] = id; stack.push(j); }
      }
    }
    cells.sort((p, q) => p - q);
    const backed = cells.some((c) => { const x = a.cellX(c), y = a.cellY(c); return !a.inside(x, y - 1) || !mat[a.idx(x, y - 1)]; });
    const kind: MassKind = perimeter && backed ? 'perimeter' : cls === 2 ? 'ridge' : 'maze';
    masses.push({ id, kind, cells, backed });
  }
  for (const m of masses) for (const c of m.cells) inside[c] = 0;

  // each room's floor height: the mode of its walkable floor cells' heights (mechanics do not vote, F18)
  const hv = Array.from({ length: rooms }, () => new Map<number, number>());
  for (let i = 0; i < N; i++) {
    if (!votesHeight(a, { inside, mechanic }, i)) continue;
    hv[room[i]].set(a.height[i], (hv[room[i]].get(a.height[i]) ?? 0) + 1);
  }
  const floorY = hv.map(heightMode);
  // a run's floor: its room's, or on a `tiers` map its own cell's (F18) — under a dais the tier it stands on (the analysis
  // carries tierPlan's heights there, a dais DAIS_H over its tier: the walls behind a leader's stage stay one wall)
  // (snapped to 1e-6: the analysis' heights are float32, a dais' 0.3 is not one)
  const runFloor = (i: number) =>
    (profile.tiers ? Math.round((cellFloor(a, i) - (ids[i] === 'dais' ? DAIS_H : 0)) * 1e6) / 1e6 : floorY[room[i]]);

  // wall runs: every boundary edge (edgeOf), merged
  const ctx: EdgeCtx = { a, perimeter, inside, band, part, mass, face, mat, bl };
  const edges: WallRun[] = [];
  for (let i = 0; i < N; i++) {
    if (!(perimeter ? mat[i] : inside[i] || mass[i] >= 0)) continue;
    const x = a.cellX(i), y = a.cellY(i);
    for (const dir of DIRS) {
      const e = edgeOf(ctx, x, y, dir);
      if (!e) continue;
      const run: WallRun = { dir, line: e.line, from: e.from, to: e.to, floorY: runFloor(i) };
      if (e.partition) run.partition = true;
      if (e.mass) run.mass = true;
      if (e.tier) run.tier = true;
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

  // doorways: exit mats on a room's boundary (by their arrow); a door behaviour's warp: the edge between the door and the
  // room; a NORMAL warp on a room's edge with void beyond (F5); and every gym door in a wall, with or without a warp,
  // whatever its state (the E4 exit doors are NORMAL and warp-less while closed)
  const gaps: DoorGap[] = [];
  const outside = (x: number, y: number) => !a.inside(x, y) || !inside[a.idx(x, y)];
  const gapAt = (x: number, y: number, dir: WallDir, kind: DoorGap['kind']): boolean => {
    const e = edgeOf(ctx, x, y, dir);
    if (!e) return false;
    const ns = dir === 'N' || dir === 'S';
    gaps.push({ dir, line: e.line, from: ns ? x : y, to: (ns ? x : y) + 1, kind });
    return true;
  };
  /** A door cell's opening: in the room, on its first side towards the rest (not towards the door's own other cells; a
   *  door two rows tall opens N or S only); drawn in a wall's art (Petalburg's gym doors in the back band, the E4 doors),
   *  on the edge of every room cell beside it. */
  const isDoor = (x: number, y: number) => a.inside(x, y) && ids[a.idx(x, y)] === 'gymDoor';
  const doorGaps = (x: number, y: number, kind: DoorGap['kind']) => {
    if (inside[a.idx(x, y)]) {
      const tall = kind === 'gymDoor' && (isDoor(x, y - 1) || isDoor(x, y + 1));
      DOOR_SIDES.some((d) => {
        const [dx, dy] = DIR_STEP[d];
        if (kind === 'gymDoor' && (isDoor(x + dx, y + dy) || (tall && dx !== 0))) return false;
        return outside(x + dx, y + dy) && gapAt(x, y, d, kind);
      });
      return;
    }
    for (const d of DOOR_SIDES) {
      const [dx, dy] = DIR_STEP[d];
      if (!outside(x + dx, y + dy)) gapAt(x + dx, y + dy, OPPOSITE[d], kind);
    }
  };
  // Phase 4's rooms (DEFAULT_PROFILE itself) keep Phase 4's doorways, exit mats only: the Pokémon Centers' back doors,
  // the Trick House entrance's passage would open their walls (their pixels are pinned)
  const v2 = profile !== DEFAULT_PROFILE;
  for (const w of warps) {
    if (!a.inside(w.x, w.y)) continue;
    const i = a.idx(w.x, w.y);
    const { x, y } = w, beh = a.beh[i], id = ids[i];
    if (id !== 'mat' && !v2) continue;
    if (id === 'mat') {
      if (!inside[i]) continue;
      if (beh === MB.EAST_ARROW_WARP && outside(x + 1, y)) gaps.push({ dir: 'E', line: x + 1, from: y, to: y + 1, kind: 'exit' });
      else if (beh === MB.WEST_ARROW_WARP && outside(x - 1, y)) gaps.push({ dir: 'W', line: x, from: y, to: y + 1, kind: 'exit' });
      else if (beh === MB.NORTH_ARROW_WARP && outside(x, y - 1)) gaps.push({ dir: 'N', line: y - RECESS, from: x, to: x + 1, kind: 'exit' });
      else if (outside(x, y + 1)) gaps.push({ dir: 'S', line: y + 1, from: x, to: x + 1, kind: 'exit' });
      continue;
    }
    // stairs (Phase 4's NON_ANIMATED_DOOR stairs) are a model in the room, not a doorway; gym doors: below
    if (id === 'gymDoor' || (id !== null && FURNITURE.has(id))) continue;
    if (DOOR_BEHAVIORS.has(beh) || beh === MB.NON_ANIMATED_DOOR) doorGaps(x, y, 'exit');
    else if (beh === MB.NORMAL && inside[i]) {
      DOOR_SIDES.some((d) => {
        const [dx, dy] = DIR_STEP[d];
        return (!a.inside(x + dx, y + dy) || !mat[a.idx(x + dx, y + dy)]) && gapAt(x, y, d, 'passage');
      });
    }
  }
  for (let i = 0; i < N; i++) if (mat[i] && ids[i] === 'gymDoor') doorGaps(a.cellX(i), a.cellY(i), 'gymDoor');
  const doors = mergeSpans(gaps);

  // the room floor's metatile: the most common floor-kind cell (F16: any FLOOR_KINDS id), else the most common walkable
  // one; mechanic cells never count (their metatile follows their state, D4)
  const floorCount = new Map<number, number>(), anyCount = new Map<number, number>();
  for (let i = 0; i < N; i++) {
    if (!inside[i] || !walkable(a, i) || a.kind[i] === K.Void || mechanic[i]) continue;   // (a 0x3FF block's mt is the border's)
    const id = ids[i];
    const m = a.mt[i];
    anyCount.set(m, (anyCount.get(m) ?? 0) + 1);
    if (id !== null && FLOOR_SET.has(id)) floorCount.set(m, (floorCount.get(m) ?? 0) + 1);
  }
  const mostCommon = (m: Map<number, number>) => {
    let best = -1, bestN = 0;
    for (const [k, n] of m) if (n > bestN || (n === bestN && k < best)) { best = k; bestN = n; }
    return best;
  };
  const floorTile = floorCount.size ? mostCommon(floorCount) : mostCommon(anyCount);

  const risers = profile.tiers ? risersOf(a, face, mat) : [];
  const L: RoomLayout = {
    rooms, room, floorY, inside, band, partition: part, backLine, runs, features, doors, floorTile, masses, mass, risers,
    mechanic, profile,
  };
  memo.set(a, { ids, warps, profile, L });
  return L;
}

/** Invariant findings (empty = sound); the ids are `interiorIds(a)`, the profile `L.profile`:
 *  - runs: from ≥ to; a wall's body over a cell one can stand on (furniture tops aside, as the back line reads them;
 *    mechanics count as floor), mass runs included; a boundary edge of the room without a run; a door not on a run of its
 *    own direction and line;
 *  - cells: a cell one can stand on that is not room; wall art left in the room; a mass cell in the room; a back-wall band
 *    cell with room above it (only a partition's may have); a back-wall band deeper than the profile's bandMax (F32);
 *    a tier face on no riser;
 *  - a window feature whose glass is on no N run; with `warps`: an exit mat in the room with no door on its edge. */
export function checkRoomLayout(a: MapAnalysis, L: RoomLayout, warps?: readonly GridWarp[]): string[] {
  const out: string[] = [];
  const ids = interiorIds(a);
  const profile = L.profile ?? DEFAULT_PROFILE, perimeter = profile.shell === 'perimeter';
  const mass = L.mass ?? new Int32Array(a.N).fill(-1);
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
  const mat = new Uint8Array(a.N), face = new Uint8Array(a.N);
  for (let i = 0; i < a.N; i++) {
    if (!roomMaterial(a, i)) continue;
    mat[i] = 1;
    if (profile.tiers && ids[i] === 'tierFace' && !L.inside[i] && mass[i] < 0 && !L.band[i]) face[i] = 1;
  }
  // per cell, its segment's back line (the run ends depend on it): an inside (or mass) cell's is the first room row of
  // its run of room (or mass) cells, a band cell's that of the room cells under it
  const foot = (i: number) => L.inside[i] === 1 || mass[i] >= 0;
  const bl = new Int32Array(a.N).fill(-1);
  for (let x = a.minX; x < a.maxX; x++) {
    let cur = -1;
    for (let y = a.minY; y < a.maxY; y++) {
      const i = a.idx(x, y);
      if (!foot(i)) { cur = -1; continue; }
      if (cur < 0) cur = y;
      bl[i] = cur;
    }
    for (let y = a.maxY - 1, nb = -1; y >= a.minY; y--) {
      const i = a.idx(x, y);
      if (foot(i)) nb = bl[i];
      else if (L.band[i] && !L.partition[i]) bl[i] = nb;
      else nb = -1;
    }
  }
  const ctx: EdgeCtx = { a, perimeter, inside: L.inside, band: L.band, part: L.partition, mass, face, mat, bl };
  for (let i = 0; i < a.N; i++) {
    const x = a.cellX(i), y = a.cellY(i);
    if (mass[i] >= 0 && L.inside[i]) out.push(`mass cell (${x}, ${y}) in the room`);
    if (!L.inside[i]) {
      if (standable(a, ids, i)) out.push(`walkable cell (${x}, ${y}) not in the room`);
      if (!(perimeter ? mat[i] : mass[i] >= 0)) continue;
    } else if (isArt(a, ids, i)) out.push(`wall art (${x}, ${y}) left in the room`);
    for (const dir of DIRS) {
      const e = edgeOf(ctx, x, y, dir);
      if (e && !covered(dir, e.line, e.from, e.to)) out.push(`edge ${dir} of (${x}, ${y}) without a run`);
    }
  }
  // the back wall's band hangs from the void: band or void above it, at most bandMax rows
  for (let x = a.minX; x < a.maxX; x++) {
    let depth = 0;
    for (let y = a.minY; y < a.maxY; y++) {
      const i = a.idx(x, y);
      if (!L.band[i] || L.partition[i]) { depth = 0; continue; }
      if (depth === 0 && y > a.minY && L.inside[a.idx(x, y - 1)]) out.push(`band cell (${x}, ${y}) under room`);
      if (++depth === profile.bandMax + 1) out.push(`band at (${x}, ${y}) deeper than ${profile.bandMax}`);
    }
  }
  // every tier face stands on a riser (its column's run of faces: the riser on its south edge)
  for (const [x, t, b] of columnRuns(a, (i) => face[i] === 1)) {
    if (!(L.risers ?? []).some((r) => r.line === b + 1 && r.from <= x && x + 1 <= r.to)) out.push(`tier face (${x}, ${t}…${b}) on no riser`);
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

/** D6's art rows (F10): how tall the GBA art over `cells` stands, in world units from the cells' own floor — their rows
 *  plus the same-label art rows north of them, un-projected (an art row is one unit: the screen row of a point on a cell
 *  is its grid row whatever its floor height). Per column of `cells`: from its southernmost cell up through its
 *  northernmost one and the cells of that one's label north of it; the tallest column. The one helper of Tasks 9, 10,
 *  11a and 14. */
export function artRows(a: MapAnalysis, ids: readonly (InteriorId | null)[], cells: readonly number[]): number {
  const cols = new Map<number, [number, number]>();
  for (const c of cells) {
    const x = a.cellX(c), y = a.cellY(c), s = cols.get(x);
    cols.set(x, s ? [Math.min(s[0], y), Math.max(s[1], y)] : [y, y]);
  }
  let best = 0;
  for (const [x, [t, b]] of cols) {
    const label = ids[a.idx(x, t)];
    let n = t;
    if (label !== null) while (a.inside(x, n - 1) && roomMaterial(a, a.idx(x, n - 1)) && ids[a.idx(x, n - 1)] === label) n--;
    best = Math.max(best, b - n + 1);
  }
  return best;
}

// ------------------------------------------------------------------------------------------------- tiers (D13)

/** A ramp between tiers: a column run of `hiddenStairs` cells, rows y0…y1, and the tiers north (`upper`) and south
 *  (`lower`) of it (−1: none, the void or the map's edge). */
export interface TierRamp { x: number; y0: number; y1: number; upper: number; lower: number }
/** The tier structure of a map from its labels (D13; F1: the game's elevation holds no tiers), what `prepareInterior`
 *  (Task 7) lays the floors by:
 *  - `tier`: per cell its tier (−1: none — void, a tier face, a ramp, blocked wall art). A tier is a 4-connected block of
 *    room cells that are no tier face, ramp or blocked wall art (walkable or not: an unreachable terrace, a statue, a
 *    `tier` top drawn blocked are on their tier); a dais (`dais` cells) is a tier of its own on the tier it stands on.
 *  - `height`: per tier its floor height. Tiers are joined by their tier-face bands (the cells north and south of a
 *    column's run of n `tierFace` cells: the north one n higher, un-projected) and ramps (likewise, n rows of
 *    `hiddenStairs`); each pair takes its most common rise, the heaviest pairs first. Each joined group stands with its
 *    lowest floor at 0 — counting the bottom of a band or ramp with a tier on its north side only (`bandRiser`: n below
 *    it). No cap: a high tier keeps its height (Sootopolis: Juan's platform at 8). A dais: DAIS_H over its base tier.
 *  - `base`: per tier, the tier a dais stands on (itself for the others); `dais`: per tier, whether it is a dais.
 *  - `ramps`: the hiddenStairs column runs.
 *  - `h`: per cell its floor height: its tier's; a ramp's interpolated between its ends (as the solver's stairs); a tier
 *    face's its riser's foot (`bandRiser`); blocked wall art the most common height of the tiers beside its block; NaN
 *    for the void (and a room with no tier).
 *  Pure, from `ids` alone (no analysis height is read). */
export interface TierPlan { tier: Int32Array; height: number[]; base: number[]; dais: boolean[]; ramps: TierRamp[]; h: Float32Array }

const planMemo = new WeakMap<MapAnalysis, { ids: readonly (InteriorId | null)[]; plan: TierPlan }>();

/** The tier structure (TierPlan) of an in-scope interior, memoised per analysis and ids. */
export function tierPlan(a: MapAnalysis, ids: readonly (InteriorId | null)[]): TierPlan {
  const hit = planMemo.get(a);
  if (hit && hit.ids === ids) return hit.plan;
  const { N } = a;
  const mat = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (roomMaterial(a, i)) mat[i] = 1;
  const isFace = (i: number) => mat[i] === 1 && ids[i] === 'tierFace';
  const isRamp = (i: number) => mat[i] === 1 && ids[i] === 'hiddenStairs';
  const wallArt = (i: number) => { const id = ids[i]; return id !== null && (ART.has(id) || id === 'mazeWall' || id === 'ridge') && !walk(a, ids, i); };
  const onTier = (i: number) => mat[i] === 1 && !isFace(i) && !isRamp(i) && !wallArt(i);

  // regions: 4-connected tier cells (a dais with the tier it stands on: joined across its edges, split off below)
  const region = new Int32Array(N).fill(-1);
  let R = 0;
  const flood = (s: number, id: number, ok: (j: number) => boolean, into: Int32Array) => {
    into[s] = id;
    const stack = [s];
    while (stack.length) {
      const c = stack.pop()!;
      const cx = a.cellX(c), cy = a.cellY(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (!a.inside(nx, ny)) continue;
        const j = a.idx(nx, ny);
        if (into[j] < 0 && ok(j)) { into[j] = id; stack.push(j); }
      }
    }
  };
  for (let s = 0; s < N; s++) if (onTier(s) && region[s] < 0) flood(s, R++, onTier, region);

  // joins: per column, a run of faces / ramp cells between two regions votes h(north) − h(south) = its rows
  const votes = new Map<string, Map<number, number>>();
  const bottoms: [number, number][] = [];        // (region, rows): a band or ramp with a tier on its north side only
  const ramps: TierRamp[] = [];
  const at = (x: number, y: number) => (a.inside(x, y) ? region[a.idx(x, y)] : -1);
  const voidAt = (x: number, y: number) => !a.inside(x, y) || !mat[a.idx(x, y)];
  for (const [test, ramp] of [[isFace, false], [isRamp, true]] as const) {
    for (const [x, t, b] of columnRuns(a, test)) {
      const n = at(x, t - 1), s = at(x, b + 1), rows = b - t + 1;
      if (ramp) ramps.push({ x, y0: t, y1: b, upper: n, lower: s });
      if (n >= 0 && s >= 0 && n !== s) {
        const key = n < s ? `${n},${s}` : `${s},${n}`, d = n < s ? rows : -rows;
        const m = votes.get(key) ?? new Map<number, number>();
        m.set(d, (m.get(d) ?? 0) + 1);
        votes.set(key, m);
      } else if (n >= 0 && s < 0 && voidAt(x, b + 1)) bottoms.push([n, rows]);
    }
  }
  // weighted union-find with offsets: h(c) = h(root) + off[c]
  const parent = Int32Array.from({ length: R }, (_, i) => i), off = new Float64Array(R);
  const find = (c: number): [number, number] => {
    let o = 0, r = c;
    while (parent[r] !== r) { o += off[r]; r = parent[r]; }
    return [r, o];
  };
  const pairs = [...votes.entries()].map(([key, m]) => {
    const [p, q] = key.split(',').map(Number);
    let d = 0, best = -1, total = 0;
    for (const [dd, n] of m) { total += n; if (n > best || (n === best && Math.abs(dd) < Math.abs(d))) { best = n; d = dd; } }
    return { p, q, d, w: total };
  }).sort((u, v) => v.w - u.w || u.p - v.p || u.q - v.q);
  for (const { p, q, d } of pairs) {
    // h(p) − h(q) = d
    const [rp, op] = find(p), [rq, oq] = find(q);
    if (rp === rq) continue;
    parent[rq] = rp;
    off[rq] = op - d - oq;
  }
  const rel = new Float64Array(R), low = new Map<number, number>();
  for (let c = 0; c < R; c++) {
    const [r, o] = find(c);
    rel[c] = o;
    low.set(r, Math.min(low.get(r) ?? Infinity, o));
  }
  for (const [c, rows] of bottoms) { const [r] = find(c); low.set(r, Math.min(low.get(r)!, rel[c] - rows)); }
  const regionH = Array.from({ length: R }, (_, c) => rel[c] - low.get(find(c)[0])!);

  // tiers: each region, then each dais block split off its region (DAIS_H over it)
  const tier = new Int32Array(N).fill(-1);
  const height: number[] = [], base: number[] = [], dais: boolean[] = [];
  for (let c = 0; c < R; c++) { height.push(regionH[c]); base.push(c); dais.push(false); }
  for (let i = 0; i < N; i++) if (region[i] >= 0) tier[i] = region[i];
  const daisSeen = new Int32Array(N).fill(-1);
  for (let s = 0; s < N; s++) {
    if (region[s] < 0 || ids[s] !== 'dais' || daisSeen[s] >= 0) continue;
    const id = height.length;
    flood(s, id, (j) => region[j] >= 0 && ids[j] === 'dais', daisSeen);
    height.push(regionH[region[s]] + DAIS_H); base.push(region[s]); dais.push(true);
  }
  for (let i = 0; i < N; i++) if (daisSeen[i] >= 0) tier[i] = daisSeen[i];

  // per-cell heights
  const h = new Float32Array(N).fill(NaN);
  for (let i = 0; i < N; i++) if (tier[i] >= 0) h[i] = height[tier[i]];
  const hAt = (x: number, y: number) => { const r = at(x, y); return r >= 0 ? regionH[r] : NaN; };
  for (const r of ramps) {
    const n = r.y1 - r.y0 + 1;
    const ht0 = hAt(r.x, r.y0 - 1), hb0 = hAt(r.x, r.y1 + 1);
    const ht = Number.isNaN(ht0) ? (Number.isNaN(hb0) ? 0 : hb0 + n) : ht0;
    const hb = Number.isNaN(hb0) ? ht - n : hb0;
    for (let k = r.y0; k <= r.y1; k++) h[a.idx(r.x, k)] = hb + ((ht - hb) * (r.y1 - k + 0.5)) / n;
  }
  // blocked wall art: per 4-connected block, the most common height of the tier cells beside it (ties: the lower)
  const art = new Int32Array(N).fill(-1);
  let blocks = 0;
  for (let s = 0; s < N; s++) {
    if (!mat[s] || !wallArt(s) || art[s] >= 0) continue;
    flood(s, blocks++, (j) => mat[j] === 1 && wallArt(j), art);
  }
  const artVotes = Array.from({ length: blocks }, () => new Map<number, number>());
  for (let i = 0; i < N; i++) {
    if (art[i] < 0) continue;
    const x = a.cellX(i), y = a.cellY(i);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const r = at(x + dx, y + dy);
      if (r >= 0) artVotes[art[i]].set(regionH[r], (artVotes[art[i]].get(regionH[r]) ?? 0) + 1);
    }
  }
  const artH = artVotes.map(heightMode);
  for (let i = 0; i < N; i++) if (art[i] >= 0) h[i] = artH[art[i]];
  // tier faces: their riser's foot, from the floors beside their column's run (tiers, ramps, wall art)
  for (const [x, t, b] of columnRuns(a, isFace)) {
    const side = (y: number) => (a.inside(x, y) && mat[a.idx(x, y)] && !isFace(a.idx(x, y)) ? h[a.idx(x, y)] : NaN);
    const rr = bandRiser(side(t - 1), side(b + 1), b - t + 1);
    for (let k = t; k <= b; k++) h[a.idx(x, k)] = rr ? rr.y0 : 0;
  }

  const plan: TierPlan = { tier, height, base, dais, ramps, h };
  planMemo.set(a, { ids, plan });
  return plan;
}

/** A feature's art rows stretched over [y0s, y1s], row 0 (the band's top) at the top: y0 = y0s + ((rows − row1 − 1) /
 *  rows)·span, y1 = y0s + ((rows − row0) / rows)·span (span = y1s − y0s). Windows, clocks and decals (WALL_SPAN on a
 *  back wall, the shell's PARTITION_SPAN on a partition). */
export function bandRect(f: WallFeature, y0s: number, y1s: number): { y0: number; y1: number } {
  const span = y1s - y0s;
  return { y0: y0s + ((f.rows - f.row1 - 1) / f.rows) * span, y1: y0s + ((f.rows - f.row0) / f.rows) * span };
}

/** A window feature's glass rectangle on its back wall (shared by the shell's window and the floor family's shaft):
 *  x centred on the feature, width x1 − x0 − 0.3; its art rows over WALL_SPAN (`bandRect`; the brief's formula
 *  counted rows from the floor: a top-row window sat low); z = the N run's line there.
 *  Pass the feature itself (z is kept by reference); a copy falls back to the northernmost N run over its centre. */
export function windowRect(L: RoomLayout, f: WallFeature): { x0: number; x1: number; y0: number; y1: number; z: number } {
  const cx = (f.x0 + f.x1) / 2, hw = (f.x1 - f.x0 - 0.3) / 2;
  let z = featureZ.get(f);
  if (z === undefined) {
    const r = L.runs.filter((q) => q.dir === 'N' && q.from <= cx && cx < q.to).sort((p, q) => p.line - q.line)[0];
    z = r ? r.line : 0;
  }
  return { x0: cx - hw, x1: cx + hw, ...bandRect(f, WALL_SPAN[0], WALL_SPAN[1]), z };
}
