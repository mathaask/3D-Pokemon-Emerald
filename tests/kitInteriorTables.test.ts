// Interior id tables (Phase 4 Task 3): the Building primary's ids, the behaviour fallback, the per-secondary
// table scaffold, the analysis memo's test seam and the interior scope.
import { describe, it, expect } from 'vitest';
import {
  interiorId, interiorIds, interiorIdsWith, seedInteriorIds, puzzleId, puzzleStateCount, BUILDING_PRIMARY, BEHAVIOR_IDS,
  INTERIOR_TABLES, FURNITURE_KINDS, FLOOR_KINDS, WALL_PARTS, PUZZLE_KINDS, type InteriorId, type InteriorTable,
} from '../src/render/kit/tables/building';
import { fakeAnalysis } from './helpers/fakeMap';
import { fakeInterior } from './helpers/fakeInterior';
import {
  interiorScope, mapProfile, setPhase4bScope, themeOf, DEFAULT_PROFILE, INTERIOR_TILESETS, PHASE4B_DEFAULT, PHASE4B_MAPS,
  THEME_LIGHT,
} from '../src/render/kit/interior/scope';
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
  it('has one table per in-scope tileset, labelling its own tileset ids with known ids only', () => {
    // Phase 4's five (every map of their tileset) plus Phase 4b's 23 (their listed maps only)
    const p4 = [...INTERIOR_TABLES].filter(([, t]) => !t.maps).map(([k]) => k);
    expect(p4.sort()).toEqual([...INTERIOR_TILESETS].sort());
    expect(INTERIOR_TABLES.size).toBe(5 + 23);
    const known = new Set<string>([...FURNITURE_KINDS, ...FLOOR_KINDS, ...WALL_PARTS, ...PUZZLE_KINDS, 'legacy']);
    for (const t of INTERIOR_TABLES.values()) for (const [m, id] of t.ids) {
      // (ids below 512 only in a table of another primary: BikeShop's General ids)
      const own = m >= 0x200 || (t.primary !== undefined && t.primary !== SYM.gTileset_Building);
      expect(own && m < 0x400, `${t.name} 0x${m.toString(16)}`).toBe(true); expect(known.has(id)).toBe(true);
    }
  });
  it('lists the new kinds after Phase 4 ones, in union order', () => {
    expect(FURNITURE_KINDS.slice(0, 19)).toEqual(['bed', 'table', 'chair', 'tv', 'pc', 'bookshelf', 'plant', 'fridge', 'sink',
      'cabinet', 'crate', 'trashCan', 'vase', 'counter', 'healer', 'pcCounter', 'martShelf', 'stairsUp', 'stairsDown']);
    expect(FURNITURE_KINDS.slice(19)).toEqual(['statue', 'pillar', 'brazier', 'dais', 'displayCase', 'fishTank', 'modelShip',
      'plinth', 'slotMachine', 'rouletteTable', 'schoolDesk', 'flowerBin', 'bikeRack', 'machine']);
    expect(PUZZLE_KINDS).toEqual(['thinIce', 'floorSwitch', 'barrier', 'arrowTile', 'warpPad', 'gymDoor', 'toggleWall',
      'hiddenStairs', 'geyserHole']);
    // (F1/F9/F17: tier tops are a floor kind, their face rows a wall part — a riser, never a mass; hidden stairs a mechanic)
    expect(FLOOR_KINDS).toEqual(['boards', 'tiles', 'carpet', 'rug', 'mat', 'stone', 'ice', 'sand', 'metal', 'ledge', 'tier']);
    expect(WALL_PARTS).toEqual(['wall', 'window', 'decor', 'clock', 'painting', 'blackboard', 'mazeWall', 'ridge', 'tierFace']);
  });
  it('reads another primary through the table and mechanic ids state-free', () => {
    const t: InteriorTable = { name: 'fake', target: 0, pins: [], primary: SYM.gTileset_General,
      ids: new Map<number, InteriorId>([[0x0a0, 'boards'], [0x220, 'thinIce'], [0x221, 'thinIce']]),
      puzzle: new Map([[0x220, { kind: 'thinIce', state: 0, variant: 0, blocked: false }], [0x221, { kind: 'thinIce', state: 1, variant: 0, blocked: false }]]) };
    const tables = new Map([[0xdead, t]]);
    expect(interiorId(0x0a0, MB.NORMAL, 0xdead, tables, SYM.gTileset_General)).toBe('boards');
    expect(interiorId(0x0a0, MB.NORMAL, 0xdead, tables)).toBeNull();            // Building primary: not labelled
    expect(interiorId(0x002, MB.NORMAL, 0xdead, tables, SYM.gTileset_General)).toBeNull();   // (not the Building's TV there)
    expect(interiorId(0x221, MB.NORMAL, 0xdead, tables)).toBe('thinIce');
    expect(puzzleId(0x221, 0xdead, tables)).toEqual({ kind: 'thinIce', state: 1, variant: 0, blocked: false });
    expect(puzzleId(0x0a0, 0xdead, tables)).toBeNull();
    expect(puzzleId(0x221, 0xbeef, tables)).toBeNull();
  });
  it('gives each puzzle kind its state count', () => {
    expect(PUZZLE_KINDS.map(puzzleStateCount)).toEqual([3, 2, 2, 4, 1, 6, 2, 2, 1]);
  });
  it('labels every mechanic id with its kind, within its state count', () => {
    for (const t of INTERIOR_TABLES.values()) for (const [m, p] of t.puzzle ?? []) {
      expect(t.ids.get(m)).toBe(p.kind);
      expect(p.state).toBeLessThan(puzzleStateCount(p.kind));
    }
  });
  it('gives the 23 new tables their maps and primary (D1/D2)', () => {
    const listed = [...INTERIOR_TABLES.values()].flatMap((t) => t.maps ?? []);
    expect(listed.sort()).toEqual([...PHASE4B_MAPS.keys()].sort());     // each 4b map on exactly one table
    expect(INTERIOR_TABLES.get(SYM.gTileset_BikeShop)?.primary).toBe(SYM.gTileset_General);
    expect(INTERIOR_TABLES.get(SYM.gTileset_CableClub)?.maps).toEqual(['16.11']);           // the Hall of Fame only
    expect(INTERIOR_TABLES.get(SYM.gTileset_Facility)?.maps).toEqual(['11.0', '11.2']);      // Devon 1F / 3F
  });
  it('scopes the 4b maps only when switched on, by profile', () => {
    const sootopolis = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_SootopolisGym };
    setPhase4bScope(false); expect(interiorScope(sootopolis, '15.0')).toBe(false);
    setPhase4bScope(true);
    expect(interiorScope(sootopolis, '15.0')).toBe(true);
    expect(interiorScope(sootopolis, '15.2')).toBe(false);                      // not a listed map
    expect(interiorScope({ ...sootopolis, secondaryTileset: SYM.gTileset_CableClub }, '25.25')).toBe(false); // link room
    expect(interiorScope({ ...sootopolis, primaryTileset: SYM.gTileset_General }, '15.0')).toBe(false);      // not the table's primary
    expect(interiorScope({ ...sootopolis, secondaryTileset: SYM.gTileset_EliteFour }, '15.0')).toBe(false);  // its table does not list it
    expect(interiorScope({ ...sootopolis, indoor: false }, '15.0')).toBe(false);
    expect(interiorScope(sootopolis, null)).toBe(false);
    const bikeShop = { indoor: true, primaryTileset: SYM.gTileset_General, secondaryTileset: SYM.gTileset_BikeShop };
    expect(interiorScope(bikeShop, '10.1')).toBe(true);
    expect(interiorScope(bikeShop, '24.53')).toBe(false);                       // New Mauville: the same tileset, not listed
    expect(mapProfile('15.0')).toMatchObject({ shell: 'perimeter', puzzle: true, tiers: true });
    expect(mapProfile('16.3')).toMatchObject({ shell: 'band', theme: 'drake', puzzle: false });
    expect(mapProfile('2.2')).toEqual(DEFAULT_PROFILE);
    expect(mapProfile(null)).toEqual(DEFAULT_PROFILE);
    expect(PHASE4B_MAPS.size).toBe(45);
    expect(themeOf('16.3')).toBe('drake'); expect(THEME_LIGHT.drake).toEqual([1.0, 0.55, 0.2]);   // F21
    setPhase4bScope(PHASE4B_DEFAULT);
  });
  it('profiles the 4b maps as D8 says', () => {
    const where = (f: (k: string) => boolean) => [...PHASE4B_MAPS.keys()].filter(f).sort();
    expect(where((k) => mapProfile(k).shell === 'perimeter')).toEqual(['12.1', '14.11', '15.0', '15.1', '3.3']);
    expect(where((k) => mapProfile(k).tiers)).toEqual(['15.0', '15.1']);
    expect(where((k) => mapProfile(k).puzzle)).toEqual(['10.0', '11.3', '12.1', '14.0', '15.0', '15.1', '29.10', '29.3', '29.4',
      '29.5', '29.6', '29.7', '29.8', '29.9', '3.3', '4.1', '4.2', '8.1']);
    expect([...PHASE4B_MAPS.values()].every((p) => p.bandMax === 3)).toBe(true);
    expect(['16.0', '16.1', '16.2', '16.4', '16.5', '16.9', '16.11', '16.10', '8.1'].map(themeOf))
      .toEqual(['sidney', 'phoebe', 'glacia', 'champion', 'hall', 'hall', 'hallOfFame', null, null]);
    expect(Object.keys(THEME_LIGHT).sort()).toEqual(['champion', 'drake', 'glacia', 'hall', 'hallOfFame', 'phoebe', 'sidney']);
  });
  it('keeps the 4b scope off by default (Task 7 switches it on)', () => {
    expect(PHASE4B_DEFAULT).toBe(false);
    const o = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_PetalburgGym };
    expect(interiorScope(o, '8.1')).toBe(false);
  });
  it('labels position-listed mechanic cells with their kind whatever id they show (F4)', () => {
    // a fake table with a puzzleCells pin whose off state shows a plain floor id
    const { a } = fakeInterior(['     ', ' WWW ', ' ... ', '     ']);
    const t: InteriorTable = { name: 'fake', target: 0, pins: [], ids: new Map(), puzzle: new Map(),
      puzzleCells: { '9.9': [{ x: 2, y: 2, kind: 'barrier', variant: 2, offId: 0x205, offState: 0 }] } };
    const tables = new Map([[a.opts.secondaryTileset ?? 0, t]]);
    expect(interiorIdsWith(a, tables, '9.9')[a.idx(2, 2)]).toBe('barrier');
    expect(interiorIdsWith(a, tables, '9.8')[a.idx(2, 2)]).toBeNull();          // another map: not listed there
    expect(interiorIdsWith(a, tables)[a.idx(3, 2)]).toBeNull();
  });
  it('memoises the ids per analysis, read again for another map key', () => {
    const a = fakeAnalysis(['..', '..']);
    const first = interiorIds(a, '9.9');
    expect(interiorIds(a, '9.9')).toBe(first); expect(interiorIds(a)).toBe(first);   // (no key: whatever the memo holds)
    const other = interiorIds(a, '9.8');
    expect(other).not.toBe(first); expect(other).toEqual(first);
  });
  it('serves seeded ids for an analysis', () => {
    const a = fakeAnalysis(['..', '..']), ids = ['rug', null, 'table', 'mat'] as const;
    const seeded = Array.from({ length: a.N }, (_, i) => ids[i % 4]);
    seedInteriorIds(a, seeded);
    expect(interiorIds(a)).toBe(seeded);
    // (a seed of another analysis's size — a fake built with another margin — fails loudly, never reads undefined)
    expect(() => seedInteriorIds(a, seeded.slice(1))).toThrow(/length/);
  });
  it('scopes interiors', () => {
    const o = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_PokemonCenter };
    expect(interiorScope(o, '2.2')).toBe(true);
    expect(interiorScope({ ...o, indoor: false }, '2.2')).toBe(false);
    expect(interiorScope({ ...o, secondaryTileset: 0 }, '2.2')).toBe(false);
    expect(interiorScope({ ...o, primaryTileset: SYM.gTileset_General }, '2.2')).toBe(false);
  });
  it('leaves the Department Store rooftop out (an open-air roof on the Shop tileset)', () => {
    const o = { indoor: true, primaryTileset: SYM.gTileset_Building, secondaryTileset: SYM.gTileset_Shop };
    expect(interiorScope(o, '13.21')).toBe(false);
    expect(interiorScope(o, '13.20')).toBe(true);                  // the Dept Store's 5F
    expect(interiorScope(o, null)).toBe(false);                    // (no map key: fails closed — the exclusion always holds)
  });
});

describe('BrendansMaysHouse runtime-only ids', () => {
  it('labels the intro moving boxes (set at runtime, absent from the static maps) as crates', async () => {
    const { BRENDANS_MAYS_HOUSE } = await import('../src/render/kit/tables/interior/brendansMaysHouse');
    expect(BRENDANS_MAYS_HOUSE.ids.get(0x268)).toBe('crate');
    expect(BRENDANS_MAYS_HOUSE.ids.get(0x270)).toBe('crate');
  });
});
