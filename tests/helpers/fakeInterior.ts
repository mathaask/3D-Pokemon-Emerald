// A tiny synthetic in-scope interior for unit tests that need a MapAnalysis and its interior ids without the ROM.
import { MB } from '../../src/game/behaviors';
import { analyze, type MapAnalysis } from '../../src/render/overworld/analyze';
import { seedInteriorIds, type InteriorId } from '../../src/render/kit/tables/building';
import type { GridData } from '../../src/render/overworld/world';
import { fakeInfo } from './fakeMap';

export interface FakeCell { mt: number; blocked: boolean; beh?: number; id: InteriorId | null }

/** The void metatile (the border, `isVoid`). */
export const VOID_MT = 1;

/** The default legend: one metatile per character ('_': a Sootopolis floor block of metatile 0x3FF). */
export const INTERIOR_LEGEND: Record<string, FakeCell> = {
  ' ': { mt: VOID_MT, blocked: true, id: null },
  W: { mt: 0x201, blocked: true, id: 'wall' },
  O: { mt: 0x202, blocked: true, id: 'window' },
  C: { mt: 0x203, blocked: true, id: 'clock' },
  D: { mt: 0x204, blocked: true, id: 'decor' },
  '.': { mt: 0x205, blocked: false, id: 'boards' },
  r: { mt: 0x206, blocked: false, id: 'rug' },
  T: { mt: 0x207, blocked: true, id: 'table' },
  c: { mt: 0x208, blocked: true, id: 'chair' },
  B: { mt: 0x209, blocked: true, id: 'bookshelf' },
  F: { mt: 0x20a, blocked: true, id: 'fridge' },
  M: { mt: 0x20b, blocked: false, beh: MB.SOUTH_ARROW_WARP, id: 'mat' },
  E: { mt: 0x20c, blocked: false, beh: MB.EAST_ARROW_WARP, id: 'mat' },
  S: { mt: 0x20d, blocked: false, id: 'stairsUp' },
  s: { mt: 0x20e, blocked: false, id: 'stairsDown' },
  '?': { mt: 0x20f, blocked: true, id: null },
  // metatile 0x3FF with its own bits (walkable, elevation 3): the classifier reads the border (void) there (`real3ff`)
  _: { mt: 0x3ff, blocked: false, id: null },
};

/**
 * An indoor analysis of `rows` (margin 1, the border the void metatile 1 with `isVoid`), its ids from the legend (the
 * default one, overridden / extended by `legend`), seeded with `seedInteriorIds(a, ids)` so that `interiorIds(a)` (what
 * the families' `extract` reads) returns them.
 */
export function fakeInterior(rows: string[], legend?: Record<string, FakeCell>): { a: MapAnalysis; ids: (InteriorId | null)[] } {
  const L = { ...INTERIOR_LEGEND, ...legend };
  const info = fakeInfo();
  info.isVoid[VOID_MT] = 1;
  for (const c of Object.values(L)) info.attributes[c.mt] = c.beh ?? MB.NORMAL;
  const w = Math.max(...rows.map((r) => r.length)), h = rows.length;
  const cells = new Uint16Array(w * h);
  const cellOf = (ch: string) => {
    const c = L[ch];
    if (!c) throw new Error(`fakeInterior: no legend entry for '${ch}'`);
    return c;
  };
  rows.forEach((r, y) => [...r.padEnd(w)].forEach((ch, x) => {
    const c = cellOf(ch);
    cells[y * w + x] = c.mt | (c.blocked ? 0x0400 : 0) | 0x3000;
  }));
  const grid: GridData = { width: w, height: h, cells, border: [VOID_MT | 0x0400], borderW: 1, borderH: 1, borderPhase: 0 };
  const a = analyze(grid, { info, generalPrimary: false, indoor: true, underground: false, underwater: false, margin: 1 });
  const byMt = new Map<number, InteriorId | null>();
  for (const c of Object.values(L)) byMt.set(c.mt, c.id);
  const ids = new Array<InteriorId | null>(a.N);
  for (let i = 0; i < a.N; i++) ids[i] = byMt.get(a.mt[i]) ?? null;
  seedInteriorIds(a, ids);
  return { a, ids };
}
