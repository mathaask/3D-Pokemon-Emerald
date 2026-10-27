// gTileset_PokemonCenter (34 in-scope maps: every Pokémon Center 1F / 2F …): what its secondary ids (0x200–0x3FF) are,
// curated from its maps (Phase 4 Task 4b; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PokemonCenter --sheet-scale 5 --sheet-chunk 32).

import type { InteriorId, InteriorTable } from '../building';

export const POKEMON_CENTER: InteriorTable = {
  name: 'PokemonCenter',
  ids: new Map<number, InteriorId>([]),
  target: 0,
  pins: [],
};
