// Interior room layout (Phase 4 Task 5): the wall-art band, the back line, wall runs, wall art features and door gaps.
import { describe, it, expect } from 'vitest';
import {
  roomLayout, checkRoomLayout, windowRect, bandRect, mergeSpans, RECESS, WALL_H, WALL_SPAN,
} from '../src/render/kit/interior/room';
import { roomFloorHeights } from '../src/render/kit/interior/geom/floorPatterns';
import { interiorIds } from '../src/render/kit/tables/building';
import { fakeInterior } from './helpers/fakeInterior';
const HOUSE = [
  '          ',
  ' WWOOWWWW ',
  ' WWOOWFWW ',
  ' ........ ',
  ' ..TT.... ',
  ' ..TT..rr ',
  ' ......rr ',
  ' ....M... ',
  '          ',
];
const runs = (L: ReturnType<typeof roomLayout>, d: string) => L.runs.filter((r) => r.dir === d);
describe('room layout', () => {
  it('closes a rectangular room: back wall in the recess, sides, front, a door, a window', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const L = roomLayout(a, ids, [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
    expect(L.rooms).toBe(1);
    expect(runs(L, 'N')).toEqual([{ dir: 'N', line: 3 - RECESS, from: 1, to: 9, floorY: 0 }]);
    expect(runs(L, 'S')).toEqual([{ dir: 'S', line: 8, from: 1, to: 9, floorY: 0 }]);
    expect(runs(L, 'W')).toEqual([{ dir: 'W', line: 1, from: 3 - RECESS, to: 8, floorY: 0 }]);
    expect(runs(L, 'E')).toEqual([{ dir: 'E', line: 9, from: 3 - RECESS, to: 8, floorY: 0 }]);
    expect(L.doors).toEqual([{ dir: 'S', line: 8, from: 5, to: 6 }]);
    expect(L.features).toEqual([expect.objectContaining({ kind: 'window', x0: 3, x1: 5, row0: 0, row1: 1, rows: 2 })]);
    const w = windowRect(L, L.features[0]);
    expect(w.x0).toBeCloseTo(3.15, 5); expect(w.x1).toBeCloseTo(4.85, 5); expect(w.y0).toBeCloseTo(0.2, 5);
    expect(w.y1).toBeCloseTo(0.2 + WALL_H - 0.5, 5); expect(w.z).toBeCloseTo(3 - RECESS, 5);
    expect(L.band[a.idx(6, 2)]).toBe(1);            // the fridge stands in the band (furniture claims it first)
    expect(L.inside[a.idx(3, 4)]).toBe(1);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('opens an alcove where stairs cut the back wall', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWSWW ', ' WWWWWSWW ', ' ........ ', ' ........ ', '          ']);
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to])).toEqual([[3 - RECESS, 1, 6], [1 - RECESS, 6, 7], [3 - RECESS, 7, 9]]);
    expect(runs(L, 'W')).toContainEqual({ dir: 'W', line: 6, from: 1 - RECESS, to: 3 - RECESS, floorY: 0 });
    expect(runs(L, 'E')).toContainEqual({ dir: 'E', line: 7, from: 1 - RECESS, to: 3 - RECESS, floorY: 0 });
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('keeps the back wall straight over a bookshelf running below the band', () => {
    const { a, ids } = fakeInterior(['        ', ' WWBWW ', ' WWBWW ', ' ..B.. ', ' ..... ', '        '].map((r) => r.padEnd(8)));
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N')).toHaveLength(1);           // column 3's band is one row deeper than the mode: furniture → the mode
    expect(L.inside[a.idx(3, 3)]).toBe(1);          // the shelf's lower row is room (furniture on the floor)
  });
  it('steps the back wall forward where wall art runs deeper than the band', () => {
    const { a, ids } = fakeInterior(['       ', ' WWWWW ', ' WWOWW ', ' ..O.. ', ' ..... ', '       ']);
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to])).toEqual([[3 - RECESS, 1, 3], [4 - RECESS, 3, 4], [3 - RECESS, 4, 6]]);
    expect(L.band[a.idx(3, 3)]).toBe(1);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('cuts a door into a side wall for an arrow-warp mat', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' .....E ', ' ...... ', '        ']);
    const L = roomLayout(a, ids, [{ x: 6, y: 2, dest: 'ROUTE_110' }]);
    expect(L.doors).toEqual([{ dir: 'E', line: 7, from: 2, to: 3 }]);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('separates two rooms divided by void', () => {
    const { a, ids } = fakeInterior(['         ', ' WWW WWW ', ' ... ... ', ' ... ... ', '         ']);
    const L = roomLayout(a, ids, []);
    expect(L.rooms).toBe(2);
    expect(runs(L, 'N')).toHaveLength(2);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });

  // F8, the opposite of the bookshelf: a plain wall row below the mode is wall art, so the column keeps its own back line.
  it('steps the back wall forward where a plain wall row runs below the band', () => {
    const { a, ids } = fakeInterior(['       ', ' WWWWW ', ' WWWWW ', ' ..W.. ', ' ..... ', '       ']);
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to])).toEqual([[3 - RECESS, 1, 3], [4 - RECESS, 3, 4], [3 - RECESS, 4, 6]]);
    expect(L.band[a.idx(3, 3)]).toBe(1);
    expect(L.inside[a.idx(3, 3)]).toBe(0);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('merges adjacent mats into one door and reads the back line per column', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' ...... ', ' ..MM.. ', '        ']);
    const L = roomLayout(a, ids, [{ x: 3, y: 3, dest: 'X' }, { x: 4, y: 3, dest: 'X' }]);
    expect(L.doors).toEqual([{ dir: 'S', line: 4, from: 3, to: 5 }]);
    expect(L.backLine[3 - a.minX]).toBe(2);
    expect(L.backLine[0 - a.minX]).toBe(-1);
    expect(L.floorTile).toBe(0x205);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  // Brendan's / May's house 1F: windows in the band's top row hang high on the wall (row 0 is the band's top).
  it('puts a top-row window at the top of the wall and a bottom-row one below it', () => {
    const { a, ids } = fakeInterior(['         ', ' WOWWWWW ', ' WWWWOWW ', ' ....... ', '         ']);
    const L = roomLayout(a, ids, []);
    const [hi, lo] = L.features.map((f) => windowRect(L, f));
    const span = WALL_H - 0.5;
    expect(L.features.map((f) => [f.x0, f.row0, f.row1, f.rows])).toEqual([[2, 0, 0, 2], [5, 1, 1, 2]]);
    expect(hi.y0).toBeCloseTo(0.2 + span / 2, 5); expect(hi.y1).toBeCloseTo(WALL_H - 0.3, 5);
    expect(lo.y0).toBeCloseTo(0.2, 5); expect(lo.y1).toBeCloseTo(0.2 + span / 2, 5);
  });
  it('groups wall art by id and row-run, merged downward', () => {
    const { a, ids } = fakeInterior(['         ', ' WCWDDWW ', ' WCWDDWW ', ' ....... ', '         ']);
    const L = roomLayout(a, ids, []);
    expect(L.features).toEqual([
      expect.objectContaining({ kind: 'clock', x0: 2, x1: 3, row0: 0, row1: 1, rows: 2 }),
      expect.objectContaining({ kind: 'decor', x0: 4, x1: 6, row0: 0, row1: 1, rows: 2 }),
    ]);
  });
  // Sootopolis' houses: floor blocks of metatile 0x3FF read as the border (void) by the classifier are still room.
  it('keeps metatile-0x3FF floor blocks in the room', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' WWWWWW ', ' ______ ', ' _..... ', ' _..M.. ', '        ']);
    expect(a.real3ff[a.idx(1, 3)]).toBe(1);
    expect(a.kind[a.idx(1, 3)]).toBe(0);            // K.Void: today's look is kept
    const L = roomLayout(a, ids, [{ x: 4, y: 5, dest: 'X' }]);
    expect(L.rooms).toBe(1);
    expect(L.inside[a.idx(1, 3)]).toBe(1);
    expect(L.inside[a.idx(3, 3)]).toBe(1);
    expect(runs(L, 'N')).toEqual([{ dir: 'N', line: 3 - RECESS, from: 1, to: 7, floorY: 0 }]);
    expect(runs(L, 'W')).toEqual([{ dir: 'W', line: 1, from: 3 - RECESS, to: 6, floorY: 0 }]);
    expect(L.floorTile).toBe(0x205);                // never the border's metatile
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  // The Weather Institute: a dividing wall across the room (wall rows under room rows), pillars in it and above it.
  it('closes both sides of a dividing wall and leaves pillars to the room', () => {
    const { a, ids } = fakeInterior([
      '          ',
      ' WWPWWWWW ',
      ' WWPWWWWW ',
      ' ..P..... ',
      ' ..P..... ',
      ' WWP..WWW ',
      ' WWP..WWW ',
      ' ........ ',
      ' ....M... ',
      '          ',
    ], { P: { mt: 0x210, blocked: true, id: 'legacy' } });
    const warps = [{ x: 5, y: 8, dest: 'X' }];
    const L = roomLayout(a, ids, warps);
    expect(L.rooms).toBe(1);
    expect(L.band[a.idx(1, 5)]).toBe(1); expect(L.band[a.idx(7, 6)]).toBe(1);
    expect(L.partition[a.idx(1, 5)]).toBe(1); expect(L.partition[a.idx(1, 2)]).toBe(0);
    expect(L.inside[a.idx(3, 3)]).toBe(1);          // the pillar is no back wall
    expect(L.inside[a.idx(3, 5)]).toBe(1);          // nor a dividing wall
    // the partition's faces on its cells' outline: S 5 (the room north of it), N 7 (the room south of it, no recess)
    expect(runs(L, 'S').map((r) => [r.line, r.from, r.to, !!r.partition])).toEqual([[5, 1, 3, true], [9, 1, 9, false], [5, 6, 9, true]]);
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to, !!r.partition])).toEqual([[3 - RECESS, 1, 9, false], [7, 1, 3, true], [7, 6, 9, true]]);
    expect(runs(L, 'E')).toContainEqual({ dir: 'E', line: 6, from: 5, to: 7, floorY: 0, partition: true });   // the opening's east side
    expect(runs(L, 'W')).toContainEqual({ dir: 'W', line: 3, from: 5, to: 7, floorY: 0, partition: true });   // the pillar's west side
    expect(checkRoomLayout(a, L, warps)).toEqual([]);
  });
  // Dewford Hall, Wanda's house, Rustboro's flats: a north–south partition standing in the room from the back wall.
  it('walls a north–south partition on both sides', () => {
    const { a, ids } = fakeInterior([
      '          ',
      ' WWWWWWWW ',
      ' WWWWWWWW ',
      ' ...W.... ',
      ' ...W.... ',
      ' ...W.... ',
      ' ........ ',
      ' ....M... ',
      '          ',
    ]);
    const warps = [{ x: 5, y: 7, dest: 'X' }];
    const L = roomLayout(a, ids, warps);
    for (let y = 3; y <= 5; y++) { expect(L.inside[a.idx(4, y)]).toBe(0); expect(L.partition[a.idx(4, y)]).toBe(1); }
    expect(L.partition[a.idx(4, 2)]).toBe(0);       // the back wall above it is no partition
    expect(runs(L, 'N')).toEqual([
      { dir: 'N', line: 3 - RECESS, from: 1, to: 4, floorY: 0 },
      { dir: 'N', line: 6, from: 4, to: 5, floorY: 0, partition: true },   // its south end
      { dir: 'N', line: 3 - RECESS, from: 5, to: 9, floorY: 0 },
    ]);
    expect(runs(L, 'E')).toContainEqual({ dir: 'E', line: 4, from: 3 - RECESS, to: 6, floorY: 0, partition: true });
    expect(runs(L, 'W')).toContainEqual({ dir: 'W', line: 5, from: 3 - RECESS, to: 6, floorY: 0, partition: true });
    expect(checkRoomLayout(a, L, warps)).toEqual([]);
  });
  // Brendan's house 1F: kitchen counters drawn in the wall rows and below them in most columns.
  it('keeps the back wall straight over kitchen counters in most of its columns', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' KKKKKWWW ', ' KKKKK... ', ' ........ ', '          '],
      { K: { mt: 0x210, blocked: true, id: 'cabinet' } });
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N')).toEqual([{ dir: 'N', line: 3 - RECESS, from: 1, to: 9, floorY: 0 }]);   // the plain columns vote 2
    expect(L.band[a.idx(1, 2)]).toBe(1);
    expect(L.inside[a.idx(1, 3)]).toBe(1);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  // Sootopolis' houses (before metatile 0x3FF was room): a void gap under the back wall, room material beside it.
  it('reads the back wall from the northernmost segments across a void gap in the room', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' W??????W ', ' .      . ', ' ..TT.... ', ' ........ ', '          ']);
    const L = roomLayout(a, ids, []);
    expect(L.band[a.idx(3, 1)]).toBe(1); expect(L.band[a.idx(3, 2)]).toBe(1);   // the mode 2 of columns 1 and 8, not 0
    expect(L.inside[a.idx(3, 4)]).toBe(1);          // under the gap: mode 0, the table is room
    expect(runs(L, 'N').map((r) => [r.line, r.from, r.to])).toEqual([[3 - RECESS, 1, 2], [4 - RECESS, 2, 8], [3 - RECESS, 8, 9]]);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('closes a corner with the wall of the room beside it, not the recess', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' WWWWWWWW ', ' .      . ', '  ...... ', '  ...... ', '          ']);
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'W')).toContainEqual({ dir: 'W', line: 2, from: 4, to: 6, floorY: 0 });   // not from 3.5: (1, 3) is room
    expect(runs(L, 'E')).toContainEqual({ dir: 'E', line: 2, from: 3 - RECESS, to: 4, floorY: 0 });
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  // Mossdeep's Game Corner B1F: a plant's leaves drawn over the wall rows are walkable (out of reach behind its pot).
  it('keeps the back wall straight behind a plant whose leaves one could stand on', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' pWWWWp ', ' P....P ', ' ...... ', '        '], {
      p: { mt: 0x210, blocked: false, id: 'plant' }, P: { mt: 0x211, blocked: true, id: 'plant' },
    });
    const L = roomLayout(a, ids, []);
    expect(runs(L, 'N')).toEqual([{ dir: 'N', line: 3 - RECESS, from: 1, to: 7, floorY: 0 }]);
    expect(L.band[a.idx(1, 2)]).toBe(1);
    expect(L.inside[a.idx(1, 3)]).toBe(1);
    expect(checkRoomLayout(a, L)).toEqual([]);
  });
  it('fakeInterior seeds its ids into interiorIds', () => {
    const { a, ids } = fakeInterior(HOUSE);
    expect(interiorIds(a)).toBe(ids);
    expect(ids[a.idx(6, 2)]).toBe('fridge');
    expect(ids[a.idx(0, 0)]).toBe(null);
  });
  it('rebuilds the layout for other warps (the memo keys on ids and warps)', () => {
    const { a, ids } = fakeInterior(HOUSE);
    expect(roomLayout(a, ids, []).doors).toEqual([]);
    expect(roomLayout(a, ids, [{ x: 5, y: 7, dest: 'X' }]).doors).toHaveLength(1);
  });
  it('flags a run over a walkable cell and a door off its run', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const L = roomLayout(a, ids, [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
    const bad = { ...L, runs: [...L.runs, { dir: 'S' as const, line: 5, from: 2, to: 3, floorY: 0 }], doors: [{ dir: 'E' as const, line: 9, from: 1, to: 2 }] };
    const f = checkRoomLayout(a, bad);
    expect(f.some((s) => s.includes('walkable'))).toBe(true);
    expect(f.some((s) => s.includes('door'))).toBe(true);
  });
  it('flags a cell one can stand on outside the room, wall art in the room, a band under room, a lost door', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const warps = [{ x: 5, y: 7, dest: 'X' }];
    const L = roomLayout(a, ids, warps);
    const inside = L.inside.slice(), band = L.band.slice();
    inside[a.idx(2, 5)] = 0;                        // a walkable cell dropped from the room
    inside[a.idx(4, 2)] = 1; band[a.idx(4, 2)] = 0; // the window's lower row taken for room
    band[a.idx(6, 6)] = 1; inside[a.idx(6, 6)] = 0; // a band cell under room
    const f = checkRoomLayout(a, { ...L, inside, band, doors: [] }, warps);
    for (const s of ['walkable cell (2, 5) not in the room', 'wall art (4, 2) left in the room', 'band cell (6, 6) under room',
      'exit mat (5, 7) without a door']) expect(f).toContain(s);
  });
  it('flags a window whose glass is on no N run', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const L = roomLayout(a, ids, []);
    const copy = { ...L.features[0] };              // a copy: z falls back to the northernmost N run over its centre
    expect(checkRoomLayout(a, { ...L, features: [copy], runs: L.runs.filter((r) => r.dir !== 'N') })).toContain('window at 3…5 on no N run');
  });
  // review B I2: one vote for a room's floor height, read by the walls (runs' floorY) and the floor (roomFloorHeights)
  it('raises the walls and the floor of a room together', () => {
    const { a, ids } = fakeInterior(['         ', ' WWW WWW ', ' ... ... ', ' ... ... ', '         ']);
    for (let i = 0; i < a.N; i++) if (a.cellX(i) >= 5 && !Number.isNaN(a.height[i])) a.height[i] = 2;   // the east room: 2 up
    const L = roomLayout(a, ids, []);
    expect(L.rooms).toBe(2);
    const east = L.room[a.idx(6, 2)], west = L.room[a.idx(2, 2)];
    expect(east).not.toBe(west);
    expect(L.floorY[east]).toBe(2);
    expect(L.floorY[west]).toBe(0);
    const h = roomFloorHeights(a, L);
    for (const r of L.runs) {
      const x = r.dir === 'E' ? r.line - 1 : r.dir === 'W' ? r.line : Math.floor(r.from);
      const y = r.dir === 'N' ? Math.ceil(r.line) : r.dir === 'S' ? r.line - 1 : Math.ceil(r.from);
      expect(h[a.idx(x, y)], `${r.dir}${r.line}`).toBe(r.floorY);
    }
    expect(L.runs.filter((r) => r.floorY === 2)).toHaveLength(4);
    expect(L.room[a.idx(4, 2)]).toBe(-1);           // the void between them
  });
  // review B M5: windows, clocks and decals map a band's rows to heights one way
  it('maps the rows of a 3-row band to the same heights for windows and the other wall art', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' WOOWWW ', ' WOOWWW ', ' ...... ', ' ...... ', '        ']);
    const L = roomLayout(a, ids, []);
    const f = L.features.find((q) => q.kind === 'window')!;
    expect([f.rows, f.row0, f.row1]).toEqual([3, 1, 2]);
    const w = windowRect(L, f), b = bandRect(f, WALL_SPAN[0], WALL_SPAN[1]);
    expect([w.y0, w.y1]).toEqual([b.y0, b.y1]);
    expect(w.y0).toBeCloseTo(WALL_SPAN[0], 9);       // the band's bottom two rows: the span's lower two thirds
    expect(w.y1).toBeCloseTo(WALL_SPAN[0] + ((WALL_SPAN[1] - WALL_SPAN[0]) * 2) / 3, 9);
    expect(WALL_SPAN).toEqual([0.2, WALL_H - 0.3]);
  });
  it('merges collinear spans of one direction, line, floorY and partition flag only', () => {
    const m = mergeSpans([
      { dir: 'N' as const, line: 1, from: 2, to: 3, floorY: 0 }, { dir: 'N' as const, line: 1, from: 0, to: 2, floorY: 0 },
      { dir: 'N' as const, line: 1, from: 3, to: 4, floorY: 1 }, { dir: 'E' as const, line: 1, from: 0, to: 1, floorY: 0 },
    ]);
    expect(m).toEqual([{ dir: 'N', line: 1, from: 0, to: 3, floorY: 0 }, { dir: 'N', line: 1, from: 3, to: 4, floorY: 1 },
      { dir: 'E', line: 1, from: 0, to: 1, floorY: 0 }]);
  });
});
