// What a cell of an in-scope interior is (Phase 4, D2): curated id tables, keyed by tileset, with an interaction-behaviour
// fallback, and no identity heuristics (pixels only decide colours). gTileset_Building, the interiors' primary, holds 8
// metatiles (0x000/0x001 the black void, 0x002/0x003 a TV, 0x004/0x005 a PC, 0x006/0x007 the exit mat); the rooms are
// drawn with the secondaries' ids (0x200–0x3FF), one table per in-scope secondary in `./interior/`. An id no table labels
// takes its behaviour's kind when that is an interaction behaviour (TV, PC, bookshelves, shop shelf, counter, trash can,
// vase, region map, arrow-warp mats); else it is unknown (null: the legacy art).
//
// Phase 4b (D1/D2) adds 23 tables for the gyms, the League, the Hall of Fame, the town specials and the Trick House. Each
// lists its maps (`maps`: in scope while the 4b scope is on, scope.ts) and may belong to another primary (`primary`: the
// Bike Shop's General ids are labelled in its own `ids`). Its mechanic ids carry their meaning (`puzzle`: kind, state,
// variant, collision) and read as their kind whatever their state, so no family but `puzzle` sees a state; the cells
// whose states include a plain id are listed by position (`puzzleCells`, F4).
//
// Walkable cells (one rule for every table): a walkable cell takes the object's kind only where the object itself stands
// there in the game (a chair, a bed's head, stairs, mats); art that merely overhangs it (a shelf's top, a desk's legs) is
// the room's floor. A plant's walkable leaf cell may be either (GenericBuilding keeps `plant`, Lab labels `tiles`): both
// read the same, as the crown overhangs and the plant stands on its pot cell. Whatever the labels, furniture over a
// walkable cell stays at most WALKABLE_SEAT high and never spills onto free floor (tests/smoke/interiorFitting.test.ts).

import { MB } from '../../../game/behaviors';
import { SYM } from '../../../game/symbols';
import { K, type MapAnalysis } from '../../overworld/analyze';
import { GENERIC_BUILDING } from './interior/genericBuilding';
import { POKEMON_CENTER } from './interior/pokemonCenter';
import { SHOP } from './interior/shop';
import { LAB } from './interior/lab';
import { BRENDANS_MAYS_HOUSE } from './interior/brendansMaysHouse';
import { PETALBURG_GYM } from './interior/petalburgGym';
import { RUSTBORO_GYM } from './interior/rustboroGym';
import { DEWFORD_GYM } from './interior/dewfordGym';
import { MAUVILLE_GYM } from './interior/mauvilleGym';
import { LAVARIDGE_GYM } from './interior/lavaridgeGym';
import { FORTREE_GYM } from './interior/fortreeGym';
import { MOSSDEEP_GYM } from './interior/mossdeepGym';
import { SOOTOPOLIS_GYM } from './interior/sootopolisGym';
import { ELITE_FOUR } from './interior/eliteFour';
import { CABLE_CLUB } from './interior/cableClub';
import { TRICK_HOUSE_PUZZLE } from './interior/trickHousePuzzle';
import { OCEANIC_MUSEUM } from './interior/oceanicMuseum';
import { LILYCOVE_MUSEUM } from './interior/lilycoveMuseum';
import { FACILITY } from './interior/facility';
import { MAUVILLE_GAME_CORNER } from './interior/mauvilleGameCorner';
import { MOSSDEEP_GAME_CORNER } from './interior/mossdeepGameCorner';
import { BIKE_SHOP } from './interior/bikeShop';
import { POKEMON_FAN_CLUB } from './interior/pokemonFanClub';
import { POKEMON_SCHOOL } from './interior/pokemonSchool';
import { POKEMON_DAY_CARE } from './interior/pokemonDayCare';
import { SEASHORE_HOUSE } from './interior/seashoreHouse';
import { PRETTY_PETAL_FLOWER_SHOP } from './interior/prettyPetalFlowerShop';
import { MYSTERY_EVENTS_HOUSE } from './interior/mysteryEventsHouse';

