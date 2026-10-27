// Interior room layouts on the real maps (needs the ROM): checkRoomLayout finds nothing on any of the 137 in-scope
// interiors, a handful of representative maps keep their pinned layout (back line per column, wall runs, doors), and
// every rule of the layout that the real maps exercise changes a pinned map when it is switched off (ROOM_RULES).
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorRooms.test.ts
// A deliberate layout change re-pins: print the new digests (roomDigest) and review the diff map by map.

import { describe, it, expect } from 'vitest';
import { loadRom, loadStaticMap, type StaticMap } from './helpers/staticMap';
import { analyze, type MapAnalysis } from '../../src/render/overworld/analyze';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { interiorIds } from '../../src/render/kit/tables/building';
import { interiorScope } from '../../src/render/kit/interior/scope';
import { gridEvents } from '../../src/render/kit/events';
import { roomLayout, checkRoomLayout, ROOM_RULES, type RoomLayout } from '../../src/render/kit/interior/room';

/** The world's margin (World.margin). */
const MARGIN = 14;

/** A layout in one line: back line per in-map column | runs (`p`: a partition's) | doors. */
function roomDigest(a: MapAnalysis, L: RoomLayout): string {
  const m = a.opts.margin;
  const bl = [...L.backLine.slice(m, L.backLine.length - m)].join(',');
  const runs = L.runs.map((r) => `${r.dir}${r.line}:${r.from}-${r.to}${r.partition ? 'p' : ''}`).join(' ');
  const doors = L.doors.map((d) => `${d.dir}${d.line}:${d.from}-${d.to}`).join(' ');
  return `${bl} | ${runs} | ${doors}`;
}

/** Brendan's house 1F/2F (kitchen counters, stairs alcoves), Birch's lab, houses, a Pokémon Center and a Mart, Dewford
 *  Hall / Wanda's house / Rustboro's flat / the fan club / the Weather Institute (partitions), the Dept Store, Mossdeep's
 *  Game Corner B1F (plant leaves), a Sootopolis house (metatile-0x3FF floor), a gate. */
