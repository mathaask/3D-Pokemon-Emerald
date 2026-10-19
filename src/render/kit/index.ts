// Model families in claim-priority order: objects first, terrain last (it covers the ground
// under every object the earlier families claimed).

import type { Family } from './semantics';
import { buildingFamily } from './buildings';
import { propFamily } from './props';
import { treeFamily } from './trees';
import { cliffFamily } from './cliffs';
import { grassFamily } from './grass';
import { flowerFamily } from './flowers';
import { waterFamily } from './water';
import { terrainFamily } from './terrain';
import { installGeneralTables } from './tables/general';

installGeneralTables();

export const FAMILIES: readonly Family<unknown>[] = [
  buildingFamily, propFamily, treeFamily, cliffFamily, grassFamily, flowerFamily, waterFamily, terrainFamily,
];
