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
import { CLAIM_DECOR, CLAIM_OBJECT, CLAIM_SURFACE } from '../../src/render/overworld/claims';
import { RomReader } from '../../src/game/rom/reader';
import { BgEventKind, loadAllMaps, MapType, MAP_TYPE_NAMES } from '../../src/game/rom/maps';
import type { BuildingPlacement, BuildingKind } from '../../src/render/kit/buildings';
import type { CliffPlacement } from '../../src/render/kit/cliffs';
import type { WaterPlacement } from '../../src/render/kit/water';
import { cellLook, decorationPixels, DECOR_MIN_PX, GroundMat, type CellLook, type TerrainPlacement } from '../../src/render/kit/terrain';
import type { FlowerCell } from '../../src/render/kit/flowers';
import { GENERAL_SEA_ROCK, GENERAL_SHOAL_TOPS } from '../../src/render/kit/tables/general';
import { SECONDARY_FLOWERS, SECONDARY_ROCK } from '../../src/render/kit/tables/secondary';
import { SYM } from '../../src/game/symbols';
import { luma } from '../../src/render/kit/palette';

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

/**
 * A cell still drawn with legacy geometry: no family drew its surface, or the object standing on it
 * (a tree, a building, a block) is not modelled. Approximate, in two ways: it ignores the top-layer
 * overhang cards (CLAIM_TOP) legacy still draws over claimed cells, so the shares understate legacy;
 * and a claim is not a drawing — art no family models on a cell another family claimed is simply lost
 * and counts as modelled (until Task 15c, the town flower beds the terrain painted over; the terrain
 * now leaves ground decoration it cannot paint to the legacy art).
 */
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
  /** Legacy cells by analysis kind (K), over the whole analysed grid (margin included). */
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

  it("town flower beds are 3D flowers (Route 117, Verdanturf, Ever Grande; stairs too), and Dewford's bushes are none", () => {
    // (Task 15c: before, Route 117's 52 and Ever Grande's 152 bed cells were painted over as plain ground)
    for (const [g, n, beds, stairs] of [[0, 32, 52, 0], [0, 14, 12, 0], [0, 8, 341, 60]]) {
      const r = run(g, n);
      const ids = SECONDARY_FLOWERS.get(r.a.opts.secondaryTileset ?? 0)!;
      const cells = payload<FlowerCell[]>(r.ex, 'flowers');
      const at = new Map(cells.map((c) => [r.a.idx(c.x, c.y), c]));
      let bedCells = 0, stairCells = 0;
      for (let i = 0; i < r.a.N; i++) {
        const k = r.a.kind[i];
        if ((k !== K.Floor && k !== K.Stairs) || !ids.has(r.a.mt[i])) continue;
        bedCells++;
        if (k === K.Stairs) stairCells++;
        const c = at.get(i);
        expect(c, `${r.name} ${r.a.cellX(i)},${r.a.cellY(i)}`).toBeDefined();
        expect(c!.second, `${r.name} ${r.a.cellX(i)},${r.a.cellY(i)}: two kinds of flowers`).toBeDefined();
      }
      expect(bedCells, r.name).toBeGreaterThanOrEqual(beds);
      expect(stairCells, r.name).toBeGreaterThanOrEqual(stairs);
    }
    // Dewford's bush tiles (sand or sea showing between the leaves) are no flowers
    // (Dewford Town, Routes 105-107: no flowers at all)
    for (const n of [11, 20, 21, 22]) expect(payload<FlowerCell[]>(run(0, n).ex, 'flowers'), `0.${n}`).toEqual([]);
  });

  it('covered floor art takes the look of its top layer; landmarks in the floor keep their pixel art', () => {
    // (Task 16a: before, the terrain tinted these from the layer under the art: grass, the rock face)
    const look = (g: number, n: number, cells: [number, number][]) => {
      const r = run(g, n);
      const at = new Map(payload<TerrainPlacement>(r.ex, 'terrain').cells.map((c) => [c.i, c]));
      return cells.map(([x, y]) => {
        const c = at.get(r.a.idx(x, y));
        expect(c, `${r.name} ${x},${y}`).toBeDefined();
        return c!;
      });
    };
    // Ever Grande's brick path (0x23d, bricks over grass): brick-red, not grass
    for (const c of look(0, 8, [[17, 9], [18, 9], [19, 10], [18, 15]])) {
      expect(c.mat).not.toBe(GroundMat.Grass);
      expect(c.tint[0]).toBeGreaterThan(c.tint[1] + 0.1);
    }
    // General rock tops (0xbe, Mossdeep): the light top, not the dark face; Fallarbor's ash rock tops
    for (const c of [...look(0, 6, [[75, 36]]), ...look(0, 29, [[28, 54], [11, 36]])]) expect(luma(c.tint)).toBeGreaterThan(0.6);
    // Battle Frontier East's Poké Ball emblem, the Battle Pike's jaw (West), Route 109's beach towels
    const kept: [number, number, [number, number][]][] = [
      [26, 14, [14, 15, 16, 17, 18].flatMap((x) => [15, 16, 17].map((y) => [x, y] as [number, number]))],
      [26, 4, [[40, 28], [42, 28], [44, 28], [41, 29], [42, 29], [43, 29]]],
      [0, 24, [[9, 9], [9, 10], [9, 11], [16, 53], [20, 56]]],
    ];
    for (const [g, n, cells] of kept) {
      const r = run(g, n);
      for (const [x, y] of cells) {
        expect(r.a.kind[r.a.idx(x, y)], `${r.name} ${x},${y}`).toBe(K.Floor);
        expect(r.ex!.claims.bits[r.a.idx(x, y)], `${r.name} ${x},${y}`).toBe(0);
      }
    }
  });

  it("the Trainer Hill's green facade on Route 111 is no tree", () => {
    const { a, ex } = run(0, 26);
    const trees = ex!.added.get('trees')!;
    for (const [x, y] of [[30, 107], [31, 107], [32, 107], [30, 110]]) {
      expect(a.kind[a.idx(x, y)], `${x},${y}`).toBe(K.Tree); // (the analysis takes it for trees by its green)
      expect(trees[a.idx(x, y)] & CLAIM_OBJECT, `${x},${y}`).toBe(0);
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

  it('mountain maps and Sootopolis: their rock is 3D, the crater walls in their own cream', () => {
    // Legacy shares at most (whole grid with its margin, the map's own cells), a hair over the Task 15b
    // numbers. Before it (all / map): Mt Chimney 89.9 / 72.7 %, Jagged Pass 81.1 / 41.3, Route 112
    // 79.6 / 49.3, Route 111 62.0 / 30.1, Route 114 19.0 / 43.5, Lavaridge 87.6 / 28.5, Sootopolis
    // 77.6 / 51.8. The map's cells guard the 3D rock itself (the margin is mostly flat ground).
    // (Route 111's map share since Task 15c: 28.79 -> 28.98 %, its 11 colour-guessed "trees" without
    // foliage, the Trainer Hill's facade and log posts, keep their legacy art.)
    const limits: [number, number, number, number][] = [
      [24, 12, 0.45, 0.66], [24, 13, 0.22, 0.396], [0, 27, 0.235, 0.45], [0, 26, 0.16, 0.291], [0, 29, 0.135, 0.31],
      [0, 12, 0.165, 0.234], [0, 7, 0.255, 0.348],
    ];
    for (const [g, n, all, own] of limits) {
      const r = run(g, n);
      const c = coverage(r);
      expect(c.share, `${r.name} all`).toBeLessThanOrEqual(all);
      expect(c.inMap, `${r.name} map`).toBeLessThanOrEqual(own);
    }
    // Sea-rock coasts: no land cell is legacy that was modelled before Task 15b. Mossdeep 365 / 3200
    // legacy map cells (11.41 %) and Route 126 1523 / 6400 (23.80 %) before, with General sea-rock
    // cells 72 and 132 of them; their sea rocks (27 and 17 cells, the cliff boxes before) are legacy
    // now by design, so the land shares are the guard: Mossdeep 293 -> 293, Route 126 1391 -> 1376.
    for (const [g, n, land, own] of [[0, 6, 293 / 3200, 0.1225], [0, 41, 1391 / 6400, 0.2383]]) {
      const r = run(g, n);
      let cells = 0, legacyLand = 0;
      for (let i = 0; i < r.a.N; i++) {
        if (r.a.kind[i] === K.Void || !inMap(r, i)) continue;
        cells++;
        if (isLegacy(r.a, r.ex, i) && !(r.a.isGeneralId(r.a.mt[i]) && GENERAL_SEA_ROCK.has(r.a.mt[i]))) legacyLand++;
      }
      expect(legacyLand / cells, `${r.name} land`).toBeLessThanOrEqual(land + 1e-9);
      expect(coverage(r).inMap, `${r.name} map`).toBeLessThanOrEqual(own);
    }
    // Sootopolis: the walls of its crater rock (its own table's ids) are light, not brown
    const r = run(0, 7);
    const soot = SECONDARY_ROCK.get(SYM.gTileset_Sootopolis)!;
    const crater = payload<CliffPlacement>(r.ex, 'cliffs').runs.filter((c) => {
      const i = r.a.idx(c.x, Math.round(c.zf - 1 - Math.max(c.hB, 0)));
      return r.a.inside(c.x, r.a.cellY(i)) && soot.has(r.a.mt[i]);
    });
    expect(crater.length).toBeGreaterThan(50);
    for (const c of crater) expect(luma(c.tint), `${c.x},${c.zf}`).toBeGreaterThan(0.6);
  });

  it('no family fails on the regression maps; legacy coverage report', () => {
    const lines = ['Legacy coverage, regression maps: share of cells still drawn with the legacy pixel geometry',
      '("all": the map and its 14-cell border margin; "map": the map\'s own cells). Approximate: overhang cards',
      '(CLAIM_TOP) are ignored, so legacy is understated, and claimed cells whose art no family draws count as modelled.', '',
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
    let sum = 0, mapSum = 0, spots = 0, spotMaps = 0, claimedSpots = 0, bases = 0, nonTreeMap = 0, nonTreeBorder = 0, keptAll = 0;
    const keptCells: string[] = [];
    const seaCliffs: string[] = [];
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
      // Brown rock standing in the sea is never a cliff box: it keeps its legacy art.
      const cliffs = ex!.added.get('cliffs')!;
      // Nor is a shoal rock, whatever its size: no cliff cell right under a shoal rock's top (its own
      // lower rows), nor standing on one.
      const shoalTop = (x: number, y: number) => a.inside(x, y) && a.isGeneralId(a.mt[a.idx(x, y)]) && GENERAL_SHOAL_TOPS.has(a.mt[a.idx(x, y)]);
      for (let i = 0; i < a.N; i++) {
        if (!cliffs[i]) continue;
        const x = a.cellX(i), y = a.cellY(i);
        if ((a.isGeneralId(a.mt[i]) && GENERAL_SEA_ROCK.has(a.mt[i])) || shoalTop(x, y - 1) || shoalTop(x, y + 1)) seaCliffs.push(`${m.name} ${x},${y}`);
      }
      // No tree stands right in front of a warp's passage (Petalburg Woods' north exit, Mt Pyre's
      // summit path, the Trainer Hill door on Route 111). A fact about this ROM, not a guarantee of the
      // code: trees.ts only clears the analysis' colour-guessed trees there (General tree ids and
      // trees taken from blocks stay), and no warp here has any of those north of it.
      const trees = ex!.added.get('trees')!;
      for (const w of m.events.warps) {
        expect(trees[a.idx(w.x, w.y - 1)] & CLAIM_OBJECT, `${m.name} warp ${w.x},${w.y}`).toBe(0);
        // nor anywhere along that passage (the colour-guessed trees running north from it)
        for (let y = w.y - 1; a.inside(w.x, y); y--) {
          const i = a.idx(w.x, y);
          if (a.kind[i] !== K.Tree || a.isGeneralId(a.mt[i])) break;
          expect(trees[i] & CLAIM_OBJECT, `${m.name} warp ${w.x},${w.y}: ${w.x},${y}`).toBe(0);
        }
      }
      // Trees on non-K.Tree cells: cells the trees family claims as trees whose analysis kind is not
      // K.Tree (blocks: border forests, trunk rows, 2-wide halves; stray building-region cells), in the
      // map / in the border margin.
      const flowers = ex!.added.get('flowers')!;
      let fromMap = 0, fromBorder = 0, flowerCells = 0;
      // Ground art the terrain leaves to the legacy art (decoration no family models: the safeguard)
      const looks = new Map<number, CellLook>(), decor = new Map<number, number>();
      let kept = 0;
      for (let i = 0; i < a.N; i++) {
        if ((a.kind[i] !== K.Floor && a.kind[i] !== K.Stairs) || ex!.claims.bits[i] & (CLAIM_SURFACE | CLAIM_DECOR)) continue;
        const mt = a.mt[i];
        if (!decor.has(mt)) decor.set(mt, decorationPixels(a.info, mt, cellLook(a, mt, looks).tint));
        if (decor.get(mt)! >= DECOR_MIN_PX) { kept++; keptCells.push(`${m.name} ${a.cellX(i)},${a.cellY(i)} 0x${mt.toString(16)}`); }
      }
      keptAll += kept;
      for (let i = 0; i < a.N; i++) {
        if (flowers[i] & CLAIM_DECOR) flowerCells++;
        if (!(trees[i] & CLAIM_OBJECT) || a.kind[i] === K.Tree) continue;
        if (inMap(r, i)) fromMap++; else fromBorder++;
      }
      nonTreeMap += fromMap;
      nonTreeBorder += fromBorder;
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
          `${`${fromMap}/${fromBorder}`.padStart(16)} ${String(flowerCells).padStart(7)} ${String(mapSpots).padStart(5)} ${String(kept).padStart(5)}`,
      });
    }
    rows.sort((p, q) => q.share - p.share);
    writeReport('coverage-all.txt', [
      `Legacy coverage, every outdoor map (${maps.length}; indoor, underground and Dive maps skipped), worst first.`,
      'all: legacy share of the analysed grid (the map and its 14-cell border margin); map: of the map\'s own cells.',
      'Approximate: overhang cards (CLAIM_TOP) are ignored, so legacy is understated, and claimed cells whose art no',
      'family draws count as modelled.',
      'Legacy cells by kind (over the whole grid, margin included): blocks, trees, buildings, water, walk (floor,',
      'ledges, stairs: surface not modelled).',
      'non-K.Tree trees: cells the trees family claims as trees whose analysis kind is not K.Tree (blocks: border',
      'forests, trunk rows, 2-wide halves; stray building-region cells), in the map / in the margin.',
      'flowers: cells with 3D flowers. spots: secret-base spot cells (none claimed). decor: walkable cells whose ground',
      'art is decoration no family models (vivid compact blobs >= DECOR_MIN_PX px): the terrain leaves them to the legacy art.',
      '',
      `${'map'.padEnd(34)} ${'type'.padEnd(11)}    all    map ${'blocks'.padStart(6)} trees bldgs water  walk non-K.Tree trees flowers spots decor`,
      ...rows.map((x) => x.line),
      '',
      `average: ${pct(sum / maps.length)} all, ${pct(mapSum / maps.length)} map`,
      `trees on non-K.Tree cells: ${nonTreeMap} in maps, ${nonTreeBorder} in margins`,
      `secret-base spots: ${spots} cells on ${spotMaps} maps (${bases} secret-base events), ${claimedSpots} claimed`,
      `decoration left to the legacy art: ${keptAll} cells${keptCells.length ? ` (${keptCells.join('; ')})` : ''}`,
    ]);
    expect(bases).toBeGreaterThan(50); // (the check below is not vacuous)
    expect(spots).toBeGreaterThanOrEqual(bases);
    expect(claimedSpots).toBe(0);
    expect(seaCliffs).toEqual([]);
    // The terrain's safeguard keeps little: decoration, never plain ground (Task 15c survey: 0 cells
    // once the town flower beds are 3D flowers; the rule alone would keep the 93 bed cells it sees).
    expect(keptAll).toBeLessThanOrEqual(8);
  });
});
