// gTileset_TrickHousePuzzle: the Trick House puzzle rooms 29.3–29.10 (Puzzle1–8). Curated by Phase 4b Task 4c
// (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps
// --sheet-only TrickHousePuzzle --sheet-scale 5 --sheet-chunk 32; scripts: the rooms' scripts.inc).
//
// Every room: a back wall (y 0–1) with the puzzle door at (13, 1) in its frame, a green striped floor, the exit mat at
// (0–1, 21) and the scroll (the password, a bg event) lying somewhere on the floor; the maze differs per room:
// Puzzle1 low wooden walls (cream tops, wood faces; cut trees are objects), Puzzle2/4/6/7 sandstone blocks, Puzzle3
// cream-and-wood pillars with coloured doors, Puzzle5 slate blocks, Puzzle8 a slippery floor between jars.
//
// Mechanics (every live id of the worklist; collision as the scripts set it, F38):
// - Puzzle3 (29.5, 37 collision-changing edits): red and blue `toggleWall`s (variant 0 red, 1 blue; state 1 up = the
//   door shut, 0 down = flush/open) that swap whenever a button is pressed (OnResume and every button: state 0 = blue
//   open, red shut). Horizontal doors are 2 × 2: the top row (`Tile0/1`, its art over a walkable cell, FALSE in both
//   states) and the blocked bottom row (`Tile2/3`, TRUE shut, FALSE open). Vertical doors are 1 × 2 in a pillar's face:
//   the top cell stays blocked (`Open0` / `Retracted`), the bottom cell is the panel (`Open1`, TRUE) or, retracted, the
//   floor below the pillar (red: `Floor_ShadowTop_Alt` 0x252, a mechanic id; blue: `Floor_ShadowTop` 0x255, also a
//   plain floor id elsewhere: those five cells are listed by position, `puzzleCells`, offState 0).
//   The four buttons are `floorSwitch` (0 `Button_Up`, 1 `Button_Pressed`, both FALSE), as are Puzzle2's.
// - Puzzle2 (29.4): each button opens one door in the maze: `0x269` (blocked) → `Door_Shuttered` `0x26A` (FALSE):
//   `gymDoor` state 0 / 5.
// - Puzzle1 (29.3): once solved, OnLoad turns the puzzle door (`0x277`, TRICK_HOUSE_PUZZLE_DOOR, blocked) into
//   `Stairs_Down` (`0x20B`, FALSE): `gymDoor` state 0 / 5. The door is `gymDoor` (closed) in every room.
// - Puzzle7 (29.9): the warp pads (`0x287`, MOSSDEEP_GYM_WARP) are `warpPad`. Its arrow / lever setmetatile scripts
//   (`Arrow_RedOnBlack_*` 0x260–0x263, 0x27B, 0x27C; `Lever_Off/On` 0x23E, 0x23F) are R/S leftovers that never run and
//   whose ids appear on no map (controller ruling: Puzzle7's arrows never change): `legacy`, inert. What the room does
//   show — the coloured buttons and the 2 × 2 arrow plates the statues stand on (NORMAL behaviour; the buttons turn the
//   statue objects) — is static floor art, `legacy` (the colour pairs are the puzzle's reading).
// Other labels:
// - `wall`: the back wall's top and foot, the door's frame; `decor`: Puzzle2/3's round windows and wooden posts in it.
// - `mazeWall`: every blocked maze cell (tops and faces alike: the masses carry their art, D7).
// - `carpet`: the green striped floor, its shadow and edge variants (the art of a wall top or a post's foot reaching
//   into a walkable cell is floor); `ice`: Puzzle8's slippery floor (TRICK_HOUSE_PUZZLE_8_FLOOR); `ledge`: Puzzle4's
//   JUMP_SOUTH row; `mat`: the exit mat (SOUTH_ARROW_WARP).
// - `trashCan`: the jars (TRASH_CAN behaviour: the Trick Master hides in them).
// - `legacy`: the scrolls on the floor (0x213, Puzzle3's 0x27E), Puzzle7's plates and buttons, the dead arrow / lever ids.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();
const mech = (kind: PuzzleId['kind'], state: number, variant: number, blocked: boolean, ...ms: number[]) => {
  for (const m of ms) { puzzle.set(m, { kind, state, variant, blocked }); ids.set(m, kind); }
};

