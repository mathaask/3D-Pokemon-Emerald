// gTileset_BrendansMaysHouse (4 in-scope maps: Brendan's and May's houses, 1F and 2F): what its secondary ids
// (0x200–0x3FF) are, curated from its maps (Phase 4 Task 4c; worklist out/interior-ids.task3.txt,
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only BrendansMaysHouse --sheet-scale 5 --sheet-chunk 32).
//
// The two houses are mirror images built from the same ids (May's 1F kitchen and stairs on the other side, May's 2F bed
// on the right), so every id means one thing on all four maps. Rules applied:
// - A blocked cell holding part of an object takes the object's kind (the 1F glass-door dish cabinet and the low white
//   sideboard beside the TV are `cabinet`; the stove beside the sink is part of the kitchen counter, `sink`; the 2F
//   computer desk, its notebook end included, is `pc`).
// - A walkable cell takes its floor kind even where an object's art overhangs into it (the TV's top and stand, the bed's
//   sides and headboard top, the desk legs, the GameCube controller): its model stands on the blocked cells only. The
//   exceptions are the game's walkable furniture: chairs, stairs, mats.
// - Rugs: the 1F dining rugs' art covers 5.7–8.8 of their rows, so their top row (mostly boards, a rug edge along its
//   bottom) is `boards` and the rug spans the three rows below; the 2F rugs (the decoration mats) fill their 4 × 4 cells.
// - Wall rows: plain paint, wainscot, the stair alcove's frame, and the TV's top arc over the wall are `wall`; the window
//   bottoms (0x226: a thin strip of glass over wall) are `wall`, the windows proper `window`; the region map and its
//   frame `decor`; the GameCube in the 2F wall rows (a small console on the floor, no kind for it) `decor`.
// - 0x21F (black, in the 1F stair alcove's corners) is void and is not labelled.

import type { InteriorId, InteriorTable } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };

// Floors.
put('boards',
  0x201, 0x204, 0x205, 0x206, 0x207, 0x245, 0x264, 0x278, 0x279,          // plain boards and the wall's shadow on them
  0x242, 0x246, 0x24a, 0x2b3, 0x25d,                                      // the TV's top and stand over the floor
  0x248, 0x249, 0x2b1, 0x2b2,                                             // the 1F sideboard's front over the floor
  0x235, 0x22e, 0x236, 0x2b0, 0x2b8, 0x2bb,                               // the 1F rugs' top rows (a rug edge at the bottom)
  0x263, 0x260, 0x266, 0x267,                                             // 2F desk legs, the GameCube's controller / foot
  0x27b, 0x27c, 0x27d, 0x283, 0x285, 0x28b, 0x28d,                        // Brendan's bed: art over the cells around it
  0x280, 0x281, 0x282, 0x288, 0x28a, 0x290, 0x292);                       // May's bed: the same
put('rug',
  0x218, 0x21d, 0x220, 0x225, 0x228, 0x229, 0x22a, 0x22b, 0x22c, 0x22d,   // Brendan's 1F blue dining rug
  0x2a3, 0x2a5, 0x2ab, 0x2ac, 0x2ad,                                      // the pink rug (May's 1F dining rug and 2F mat)
  0x298, 0x299, 0x29a, 0x2a0, 0x2a1, 0x2a2, 0x2a8, 0x2a9, 0x2aa,          // Brendan's 2F blue mat
  0x29b, 0x29c, 0x29d, 0x2a4);                                            // May's 2F pink mat
put('mat', 0x202, 0x203);                                                 // the front door's mat (SOUTH_ARROW_WARP)

// Wall rows.
put('wall',
  0x26e, 0x26d, 0x26f, 0x24d, 0x254, 0x226,                               // paint (0x226: the windows' bottom strip)
  0x20f, 0x217, 0x208, 0x209, 0x20a, 0x20b, 0x20c, 0x20d,                 // the stair alcove's corners and frame
  0x210, 0x212, 0x213, 0x215, 0x216, 0x275, 0x276, 0x277,                 // wainscot
  0x256);                                                                 // the 2F TV's top arc over the wall
put('window', 0x21e);
put('clock', 0x287, 0x28f, 0x227, 0x22f);                                 // the 2F wall clocks (Brendan's, May's)
put('decor', 0x250, 0x255,                                                // the region map (0x255 REGION_MAP)
  0x265, 0x257);                                                          // the GameCube against the 2F wall

