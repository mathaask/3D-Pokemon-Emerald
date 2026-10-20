// Building footprints: the grid rectangle each door's building stands on, and its kind (from the
// door's warp destination). Shared by the building family (the models), and by the tree family
// and doorStructures, which treat the flood-filled cells outside every footprint as blocks.

import { MB } from '../../game/behaviors';
import { DOOR_BEHAVIORS, K, WATER_BEHAVIORS, type MapAnalysis } from '../overworld/analyze';
import type { GridEvents } from './events';
import { isSecretBaseSpot } from './semantics';
import type { RGB } from './palette';

export type BuildingKind = 'house' | 'pc' | 'mart' | 'gym' | 'lab' | 'special';

export function buildingKind(dest: string | null, width: number): BuildingKind {
  if (!dest) return width <= 6 ? 'house' : 'special';
  if (/_PokemonCenter_1F$/.test(dest)) return 'pc';
  if (/_Mart$/.test(dest)) return 'mart';
  if (/_Gym(_1F)?$/.test(dest)) return 'gym';
  if (/Lab/.test(dest)) return 'lab';
  if (/House|Home/.test(dest)) return 'house';
  return 'special';
}

/** One building's footprint: the grid rectangle its 3D model stands on (rows top..bottom, at
 *  least two, the bottom row its front). */
export interface Footprint {
  x0: number; x1: number; top: number; bottom: number;
  doorX: number;
  /** Warp destination of the door (null: no warp there). */
  dest: string | null;
  /** Ground level the building stands on (the cell before its door; never below 0). */
  base: number;
  /** Per column from x0: how many rows its front stands back from the bottom row's front edge: 0,
   *  1 over the building's walkable front steps or a walk-in door (the game lets the player stand
   *  there) or a bush before it, 2 over a walk-in door behind a walkable landing. */
  recess: number[];
  /** Columns of a walk-in door (a walkable door cell the player steps onto, on row `doorY`), or
   *  none for a door the player walks into from the cell before it. */
  walkIn: number[];
  /** The door's row: the bottom row, or the row above it behind a walk-in door's landing. */
  doorY: number;
}

export interface BuildingLayout {
  footprints: Footprint[];
  /** Cells of a footprint's building: the blocked art inside it and the walkable cells walled in
   *  by that art (no way in), both under its model, and the lone roof-edge cells on the row above
   *  it (no other family's, but the model never reaches them: the legacy art draws them).
   *  Footprint index + 1, 0 = none. */
  owner: Int16Array;
  /** Cells of a modelled building region (one with an owned cell) outside every footprint: art the
   *  door flood fill swallowed that is not a building (a forest, rock, hedges, fences, lamp posts,
   *  signs). They stay blocks: other families may take them, the legacy art draws the rest. */
  stray: Uint8Array;
}

/** Share of a column's rows (top to door row) that must be building art for the column to belong
 *  to the building. */
const FILL = 0.6;
/** Mean foliage share (TileInfo.green) of a row or column of tiles that makes it a hedge or a
 *  tree beside the building, not its art. */
const FOLIAGE = 0.5;
/** A metatile drawn on this many cells of the map is terrain art (rock, a cliff, a forest), not a
 *  building's own art (the most repeated building tiles, Rustboro's apartment walls and roofs,
 *  reach ~20). */
export const TERRAIN = 30;
/** Furthest a building reaches either side of its door (as the analysis' flood fill). */
const REACH = 9;

const layouts = new WeakMap<MapAnalysis, { events: GridEvents; layout: BuildingLayout }>();