/** Floor kinds. Phase 4b: `stone`, `ice` (slide ice, cosmetic HoF ice), `sand`, `metal`, `ledge` (a lip, no step: the
 *  outdoor model, F20) and `tier` (a raised platform's walkable top, at its real height: D13). */
export type FloorKind = 'boards' | 'tiles' | 'carpet' | 'rug' | 'mat' | 'stone' | 'ice' | 'sand' | 'metal' | 'ledge' | 'tier';
/** Wall parts. Phase 4b: framed `painting`s, `blackboard`s, maze walls and rock ridges (masses, D7) and `tierFace`. */
export type WallPart = 'wall' | 'window' | 'decor' | 'clock' | 'painting' | 'blackboard' | 'mazeWall' | 'ridge'
  | 'tierFace';                                  // a tier's face rows: a riser, never a mass (D13, F17)
export type FurnitureKind = 'bed' | 'table' | 'chair' | 'tv' | 'pc' | 'bookshelf' | 'plant' | 'fridge' | 'sink' | 'cabinet'
  | 'crate' | 'trashCan' | 'vase' | 'counter' | 'healer' | 'pcCounter' | 'martShelf' | 'stairsUp' | 'stairsDown'
  // Phase 4b: gym and League props, special-room furniture
  | 'statue' | 'pillar' | 'brazier' | 'dais' | 'displayCase' | 'fishTank' | 'modelShip' | 'plinth' | 'slotMachine'
  | 'rouletteTable' | 'schoolDesk' | 'flowerBin' | 'bikeRack' | 'machine';
/** A gym or Trick House mechanic (Phase 4b, D5). Every state of one reads as its kind (D2); only the `puzzle` family reads
 *  the state (`puzzleId`). Hidden stairs are a ramp between the tier heights in both states (F9). */
export type PuzzleKind = 'thinIce' | 'floorSwitch' | 'barrier' | 'arrowTile' | 'warpPad' | 'gymDoor' | 'toggleWall'
  | 'hiddenStairs' | 'geyserHole';
/** A floor kind, a wall part, a furniture kind, a mechanic, or `legacy` (keep the GBA art). */
export type InteriorId = FloorKind | WallPart | FurnitureKind | PuzzleKind | 'legacy';

/** Every member of a union, once: a key list checked against the union at compile time (a kind added to the union but
 *  not here, or a stray one, fails tsc). */
const keysOf = <T extends string>(r: Record<T, true>): readonly T[] => Object.keys(r) as T[];

// (each list in its union's order: new members appended at the end, F36)
export const FLOOR_KINDS: readonly FloorKind[] = keysOf<FloorKind>({ boards: true, tiles: true, carpet: true, rug: true, mat: true,
  stone: true, ice: true, sand: true, metal: true, ledge: true, tier: true });
export const WALL_PARTS: readonly WallPart[] = keysOf<WallPart>({ wall: true, window: true, decor: true, clock: true,
  painting: true, blackboard: true, mazeWall: true, ridge: true, tierFace: true });
/** In exactly the union's order above (Task 6's `isLow` test depends on it). */
export const FURNITURE_KINDS: readonly FurnitureKind[] = keysOf<FurnitureKind>({ bed: true, table: true, chair: true, tv: true,
  pc: true, bookshelf: true, plant: true, fridge: true, sink: true, cabinet: true, crate: true, trashCan: true, vase: true,
  counter: true, healer: true, pcCounter: true, martShelf: true, stairsUp: true, stairsDown: true,
  statue: true, pillar: true, brazier: true, dais: true, displayCase: true, fishTank: true, modelShip: true, plinth: true,
  slotMachine: true, rouletteTable: true, schoolDesk: true, flowerBin: true, bikeRack: true, machine: true });
