// gTileset_PokemonSchool: the Pokémon Trainer's School 11.4.
// What its ids are, curated by Phase 4b Task 4e from its map (worklists out/interior-ids-4b.task2.txt and
// out/live-ids.task2.txt: no live ids, no mechanics; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PokemonSchool
// --sheet-scale 5 --sheet-chunk 32).
//
// The room: a cream wall with white pillars and two bay windows (rows 0–1), the blackboard in the middle with a low
// wooden cabinet under it (row 2, blocked: the blackboard's bg events stand on it), an orange strip of floor along the
// wall (rows 2–3, walkable: the bays' sills and the pillars' feet are drawn on it), then grey tiles with the teacher's
// desk and three columns of pupils' desks, each with its chair in the walkable cell south of it.
// - Every student desk (blocked) is `schoolDesk`; the chair below it (walkable: the player walks over it, as over Phase 4's
//   chairs) is `chair`, so the desk model needs no seat of its own on these maps.
// - The teacher's desk (blocked top, walkable legs) is `table` on its blocked cells; its legs are the floor.
// - No `legacy`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();

// Wall rows.
put('wall', 0x208, 0x209,                                                 // the wall's top row
  0x210);                                                                 // the white pillars between the windows
put('window', 0x211, 0x212);                                              // the bay windows
put('decor', 0x20b);                                                      // the small framed sign on a pillar
put('blackboard', 0x228, 0x229, 0x22a, 0x22b);
put('cabinet', 0x230, 0x231, 0x232, 0x233);                               // the low wooden cabinet under the blackboard

// Floors.
put('tiles', 0x201, 0x202);                                               // grey tiles (0x202: shaded by the west wall)
put('boards',
  0x218, 0x219, 0x21a,                                                    // the orange strip: pillar feet, bay sills
  0x220, 0x221, 0x238, 0x21c, 0x21d, 0x239);                              //   its lower row, shadowed under the cabinet

// Furniture.
put('table', 0x224, 0x225);                                               // the teacher's desk
put('schoolDesk', 0x20c, 0x20d, 0x20e);                                   // pupils' desks (0x20d: a book on it)
put('chair', 0x214, 0x215, 0x216);                                        // their chairs (0x216: turned)

export const POKEMON_SCHOOL: InteriorTable = {
  name: 'PokemonSchool', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['11.4'],
  pins: [
    { map: [11, 4], x: 0, y: 0, id: 'wall' },
    { map: [11, 4], x: 8, y: 1, id: 'wall' },         // a pillar
    { map: [11, 4], x: 1, y: 1, id: 'window' },
    { map: [11, 4], x: 10, y: 1, id: 'window' },
    { map: [11, 4], x: 3, y: 1, id: 'decor' },
    { map: [11, 4], x: 4, y: 1, id: 'blackboard' },
    { map: [11, 4], x: 7, y: 1, id: 'blackboard' },
    { map: [11, 4], x: 5, y: 2, id: 'cabinet' },      // under the blackboard (a bg event reads the board here)
    { map: [11, 4], x: 1, y: 2, id: 'boards' },       // a bay's sill on the orange strip
    { map: [11, 4], x: 5, y: 3, id: 'boards' },
    { map: [11, 4], x: 5, y: 4, id: 'table' },        // the teacher's desk
    { map: [11, 4], x: 5, y: 5, id: 'tiles' },        //   its legs over the floor
    { map: [11, 4], x: 1, y: 5, id: 'schoolDesk' },
    { map: [11, 4], x: 3, y: 5, id: 'schoolDesk' },   // the desk with a book
    { map: [11, 4], x: 8, y: 7, id: 'schoolDesk' },
    { map: [11, 4], x: 1, y: 6, id: 'chair' },
    { map: [11, 4], x: 8, y: 8, id: 'chair' },        // the turned chair
    { map: [11, 4], x: 0, y: 6, id: 'tiles' },
    { map: [11, 4], x: 5, y: 10, id: 'mat' },
  ],
};
