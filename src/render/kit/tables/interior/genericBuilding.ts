// gTileset_GenericBuilding (73 in-scope maps: the houses, the cycling-road gates, the Weather Institute …): what its
// secondary ids (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4a; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only GenericBuilding --sheet-scale 5 --sheet-chunk 32).
//
// The tileset draws six room styles, each with its own copy of the furniture:
// - plank houses (Oldale, Petalburg, Verdanturf, Lilycove …): cream wall with a teal wainscot over yellow boards;
// - tatami houses (Dewford, Lavaridge, the motel, the rest houses, the Trick House): beige wall between wooden posts,
//   tatami mats, a raised edge and a grey stone entry (genkan) at the front;
// - Rustboro flats and houses: yellow wall over a chequered tile floor;
// - Pacifidlog log cabins: log walls with slanted corners over log boards;
// - Fortree tree houses: orange slanted walls round the tree trunk, plank floor;
// - Sootopolis houses: white wall over grey stone tiles.
// A multi-cell object labels all its blocked cells with its kind (the parts drawn on the wall rows included). Its
// walkable south row (the feet of TVs, fridges, kitchens, cabinets and bookcases, which the player walks over) is the
// floor it stands on, as in the other secondaries: the furniture fitting anchors a piece at its component's last row.
// Walkable cells north of an object keep its kind where they are the object's own art (plant leaves, the Fossil
// Maniac's glass case top) and are floor where another piece's top only overhangs them (Steven's stacked display
// cases, the Decoration Shop's counter tops). Walkable cells with a sliver of a neighbour's art keep their floor kind.
// `legacy`: Fortree's tree trunk through the room and the Fossil Maniac's dug tunnel. The free-standing white
// partitions (Dewford Hall, Wanda's house, the Rustboro Flat2 floors) and the inner walls (a second back wall standing
// in the room: Dewford Hall, the Fan Club, the Rustboro flats) are wall art: `wall`. The front-row corners (void
// triangles on a blocked floor cell) are their room's floor. Kitchen stoves are `sink` with the sink beside them (one
// kitchen unit, as in BrendansMaysHouse); sofas are `chair`; floor cushions are `rug`; stair openings' frames are `wall`.

import type { InteriorId, InteriorTable } from '../building';

/** [id, label] pairs for a list of ids. */
const all = (id: InteriorId, ms: readonly number[]): [number, InteriorId][] => ms.map((m) => [m, id]);

