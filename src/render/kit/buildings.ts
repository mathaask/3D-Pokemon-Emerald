// Buildings: real 3D houses, Pokémon Centers, Marts, Gyms, labs and special buildings, built on
// footprints grown out from each door over the building's own art (the analysis' door flood fill
// also swallows the fences, posts, rock and forest around it: buildingLayout). The kind comes from
// the door's warp destination; colours, windows and chimneys come from the building's own tiles.

import * as THREE from 'three';
import { DOOR_BEHAVIORS, K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../overworld/claims';
import { bgr555ToSrgb, luma, mix, saturation, scale, soften, toLinear, type RGB } from './palette';
import { MeshBuilder, type V3 } from './geom';
import type { GridEvents } from './events';
import { kitMaterial } from './materials';
import type { Family, KitContext, SemanticContext } from './semantics';

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

export interface BuildingPlacement {
  kind: BuildingKind;
  x0: number; x1: number;
  top: number; bottom: number;
  base: number;
  wallRows: number;
  doorX: number;
  roof: RGB;
  wall: RGB;
  windows: number[];
  chimneyX: number | null;
  /** `special`: the wall rows' ROM pixels (BGR555, 0x8000 transparent), row-major from the top. */
  facade: { w: number; h: number; px: Uint16Array } | null;
}

/** Window glass: a light blue (not the navy outlines), unlike the wall around it (Marts, Pokémon
 *  Centers and gyms have pale blue walls in the same shades as houses' windows). */
const isGlass = (c: RGB, wall: RGB) => c[2] > c[0] + 0.12 && c[2] >= c[1] && luma(c) > 0.45 && saturation(c) > 0.12 &&
  Math.abs(c[0] - wall[0]) + Math.abs(c[1] - wall[1]) + Math.abs(c[2] - wall[2]) > 0.1;
const isGrey = (c: RGB) => saturation(c) < 0.08 && luma(c) > 0.35 && luma(c) < 0.85;
/** The tiles' outline and shadow shades (navy, slate, mid grey), shared by every building. */
const isOutline = (c: RGB) => luma(c) <= 0.35 || (saturation(c) < 0.06 && luma(c) < 0.6);

/** Colour counts of metatiles' opaque pixels, cached per tile and per colour (one map's extract). */
class TileColors {
  private hists = new Map<number, Map<number, number>>();
  private rgb = new Map<number, RGB>();
  constructor(private readonly px: Uint16Array) {}

  /** Pixel count per BGR555 colour over `mts`. */
  counts(mts: readonly number[]): Map<number, number> {
    const out = new Map<number, number>();
    for (const m of mts) {
      let h = this.hists.get(m);
      if (!h) {
        h = new Map();
        for (let p = 0; p < 256; p++) {
          const v = this.px[m * 256 + p];
          if (!(v & 0x8000)) h.set(v, (h.get(v) ?? 0) + 1);
        }
        this.hists.set(m, h);
      }
      for (const [v, n] of h) out.set(v, (out.get(v) ?? 0) + n);
    }
    return out;
  }

  color(v: number): RGB {
    let c = this.rgb.get(v);
    if (!c) this.rgb.set(v, (c = bgr555ToSrgb(v)));
    return c;
  }

  /** Number of pixels of `mts` whose colour passes `accept`. */
  count(mts: readonly number[], accept: (c: RGB) => boolean): number {
    let n = 0;
    for (const [v, k] of this.counts(mts)) if (accept(this.color(v))) n += k;
    return n;
  }

  /** Most frequent colour of `mts` passing `accept`, with its pixel count. */
  top(mts: readonly number[], accept: (c: RGB) => boolean): { c: RGB; n: number } | null {
    let best: { c: RGB; n: number } | null = null;
    for (const [v, n] of this.counts(mts)) {
      if (best && n <= best.n) continue;
      const c = this.color(v);
      if (accept(c)) best = { c, n };
    }
    return best;
  }
}

/** Wall colour: the lightest of its common light shades (at least half as frequent as the most
 *  common): the plaster, not the pillars and frames drawn around it (Lilycove). Outline shades
 *  and window glass never count. */
function wallColor(tc: TileColors, mts: readonly number[]): RGB | null {
  const light: { c: RGB; n: number }[] = [];
  for (const [v, n] of tc.counts(mts)) {
    const c = tc.color(v);
    if (!isOutline(c) && luma(c) > 0.5 && !(c[2] > c[0] + 0.12 && saturation(c) > 0.3)) light.push({ c, n });
  }
  const top = Math.max(0, ...light.map((k) => k.n));
  let best: RGB | null = null;
  for (const { c, n } of light) if (n * 2 >= top && (!best || luma(c) > luma(best))) best = c;
  return best;
}

/** Roof colour: its most common colourful shade, unless a neutral one (a grey slate roof) covers
 *  more than twice as much. Outline shades never count. */
function roofColor(tc: TileColors, mts: readonly number[]): RGB | null {
  const s = tc.top(mts, (c) => !isOutline(c) && saturation(c) >= 0.12);
  const n = tc.top(mts, (c) => !isOutline(c) && luma(c) > 0.45 && saturation(c) < 0.12);
  if (s && (!n || s.n * 2 >= n.n)) return s.c;
  return n?.c ?? null;
}

function facadePixels(a: MapAnalysis, x0: number, x1: number, y0: number, y1: number) {
  const w = (x1 - x0 + 1) * 16, h = (y1 - y0 + 1) * 16;
  const px = new Uint16Array(w * h);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const m = a.mt[a.idx(x, y)];
      for (let p = 0; p < 256; p++) {
        px[((y - y0) * 16 + (p >> 4)) * w + (x - x0) * 16 + (p & 15)] = a.info.both[m * 256 + p];
      }
    }
  }
  return { w, h, px };
}

