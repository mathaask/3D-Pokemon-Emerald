// Room floors (Phase 4, D3): boards, tiles, carpet, rugs, mats in their own program. Stub (Task 6): the family claims
// nothing and draws nothing; Task 8 fills it (and the window light shafts, shafts.ts).

import type { Family } from '../semantics';
import type { InteriorCatalogueEntry } from './index';

export const floorFamily: Family<null> = {
  name: 'floor',
  extract: () => null,
  build: () => null,
};

/** The floor's material kinds (Task 8: interiorFloorMaterial PN no cast; roomShaftMaterial PNC no cast). */
export const FLOOR_CATALOGUE: readonly InteriorCatalogueEntry[] = [];