// ---- plank houses ---------------------------------------------------------------------------------------------------
const PLANK: [number, InteriorId][] = [
  ...all('wall', [0x205, 0x20d, 0x2ca, 0x2cb]),                        // cream wall / teal wainscot
  ...all('window', [0x207, 0x20f]),                                    // curtained window
  ...all('decor', [0x206, 0x20e,                                       // framed Pokémon picture
    0x27d, 0x285,                                                      // landscape painting (Dewford Hall)
    0x258, 0x260, 0x267]),                                             // framed picture (Sootopolis, Treasure Hunter)
  ...all('boards', [0x223, 0x224, 0x225, 0x22d, 0x22f, 0x239,          // planks, shadowed planks
    0x2d2, 0x2d4, 0x2da, 0x2dc,                                        // planks beside Wanda's bed
    0x2fa, 0x2fb, 0x2fc, 0x309,                                        // planks under an inner wall's cap
    0x35b,                                                             // planks under a display case's top (Steven's)
    0x238, 0x270, 0x271, 0x274, 0x275, 0x27e, 0x27f,                   // walkable feet: TV stand, cabinet, bookshelf,
    0x288, 0x289, 0x28a, 0x296, 0x297]),                               //   sink, stove, bookcase, fridge, drawers, sideboard
  ...all('mat', [0x208, 0x209]),                                       // exit mat (SOUTH_ARROW_WARP)
  ...all('rug', [0x235, 0x236, 0x237, 0x23d, 0x23e, 0x23f, 0x245, 0x246, 0x247, 0x23a]),   // peach rug
  ...all('rug', [0x259]),                                              // floor cushion
  ...all('tv', [0x230, 0x21e]),                                        // TV: top on the wall, set
  ...all('table', [0x248, 0x249, 0x24a, 0x24b, 0x250, 0x251, 0x252, 0x253, 0x25e,   // yellow table (teapot)
    0x24c, 0x24d, 0x254, 0x255,                                        // long table (Fan Club)
    0x27b, 0x27c,                                                      // table against the wall (Dewford Hall)
    0x2e8, 0x2e9, 0x2ea, 0x2f0, 0x2f1, 0x2f2, 0x2d1]),                 // big cream table
  ...all('chair', [0x22b, 0x22c, 0x2e1, 0x2e2,                         // armchairs on boards / on the rug
    0x234, 0x23c,                                                      // wooden chairs (Safari rest house)
    0x283, 0x284, 0x28b, 0x28c]),                                      // white sofa
  ...all('bed', [0x2d3, 0x2db]),                                       // white bed (Wanda's house; head IMPASSABLE_SOUTH_AND_NORTH)
  ...all('plant', [0x222, 0x22a, 0x290, 0x298, 0x291, 0x299]),         // potted plant: leaves, pot
  ...all('cabinet', [0x268,                                            // small drawer cabinet
    0x279, 0x281, 0x27a, 0x282,                                        // chest of drawers
    0x286, 0x287, 0x28e, 0x28f,                                        // glass-front sideboard
    0x363]),                                                           // glass display case (Steven's stones)
  ...all('sink', [0x26c, 0x26d]),                                      // kitchen unit: sink, stove
  ...all('fridge', [0x278, 0x280]),
  ...all('bookshelf', [0x269,                                          // small green bookshelf (PICTURE_BOOK_SHELF)
    0x26e, 0x26f, 0x276, 0x277]),                                      // teal bookcase (BOOKSHELF)
  ...all('bed', [0x25a, 0x25b, 0x262, 0x263]),
  ...all('wall', [0x302, 0x303, 0x304, 0x30a, 0x30c]),                 // inner wall (Dewford Hall, Fan Club)
  ...all('wall', [0x2f8, 0x300, 0x308, 0x310]),                        // white partition (Dewford Hall, Wanda's house)
  ...all('wall', [0x202, 0x203, 0x204, 0x20a, 0x20c]),                 // stair opening's frame (Game Corner B1F)
  ...all('stairsUp', [0x20b]),                                         // stairs up (NON_ANIMATED_DOOR)
];

// ---- tatami houses --------------------------------------------------------------------------------------------------
const TATAMI: [number, InteriorId][] = [
  ...all('wall', [0x215, 0x21d,                                        // beige wall
    0x2e3, 0x2e4, 0x2eb, 0x2ec]),                                      // wooden posts at the room's sides
  ...all('window', [0x217, 0x21f]),                                    // round window
  ...all('carpet', [0x221, 0x229, 0x2d6, 0x2f3, 0x2f4,                 // tatami (and the posts' feet on it)
    0x2fd, 0x2fe, 0x2ff,                                               // tatami with dug-out earth (Fossil Maniac)
    0x240, 0x2a8, 0x2a9, 0x2b6, 0x2b7, 0x2c0, 0x2c1, 0x2c2, 0x2ce, 0x2cf]),   // walkable feet: TV, cabinets, bookcases, fridge
  ...all('rug', [0x244]),                                              // floor cushion
  ...all('tiles', [0x318, 0x320, 0x31b, 0x323]),                       // raised edge and the stone entry
  ...all('mat', [0x210, 0x211]),                                       // exit mat (SOUTH_ARROW_WARP)
  ...all('tv', [0x216]),                                               // TV top on the wall (0x21e: the set)
  ...all('table', [0x24e, 0x24f, 0x256, 0x257, 0x25f]),                // low table
  ...all('cabinet', [0x2be, 0x2bf, 0x2c6, 0x2c7,                       // glass-front sideboard
    0x2a0,                                                             // small drawer cabinet
    0x2b1, 0x2b2, 0x2b9, 0x2ba,                                        // chest of drawers
    0x306, 0x307, 0x30e, 0x30f]),                                      // glass display case (Fossil Maniac; its own top)
  ...all('bookshelf', [0x2a6, 0x2a7, 0x2ae, 0x2af,                     // teal bookcase (BOOKSHELF)
    0x316, 0x317,                                                      // its top on a lower wall (Fossil Maniac)
    0x2a1]),                                                           // small green bookshelf (PICTURE_BOOK_SHELF)
  ...all('fridge', [0x2b0, 0x2b8]),
  ...all('vase', [0x2b3, 0x2b4]),                                      // clay pots (VASE)
  ...all('plant', [0x319, 0x31a, 0x322, 0x327]),                       // potted plant (Trick House)
  ...all('wall', [0x212, 0x213, 0x214, 0x261, 0x21a, 0x21c]),          // stair opening's frame (motel, Trick House)
  ...all('decor', [0x21b]),                                            // the Trick Master's scroll
  ...all('stairsDown', [0x219]),                                       // stairs down (NON_ANIMATED_DOOR)
  ...all('decor', [0x2ed, 0x2ee, 0x2ef, 0x2f5, 0x2f7]),                // rocks round the dug tunnel (Fossil Maniac)
  ...all('legacy', [0x2f6]),                                           // the dug tunnel (NON_ANIMATED_DOOR)
];

