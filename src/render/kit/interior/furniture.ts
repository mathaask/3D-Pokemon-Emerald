// The interior furniture core (Phase 4, D6/D7): real-world sizes per kind, the fitting of a model on the game's footprint
// (the blocked cells' ground area, anchored at their south edge, never behind the back wall), the pieces a room's
// furniture ids make (with their cells, footprints, colours and facing), and the family that claims them and builds the
// generators' soups. The generators live in furnitureHome.ts / furnitureService.ts (they import this module); the family
// with them is composed in index.ts (no import cycle).
//
// Pieces: the 4-connected cells of one furniture kind (a component; any other id, unknown included, cuts it), split per
// the kind's FURNITURE_SPLIT: one piece per component (tables, counters, shelves, beds, machines: furniture that spans
// cells), one per cell (chairs, crates, vases, trash cans: stacked ones never merge into one long piece), or one per
// column object (plants: a pot with the walkable leaves drawn north of it, side-by-side planters apart). What stands
// on cells the game lets the player walk over is low (at most WALKABLE_SEAT), so it never clips the player: each walkable
// cell's own footprint (cellFeet: a stool, a bed's head, a plant's leaves), and a whole piece on walkable cells but stairs.

import * as THREE from 'three';
import { K, type MapAnalysis } from '../../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_TOP, type Claims } from '../../overworld/claims';
import type { Quality } from '../../post';
import type { Family, KitContext, SemanticContext } from '../semantics';
import { applyKitMaterial, kitMaterial, type KitMaterialOptions } from '../materials';
import { BUILDING_BODY } from '../buildings';
import { PROP_GLOW } from '../props';
import { glowMesh } from '../glow';
import { Soup } from '../soup';
import { hashCell } from '../geom';
import type { RGB } from '../palette';
import { FURNITURE_KINDS, interiorIds, type FurnitureKind, type InteriorId } from '../tables/building';
import { DIR_STEP, RECESS, roomLayout, walkable, type RoomLayout, type WallDir } from './room';
import { colorInfo, partColors, type PartColors } from './colors';
import { SHELL } from './wallParts';
import type { InteriorCatalogueEntry } from './index';

/** A kind's real-world size (D6): height over the floor and depth (north–south, at most its rows). Low = height ≤ 1.2:
 *  it never fades (D7). */
export interface FurnitureSpec { height: number; depth: number }
export const FURNITURE_SPEC: Readonly<Record<FurnitureKind, FurnitureSpec>> = {
  bed: { height: 0.55, depth: 2.0 }, table: { height: 0.75, depth: 1.6 }, chair: { height: 0.9, depth: 0.6 },
  tv: { height: 1.1, depth: 0.5 }, pc: { height: 1.2, depth: 0.6 }, bookshelf: { height: 2.1, depth: 0.45 },
  plant: { height: 1.3, depth: 0.7 }, fridge: { height: 1.9, depth: 0.5 }, sink: { height: 0.95, depth: 0.5 },
  cabinet: { height: 1.0, depth: 0.5 }, crate: { height: 0.8, depth: 0.8 }, trashCan: { height: 0.6, depth: 0.5 },
  // (serving counters 0.88, under a real 1.0: the nurse and the clerks behind them read from the chest up at the default
  // camera, as on the GBA — controller ruling I2, Task 10)
  vase: { height: 0.6, depth: 0.5 }, counter: { height: 0.88, depth: 0.9 }, healer: { height: 1.3, depth: 0.8 },
  pcCounter: { height: 0.88, depth: 0.9 }, martShelf: { height: 1.6, depth: 1.4 }, stairsUp: { height: 1.6, depth: 1 },
  stairsDown: { height: 0, depth: 1 },
};

/** Low furniture (≤ 1.2 high) never fades, its screens included (D7: the nurse behind her counter). */
export const isLow = (k: FurnitureKind) => FURNITURE_SPEC[k].height <= 1.2;

/** How a component of one kind becomes pieces: `component` one piece (furniture spanning cells: tables and counters
 *  may merge, as may shelves, beds, cabinets, machines), `cell` one piece per cell (single items: stacked chairs or
 *  crates never merge), `column` one piece per column object (a plant: its pot and the walkable leaves drawn north of
 *  it; a walkable cell after a blocked one starts the next plant). */
