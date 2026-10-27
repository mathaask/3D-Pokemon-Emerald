// The room shell (Phase 4, D4/D5): walls, windows, clocks, decals, doorways. Stub (Task 6): the family claims nothing and
// draws nothing; Task 7 fills it (every wall mesh carries `userData.wallDir`: the cutaway hides it with its wall).

import type { Family } from '../semantics';
import type { InteriorCatalogueEntry } from './index';

export const shellFamily: Family<null> = {
  name: 'shell',
  extract: () => null,
  build: () => null,
};

/** The shell's material kinds (Task 7: BUILDING_BODY PNC cast, ROOM_GLASS PNC cast). */
export const SHELL_CATALOGUE: readonly InteriorCatalogueEntry[] = [];
