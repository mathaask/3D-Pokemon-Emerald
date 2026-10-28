// gTileset_PokemonFanClub: the Pokémon Fan Club 9.6.
// What its ids are, curated by Phase 4b Task 4e from its map (worklists out/interior-ids-4b.task2.txt and
// out/live-ids.task2.txt: no live ids, no mechanics; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PokemonFanClub
// --sheet-scale 5 --sheet-chunk 32).
//
// The room: a striped wall (rows 0–1) with two pillars standing out of it (x 2 and 11, down to row 2: wall art, the back
// wall steps forward there), a framed Pikachu picture and a round portrait, two potted plants in the wall rows, a low
// record shelf (BOOKSHELF) at the west end and a green bookcase (PICTURE_BOOK_SHELF) at the east end; a cream swirl
// carpet with a red rug, on it a green sofa and two armchairs round a glass table; two more plants at the front.
// - The sofa and the armchairs are walkable in the game: `chair` (Phase 4: sofas are `chair`).
// - Walkable cells under art (the wall's dado on row 2, the sofa's and the table's shadows, the table's legs) are their
//   floor: `carpet` off the rug, `rug` on it. The front plants' leaves (walkable, the plants' own art) are `plant`.
// - No `legacy`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();

// Wall rows.
put('wall', 0x211, 0x212, 0x214, 0x21d,                                   // the wall's top row, the stripes
  0x21c, 0x224, 0x225);                                                   // the two pillars (top, foot)
put('painting', 0x219, 0x21a);                                            // the Pikachu picture, the round portrait

// Floors.
put('carpet', 0x201, 0x202, 0x204, 0x205, 0x206,                          // cream swirl carpet, shaded at the edges
  0x221, 0x222);                                                          // under the wall's dado (row 2)
put('rug',
  0x228, 0x229, 0x22a, 0x230, 0x231, 0x232, 0x238, 0x23e, 0x23c, 0x23d, 0x23a,   // the red rug and its edges
  0x234, 0x237, 0x23f, 0x23b, 0x253, 0x25b,                               // shaded by the sofa and the armchairs
  0x264, 0x265, 0x266, 0x267);                                            // the glass table's legs on it

// Furniture.
put('bookshelf', 0x240, 0x241, 0x248, 0x249,                              // the low record shelf (BOOKSHELF)
  0x242, 0x243, 0x24a, 0x24b);                                            // the green bookcase (PICTURE_BOOK_SHELF)
put('plant', 0x244, 0x24c, 0x245, 0x24d,                                  // the plants in the wall rows: leaves, pot
  0x246, 0x24e, 0x247, 0x24f);                                            // the front plants: leaves (walkable), pot
put('chair',
  0x250, 0x251, 0x252, 0x258, 0x259, 0x25a,                               // the sofa (back, seat)
  0x22e, 0x236, 0x22d, 0x235);                                            // the armchairs (west, east)
put('table', 0x260, 0x261, 0x262, 0x25c, 0x25d, 0x25e, 0x25f);            // the glass table

export const POKEMON_FAN_CLUB: InteriorTable = {
  name: 'PokemonFanClub', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['9.6'],
  pins: [
    { map: [9, 6], x: 5, y: 0, id: 'wall' },
    { map: [9, 6], x: 4, y: 1, id: 'wall' },
    { map: [9, 6], x: 2, y: 2, id: 'wall' },          // a pillar's foot, standing out of the wall
    { map: [9, 6], x: 6, y: 1, id: 'painting' },
    { map: [9, 6], x: 7, y: 1, id: 'painting' },
    { map: [9, 6], x: 0, y: 2, id: 'bookshelf' },     // the record shelf
    { map: [9, 6], x: 13, y: 1, id: 'bookshelf' },    // the bookcase's top
    { map: [9, 6], x: 3, y: 1, id: 'plant' },         // leaves in the wall row
    { map: [9, 6], x: 10, y: 2, id: 'plant' },
    { map: [9, 6], x: 13, y: 9, id: 'plant' },        // a front plant's walkable leaves
    { map: [9, 6], x: 0, y: 10, id: 'plant' },
    { map: [9, 6], x: 5, y: 2, id: 'carpet' },        // under the dado
    { map: [9, 6], x: 1, y: 6, id: 'carpet' },
    { map: [9, 6], x: 2, y: 4, id: 'rug' },
    { map: [9, 6], x: 9, y: 5, id: 'rug' },           // the sofa's shadow
    { map: [9, 6], x: 6, y: 8, id: 'rug' },           // the table's legs
    { map: [9, 6], x: 6, y: 4, id: 'chair' },         // the sofa
    { map: [9, 6], x: 8, y: 5, id: 'chair' },
    { map: [9, 6], x: 3, y: 6, id: 'chair' },         // the armchairs
    { map: [9, 6], x: 10, y: 7, id: 'chair' },
    { map: [9, 6], x: 5, y: 6, id: 'table' },
    { map: [9, 6], x: 8, y: 7, id: 'table' },
    { map: [9, 6], x: 6, y: 10, id: 'mat' },
  ],
};
