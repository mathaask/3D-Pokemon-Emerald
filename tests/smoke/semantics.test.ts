// Semantic layer on real maps (needs the ROM): pins what the model families find on real maps and
// writes the legacy-coverage reports (the share of cells still drawn with the legacy pixel geometry):
//   out/coverage.txt      the regression maps (their average is held at <= 15 %)
//   out/coverage-all.txt  every outdoor map (towns, cities, routes, outdoor dungeon maps), worst first
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/semantics.test.ts

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRom, loadStaticMap } from './helpers/staticMap';
import { REGRESSION_MAPS } from './helpers/maps';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { extractAll, isSecretBaseSpot, type Extracted } from '../../src/render/kit/semantics';
import { FAMILIES } from '../../src/render/kit/index';
import { gridEvents } from '../../src/render/kit/events';
import { CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP } from '../../src/render/overworld/claims';
import { RomReader } from '../../src/game/rom/reader';
import { BgEventKind, loadAllMaps, MapType, MAP_TYPE_NAMES } from '../../src/game/rom/maps';
import type { BuildingPlacement, BuildingKind } from '../../src/render/kit/buildings';
import type { CliffPlacement } from '../../src/render/kit/cliffs';
import type { WaterPlacement } from '../../src/render/kit/water';
import type { TerrainPlacement } from '../../src/render/kit/terrain';

const OUT = path.resolve(import.meta.dirname, '../../out');

interface Run { name: string; width: number; height: number; a: MapAnalysis; ex: Extracted | null }

/** Analysis and extraction as World.build runs them: margin 14, and the kit runs on every map that
 *  is neither indoor nor underground (on a Dive map only the seabed terrain draws). */
function run(g: number, n: number): Run {
  const s = loadStaticMap(g, n);
  const a = analyze(s.grid, { ...s.opts, margin: 14 });
  const kit = !s.opts.indoor && !s.opts.underground;
  return {
    name: s.map.name, width: s.grid.width, height: s.grid.height, a,
    ex: kit ? extractAll({ a, events: gridEvents(s.map.events, 0), quality: 'medium' }, FAMILIES) : null,
  };
}

const payload = <T>(ex: Extracted | null, name: string) => (ex?.payloads.get(name) ?? []) as T;
const inMap = (r: Run, i: number) => {
  const x = r.a.cellX(i), y = r.a.cellY(i);
  return x >= 0 && y >= 0 && x < r.width && y < r.height;
};

/** A cell still drawn with legacy geometry: no family drew its surface, or the object standing on it
 *  (a tree, a building, a block) is not modelled. */
function isLegacy(a: MapAnalysis, ex: Extracted | null, i: number): boolean {
  const bits = ex ? ex.claims.bits[i] : 0;
  const object = a.kind[i] === K.Block || a.kind[i] === K.Tree || a.kind[i] === K.Building;
  return !(bits & CLAIM_SURFACE) || (object && !(bits & CLAIM_OBJECT));
}

interface Coverage {
  /** Legacy share of the analysed grid (the map and its 14-cell border margin; void excluded). */
  share: number;
  /** Legacy share of the map's own cells. */
  inMap: number;
  /** Legacy cells by analysis kind (K). */
  byKind: number[];
}

function coverage(r: Run): Coverage {
  const { a, ex } = r;
  let total = 0, legacy = 0, mapTotal = 0, mapLegacy = 0;
  const byKind = new Array<number>(8).fill(0);
  for (let i = 0; i < a.N; i++) {
    if (a.kind[i] === K.Void) continue;
    const inside = inMap(r, i);
    total++;
    if (inside) mapTotal++;
    if (!isLegacy(a, ex, i)) continue;
    legacy++;
    if (inside) mapLegacy++;
    byKind[a.kind[i]]++;
  }
  return { share: total ? legacy / total : 0, inMap: mapTotal ? mapLegacy / mapTotal : 0, byKind };
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);

function writeReport(file: string, lines: string[]): void {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, file), lines.join('\n') + '\n');
}