// ---------------------------------------------------------------- footprints

/** One building's footprint: the grid rectangle its 3D model stands on (rows top..bottom, the
 *  bottom row holding the door). */
export interface Footprint {
  x0: number; x1: number; top: number; bottom: number;
  doorX: number;
  /** Warp destination of the door (null: no warp there). */
  dest: string | null;
}

export interface BuildingLayout {
  footprints: Footprint[];
  /** Cells drawn by a footprint's model (the blocked art inside it, and the lone roof-edge cells
   *  on the row above it): footprint index + 1, 0 = none. */
  owner: Int16Array;
  /** Cells of the analysis' building regions outside every footprint: art the door flood fill
   *  swallowed that is not a building (a forest, rock, hedges, fences, lamp posts, signs). They
   *  stay blocks: other families may take them, the legacy art draws the rest. */
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
 *    wall) and are no sign post, no wall running on past the door row, no hedge, no other door.
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
      const front = inside(doorX, dy + 1) ? a.height[idx(doorX, dy + 1)] : NaN;
      const base = Number.isNaN(front) ? 0 : front;
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
      const fp = footprints.push({ x0, x1, top, bottom: dy, doorX, dest });
      for (let x = x0; x <= x1; x++) {
        for (let y = top; y <= dy; y++) if (art(x, y) && !owner[idx(x, y)]) owner[idx(x, y)] = fp;
        // the roof's edge drawn on the row above (a lone cell, not the foot of a post behind it)
        if (art(x, top - 1) && !art(x, top - 2) && green(x, top - 1) < FOLIAGE && !owner[idx(x, top - 1)]) owner[idx(x, top - 1)] = fp;
      }
    });
  }
  for (const b of a.buildings) for (const c of b.cells) if (!owner[c]) stray[c] = 1;
  return { footprints, owner, stray };
}

// ---------------------------------------------------------------- family

