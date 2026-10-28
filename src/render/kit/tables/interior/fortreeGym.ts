// gTileset_FortreeGym: Fortree Gym 12.1 (rotating gates, ledges), curated by Phase 4b Task 4b (worklists
// out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only
// FortreeGym --sheet-scale 5 --sheet-chunk 32).
//
// A maze of round green pillars (each blocked cell a column, its rounded cap drawn over the walkable cell north of it)
// and green trellis fences on a yellow woven floor, under a windowed green back wall with two dark doorways. The rotating
// gates are sprites (rotating_gate.c, Task 13): the floor cells under them, the pivots 6,7 / 3,19 / 2,6 / 9,12 / 6,23 /
// 12,22 included, are plain floor ids and read as floor (the pivots 9,15 and 6,3 are a trellis and a pillar). The map
// writes no metatile (0 live ids).
// Labelling rules beyond the brief's:
// - The pillars and the trellis fences (0x233–0x23B lattices, 0x229 a lattice over the next pillar's cap) are `mazeWall`,
//   the outer pillar columns (0x218) included; a pillar's cap over a walkable cell (0x208, 0x209, 0x222–0x225, 0x22B) is
//   the floor (`tiles`), as the pillar stands on its blocked cell.
// - The back wall and its alcoves are `wall`; the dark doorways (0x236 / 0x237 / 0x24F) and the bird emblem (0x215 /
//   0x226) `decor`; Winona's lilac platform (walkable top, blocked ends) `dais`; the gym statues `statue` (their walkable
//   tops too, as Phase 4's plants); the JUMP_SOUTH ledges 0x20C / 0x20D `ledge` (F20).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const labels: [InteriorId, number[]][] = [
  // The woven floor, its shaded variants, and the pillars' caps over walkable cells.
  ['tiles', [0x201, 0x202, 0x203, 0x204, 0x205, 0x206, 0x207, 0x230, 0x231, 0x232, 0x245,
    0x208, 0x209, 0x222, 0x223, 0x224, 0x225, 0x22b]],
  ['ledge', [0x20c, 0x20d]],
  ['wall', [0x20e, 0x20f, 0x213, 0x214, 0x216, 0x217, 0x22a, 0x23e, 0x23f, 0x246, 0x247]],
  ['decor', [0x215, 0x226, 0x236, 0x237, 0x24f]],
  // Pillars (bodies, the outer columns, pillars against the back wall) and trellis fences.
  ['mazeWall', [0x20b, 0x210, 0x211, 0x218, 0x219, 0x21a, 0x220, 0x22c, 0x235, 0x23c,
    0x229, 0x233, 0x238, 0x23a, 0x23b]],
  ['dais', [0x21b, 0x21c, 0x21d, 0x21e, 0x21f, 0x240, 0x241, 0x242, 0x243, 0x244]],
  ['statue', [0x227, 0x22f]],
];

const ids = new Map<number, InteriorId>(labels.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id])));
/** Mechanic ids → their meaning (none: the rotating gates are sprites, Task 13). */
const puzzle = new Map<number, PuzzleId>();

export const FORTREE_GYM: InteriorTable = {
  name: 'FortreeGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['12.1'],
  pins: [
    // the floor under the rotating gates' pivots, open floor, a pillar's cap over a walkable cell
    { map: [12, 1], x: 6, y: 7, id: 'tiles' },
    { map: [12, 1], x: 9, y: 12, id: 'tiles' },
    { map: [12, 1], x: 2, y: 6, id: 'tiles' },
    { map: [12, 1], x: 15, y: 4, id: 'tiles' },
    { map: [12, 1], x: 6, y: 4, id: 'tiles' },
    { map: [12, 1], x: 6, y: 10, id: 'tiles' },
    // pillars, an outer column, trellis fences
    { map: [12, 1], x: 6, y: 5, id: 'mazeWall' },
    { map: [12, 1], x: 6, y: 6, id: 'mazeWall' },
    { map: [12, 1], x: 0, y: 5, id: 'mazeWall' },
    { map: [12, 1], x: 8, y: 13, id: 'mazeWall' },
    { map: [12, 1], x: 3, y: 4, id: 'mazeWall' },
    // ledges
    { map: [12, 1], x: 13, y: 6, id: 'ledge' },
    { map: [12, 1], x: 14, y: 12, id: 'ledge' },
    // back wall, doorway, emblem
    { map: [12, 1], x: 7, y: 0, id: 'wall' },
    { map: [12, 1], x: 7, y: 1, id: 'wall' },
    { map: [12, 1], x: 11, y: 0, id: 'decor' },
    { map: [12, 1], x: 15, y: 1, id: 'decor' },
    // Winona's platform, the statues, the exit mat
    { map: [12, 1], x: 15, y: 2, id: 'dais' },
    { map: [12, 1], x: 13, y: 2, id: 'dais' },
    { map: [12, 1], x: 14, y: 21, id: 'statue' },
    { map: [12, 1], x: 14, y: 20, id: 'statue' },
    { map: [12, 1], x: 15, y: 24, id: 'mat' },
  ],
};