/**
 * Building footprints, grown out from every door (memoised per analysis and events). The
 * analysis' door flood fill is no footprint: it swallows whatever blocked art touches a building
 * (a lamp post, a fence or hedge, a garden, the crater rock around Sootopolis' houses, Route 113's
 * ash forest around the Glass Workshop), joins neighbours, and may hand one building's roof to
 * the neighbour flooded first (Lavaridge's Pokémon Center). So:
 *  - building art is any blocked cell (flooded or not) whose tile is not terrain art (also drawn
 *    on plain blocks elsewhere on the map);
 *  - doors side by side or to the same place are one building (a double door, a gatehouse);
 *    neighbours on one row part where the colour changes most between their doors;
 *  - the rows run from the door row up the door's column while it is building art (hedge rows
 *    along the back, mostly foliage, are trimmed);
 *  - the columns grow out from the door while they are building art through most of those rows,
 *    stand on the door row (blocked there, or the building's own walkable front steps under its
 *    wall) and are no sign post, no wall running on past the door row, no hedge, no other door,
 *    and hold no cell the player can walk into below the top row (the model's walls stand there;
 *    over the front steps they stand one row back);
 *  - a door with none of its building above it (a one-row footprint) gets no model.
 * Then the walk-in doors (walkable door cells under building art: the Oceanic Museum, the Game
 * Corner), which the flood fill never seeds, the same way (see walkInDoors).
 */
export function buildingLayout(a: MapAnalysis, events: GridEvents): BuildingLayout {
  const hit = layouts.get(a);
  if (hit && hit.events === events) return hit.layout;
  const layout = computeLayout(a, events);
  layouts.set(a, { events, layout });
  return layout;
}

/** A door group: the door cells of one building on row y. */
interface Doors { y: number; xs: number[]; dest: string | null }

/** How a building's cells read: its blocked cells, its own art, its walled-in walkable cells. */
interface Look {
  blocked(x: number, y: number): boolean;
  art(x: number, y: number): boolean;
  enclosed(x: number, y: number): boolean;
  /** Foliage share of a cell's tile (hedges and trees beside the building, not its art). */
  green(x: number, y: number): number;
  /** A cell the player can walk on. */
  open(i: number): boolean;
}

