// gTileset_MauvilleGym: Mauville Gym 10.0 (switches, electric barriers). Curated by Phase 4b Task 4a from the map
// (vendor data/layouts/MauvilleCity_Gym/map.bin), the sheet (npx tsx tools/map-atlas.ts --no-maps --sheet-only MauvilleGym
// --sheet-scale 5 --sheet-chunk 32), the worklists out/interior-ids-4b.task2.txt / out/live-ids.task2.txt, and every
// script that writes the map's cells: data/maps/MauvilleCity_Gym/scripts.inc (SetAltBarriers) and field_specials.c
// (MauvilleGymPressSwitch, MauvilleGymSetDefaultBarriers, MauvilleGymDeactivatePuzzle).
//
// The barriers (barrier: state 0 off, 1 on; variant 0 pole, 1 beam H, 2 beam V; `blocked` = the collision the game sets):
// - A pole is a column of art: a walkable cap cell at its north end (the cap overhangs the floor: `tiles`, as Phase 4's
//   walkable rule), blocked segments (0x246 / 0x247) and a blocked body (0x218, 0x24E). The poles never change, but they
//   are `barrier` (variant 0, state 0) so the barrier family finds them as the beams' ends.
// - Horizontal beams span two rows between two poles: H1/H2 the upper row (walkable even when on: the game sets them
//   FALSE), H3/H4 the lower row (blocked when on: TRUE, and `| MAPGRID_IMPASSABLE` in C). Green and red sets alternate.
// - Vertical beams (column 6 rows 8–10, column 3 rows 11–13): V1 is a pole body with the beam leaving it (a pole, variant 0,
//   on = state 1; its off id is the plain PoleBottom body, state 0); V2 is the beam over the floor (variant 2), whose off
//   state is the plain METATILE_MauvilleGym_FloorTile 0x21A (F4: listed by position in `puzzleCells`); the receiving
//   pole's cap PoleTop is blocked when on (TRUE) and walkable when off (FALSE). PoleBottom_On / _Off are the green /
//   red set's idle body (both blocked, both off). So no cell changes variant: the V1 cells (6,8) / (3,11) switch
//   between two pole ids; only the V2 cells need their position (their off id is no mechanic).
// - Switches (floorSwitch: 0 raised, 1 pressed; C writes them without IMPASSABLE: walkable) at (0,15), (4,12), (3,9),
//   (8,9) (field_specials.c sMauvilleGymSwitchCoords).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleCellPin, PuzzleId, PuzzleKind } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
const mech = (m: number, kind: PuzzleKind, state: number, variant: number, blocked: boolean) => {
  ids.set(m, kind);
  puzzle.set(m, { kind, state, variant, blocked });
};

/** METATILE_MauvilleGym_FloorTile: the plain floor a V2 beam turns into when off. */
const FLOOR_TILE = 0x21a;

// Floor (yellow tiles; their shadow and edge variants; the poles' and statues' caps over walkable cells; FloorTile).
put('tiles',
  0x202, 0x203, 0x204, 0x209, 0x20a, 0x20b, 0x20c, 0x24f,
  0x210, 0x236, 0x237,                                                    // pole caps over the floor (walkable)
  0x216,                                                                  // the statues' tops (walkable)
  FLOOR_TILE);

// Wall rows and the purple partition walls.
put('wall',
  0x207, 0x212, 0x213, 0x20d, 0x20e, 0x20f, 0x215, 0x217, 0x21d, 0x21f,
  0x234, 0x235, 0x23c, 0x23d, 0x244);
put('decor', 0x24a, 0x24b, 0x252, 0x253);                                 // the gym emblem on the back wall

// Furniture.
put('dais', 0x224, 0x225, 0x226, 0x227, 0x22c, 0x22d, 0x22e, 0x22f);      // Wattson's stage
put('statue', 0x21e);

// Switches.
mech(0x205, 'floorSwitch', 0, 0, false);                                  // RaisedSwitch
mech(0x206, 'floorSwitch', 1, 0, false);                                  // PressedSwitch

// Static poles (never written): segments and bodies, blocked.
for (const m of [0x246, 0x247, 0x218, 0x24e]) mech(m, 'barrier', 0, 0, true);

