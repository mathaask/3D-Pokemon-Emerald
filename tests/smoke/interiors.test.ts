// Interiors on the real maps (Phase 4 Task 12, needs the ROM): every in-scope interior (interiorScope, 137 maps)
// extracted as World.build runs the interior families (margin 14, floors flattened, furniture → shell → floor). Pins
// the Pokémon Centers (one healing machine, one nurse counter), the Marts (shelves and a counter), the interaction-
// behaviour cells (each modelled as its kind), sound room layouts, the houses' furniture, and writes the coverage report:
//   out/coverage-interiors.txt  per in-scope map, the legacy share of its in-map non-void cells (worst first) + average;
//                               legacy = no CLAIM_SURFACE, or blocked and no CLAIM_OBJECT
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiors.test.ts

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { loadRom, loadStaticMap } from './helpers/staticMap';
import { analyze, K, type MapAnalysis } from '../../src/render/overworld/analyze';
import { flattenFloors } from '../../src/render/overworld/world';
import { RomReader } from '../../src/game/rom/reader';
import { loadAllMaps } from '../../src/game/rom/maps';
import { MB } from '../../src/game/behaviors';
import { extractAll, type Extracted } from '../../src/render/kit/semantics';
import { gridEvents } from '../../src/render/kit/events';
import { CLAIM_OBJECT, CLAIM_SURFACE } from '../../src/render/overworld/claims';
import { INTERIOR_FAMILIES } from '../../src/render/kit/interior/index';
import { interiorScope } from '../../src/render/kit/interior/scope';
import { roomLayout, checkRoomLayout, type RoomLayout } from '../../src/render/kit/interior/room';
import { BEHAVIOR_IDS, interiorIds } from '../../src/render/kit/tables/building';
import type { FurniturePiece } from '../../src/render/kit/interior/furniture';

const OUT = path.resolve(import.meta.dirname, '../../out');
/** The world's margin (World.margin). */
const MARGIN = 14;

// Every in-scope map once (loadAllMaps + interiorScope), with what the tests read: its analysis, ids, room layout and the
// furniture family's pieces, extracted as World.build runs the interior families.
interface Scoped {
  name: string; group: number; num: number; width: number; height: number;
  a: MapAnalysis; ex: Extracted; layout: RoomLayout; pieces: FurniturePiece[]; warps: ReturnType<typeof gridEvents>['warps'];
  beh(i: number): number;
}

function loadInScope(): Scoped[] {
  const out: Scoped[] = [];
  for (const m of loadAllMaps(new RomReader(loadRom()))) {
    const s = loadStaticMap(m.group, m.num);
    if (!interiorScope(s.opts, `${m.group}.${m.num}`)) continue;
    const a = analyze(s.grid, { ...s.opts, margin: MARGIN });
    flattenFloors(a);
    const events = gridEvents(s.map.events, 0);
    const ex = extractAll({ a, events, quality: 'medium' }, INTERIOR_FAMILIES);
    out.push({
      name: s.map.name, group: m.group, num: m.num, width: s.grid.width, height: s.grid.height, a, ex,
      layout: roomLayout(a, interiorIds(a), events.warps), warps: events.warps,
      pieces: (ex.payloads.get('furniture') ?? []) as FurniturePiece[],
      beh: (i) => a.beh[i],
    });
  }
  return out;
}

const IN_SCOPE: Scoped[] = loadInScope();
const byName = (re: RegExp) => IN_SCOPE.filter((m) => re.test(m.name));
const PC_1F = byName(/_PokemonCenter_1F$/);                     // the 16 Pokémon Center 1F maps
const MARTS = byName(/_Mart$/);                                 // the 12 Marts (out/atlas/stats.txt; UnusedMart does not match)
/** Pieces per kind on a map. */
const kinds = (m: Scoped) => m.pieces.reduce<Record<string, number>>((k, p) => ({ ...k, [p.kind]: (k[p.kind] ?? 0) + 1 }), {});
const at = (g: number, n: number) => IN_SCOPE.find((m) => m.group === g && m.num === n)!;
/** Cells of `m` whose behaviour is one of `behs`; the kind of the piece that holds cell `i` (null: none). */
const cellsWithBehaviour = (m: Scoped, behs: number[]) => [...Array(m.a.N).keys()].filter((i) => behs.includes(m.beh(i)));
const pieceKindAt = (m: Scoped, i: number) => m.pieces.find((p) => p.cells.includes(i))?.kind ?? null;

const inMap = (m: Scoped, i: number) => {
  const x = m.a.cellX(i), y = m.a.cellY(i);
  return x >= 0 && y >= 0 && x < m.width && y < m.height;
};
/** Drawn with legacy geometry: no family drew its surface, or it is blocked and no family modelled what stands on it. */
const isLegacy = (m: Scoped, i: number) => {
  const bits = m.ex.claims.bits[i];
  return !(bits & CLAIM_SURFACE) || (m.a.col[i] !== 0 && !(bits & CLAIM_OBJECT));
};