// Furniture.
put('fridge', 0x230, 0x238);
put('sink', 0x231, 0x239, 0x232, 0x23a);                                  // sink and stove: one kitchen counter
put('cabinet', 0x233, 0x234, 0x23b, 0x23c, 0x243, 0x244, 0x24b, 0x24c,  // the glass-door dish cabinet
  0x240, 0x241);                                                          // the low white sideboard beside the 1F TV
put('table', 0x21a, 0x21b, 0x222, 0x223, 0x2b9, 0x2ba, 0x2c1, 0x2c2);
put('chair', 0x219, 0x21c, 0x221, 0x224, 0x2c0, 0x2c3,                    // the dining chairs (walkable)
  0x262, 0x261);                                                          // the 2F desk chairs (walkable)
put('pc', 0x252, 0x25a, 0x25b, 0x251, 0x259, 0x258);                      // the 2F computer desk (monitor top, PC, notebook)
put('bed', 0x284, 0x28c, 0x289, 0x291);                                   // head (IMPASSABLE_SOUTH_AND_NORTH) and foot
put('stairsUp', 0x211);                                                   // 1F → 2F (NON_ANIMATED_DOOR)
put('stairsDown', 0x214);                                                 // 2F → 1F (NON_ANIMATED_DOOR)
// The intro's moving boxes, set at runtime (not on the static maps, so no pin): left unlabelled they dropped column 5's
// back line a row and turned the wide 1F window into a decal in live play (final fix-wave re-review).
put('crate', 0x268, 0x270);                                               // closed box (blocked), open box

export const BRENDANS_MAYS_HOUSE: InteriorTable = {
  name: 'BrendansMaysHouse',
  ids,
  target: 0.97,
  pins: [
    // Brendan's 1F (1.0)
    { map: [1, 0], x: 3, y: 6, id: 'table' }, { map: [1, 0], x: 4, y: 7, id: 'table' },
    { map: [1, 0], x: 2, y: 6, id: 'chair' }, { map: [1, 0], x: 5, y: 7, id: 'chair' },
    { map: [1, 0], x: 1, y: 7, id: 'rug' }, { map: [1, 0], x: 6, y: 8, id: 'rug' }, { map: [1, 0], x: 3, y: 5, id: 'boards' },
    { map: [1, 0], x: 8, y: 2, id: 'stairsUp' }, { map: [1, 0], x: 4, y: 4, id: 'tv' }, { map: [1, 0], x: 4, y: 3, id: 'boards' },
    { map: [1, 0], x: 2, y: 0, id: 'window' }, { map: [1, 0], x: 5, y: 1, id: 'wall' },
    { map: [1, 0], x: 0, y: 1, id: 'fridge' }, { map: [1, 0], x: 1, y: 2, id: 'sink' },
    { map: [1, 0], x: 3, y: 2, id: 'cabinet' }, { map: [1, 0], x: 2, y: 4, id: 'cabinet' },
    { map: [1, 0], x: 8, y: 8, id: 'mat' }, { map: [1, 0], x: 7, y: 5, id: 'boards' },
    // Brendan's 2F (1.1)
    { map: [1, 1], x: 1, y: 4, id: 'bed' }, { map: [1, 1], x: 1, y: 5, id: 'bed' }, { map: [1, 1], x: 2, y: 4, id: 'boards' },
    { map: [1, 1], x: 0, y: 1, id: 'pc' }, { map: [1, 1], x: 1, y: 1, id: 'pc' }, { map: [1, 1], x: 0, y: 2, id: 'chair' },
    { map: [1, 1], x: 7, y: 1, id: 'stairsDown' }, { map: [1, 1], x: 4, y: 1, id: 'tv' },
    { map: [1, 1], x: 5, y: 0, id: 'clock' }, { map: [1, 1], x: 2, y: 1, id: 'decor' }, { map: [1, 1], x: 5, y: 4, id: 'rug' },
    // May's 1F (1.2) and 2F (1.3)
    { map: [1, 2], x: 6, y: 6, id: 'table' }, { map: [1, 2], x: 5, y: 7, id: 'chair' }, { map: [1, 2], x: 2, y: 2, id: 'stairsUp' },
    { map: [1, 2], x: 9, y: 7, id: 'rug' }, { map: [1, 2], x: 6, y: 5, id: 'boards' }, { map: [1, 2], x: 10, y: 2, id: 'fridge' },
    { map: [1, 3], x: 7, y: 5, id: 'bed' }, { map: [1, 3], x: 8, y: 1, id: 'pc' }, { map: [1, 3], x: 1, y: 1, id: 'stairsDown' },
    { map: [1, 3], x: 3, y: 1, id: 'clock' }, { map: [1, 3], x: 2, y: 4, id: 'rug' },
  ],
};
