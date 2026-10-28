// gTileset_Facility: Devon Corp. 1F / 3F 11.0 / 11.2 (Devon 2F 11.1 is General-primary, not this table's), curated by
// Phase 4b Task 4d (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts
// --no-maps --sheet-only Facility --sheet-scale 5 --sheet-chunk 32).
//
// Labelling rules beyond Phase 4's:
// - Live ids: the 12 `NewMauvilleDoor_*` ids are only "suspected" (their names); no script or C file writes them on
//   Devon's maps and they are not drawn there, so they stay unlabelled: inert.
// - A walkable cell keeps a floor kind even where a counter's or a table's art reaches into it (the receptionist's
//   counter top, the tables' rims and feet, the glass cases' tops).
// - The 3F sofa against the back wall and the armchairs (walkable in the game) are `chair`; the president's desk and
//   the side table `table`; the crystal exhibits on stands (1F) and the glass cabinets (3F) `displayCase`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids: [InteriorId, number[]][] = [
  // Walls: the papered upper wall, the wainscot, the orange pillars' corners and sides.
  ['wall', [0x388, 0x390, 0x391, 0x39a, 0x398, 0x3a0, 0x39b, 0x399, 0x3a1]],
  ['window', [0x389]],
  // The stair arches (1F up, 3F down).
  ['decor', [0x38a, 0x38b, 0x38c, 0x392, 0x394, 0x395, 0x397]],
  ['stairsUp', [0x393]],
  ['stairsDown', [0x396]],
  // Floor: the pink tiles and the walkable cells a counter's, a table's or a case's art reaches into.
  ['tiles', [0x380, 0x381, 0x383, 0x384, 0x385, 0x386, 0x387, 0x38d, 0x3b8, 0x3b9, 0x3ba, 0x3be, 0x3bf, 0x3c6, 0x2dd]],
  ['mat', [0x206, 0x207]],
  ['counter', [0x38e, 0x39c, 0x38f]],                 // the reception counter (1F)
  ['displayCase', [0x3f6, 0x3fe, 0x2e5]],             // the crystal exhibits (1F), the glass cabinets (3F)
  // The sofa (3F, its back in the wall row) and the armchairs.
  ['chair', [0x349, 0x34a, 0x34b, 0x351, 0x352, 0x353, 0x348, 0x350, 0x3a8, 0x2ff, 0x307, 0x3a9]],
  ['table', [0x3c0, 0x3c1, 0x3c2, 0x3bb, 0x3bc, 0x3bd, 0x3c3, 0x3c4, 0x3c5]],
];

/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind): none here. */
const puzzle = new Map<number, PuzzleId>();

export const FACILITY: InteriorTable = {
  name: 'Facility',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  puzzle,
  target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['11.0', '11.2'],
  pins: [
    // 1F (11.0)
    { map: [11, 0], x: 3, y: 0, id: 'wall' },
    { map: [11, 0], x: 4, y: 0, id: 'window' },
    { map: [11, 0], x: 9, y: 2, id: 'wall' },          // a pillar's side
    { map: [11, 0], x: 14, y: 1, id: 'stairsUp' },
    { map: [11, 0], x: 13, y: 1, id: 'decor' },
    { map: [11, 0], x: 5, y: 4, id: 'counter' },
    { map: [11, 0], x: 5, y: 3, id: 'tiles' },         // the receptionist's place
    { map: [11, 0], x: 3, y: 2, id: 'displayCase' },
    { map: [11, 0], x: 5, y: 8, id: 'mat' },
    { map: [11, 0], x: 10, y: 6, id: 'tiles' },
    // 3F (11.2)
    { map: [11, 2], x: 2, y: 1, id: 'stairsDown' },
    { map: [11, 2], x: 9, y: 1, id: 'chair' },         // the sofa's back
    { map: [11, 2], x: 9, y: 2, id: 'chair' },
    { map: [11, 2], x: 5, y: 5, id: 'chair' },         // an armchair
    { map: [11, 2], x: 9, y: 5, id: 'table' },         // the president's desk
    { map: [11, 2], x: 15, y: 6, id: 'table' },
    { map: [11, 2], x: 9, y: 3, id: 'tiles' },         // the desk's rim over the walkable row
    { map: [11, 2], x: 1, y: 5, id: 'displayCase' },
    { map: [11, 2], x: 1, y: 4, id: 'tiles' },
    { map: [11, 2], x: 7, y: 0, id: 'window' },
  ],
};