export const PUZZLE_KINDS: readonly PuzzleKind[] = keysOf<PuzzleKind>({ thinIce: true, floorSwitch: true, barrier: true,
  arrowTile: true, warpPad: true, gymDoor: true, toggleWall: true, hiddenStairs: true, geyserHole: true });

/** A mechanic id's meaning: its kind, its state (0 … puzzleStateCount(kind) − 1) and a kind-specific variant
 *  (barrier: 0 pole, 1 beam H, 2 beam V; toggleWall: 0 red, 1 blue; arrowTile: state = direction 0 N, 1 E, 2 S, 3 W;
 *  gymDoor: state = slide frame, 0 closed … last open; thinIce: 0 intact, 1 cracked, 2 broken; floorSwitch: 0 raised,
 *  1 pressed; hiddenStairs: 0 hidden, 1 stairs; warpPad, geyserHole: state 0 only). `blocked`: the collision the game
 *  sets with this state (the decomp edit's TRUE/FALSE; F38). */
export interface PuzzleId { kind: PuzzleKind; state: number; variant: number; blocked: boolean }

const PUZZLE_STATES: Readonly<Record<PuzzleKind, number>> = {
  thinIce: 3, floorSwitch: 2, barrier: 2, arrowTile: 4,
  gymDoor: 6,                                    // closed + Petalburg's SlidingDoor_Frame0–4 (F33)
  toggleWall: 2, hiddenStairs: 2, warpPad: 1, geyserHole: 1,
};
/** How many states a mechanic of `kind` has (its ids' `PuzzleId.state` is below it). */
export function puzzleStateCount(kind: PuzzleKind): number {
  return PUZZLE_STATES[kind];
}

/** A mechanic cell found by position (F4): its kind and variant whatever id it shows, and `offId`, the plain
 *  (non-mechanic) id it shows in its off state (Mauville's V beams: METATILE_MauvilleGym_FloorTile), read as `offState`. */
export interface PuzzleCellPin { x: number; y: number; kind: PuzzleKind; variant: number; offId?: number; offState?: number }

/** A pin: map-local cell (x, y) of map [group, num] must read as `id`. */
export interface TablePin { map: [number, number]; x: number; y: number; id: InteriorId }

/** One secondary tileset's labels: `ids` (512+, and another primary's ids below 512: `primary`), the share of its maps'
 *  in-map non-void cells the table (with the Building primary) must label (`target`), and pins read off its maps
 *  (tests/smoke/interiorTables.test.ts). */
export interface InteriorTable {
  name: string; ids: ReadonlyMap<number, InteriorId>; target: number; pins: readonly TablePin[];
  /** The primary this table's ids < 512 belong to (default gTileset_Building, read from BUILDING_PRIMARY); another
   *  primary's ids the table uses are labelled in `ids` (BikeShop: gTileset_General). */
  primary?: number;
  /** The maps ("group.num") the table is in scope on (absent: every map of its tileset — Phase 4's five). */
  maps?: readonly string[];
  /** Mechanic ids → their meaning; every key is also in `ids`, labelled with its kind. */
  puzzle?: ReadonlyMap<number, PuzzleId>;
  /** Per map ("group.num"): mechanic cells by position whose states include a non-mechanic id, or whose variant
   *  changes (F4). `interiorIds` reads them as their kind whatever id they show. */
  puzzleCells?: Readonly<Record<string, readonly PuzzleCellPin[]>>;
}

/** gTileset_Building's ids (0x000/0x001, the black void, are K.Void). */
export const BUILDING_PRIMARY: ReadonlyMap<number, InteriorId> = new Map<number, InteriorId>([
  [0x002, 'tv'], [0x003, 'tv'], [0x004, 'pc'], [0x005, 'pc'], [0x006, 'mat'], [0x007, 'mat'],
]);

