// gTileset_MysteryEventsHouse: the Mystery Events House 1F / B1F 15.13 / 15.14.
// What its ids are, curated by Phase 4b Task 4e from its maps (worklists out/interior-ids-4b.task2.txt and
// out/live-ids.task2.txt: no live ids, no mechanics; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only MysteryEventsHouse
// --sheet-scale 5 --sheet-chunk 32).
//
// 1F: a cream wall (rows 0–1) with a round and an arched window; the stairs down (a NON_ANIMATED_DOOR warp at (3, 1)) in a
// framed opening, screened by three potted trees (their leaves beside the stairs carry COUNTER behaviour: not an
// interaction kind we draw, so they stay `plant`); the grey machine on the TV behaviour (the Building primary's TV 0x002,
// its top 0x227), a drawer cabinet and a glass-front sideboard against the wall (their feet walkable: the floor); grey
// patterned tiles, the old man's table with four chairs. B1F: the stairs up in their frame (whose sides carry COUNTER
// behaviour: wall `decor`, as the stair doorways in Shop), four potted plants, a blue rug.
// - Stair openings' frames are `decor`; the stair cells themselves `stairsDown` (1F) / `stairsUp` (B1F).
// - Walkable plant leaves (B1F's front plants) are `plant` (the plants' own art).
// - No `legacy`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();

// Wall rows.
put('wall', 0x205, 0x20d);                                                // the wall's top row, the wall
put('window', 0x207, 0x20f,                                               // the round window
  0x206, 0x20e);                                                          // the arched window
put('decor', 0x238, 0x239, 0x23a,                                         // 1F: the stair opening's frame
  0x202, 0x203, 0x204, 0x20a, 0x20c);                                     // B1F: the stairs' frame and sides (COUNTER)

// Floors.
put('tiles', 0x235, 0x236,                                                // grey patterned tiles, shaded at the wall
  0x22d, 0x237, 0x224, 0x225);                                            // the machine's, the cabinet's, the sideboard's feet
put('rug', 0x220, 0x221, 0x222, 0x228, 0x229, 0x22a, 0x230, 0x231, 0x232);   // B1F's blue rug
put('mat', 0x208, 0x209);                                                 // the exit mat (SOUTH_ARROW_WARP)

// Furniture.
put('stairsDown', 0x241);                                                 // 1F → B1F (NON_ANIMATED_DOOR)
put('stairsUp', 0x20b);                                                   // B1F → 1F (NON_ANIMATED_DOOR)
put('tv', 0x227);                                                         // the machine's top (its body: the TV 0x002)
put('cabinet', 0x22f,                                                     // the drawer cabinet
  0x214, 0x215, 0x21c, 0x21d);                                            // the glass-front sideboard
put('table', 0x216, 0x217, 0x21e, 0x21f);
put('chair', 0x210, 0x211);
put('plant',
  0x240, 0x242, 0x21b,                                                    // 1F: the trees beside the stairs (leaves), pots
  0x213, 0x218, 0x223, 0x21a);                                            // B1F: leaves (blocked, walkable), pots

export const MYSTERY_EVENTS_HOUSE: InteriorTable = {
  name: 'MysteryEventsHouse', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['15.13', '15.14'],
  pins: [
    // 1F (15.13)
    { map: [15, 13], x: 1, y: 0, id: 'wall' },
    { map: [15, 13], x: 5, y: 1, id: 'wall' },
    { map: [15, 13], x: 0, y: 1, id: 'window' },
    { map: [15, 13], x: 6, y: 0, id: 'window' },
    { map: [15, 13], x: 3, y: 0, id: 'decor' },       // the stair opening's frame
    { map: [15, 13], x: 3, y: 1, id: 'stairsDown' },  //   the stairs, behind the middle tree
    { map: [15, 13], x: 2, y: 1, id: 'plant' },       // a tree's leaves beside them (COUNTER)
    { map: [15, 13], x: 3, y: 2, id: 'plant' },       // the middle tree's pot
    { map: [15, 13], x: 7, y: 0, id: 'tv' },
    { map: [15, 13], x: 7, y: 1, id: 'tv' },          // the Building primary's TV
    { map: [15, 13], x: 7, y: 2, id: 'tiles' },       //   its walkable foot
    { map: [15, 13], x: 8, y: 1, id: 'cabinet' },
    { map: [15, 13], x: 10, y: 0, id: 'cabinet' },    // the sideboard
    { map: [15, 13], x: 9, y: 2, id: 'tiles' },       //   its walkable foot
    { map: [15, 13], x: 7, y: 4, id: 'table' },
    { map: [15, 13], x: 8, y: 5, id: 'table' },
    { map: [15, 13], x: 6, y: 4, id: 'chair' },
    { map: [15, 13], x: 9, y: 5, id: 'chair' },
    { map: [15, 13], x: 0, y: 4, id: 'tiles' },
    { map: [15, 13], x: 3, y: 7, id: 'mat' },
    // B1F (15.14)
    { map: [15, 14], x: 3, y: 1, id: 'stairsUp' },
    { map: [15, 14], x: 2, y: 1, id: 'decor' },       // the stairs' side (COUNTER)
    { map: [15, 14], x: 3, y: 0, id: 'decor' },
    { map: [15, 14], x: 7, y: 1, id: 'wall' },
    { map: [15, 14], x: 0, y: 1, id: 'plant' },
    { map: [15, 14], x: 11, y: 7, id: 'plant' },      // walkable leaves
    { map: [15, 14], x: 11, y: 8, id: 'plant' },
    { map: [15, 14], x: 3, y: 4, id: 'rug' },
    { map: [15, 14], x: 6, y: 5, id: 'rug' },
    { map: [15, 14], x: 5, y: 2, id: 'tiles' },
  ],
};
