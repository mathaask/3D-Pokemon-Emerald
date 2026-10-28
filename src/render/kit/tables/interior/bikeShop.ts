// gTileset_BikeShop: Rydel's Cycles 10.1 (General primary: its General ids < 512 would be labelled here; the map uses none,
// every id it draws is the secondary's; not New Mauville 24.53), curated by Phase 4b Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only BikeShop
// --sheet-scale 5 --sheet-chunk 32). No script writes a metatile here (0 live ids), so there is no mechanic.
//
// Labelling rules beyond Phase 4's:
// - The bikes on their raised stands (the west wall's row, the display by the east wall) are `bikeRack`; the brown
//   boxes in the room (one free, one heading the east display) and the parts shelf in the north-west corner `cabinet`.
// - The bikes and handlebars hung on the back wall are wall `decor`; the white strip at x 6 is a north–south
//   partition (`wall`).
// - Rydel's counter, with the register's top over the wall row, is `counter`; the desks in the back wall's recess
//   `table`. A walkable cell keeps a floor kind where a counter's, a desk's or a box's art reaches into it.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids: [InteriorId, number[]][] = [
  ['wall', [0x203, 0x22b, 0x233, 0x228, 0x230, 0x238, 0x240]],
  ['window', [0x229, 0x22a, 0x22c, 0x22d]],
  ['decor', [0x204, 0x20c, 0x205, 0x20d]],             // the bikes and handlebars hung on the wall
  // Floor: the grey tiles, and the walkable cells a counter's, a desk's or a box's art reaches into.
  ['tiles', [0x23f, 0x214, 0x215, 0x216, 0x223, 0x224, 0x225, 0x226, 0x239, 0x23a, 0x23b, 0x23c, 0x241, 0x242, 0x243,
    0x244, 0x24a, 0x250, 0x251, 0x252]],
  ['mat', [0x218, 0x220]],
  ['counter', [0x20b, 0x213, 0x21b, 0x21c, 0x21d, 0x21e]],
  ['table', [0x231, 0x232, 0x234, 0x235]],             // the desks
  ['cabinet', [0x201, 0x202, 0x209, 0x20a, 0x211, 0x212, 0x248, 0x249, 0x24b, 0x24c]],
  ['bikeRack', [0x219, 0x21a, 0x221, 0x222, 0x206, 0x207, 0x20e, 0x20f, 0x253, 0x254, 0x245, 0x246, 0x24d, 0x24e, 0x255,
    0x256]],
];

/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind): none here. */
const puzzle = new Map<number, PuzzleId>();

export const BIKE_SHOP: InteriorTable = {
  name: 'BikeShop',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  puzzle,
  target: 0.97,
  primary: SYM.gTileset_General,
  maps: ['10.1'],
  pins: [
    { map: [10, 1], x: 0, y: 1, id: 'cabinet' },       // the parts shelf
    { map: [10, 1], x: 0, y: 3, id: 'bikeRack' },
    { map: [10, 1], x: 1, y: 8, id: 'bikeRack' },
    { map: [10, 1], x: 11, y: 6, id: 'bikeRack' },
    { map: [10, 1], x: 10, y: 5, id: 'bikeRack' },
    { map: [10, 1], x: 10, y: 4, id: 'cabinet' },
    { map: [10, 1], x: 6, y: 4, id: 'cabinet' },
    { map: [10, 1], x: 7, y: 3, id: 'tiles' },         // the box's top over the walkable row
    { map: [10, 1], x: 3, y: 3, id: 'counter' },
    { map: [10, 1], x: 2, y: 2, id: 'counter' },
    { map: [10, 1], x: 2, y: 1, id: 'counter' },       // the register's top over the wall
    { map: [10, 1], x: 4, y: 2, id: 'tiles' },         // Rydel's place
    { map: [10, 1], x: 3, y: 4, id: 'tiles' },         // the counter's front
    { map: [10, 1], x: 3, y: 0, id: 'decor' },
    { map: [10, 1], x: 6, y: 2, id: 'wall' },          // the partition
    { map: [10, 1], x: 9, y: 1, id: 'wall' },
    { map: [10, 1], x: 7, y: 0, id: 'window' },
    { map: [10, 1], x: 8, y: 1, id: 'table' },
    { map: [10, 1], x: 3, y: 8, id: 'mat' },
    { map: [10, 1], x: 5, y: 6, id: 'tiles' },
  ],
};
