// gTileset_PokemonFanClub: the Pokémon Fan Club 9.6.
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4e (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PokemonFanClub
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const POKEMON_FAN_CLUB: InteriorTable = {
  name: 'PokemonFanClub', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_Building,
  maps: ['9.6'],
};
