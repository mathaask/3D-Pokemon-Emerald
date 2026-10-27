// gTileset_PokemonCenter (34 in-scope maps: every Pokémon Center 1F / 2F, the League lobby 1F / 2F): what its secondary
// ids (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4b; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PokemonCenter --sheet-scale 5 --sheet-chunk 32).
//
// Four layouts use it: the standard 1F (15 maps; Lavaridge's 4.5 swaps the bookcase corner for two plants round the
// hot-spring door), the standard 2F (17 maps, the League 2F 16.14 included) and the League lobby 1F (16.10).
// Labelling rules beyond the brief's:
// - A walkable cell keeps a floor kind even where the art of the furniture south of it (a pot's foot, a bookcase's
//   bottom shelf, the PC's base, all drawn under the player) or the counter's back edge reaches into it: models stand on
//   the cells the game blocks, and the nurse / attendants stand on such cells behind their counters. Exceptions: a
//   plant's leaves drawn in the walkable cell north of its pot are `plant` (the art overhangs north: the furniture
//   family's CLAIM_TOP), and the stools (walkable in the game) are `chair`.
// - The nurse's counter, its two raised ends and the attendants' counters on 2F are `pcCounter`; the healing machine on
//   it `healer`; the console beside the nurse (on the counter, 0x25B) `pcCounter`.
// - The 2F kiosks (cable / wireless results machines) and the white posts over them are `pc`, as the PC beside them.
// - The 2F glass doors behind the counters (0x25C / 0x264), the posts' wall part and the League's dark doorway are
//   wall `decor` (they are doors, not windows: no glass, no light shaft).
// - `legacy`: the Poké Ball floor inlay (1F, League), the 2F floor emblems, the escalators (no family models one; they
//   run along the west wall), and the floor of the doors north (Lavaridge's hot-spring door 0x2B9, the League's 0x2BC).

import type { InteriorId, InteriorTable } from '../building';

const ids: [InteriorId, number[]][] = [
  // Walls: corners, sides and the plain back wall.
  ['wall', [0x208, 0x20b, 0x20f, 0x210, 0x213, 0x217, 0x269, 0x26a]],
  // Wall art: the monitor over the counter, the region map (0x215 / 0x216 REGION_MAP), the 2F glass doors and white
  // posts, the League's dark doorway and its frame, Lavaridge's hot-spring sign.
  ['decor', [0x24a, 0x24b, 0x252, 0x253, 0x20d, 0x20e, 0x215, 0x216, 0x25c, 0x264, 0x23f, 0x247,
    0x2b3, 0x2b4, 0x2b5, 0x2bb, 0x2bd, 0x2b1]],
  // Floor: the tiles and their shadow / wall-edge / overhang variants (all walkable); the two cut corners (blocked).
  ['tiles', [0x202, 0x206, 0x207, 0x218, 0x219, 0x21d, 0x21e, 0x21f, 0x220, 0x224, 0x225, 0x227, 0x228, 0x229, 0x22f,
    0x237, 0x23c, 0x240, 0x243, 0x244, 0x260, 0x261, 0x262, 0x267, 0x26c, 0x26f, 0x273, 0x274, 0x275, 0x279, 0x27a,
    0x27d, 0x2b6, 0x2bf, 0x2c0, 0x2c1, 0x2c2, 0x2c3, 0x2c4, 0x2c5, 0x2cd, 0x2cf, 0x2d8, 0x2d9]],
  ['mat', [0x203, 0x204]],
  // The nurse's counter (1F, League) and the attendants' counters with their grey gates (2F).
  ['pcCounter', [0x205, 0x221, 0x248, 0x249, 0x250, 0x251, 0x258, 0x259, 0x25b, 0x25d, 0x2d5, 0x2d6, 0x2d7, 0x2e0]],
  ['healer', [0x222, 0x223, 0x22a, 0x22b]],
  // The PC's top over the wall (1F) / over the counter (2F); the 2F kiosks and the posts over them.
  ['pc', [0x20c, 0x2a6, 0x24f, 0x2da, 0x2db, 0x2e2, 0x2e3]],
  ['bookshelf', [0x271, 0x272]],
  // Potted plants (leaves + pot), Lavaridge's pair, the League's.
  ['plant', [0x209, 0x211, 0x25e, 0x266, 0x20a, 0x212, 0x2b0, 0x2b2, 0x2b8, 0x2ba]],
  // The glass coffee tables.
  ['table', [0x23d, 0x23e, 0x245, 0x246]],
  // The pink and yellow stools.
  ['chair', [0x226, 0x234]],
  ['legacy', [
    // The Poké Ball inlay: 1F and the League's larger one.
    0x26d, 0x26e, 0x230, 0x231, 0x232, 0x233, 0x238, 0x239, 0x23a, 0x23b, 0x241, 0x242,
    0x276, 0x277, 0x27b, 0x27c, 0x27e, 0x27f, 0x286, 0x287, 0x28e, 0x28f,
    // The 2F floor emblems.
    0x2c8, 0x2c9, 0x2ca, 0x2cb, 0x2cc, 0x2d0, 0x2d1, 0x2d2, 0x2d3, 0x2d4,
    // The escalators up (1F) and down (2F).
    0x280, 0x281, 0x288, 0x289, 0x290, 0x291, 0x298, 0x299, 0x2a0, 0x2a1, 0x2a8, 0x2a9,
    // The floor of the doors north.
    0x2b9, 0x2bc,
  ]],
];

