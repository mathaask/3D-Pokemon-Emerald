// Building footprints: the grid rectangle each door's building stands on, and its kind (from the
// door's warp destination). Shared by the building family (the models), and by the tree family
// and doorStructures, which treat the flood-filled cells outside every footprint as blocks.

import { DOOR_BEHAVIORS, K, type MapAnalysis } from '../overworld/analyze';
import type { GridEvents } from './events';
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
 *  least two, the bottom row holding the door). */
export interface Footprint {
  x0: number; x1: number; top: number; bottom: number;
  doorX: number;
  /** Warp destination of the door (null: no warp there). */
  dest: string | null;
  /** Ground level the building stands on (the cell before its door; never below 0). */
  base: number;
  /** Columns whose door-row cell is the building's walkable front steps (under its wall): the
   *  game lets the player stand there, so the model's front is one row back over them. */
  steps: number[];
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
const TERRAIN = 30;
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
 */
export function buildingLayout(a: MapAnalysis, events: GridEvents): BuildingLayout {
  const hit = layouts.get(a);
  if (hit && hit.events === events) return hit.layout;
  const layout = computeLayout(a, events);
  layouts.set(a, { events, layout });
  return layout;
}

function computeLayout(a: MapAnalysis, events: GridEvents): BuildingLayout {
  const { idx, inside, kind, mt } = a;
  const footprints: Footprint[] = [];
  const owner = new Int16Array(a.N);
  const stray = new Uint8Array(a.N);
  if (!a.buildings.length) return { footprints, owner, stray };
  const signs = new Set<number>();
  for (const s of events.signs) if (inside(s.x, s.y)) signs.add(idx(s.x, s.y));
  const destAt = (x: number, y: number) => events.warps.find((w) => w.x === x && w.y === y)?.dest ?? null;
  const count = new Int32Array(1024);
  for (let i = 0; i < a.N; i++) count[mt[i]]++;
  const isTerrain = (m: number) => count[m] >= TERRAIN;
  const walkable = (i: number) => kind[i] === K.Floor || kind[i] === K.Stairs || kind[i] === K.Ledge || kind[i] === K.Water;
  const blocked = (x: number, y: number) => inside(x, y) && (kind[idx(x, y)] === K.Block || kind[idx(x, y)] === K.Building);
  /** A building's own blocked art. */
  const art = (x: number, y: number) => blocked(x, y) && !isTerrain(mt[idx(x, y)]);
  /** A walkable cell with no way in (walled in on all four sides): part of the art around it. */
  const enclosed = (x: number, y: number) => {
    if (!inside(x, y) || kind[idx(x, y)] !== K.Floor) return false;
    for (const [ex, ey] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (!inside(ex, ey) || walkable(idx(ex, ey))) return false;
    return true;
  };
  const green = (x: number, y: number) => a.info.green[mt[idx(x, y)]];
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
  const columnColor = (x: number, dy: number): RGB | null => {
    const s: RGB = [0, 0, 0];
    let n = 0;
    for (let y = dy; y > dy - 4; y--) {
      if (!art(x, y) || DOOR_BEHAVIORS.has(a.beh[idx(x, y)])) continue; // (doors are no wall colour)
      const c = tileColor(mt[idx(x, y)]);
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2];
      n++;
    }
    return n ? [s[0] / n, s[1] / n, s[2] / n] : null;
  };

  // Doors (the flood fills' seeds and the doors they swallowed), by row; a double door with one
  // warp, or doors to the same place, are one building, and a tall door's upper half is its door.
  const isDoor = (x: number, y: number) => inside(x, y) && kind[idx(x, y)] === K.Building && DOOR_BEHAVIORS.has(a.beh[idx(x, y)]);
  const doorCell = new Uint8Array(a.N);
  const rows = new Map<number, { xs: number[]; dest: string | null }[]>();
  for (let y = a.minY; y < a.maxY; y++) {
    for (let x = a.minX; x < a.maxX; x++) {
      if (!isDoor(x, y) || isDoor(x, y + 1)) continue;
      doorCell[idx(x, y)] = 1;
      let row = rows.get(y);
      if (!row) rows.set(y, (row = []));
      const g = row[row.length - 1], dest = destAt(x, y);
      if (g && x - g.xs[g.xs.length - 1] <= 2 * REACH &&
        (x === g.xs[g.xs.length - 1] + 1 || dest === null || g.dest === null || dest === g.dest)) {
        g.xs.push(x);
        g.dest ??= dest;
      } else {
        row.push({ xs: [x], dest });
      }
    }
  }

  for (const [dy, groups] of rows) {
    // neighbours on this row part between their doors where the colour changes most
    const cuts: number[] = [];
    for (let k = 1; k < groups.length; k++) {
      const prev = groups[k - 1].xs, xa = prev[prev.length - 1], xb = groups[k].xs[0];
      let best = xa + 1, bestD = -1;
      for (let s = xa + 1; s <= xb; s++) {
        const p = columnColor(s - 1, dy), q = columnColor(s, dy);
        // (a column without art is a gap between them: the best cut)
        const d = !p || !q ? 3 : Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) + Math.abs(p[2] - q[2]);
        if (d > bestD) { bestD = d; best = s; }
      }
      cuts.push(best);
    }
    groups.forEach(({ xs, dest }, k) => {
      // the door with the warp (the other half of a double door has none)
      const doorX = xs.find((x) => destAt(x, dy) !== null) ?? xs[0];
      const lo = Math.max(k > 0 ? cuts[k - 1] : -Infinity, xs[0] - REACH);
      const hi = Math.min(k < cuts.length ? cuts[k] - 1 : Infinity, xs[xs.length - 1] + REACH);
      // up the door's column (through a tall door's upper half and walled-in cells), at most 5
      // rows for houses, Pokémon Centers, Marts, gyms and labs
      const limit = dy - (buildingKind(dest, 1) === 'special' ? 13 : 4);
      let top = dy;
      while (isDoor(doorX, top - 1)) top--;
      while (top > limit && (art(doorX, top - 1) || enclosed(doorX, top - 1)) && !doorCell[idx(doorX, top - 1)]) top--;
      const height = dy - top + 1;
      const base = baseAt(a, doorX, dy);
      const accept = (x: number) => {
        if (x < lo || x > hi || !inside(x, dy) || !inside(x, dy + 1)) return false;
        const d = idx(x, dy), f = idx(x, dy + 1);
        // a sign post standing before the building (a sign on its wall has the wall above it)
        if (signs.has(d) && inside(x, dy - 1) && walkable(idx(x, dy - 1))) return false;
        if (art(x, dy)) {
          // Blocked art running on past the door row is a fence post column or another building
          // beside this one, unless it is terrain, a sign or a one-row fence before the wall, or the
          // edge of the terrace the building stands on (lower ground in front: Sootopolis).
          if (blocked(x, dy + 1) && !signs.has(f) && !isTerrain(mt[f])) {
            let r = dy + 1;
            while (blocked(x, r)) r++;
            const j = inside(x, r) ? idx(x, r) : -1;
            const open = j >= 0 && walkable(j);
            if (mt[f] === mt[d] || !open || !(r === dy + 2 || a.height[j] < base - 0.5)) return false;
          }
        } else if (!(walkable(d) && walkable(f) && mt[d] !== mt[f] && art(x, dy - 1))) {
          return false; // not the building's own front steps (under its wall, unlike the ground before them)
        }
        let n = 1, g = 0, m = 0;
        for (let y = top; y <= dy; y++) {
          if (doorCell[idx(x, y)] && !xs.includes(x)) return false; // another building's door
          // a cell the player can walk into, below the top row (the model's walls stand there)
          if (y > top && y < dy && walkable(idx(x, y)) && !enclosed(x, y)) return false;
          if (y < dy && (art(x, y) || enclosed(x, y))) n++;
          if (blocked(x, y)) { g += green(x, y); m++; }
        }
        return n >= FILL * height && !(m && g / m >= FOLIAGE);
      };
      let x0 = doorX, x1 = doorX;
      while (accept(x0 - 1)) x0--;
      while (accept(x1 + 1)) x1++;
      // hedge rows along the back, and rows mostly of terrain behind the building
      const rowGreen = (y: number) => {
        let s = 0, n = 0;
        for (let x = x0; x <= x1; x++) if (blocked(x, y)) { s += green(x, y); n++; }
        return n ? s / n : 0;
      };
      const rowArt = (y: number) => {
        let n = 0;
        for (let x = x0; x <= x1; x++) if (art(x, y) || enclosed(x, y)) n++;
        return n / (x1 - x0 + 1);
      };
      while (top < dy - 1 && (rowGreen(top) >= FOLIAGE || rowArt(top) < 0.5)) top++;
      // (a door with nothing of its building above it: no model, its cells stay legacy art)
      if (top === dy) return;
      const steps: number[] = [];
      for (let x = x0; x <= x1; x++) if (walkable(idx(x, dy))) steps.push(x);
      const fp = footprints.push({ x0, x1, top, bottom: dy, doorX, dest, base, steps });
      for (let x = x0; x <= x1; x++) {
        for (let y = top; y <= dy; y++) {
          const i = idx(x, y);
          if ((art(x, y) || (y < dy && enclosed(x, y))) && !owner[i]) owner[i] = fp;
        }
        // the roof's edge drawn on the row above (a lone cell, not the foot of a post behind it)
        if (art(x, top - 1) && !art(x, top - 2) && green(x, top - 1) < FOLIAGE && !owner[idx(x, top - 1)]) owner[idx(x, top - 1)] = fp;
      }
    });
  }
  for (const b of a.buildings) {
    if (b.cells.some((c) => owner[c])) for (const c of b.cells) if (!owner[c]) stray[c] = 1;
  }
  return { footprints, owner, stray };
}

/** Ground level before the door at (x, y): the walkable cell south of it (0 if none, never below 0). */
export function baseAt(a: MapAnalysis, x: number, y: number): number {
  const h = a.inside(x, y + 1) ? a.height[a.idx(x, y + 1)] : NaN;
  return Number.isNaN(h) ? 0 : Math.max(0, h);
}
