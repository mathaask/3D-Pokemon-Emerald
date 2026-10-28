// gTileset_SeashoreHouse: the Seashore House 28.0.
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4e (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only SeashoreHouse
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const SEASHORE_HOUSE: InteriorTable = {
  name: 'SeashoreHouse', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_Building,
  maps: ['28.0'],
};
