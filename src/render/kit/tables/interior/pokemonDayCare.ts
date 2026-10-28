// gTileset_PokemonDayCare: the Day Care 22.0.
// What its ids are, curated by Phase 4b Task 4e from its map (worklists out/interior-ids-4b.task2.txt and
// out/live-ids.task2.txt: no live ids, no mechanics; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only PokemonDayCare
// --sheet-scale 5 --sheet-chunk 32).
//
// The room: a pale blue wall (rows 0–1) with a dark doorway (no warp: its walkable cell opens a one-cell alcove), a window
// and the PC; the yellow L counter (COUNTER) with the Day Care lady's floor behind it; two lattice-backed chairs against
// the wall; blue parquet with a green play rug; a wooden table with two chairs; two plants on the west side; a picket
// fence along the south-east edge.
// - The doorway's frame is wall `decor`; its walkable cell is the floor (`boards`).
// - The two lattice chairs are blocked in the game (`chair` all the same: a chair's blocked cell); their top sliver in
//   the wainscot row and the window's foot are the wall art there (`wall` / `window`), not the chairs.
// - The PC's foot, the wall's side, the counter's and the table's shadows (walkable) are the floor.
// - `legacy`: the picket fence (0x240 0x241 0x243): no kind draws a low fence rail; it keeps its GBA art.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();

// Wall rows.
put('wall', 0x208, 0x209, 0x210, 0x211,                                   // the wall, its white-railed wainscot
  0x20f, 0x217,                                                           // its east side
  0x21c);                                                                 // wainscot over a lattice chair's top
put('window', 0x20c, 0x20d, 0x224, 0x215);
put('decor', 0x235, 0x236, 0x237, 0x23d, 0x23f);                          // the doorway's frame

// Floors.
put('boards',
  0x201, 0x206, 0x207,                                                    // blue parquet
  0x218, 0x219, 0x226,                                                    // behind the counter
  0x23e,                                                                  // the doorway's floor
  0x20b, 0x21f,                                                           // the PC's foot, the east wall's foot
  0x21e, 0x228, 0x233, 0x22d, 0x239, 0x21a);                              // shaded by the counter, the table
put('rug', 0x204, 0x238);                                                 // the green play rug (0x238: a chair's shadow)
put('mat', 0x23b, 0x23c);                                                 // the exit mat (SOUTH_ARROW_WARP)

// Furniture.
put('pc', 0x20a);                                                         // the PC's top (its body: the Building PC 0x004)
put('counter', 0x213, 0x21b, 0x223,                                       // the L's north arm
  0x220, 0x22e, 0x221);                                                   // its front (0x221: where one talks to the lady)
put('chair', 0x234,                                                       // the lattice-backed chairs (blocked)
  0x230);                                                                 // the table's chairs (walkable)
put('table', 0x229, 0x22a, 0x231, 0x232);
put('plant', 0x21d, 0x225);                                               // leaves (walkable), pot
put('legacy', 0x240, 0x241, 0x243);                                       // the picket fence

export const POKEMON_DAY_CARE: InteriorTable = {
  name: 'PokemonDayCare', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['22.0'],
  pins: [
    { map: [22, 0], x: 0, y: 0, id: 'wall' },
    { map: [22, 0], x: 9, y: 1, id: 'wall' },
    { map: [22, 0], x: 5, y: 1, id: 'wall' },         // over the lattice chair
    { map: [22, 0], x: 7, y: 0, id: 'window' },
    { map: [22, 0], x: 6, y: 1, id: 'window' },
    { map: [22, 0], x: 1, y: 1, id: 'decor' },        // the doorway's frame
    { map: [22, 0], x: 2, y: 1, id: 'boards' },       // the doorway's floor
    { map: [22, 0], x: 1, y: 2, id: 'boards' },       // behind the counter
    { map: [22, 0], x: 10, y: 2, id: 'boards' },      // the PC's foot
    { map: [22, 0], x: 4, y: 6, id: 'boards' },
    { map: [22, 0], x: 10, y: 0, id: 'pc' },
    { map: [22, 0], x: 10, y: 1, id: 'pc' },          // the Building primary's PC
    { map: [22, 0], x: 2, y: 3, id: 'counter' },
    { map: [22, 0], x: 4, y: 1, id: 'counter' },      // the L's north end
    { map: [22, 0], x: 4, y: 3, id: 'counter' },
    { map: [22, 0], x: 5, y: 2, id: 'chair' },        // a lattice chair
    { map: [22, 0], x: 11, y: 4, id: 'chair' },
    { map: [22, 0], x: 9, y: 6, id: 'chair' },
    { map: [22, 0], x: 10, y: 5, id: 'table' },
    { map: [22, 0], x: 11, y: 6, id: 'table' },
    { map: [22, 0], x: 8, y: 5, id: 'rug' },
    { map: [22, 0], x: 0, y: 5, id: 'plant' },
    { map: [22, 0], x: 0, y: 8, id: 'plant' },
    { map: [22, 0], x: 3, y: 8, id: 'mat' },
    { map: [22, 0], x: 6, y: 7, id: 'legacy' },       // the fence's post
    { map: [22, 0], x: 9, y: 8, id: 'legacy' },
  ],
};