/** The interaction behaviours' kinds: what an id no table labels is, when its behaviour says so. */
export const BEHAVIOR_IDS: ReadonlyMap<number, InteriorId> = new Map<number, InteriorId>([
  [MB.TELEVISION, 'tv'], [MB.PC, 'pc'],
  [MB.PICTURE_BOOK_SHELF, 'bookshelf'], [MB.BOOKSHELF, 'bookshelf'], [MB.POKEMON_CENTER_BOOKSHELF, 'bookshelf'],
  [MB.SHOP_SHELF, 'martShelf'], [MB.COUNTER, 'counter'], [MB.TRASH_CAN, 'trashCan'], [MB.VASE, 'vase'],
  [MB.REGION_MAP, 'decor'],
  [MB.SOUTH_ARROW_WARP, 'mat'], [MB.NORTH_ARROW_WARP, 'mat'], [MB.EAST_ARROW_WARP, 'mat'], [MB.WEST_ARROW_WARP, 'mat'],
]);

/** The in-scope secondaries' tables, keyed by tileset (ROM address): Phase 4's five (= `INTERIOR_TILESETS`: every map of
 *  their tileset), then Phase 4b's 23 (D2: their `maps` only, in scope while the 4b scope is on, scope.ts). */
export const INTERIOR_TABLES: ReadonlyMap<number, InteriorTable> = new Map<number, InteriorTable>([
  [SYM.gTileset_GenericBuilding, GENERIC_BUILDING],
  [SYM.gTileset_PokemonCenter, POKEMON_CENTER],
  [SYM.gTileset_Shop, SHOP],
  [SYM.gTileset_Lab, LAB],
  [SYM.gTileset_BrendansMaysHouse, BRENDANS_MAYS_HOUSE],
  // Phase 4b: the gyms
  [SYM.gTileset_PetalburgGym, PETALBURG_GYM],
  [SYM.gTileset_RustboroGym, RUSTBORO_GYM],
  [SYM.gTileset_DewfordGym, DEWFORD_GYM],
  [SYM.gTileset_MauvilleGym, MAUVILLE_GYM],
  [SYM.gTileset_LavaridgeGym, LAVARIDGE_GYM],
  [SYM.gTileset_FortreeGym, FORTREE_GYM],
  [SYM.gTileset_MossdeepGym, MOSSDEEP_GYM],
  [SYM.gTileset_SootopolisGym, SOOTOPOLIS_GYM],
  // the League, the Hall of Fame (CableClub: 16.11 only, not the link rooms) and the Trick House
  [SYM.gTileset_EliteFour, ELITE_FOUR],
  [SYM.gTileset_CableClub, CABLE_CLUB],
  [SYM.gTileset_TrickHousePuzzle, TRICK_HOUSE_PUZZLE],
  // the town specials
  [SYM.gTileset_OceanicMuseum, OCEANIC_MUSEUM],
  [SYM.gTileset_LilycoveMuseum, LILYCOVE_MUSEUM],
  [SYM.gTileset_Facility, FACILITY],
  [SYM.gTileset_MauvilleGameCorner, MAUVILLE_GAME_CORNER],
  [SYM.gTileset_MossdeepGameCorner, MOSSDEEP_GAME_CORNER],
  [SYM.gTileset_BikeShop, BIKE_SHOP],
  [SYM.gTileset_PokemonFanClub, POKEMON_FAN_CLUB],
  [SYM.gTileset_PokemonSchool, POKEMON_SCHOOL],
  [SYM.gTileset_PokemonDayCare, POKEMON_DAY_CARE],
  [SYM.gTileset_SeashoreHouse, SEASHORE_HOUSE],
  [SYM.gTileset_PrettyPetalFlowerShop, PRETTY_PETAL_FLOWER_SHOP],
  [SYM.gTileset_MysteryEventsHouse, MYSTERY_EVENTS_HOUSE],
]);

/** Secondary table (m ≥ 512); below 512 the Building primary (`primary` gTileset_Building, the default), or on another
 *  primary the table's own `ids` when the table is of that primary (BikeShop: General); else BEHAVIOR_IDS[beh]; null =
 *  unknown (legacy). A mechanic id reads as its kind, whatever its state (D2). */
