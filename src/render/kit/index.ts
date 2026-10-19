// Model families in claim-priority order: objects first, terrain last (it covers the ground
// under every object the earlier families claimed).

import { cliffFamily } from './cliffs';
import type { Family } from './semantics';
import { terrainFamily } from './terrain';
import { waterFamily } from './water';

export const FAMILIES: readonly Family<unknown>[] = [
  cliffFamily,
  waterFamily,
  terrainFamily,
];