export type FurnitureSplit = 'component' | 'cell' | 'column';
export const FURNITURE_SPLIT: Readonly<Record<FurnitureKind, FurnitureSplit>> = {
  bed: 'component', table: 'component', chair: 'cell', tv: 'component', pc: 'component', bookshelf: 'component',
  plant: 'column', fridge: 'component', sink: 'component', cabinet: 'component', crate: 'cell', trashCan: 'cell',
  vase: 'cell', counter: 'component', healer: 'component', pcCounter: 'component', martShelf: 'component',
  stairsUp: 'component', stairsDown: 'component',
};

/** Furniture on cells the player walks over is this high at most (the walkable-furniture ruling): every walkable cell's
 *  own footprint (cellFeet: a stool, a bed's head, a plant's leaves), and a whole piece on walkable cells (a stool, an
 *  armchair, a bench) but stairs, which the player climbs. */
export const WALKABLE_SEAT = 0.45;

/** A chair faces the nearest table cell within this distance (cell centres); none: no facing. */
export const CHAIR_REACH = 2.5;

/** A model's footprint in world units: x [x0, x1], z [z0, z1] on the floor at height y, `height` tall. */
export interface Footprint { x0: number; x1: number; z0: number; z1: number; y: number; height: number }

/** Columns x0..x1, rows y0..y1 (inclusive) at floor height h: x [x0, x1 + 1]; z1 = y1 + 1 + h; z0 = max(z1 − min(spec.depth,
 *  rows), wallZ) — never behind `wallZ` (−Infinity when free-standing). */
export function fitFurniture(kind: FurnitureKind, x0: number, x1: number, y0: number, y1: number, h: number, wallZ: number): Footprint {
  const spec = FURNITURE_SPEC[kind];
  const z1 = y1 + 1 + h;
  const z0 = Math.max(z1 - Math.min(spec.depth, y1 - y0 + 1), wallZ);
  return { x0, x1: x1 + 1, z0, z1, y: h, height: spec.height };
}

/** What stands against a back wall keeps this far in front of its inner face: the wall's relief (baseboard, rail) never
 *  shows through its back (= SHELF.back). The family passes wallZ = the N run's line + WALL_BACK. */
export const WALL_BACK = SHELL.relief + 0.015;

export interface FurniturePiece {
  kind: FurnitureKind; cells: number[];
  xy: [number, number][];      // the cells' grid coordinates, in `cells` order
  floorY: number;              // the floor height the piece stands on
  foot: Footprint;             // the component's bounding footprint
  cellFeet: Footprint[];       // one per cell (fitFurniture of that cell alone): non-rectangular components (L counters)
  facing: WallDir | null;      // chairs: towards the nearest table piece; stairs: the side they are entered from; else null
  colors: PartColors; seed: number;
}

/** Low pieces' screens go into glowLow (D7: they never fade). No kind draws glass (the Oldale glass cabinet and Steven's
 *  case are labelled cabinet / floor), so the furniture has no glass soups. */
export interface FurnitureOut { tall: Soup; low: Soup; glow: Soup; glowLow: Soup }
export type FurnitureGenerator = (p: FurniturePiece, out: FurnitureOut, q: Quality) => void;

/** Four empty soups. */
export function newFurnitureOut(): FurnitureOut {
  return { tall: new Soup(), low: new Soup(), glow: new Soup(), glowLow: new Soup() };
}

export const FURNITURE_TALL: KitMaterialOptions = BUILDING_BODY;
export const FURNITURE_LOW: KitMaterialOptions = { vertexColors: true, roughness: 0.8 };
export const FURNITURE_GLOW_LOW: KitMaterialOptions = { ...PROP_GLOW, fade: false };
/** The glow soups' own light (linear, glowMesh's emissive): a screen's soft cool light. */
export const FURNITURE_EMISSIVE: RGB = [0.3, 0.33, 0.36];

const PNC = { position: 3, normal: 3, color: 3 };
/** TALL / LOW on PNC, cast; PROP_GLOW and FURNITURE_GLOW_LOW on PNC, no cast (glowMesh). Part of INTERIOR_CATALOGUE (the
 *  drift guard checks that every material the family builds is in it). */
export const FURNITURE_CATALOGUE: readonly InteriorCatalogueEntry[] = [
  { material: FURNITURE_TALL, attrs: PNC, castShadow: true },
  { material: FURNITURE_LOW, attrs: PNC, castShadow: true },
  { material: PROP_GLOW, attrs: PNC, castShadow: false },
  { material: FURNITURE_GLOW_LOW, attrs: PNC, castShadow: false },
];