// ---- Rustboro -------------------------------------------------------------------------------------------------------
const RUSTBORO: [number, InteriorId][] = [
  ...all('wall', [0x338, 0x340]),                                      // yellow wall (also the inner walls of Flat2)
  ...all('window', [0x339, 0x341, 0x33a, 0x342]),                      // small / double window
  ...all('wall', [0x328, 0x329, 0x32a, 0x330, 0x332, 0x35a, 0x362]),   // stair openings' frame
  ...all('tiles', [0x32b, 0x32c, 0x31e, 0x29d,                         // chequered tiles (0x31e/0x29d under an inner wall's cap)
    0x336, 0x350, 0x351, 0x352, 0x353, 0x35e, 0x35f,                   // walkable feet: TV stand, cabinet, bookshelf,
    0x376, 0x377, 0x388, 0x389, 0x38a]),                               //   stove counter, kitchen, sideboard, fridge, bookcase
  ...all('wall', [0x29e, 0x29f]),                                      // inner wall's end (Flat2)
  ...all('wall', [0x2d7, 0x2df, 0x2e7]),                               // white partition (Flat2)
  ...all('mat', [0x34c, 0x34d]),                                       // exit mat (SOUTH_ARROW_WARP)
  ...all('rug', [0x37b, 0x37c, 0x37d, 0x383, 0x385, 0x38b, 0x38c, 0x38d, 0x32f, 0x384, 0x3fd]),
  ...all('tv', [0x331]),                                               // TV top on the wall (0x21e: the set)
  ...all('chair', [0x344, 0x345,                                       // armchairs
    0x337, 0x33f, 0x354, 0x355, 0x35c, 0x35d]),                        // white sofa
  ...all('table', [0x368, 0x369, 0x370, 0x371, 0x36a, 0x36b, 0x372, 0x373,
    0x37e, 0x37f, 0x386, 0x387, 0x38e, 0x38f]),                        // big cream table
  ...all('plant', [0x343, 0x346, 0x347, 0x34e, 0x34f]),
  ...all('cabinet', [0x348,                                            // small drawer cabinet
    0x366, 0x367, 0x36e, 0x36f]),                                      // glass-front sideboard
  ...all('sink', [0x356, 0x357,                                        // kitchen unit: sink, stove
    0x34a, 0x34b]),                                                    // white stove counter
  ...all('fridge', [0x378, 0x380]),
  ...all('bookshelf', [0x349,                                          // small green bookshelf (PICTURE_BOOK_SHELF)
    0x379, 0x37a, 0x381, 0x382]),                                      // teal bookcase (BOOKSHELF)
  ...all('bed', [0x321, 0x3b6]),
];