export function interiorId(m: number, beh: number, secondary: number, tables: ReadonlyMap<number, InteriorTable> = INTERIOR_TABLES,
  primary: number = SYM.gTileset_Building): InteriorId | null {
  let id: InteriorId | undefined;
  if (m >= 512) id = tables.get(secondary)?.ids.get(m);
  else if (primary === SYM.gTileset_Building) id = BUILDING_PRIMARY.get(m);
  else {
    const t = tables.get(secondary);
    if (t && (t.primary ?? SYM.gTileset_Building) === primary) id = t.ids.get(m);
  }
  return id ?? BEHAVIOR_IDS.get(beh) ?? null;
}

/** The mechanic meaning of metatile m on a map of `secondary` (null: none). Only the `puzzle` family reads states. */
export function puzzleId(m: number, secondary: number, tables: ReadonlyMap<number, InteriorTable> = INTERIOR_TABLES): PuzzleId | null {
  return tables.get(secondary)?.puzzle?.get(m) ?? null;
}

/** The un-memoised core of `interiorIds`: per analysis cell (void: null) its id from `tables`, read with the analysis'
 *  primary (`a.opts.primaryTileset`, default gTileset_Building); on map `mapKey`, the table's `puzzleCells[mapKey]`
 *  (map-local, non-void) read as their kind whatever id they show (F4). */
export function interiorIdsWith(a: MapAnalysis, tables: ReadonlyMap<number, InteriorTable>, mapKey?: string): (InteriorId | null)[] {
  const secondary = a.opts.secondaryTileset ?? 0, primary = a.opts.primaryTileset ?? SYM.gTileset_Building;
  const out = new Array<InteriorId | null>(a.N);
  for (let i = 0; i < a.N; i++) out[i] = a.kind[i] === K.Void ? null : interiorId(a.mt[i], a.beh[i], secondary, tables, primary);
  const pins = mapKey !== undefined ? tables.get(secondary)?.puzzleCells?.[mapKey] : undefined;
  for (const p of pins ?? []) {
    if (!a.inside(p.x, p.y)) continue;
    const i = a.idx(p.x, p.y);
    if (a.kind[i] !== K.Void) out[i] = p.kind;
  }
  return out;
}

/** The memo: per analysis, its ids and the map key they were read for (`seeded`: the test seam's, served for any key). */
interface Memo { ids: readonly (InteriorId | null)[]; mapKey: string | undefined; seeded: boolean }
const memo = new WeakMap<MapAnalysis, Memo>();

/** Per analysis cell (void: null), memoised per analysis (a `WeakMap<MapAnalysis, …>`). The model families read their
 *  ids only through this, passing `ctx.mapKey` (a map's position-listed mechanic cells, F4). Meaningful on in-scope
 *  interiors only (`interiorScope`): ids below 512 are read as the analysis' primary's. A call without a map key is served
 *  whatever the memo holds; a call with a map key other than the memo's reads the ids again (and memoises them). */
export function interiorIds(a: MapAnalysis, mapKey?: string): readonly (InteriorId | null)[] {
  const m = memo.get(a);
  if (m && (m.seeded || mapKey === undefined || m.mapKey === mapKey)) return m.ids;
  const ids = interiorIdsWith(a, INTERIOR_TABLES, mapKey);
  memo.set(a, { ids, mapKey, seeded: false });
  return ids;
}

/** Test seam: makes `interiorIds(a)` return `ids` (fakeInterior's legend ids reach the families' extract this way); `ids`
 *  must have one entry per analysis cell (a.N), else it throws. */
export function seedInteriorIds(a: MapAnalysis, ids: readonly (InteriorId | null)[]): void {
  if (ids.length !== a.N) throw new Error(`seedInteriorIds: ${ids.length} ids for an analysis of ${a.N} cells (length mismatch)`);
  memo.set(a, { ids, mapKey: undefined, seeded: true });
}