const FURNITURE = new Set<InteriorId>(FURNITURE_KINDS);
const STAIRS: ReadonlySet<FurnitureKind> = new Set<FurnitureKind>(['stairsUp', 'stairsDown']);
const KIND_INDEX = new Map<FurnitureKind, number>(FURNITURE_KINDS.map((k, n) => [k, n]));

/** The floor height under cell i (a walkable cell's own, a blocked one's ground). */
function floorAt(a: MapAnalysis, i: number): number {
  const h = a.kind[i] === K.Floor ? a.height[i] : a.groundH[i];
  return Number.isNaN(h) ? 0 : Math.max(0, h);
}

/** The world z of the wall a piece stands against (+ WALL_BACK): the nearest N run over its columns whose face lies in
 *  its top row or the recess north of it (a back wall, a partition's north face); none: −Infinity (free-standing). */
function wallZOf(L: RoomLayout, x0: number, x1: number, y0: number, z1: number, h: number): number {
  let best = -Infinity;
  for (const r of L.runs) {
    if (r.dir !== 'N' || r.from >= x1 + 1 || r.to <= x0) continue;
    const z = r.line + r.floorY;
    if (z >= y0 + h - RECESS - 1e-6 && z < z1 && z > best) best = z;
  }
  return best === -Infinity ? best : best + WALL_BACK;
}

/** A component's cells (sorted by index) split into pieces per its kind's FURNITURE_SPLIT. */
function splitComponent(a: MapAnalysis, kind: FurnitureKind, cells: number[]): number[][] {
  const how = FURNITURE_SPLIT[kind];
  if (how === 'component') return [cells];
  if (how === 'cell') return cells.map((c) => [c]);
  const byX = new Map<number, number[]>();
  for (const c of cells) {
    const x = a.cellX(c);
    if (!byX.has(x)) byX.set(x, []);
    byX.get(x)!.push(c);
  }
  const out: number[][] = [];
  for (const col of byX.values()) {
    col.sort((p, q) => p - q);
    let cur: number[] = [];
    for (const c of col) {
      const prev = cur[cur.length - 1];
      if (prev !== undefined && (a.cellY(c) !== a.cellY(prev) + 1 || (!walkable(a, prev) && walkable(a, c)))) {
        out.push(cur);
        cur = [];
      }
      cur.push(c);
    }
    if (cur.length) out.push(cur);
  }
  return out;
}

/** A chair's facing: towards the nearest table cell within CHAIR_REACH (the larger axis; ties: east / west). */
function chairFacing(a: MapAnalysis, ids: readonly (InteriorId | null)[], xy: readonly [number, number][]): WallDir | null {
  let best = Infinity, dir: WallDir | null = null;
  const r = Math.ceil(CHAIR_REACH);
  for (const [x, y] of xy) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const d = Math.hypot(dx, dy);
        if (d === 0 || d > CHAIR_REACH || d >= best || !a.inside(x + dx, y + dy) || ids[a.idx(x + dx, y + dy)] !== 'table') continue;
        best = d;
        dir = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : (dy > 0 ? 'S' : 'N');
      }
    }
  }
  return dir;
}

/** Stairs' facing: the side they are entered from — the first of S, W, E, N with standable room floor beside them. */
function stairsFacing(a: MapAnalysis, ids: readonly (InteriorId | null)[], L: RoomLayout, xy: readonly [number, number][]): WallDir | null {
  for (const dir of ['S', 'W', 'E', 'N'] as const) {
    const [dx, dy] = DIR_STEP[dir];
    for (const [x, y] of xy) {
      if (!a.inside(x + dx, y + dy)) continue;
      const n = a.idx(x + dx, y + dy);
      const id = ids[n];
      if (L.inside[n] && walkable(a, n) && !(id !== null && FURNITURE.has(id))) return dir;
    }
  }
  return null;
}

/** Components: 4-connected cells of one furniture kind, cut at any cell whose id differs (unknown included), split per
 *  FURNITURE_SPLIT. A piece whose kind has a generator claims CLAIM_OBJECT (+ CLAIM_TOP where its cells carry top-layer
 *  art: the leaves or tops it draws over the cell north of its base, labelled with its id), with groundMt = the room's
 *  floorTile; one without stays legacy. Ids through interiorIds(a) only; the room's own cells only (inside or band). */
