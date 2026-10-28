// gTileset_OceanicMuseum: the Oceanic Museum 1F / 2F 9.7 / 9.8, curated by Phase 4b Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only OceanicMuseum
// --sheet-scale 5 --sheet-chunk 32). No script writes a metatile here (0 live ids), so there is no mechanic.
//
// Labelling rules beyond Phase 4's:
// - A walkable cell keeps a floor kind even where the art of an exhibit or counter reaches into it (the tanks' and wall
//   cases' feet in row 2, the capsules' and kiosks' tops, the counters' back edges, the ship model's top).
// - Exhibits: the glass cases on the back wall, the white capsules and the glass cubes are `displayCase`; the two tall
//   water columns (1F) and the wall aquarium (2F) `fishTank`; the two exhibit tables (a submarine and a bathysphere, a
//   liner) and the liner on its glass stand (2F) `modelShip`; the 2F information kiosks `machine`; the white column
//   reaching from the 2F back wall into the room `pillar`.
// - 0x233 is both the 1F reception counter's top (COUNTER) and the middle of the 2F exhibit tables' front: one id, one
//   label, so it is `counter` (the receptionist's U-counter needs it; the tables' two front cells read as a counter).
// - The stair arches are wall `decor`, their stair cells `stairsUp` (1F) / `stairsDown` (2F); the plaque and the
//   diving-bell exhibit on the 1F back wall are `decor`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids: [InteriorId, number[]][] = [
  ['wall', [0x204, 0x20c]],
  // The plaque, the round exhibit on the 1F back wall, the stair arches (1F, 2F).
  ['decor', [0x205, 0x20d, 0x214, 0x215, 0x21c, 0x21d, 0x206, 0x25d, 0x25e, 0x257, 0x25f, 0x207, 0x261, 0x262, 0x263, 0x264]],
  ['stairsUp', [0x20e]],
  ['stairsDown', [0x20f]],
  // Floor: the teal tiles, the darker border row, their shadow variants, and the walkable cells the art of a tank, a
  // case, a capsule, a counter, a kiosk or a ship model reaches into.
  ['tiles', [0x201, 0x202, 0x203, 0x243, 0x24b, 0x244, 0x222, 0x223, 0x224, 0x236, 0x237, 0x218, 0x219, 0x220, 0x221,
    0x24d, 0x24e, 0x24f, 0x245, 0x246, 0x247, 0x253, 0x254, 0x251, 0x252]],
  ['mat', [0x20a, 0x20b]],
  // The receptionists' U-counters (1F).
  ['counter', [0x255, 0x248, 0x249, 0x233, 0x256, 0x23e, 0x260]],
  // The glass cases on the back wall (1F, 2F), the white capsules (1F, 2F), the glass cubes on blue bases (1F).
  ['displayCase', [0x212, 0x213, 0x21a, 0x21b, 0x208, 0x209, 0x210, 0x211, 0x228, 0x229]],
  // The two tall water columns (1F), the wall aquarium (2F).
  ['fishTank', [0x226, 0x227, 0x22e, 0x22f, 0x216, 0x217, 0x21e, 0x21f]],
  // The exhibit tables (2F: the submarine and bathysphere, the liner) and the liner on its glass stand.
  ['modelShip', [0x238, 0x239, 0x240, 0x22c, 0x232, 0x234, 0x22a, 0x230, 0x231, 0x259, 0x25a]],
  ['machine', [0x25b, 0x25c]],                        // the 2F information kiosks
  ['pillar', [0x225, 0x22d, 0x235]],                  // the white column (2F)
];

/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind): none here. */
const puzzle = new Map<number, PuzzleId>();

export const OCEANIC_MUSEUM: InteriorTable = {
  name: 'OceanicMuseum',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  puzzle,
  target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['9.7', '9.8'],
  pins: [
    // 1F (9.7)
    { map: [9, 7], x: 0, y: 0, id: 'wall' },
    { map: [9, 7], x: 4, y: 0, id: 'decor' },          // the plaque
    { map: [9, 7], x: 16, y: 1, id: 'decor' },         // the round exhibit on the wall
    { map: [9, 7], x: 6, y: 1, id: 'stairsUp' },
    { map: [9, 7], x: 5, y: 1, id: 'decor' },          // the stair arch
    { map: [9, 7], x: 2, y: 1, id: 'displayCase' },    // the wall case
    { map: [9, 7], x: 2, y: 4, id: 'displayCase' },    // a white capsule
    { map: [9, 7], x: 2, y: 3, id: 'tiles' },          // its top over the walkable cell north of it
    { map: [9, 7], x: 15, y: 4, id: 'displayCase' },   // a glass cube
    { map: [9, 7], x: 9, y: 1, id: 'fishTank' },       // a water column
    { map: [9, 7], x: 9, y: 2, id: 'tiles' },          // its foot over the walkable row
    { map: [9, 7], x: 6, y: 6, id: 'counter' },
    { map: [9, 7], x: 13, y: 6, id: 'counter' },       // 0x233
    { map: [9, 7], x: 8, y: 8, id: 'counter' },
    { map: [9, 7], x: 6, y: 7, id: 'tiles' },          // the receptionist's place
    { map: [9, 7], x: 9, y: 8, id: 'mat' },
    { map: [9, 7], x: 1, y: 5, id: 'tiles' },
    // 2F (9.8)
    { map: [9, 8], x: 6, y: 1, id: 'stairsDown' },
    { map: [9, 8], x: 12, y: 1, id: 'fishTank' },      // the wall aquarium
    { map: [9, 8], x: 8, y: 1, id: 'displayCase' },
    { map: [9, 8], x: 10, y: 3, id: 'pillar' },
    { map: [9, 8], x: 10, y: 0, id: 'pillar' },
    { map: [9, 8], x: 3, y: 3, id: 'modelShip' },      // the submarine table
    { map: [9, 8], x: 2, y: 7, id: 'modelShip' },      // the liner table
    { map: [9, 8], x: 3, y: 7, id: 'counter' },        // 0x233 in its front
    { map: [9, 8], x: 13, y: 7, id: 'modelShip' },     // the liner on its stand
    { map: [9, 8], x: 13, y: 6, id: 'tiles' },
    { map: [9, 8], x: 12, y: 4, id: 'machine' },       // a kiosk
    { map: [9, 8], x: 12, y: 3, id: 'tiles' },         // its screen over the walkable cell north of it
    { map: [9, 8], x: 18, y: 7, id: 'displayCase' },
    { map: [9, 8], x: 3, y: 2, id: 'tiles' },
  ],
};
