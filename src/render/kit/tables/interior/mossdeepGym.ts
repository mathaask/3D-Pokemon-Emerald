// gTileset_MossdeepGym: Mossdeep Gym 14.0 (arrow tiles, floor switches, warp pads), curated by Phase 4b Task 4b
// (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps
// --sheet-only MossdeepGym --sheet-scale 5 --sheet-chunk 32).
//
// Rooms of grey metal floor in the void, walled in orange (a greek-key lip over a beige panel face), joined by warp pads
// (MOSSDEEP_GYM_WARP). The puzzle is rotating_tile_puzzle.c: a coloured floor switch (a coord event) moves the statue
// objects standing on that colour's arrows one step the arrow's way and turns them. Each colour is a row of 8 ids from
// 0x250 (yellow, blue 0x258, green 0x260, purple 0x268, red 0x270): +0 right, +1 down, +2 left, +3 up, +4 / +5 the switch.
// Labelling rules beyond the brief's:
// - The arrows never change in Emerald (controller ruling): `arrowTile` with a fixed `puzzle` entry, state = the
//   direction it points (0 N, 1 E, 2 S, 3 W), so the puzzle family draws the GBA's arrow. The switches are `floorSwitch`,
//   state 0 (raised) for good: no script redraws them.
// - The live ids are R/S leftovers (scripts.inc: "leftover from RS and functionally unused"; FLAG_MOSSDEEP_GYM_SWITCH_1–4
//   are never set, the RS switch scripts have no event): `RSMossdeepGym_RedArrow_*` 0x204 / 0x205 / 0x20C / 0x20D are
//   Emerald's statue and wall corners here and keep those labels; `RSMossdeepGym_Switch_*` 0x238 / 0x239 are empty in
//   Emerald and unused: unlabelled (no behaviour, inert).
// - The warp pads, and the arrival pad the WarpToEntrance script sends the player to (0x225, 7,30), are `warpPad`; the
//   orange blocks (0x214, blocked) `mazeWall`; Tate and Liza's platform `dais`; the heart pictures beside it `decor`;
//   the statues `statue` (their walkable tops too, as Phase 4's plants); the floor `metal` (plan, Task 12).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

/** The arrow / switch rows (METATILE_MossdeepGym_YellowArrow_Right + 8 × colour). */
const COLOUR_ROWS = [0x250, 0x258, 0x260, 0x268, 0x270];
/** Arrow offset (+0 right, +1 down, +2 left, +3 up) → `arrowTile` state (0 N, 1 E, 2 S, 3 W). */
const ARROW_STATE = [1, 2, 3, 0];
const ARROWS = COLOUR_ROWS.flatMap((row) => [0, 1, 2, 3].map((k) => row + k));
/** The switches in use: +4 (every colour) and +5 (blue, purple). */
const SWITCHES = [...COLOUR_ROWS.map((row) => row + 4), 0x25d, 0x26d];
const WARP_PADS = [0x210, 0x211, 0x212, 0x213, 0x225];

const labels: [InteriorId, number[]][] = [
  ['metal', [0x201, 0x202, 0x203, 0x209, 0x20a, 0x21c, 0x224]],
  // The orange walls: lips, faces, corners and the void-side edges.
  ['wall', [0x205, 0x206, 0x207, 0x20d, 0x20e, 0x20f, 0x215, 0x216, 0x217, 0x21d, 0x21e, 0x21f]],
  ['mazeWall', [0x214]],                         // the orange blocks
  ['decor', [0x228, 0x229]],                     // the heart pictures by the leaders' platform
  ['dais', [0x218, 0x219, 0x21a, 0x21b, 0x220, 0x221, 0x222, 0x223]],
  ['statue', [0x204, 0x20c]],
  ['arrowTile', ARROWS],
  ['floorSwitch', SWITCHES],
  ['warpPad', WARP_PADS],
];

const ids = new Map<number, InteriorId>(labels.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id])));
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>([
  ...ARROWS.map((m): [number, PuzzleId] => [m,
    { kind: 'arrowTile', state: ARROW_STATE[(m - 0x250) % 8], variant: 0, blocked: false }]),
  ...SWITCHES.map((m): [number, PuzzleId] => [m, { kind: 'floorSwitch', state: 0, variant: 0, blocked: false }]),
  ...WARP_PADS.map((m): [number, PuzzleId] => [m, { kind: 'warpPad', state: 0, variant: 0, blocked: false }]),
]);

export const MOSSDEEP_GYM: InteriorTable = {
  name: 'MossdeepGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['14.0'],
  pins: [
    // red arrows in all four directions (down, left, right, up), a yellow and a green one
    { map: [14, 0], x: 6, y: 5, id: 'arrowTile' },
    { map: [14, 0], x: 7, y: 5, id: 'arrowTile' },
    { map: [14, 0], x: 6, y: 6, id: 'arrowTile' },
    { map: [14, 0], x: 7, y: 6, id: 'arrowTile' },
    { map: [14, 0], x: 4, y: 21, id: 'arrowTile' },
    { map: [14, 0], x: 11, y: 34, id: 'arrowTile' },
    // the switches (coord events): red, yellow, blue (+4 / +5), purple +5
    { map: [14, 0], x: 8, y: 6, id: 'floorSwitch' },
    { map: [14, 0], x: 2, y: 21, id: 'floorSwitch' },
    { map: [14, 0], x: 6, y: 7, id: 'floorSwitch' },
    { map: [14, 0], x: 8, y: 10, id: 'floorSwitch' },
    { map: [14, 0], x: 23, y: 21, id: 'floorSwitch' },
    // warp pads, the arrival pad
    { map: [14, 0], x: 11, y: 3, id: 'warpPad' },
    { map: [14, 0], x: 8, y: 12, id: 'warpPad' },
    { map: [14, 0], x: 7, y: 30, id: 'warpPad' },
    // floor, walls, the orange block, the statues, the leaders' platform, the hearts, the exit mat
    { map: [14, 0], x: 4, y: 4, id: 'metal' },
    { map: [14, 0], x: 8, y: 11, id: 'metal' },
    { map: [14, 0], x: 6, y: 1, id: 'wall' },
    { map: [14, 0], x: 4, y: 3, id: 'wall' },
    { map: [14, 0], x: 5, y: 7, id: 'mazeWall' },
    { map: [14, 0], x: 4, y: 33, id: 'statue' },
    { map: [14, 0], x: 4, y: 34, id: 'statue' },
    { map: [14, 0], x: 23, y: 8, id: 'dais' },
    { map: [14, 0], x: 23, y: 7, id: 'dais' },
    { map: [14, 0], x: 23, y: 6, id: 'decor' },
    { map: [14, 0], x: 6, y: 35, id: 'mat' },
  ],
};
