// Turns the 2D metatile grid into 3D geometry by "un-projecting" the GBA's oblique view.
// The work is split: analyze.ts (cell kinds, heights, buildings) and legacyQuads.ts (the
// pixel-textured quads). This wrapper keeps the original single-call API.

import { analyze, queries, type CellQueries, type ClassifyOptions } from './analyze';
import { emitLegacy, type Quad, type TreeQuad } from './legacyQuads';
import type { GridData } from './world';

export type { ClassifyOptions } from './analyze';
export type { Vec3, Quad, TreeQuad } from './legacyQuads';
export { isWaterBehavior } from './analyze';

export interface CellModel extends CellQueries {
  quads: Quad[];
  /** Camera-facing tree rows (see treeCards.ts). */
  trees: TreeQuad[];
}

export function classify(grid: GridData, opts: ClassifyOptions): CellModel {
  const a = analyze(grid, opts);
  return { ...queries(a), ...emitLegacy(a) };
}
