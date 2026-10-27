// Interior id tables (Phase 4 Task 3): the Building primary's ids, the behaviour fallback, the per-secondary
// table scaffold, the analysis memo's test seam and the interior scope.
import { describe, it, expect } from 'vitest';
import { interiorId, interiorIds, seedInteriorIds, BUILDING_PRIMARY, BEHAVIOR_IDS, INTERIOR_TABLES, FURNITURE_KINDS, FLOOR_KINDS, WALL_PARTS, type InteriorTable } from '../src/render/kit/tables/building';
import { fakeAnalysis } from './helpers/fakeMap';
import { interiorScope, INTERIOR_TILESETS } from '../src/render/kit/interior/scope';
import { MB } from '../src/game/behaviors';
import { SYM } from '../src/game/symbols';

describe('interior id tables', () => {
  it('labels the Building primary tileset', () => {
    expect([0x002, 0x003, 0x004, 0x005, 0x006, 0x007].map((m) => BUILDING_PRIMARY.get(m))).toEqual(['tv', 'tv', 'pc', 'pc', 'mat', 'mat']);
    expect(BUILDING_PRIMARY.has(0x001)).toBe(false);                 // the black void: K.Void
  });
  it('looks an id up in the secondary table, the primary, then by behaviour', () => {
    const t: InteriorTable = { name: 'fake', ids: new Map([[0x210, 'rug']]), target: 0, pins: [] };
    const tables = new Map([[0xdead, t]]);
    expect(interiorId(0x210, MB.NORMAL, 0xdead, tables)).toBe('rug');
    expect(interiorId(0x002, MB.NORMAL, 0xdead, tables)).toBe('tv');
    expect(interiorId(0x211, MB.BOOKSHELF, 0xdead, tables)).toBe('bookshelf');
    expect(interiorId(0x211, MB.NORMAL, 0xdead, tables)).toBeNull();
    expect(interiorId(0x210, MB.NORMAL, 0xbeef, tables)).toBeNull();
  });
  it('maps the interaction behaviours', () => {
    expect([MB.SHOP_SHELF, MB.PICTURE_BOOK_SHELF, MB.POKEMON_CENTER_BOOKSHELF, MB.COUNTER, MB.REGION_MAP, MB.SOUTH_ARROW_WARP]
      .map((b) => BEHAVIOR_IDS.get(b))).toEqual(['martShelf', 'bookshelf', 'bookshelf', 'counter', 'decor', 'mat']);
  });
  it('has one table per in-scope tileset, labelling secondary ids with known ids only', () => {
    expect([...INTERIOR_TABLES.keys()].sort()).toEqual([...INTERIOR_TILESETS].sort());
    const known = new Set<string>([...FURNITURE_KINDS, ...FLOOR_KINDS, ...WALL_PARTS, 'legacy']);
    for (const t of INTERIOR_TABLES.values()) for (const [m, id] of t.ids) {
      expect(m >= 0x200 && m < 0x400).toBe(true); expect(known.has(id)).toBe(true);
    }
  });
  it('lists the furniture kinds in the union order', () => {
    expect(FURNITURE_KINDS).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'bookshelf', 'plant', 'fridge', 'sink', 'cabinet',
      'crate', 'trashCan', 'vase', 'counter', 'healer', 'pcCounter', 'martShelf', 'stairsUp', 'stairsDown']);
  });
  it('serves seeded ids for an analysis', () => {
    const a = fakeAnalysis(['..', '..']), ids = ['rug', null, 'table', 'mat'] as const;
    const seeded = Array.from({ length: a.N }, (_, i) => ids[i % 4]);
    seedInteriorIds(a, seeded);
    expect(interiorIds(a)).toBe(seeded);
  });
  it('scopes interiors', () => {
    const o = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_PokemonCenter };
    expect(interiorScope(o)).toBe(true);
    expect(interiorScope({ ...o, indoor: false })).toBe(false);
    expect(interiorScope({ ...o, secondaryTileset: 0 })).toBe(false);
    expect(interiorScope({ ...o, primaryTileset: SYM.gTileset_General })).toBe(false);
  });
});
