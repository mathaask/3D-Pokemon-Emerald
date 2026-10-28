// gTileset_MossdeepGameCorner: the Mossdeep Game Corner 1F 14.11 (perimeter shell), curated by Phase 4b Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only MossdeepGameCorner
// --sheet-scale 5 --sheet-chunk 32).
//
// Labelling rules beyond Phase 4's:
// - Live ids: the counter's gate at (5, 2) / (5, 3) is opened and closed by a shared script (CounterClosed_Top /
//   _Bottom 0x22A / 0x232 blocked TRUE, CounterOpen_Top / _Bottom 0x22C / 0x234 FALSE). No mechanic kind is a counter
//   flap, so the four ids are `legacy` (inert: the GBA art, no interaction behaviour; a change patches the legacy cells
//   or, changing collision, rebuilds). The same script's 0x2DC / 0x2E4 lie beyond this tileset's 64 metatiles (not
//   drawn here): unlabelled, inert.
// - The doorway to B1F: its floor (NON_ANIMATED_DOOR) `legacy` (as the Pokémon Center's doorways north), its arch wall
//   `decor`. The PC's top over the wall is `pc` (the PC itself is the Building primary's 0x004).
// - The tall striped screens at the counter's ends are `cabinet`; the stools (walkable) `chair`; the blue tables
//   `table`; the notice board `decor`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids: [InteriorId, number[]][] = [
  ['wall', [0x203, 0x204, 0x205, 0x206, 0x207, 0x20b, 0x20c, 0x20d, 0x20e, 0x20f]],
  ['decor', [0x213, 0x214, 0x229]],                    // the notice board, the doorway's arch
  ['pc', [0x228]],
  // Floor: the boards, the row under the wall, the PC's base.
  ['boards', [0x201, 0x202, 0x209, 0x20a, 0x230]],
  ['mat', [0x22d, 0x22e]],
  ['counter', [0x21b, 0x21c, 0x21d, 0x21e, 0x222, 0x223, 0x224, 0x225, 0x226, 0x227]],
  ['cabinet', [0x212, 0x21a, 0x217, 0x21f]],           // the striped screens
  ['chair', [0x210, 0x211, 0x215, 0x216]],
  ['table', [0x218, 0x219, 0x220, 0x221]],
  // The counter's gate (scripted: closed / open) and the doorway's floor.
  ['legacy', [0x22a, 0x22c, 0x232, 0x234, 0x231]],
];

/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind): none (the counter gate is inert). */
const puzzle = new Map<number, PuzzleId>();

export const MOSSDEEP_GAME_CORNER: InteriorTable = {
  name: 'MossdeepGameCorner',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  puzzle,
  target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['14.11'],
  pins: [
    { map: [14, 11], x: 0, y: 0, id: 'wall' },
    { map: [14, 11], x: 3, y: 1, id: 'wall' },
    { map: [14, 11], x: 0, y: 1, id: 'decor' },        // the notice board
    { map: [14, 11], x: 10, y: 1, id: 'pc' },          // 0x004
    { map: [14, 11], x: 10, y: 0, id: 'pc' },          // its top over the wall
    { map: [14, 11], x: 10, y: 2, id: 'boards' },      // its base over the walkable row
    { map: [14, 11], x: 5, y: 1, id: 'legacy' },       // the doorway's floor
    { map: [14, 11], x: 5, y: 2, id: 'legacy' },       // the counter's gate, top
    { map: [14, 11], x: 5, y: 3, id: 'legacy' },       // the counter's gate, bottom
    { map: [14, 11], x: 3, y: 3, id: 'counter' },
    { map: [14, 11], x: 7, y: 2, id: 'counter' },
    { map: [14, 11], x: 2, y: 1, id: 'cabinet' },
    { map: [14, 11], x: 8, y: 2, id: 'cabinet' },
    { map: [14, 11], x: 2, y: 6, id: 'table' },
    { map: [14, 11], x: 3, y: 5, id: 'chair' },
    { map: [14, 11], x: 9, y: 7, id: 'chair' },
    { map: [14, 11], x: 5, y: 9, id: 'mat' },
    { map: [14, 11], x: 6, y: 5, id: 'boards' },
  ],
};
