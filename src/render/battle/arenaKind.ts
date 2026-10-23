// Arena kinds on the render side: the game semantics (which background the GBA draws, its ROM graphics) re-exported
// from src/game/battle/arenaKind.ts, plus the kind of place each arena shows (a render classification).

import type { ArenaKind } from '../../game/battle/arenaKind';

export * from '../../game/battle/arenaKind';

export type ArenaSetting = 'outdoor' | 'water' | 'underwater' | 'cave' | 'indoor' | 'sky';

/** outdoor: grass, longGrass, plain, sand, mountain; water: water, pond; underwater; cave: cave, cavePond, groudon,
 *  kyogre (Marine Cave); indoor: building, gym, leader, frontier, magma, aqua, sidney, phoebe, glacia, drake, champion;
 *  sky: rayquaza (Sky Pillar). */
export const ARENA_SETTING: Readonly<Record<ArenaKind, ArenaSetting>> = {
  grass: 'outdoor', longGrass: 'outdoor', plain: 'outdoor', sand: 'outdoor', mountain: 'outdoor',
  water: 'water', pond: 'water',
  underwater: 'underwater',
  cave: 'cave', cavePond: 'cave', groudon: 'cave', kyogre: 'cave',
  building: 'indoor', gym: 'indoor', leader: 'indoor', frontier: 'indoor', magma: 'indoor', aqua: 'indoor',
  sidney: 'indoor', phoebe: 'indoor', glacia: 'indoor', drake: 'indoor', champion: 'indoor',
  rayquaza: 'sky',
};