export const buildingFamily: Family<BuildingPlacement[]> = {
  name: 'buildings',

  extract({ a, events }: SemanticContext, claims: Claims): BuildingPlacement[] {
    // (a Dive map has no buildings to stand on its seabed)
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const { footprints, owner } = buildingLayout(a, events);
    const tc = new TileColors(a.info.both);
    const out: BuildingPlacement[] = [];
    footprints.forEach((fp, k) => {
      const { x0, x1, top, bottom, doorX } = fp;
      const mine = (x: number, y: number) => a.inside(x, y) && owner[a.idx(x, y)] === k + 1;
      for (let y = top - 1; y <= bottom; y++) for (let x = x0; x <= x1; x++) if (mine(x, y) && claims.has(a.idx(x, y), CLAIM_OBJECT)) return;
      const rows = bottom - top + 1;
      const wallRows = rows >= 9 ? 4 : rows >= 7 ? 3 : 2;
      const below = a.inside(doorX, bottom + 1) ? a.idx(doorX, bottom + 1) : -1;
      const base = below >= 0 && !Number.isNaN(a.height[below]) ? Math.max(0, a.height[below]) : 0;
      const kind = buildingKind(fp.dest, x1 - x0 + 1);
      const roofMts: number[] = [], wallMts: number[] = [];
      for (let y = top; y <= bottom; y++) {
        for (let x = x0; x <= x1; x++) if (mine(x, y)) (y > bottom - wallRows ? wallMts : roofMts).push(a.mt[a.idx(x, y)]);
      }
      const roof = roofColor(tc, roofMts) ?? [0.75, 0.35, 0.3];
      // the wall's own (light) colour, not its outlines and shadows
      const wall = wallColor(tc, wallMts) ?? tc.top(wallMts, (c) => luma(c) > 0.3)?.c ?? [0.9, 0.88, 0.8];
      const glass = (c: RGB) => isGlass(c, wall);
      const windows: number[] = [];
      // A chimney is a roof column far greyer than all the others (outlines and grey slate roofs
      // are grey everywhere).
      const greys: number[] = [];
      for (let x = x0; x <= x1; x++) {
        const wm: number[] = [], rm: number[] = [];
        for (let y = top; y <= bottom; y++) if (mine(x, y)) (y > bottom - wallRows ? wm : rm).push(a.mt[a.idx(x, y)]);
        if (x !== doorX && tc.count(wm, glass) > 20) windows.push(x);
        greys.push(tc.count(rm, isGrey));
      }
      const [g1, g2 = 0] = [...greys].sort((p, q) => q - p);
      const chimneyX = kind === 'house' && g1 > 40 && g1 >= 2 * g2 ? x0 + greys.indexOf(g1) : null;
      // The model stands on its art and on the walkable cells walled in under it (their art is
      // the building's: the ground beneath takes the look of the ground before the door).
      const ground = below >= 0 && a.kind[below] === K.Floor ? a.mt[below] : -1;
      for (let y = top - 1; y <= bottom; y++) {
        for (let x = x0; x <= x1; x++) {
          if (!a.inside(x, y)) continue;
          const i = a.idx(x, y);
          if (mine(x, y) || (y >= top && (a.kind[i] === K.Floor || a.kind[i] === K.Stairs))) {
            claims.claim(i, CLAIM_OBJECT);
            claims.groundY[i] = base;
            claims.groundMt[i] = ground;
          }
          // overhang art on the walkable row behind (and on walkable cells inside): the 3D roof replaces it
          if (a.kind[i] === K.Floor && a.hasTop(i)) claims.claim(i, CLAIM_TOP);
        }
      }
      out.push({
        kind, x0, x1, top, bottom, base, wallRows, doorX,
        roof: soften(roof), wall: soften(wall), windows, chimneyX,
        facade: kind === 'special' ? facadePixels(a, x0, x1, bottom - wallRows + 1, bottom) : null,
      });
    });
    return out;
  },

  build(list: BuildingPlacement[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!list.length) return null;
    const parts: BuildingParts = { body: new MeshBuilder(), roof: new MeshBuilder(), glass: new MeshBuilder(), extras: [] };
    for (const p of list) buildBuilding(p, parts, kit);
    const root = new THREE.Group();
    const add = (mb: MeshBuilder, mat: THREE.Material) => {
      if (mb.empty) return;
      const mesh = new THREE.Mesh(mb.build(), mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root.add(mesh);
    };
    add(parts.body, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.85, fade: true }).material);
    add(parts.roof, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.7, pattern: 'roofTiles', fade: true, side: THREE.DoubleSide }).material);
    add(parts.glass, kitMaterial(kit.uniforms, { vertexColors: true, roughness: 0.15, metalness: 0.1, glow: 1.6, fade: true }).material);
    for (const e of parts.extras) root.add(e);
    return root;
  },
};

