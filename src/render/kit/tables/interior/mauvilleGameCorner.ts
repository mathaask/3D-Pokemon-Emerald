// gTileset_MauvilleGameCorner: the Mauville Game Corner 10.3, curated by Phase 4b Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only MauvilleGameCorner
// --sheet-scale 5 --sheet-chunk 32). No script writes a metatile here (0 live ids), so there is no mechanic.
//
// Labelling rules beyond Phase 4's:
// - The slot machines (SLOT_MACHINE, blocked) are `slotMachine`; their tops over the walkable row north of them (also
//   SLOT_MACHINE) are floor. The roulette tables (ROULETTE) are `rouletteTable`.
// - The prize counter wraps the clerks' walkable cells (row 2, `tiles`); its back runs over the wall rows (`counter`).
// - The blue stools beside the slots and the yellow benches against the east wall (walkable) are `chair`; the coin
//   machines in the north-west corner `machine`.
// - The sky-and-cloud mural on the back wall is `wall` (a decal: no window, no light shaft).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids: [InteriorId, number[]][] = [
  // Walls: the back wall with its mural, the east wing's three wall rows and corners.
  ['wall', [0x212, 0x21a, 0x209, 0x20a, 0x20b, 0x211, 0x213, 0x219, 0x21b]],
  // Floor: the red carpet, its shadow / edge variants, and the walkable cells a slot machine's top or the prize
  // counter's front reaches into; behind the counter, the clerks' light tiles.
  ['carpet', [0x202, 0x203, 0x204, 0x205, 0x20c, 0x20d, 0x214, 0x215, 0x224, 0x225, 0x25c, 0x25d, 0x25e, 0x25f]],
  ['tiles', [0x243, 0x24d, 0x24e]],
  ['mat', [0x206, 0x207]],
  ['counter', [0x23c, 0x23d, 0x23e, 0x23f, 0x244, 0x245, 0x246, 0x247, 0x24c, 0x24f, 0x254, 0x255, 0x256, 0x257]],
  ['slotMachine', [0x22c, 0x22d, 0x234, 0x235]],
  ['rouletteTable', [0x222, 0x223, 0x22a, 0x22b, 0x232, 0x233]],
  ['chair', [0x226, 0x227, 0x21e, 0x21f]],
  ['machine', [0x20e, 0x20f, 0x216, 0x217]],           // the coin machines
  ['plant', [0x22f, 0x237]],
  ['trashCan', [0x22e, 0x236]],
];

/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind): none here. */
const puzzle = new Map<number, PuzzleId>();

export const MAUVILLE_GAME_CORNER: InteriorTable = {
  name: 'MauvilleGameCorner',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  puzzle,
  target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['10.3'],
  pins: [
    { map: [10, 3], x: 0, y: 0, id: 'wall' },
    { map: [10, 3], x: 3, y: 1, id: 'wall' },          // the mural
    { map: [10, 3], x: 19, y: 2, id: 'wall' },         // the east wing's third wall row
    { map: [10, 3], x: 0, y: 2, id: 'machine' },
    { map: [10, 3], x: 1, y: 1, id: 'machine' },
    { map: [10, 3], x: 6, y: 2, id: 'plant' },
    { map: [10, 3], x: 6, y: 1, id: 'plant' },
    { map: [10, 3], x: 2, y: 2, id: 'trashCan' },
    { map: [10, 3], x: 21, y: 4, id: 'trashCan' },
    { map: [10, 3], x: 9, y: 0, id: 'counter' },       // the prize counter's back over the wall
    { map: [10, 3], x: 9, y: 2, id: 'counter' },
    { map: [10, 3], x: 12, y: 3, id: 'counter' },
    { map: [10, 3], x: 11, y: 2, id: 'tiles' },        // a clerk's place
    { map: [10, 3], x: 12, y: 4, id: 'carpet' },       // the counter's front over the walkable row
    { map: [10, 3], x: 2, y: 6, id: 'slotMachine' },
    { map: [10, 3], x: 8, y: 9, id: 'slotMachine' },
    { map: [10, 3], x: 2, y: 5, id: 'carpet' },        // a slot machine's top
    { map: [10, 3], x: 1, y: 7, id: 'chair' },
    { map: [10, 3], x: 18, y: 3, id: 'chair' },        // a bench
    { map: [10, 3], x: 14, y: 6, id: 'rouletteTable' },
    { map: [10, 3], x: 19, y: 8, id: 'rouletteTable' },
    { map: [10, 3], x: 11, y: 10, id: 'mat' },
    { map: [10, 3], x: 12, y: 7, id: 'carpet' },
  ],
};
