// gTileset_Lab (4 in-scope maps: Birch's lab 1.4, Lanette's house 20.2, the Weather Institute 1F / 2F 32.0 / 32.1): what
// its secondary ids (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4c; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only Lab --sheet-scale 5 --sheet-chunk 32).
//
// Rules applied (as in brendansMaysHouse.ts):
// - A blocked cell holding part of an object takes the object's kind: a computer's top over the wall is `pc`; a desk's
//   binders, papers, cups and legs are all `table`; the crate whose top shows under a bookcase's base (0x220) is `crate`,
//   so the bookcase is a clean 2 × 2 block.
// - A walkable cell takes its floor kind (`tiles`) even where an object's art overhangs into it (crate and shelf tops,
//   desk legs and drawers, plant leaves, pillar caps); the exceptions are the game's walkable furniture: chairs, stairs,
//   mats.
// - `legacy` (no family draws them; their cells keep the GBA art): the book piles (stacks of binders on the floor,
//   0x232 / 0x248 / 0x29A), Birch's red-domed analyser and the grey unit beside it (0x214 0x215 0x21C 0x21D 0x21E), the
//   Weather Institute's orange tank machine (0x26C 0x26D 0x274 0x275) and its white pillars (0x26B 0x270 0x273 0x278
//   0x281).
// - Wall rows: paint and wainscot `wall` (also the Weather Institute's wall between its two rooms, rows 8–9, and the
//   stair doorway's frame); the notes pinned on the wall `decor`.

import type { InteriorId, InteriorTable } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };

// Floors.
put('tiles',
  0x202, 0x204, 0x205, 0x216, 0x221, 0x222, 0x223, 0x224, 0x225, 0x226,   // Birch's / Lanette's tiles; overhangs on them
  0x229, 0x22a, 0x233, 0x236, 0x237, 0x23a, 0x23d, 0x23e, 0x23f, 0x247,
  0x24f, 0x292,
  0x252, 0x255, 0x25a, 0x268, 0x269, 0x26a, 0x272, 0x276, 0x277, 0x27a,   // the Weather Institute's grey tiles
  0x280, 0x28c, 0x28d, 0x28e, 0x28f, 0x298, 0x299);
put('mat', 0x206, 0x207);                                                 // the front door's mat (SOUTH_ARROW_WARP)

// Wall rows.
put('wall',
  0x208, 0x20a, 0x23c,                                                    // Birch's / Lanette's paint and wainscot
  0x25f, 0x267, 0x27f,                                                    // the Weather Institute's
  0x27c, 0x27d, 0x27e, 0x284, 0x286);                                     // the stair doorway's frame
put('decor', 0x209);                                                      // notes pinned on the wall

// Furniture.
put('bookshelf', 0x210, 0x211, 0x218, 0x219,                              // the bookcases in the wall rows
  0x22c, 0x22d, 0x234, 0x235);                                            // the free-standing ones
put('crate', 0x220, 0x228, 0x231, 0x242, 0x24a);
put('plant', 0x244, 0x22e, 0x25d, 0x266, 0x287);
put('pc', 0x212, 0x213, 0x21a, 0x21b,                                     // Birch's / Lanette's computer on its desk
  0x26e, 0x288, 0x289, 0x290, 0x291);                                     // the Weather Institute's
put('table',
  0x20b, 0x20c, 0x20d, 0x20e, 0x24c,                                      // the desks against the back wall (books on them)
  0x230, 0x238, 0x240, 0x23b, 0x243, 0x24b, 0x250, 0x251, 0x258, 0x259,   // Birch's / Lanette's desks
  0x253, 0x254, 0x25c, 0x260, 0x261, 0x264, 0x265, 0x28a, 0x28b);         // the Weather Institute's desks
put('chair', 0x239, 0x241, 0x249, 0x256, 0x257, 0x25e);
put('stairsUp', 0x285);                                                   // Weather Institute 1F → 2F (NON_ANIMATED_DOOR)
put('stairsDown', 0x283);                                                 // 2F → 1F (NON_ANIMATED_DOOR)
put('legacy',
  0x232, 0x248, 0x29a,                                                    // book piles
  0x214, 0x215, 0x21c, 0x21d, 0x21e,                                      // Birch's analyser and the unit beside it
  0x26c, 0x26d, 0x274, 0x275,                                             // the orange tank machine
  0x26b, 0x270, 0x273, 0x278, 0x281);                                     // pillars

export const LAB: InteriorTable = {
  name: 'Lab',
  ids,
  target: 0.97,
  pins: [
    // Birch's lab (1.4)
    { map: [1, 4], x: 0, y: 1, id: 'bookshelf' }, { map: [1, 4], x: 1, y: 0, id: 'bookshelf' },
    { map: [1, 4], x: 2, y: 7, id: 'bookshelf' }, { map: [1, 4], x: 1, y: 5, id: 'tiles' },
    { map: [1, 4], x: 2, y: 2, id: 'plant' }, { map: [1, 4], x: 3, y: 12, id: 'plant' },
    { map: [1, 4], x: 3, y: 1, id: 'pc' }, { map: [1, 4], x: 4, y: 0, id: 'pc' }, { map: [1, 4], x: 3, y: 2, id: 'tiles' },
    { map: [1, 4], x: 7, y: 1, id: 'table' }, { map: [1, 4], x: 1, y: 11, id: 'table' }, { map: [1, 4], x: 11, y: 9, id: 'table' },
    { map: [1, 4], x: 4, y: 3, id: 'chair' }, { map: [1, 4], x: 2, y: 10, id: 'chair' },
    { map: [1, 4], x: 10, y: 4, id: 'crate' }, { map: [1, 4], x: 0, y: 2, id: 'crate' }, { map: [1, 4], x: 10, y: 3, id: 'tiles' },
    { map: [1, 4], x: 6, y: 12, id: 'mat' }, { map: [1, 4], x: 6, y: 6, id: 'tiles' },
    { map: [1, 4], x: 5, y: 0, id: 'wall' }, { map: [1, 4], x: 7, y: 0, id: 'decor' },
    { map: [1, 4], x: 11, y: 6, id: 'legacy' }, { map: [1, 4], x: 0, y: 10, id: 'legacy' },
    // Lanette's house (20.2)
    { map: [20, 2], x: 7, y: 1, id: 'pc' }, { map: [20, 2], x: 0, y: 5, id: 'table' }, { map: [20, 2], x: 7, y: 5, id: 'crate' },
    // Weather Institute 1F (32.0) and 2F (32.1)
    { map: [32, 0], x: 2, y: 1, id: 'pc' }, { map: [32, 0], x: 17, y: 1, id: 'stairsUp' },
    { map: [32, 0], x: 8, y: 2, id: 'bookshelf' }, { map: [32, 0], x: 12, y: 6, id: 'table' },
    { map: [32, 0], x: 13, y: 5, id: 'chair' }, { map: [32, 0], x: 10, y: 9, id: 'wall' }, { map: [32, 0], x: 3, y: 4, id: 'legacy' },
    { map: [32, 1], x: 17, y: 1, id: 'stairsDown' }, { map: [32, 1], x: 8, y: 4, id: 'table' }, { map: [32, 1], x: 0, y: 4, id: 'chair' },
  ],
};