export interface BuildingParts { body: MeshBuilder; roof: MeshBuilder; glass: MeshBuilder; extras: THREE.Object3D[] }

/** Shared numbers of one building in world space. */
export interface BuildingFrame {
  X0: number; X1: number; cx: number;
  zf: number; zb: number; zm: number;
  y0: number;      // top of the plinth (wall bottom)
  eave: number;    // wall top
  D: number; W: number;
  ov: number;      // roof overhang
}

export function buildFrame(p: BuildingPlacement): BuildingFrame {
  const W = p.x1 - p.x0 + 1;
  const D = Math.min(4, Math.max(1.6, p.bottom - p.top));
  const zf = p.bottom + 1 + p.base;
  const y0 = p.base + 0.12;
  return { X0: p.x0, X1: p.x1 + 1, cx: p.x0 + W / 2, zf, zb: zf - D, zm: zf - D / 2, y0, eave: y0 + p.wallRows * 0.95, D, W, ov: 0.25 };
}

/** Axis-aligned box centred on (cx, cy, cz), all six faces (quads straight into `mb`: no geometry). */
export function addBox(mb: MeshBuilder, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, color: RGB): void {
  const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
  mb.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], color);
  mb.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], color);
  mb.quad([x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], [0, 0, 1], color);
  mb.quad([x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0], [0, 0, -1], color);
  mb.quad([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], [-1, 0, 0], color);
  mb.quad([x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1], [1, 0, 0], color);
}

function tri(mb: MeshBuilder, a: V3, b: V3, c: V3, color: RGB): void {
  const n = new THREE.Vector3().subVectors(new THREE.Vector3(...b), new THREE.Vector3(...a))
    .cross(new THREE.Vector3().subVectors(new THREE.Vector3(...c), new THREE.Vector3(...a))).normalize();
  mb.quad(a, b, c, c, [n.x, n.y, n.z], color);
}

/** Gable (inset 0) or hip roof over [x0, x1] × [zb, zf] from the eave up by `rise`. */
export function roofGeometry(mb: MeshBuilder, x0: number, x1: number, zb: number, zf: number, eave: number, rise: number, hip: boolean, color: RGB): void {
  const zm = (zb + zf) / 2;
  const inset = hip ? Math.min((zf - zb) / 2, (x1 - x0) / 2 - 0.01) : 0;
  const E0: V3 = [x0, eave, zf], E1: V3 = [x1, eave, zf], E2: V3 = [x1, eave, zb], E3: V3 = [x0, eave, zb];
  const R0: V3 = [x0 + inset, eave + rise, zm], R1: V3 = [x1 - inset, eave + rise, zm];
  mb.quad(R0, R1, E1, E0, [0, zf - zm, rise], color);   // front slope
  mb.quad(R1, R0, E3, E2, [0, zf - zm, -rise], color);  // back slope
  if (hip) {
    tri(mb, E3, E0, R0, color);
    tri(mb, E1, E2, R1, color);
  }
}