// Horizontal beams: green / red, on (state 1) and off (state 0); upper row walkable, lower row blocked when on.
for (const [on, off] of [[0x220, 0x230], [0x221, 0x231], [0x222, 0x232], [0x223, 0x233]]) {   // H1 / H2 (upper row)
  mech(on, 'barrier', 1, 1, false); mech(off, 'barrier', 0, 1, false);
}
for (const [on, off] of [[0x228, 0x238], [0x229, 0x239], [0x22a, 0x23a], [0x22b, 0x23b]]) {   // H3 / H4 (lower row)
  mech(on, 'barrier', 1, 1, true); mech(off, 'barrier', 0, 1, false);
}

// Vertical beams.
mech(0x240, 'barrier', 1, 0, true);                                       // GreenBeamV1_On: pole body emitting
mech(0x241, 'barrier', 1, 0, true);                                       // RedBeamV1_On
mech(0x242, 'barrier', 0, 0, true);                                       // PoleBottom_On (green set's idle body)
mech(0x243, 'barrier', 0, 0, true);                                       // PoleBottom_Off (red set's idle body)
mech(0x248, 'barrier', 1, 2, true);                                       // GreenBeamV2_On (beam over the floor)
mech(0x249, 'barrier', 1, 2, true);                                       // RedBeamV2_On
mech(0x250, 'barrier', 1, 0, true);                                       // PoleTop_On (the receiving cap, blocked)
mech(0x251, 'barrier', 0, 0, false);                                      // PoleTop_Off (walkable)

/** The V2 cells: a beam over the floor when on, the plain FloorTile when off (F4). Map-local, from SetAltBarriers and
 *  map.bin: green at (6,9) (on in the map, off in the alt set), red at (3,12) (off in the map, on in the alt set). */
const V2_CELLS: PuzzleCellPin[] = [
  { x: 6, y: 9, kind: 'barrier', variant: 2, offId: FLOOR_TILE, offState: 0 },
  { x: 3, y: 12, kind: 'barrier', variant: 2, offId: FLOOR_TILE, offState: 0 },
];

const at = (x: number, y: number, id: InteriorId) => ({ map: [10, 0] as [number, number], x, y, id });

export const MAUVILLE_GYM: InteriorTable = {
  name: 'MauvilleGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['10.0'],
  puzzleCells: { '10.0': V2_CELLS },
  pins: [
    at(4, 4, 'tiles'), at(5, 12, 'tiles'), at(8, 8, 'tiles'),
    at(3, 0, 'wall'), at(2, 8, 'wall'), at(8, 18, 'wall'), at(4, 0, 'decor'), at(5, 1, 'decor'),
    at(4, 2, 'dais'), at(3, 3, 'dais'), at(3, 18, 'statue'), at(3, 17, 'tiles'), at(4, 20, 'mat'),
    // switches (raised in the map; the pressed id is the same kind)
    at(3, 9, 'floorSwitch'), at(8, 9, 'floorSwitch'), at(4, 12, 'floorSwitch'), at(0, 15, 'floorSwitch'),
    // H beams: green on (upper walkable, lower blocked), red off
    at(1, 10, 'barrier'), at(2, 11, 'barrier'), at(4, 6, 'barrier'), at(5, 7, 'barrier'),
    at(4, 10, 'barrier'), at(8, 11, 'barrier'), at(4, 13, 'barrier'), at(5, 14, 'barrier'),
    // V beams: green on (V1 pole, V2 beam, PoleTop_On), red off (PoleBottom_Off, FloorTile by position, PoleTop_Off)
    at(6, 8, 'barrier'), at(6, 9, 'barrier'), at(6, 10, 'barrier'),
    at(3, 11, 'barrier'), at(3, 12, 'barrier'), at(3, 13, 'barrier'),
    // static poles (segments, bodies) and their walkable caps
    at(3, 6, 'barrier'), at(6, 7, 'barrier'), at(3, 8, 'barrier'), at(0, 11, 'barrier'), at(6, 14, 'barrier'),
    at(0, 10, 'tiles'), at(3, 5, 'tiles'), at(6, 13, 'tiles'),
  ],
};
