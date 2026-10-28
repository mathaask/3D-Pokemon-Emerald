// gTileset_PrettyPetalFlowerShop: the Pretty Petal flower shop 17.1 (not its unreachable prototype 27.1).
// What its ids are, curated by Phase 4b Task 4e from its map (worklists out/interior-ids-4b.task2.txt and
// out/live-ids.task2.txt: no live ids, no mechanics; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PrettyPetalFlowerShop
// --sheet-scale 5 --sheet-chunk 32).
//
// The shop: a yellow wall (rows 0–1) with pillars, small high windows, a framed flower picture and a framed mirror; flower
// buckets and a potted grass at the wall's foot, a metal rack of seed packets, two green display tables (potted greens at
// the back, bowls of blooms at the front); the wooden L counter (COUNTER) at the west; pale planks with three stools,
// wooden flower boxes (one, two or three rows of blooms over their box) and potted ferns on green stands.
// - Flowers are `flowerBin` (one bin per cell, the blooms in the art's colours): the buckets at the wall, the display
//   tables' bowls, every flower box's cells. The potted greens, the grass in its vase and the ferns are `plant` (a fern's
//   leaves, pot and stand: one column plant).
// - The buckets', the grass's and the pillars' walkable feet on row 2, the counter's top edge at (0, 4) and the boxes'
//   shadows are the floor (`boards`).
// - The seed-packet rack is `martShelf` (shop goods on shelves, NORMAL behaviour); the stools (walkable) are `chair`.
// - No `legacy`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();

// Wall rows.
put('wall', 0x210, 0x211, 0x212, 0x213,                                   // the wall's top row, the pillars' tops
  0x218, 0x219, 0x21a, 0x21b);                                            // the wall, the pillars
put('window', 0x216);                                                     // the small high windows
put('painting', 0x214, 0x21c,                                             // the framed flower picture
  0x215, 0x21d);                                                          // the framed mirror

// Floors.
put('boards',
  0x201, 0x202, 0x203, 0x208, 0x209, 0x20a, 0x20b, 0x20c,                 // pale planks (shaded by boxes and the counter)
  0x220, 0x221, 0x222, 0x226, 0x21f, 0x22a,                               // the wall's foot: pillars, buckets, grass
  0x23e);                                                                 // the counter's top edge over the floor

// Furniture.
put('counter', 0x22f, 0x237, 0x23f, 0x247, 0x246);                        // the L counter (register at its north end)
put('martShelf', 0x223, 0x224, 0x22b, 0x22c);                             // the seed-packet rack
put('flowerBin',
  0x21e, 0x217,                                                           // the flower buckets at the wall
  0x23b, 0x23c,                                                           // the display tables' bowls of blooms
  0x22e, 0x236);                                                          // the flower boxes: blooms, box
put('plant',
  0x227,                                                                  // the grass in its vase
  0x233, 0x234,                                                           // the potted greens on the display tables
  0x225, 0x22d, 0x235);                                                   // the ferns: leaves, pot, stand
put('chair', 0x245, 0x23d);                                               // the stools

export const PRETTY_PETAL_FLOWER_SHOP: InteriorTable = {
  name: 'PrettyPetalFlowerShop', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['17.1'],
  pins: [
    { map: [17, 1], x: 0, y: 0, id: 'wall' },
    { map: [17, 1], x: 5, y: 1, id: 'wall' },         // a pillar
    { map: [17, 1], x: 7, y: 0, id: 'window' },
    { map: [17, 1], x: 1, y: 1, id: 'painting' },     // the flower picture
    { map: [17, 1], x: 4, y: 0, id: 'painting' },     // the mirror
    { map: [17, 1], x: 2, y: 1, id: 'flowerBin' },    // the buckets
    { map: [17, 1], x: 6, y: 1, id: 'flowerBin' },
    { map: [17, 1], x: 2, y: 2, id: 'boards' },       //   their walkable feet
    { map: [17, 1], x: 11, y: 2, id: 'flowerBin' },   // a display table's bowls
    { map: [17, 1], x: 10, y: 1, id: 'plant' },       //   its potted greens
    { map: [17, 1], x: 9, y: 1, id: 'plant' },        // the grass in its vase
    { map: [17, 1], x: 11, y: 3, id: 'flowerBin' },   // a one-row flower box
    { map: [17, 1], x: 5, y: 6, id: 'flowerBin' },    // a two-row box: blooms, box
    { map: [17, 1], x: 5, y: 7, id: 'flowerBin' },
    { map: [17, 1], x: 13, y: 5, id: 'flowerBin' },   // the three-row box
    { map: [17, 1], x: 6, y: 5, id: 'plant' },        // a fern: leaves, pot, stand
    { map: [17, 1], x: 6, y: 6, id: 'plant' },
    { map: [17, 1], x: 14, y: 7, id: 'plant' },
    { map: [17, 1], x: 7, y: 1, id: 'martShelf' },
    { map: [17, 1], x: 8, y: 2, id: 'martShelf' },
    { map: [17, 1], x: 1, y: 2, id: 'counter' },      // the register
    { map: [17, 1], x: 0, y: 5, id: 'counter' },      // the L's foot
    { map: [17, 1], x: 0, y: 4, id: 'boards' },       //   its top edge over the floor
    { map: [17, 1], x: 0, y: 3, id: 'chair' },
    { map: [17, 1], x: 10, y: 3, id: 'chair' },
    { map: [17, 1], x: 4, y: 4, id: 'boards' },
    { map: [17, 1], x: 2, y: 8, id: 'mat' },
  ],
};