function buildBuilding(p: BuildingPlacement, parts: BuildingParts, kit: KitContext): void {
  const f = buildFrame(p);
  const wall = toLinear(p.wall);
  const roof = toLinear(p.roof);
  const trim = toLinear(mix(p.wall, p.roof, 0.3).map((v) => v * 0.85) as RGB);
  const stone = toLinear([0.62, 0.6, 0.58]);
  const wood = toLinear([0.5, 0.34, 0.2]);
  const frameC = toLinear([0.93, 0.91, 0.87]);
  const glassC = toLinear([0.55, 0.72, 0.85]);
  const { body, glass } = parts;
  const H = f.eave - f.y0;
  // plinth, walls, baseboard, corner posts
  addBox(body, f.cx, p.base + 0.06, f.zm, f.W + 0.12, 0.12, f.D + 0.12, stone);
  addBox(body, f.cx, f.y0 + H / 2, f.zm, f.W, H, f.D, wall);
  addBox(body, f.cx, f.y0 + 0.15, f.zm, f.W + 0.03, 0.3, f.D + 0.03, scale(wall, 0.72));
  for (const [x, z] of [[f.X0, f.zf], [f.X1, f.zf], [f.X0, f.zb], [f.X1, f.zb]]) addBox(body, x, f.y0 + H / 2, z, 0.12, H, 0.12, trim);
  // step in front of the door
  addBox(body, p.doorX + 0.5, p.base + 0.04, f.zf + 0.22, 1.1, 0.08, 0.36, stone);
  if (p.kind === 'special') {
    addSpecialFacade(p, f, parts, kit);
  } else {
    // door
    addBox(body, p.doorX + 0.5, f.y0 + 0.68, f.zf + 0.03, 0.86, 1.36, 0.08, trim);
    if (p.kind === 'pc' || p.kind === 'mart') addBox(glass, p.doorX + 0.5, f.y0 + 0.62, f.zf + 0.07, 0.72, 1.22, 0.04, glassC);
    else addBox(body, p.doorX + 0.5, f.y0 + 0.62, f.zf + 0.07, 0.68, 1.22, 0.05, wood);
    // windows
    for (const x of p.windows) {
      const wy = f.y0 + H * 0.58;
      addBox(body, x + 0.5, wy, f.zf + 0.03, 0.72, 0.62, 0.06, frameC);
      addBox(glass, x + 0.5, wy, f.zf + 0.065, 0.58, 0.48, 0.03, glassC);
      addBox(body, x + 0.5, wy - 0.33, f.zf + 0.07, 0.82, 0.05, 0.14, frameC);
    }
  }
  // roof
  const hip = p.kind !== 'house' || f.W >= 6;
  const run = f.D / 2 + f.ov;
  const rise = p.kind === 'house' ? 0.55 * run : p.kind === 'gym' ? 0.18 * run : 0.32 * run;
  roofGeometry(parts.roof, f.X0 - f.ov, f.X1 + f.ov, f.zb - f.ov, f.zf + f.ov, f.eave, rise, hip, roof);
  if (!hip) {
    // gable walls under a gable roof
    const gy = f.eave + rise * (f.D / 2) / run;
    // vertex order sets the facing: west gable faces -X, east gable faces +X
    tri(body, [f.X0, f.eave, f.zb], [f.X0, f.eave, f.zf], [f.X0, gy, f.zm], wall);
    tri(body, [f.X1, f.eave, f.zf], [f.X1, f.eave, f.zb], [f.X1, gy, f.zm], wall);
  }
  addBox(body, f.cx, f.eave - 0.04, f.zf + f.ov, f.W + 2 * f.ov, 0.08, 0.06, trim);
  addBox(body, f.cx, f.eave - 0.04, f.zb - f.ov, f.W + 2 * f.ov, 0.08, 0.06, trim);
  const ridgeLen = f.W + 2 * f.ov - (hip ? 2 * Math.min(run, f.W / 2 + f.ov - 0.01) : 0);
  if (ridgeLen > 0.05) addBox(parts.roof, f.cx, f.eave + rise + 0.02, f.zm, ridgeLen, 0.07, 0.14, scale(roof, 0.8));
  if (p.chimneyX !== null) addBox(body, p.chimneyX + 0.5, f.eave + rise * 0.6 + 0.2, f.zm - 0.3, 0.35, 0.7, 0.35, toLinear([0.55, 0.38, 0.32]));
  addKindDetails(p, f, rise, parts, kit);
}

/** Kind-specific details (signs, emblem, awning, pillars, vents); filled in Task 13. */
function addKindDetails(_p: BuildingPlacement, _f: BuildingFrame, _rise: number, _parts: BuildingParts, _kit: KitContext): void {}

/** `special` front wall from the ROM facade; filled in Task 13. */
function addSpecialFacade(_p: BuildingPlacement, _f: BuildingFrame, _parts: BuildingParts, _kit: KitContext): void {}
