// gTileset_EliteFour: the Elite Four rooms 16.0–16.4 and halls 16.5–16.9 (entrance / exit doors).
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4c (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only EliteFour
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const ELITE_FOUR: InteriorTable = {
  name: 'EliteFour', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_Building,
  maps: ['16.0', '16.1', '16.2', '16.3', '16.4', '16.5', '16.6', '16.7', '16.8', '16.9'],
};