// ---- mechanics
// Puzzle3's toggle walls: red (variant 0)
mech('toggleWall', 1, 0, false, 0x238, 0x239);            // RedDoorH_Closed_Tile0/1 (the top row, walkable)
mech('toggleWall', 1, 0, true, 0x240, 0x241);             // RedDoorH_Closed_Tile2/3
mech('toggleWall', 0, 0, false, 0x248, 0x249, 0x250, 0x251);   // RedDoorH_Open_Tile0–3
mech('toggleWall', 1, 0, true, 0x23a, 0x242);             // RedDoorV_Open0 (top) / Open1 (the panel)
mech('toggleWall', 0, 0, true, 0x24a);                    // RedDoorV_Retracted (top, blocked)
mech('toggleWall', 0, 0, false, 0x252);                   // Floor_ShadowTop_Alt (the red panel's cell, retracted)
// … blue (variant 1)
mech('toggleWall', 1, 1, false, 0x23b, 0x23c);            // BlueDoorH_Closed_Tile0/1
mech('toggleWall', 1, 1, true, 0x243, 0x244);             // BlueDoorH_Closed_Tile2/3
mech('toggleWall', 0, 1, false, 0x24b, 0x24c, 0x253, 0x254);   // BlueDoorH_Open_Tile0–3
mech('toggleWall', 1, 1, true, 0x23d, 0x245);             // BlueDoorV_Open0 / Open1
mech('toggleWall', 0, 1, true, 0x24d);                    // BlueDoorV_Retracted
// the buttons (Puzzle2, Puzzle3)
mech('floorSwitch', 0, 0, false, 0x258);                  // Button_Up
mech('floorSwitch', 1, 0, false, 0x259);                  // Button_Pressed
// the doors
mech('gymDoor', 0, 0, true, 0x269);                       // Puzzle2's doors in the maze, shut
mech('gymDoor', 5, 0, false, 0x26a);                      // Door_Shuttered (open)
mech('gymDoor', 0, 0, true, 0x277);                       // the puzzle door (TRICK_HOUSE_PUZZLE_DOOR)
mech('gymDoor', 5, 0, false, 0x20b);                      // Stairs_Down (Puzzle1, solved)
// Puzzle7's warp pads
mech('warpPad', 0, 0, false, 0x287);

// ---- the back wall
put('wall', 0x201, 0x209, 0x232, 0x233, 0x234,            // its top and foot (Puzzle1's foot: 0x232–0x234)
  0x202, 0x204, 0x26f, 0x20a, 0x20c);                     // the puzzle door's frame
put('decor', 0x205, 0x20d, 0x206, 0x20e);                 // round windows, wooden posts (Puzzle2, Puzzle3)

// ---- floors
put('carpet',
  0x208, 0x210, 0x216, 0x271,                             // the green floor, its shadow, a post's foot over it
  0x25a, 0x21a, 0x21b, 0x21c, 0x21d, 0x218, 0x219,        // … under / over the art of a maze wall's top or face
  0x255);                                                 // Floor_ShadowTop (plain; Puzzle3's blue panels: by position)
put('ice', 0x26b);                                        // Puzzle8's slippery floor
put('ledge', 0x286);                                      // Puzzle4's ledge row (JUMP_SOUTH)
put('mat', 0x211, 0x212);                                 // the exit mat

// ---- the mazes
put('mazeWall',
  0x221, 0x222, 0x223, 0x224, 0x225, 0x228, 0x22a, 0x22b, 0x22c, 0x230,   // Puzzle1's wooden walls
  0x21e, 0x226, 0x22d, 0x235, 0x22e, 0x22f, 0x236, 0x237,                 // Puzzle3's pillars and blocks
  0x280, 0x281, 0x282, 0x283, 0x284, 0x288, 0x289, 0x28a, 0x28b, 0x28c,   // the sandstone blocks
  0x290, 0x291, 0x292, 0x293, 0x294,
  0x268);                                                                 // Puzzle5's slate blocks
put('trashCan', 0x214, 0x215, 0x26c);                     // the jars (on the floor, on Puzzle8's slippery floor)

// ---- legacy
put('legacy',
  0x213, 0x27e,                                           // the scrolls
  0x298, 0x299, 0x29a, 0x29b, 0x2a0, 0x2a1, 0x2a2, 0x2a3, // Puzzle7's arrow plates (yellow, blue)
  0x2a8, 0x2a9, 0x2aa, 0x2ab, 0x2b0, 0x2b1, 0x2b2, 0x2b3, // … (green, pink)
  0x29c, 0x2a4, 0x2ac, 0x2b4,                             // … and its coloured buttons
  0x260, 0x261, 0x262, 0x263, 0x27b, 0x27c, 0x23e, 0x23f);   // the dead R/S arrow and lever ids (never shown)