// ---- Pacifidlog log cabins ------------------------------------------------------------------------------------------
const CABIN: [number, InteriorId][] = [
  ...all('wall', [0x391, 0x399, 0x390, 0x392, 0x398, 0x39a]),          // log wall, slanted corners
  ...all('boards', [0x3a1, 0x3a3, 0x3a0, 0x3a2,                        // log boards (and the corners' feet)
    0x3e6, 0x3e7,                                                      // front corners (void triangles, blocked)
    0x39b, 0x3a7, 0x3b0, 0x3b1, 0x3c0, 0x3c1, 0x3c2, 0x3c3, 0x3c4, 0x3c5]),   // walkable feet of the furniture
  ...all('rug', [0x394, 0x395, 0x396, 0x39c, 0x39d, 0x39e, 0x3a4, 0x3a5, 0x3a6]),   // blue rug
  ...all('mat', [0x3ac, 0x3ad]),                                       // exit mat (SOUTH_ARROW_WARP)
  ...all('tv', [0x393]),                                               // TV top on the wall (0x21e: the set)
  ...all('fridge', [0x397, 0x39f]),
  ...all('cabinet', [0x3a8,                                            // small drawer cabinet
    0x3b4, 0x3b5, 0x3bc, 0x3bd,                                        // chest of drawers
    0x3ba, 0x3bb]),                                                    // glass-front sideboard
  ...all('sink', [0x3b8, 0x3b9]),                                      // kitchen unit: sink, stove
  ...all('bookshelf', [0x3a9]),                                        // small green bookshelf (PICTURE_BOOK_SHELF)
  ...all('table', [0x3aa, 0x3ab, 0x3b2, 0x3b3]),
  ...all('chair', [0x3ae, 0x3af]),                                     // wooden stools
  ...all('vase', [0x3b7]),                                             // clay pot (VASE)
];

// ---- Fortree tree houses --------------------------------------------------------------------------------------------
const FORTREE: [number, InteriorId][] = [
  ...all('wall', [0x3c8, 0x3c9, 0x3ca, 0x3d0, 0x3d1, 0x3d2]),          // orange wall, slanted corners
  ...all('boards', [0x3d9, 0x3db, 0x3dc, 0x3d8, 0x3da,                 // planks (and the corners' feet)
    0x3cc, 0x3cd,                                                      // front corners (void triangles, blocked)
    0x3d3, 0x3e8,                                                      // walkable feet of the TV and the cabinet
    0x3ce, 0x3cf, 0x3ee]),                                             // planks behind the counters (their tops overhang)
  ...all('legacy', [0x3be, 0x3bf, 0x3c6, 0x3c7]),                      // the tree trunk through the room
  ...all('mat', [0x3d4, 0x3d5]),                                       // exit mat (SOUTH_ARROW_WARP)
  ...all('tv', [0x3cb]),                                               // TV top on the wall (0x21e: the set)
  ...all('cabinet', [0x3e0,                                            // small drawer cabinet
    0x3e3, 0x3e4, 0x3eb, 0x3ec]),                                      // chest of drawers
  ...all('counter', [0x3ed, 0x3ef,                                     // Decoration Shop counters: blocked top-row ends
    0x3d6, 0x3d7, 0x3f5, 0x3f6, 0x3f7]),                               // front row (COUNTER)
];

// ---- Sootopolis -----------------------------------------------------------------------------------------------------
const SOOTOPOLIS: [number, InteriorId][] = [
  ...all('wall', [0x3f0, 0x3f8]),                                      // white wall
  ...all('window', [0x3f1, 0x3f9, 0x3f2, 0x3fa]),                      // arched / round window
  ...all('tiles', [0x3fe,                                              // grey stone tiles (0x3ff: MAPGRID_UNDEFINED, void)
    0x2b5, 0x2c3, 0x2c4, 0x2d5, 0x2d8, 0x2d9]),                        // walkable feet: TV stand, kitchen, cabinet, bookcase
  ...all('table', [0x3f3, 0x3f4, 0x3fb, 0x3fc, 0x3dd, 0x3de, 0x3df, 0x3e5]),
  ...all('chair', [0x2dd, 0x2de,                                       // armchairs
    0x292, 0x293, 0x29a, 0x29b]),                                      // white sofa
  ...all('cabinet', [0x2cd]),                                          // small drawer cabinet
  ...all('sink', [0x2bb, 0x2bc]),                                      // kitchen unit: sink, stove
  ...all('fridge', [0x2bd, 0x2c5]),
  ...all('bookshelf', [0x2c8, 0x2c9]),                                 // teal bookcase's top (0x276/0x277 BOOKSHELF)
  ...all('plant', [0x294, 0x29c]),
];

