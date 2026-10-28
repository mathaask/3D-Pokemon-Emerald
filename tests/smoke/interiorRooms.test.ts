// Interior room layouts on the real maps (needs the ROM): checkRoomLayout finds nothing on any of the 137 in-scope
// interiors, a handful of representative maps keep their pinned layout (back line per column, wall runs, doors), and
// every rule of the layout that the real maps exercise changes a pinned map when it is switched off (ROOM_RULES).
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorRooms.test.ts
// A deliberate layout change re-pins: print the new digests (roomDigest) and review the diff map by map.

import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { loadRom, loadStaticMap, type StaticMap } from './helpers/staticMap';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { PUZZLE_KINDS, interiorIds, type InteriorId } from '../../src/render/kit/tables/building';
import { PHASE4B_MAPS, interiorScope, mapProfile, setPhase4bScope } from '../../src/render/kit/interior/scope';
import { gridEvents } from '../../src/render/kit/events';
import {
  roomLayout, checkRoomLayout, tierPlan, walkable, roomMaterial, DAIS_H, ROOM_RULES, type RoomLayout, type TierPlan,
} from '../../src/render/kit/interior/room';
import { flattenFloors } from '../../src/render/overworld/world';
import { extractAll } from '../../src/render/kit/semantics';
import { INTERIOR_FAMILIES } from '../../src/render/kit/interior/index';
import { roomFloorHeights, type FloorCell } from '../../src/render/kit/interior/geom/floorPatterns';
import type { ShellPlacement } from '../../src/render/kit/interior/shell';

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

  // review B I2: the floor's heights and the walls' floorY come from one vote (RoomLayout.floorY); this ties them on every
  // in-scope map, both as World.build runs the families (floors flattened) and on the solver's own heights
  it('lays every room floor at the floorY of its walls', () => {
    const bad: string[] = [];
    let faces = 0;
    for (const m of loadAllMaps(new RomReader(loadRom()))) {
      const s = loadStaticMap(m.group, m.num);
      const key = `${m.group}.${m.num}`;
      if (!interiorScope(s.opts, key)) continue;
      for (const flat of [true, false]) {
        const a = analyze(s.grid, { ...s.opts, margin: MARGIN });
        if (flat) flattenFloors(a);
        const ex = extractAll({ a, events: gridEvents(s.map.events, 0), quality: 'medium' }, INTERIOR_FAMILIES);
        const L = (ex.payloads.get('shell') as ShellPlacement).layout;
        const h = new Map<number, number>();
        for (const c of ex.payloads.get('floor') as FloorCell[]) h.set(c.i, c.h);
        const raw = roomFloorHeights(a, L);
        for (const [i, y] of h) if (L.room[i] >= 0 && y !== L.floorY[L.room[i]]) bad.push(`${key}${flat ? '' : ' raw'}: floor cell ${i} at ${y}`);
        for (let i = 0; i < a.N; i++) if (L.room[i] >= 0 && raw[i] !== Math.fround(L.floorY[L.room[i]])) bad.push(`${key}: roomFloorHeights ${i}`);
        // each run's face: the room cells it closes (N: the row at or south of its line, S: north of it, E / W likewise)
        for (const r of L.runs) {
          for (let t = Math.floor(r.from); t < Math.ceil(r.to); t++) {
            const [x, y] = r.dir === 'N' ? [t, Math.ceil(r.line)] : r.dir === 'S' ? [t, r.line - 1]
              : r.dir === 'E' ? [r.line - 1, t] : [r.line, t];
            if (!a.inside(x, y) || !L.inside[a.idx(x, y)] || !h.has(a.idx(x, y))) continue;
            faces++;
            if (h.get(a.idx(x, y)) !== Math.fround(r.floorY)) bad.push(`${key}${flat ? '' : ' raw'}: ${r.dir}${r.line} floorY ${r.floorY}, floor (${x}, ${y}) at ${h.get(a.idx(x, y))}`);
          }
        }
      }
    }
    expect(faces).toBeGreaterThan(5000);
    expect(bad).toEqual([]);
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

// ------------------------------------------------------------------------------------------------- Phase 4b (Task 5)
// The 45 maps of PHASE4B_MAPS with the 4b scope on, each with its profile (D8): the layout's findings per map go to
// out/rooms-4b.txt (pinned to zero by Task 14, not here: the tables may still be filling), the tier measurement (D13, F1)
// to out/tiers-4b.txt. The 137 Phase 4 maps above keep their layouts (DEFAULT_PROFILE).

const OUT = path.resolve(import.meta.dirname, '../../out');
const MECHANIC = new Set<InteriorId>(PUZZLE_KINDS);
const fmtSet = (s: Iterable<number>) => [...new Set(s)].sort((p, q) => p - q).map((h) => +h.toFixed(2)).join(',');

/** A 4b map as its build reads it: the analysis, its ids for its key (F4), its profile, its layout. */
function load4b(key: string, opts: { indoorStairs?: boolean } = {}) {
  const [g, n] = key.split('.').map(Number);
  const s = loadStaticMap(g, n);
  const a = analyze(s.grid, { ...s.opts, margin: MARGIN, ...opts });
  const ids = interiorIds(a, key), profile = mapProfile(key), warps = gridEvents(s.map.events, 0).warps;
  return { s, a, ids, profile, warps };
}

/** D8's band fit: the share of a map's columns whose first walkable row (mechanics too) lies within bandMax rows of the
 *  column's top (the band a back wall could hang). */
function bandFit(a: MapAnalysis, ids: readonly (InteriorId | null)[], bandMax: number): number {
  let cols = 0, fit = 0;
  for (let x = a.minX; x < a.maxX; x++) {
    let t = -1;
    for (let y = a.minY; y < a.maxY && t < 0; y++) if (roomMaterial(a, a.idx(x, y))) t = y;
    if (t < 0) continue;
    cols++;
    for (let y = t; y <= t + bandMax && y < a.maxY; y++) {
      const i = a.idx(x, y), id = ids[i];
      if (roomMaterial(a, i) && (walkable(a, i) || (id !== null && MECHANIC.has(id)))) { fit++; break; }
    }
  }
  return cols ? fit / cols : 0;
}

/** What prepareInterior (Task 7) does with a tier plan: every cell's floor at its plan height. */
function applyPlan(a: MapAnalysis, P: TierPlan): void {
  for (let i = 0; i < a.N; i++) {
    if (Number.isNaN(P.h[i])) continue;
    if (!Number.isNaN(a.height[i])) a.height[i] = P.h[i];
    a.groundH[i] = P.h[i];
  }
}

describe('Phase 4b rooms (layout v2)', () => {
  it('lays out every 4b map with its profile and writes the findings (out/rooms-4b.txt)', () => {
    setPhase4bScope(true);
    try {
      const lines: string[] = ['# Phase 4b room layouts (Task 5): per map its profile, band fit, rooms, masses, risers, doors, findings',
        '# (the 4b scope on; ids for the map key; tier maps laid with tierPlan as prepareInterior would)', ''];
      let maps = 0, findings = 0;
      const notInScope: string[] = [];
      for (const key of PHASE4B_MAPS.keys()) {
        const { a, ids, profile, warps, s } = load4b(key);
        if (!interiorScope(s.opts, key)) { notInScope.push(key); continue; }
        maps++;
        if (profile.tiers) applyPlan(a, tierPlan(a, ids));
        const L = roomLayout(a, ids, warps, profile);
        const f = checkRoomLayout(a, L, warps);
        findings += f.length;
        let cells = 0, labelled = 0;
        for (let i = 0; i < a.N; i++) if (roomMaterial(a, i)) { cells++; if (ids[i] !== null) labelled++; }
        const kinds = (xs: string[]) => [...new Set(xs)].map((k) => `${k} ${xs.filter((x) => x === k).length}`).join(', ') || '-';
        lines.push(`${key} ${profile.shell}${profile.tiers ? '+tiers' : ''} bandMax ${profile.bandMax} | labelled ${(100 * labelled / cells).toFixed(0)} %`
          + ` | band fit ${(100 * bandFit(a, ids, profile.bandMax)).toFixed(0)} % | rooms ${L.rooms} | masses ${kinds(L.masses.map((m) => m.kind))}`
          + ` | risers ${L.risers.length} | doors ${kinds(L.doors.map((d) => d.kind))} | features ${L.features.length} | findings ${f.length}`);
        const byKind = new Map<string, string[]>();
        for (const x of f) { const k = x.replace(/\(.*$/, '').replace(/[-\d.[\],…]+/g, '').trim(); byKind.set(k, [...(byKind.get(k) ?? []), x]); }
        for (const [k, xs] of byKind) lines.push(`    ${xs.length} × ${k}: ${xs.slice(0, 4).join('; ')}${xs.length > 4 ? '; …' : ''}`);
      }
      lines.push('', `${maps} maps, ${findings} findings${notInScope.length ? `; not in scope: ${notInScope.join(' ')}` : ''}`);
      fs.mkdirSync(OUT, { recursive: true });
      fs.writeFileSync(path.join(OUT, 'rooms-4b.txt'), lines.join('\n') + '\n');
      expect(notInScope).toEqual([]);
      expect(maps).toBe(45);
    } finally { setPhase4bScope(false); }
  });

  it('measures the tiers (out/tiers-4b.txt): elevations, the solver with indoor stairs, the label plan', () => {
    const lines: string[] = ['# Phase 4b tiers (Task 5, D13/F1): per map the distinct elevations of its walkable cells, the solver\'s walkable',
      '# heights (plain; with the indoor `flanked` stairs rule, ClassifyOptions.indoorStairs) and the label plan\'s (tierPlan) floor',
      '# heights; `propose tiers` where the labels make tiers (tier faces, ramps, a dais): heights come from labels (F1), the',
      '# solver is shown for the record (its indoor stairs climb maze corridors).', ''];
    const proposals: string[] = [];
    for (const key of PHASE4B_MAPS.keys()) {
      const plain = load4b(key), stairs = load4b(key, { indoorStairs: true });
      const walk = (a: MapAnalysis) => {
        const out: number[] = [];
        for (let i = 0; i < a.N; i++) if (roomMaterial(a, i) && a.kind[i] === K.Floor && walkable(a, i)) out.push(i);
        return out;
      };
      const elev = walk(plain.a).map((i) => plain.a.elev[i]);
      const h0 = walk(plain.a).map((i) => plain.a.height[i]), h1 = walk(stairs.a).map((i) => stairs.a.height[i]);
      let nStairs = 0;
      for (let i = 0; i < stairs.a.N; i++) if (roomMaterial(stairs.a, i) && stairs.a.kind[i] === K.Stairs) nStairs++;
      const P = tierPlan(plain.a, plain.ids);
      const tierH: number[] = [];
      for (let i = 0; i < plain.a.N; i++) if (P.tier[i] >= 0) tierH.push(P.h[i]);
      let faces = 0, ramps = 0;
      for (let i = 0; i < plain.a.N; i++) { if (plain.ids[i] === 'tierFace') faces++; if (plain.ids[i] === 'hiddenStairs') ramps++; }
      const daises = P.dais.filter(Boolean).length;
      const levels = new Set(tierH.map((h) => +h.toFixed(3))).size;
      const propose = faces + ramps + daises > 0 || levels > 1;
      if (propose && !plain.profile.tiers) proposals.push(key);
      lines.push(`${key}${plain.profile.tiers ? ' (tiers)' : ''} | elevations ${fmtSet(elev)} | solver ${fmtSet(h0)} | +indoorStairs ${fmtSet(h1)}`
        + ` (${nStairs} stairs cells) | labels: ${faces} tierFace, ${ramps} hiddenStairs, ${daises} dais → plan ${fmtSet(tierH)}`
        + `${propose ? (plain.profile.tiers ? ' | tiers ✓' : ' | propose tiers') : ''}`);
    }
    lines.push('', `proposed for tiers: ${proposals.join(' ') || '-'}`);
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'tiers-4b.txt'), lines.join('\n') + '\n');
  });

  // Sootopolis 1F (15.0): a pyramid of four two-row face bands joined at x = 8 by ramps; Juan's platform on top, his dais
  // on it; the slate terraces outside the walls step down the same way, walkable cells among them unreachable.
  it('lays Sootopolis 1F\'s tiers from its labels, no cap on Juan\'s platform', () => {
    const { a, ids } = load4b('15.0');
    const P = tierPlan(a, ids);
    const h = (x: number, y: number) => +P.h[a.idx(x, y)].toFixed(3);
    expect([h(8, 24), h(8, 18), h(8, 13), h(8, 7), h(4, 3)]).toEqual([0, 2, 4, 6, 8]);   // entrance, ice fields 1–3, Juan
    expect(h(8, 3)).toBe(+(8 + DAIS_H).toFixed(3));                       // Juan's dais
    expect([4, 5, 6, 7, 8].map((y) => h(16, y))).toEqual([6, 6, 6, 6, 6]); // the unreachable east terrace beside field 3
    expect([1, 2, 3, 4].map((x) => h(x, 16))).toEqual([2, 2, 2, 2]);      // the west terrace beside field 1
    expect([4, 5].map((y) => h(8, y))).toEqual([7.5, 6.5]);               // the ramp from field 3 up to Juan
    // laid as prepareInterior would, every face band stands on a riser
    applyPlan(a, P);
    const L = roomLayout(a, ids, gridEvents(loadStaticMap(15, 0).map.events, 0).warps, mapProfile('15.0'));
    expect(L.risers.length).toBeGreaterThan(0);
    expect(checkRoomLayout(a, L).filter((f) => f.startsWith('tier face'))).toEqual([]);
  });
});