export const TRICK_HOUSE_PUZZLE: InteriorTable = {
  name: 'TrickHousePuzzle', ids, puzzle, target: 0.97,
  pins: [
    // Puzzle1 (29.3)
    { map: [29, 3], x: 13, y: 1, id: 'gymDoor' }, { map: [29, 3], x: 5, y: 0, id: 'wall' }, { map: [29, 3], x: 5, y: 1, id: 'wall' },
    { map: [29, 3], x: 2, y: 2, id: 'mazeWall' }, { map: [29, 3], x: 1, y: 6, id: 'mazeWall' }, { map: [29, 3], x: 0, y: 4, id: 'carpet' },
    { map: [29, 3], x: 2, y: 4, id: 'carpet' }, { map: [29, 3], x: 0, y: 21, id: 'mat' }, { map: [29, 3], x: 3, y: 16, id: 'legacy' },
    // Puzzle2 (29.4): buttons up, doors shut
    { map: [29, 4], x: 0, y: 4, id: 'floorSwitch' }, { map: [29, 4], x: 5, y: 6, id: 'gymDoor' }, { map: [29, 4], x: 14, y: 12, id: 'gymDoor' },
    { map: [29, 4], x: 2, y: 0, id: 'decor' }, { map: [29, 4], x: 3, y: 1, id: 'decor' }, { map: [29, 4], x: 4, y: 3, id: 'mazeWall' },
    // Puzzle3 (29.5): red shut (up), blue open (down)
    { map: [29, 5], x: 1, y: 3, id: 'toggleWall' }, { map: [29, 5], x: 2, y: 4, id: 'toggleWall' },     // red H, up
    { map: [29, 5], x: 9, y: 4, id: 'toggleWall' }, { map: [29, 5], x: 3, y: 17, id: 'toggleWall' },    // red V, up
    { map: [29, 5], x: 1, y: 6, id: 'toggleWall' }, { map: [29, 5], x: 14, y: 16, id: 'toggleWall' },   // blue H, down
    { map: [29, 5], x: 3, y: 7, id: 'toggleWall' }, { map: [29, 5], x: 6, y: 5, id: 'toggleWall' },     // blue V, down
    { map: [29, 5], x: 3, y: 8, id: 'toggleWall' }, { map: [29, 5], x: 12, y: 8, id: 'toggleWall' },    // by position
    { map: [29, 5], x: 6, y: 8, id: 'carpet' }, { map: [29, 5], x: 0, y: 5, id: 'carpet' }, { map: [29, 5], x: 4, y: 8, id: 'carpet' },
    { map: [29, 5], x: 8, y: 2, id: 'floorSwitch' }, { map: [29, 5], x: 4, y: 14, id: 'floorSwitch' },
    { map: [29, 5], x: 0, y: 3, id: 'mazeWall' }, { map: [29, 5], x: 4, y: 10, id: 'mazeWall' }, { map: [29, 5], x: 0, y: 14, id: 'legacy' },
    // Puzzle4 (29.6), Puzzle5 (29.7), Puzzle6 (29.8)
    { map: [29, 6], x: 2, y: 18, id: 'ledge' }, { map: [29, 6], x: 2, y: 19, id: 'carpet' }, { map: [29, 6], x: 9, y: 18, id: 'mazeWall' },
    { map: [29, 7], x: 0, y: 2, id: 'mazeWall' }, { map: [29, 7], x: 3, y: 7, id: 'carpet' },
    { map: [29, 8], x: 6, y: 9, id: 'mazeWall' }, { map: [29, 8], x: 0, y: 10, id: 'legacy' },
    // Puzzle7 (29.9)
    { map: [29, 9], x: 1, y: 3, id: 'warpPad' }, { map: [29, 9], x: 8, y: 12, id: 'warpPad' }, { map: [29, 9], x: 7, y: 4, id: 'mazeWall' },
    { map: [29, 9], x: 3, y: 6, id: 'legacy' }, { map: [29, 9], x: 6, y: 6, id: 'legacy' }, { map: [29, 9], x: 9, y: 21, id: 'legacy' },
    // Puzzle8 (29.10)
    { map: [29, 10], x: 0, y: 3, id: 'ice' }, { map: [29, 10], x: 2, y: 3, id: 'trashCan' }, { map: [29, 10], x: 3, y: 9, id: 'trashCan' },
    { map: [29, 10], x: 14, y: 2, id: 'trashCan' }, { map: [29, 10], x: 0, y: 9, id: 'carpet' },
  ],
  primary: SYM.gTileset_Building,
  maps: ['29.3', '29.4', '29.5', '29.6', '29.7', '29.8', '29.9', '29.10'],
  puzzleCells: {
    // Puzzle3's blue vertical doors: the panel's cell (below the pillar) shows the plain Floor_ShadowTop when retracted
    '29.5': [[3, 8], [3, 14], [6, 5], [9, 17], [12, 8]].map(([x, y]) =>
      ({ x, y, kind: 'toggleWall' as const, variant: 1, offId: 0x255, offState: 0 })),
  },
};
