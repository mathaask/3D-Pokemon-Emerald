import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  gridEvents, stripPlacement, backupGridEvents, liveGridEvents, type StripPlacement,
} from '../src/render/kit/events';
import { Connection, loadMap, mapName, RomReader, type MapEvents } from '../src/game/rom/index';

const ev: MapEvents = {
  objects: [],
  coordEvents: [],
  warps: [{ x: 5, y: 8, elevation: 0, warpId: 0, mapGroup: 1, mapNum: 0 }],
  bgEvents: [
    { x: 3, y: 4, elevation: 0, kind: 0, script: 0x08000000 },
    { x: 6, y: 4, elevation: 0, kind: 2, script: 0x08000000 },
    { x: 9, y: 9, elevation: 0, kind: 7, hiddenItem: { item: 1, hiddenItemId: 2 } },
  ],
};

describe('gridEvents', () => {
  it('shifts live coordinates by MAP_OFFSET and keeps preview coordinates', () => {
    expect(gridEvents(ev, 7).warps[0]).toMatchObject({ x: 12, y: 15 });
    expect(gridEvents(ev, 0).warps[0]).toMatchObject({ x: 5, y: 8 });
  });
  it('shifts x and y separately when given both', () => {
    expect(gridEvents(ev, 27, -13).warps[0]).toMatchObject({ x: 32, y: -5 });
    expect(gridEvents(ev, 27, -13).signs[0]).toEqual({ x: 30, y: -9 });
  });
  it('names warp destinations', () => {
    expect(gridEvents(ev, 0).warps[0].dest).toBe('LittlerootTown_BrendansHouse_1F');
  });
  it('keeps interactable signs, drops hidden items', () => {
    expect(gridEvents(ev, 7).signs).toEqual([{ x: 10, y: 11 }, { x: 13, y: 11 }]);
  });
});

// ---- connected maps in the live backup grid ----

const MO = 7;
/** A 20x20 current map: the backup grid is 35x34 (fieldmap.h MAP_OFFSET_W = 15, MAP_OFFSET_H = 14). */
const MAIN = { width: 20, height: 20 };

/**
 * pokeemerald fieldmap.c Fill{South,North,West,East}Connection transcribed literally: where the
 * game copies a connected map's cells (dest x, y; source x2, y2; width x height cells).
 */
function fillConnection(dir: number, offset: number, main: { width: number; height: number },
  c: { width: number; height: number }) {
  const bw = main.width + MO * 2 + 1;
  const bh = main.height + MO * 2;
  let x = 0, y = 0, x2 = 0, y2 = 0, width = 0, height = 0;
  if (dir === Connection.SOUTH || dir === Connection.NORTH) {
    x = offset + MO;
    if (dir === Connection.SOUTH) { y = main.height + MO; y2 = 0; } else { y = 0; y2 = c.height - MO; }
    if (x < 0) {
      x2 = -x; x += c.width; width = x < bw ? x : bw; x = 0;
    } else {
      x2 = 0; width = x + c.width < bw ? c.width : bw - x;
    }
    height = MO;
  } else {
    y = offset + MO;
    if (dir === Connection.WEST) { x = 0; x2 = c.width - MO; width = MO; } else { x = main.width + MO; x2 = 0; width = MO + 1; }
    if (y < 0) {
      y2 = -y; height = y + c.height < bh ? y + c.height : bh; y = 0;
    } else {
      y2 = 0; height = y + c.height < bh ? c.height : bh - y;
    }
  }
  return { x, y, x2, y2, width, height };
}

