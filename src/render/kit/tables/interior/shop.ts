// gTileset_Shop (23 maps, 22 in scope: every Mart, the Dept Store 1F–5F and rooftop — out of scope, OUT_OF_SCOPE_MAPS —,
// Lavaridge's Herb Shop, the Safari Zone entrance, the cycling-road gates): what its secondary ids (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4b;
// worklist out/interior-ids.task3.txt, sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only Shop --sheet-scale 5
// --sheet-chunk 32).
//
// Two styles share it: the Mart (13 identical maps, green tiles, white walls) and the Dept Store / gate style (orange
// swirl tiles, grey walls; the Dept Store's 2F–4F in Mart tiles, its 5F in pastel squares). Labelling rules beyond
// the brief's:
// - A walkable cell keeps a floor kind even where the art of the furniture south of it (a shelf's foot, the PC's base)
//   or a counter's edge reaches into it: models stand on the cells the game blocks, and the clerks / customers stand on
//   such cells. Exceptions: a plant's or planter's leaves drawn in the walkable cell north of its pot are `plant` (the
//   furniture family's CLAIM_TOP), and the stools / armchairs (walkable in the game) are `chair`.
// - Every SHOP_SHELF cell is `martShelf`, the wall-side glass coolers included, with the wall row above them; the
//   rooftop's vending machines too (the same goods-behind-glass cabinets).
// - The elevator and the stair doorways are wall `decor`; the stair cells themselves are `stairsUp` (0x250) /
//   `stairsDown` (0x251, the rooftop's 0x25F) in the back-wall alcove they open.
// - `legacy`: the elevators' "nF" floor plates, and on the rooftop everything but its floor, planters, seats, vending
//   machines and back railing (the sky, the side and front railings, the stair house, the building's facade below).

import type { InteriorId, InteriorTable } from '../building';

const ids: [InteriorId, number[]][] = [
  // Walls: the Mart's corners, sides and plain wall; the Dept Store / gate style's wall and wainscot; the 5F's.
  ['wall', [0x210, 0x212, 0x215, 0x218, 0x21d, 0x288, 0x290, 0x2e7, 0x2ef]],
  ['clock', [0x222, 0x244, 0x28d, 0x295]],
  ['window', [0x310, 0x311, 0x2e3, 0x2eb]],
  ['decor', [
    0x28b, 0x293,                                     // the poster
    0x27c, 0x27d, 0x27e, 0x284, 0x285, 0x286,          // the elevator
    0x302, 0x303, 0x304, 0x305,                        // the 5F's elevator frame
    0x30d, 0x309, 0x30e, 0x307, 0x30f,                 // the stair doorways
    0x308, 0x30a, 0x30b, 0x30c,                        // the 5F's stair doorways
    0x2e0, 0x2e1, 0x2e2, 0x2e8, 0x2e9, 0x2ea,          // the 5F's heart
    0x226, 0x227, 0x281, 0x22f, 0x27a,                 // the rooftop's back railing
    0x24f, 0x257,                                      // the rooftop's stair-house doorway
  ]],
  // Floors: the Mart tiles and their shadow / edge / overhang variants; the swirl tiles; the 5F squares; the rooftop's
  // paving. The Mart's cut corners (0x214 / 0x21C) are walkable.
  ['tiles', [
    0x201, 0x202, 0x204, 0x206, 0x208, 0x20a, 0x20b, 0x20f, 0x214, 0x21c, 0x220, 0x221, 0x230, 0x231, 0x239, 0x243,
    0x2ae, 0x318, 0x29b, 0x2dd,
    0x268, 0x270, 0x271, 0x278, 0x279, 0x280, 0x298, 0x299, 0x2a6, 0x2c3, 0x2d2, 0x2d4, 0x265, 0x316,
    0x2f2, 0x2f3, 0x2f4, 0x2f5, 0x2f6, 0x2f7, 0x2fa, 0x2fc, 0x2fd, 0x2fe, 0x306,
    0x24a, 0x24d, 0x253, 0x254, 0x317,
  ]],
  ['mat', [0x216, 0x217]],
  // Shelves: the Mart's gondolas and wall coolers, the Herb Shop's and Dept Store's cases, the rooftop's vending machines.
  ['martShelf', [0x213, 0x21b, 0x223, 0x224, 0x228, 0x229, 0x22b, 0x22c, 0x233, 0x234, 0x23b, 0x23c, 0x27f, 0x287,
    0x2aa, 0x2ab, 0x2b2, 0x2b3, 0x312, 0x314, 0x26f, 0x277]],
  // Counters: the Mart's L with its register and questionnaire; the glass counters with their green ends and registers.
  ['counter', [0x22a, 0x232, 0x23a, 0x241, 0x242, 0x320,
    0x29c, 0x29d, 0x29e, 0x2a0, 0x2a1, 0x2a2, 0x2a3, 0x2a4, 0x2a5, 0x2a8, 0x2a9, 0x2ac, 0x2ad, 0x2b0, 0x2b1, 0x2d0,
    0x2d1, 0x2de, 0x2fb, 0x2ff]],
  ['pc', [0x25d]],                                      // the Safari entrance PC's top over the wall
  // Plants (leaves + pot) and planters (leaves + box).
  ['plant', [0x225, 0x22d, 0x25c, 0x264, 0x26c, 0x274, 0x26d, 0x275, 0x2d3,
    0x259, 0x25a, 0x261, 0x262, 0x266, 0x267, 0x2df, 0x2c9, 0x2ca, 0x2cb, 0x2cc]],
  // Stools, armchairs, the rooftop's benches.
  ['chair', [0x26e, 0x2ba, 0x2c8, 0x2c0, 0x2c1, 0x2c2]],
  ['stairsUp', [0x250]],
  ['stairsDown', [0x251, 0x25f]],
  ['legacy', [
    0x28e, 0x28f, 0x29f, 0x296, 0x297, 0x2a7, 0x2af, 0x2b7, 0x300, 0x301, 0x2bf,   // the elevators' "nF" floor plates
    // The rooftop: the sky, the side and front railings, the stair house, the facade below.
    0x21f, 0x22e, 0x236, 0x237, 0x23e, 0x23f, 0x246, 0x247, 0x255, 0x25b, 0x263,
    0x24e, 0x235, 0x256, 0x23d, 0x25e, 0x245,
    0x2e4, 0x2e5, 0x2e6, 0x2ec, 0x2ed, 0x2ee, 0x2f0, 0x2f1, 0x2f8, 0x2f9,
  ]],
];

