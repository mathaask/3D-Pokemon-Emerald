// Tiny synthetic map for unit tests that need a MapAnalysis without the ROM.
import { analyze, type ClassifyOptions, type MapAnalysis } from '../../src/render/overworld/analyze';
import type { TileInfo } from '../../src/render/overworld/tileInfo';
import type { GridData } from '../../src/render/overworld/world';

export function fakeInfo(): TileInfo {
  return {
    both: new Uint16Array(1024 * 256).fill(0x8000), bottom: new Uint16Array(1024 * 256).fill(0x8000),
    topCover: new Uint16Array(1024), bottomCover: new Uint16Array(1024), green: new Float32Array(1024),
    blue: new Float32Array(1024), isVoid: new Uint8Array(1024), attributes: new Uint16Array(1024),
  };
}

/** `rows` of characters: '.' walkable metatile 1, '#' blocked metatile 2. */
export function fakeGrid(rows: string[]): GridData {
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === '#' ? 2 | 0x0400 : 1 | 0x3000; }));
  return { width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 };
}

/** An outdoor map by default; `opts` overrides the map-type flags. */
export function fakeAnalysis(rows: string[], opts: Partial<Omit<ClassifyOptions, 'info'>> = {}): MapAnalysis {
  const info = fakeInfo();
  return analyze(fakeGrid(rows), {
    info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 1, ...opts,
  });
}
