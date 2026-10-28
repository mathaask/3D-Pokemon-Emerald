// gTileset_LilycoveMuseum: the Lilycove Museum 1F / 2F 13.2 / 13.3, curated by Phase 4b Task 4d (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only LilycoveMuseum
// --sheet-scale 5 --sheet-chunk 32).
//
// Labelling rules beyond Phase 4's:
// - Every framed picture is `painting`: the 1F's on the back wall and on the dividing wall, the 2F's empty frames
//   (0x258 / 0x259) and the five contest paintings the 2F script writes into them (Painting0–4_Left/Right, 0x25A–0x263,
//   blocked TRUE). They are wall art, not a mechanic: the shell claims them (a painting feature), so the script's
//   change is refused `claimedNotLive` in Modern and rebuilds (F25, `i_pz_lily`).
// - The 1F's dividing wall (rows 5–6) and its white end columns (x 9 and x 13) and the 2F's five free-standing green
//   display boards are `wall`: Phase 4's partitions. Their tops and feet drawn over walkable cells are floor.
// - A walkable cell keeps a floor kind even where a counter's, a board's or the exhibit platform's art reaches into it.
// - The exhibit platform with the green stone sculpture (1F) is `displayCase`; its front row shares the reception
//   counter's ids (0x252–0x254, COUNTER), so it is `counter`.
// - `legacy`: the stone statues on their pedestals (1F: the bird, its head over the walkable cell north of it, the
//   turtle; 2F: the dragons flanking the stairs, their pedestals in the room). No kind models a sculpture (`statue` is
//   the gyms' Poké Ball statue), and the GBA art keeps their shapes. The dragons' upper halves over the back wall are
//   wall `decor`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids: [InteriorId, number[]][] = [
  // Walls: the 1F back wall and its dividing wall with their end columns; the 2F back wall and its display boards.
  ['wall', [0x20b, 0x213, 0x211, 0x204, 0x20c, 0x214, 0x28b,
    0x279, 0x281, 0x289, 0x27a, 0x282, 0x28a, 0x278, 0x280, 0x288, 0x286, 0x26e, 0x26f, 0x28e, 0x277]],
  ['painting', [
    0x218, 0x219, 0x220, 0x221, 0x21a, 0x21b, 0x222, 0x223, 0x21c, 0x224, 0x21d, 0x225, 0x21e, 0x21f, 0x226, 0x227,
    0x22d, 0x22e, 0x235, 0x236, 0x22f, 0x237,                         // 1F
    0x258, 0x259,                                                      // 2F: the empty frames
    0x25a, 0x25b, 0x25c, 0x25d, 0x25e, 0x25f, 0x260, 0x261, 0x262, 0x263, // 2F: the contest paintings (scripts)
  ]],
  // The stair arches (1F up, 2F down) and the dragons' upper halves over the 2F back wall.
  ['decor', [0x205, 0x206, 0x207, 0x20d, 0x20f, 0x26a, 0x26b, 0x26c, 0x272, 0x274, 0x284, 0x285]],
  ['stairsUp', [0x20e]],
  ['stairsDown', [0x273]],
  // Floor: the beige diamonds (1F), the grey tiles (2F), their shadow variants, and the walkable cells the art of the
  // dividing wall's top, a board's top or foot, a counter or the exhibit platform reaches into.
  ['tiles', [0x202, 0x203, 0x208, 0x209, 0x212, 0x23a, 0x23b, 0x23c, 0x23e, 0x23f, 0x246, 0x24f, 0x24d, 0x234,
    0x268, 0x269, 0x270, 0x271, 0x264, 0x265, 0x266, 0x267, 0x27b, 0x283, 0x27c, 0x27d, 0x27e, 0x27f]],
  ['mat', [0x216, 0x217]],
  // The reception U-counter (1F) and the exhibit platform's front row.
  ['counter', [0x248, 0x253, 0x241, 0x240, 0x249, 0x210, 0x238, 0x239, 0x252, 0x254]],
  ['displayCase', [0x242, 0x228, 0x229, 0x22a, 0x244, 0x24a, 0x230, 0x231, 0x232, 0x24c]],
  ['legacy', [0x22b, 0x233, 0x22c, 0x28c, 0x28d]],                  // the stone statues
];

/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind): none (the paintings are wall art). */
const puzzle = new Map<number, PuzzleId>();

export const LILYCOVE_MUSEUM: InteriorTable = {
  name: 'LilycoveMuseum',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  puzzle,
  target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['13.2', '13.3'],
  pins: [
    // 1F (13.2)
    { map: [13, 2], x: 0, y: 0, id: 'wall' },
    { map: [13, 2], x: 1, y: 1, id: 'painting' },
    { map: [13, 2], x: 19, y: 0, id: 'painting' },
    { map: [13, 2], x: 2, y: 6, id: 'painting' },      // on the dividing wall
    { map: [13, 2], x: 4, y: 5, id: 'wall' },          // the dividing wall
    { map: [13, 2], x: 13, y: 2, id: 'wall' },         // the end column (COUNTER behaviour)
    { map: [13, 2], x: 9, y: 8, id: 'wall' },
    { map: [13, 2], x: 4, y: 4, id: 'tiles' },         // the dividing wall's top over the walkable row
    { map: [13, 2], x: 16, y: 1, id: 'stairsUp' },
    { map: [13, 2], x: 15, y: 0, id: 'decor' },
    { map: [13, 2], x: 3, y: 10, id: 'counter' },
    { map: [13, 2], x: 1, y: 12, id: 'counter' },
    { map: [13, 2], x: 3, y: 12, id: 'tiles' },        // the receptionist's place
    { map: [13, 2], x: 17, y: 7, id: 'displayCase' },  // the stone sculpture's platform
    { map: [13, 2], x: 17, y: 9, id: 'counter' },      // its front row
    { map: [13, 2], x: 15, y: 12, id: 'legacy' },      // a statue
    { map: [13, 2], x: 18, y: 11, id: 'legacy' },
    { map: [13, 2], x: 9, y: 13, id: 'mat' },
    { map: [13, 2], x: 11, y: 7, id: 'tiles' },
    // 2F (13.3)
    { map: [13, 3], x: 2, y: 6, id: 'painting' },      // an empty frame (a painting's place)
    { map: [13, 3], x: 15, y: 10, id: 'painting' },
    { map: [13, 3], x: 3, y: 5, id: 'wall' },          // a display board
    { map: [13, 3], x: 1, y: 6, id: 'wall' },
    { map: [13, 3], x: 2, y: 4, id: 'tiles' },         // a board's top
    { map: [13, 3], x: 2, y: 7, id: 'tiles' },         // a board's foot
    { map: [13, 3], x: 13, y: 1, id: 'stairsDown' },
    { map: [13, 3], x: 12, y: 1, id: 'decor' },
    { map: [13, 3], x: 11, y: 1, id: 'decor' },        // a dragon's upper half
    { map: [13, 3], x: 11, y: 2, id: 'legacy' },       // its pedestal
    { map: [13, 3], x: 0, y: 0, id: 'wall' },
    { map: [13, 3], x: 6, y: 6, id: 'tiles' },
  ],
};