function computeLayout(a: MapAnalysis, events: GridEvents): BuildingLayout {
  const { idx, inside, kind, mt } = a;
  const footprints: Footprint[] = [];
  const owner = new Int16Array(a.N);
  const stray = new Uint8Array(a.N);
  const outdoor = !a.opts.indoor && !a.opts.underground && !a.opts.underwater;
  if (!a.buildings.length && !outdoor) return { footprints, owner, stray };
  const signs = new Set<number>();
  for (const s of events.signs) if (inside(s.x, s.y)) signs.add(idx(s.x, s.y));
  const destAt = (x: number, y: number) => events.warps.find((w) => w.x === x && w.y === y)?.dest ?? null;
  const count = new Int32Array(1024);
  for (let i = 0; i < a.N; i++) count[mt[i]]++;
  const isTerrain = (m: number) => count[m] >= TERRAIN;
  const walkable = (i: number) => kind[i] === K.Floor || kind[i] === K.Stairs || kind[i] === K.Ledge || kind[i] === K.Water;
  const blocked = (x: number, y: number) => inside(x, y) && (kind[idx(x, y)] === K.Block || kind[idx(x, y)] === K.Building);
  /** A walkable cell with no way in (walled in on all four sides): part of the art around it. */
  const walledIn = (x: number, y: number, wall: (i: number) => boolean) => {
    if (!inside(x, y) || kind[idx(x, y)] !== K.Floor) return false;
    for (const [ex, ey] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (!inside(ex, ey) || !wall(idx(ex, ey))) return false;
    return true;
  };
  /** Blocked-door buildings: blocked cells, their non-terrain art. */
  const plain: Look = {
    blocked,
    art: (x, y) => blocked(x, y) && !isTerrain(mt[idx(x, y)]) && !isSecretBaseSpot(a, idx(x, y)),
    enclosed: (x, y) => walledIn(x, y, (i) => !walkable(i)),
    green: (x, y) => a.info.green[mt[idx(x, y)]],
    open: walkable,
  };
  const meanColor = new Map<number, RGB>();
  /** Mean colour of a metatile's opaque pixels (sRGB). */
  const tileColor = (m: number): RGB => {
    let c = meanColor.get(m);
    if (!c) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let p = 0; p < 256; p++) {
        const v = a.info.both[m * 256 + p];
        if (v & 0x8000) continue;
        r += v & 31; g += (v >> 5) & 31; b += (v >> 10) & 31; n++;
      }
      c = n ? [r / n / 31, g / n / 31, b / n / 31] : [0, 0, 0];
      meanColor.set(m, c);
    }
    return c;
  };
  /** Mean colour of the art in a column's bottom rows, doors left out (null: none). */
  const columnColor = (L: Look, x: number, dy: number): RGB | null => {
    const s: RGB = [0, 0, 0];
    let n = 0;
    for (let y = dy; y > dy - 4; y--) {
      if (!L.art(x, y) || DOOR_BEHAVIORS.has(a.beh[idx(x, y)])) continue; // (doors are no wall colour)
      const c = tileColor(mt[idx(x, y)]);
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2];
      n++;
    }
    return n ? [s[0] / n, s[1] / n, s[2] / n] : null;
  };

  /** Door groups by row, from door cells in scan order: a double door with one warp, or doors to
   *  the same place, are one building. */
  const group = (cells: [number, number][]) => {
    const rows = new Map<number, Doors[]>();
    for (const [x, y] of cells) {
      let row = rows.get(y);
      if (!row) rows.set(y, (row = []));
      const g = row[row.length - 1], dest = destAt(x, y);
      if (g && x - g.xs[g.xs.length - 1] <= 2 * REACH &&
        (x === g.xs[g.xs.length - 1] + 1 || dest === null || g.dest === null || dest === g.dest)) {
        g.xs.push(x);
        g.dest ??= dest;
      } else {
        row.push({ y, xs: [x], dest });
      }
    }
    return rows;
  };
  /** Each group's columns [lo, hi]: neighbours on one row part between their doors where the
   *  colour changes most. */
  const spans = (L: Look, groups: Doors[]): [number, number][] => {
    const cuts: number[] = [];
    for (let k = 1; k < groups.length; k++) {
      const prev = groups[k - 1].xs, xa = prev[prev.length - 1], xb = groups[k].xs[0], dy = groups[k].y;
      let best = xa + 1, bestD = -1;
      for (let s = xa + 1; s <= xb; s++) {
        const p = columnColor(L, s - 1, dy), q = columnColor(L, s, dy);
        // (a column without art is a gap between them: the best cut)
        const d = !p || !q ? 3 : Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
        if (d > bestD) { bestD = d; best = s; }
      }
      cuts.push(best);
    }
    return groups.map(({ xs }, k) => [
      Math.max(k > 0 ? cuts[k - 1] : -Infinity, xs[0] - REACH),
      Math.min(k < cuts.length ? cuts[k] - 1 : Infinity, xs[xs.length - 1] + REACH),
    ]);
  };

  // Doors (the flood fills' seeds and the doors they swallowed); a tall door's upper half is its door.
  const isDoor = (x: number, y: number) => inside(x, y) && kind[idx(x, y)] === K.Building && DOOR_BEHAVIORS.has(a.beh[idx(x, y)]);
  const doorCell = new Uint8Array(a.N);
  const blockedDoors: [number, number][] = [];
  for (let y = a.minY; y < a.maxY; y++) {
    for (let x = a.minX; x < a.maxX; x++) {
      if (!isDoor(x, y) || isDoor(x, y + 1)) continue;
      doorCell[idx(x, y)] = 1;
      blockedDoors.push([x, y]);
    }
  }

  /**
   * The footprint of one door group (L: how its cells read; `walkIn`: the door cells are walkable,
   * the player steps onto them, and the building may stand one row further forward on both sides
   * of a walkable landing before them).
   */
  const grow = ({ y: dy, xs, dest }: Doors, lo: number, hi: number, L: Look, walkIn: boolean) => {
    // the door with the warp (the other half of a double door has none)
    const doorX = xs.find((x) => destAt(x, dy) !== null) ?? xs[0];
    const last = xs[xs.length - 1];
    // A walk-in door behind a landing (walkable cells before it, the building's art either side):
    // the building's front is the landing's row.
    const landing = walkIn && xs.every((x) => inside(x, dy + 1) && L.open(idx(x, dy + 1)) && !doorCell[idx(x, dy + 1)]) &&
      L.art(xs[0] - 1, dy + 1) && L.art(last + 1, dy + 1);
    const B = landing ? dy + 1 : dy;
    // up the door's column (through a tall door's upper half and walled-in cells), at most 5
    // rows for houses, Pokémon Centers, Marts, gyms and labs
    const limit = B - (buildingKind(dest, 1) === 'special' ? 13 : 4);
    let top = dy;
    while (isDoor(doorX, top - 1)) top--;
    while (top > limit && (L.art(doorX, top - 1) || L.enclosed(doorX, top - 1)) && !doorCell[idx(doorX, top - 1)]) top--;
    const height = B - top + 1;
    const base = baseAt(a, doorX, dy);
    /** A walk-in building's bush before its wall: foliage on the bottom row under its art, none of
     *  its art before it (the tree family's: the front stands back behind it, as over steps). */
    const bush = (x: number) => walkIn && !L.art(x, B) && L.blocked(x, B) && L.green(x, B) >= FOLIAGE && L.art(x, B - 1) &&
      !L.art(x, B + 1);
    const accept = (x: number) => {
      if (x < lo || x > hi || !inside(x, B) || !inside(x, B + 1)) return false;
      const d = idx(x, B), f = idx(x, B + 1);
      // a sign post standing before the building (a sign on its wall has the wall above it)
      if (signs.has(d) && inside(x, B - 1) && L.open(idx(x, B - 1))) return false;
      if (L.art(x, B)) {
        // Blocked art running on past the door row is a fence post column or another building
        // beside this one, unless it is terrain, a sign or a one-row fence before the wall, the
        // edge of the terrace the building stands on (lower ground in front: Sootopolis), or the
        // balustrade along a walk-in door's landing (the stairs before it run on too).
        const balustrade = landing && (x === xs[0] - 1 || x === last + 1);
        if (!balustrade && L.blocked(x, B + 1) && !signs.has(f) && !isTerrain(mt[f])) {
          let r = B + 1;
          while (L.blocked(x, r)) r++;
          const j = inside(x, r) ? idx(x, r) : -1;
          const open = j >= 0 && L.open(j);
          if (mt[f] === mt[d] || !open || !(r === B + 2 || a.height[j] < base - 0.5)) return false;
        }
      } else if (!(walkIn && xs.includes(x)) && !(L.open(d) && L.open(f) && mt[d] !== mt[f] && L.art(x, B - 1)) && !bush(x)) {
        return false; // not the building's own front steps (under its wall, unlike the ground before them)
      }
      let n = 1, g = 0, m = 0;
      for (let y = top; y <= B; y++) {
        const i = idx(x, y);
        if (doorCell[i] && !xs.includes(x)) return false; // another building's door
        if (walkIn && owner[i]) return false; // (a blocked-door building's art)
        // a cell the player can walk into, below the top row (the model's walls stand there), but
        // its own walk-in door and the landing before it
        if (y > top && y < B && L.open(i) && !L.enclosed(x, y) && !(walkIn && xs.includes(x) && y >= dy)) return false;
        if (y < B && (L.art(x, y) || L.enclosed(x, y))) n++;
        if (L.blocked(x, y)) { g += L.green(x, y); m++; }
      }
      return n >= FILL * height && !(m && g / m >= FOLIAGE);
    };
    let x0 = doorX, x1 = doorX;
    while (accept(x0 - 1)) x0--;
    while (accept(x1 + 1)) x1++;
    // hedge rows along the back, and rows mostly of terrain behind the building
    const rowGreen = (y: number) => {
      let s = 0, n = 0;
      for (let x = x0; x <= x1; x++) if (L.blocked(x, y)) { s += L.green(x, y); n++; }
      return n ? s / n : 0;
    };
    const rowArt = (y: number) => {
      let n = 0;
      for (let x = x0; x <= x1; x++) if (L.art(x, y) || L.enclosed(x, y)) n++;
      return n / (x1 - x0 + 1);
    };
    while (top < B - 1 && (rowGreen(top) >= FOLIAGE || rowArt(top) < 0.5)) top++;
    // (a door with nothing of its building above it: no model, its cells stay legacy art)
    if (top >= dy) return;
    if (walkIn) {
      // A walk-in door with no wall beside it is a mouth in the rock or the forest, not a
      // building's. Less than three rows (no roof over its walls), or art running on past either side
      // through most rows, is a bigger structure the footprint could only take part of (a green
      // roof read as foliage, Devon Corp's wings, the Battle Pyramid's steps, the rock face around a
      // cave mouth): the legacy art keeps all of it.
      const more = (x: number) => {
        let n = 0;
        for (let y = top; y <= B; y++) if (L.art(x, y) && !signs.has(idx(x, y)) && !owner[idx(x, y)] && L.green(x, y) < FOLIAGE) n++;
        return n >= FILL * (B - top + 1);
      };
      if ((x0 >= xs[0] && x1 <= last) || B - top < 2 || more(x0 - 1) || more(x1 + 1)) return;
      // (terrain inside it: a doorway cut into a cliff, as below the Trainer Hill)
      for (let y = top; y <= B; y++) for (let x = x0; x <= x1; x++) if (L.blocked(x, y) && isTerrain(mt[idx(x, y)])) return;
    }
    const recess: number[] = [];
    for (let x = x0; x <= x1; x++) {
      let r = bush(x) ? 1 : 0;
      while (r < B - top && L.open(idx(x, B - r)) && !L.enclosed(x, B - r)) r++;
      recess.push(r);
    }
    const fp = footprints.push({
      x0, x1, top, bottom: B, doorX, dest, base, recess, walkIn: walkIn ? xs.filter((x) => x >= x0 && x <= x1) : [], doorY: dy,
    });
    for (let x = x0; x <= x1; x++) {
      for (let y = top; y <= B; y++) {
        const i = idx(x, y);
        if ((L.art(x, y) || (y < B && L.enclosed(x, y))) && !owner[i]) owner[i] = fp;
      }
      // the roof's edge drawn on the row above (a lone cell, not the foot of a post behind it)
      if (L.art(x, top - 1) && !L.art(x, top - 2) && L.green(x, top - 1) < FOLIAGE && !owner[idx(x, top - 1)]) owner[idx(x, top - 1)] = fp;
    }
  };

  for (const groups of group(blockedDoors).values()) {
    const sp = spans(plain, groups);
    groups.forEach((g, k) => grow(g, sp[k][0], sp[k][1], plain, false));
  }
  if (outdoor) {
    const walk = walkInDoors(a, events, walkable, isTerrain);
    for (const [x, y] of walk.cells) doorCell[idx(x, y)] = 1;
    for (const groups of group(walk.cells).values()) {
      const sp = spans(walk.look, groups);
      groups.forEach((g, k) => grow(g, sp[k][0], sp[k][1], walk.look, true));
    }
  }
  for (const b of a.buildings) {
    if (b.cells.some((c) => owner[c])) for (const c of b.cells) if (!owner[c]) stray[c] = 1;
  }
  return { footprints, owner, stray };
}