describe('stripPlacement (connected map -> backup grid, as fieldmap.c lays it out)', () => {
  it('south: below the map, offset along x, the connected map\'s top rows', () => {
    expect(stripPlacement(Connection.SOUTH, 0, MAIN, { width: 20, height: 20 }, MO))
      .toEqual({ dx: 7, dy: 27, x0: 7, y0: 27, x1: 27, y1: 34 });
    expect(stripPlacement(Connection.SOUTH, -10, MAIN, { width: 30, height: 40 }, MO))
      .toEqual({ dx: -3, dy: 27, x0: 0, y0: 27, x1: 27, y1: 34 });
    expect(stripPlacement(Connection.SOUTH, 15, MAIN, { width: 30, height: 40 }, MO))
      .toEqual({ dx: 22, dy: 27, x0: 22, y0: 27, x1: 35, y1: 34 });
  });
  it('north: above the map, the connected map\'s bottom MAP_OFFSET rows', () => {
    expect(stripPlacement(Connection.NORTH, 0, MAIN, { width: 20, height: 20 }, MO))
      .toEqual({ dx: 7, dy: -13, x0: 7, y0: 0, x1: 27, y1: 7 });
    expect(stripPlacement(Connection.NORTH, -5, MAIN, { width: 24, height: 30 }, MO))
      .toEqual({ dx: 2, dy: -23, x0: 2, y0: 0, x1: 26, y1: 7 });
  });
  it('west: left of the map, offset along y, the connected map\'s right MAP_OFFSET columns', () => {
    expect(stripPlacement(Connection.WEST, 0, MAIN, { width: 20, height: 20 }, MO))
      .toEqual({ dx: -13, dy: 7, x0: 0, y0: 7, x1: 7, y1: 27 });
    expect(stripPlacement(Connection.WEST, -12, MAIN, { width: 40, height: 30 }, MO))
      .toEqual({ dx: -33, dy: -5, x0: 0, y0: 0, x1: 7, y1: 25 });
  });
  it('east: right of the map, MAP_OFFSET + 1 columns (to the grid\'s edge)', () => {
    expect(stripPlacement(Connection.EAST, 3, MAIN, { width: 20, height: 40 }, MO))
      .toEqual({ dx: 27, dy: 10, x0: 27, y0: 10, x1: 35, y1: 34 });
    expect(stripPlacement(Connection.EAST, -8, MAIN, { width: 20, height: 12 }, MO))
      .toEqual({ dx: 27, dy: -1, x0: 27, y0: 0, x1: 35, y1: 11 });
  });
  it('dive / emerge connections are not laid out; a strip off the grid is empty', () => {
    expect(stripPlacement(Connection.DIVE, 0, MAIN, MAIN, MO)).toBeNull();
    expect(stripPlacement(Connection.EMERGE, 0, MAIN, MAIN, MO)).toBeNull();
    expect(stripPlacement(Connection.SOUTH, 40, MAIN, MAIN, MO)).toBeNull();
    expect(stripPlacement(Connection.WEST, -40, MAIN, MAIN, MO)).toBeNull();
  });
  it('matches the literal fieldmap.c fill for every direction over a sweep of offsets and sizes', () => {
    let checked = 0;
    for (const dir of [Connection.SOUTH, Connection.NORTH, Connection.WEST, Connection.EAST]) {
      for (const main of [{ width: 20, height: 20 }, { width: 40, height: 12 }, { width: 9, height: 60 }]) {
        for (const c of [{ width: 20, height: 20 }, { width: 48, height: 10 }, { width: 8, height: 80 }]) {
          for (let offset = -90; offset <= 90; offset++) {
            const f = fillConnection(dir, offset, main, c);
            const p = stripPlacement(dir, offset, main, c, MO);
            if (f.width <= 0 || f.height <= 0) { expect(p).toBeNull(); continue; }
            expect(p).toEqual({
              dx: f.x - f.x2, dy: f.y - f.y2, x0: f.x, y0: f.y, x1: f.x + f.width, y1: f.y + f.height,
            });
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(500);
  });
});

describe('backupGridEvents', () => {
  const at = (x: number, y: number, mapNum = 0): MapEvents => ({
    objects: [], coordEvents: [], bgEvents: [{ x, y, elevation: 0, kind: 0, script: 0x08000000 }],
    warps: [{ x, y, elevation: 0, warpId: 0, mapGroup: 0, mapNum }],
  });
  const strip = (p: Partial<StripPlacement>): StripPlacement => ({ dx: 0, dy: 0, x0: 0, y0: 0, x1: 35, y1: 34, ...p });

  it('the current map at MAP_OFFSET; connected maps shifted, only what lies in their strip', () => {
    const north = strip({ dx: 7, dy: -13, x0: 7, y0: 0, x1: 27, y1: 7 });
    const oldale = [at(6, 16, 10), at(14, 6, 10), at(5, 12, 10)].reduce((a, b) => ({
      ...a, warps: [...a.warps, ...b.warps], bgEvents: [...a.bgEvents, ...b.bgEvents],
    }));
    // (6, 16) -> (13, 3): in the strip; (14, 6) -> (21, -7): off the grid; (5, 12) -> (12, -1): above it
    const g = backupGridEvents(at(3, 4), [{ placement: north, events: oldale }], MO);
    expect(g.warps.map((w) => [w.x, w.y, w.dest])).toEqual([[10, 11, 'PetalburgCity'], [13, 3, 'OldaleTown']]);
    expect(g.signs).toEqual([{ x: 10, y: 11 }, { x: 13, y: 3 }]);
  });

  it('a cell two strips cover belongs to the connection the game copied last', () => {
    const first = strip({ x0: 0, y0: 0, x1: 7, y1: 34 });
    const second = strip({ x0: 0, y0: 0, x1: 35, y1: 7 });
    const g = backupGridEvents({ objects: [], coordEvents: [], warps: [], bgEvents: [] }, [
      { placement: first, events: at(2, 2, 1) }, // overwritten by `second`
      { placement: first, events: at(2, 20, 2) }, // first only
      { placement: second, events: at(3, 3, 3) },
    ], MO);
    expect(g.warps.map((w) => [w.x, w.y])).toEqual([[2, 20], [3, 3]]);
  });

  it('no connections: the current map\'s events, as before', () => {
    expect(backupGridEvents(ev, [], MO)).toEqual(gridEvents(ev, MO));
  });
});

const romPath = path.resolve(import.meta.dirname, '../Pokemon_Emerald-.gba');
const hasRom = fs.existsSync(romPath);

describe.skipIf(!hasRom)('liveGridEvents (ROM)', () => {
  const rom = hasRom ? new RomReader(new Uint8Array(fs.readFileSync(romPath))) : (null as unknown as RomReader);

  it('Route 101 sees Oldale\'s Pokémon Center door (north strip) at Oldale\'s warp + the strip position', () => {
    const r101 = loadMap(rom, 0, 16);
    const oldale = loadMap(rom, 0, 10);
    const conn = r101.connections.find((c) => c.mapGroup === 0 && c.mapNum === 10)!;
    expect(conn.direction).toBe(Connection.NORTH);
    const g = liveGridEvents(rom, r101.eventsAddr, rom.u32(r101.addr + 12), r101.layout, MO);

    // Oldale's own backup grid has its PC door at its warp + MAP_OFFSET; Route 101's north strip
    // shows Oldale's bottom 7 rows at rows 0-6: Oldale row h - 7 lands on row 0, columns + offset.
    const pc = oldale.events.warps.find((w) => mapName(w.mapGroup, w.mapNum) === 'OldaleTown_PokemonCenter_1F')!;
    const own = { x: pc.x + MO, y: pc.y + MO };
    const strip = { x: own.x + conn.offset, y: own.y - oldale.layout.height };
    expect(strip).toEqual({ x: 13, y: 3 });
    expect(g.warps).toContainEqual({ ...strip, dest: 'OldaleTown_PokemonCenter_1F' });
    // (the warp's cell in Oldale's layout is the PC's door metatile, 0x061 in gTileset_General)
    expect(oldale.layout.grid[pc.y * oldale.layout.width + pc.x] & 0x3ff).toBe(0x061);

    // Everything kept from Oldale lies in the 7-row north strip; nothing from Littleroot (its
    // doors and signs are below its top 7 rows); Route 101 has no warps of its own.
    for (const w of g.warps) expect(w.y).toBeLessThan(7);
    expect(g.warps.map((w) => w.dest).sort()).toEqual(['OldaleTown_House2', 'OldaleTown_PokemonCenter_1F']);
    expect(g.signs).toEqual(expect.arrayContaining([{ x: 14, y: 3 }, { x: 15, y: 3 }]));
  });

  it('a map without connections reads its own events only', () => {
    const lab = loadMap(rom, 1, 4); // an indoor map: no connections
    expect(lab.connections).toEqual([]);
    expect(liveGridEvents(rom, lab.eventsAddr, rom.u32(lab.addr + 12), lab.layout, MO)).toEqual(gridEvents(lab.events, MO));
  });
});
