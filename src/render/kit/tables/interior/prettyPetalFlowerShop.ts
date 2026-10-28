// gTileset_PrettyPetalFlowerShop: the Pretty Petal flower shop 17.1 (not its unreachable prototype 27.1).
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4e (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PrettyPetalFlowerShop
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const PRETTY_PETAL_FLOWER_SHOP: InteriorTable = {
  name: 'PrettyPetalFlowerShop', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_Building,
  maps: ['17.1'],
};
