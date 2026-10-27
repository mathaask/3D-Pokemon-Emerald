// What a cell of an in-scope interior is (Phase 4, D2): curated id tables, keyed by tileset, with an interaction-behaviour
// fallback, and no identity heuristics (pixels only decide colours). gTileset_Building, the interiors' primary, holds 8
// metatiles (0x000/0x001 the black void, 0x002/0x003 a TV, 0x004/0x005 a PC, 0x006/0x007 the exit mat); the rooms are
// drawn with the secondaries' ids (0x200–0x3FF), one table per in-scope secondary in `./interior/`. An id no table labels
// takes its behaviour's kind when that is an interaction behaviour (TV, PC, bookshelves, shop shelf, counter, trash can,
// vase, region map, arrow-warp mats); else it is unknown (null: the legacy art).

import { MB } from '../../../game/behaviors';
import { SYM } from '../../../game/symbols';
import { K, type MapAnalysis } from '../../overworld/analyze';
import { GENERIC_BUILDING } from './interior/genericBuilding';
import { POKEMON_CENTER } from './interior/pokemonCenter';
import { SHOP } from './interior/shop';
import { LAB } from './interior/lab';
import { BRENDANS_MAYS_HOUSE } from './interior/brendansMaysHouse';

export type FloorKind = 'boards' | 'tiles' | 'carpet' | 'rug' | 'mat';
export type WallPart = 'wall' | 'window' | 'decor' | 'clock';
export type FurnitureKind = 'bed' | 'table' | 'chair' | 'tv' | 'pc' | 'bookshelf' | 'plant' | 'fridge' | 'sink' | 'cabinet'
  | 'crate' | 'trashCan' | 'vase' | 'counter' | 'healer' | 'pcCounter' | 'martShelf' | 'stairsUp' | 'stairsDown';
/** A floor kind, a wall part, a furniture kind, or `legacy` (keep the GBA art). */
export type InteriorId = FloorKind | WallPart | FurnitureKind | 'legacy';

export const FLOOR_KINDS: readonly FloorKind[] = ['boards', 'tiles', 'carpet', 'rug', 'mat'];
export const WALL_PARTS: readonly WallPart[] = ['wall', 'window', 'decor', 'clock'];
/** In exactly the union's order above (Task 6's `isLow` test depends on it). */
export const FURNITURE_KINDS: readonly FurnitureKind[] = ['bed', 'table', 'chair', 'tv', 'pc', 'bookshelf', 'plant', 'fridge',
  'sink', 'cabinet', 'crate', 'trashCan', 'vase', 'counter', 'healer', 'pcCounter', 'martShelf', 'stairsUp', 'stairsDown'];

/** A pin: map-local cell (x, y) of map [group, num] must read as `id`. */
export interface TablePin { map: [number, number]; x: number; y: number; id: InteriorId }

/** One secondary tileset's labels: `ids` (512+ only), the share of its maps' in-map non-void cells the table (with the
 *  Building primary) must label (`target`), and pins read off its maps (tests/smoke/interiorTables.test.ts). */
export interface InteriorTable { name: string; ids: ReadonlyMap<number, InteriorId>; target: number; pins: readonly TablePin[] }

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

/** The in-scope secondaries' tables, keyed by tileset (ROM address; = `INTERIOR_TILESETS`). */
export const INTERIOR_TABLES: ReadonlyMap<number, InteriorTable> = new Map<number, InteriorTable>([
  [SYM.gTileset_GenericBuilding, GENERIC_BUILDING],
  [SYM.gTileset_PokemonCenter, POKEMON_CENTER],
  [SYM.gTileset_Shop, SHOP],
  [SYM.gTileset_Lab, LAB],
  [SYM.gTileset_BrendansMaysHouse, BRENDANS_MAYS_HOUSE],
]);

/** Secondary table (m ≥ 512), the Building primary (m < 512), else BEHAVIOR_IDS[beh]; null = unknown (legacy). */
export function interiorId(m: number, beh: number, secondary: number, tables: ReadonlyMap<number, InteriorTable> = INTERIOR_TABLES): InteriorId | null {
  const id = m >= 512 ? tables.get(secondary)?.ids.get(m) : BUILDING_PRIMARY.get(m);
  return id ?? BEHAVIOR_IDS.get(beh) ?? null;
}

const memo = new WeakMap<MapAnalysis, readonly (InteriorId | null)[]>();

/** Per analysis cell (void: null), memoised per analysis (a `WeakMap<MapAnalysis, …>`). The model families read their
 *  ids only through this. Meaningful on in-scope interiors only (`interiorScope`): ids below 512 are read as the
 *  Building primary's. */
export function interiorIds(a: MapAnalysis): readonly (InteriorId | null)[] {
  let ids = memo.get(a);
  if (!ids) {
    const secondary = a.opts.secondaryTileset ?? 0;
    const out = new Array<InteriorId | null>(a.N);
    for (let i = 0; i < a.N; i++) out[i] = a.kind[i] === K.Void ? null : interiorId(a.mt[i], a.beh[i], secondary);
    memo.set(a, ids = out);
  }
  return ids;
}

/** Test seam: makes `interiorIds(a)` return `ids` (fakeInterior's legend ids reach the families' extract this way). */
export function seedInteriorIds(a: MapAnalysis, ids: readonly (InteriorId | null)[]): void {
  memo.set(a, ids);
}
