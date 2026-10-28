// gTileset_Facility: Devon Corp 1F / 3F 11.0 / 11.2 (its General-primary maps are Phase 4c's).
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only Facility
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const FACILITY: InteriorTable = {
  name: 'Facility', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_Building,
  maps: ['11.0', '11.2'],
};
