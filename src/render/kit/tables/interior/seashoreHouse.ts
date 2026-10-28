// gTileset_SeashoreHouse: the Seashore House 28.0.
// What its ids are, curated by Phase 4b Task 4e from its map (worklists out/interior-ids-4b.task2.txt and
// out/live-ids.task2.txt: no live ids, no mechanics; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only SeashoreHouse
// --sheet-scale 5 --sheet-chunk 32).
//
// The beach hut: a golden plank wall (rows 0–1) hung with swim rings and an inflatable, two glass-front drink coolers
// (Soda Pop) standing in the wall rows, the owner's stool and a small table with a shaved-ice machine on it; a woven straw
// floor divided by teal lines, with rows of long low wooden tables (blocked, their legs in the walkable row below).
// - The coolers are `fridge` (glass-front drink coolers; their tops in the wall row too, like a PC's top over the wall).
// - The small table and the machine on it (its top drawn over the wall row) are `table`; the stool (walkable) is `chair`.
// - Walkable cells under the tables' legs, the pillars' feet and the teal lines are the floor (`carpet`: woven mats, as
//   GenericBuilding's tatami).
// - No `legacy`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();

// Wall rows.
put('wall', 0x201, 0x202, 0x203,                                          // the wall's top row (corners)
  0x209, 0x20a, 0x20b);                                                   // the planks (corners)
put('decor', 0x204, 0x205, 0x20c, 0x20d,                                  // the swim rings
  0x22e, 0x22f, 0x236, 0x237);                                            // the inflatable and its rings

// Floors.
put('carpet',
  0x225, 0x224, 0x22a, 0x21a, 0x21b,                                      // woven straw (0x21a / 0x21b: tables' legs on it)
  0x222, 0x22c, 0x22d, 0x226,                                             // the row along the wall, its teal line
  0x211, 0x213, 0x21e,                                                    // the pillars' feet, shaded by the coolers
  0x214, 0x215, 0x21c, 0x21d);                                            // the west and east edges
put('mat', 0x216, 0x217);                                                 // the exit mat (SOUTH_ARROW_WARP)

// Furniture.
put('fridge', 0x206, 0x207, 0x20e, 0x20f);                                // the drink coolers
put('table', 0x21f, 0x227,                                                // the small table and the machine on it
  0x210, 0x218, 0x219, 0x220, 0x221);                                     // the long low tables
put('chair', 0x212);                                                      // the owner's stool

export const SEASHORE_HOUSE: InteriorTable = {
  name: 'SeashoreHouse', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['28.0'],
  pins: [
    { map: [28, 0], x: 0, y: 0, id: 'wall' },
    { map: [28, 0], x: 8, y: 1, id: 'wall' },
    { map: [28, 0], x: 3, y: 0, id: 'decor' },        // a swim ring
    { map: [28, 0], x: 6, y: 1, id: 'decor' },        // the inflatable
    { map: [28, 0], x: 1, y: 1, id: 'fridge' },
    { map: [28, 0], x: 13, y: 2, id: 'fridge' },
    { map: [28, 0], x: 7, y: 1, id: 'table' },        // the machine's top over the wall
    { map: [28, 0], x: 7, y: 2, id: 'table' },
    { map: [28, 0], x: 6, y: 2, id: 'chair' },        // the stool
    { map: [28, 0], x: 4, y: 4, id: 'table' },        // a long table
    { map: [28, 0], x: 14, y: 8, id: 'table' },
    { map: [28, 0], x: 4, y: 5, id: 'carpet' },       // under its legs
    { map: [28, 0], x: 0, y: 2, id: 'carpet' },
    { map: [28, 0], x: 7, y: 3, id: 'carpet' },
    { map: [28, 0], x: 6, y: 9, id: 'mat' },
  ],
};