interface MapCoverage { name: string; key: string; cells: number; legacy: number; share: number }
/** Maps over 25 % legacy the controller ruled acceptable (none). */
const RULED_OVER_25: string[] = [];

function coverageAll(maps: Scoped[]): { maps: MapCoverage[]; average: number; over25: MapCoverage[] } {
  const rows = maps.map((m): MapCoverage => {
    let cells = 0, legacy = 0;
    for (let i = 0; i < m.a.N; i++) {
      if (m.a.kind[i] === K.Void || !inMap(m, i)) continue;
      cells++;
      if (isLegacy(m, i)) legacy++;
    }
    return { name: m.name, key: `${m.group}.${m.num}`, cells, legacy, share: cells ? legacy / cells : 0 };
  }).sort((p, q) => q.share - p.share || p.key.localeCompare(q.key));
  const average = rows.reduce((s, r) => s + r.share, 0) / Math.max(1, rows.length);
  return { maps: rows, average, over25: rows.filter((r) => r.share > 0.25) };
}

describe('interiors on the real maps', () => {
  it('extracts every in-scope interior without a failing family', () => {
    expect(IN_SCOPE).toHaveLength(137);                        // (138 on the five secondaries, less the Dept Store rooftop)
    const failed = IN_SCOPE.flatMap((m) => m.ex.report.filter((r) => !r.ok).map((r) => `${m.group}.${m.num} ${r.name}: ${r.error}`));
    expect(failed).toEqual([]);
  });

  it('models exactly one healing machine and one nurse counter in every Pokémon Center 1F', () => {
    expect(PC_1F).toHaveLength(16);
    for (const m of PC_1F) { const k = kinds(m); expect(k.healer, m.name).toBe(1); expect(k.pcCounter, m.name).toBe(1); }
  });

  it('gives every Mart shelves and a counter', () => {
    expect(MARTS).toHaveLength(12);
    for (const m of MARTS) { const k = kinds(m); expect(k.martShelf, m.name).toBeGreaterThanOrEqual(2); expect(k.counter, m.name).toBeGreaterThanOrEqual(1); }
  });

  it('models every interaction-behaviour cell as its kind', () => {
    let n = 0;
    for (const m of IN_SCOPE) for (const i of cellsWithBehaviour(m, [MB.TELEVISION, MB.PC, MB.BOOKSHELF, MB.PICTURE_BOOK_SHELF,
      MB.POKEMON_CENTER_BOOKSHELF, MB.SHOP_SHELF])) { n++; expect(pieceKindAt(m, i), `${m.name} ${i}`).toBe(BEHAVIOR_IDS.get(m.beh(i))); }
    expect(n).toBeGreaterThan(300);                                  // (419 cells at Task 12: never a vacuous pass)
  });

  it('lays sound room layouts on every in-scope map', () => {
    for (const m of IN_SCOPE) expect(checkRoomLayout(m.a, m.layout, m.warps), m.name).toEqual([]);
  });

  it('leaves no lone one-cell partition (a blocked clock or decor cell inside a room)', () => {
    const lone: string[] = [];
    for (const m of IN_SCOPE) {
      const { a, layout: L } = m;
      for (let i = 0; i < a.N; i++) {
        if (!L.partition[i]) continue;
        const x = a.cellX(i), y = a.cellY(i);
        const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => a.inside(x + dx, y + dy) && L.partition[a.idx(x + dx, y + dy)]);
        if (!nb) lone.push(`${m.group}.${m.num} (${x},${y}) ${interiorIds(a)[i]}`);
      }
    }
    expect(lone).toEqual([]);
  });

  it('furnishes the houses', () => {
    expect(kinds(at(1, 0))).toMatchObject({ table: 1, tv: 1, stairsUp: 1 });     // Brendan's 1F
    expect(kinds(at(1, 1))).toMatchObject({ bed: 1, pc: 1, stairsDown: 1 });     // Brendan's 2F
  });

  it('writes the coverage report and holds it', () => {
    const c = coverageAll(IN_SCOPE);
    const pct = (v: number) => `${(v * 100).toFixed(1)}%`.padStart(6);
    const lines = [
      `Legacy coverage, in-scope interiors (${c.maps.length}; Modern, interior families): share of in-map non-void cells still`,
      'drawn with the legacy pixel geometry (no CLAIM_SURFACE, or blocked without CLAIM_OBJECT), worst first.',
      `average ${pct(c.average)}   over 25 %: ${c.over25.length ? c.over25.map((m) => `${m.key} ${m.name}`).join(', ') : 'none'}`,
      '',
      ...c.maps.map((m) => `${pct(m.share)}  ${String(m.legacy).padStart(4)}/${String(m.cells).padEnd(4)}  ${m.key.padEnd(6)} ${m.name}`),
    ];
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'coverage-interiors.txt'), lines.join('\n') + '\n');
    expect(c.average).toBeLessThanOrEqual(0.10);
    expect(c.over25.map((m) => m.name)).toEqual(RULED_OVER_25);   // [] unless the controller rules otherwise
  });
});