/**
 * Walk-in doors: warps on walkable NON_ANIMATED_DOOR cells (the player steps onto the doorway)
 * with building art directly above, or a walled-in cell and then art (Stern's Shipyard). The
 * analysis' flood fill never seeds them (it starts from blocked doors), so their buildings would
 * otherwise go unmodelled: the Oceanic Museum, Stern's Shipyard, the Game Corner, the Lilycove
 * Museum, the Weather Institute, the harbours... How their cells read (the returned Look):
 *  - their art may include tiles the analysis took for tree leaves (the Oceanic Museum's teal
 *    towers: secondary tiles, not the General tileset's trees) or for water (a blue harbour wall
 *    beside the sea), but no foliage (clearly greener than blue: a bush, a hedge, a green roof);
 *  - beyond the door there is no way in: the door walls in a walkable cell behind it.
 * Not a cave mouth drawn by the General tileset (its rock), nor Fortree's treehouses (their doors
 * open onto the NO_RUNNING walkways up in the trees: the legacy art draws them, Task 12 ruling 1).
 */
function walkInDoors(a: MapAnalysis, events: GridEvents, walkable: (i: number) => boolean, isTerrain: (m: number) => boolean) {
  const { idx, inside, kind, mt } = a;
  /** Blocked art the analysis read as water (a blue harbour wall beside the sea). */
  const wet = (i: number) => kind[i] === K.Water && a.col[i] === 1 && !WATER_BEHAVIORS.has(a.beh[i]);
  const open = (i: number) => walkable(i) && !wet(i);
  // (also the art the analysis read as tree leaves: secondary tiles, not the General tileset's trees)
  const blocked = (x: number, y: number) => {
    if (!inside(x, y)) return false;
    const i = idx(x, y), k = kind[i];
    return k === K.Block || k === K.Building || (k === K.Tree && !a.isGeneralId(mt[i])) || wet(i);
  };
  // Foliage: clearly greener than blue (the teal walls of the Oceanic Museum are no hedge).
  const leaf = new Map<number, number>();
  const green = (x: number, y: number) => {
    const m = mt[idx(x, y)];
    let s = leaf.get(m);
    if (s === undefined) {
      s = 0;
      for (let p = 0; p < 256; p++) {
        const v = a.info.both[m * 256 + p];
        const r = v & 31, g = (v >> 5) & 31, b = (v >> 10) & 31;
        if (!(v & 0x8000) && g > r + 2 && g > b + 2) s++;
      }
      leaf.set(m, (s /= 256));
    }
    return s;
  };
  /** Its art: no terrain, and no foliage (a bush or hedge beside or before it). */
  const art = (x: number, y: number) => blocked(x, y) && !isTerrain(mt[idx(x, y)]) && green(x, y) < FOLIAGE && !isSecretBaseSpot(a, idx(x, y));
  const doors = new Set<number>();
  const cells: [number, number][] = [];
  for (const w of events.warps) {
    const { x, y } = w;
    if (!inside(x, y - 1) || !inside(x, y + 1)) continue;
    const i = idx(x, y);
    if (a.beh[i] !== MB.NON_ANIMATED_DOOR || !open(i) || doors.has(i)) continue;
    doors.add(i);
    // (a cave mouth in the General tileset's rock; a treehouse's door, on its walkway up in the trees)
    if (a.isGeneralId(mt[i]) || a.beh[idx(x, y + 1)] === MB.NO_RUNNING) continue;
    cells.push([x, y]);
  }
  /** Beyond a walk-in door there is no way in: its cells wall in a walkable cell behind it (which
   *  the analysis may take for stairs, squeezed between walls). */
  const enclosed = (x: number, y: number) => {
    if (!inside(x, y) || (kind[idx(x, y)] !== K.Floor && kind[idx(x, y)] !== K.Stairs)) return false;
    for (const [ex, ey] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (!inside(ex, ey) || (open(idx(ex, ey)) && !doors.has(idx(ex, ey)))) return false;
    }
    return true;
  };
  // (scan order, as the blocked doors: groups need them left to right, row by row)
  cells.sort((p, q) => p[1] - q[1] || p[0] - q[0]);
  const look: Look = { blocked, art, enclosed, green, open };
  return {
    look,
    cells: cells.filter(([x, y]) => art(x, y - 1) || (enclosed(x, y - 1) && art(x, y - 2))),
  };
}

/** Ground level before the door at (x, y): the walkable cell south of it (0 if none, never below 0). */
export function baseAt(a: MapAnalysis, x: number, y: number): number {
  const h = a.inside(x, y + 1) ? a.height[a.idx(x, y + 1)] : NaN;
  return Number.isNaN(h) ? 0 : Math.max(0, h);
}
