// gTileset_LavaridgeGym: Lavaridge Gym 1F / B1F 4.1 / 4.2 (sand, geyser holes, ledges), curated by Phase 4b Task 4b
// (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps
// --sheet-only LavaridgeGym --sheet-scale 5 --sheet-chunk 32).
//
// Both floors are sandy-brick corridors split by walls: a full-width wall band (1F rows 0–1 and 7–8, B1F rows 0–1 and
// 4–5: a yellow-lipped red brick face) and narrow yellow-topped partitions running south from it, ending in a red cap.
// The geyser holes (LAVARIDGE_GYM_1F/B1F_WARP) warp between the floors; the script writes no metatile (0 live ids).
// Labelling rules beyond the brief's:
// - The wall bands (the back wall and the band that is the back wall of the rooms south of it) and their T-junctions are
//   `wall`; the partitions (0x20C / 0x231 tops, 0x228 their foot in a band's face row, the caps 0x20B / 0x230) are
//   `mazeWall`.
// - Floor: every sand variant (shadowed under a wall, beside a partition, at a partition's foot) is `sand`.
// - Geyser holes (`geyserHole`, state 0, walkable): 0x212 on open sand, 0x213 / 0x239 / 0x23C beside a partition, 0x21D /
//   0x227 / 0x23B under a wall, 0x238 / 0x23A on B1F. No tiers: the floors' height steps are the JUMP_SOUTH ledges
//   0x225 / 0x226 (`ledge`, F20) and Flannery's dais.
// - Flannery's orange platform (walkable top, blocked rim) is `dais`; the gym statues `statue`; the flame sign in the 1F
//   band `decor`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

/** The geyser holes of both floors (every one a LAVARIDGE_GYM_*_WARP). */
const GEYSER_HOLES = [0x212, 0x213, 0x21d, 0x227, 0x238, 0x239, 0x23a, 0x23b, 0x23c];

const labels: [InteriorId, number[]][] = [
  ['sand', [0x201, 0x202, 0x208, 0x209, 0x20a, 0x210]],
  // The wall bands: lip + brick face (0x206 / 0x20E; B1F 0x22B / 0x233) and their T-junctions (0x204, 0x214; B1F 0x229).
  ['wall', [0x204, 0x206, 0x20e, 0x214, 0x229, 0x22b, 0x233]],
  // The partitions: tops, their foot in a band's face row, the end caps.
  ['mazeWall', [0x20c, 0x20b, 0x231, 0x228, 0x230]],
  ['decor', [0x216, 0x21e]],                     // the flame sign in the 1F band
  ['dais', [0x218, 0x219, 0x21a, 0x21b, 0x21c, 0x220, 0x221, 0x222, 0x223, 0x224]],
  ['statue', [0x215, 0x21f]],
  ['ledge', [0x225, 0x226]],                     // JUMP_SOUTH
  ['geyserHole', GEYSER_HOLES],
];

const ids = new Map<number, InteriorId>(labels.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id])));
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>(
  GEYSER_HOLES.map((m): [number, PuzzleId] => [m, { kind: 'geyserHole', state: 0, variant: 0, blocked: false }]));

export const LAVARIDGE_GYM: InteriorTable = {
  name: 'LavaridgeGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['4.1', '4.2'],
  pins: [
    // 1F (4.1): geyser holes on open sand, beside a partition, under the wall
    { map: [4, 1], x: 2, y: 3, id: 'geyserHole' },
    { map: [4, 1], x: 0, y: 6, id: 'geyserHole' },
    { map: [4, 1], x: 7, y: 2, id: 'geyserHole' },
    { map: [4, 1], x: 5, y: 2, id: 'geyserHole' },
    { map: [4, 1], x: 1, y: 4, id: 'sand' },
    { map: [4, 1], x: 0, y: 4, id: 'sand' },
    { map: [4, 1], x: 1, y: 2, id: 'sand' },
    { map: [4, 1], x: 0, y: 0, id: 'wall' },
    { map: [4, 1], x: 0, y: 8, id: 'wall' },
    { map: [4, 1], x: 6, y: 7, id: 'wall' },
    { map: [4, 1], x: 6, y: 3, id: 'mazeWall' },
    { map: [4, 1], x: 4, y: 16, id: 'mazeWall' },
    { map: [4, 1], x: 13, y: 8, id: 'decor' },
    { map: [4, 1], x: 13, y: 9, id: 'dais' },            // where Flannery stands
    { map: [4, 1], x: 11, y: 10, id: 'dais' },
    { map: [4, 1], x: 10, y: 15, id: 'statue' },
    { map: [4, 1], x: 10, y: 14, id: 'statue' },
    { map: [4, 1], x: 11, y: 13, id: 'ledge' },
    { map: [4, 1], x: 12, y: 13, id: 'ledge' },
    { map: [4, 1], x: 13, y: 18, id: 'mat' },
    // B1F (4.2)
    { map: [4, 2], x: 2, y: 3, id: 'geyserHole' },
    { map: [4, 2], x: 8, y: 9, id: 'geyserHole' },
    { map: [4, 2], x: 4, y: 16, id: 'geyserHole' },
    { map: [4, 2], x: 3, y: 6, id: 'geyserHole' },
    { map: [4, 2], x: 0, y: 6, id: 'geyserHole' },
    { map: [4, 2], x: 1, y: 3, id: 'sand' },
    { map: [4, 2], x: 0, y: 0, id: 'wall' },
    { map: [4, 2], x: 0, y: 5, id: 'wall' },
    { map: [4, 2], x: 4, y: 0, id: 'wall' },
    { map: [4, 2], x: 4, y: 7, id: 'mazeWall' },
    { map: [4, 2], x: 4, y: 2, id: 'mazeWall' },
    { map: [4, 2], x: 4, y: 1, id: 'mazeWall' },
    { map: [4, 2], x: 1, y: 12, id: 'ledge' },
    { map: [4, 2], x: 0, y: 12, id: 'ledge' },
  ],
};
