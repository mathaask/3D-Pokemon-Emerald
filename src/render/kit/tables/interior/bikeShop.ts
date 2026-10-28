// gTileset_BikeShop: Rydel's Cycles 10.1 (General primary: its General ids < 512 are labelled here; not New Mauville 24.53).
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only BikeShop
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const BIKE_SHOP: InteriorTable = {
  name: 'BikeShop', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_General,
  maps: ['10.1'],
};