export const SHOP: InteriorTable = {
  name: 'Shop',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  target: 0.97,
  pins: [
    // Oldale Mart (2.4).
    { map: [2, 4], x: 6, y: 4, id: 'martShelf' },     // a gondola
    { map: [2, 4], x: 7, y: 6, id: 'martShelf' },
    { map: [2, 4], x: 4, y: 1, id: 'martShelf' },     // the wall cooler
    { map: [2, 4], x: 6, y: 0, id: 'martShelf' },     // the wall shelf's top over the wall
    { map: [2, 4], x: 2, y: 3, id: 'counter' },
    { map: [2, 4], x: 0, y: 4, id: 'counter' },       // the questionnaire on the counter's front
    { map: [2, 4], x: 2, y: 1, id: 'counter' },       // the register
    { map: [2, 4], x: 1, y: 3, id: 'tiles' },         // the clerk's place
    { map: [2, 4], x: 1, y: 0, id: 'clock' },
    { map: [2, 4], x: 0, y: 0, id: 'wall' },
    { map: [2, 4], x: 10, y: 3, id: 'plant' },
    { map: [2, 4], x: 10, y: 2, id: 'plant' },        // its leaves over the walkable cell north of the pot
    { map: [2, 4], x: 4, y: 5, id: 'tiles' },
    { map: [2, 4], x: 3, y: 7, id: 'mat' },
    // The Dept Store 1F (13.16), 2F (13.17), 5F (13.20); the rooftop (13.21) is out of scope (OUT_OF_SCOPE_MAPS, Task 12):
    // its labels above stay, unpinned, until the controller rules.
    { map: [13, 16], x: 8, y: 3, id: 'counter' },
    { map: [13, 16], x: 6, y: 1, id: 'counter' },     // the counter's end over the wall
    { map: [13, 16], x: 2, y: 1, id: 'decor' },       // the elevator door
    { map: [13, 16], x: 16, y: 1, id: 'stairsUp' },
    { map: [13, 16], x: 16, y: 0, id: 'decor' },      // the stair doorway's top
    { map: [13, 16], x: 16, y: 3, id: 'chair' },
    { map: [13, 16], x: 0, y: 5, id: 'plant' },       // a planter
    { map: [13, 16], x: 14, y: 7, id: 'plant' },
    { map: [13, 16], x: 2, y: 2, id: 'legacy' },      // the "1F" plate
    { map: [13, 16], x: 3, y: 5, id: 'tiles' },
    { map: [13, 17], x: 7, y: 1, id: 'window' },
    { map: [13, 17], x: 16, y: 1, id: 'stairsDown' },
    { map: [13, 17], x: 2, y: 5, id: 'martShelf' },
    { map: [13, 17], x: 8, y: 5, id: 'counter' },
    { map: [13, 17], x: 8, y: 4, id: 'tiles' },       // the customers' side of the counter
    { map: [13, 20], x: 8, y: 1, id: 'decor' },       // the heart
    { map: [13, 20], x: 6, y: 1, id: 'window' },
    { map: [13, 20], x: 4, y: 0, id: 'wall' },
    { map: [13, 20], x: 1, y: 4, id: 'tiles' },
    // Safari Zone entrance (23.0), Herb Shop (4.0), cycling-road gate (29.11).
    { map: [23, 0], x: 12, y: 1, id: 'pc' },
    { map: [23, 0], x: 16, y: 8, id: 'counter' },
    { map: [23, 0], x: 9, y: 0, id: 'clock' },
    { map: [23, 0], x: 15, y: 1, id: 'decor' },
    { map: [4, 0], x: 2, y: 3, id: 'counter' },
    { map: [4, 0], x: 8, y: 1, id: 'martShelf' },
    { map: [4, 0], x: 1, y: 7, id: 'plant' },
    { map: [29, 11], x: 7, y: 3, id: 'counter' },
  ],
};