describe('semantics on real maps', () => {
  it('Littleroot: two houses and the lab', () => {
    const { ex } = run(0, 9);
    expect(payload<BuildingPlacement[]>(ex, 'buildings').map((b) => b.kind).sort()).toEqual(['house', 'house', 'lab']);
  });

  it('Oldale: one Pokémon Center and one Mart', () => {
    const kinds = payload<BuildingPlacement[]>(run(0, 10).ex, 'buildings').map((b) => b.kind);
    expect(kinds.filter((k) => k === 'pc')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'mart')).toHaveLength(1);
  });

  it('every town and city: its Pokémon Center, Mart and Gym, as in the game', () => {
    // [map, pc, mart, gym] (Lilycove's Department Store is not a Mart)
    const towns: [number, number, number, number][] = [
      [0, 1, 1, 1], [1, 1, 1, 0], [2, 1, 1, 1], [3, 1, 1, 1], [4, 1, 1, 1], [5, 1, 0, 0], [6, 1, 1, 1], [7, 1, 1, 1],
      [8, 1, 0, 0], [9, 0, 0, 0], [10, 1, 1, 0], [11, 1, 0, 1], [12, 1, 1, 1], [13, 1, 1, 0], [14, 1, 1, 0], [15, 1, 0, 0],
    ];
    for (const [n, pc, mart, gym] of towns) {
      const r = run(0, n);
      const kinds = payload<BuildingPlacement[]>(r.ex, 'buildings').map((b) => b.kind);
      const count = (k: BuildingKind) => kinds.filter((x) => x === k).length;
      expect([count('pc'), count('mart'), count('gym')], r.name).toEqual([pc, mart, gym]);
    }
  });

  it('Route 101 has tall grass, Petalburg Woods a forest', () => {
    expect(payload<unknown[]>(run(0, 16).ex, 'grass').length).toBeGreaterThanOrEqual(20);
    expect(payload<unknown[]>(run(24, 11).ex, 'trees').length).toBeGreaterThanOrEqual(100);
  });

  it("Fortree's treehouse corner tiles are not trees", () => {
    // (Task 9 ruling: blocking structure tiles beside the treehouse doors stay out of the tree runs)
    const { a, ex } = run(0, 4);
    const trees = ex!.added.get('trees')!;
    for (const [x, y, m] of [[10, 14, 0x233], [39, 14, 0x237]]) {
      const i = a.idx(x, y);
      expect(a.mt[i]).toBe(m);
      expect(trees[i] & CLAIM_OBJECT, `${x},${y}`).toBe(0);
    }
  });

  it('Slateport has water with a shoreline', () => {
    const w = payload<WaterPlacement>(run(0, 1).ex, 'water');
    expect(w.cells.length).toBeGreaterThan(100);
    expect([...w.dist].filter((d) => d === 1).length).toBeGreaterThan(20);
  });

  it('indoor and cave maps are left to legacy', () => {
    expect(run(1, 0).ex).toBeNull();
    expect(run(24, 7).ex).toBeNull();
  });

  it('Dive maps: only the terrain (the seabed) is modelled', () => {
    for (const [g, n] of [[0, 50], [0, 55]]) {
      const { ex, name } = run(g, n);
      for (const f of ['buildings', 'props', 'trees', 'grass', 'flowers']) expect(payload<unknown[]>(ex, f), `${name} ${f}`).toEqual([]);
      const c = payload<CliffPlacement>(ex, 'cliffs');
      expect(c.runs.length + c.sides.length + c.ledges.length, name).toBe(0);
      const w = payload<WaterPlacement>(ex, 'water');
      expect(w.cells.length + w.rocks.length, name).toBe(0);
      expect(payload<TerrainPlacement>(ex, 'terrain').cells.length, name).toBeGreaterThan(0);
    }
  });

  it('no family fails on the regression maps; legacy coverage report', () => {
    const lines = ['Legacy coverage, regression maps: share of cells still drawn with the legacy pixel geometry',
      '("all": the map and its 14-cell border margin; "map": the map\'s own cells)', '',
      `${'map'.padEnd(12)}    all    map`];
    let sum = 0, count = 0;
    for (const [name, g, n] of REGRESSION_MAPS) {
      const r = run(g, n);
      if (r.ex) {
        expect(r.ex.report.filter((x) => !x.ok), name).toEqual([]);
        const c = coverage(r);
        sum += c.share;
        count++;
        lines.push(`${name.padEnd(12)} ${pct(c.share)} ${pct(c.inMap)}`);
      } else {
        lines.push(`${name.padEnd(12)} (indoor/cave: legacy by design)`);
      }
    }
    const avg = sum / count;
    lines.push(`${'average'.padEnd(12)} ${pct(avg)}  (outdoor maps)`);
    writeReport('coverage.txt', lines);
    expect(avg).toBeLessThanOrEqual(0.15);
  });

  it('every outdoor map: no family fails, no secret-base spot is claimed; legacy coverage report', () => {
    const skip: number[] = [MapType.INDOOR, MapType.SECRET_BASE, MapType.UNDERGROUND, MapType.UNDERWATER];
    const maps = loadAllMaps(new RomReader(loadRom())).filter((m) => !skip.includes(m.mapType));
    expect(maps.length).toBeGreaterThanOrEqual(68);
    const rows: { share: number; line: string }[] = [];
    let sum = 0, mapSum = 0, spots = 0, spotMaps = 0, claimedSpots = 0, bases = 0, b2tMap = 0, b2tBorder = 0;
    for (const m of maps) {
      const r = run(m.group, m.num);
      const { a, ex } = r;
      expect(ex, m.name).not.toBeNull();
      expect(ex!.report.filter((x) => !x.ok), m.name).toEqual([]);
      // Secret-base spots are gameplay cues: no family may model or claim them. (Every secret-base
      // bg event stands on one: the behaviour test finds them all.)
      let mapSpots = 0;
      for (let i = 0; i < a.N; i++) {
        if (!isSecretBaseSpot(a, i)) continue;
        mapSpots++;
        if (ex!.claims.bits[i]) claimedSpots++;
      }
      for (const b of m.events.bgEvents) {
        if (b.kind !== BgEventKind.SECRET_BASE) continue;
        bases++;
        expect(isSecretBaseSpot(a, a.idx(b.x, b.y)), `${m.name} ${b.x},${b.y}`).toBe(true);
      }
      spots += mapSpots;
      if (mapSpots) spotMaps++;
      // No tree stands right in front of a warp's passage (Petalburg Woods' north exit, Mt Pyre's
      // summit path, the Trainer Hill door on Route 111).
      for (const w of m.events.warps) {
        expect(ex!.added.get('trees')![a.idx(w.x, w.y - 1)] & CLAIM_OBJECT, `${m.name} warp ${w.x},${w.y}`).toBe(0);
      }
      // Tree cells the trees family took from blocks (border forests, trunk rows, 2-wide tree halves)
      // rather than from the analysis' tree ids: in the map / in the border margin.
      const trees = ex!.added.get('trees')!;
      const flowers = ex!.added.get('flowers')!;
      let fromMap = 0, fromBorder = 0, flowerCells = 0;
      for (let i = 0; i < a.N; i++) {
        if (flowers[i] & CLAIM_TOP) flowerCells++;
        if (!(trees[i] & CLAIM_OBJECT) || a.kind[i] === K.Tree) continue;
        if (inMap(r, i)) fromMap++; else fromBorder++;
      }
      b2tMap += fromMap;
      b2tBorder += fromBorder;
      const c = coverage(r);
      sum += c.share;
      mapSum += c.inMap;
      const k = c.byKind;
      const label = `${m.name} (${m.group}.${m.num})`;
      rows.push({
        share: c.share,
        line: `${label.padEnd(34)} ${MAP_TYPE_NAMES[m.mapType].padEnd(11)} ${pct(c.share)} ${pct(c.inMap)} ` +
          `${String(k[K.Block]).padStart(6)} ${String(k[K.Tree]).padStart(5)} ${String(k[K.Building]).padStart(5)} ` +
          `${String(k[K.Water]).padStart(5)} ${String(k[K.Floor] + k[K.Ledge] + k[K.Stairs]).padStart(5)} ` +
          `${`${fromMap}/${fromBorder}`.padStart(11)} ${String(flowerCells).padStart(7)} ${String(mapSpots).padStart(5)}`,
      });
    }
    rows.sort((p, q) => q.share - p.share);
    writeReport('coverage-all.txt', [
      `Legacy coverage, every outdoor map (${maps.length}; indoor, underground and Dive maps skipped), worst first.`,
      'all: legacy share of the analysed grid (the map and its 14-cell border margin); map: of the map\'s own cells.',
      'Legacy cells by kind: blocks, trees, buildings, water, walk (floor, ledges, stairs: surface not modelled).',
      'block->tree: tree cells the trees family took from blocks (border forests, trunk rows, 2-wide halves),',
      'in the map / in the margin. flowers: cells with 3D flowers. spots: secret-base spot cells (none claimed).',
      '',
      `${'map'.padEnd(34)} ${'type'.padEnd(11)}    all    map ${'blocks'.padStart(6)} trees bldgs water  walk block->tree flowers spots`,
      ...rows.map((x) => x.line),
      '',
      `average: ${pct(sum / maps.length)} all, ${pct(mapSum / maps.length)} map`,
      `block->tree cells: ${b2tMap} in maps, ${b2tBorder} in margins`,
      `secret-base spots: ${spots} cells on ${spotMaps} maps (${bases} secret-base events), ${claimedSpots} claimed`,
    ]);
    expect(bases).toBeGreaterThan(50); // (the check below is not vacuous)
    expect(spots).toBeGreaterThanOrEqual(bases);
    expect(claimedSpots).toBe(0);
  });
});
