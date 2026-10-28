// gTileset_LavaridgeGym: Lavaridge Gym 1F / B1F 4.1 / 4.2 (sand, geyser holes, ledges).
// What its ids are: a scaffold (Phase 4b Task 2 sets `maps` and `primary`), curated by Task 4b (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only LavaridgeGym
// --sheet-scale 5 --sheet-chunk 32).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();

export const LAVARIDGE_GYM: InteriorTable = {
  name: 'LavaridgeGym', ids, puzzle, target: 0, pins: [],
  primary: SYM.gTileset_Building,
  maps: ['4.1', '4.2'],
};