const PINS: Record<string, string> = {
  '1.0': '2,2,2,2,2,2,2,3,2,3,3 | N1.5:0-7 N2.5:7-8 N1.5:8-9 N2.5:9-11 E7:1.5-2.5 E9:1.5-2.5 E11:2.5-9 S9:0-11 W0:1.5-9 W8:1.5-2.5 | S9:8-10',
  '1.1': '2,2,2,2,2,2,2,1,2 | N1.5:0-7 N0.5:7-8 N1.5:8-9 E8:0.5-1.5 E9:1.5-8 S8:0-9 W7:0.5-1.5 W0:1.5-8 | ',
  '1.4': '2,2,2,2,2,2,2,2,2,2,2,3,2 | N1.5:0-11 N2.5:11-12 N1.5:12-13 E11:1.5-2.5 E13:1.5-13 S13:0-13 W0:1.5-13 W12:1.5-2.5 | S13:6-8',
  '2.0': '2,2,2,2,2,2,2,2,2,2 | N1.5:0-10 E10:1.5-9 S9:0-10 W0:1.5-9 | S9:3-5',
  '2.2': '2,2,2,2,2,2,2,2,2,2,2,2,2,2 | N1.5:0-14 E14:1.5-9 S9:0-14 W0:1.5-9 | S9:6-8',
  '2.4': '2,2,2,2,2,2,2,2,2,2,2 | N1.5:0-11 E11:1.5-8 S8:0-11 W0:1.5-8 | S8:3-5',
  '3.4': '2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2 | N1.5:0-10 N7:10-11p N1.5:11-17 N7:13-14p N6:14-17p E10:1.5-7p E17:1.5-5 E13:5-7p E17:6-9 S9:0-17 S5:13-17p W0:1.5-9 W11:1.5-7p W14:6-7p | S9:5-7',
  '6.6': '2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2 | N1.5:0-12 N6:12-13p N1.5:13-17 E12:1.5-6p E17:1.5-8 S8:0-17 W0:1.5-8 W13:1.5-6p | S8:7-9',
  '11.13': '2,2,2,1,2,2,2,2,2,2,2,2,2,2 | N1.5:0-3 N0.5:3-4 N1.5:4-5 N8:5-6p N1.5:6-14 N8:8-14p E4:0.5-1.5 E5:1.5-8p E14:1.5-6 E8:6-8p E14:8-9 S9:0-14 S6:8-14p W3:0.5-1.5 W0:1.5-9 W6:1.5-8p | S9:2-4',
  '13.9': '2,2,2,2,2,2,2,2,2,2,2,2 | N1.5:0-12 N8:0-2p N9:2-3p N9:9-10p N8:10-12p E12:1.5-7 E9:7-9p E2:8-9p E12:8-14 S7:0-3p S14:0-12 S7:9-12p W0:1.5-7 W3:7-9p W0:8-14 W10:8-9p | S14:5-7',
  '13.17': '2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2,1,2 | N1.5:0-13 N0.5:13-14 N1.5:14-16 N0.5:16-17 N1.5:17-18 E14:0.5-1.5 E17:0.5-1.5 E18:1.5-8 S8:0-18 W13:0.5-1.5 W16:0.5-1.5 W0:1.5-8 | ',
  '14.12': '2,2,2,1,2,2,2,2,2,2,2,2 | N1.5:0-3 N0.5:3-4 N1.5:4-12 E4:0.5-1.5 E12:1.5-9 S9:0-12 W3:0.5-1.5 W0:1.5-9 | ',
  '15.5': '2,2,2,2,2,2,2,2 | N1.5:0-8 E8:1.5-7 S7:0-8 W0:1.5-7 | S7:3-5',
  '29.1': '2,2,1,2,2,2,2,2,2,2,1,2 | N1.5:0-2 N0.5:2-3 N1.5:3-10 N0.5:10-11 N1.5:11-12 E3:0.5-1.5 E11:0.5-1.5 E12:1.5-8 S8:0-12 W2:0.5-1.5 W10:0.5-1.5 W0:1.5-8 | ',
  '32.0': '2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,2,1,2,2 | N1.5:0-17 N10:0-3p N10:8-20p N0.5:17-18 N1.5:18-20 E18:0.5-1.5 E20:1.5-8 E8:8-10p E20:10-13 S8:0-3p S13:0-20 S8:8-20p W17:0.5-1.5 W0:1.5-8 W3:8-10p W0:10-13 | S13:9-11',
};

const layout = (s: StaticMap, warps = gridEvents(s.map.events, 0).warps) => {
  const a = analyze(s.grid, { ...s.opts, margin: MARGIN });
  return { a, warps, L: roomLayout(a, interiorIds(a), warps) };
};

describe('interior room layouts on the real maps', () => {
  it('finds nothing wrong on any in-scope interior', () => {
    const bad: string[] = [];
    let n = 0;
    for (const m of loadAllMaps(new RomReader(loadRom()))) {
      const s = loadStaticMap(m.group, m.num);
      if (!interiorScope(s.opts, `${m.group}.${m.num}`)) continue;
      n++;
      const { a, L, warps } = layout(s);
      for (const f of checkRoomLayout(a, L, warps)) bad.push(`${m.group}.${m.num}: ${f}`);
    }
    expect(n).toBe(137);                                       // (138 on the five secondaries, less the Dept Store rooftop)
    expect(bad).toEqual([]);
  });

  it('keeps the pinned layouts', () => {
    for (const [k, want] of Object.entries(PINS)) {
      const [g, n] = k.split('.').map(Number);
      const { a, L } = layout(loadStaticMap(g, n));
      expect(roomDigest(a, L), k).toBe(want);
    }
  });

  // firstSegment and corner change none of today's maps (they guard shapes the unit tests pin: a void gap under the
  // back wall, a corner beside room material), so only the rules the real maps exercise are switched here.
  it.each(['furnitureMode', 'plainVote', 'furnitureTops', 'partitions'] as const)('changes a pinned map without the %s rule', (rule) => {
    const maps = Object.keys(PINS).map((k) => loadStaticMap(...(k.split('.').map(Number) as [number, number])));
    ROOM_RULES[rule] = false;
    try {
      const changed = maps.filter((s) => {
        const { a, L } = layout(s);
        return roomDigest(a, L) !== PINS[`${s.map.group}.${s.map.num}`];
      });
      expect(changed.length).toBeGreaterThan(0);
    } finally { ROOM_RULES[rule] = true; }
  });
});