export function furnitureFamilyWith(generators: Partial<Record<FurnitureKind, FurnitureGenerator>>): Family<FurniturePiece[]> {
  return {
    name: 'furniture',
    extract(ctx: SemanticContext, claims: Claims): FurniturePiece[] {
      const { a } = ctx;
      const ids = interiorIds(a);
      const L = roomLayout(a, ids, ctx.events.warps);
      const pieces: FurniturePiece[] = [];
      const seen = new Uint8Array(a.N);
      for (let s = 0; s < a.N; s++) {
        const id = ids[s];
        if (seen[s] || id === null || !FURNITURE.has(id) || !(L.inside[s] || L.band[s])) continue;
        const kind = id as FurnitureKind;
        const comp = [s];
        seen[s] = 1;
        for (let k = 0; k < comp.length; k++) {
          const x = a.cellX(comp[k]), y = a.cellY(comp[k]);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!a.inside(x + dx, y + dy)) continue;
            const j = a.idx(x + dx, y + dy);
            if (!seen[j] && ids[j] === kind && (L.inside[j] || L.band[j])) { seen[j] = 1; comp.push(j); }
          }
        }
        if (!generators[kind]) continue;
        comp.sort((p, q) => p - q);
        for (const cells of splitComponent(a, kind, comp)) pieces.push(makePiece(a, ids, L, kind, cells));
      }
      pieces.sort((p, q) => p.cells[0] - q.cells[0]);
      for (const p of pieces) {
        for (const i of p.cells) {
          claims.claim(i, CLAIM_OBJECT);
          if (a.hasTop(i)) claims.claim(i, CLAIM_TOP);
          if (L.floorTile >= 0) claims.groundMt[i] = L.floorTile;
        }
      }
      return pieces;
    },
    build(pieces: FurniturePiece[], ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
      if (!pieces.length) return null;
      const out = newFurnitureOut();
      for (const p of pieces) generators[p.kind]!(p, out, ctx.quality);
      const g = new THREE.Group();
      const solid = (s: Soup, o: KitMaterialOptions, name: string) => {
        if (s.empty) return;
        const km = kitMaterial(kit.uniforms, o);
        const mesh = new THREE.Mesh(s.geometry(), km.material);
        applyKitMaterial(mesh, km);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = name;
        g.add(mesh);
      };
      const glow = (s: Soup, o: KitMaterialOptions, name: string) => {
        if (s.empty) return;
        const mesh = glowMesh(kit.uniforms, s.geometry(), FURNITURE_EMISSIVE, o);
        mesh.receiveShadow = true;
        mesh.name = name;
        g.add(mesh);
      };
      solid(out.tall, FURNITURE_TALL, 'furnitureTall');
      solid(out.low, FURNITURE_LOW, 'furnitureLow');
      glow(out.glow, PROP_GLOW, 'furnitureGlow');
      glow(out.glowLow, FURNITURE_GLOW_LOW, 'furnitureGlowLow');
      return g.children.length ? g : null;
    },
  };
}

/** One piece of `kind` on `cells` (sorted by index). */
function makePiece(a: MapAnalysis, ids: readonly (InteriorId | null)[], L: RoomLayout, kind: FurnitureKind, cells: number[]): FurniturePiece {
  const xy = cells.map((c): [number, number] => [a.cellX(c), a.cellY(c)]);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of xy) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const floorY = floorAt(a, cells[cells.length - 1]);
  // (what stands on cells the player walks over is low: a walkable cell's own footprint, whatever its kind — a stool, a
  // bed's head, a plant's leaves —, and a whole piece on walkable cells but stairs, which the player climbs)
  const fit = (cx0: number, cx1: number, cy0: number, cy1: number, low: boolean) => {
    const f = fitFurniture(kind, cx0, cx1, cy0, cy1, floorY, wallZOf(L, cx0, cx1, cy0, cy1 + 1 + floorY, floorY));
    if (low) f.height = Math.min(f.height, WALKABLE_SEAT);
    return f;
  };
  const foot = fit(x0, x1, y0, y1, !STAIRS.has(kind) && cells.every((c) => walkable(a, c)));
  const cellFeet = xy.map(([x, y], k) => fit(x, x, y, y, walkable(a, cells[k])));
  const facing = kind === 'chair' ? chairFacing(a, ids, xy)
    : kind === 'stairsUp' || kind === 'stairsDown' ? stairsFacing(a, ids, L, xy) : null;
  return {
    kind, cells, xy, floorY, foot, cellFeet, facing,
    colors: partColors(colorInfo(a), cells.map((c) => a.mt[c])),
    seed: hashCell(x0, y0, KIND_INDEX.get(kind)!),
  };
}