export const POKEMON_CENTER: InteriorTable = {
  name: 'PokemonCenter',
  ids: new Map<number, InteriorId>(ids.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id]))),
  target: 0.97,
  pins: [
    // Oldale PC 1F (2.2).
    { map: [2, 2], x: 5, y: 1, id: 'healer' },
    { map: [2, 2], x: 6, y: 2, id: 'healer' },
    { map: [2, 2], x: 7, y: 3, id: 'pcCounter' },     // the nurse's counter, its front (COUNTER)
    { map: [2, 2], x: 4, y: 1, id: 'pcCounter' },     // its raised west end
    { map: [2, 2], x: 7, y: 2, id: 'tiles' },         // where the nurse stands
    { map: [2, 2], x: 10, y: 1, id: 'pc' },
    { map: [2, 2], x: 10, y: 0, id: 'pc' },           // the PC's top over the wall
    { map: [2, 2], x: 10, y: 2, id: 'tiles' },        // the PC's base, walkable
    { map: [2, 2], x: 1, y: 1, id: 'plant' },
    { map: [2, 2], x: 2, y: 1, id: 'bookshelf' },
    { map: [2, 2], x: 2, y: 0, id: 'wall' },
    { map: [2, 2], x: 11, y: 1, id: 'decor' },        // the region map
    { map: [2, 2], x: 7, y: 0, id: 'decor' },         // the monitor
    { map: [2, 2], x: 11, y: 6, id: 'table' },
    { map: [2, 2], x: 1, y: 3, id: 'chair' },
    { map: [2, 2], x: 3, y: 5, id: 'tiles' },
    { map: [2, 2], x: 6, y: 8, id: 'mat' },
    { map: [2, 2], x: 6, y: 6, id: 'legacy' },        // the Poké Ball inlay
    { map: [2, 2], x: 1, y: 6, id: 'legacy' },        // the escalator
    // Oldale PC 2F (2.3).
    { map: [2, 3], x: 1, y: 3, id: 'pcCounter' },
    { map: [2, 3], x: 5, y: 3, id: 'pcCounter' },     // the grey gate between two counters
    { map: [2, 3], x: 6, y: 2, id: 'tiles' },         // an attendant's place behind the counter
    { map: [2, 3], x: 3, y: 3, id: 'pc' },
    { map: [2, 3], x: 8, y: 4, id: 'pc' },            // a kiosk
    { map: [2, 3], x: 5, y: 1, id: 'decor' },         // a glass door
    { map: [2, 3], x: 5, y: 9, id: 'plant' },
    { map: [2, 3], x: 5, y: 8, id: 'plant' },         // its leaves over the walkable cell north of the pot
    { map: [2, 3], x: 3, y: 9, id: 'chair' },
    { map: [2, 3], x: 5, y: 5, id: 'legacy' },        // the floor emblem
    // Lavaridge PC 1F (4.5), the League lobby (16.10).
    { map: [4, 5], x: 1, y: 1, id: 'plant' },
    { map: [4, 5], x: 2, y: 0, id: 'decor' },         // the hot-spring sign over the door
    { map: [16, 10], x: 1, y: 1, id: 'healer' },
    { map: [16, 10], x: 16, y: 3, id: 'pcCounter' },  // the clerk's counter
    { map: [16, 10], x: 16, y: 2, id: 'tiles' },      // where the clerk stands
    { map: [16, 10], x: 9, y: 0, id: 'decor' },       // the doorway to the Elite Four
    { map: [16, 10], x: 9, y: 6, id: 'legacy' },      // the big Poké Ball inlay
  ],
};
