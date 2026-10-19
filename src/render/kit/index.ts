// Model families in claim-priority order: objects first, terrain last (it covers the ground
// under every object the earlier families claimed).

import { buildingFamily } from './buildings';
import { cliffFamily } from './cliffs';
import { flowerFamily } from './flowers';
import { grassFamily } from './grass';
import type { Family } from './semantics';
import { terrainFamily } from './terrain';
import { treeFamily } from './trees';
import { waterFamily } from './water';

export const FAMILIES: readonly Family<unknown>[] = [
  buildingFamily,
  treeFamily,
  cliffFamily,
  grassFamily,
  flowerFamily,
  waterFamily,
  terrainFamily,
];