export const GENERIC_BUILDING: InteriorTable = {
  name: 'GenericBuilding',
  ids: new Map<number, InteriorId>([...PLANK, ...TATAMI, ...RUSTBORO, ...CABIN, ...FORTREE, ...SOOTOPOLIS]),
  target: 0.97,
  pins: [
    // Oldale House1 (2.0): sideboard, wall, window, plant pot, table, armchair on the rug, rug, planks, exit mat
    { map: [2, 0], x: 0, y: 1, id: 'cabinet' }, { map: [2, 0], x: 4, y: 0, id: 'wall' },
    { map: [2, 0], x: 5, y: 1, id: 'window' }, { map: [2, 0], x: 8, y: 2, id: 'plant' },
    { map: [2, 0], x: 2, y: 4, id: 'table' }, { map: [2, 0], x: 4, y: 4, id: 'chair' },
    { map: [2, 0], x: 5, y: 4, id: 'rug' }, { map: [2, 0], x: 8, y: 3, id: 'boards' },
    { map: [2, 0], x: 3, y: 8, id: 'mat' },
    // Oldale House2 (2.1): TV, picture, sink, stove, fridge
    { map: [2, 1], x: 2, y: 1, id: 'tv' }, { map: [2, 1], x: 5, y: 1, id: 'decor' },
    { map: [2, 1], x: 8, y: 1, id: 'sink' }, { map: [2, 1], x: 9, y: 1, id: 'sink' },
    { map: [2, 1], x: 10, y: 1, id: 'fridge' },
    // Dewford House1 (3.0): round window, bookcase, low table, cushion, tatami, stone entry
    { map: [3, 0], x: 3, y: 1, id: 'window' }, { map: [3, 0], x: 6, y: 1, id: 'bookshelf' },
    { map: [3, 0], x: 4, y: 3, id: 'table' }, { map: [3, 0], x: 3, y: 3, id: 'rug' },
    { map: [3, 0], x: 1, y: 3, id: 'carpet' }, { map: [3, 0], x: 1, y: 7, id: 'tiles' },
    // Dewford House2 (3.5): clay pot; Petalburg House2 (8.3): bed
    { map: [3, 5], x: 3, y: 2, id: 'vase' }, { map: [8, 3], x: 0, y: 4, id: 'bed' },
    // Rustboro Flat1 1F / 2F (11.8 / 11.9): stairs up, stairs down
    { map: [11, 8], x: 2, y: 1, id: 'stairsUp' }, { map: [11, 9], x: 2, y: 1, id: 'stairsDown' },
    // Fortree Decoration Shop (12.9): counter; Fortree House1 (12.0): the tree trunk
    { map: [12, 9], x: 2, y: 3, id: 'counter' }, { map: [12, 0], x: 3, y: 2, id: 'legacy' },
    // Sootopolis House1 (15.5): stone tiles, arched window
    { map: [15, 5], x: 1, y: 3, id: 'tiles' }, { map: [15, 5], x: 2, y: 1, id: 'window' },
    // Walkable feet are floor: sideboard (2.0), fridge (2.1), TV stand (3.0), fridge (11.8), cabinet (15.5),
    // fridge (7.2). A counter's top overhang is floor (12.9). Steven's stacked cases stay one piece per case (14.7).
    { map: [2, 0], x: 0, y: 2, id: 'boards' }, { map: [2, 1], x: 10, y: 2, id: 'boards' },
    { map: [3, 0], x: 5, y: 2, id: 'carpet' }, { map: [11, 8], x: 10, y: 2, id: 'tiles' },
    { map: [15, 5], x: 0, y: 2, id: 'tiles' }, { map: [7, 2], x: 8, y: 2, id: 'boards' },
    { map: [12, 9], x: 2, y: 2, id: 'boards' },
    { map: [14, 7], x: 10, y: 3, id: 'boards' }, { map: [14, 7], x: 10, y: 4, id: 'cabinet' },
    // Wanda's bed (6.6), a partition (Dewford Hall 3.4), a cabin's front corner (7.2)
    { map: [6, 6], x: 15, y: 3, id: 'bed' }, { map: [3, 4], x: 10, y: 3, id: 'wall' },
    { map: [7, 2], x: 0, y: 8, id: 'boards' },
  ],
};
