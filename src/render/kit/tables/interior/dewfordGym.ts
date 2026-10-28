// gTileset_DewfordGym: Dewford Gym 3.3 (a dark maze; the darkness is Task 7's flash rule, D10). Curated by Phase 4b Task
// 4a from the map (vendor data/layouts/DewfordTown_Gym/map.bin), the sheet (npx tsx tools/map-atlas.ts --no-maps
// --sheet-only DewfordGym --sheet-scale 5 --sheet-chunk 32) and the worklist out/interior-ids-4b.task2.txt. No id is
// written at runtime.
//
// - Floor: the olive stone ground, its shaded variants and the rock walls' rims overhanging walkable cells (`stone`), and
//   the statues' domes.
// - The maze: brown rock with grey rims and its blue-grey front faces, every cell blocked, the map's outer frame
//   included (it is the same rock, 4-connected to the inner walls): `mazeWall` (D7: the perimeter shell's masses). They
//   stand on the floor, nothing stands on them: no tier.
// - Brawly's corner: his stage `dais` (blocked ends, walkable top and front), the gym emblem on the face behind it
//   `decor`, two tall lockers flanking it `cabinet`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };

put('stone',
  0x201, 0x202, 0x203, 0x205, 0x206, 0x209, 0x20a, 0x20b, 0x210, 0x211, 0x212, 0x213,   // ground, shaded ground
  0x20d, 0x215, 0x216, 0x218, 0x21a, 0x21b, 0x222, 0x223,                 // rims overhanging walkable cells
  0x21f);                                                                 // the statues' domes (walkable)
put('mazeWall',
  0x204, 0x207, 0x208, 0x20c, 0x20e, 0x20f, 0x214, 0x217, 0x21c, 0x21d, 0x21e, 0x220, 0x221,
  0x228, 0x229, 0x230, 0x231, 0x238, 0x239, 0x23a, 0x23b, 0x23c,          // rock tops and rims, the outer frame
  0x224, 0x225, 0x226);                                                   // the front faces
put('decor', 0x243, 0x244);                                               // the gym emblem
put('dais', 0x22a, 0x22b, 0x22c, 0x22d, 0x232, 0x233, 0x234, 0x235);      // Brawly's stage
put('cabinet', 0x22e, 0x236);                                             // the lockers beside it
put('statue', 0x227);

const at = (x: number, y: number, id: InteriorId) => ({ map: [3, 3] as [number, number], x, y, id });

export const DEWFORD_GYM: InteriorTable = {
  name: 'DewfordGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['3.3'],
  pins: [
    at(2, 5, 'stone'), at(9, 9, 'stone'), at(1, 4, 'stone'), at(8, 22, 'stone'), at(10, 15, 'stone'),
    at(0, 0, 'mazeWall'), at(17, 10, 'mazeWall'), at(7, 1, 'mazeWall'), at(8, 9, 'mazeWall'), at(2, 2, 'mazeWall'),
    at(7, 7, 'mazeWall'), at(3, 1, 'mazeWall'),
    at(3, 2, 'decor'), at(4, 2, 'decor'),
    at(3, 3, 'dais'), at(2, 3, 'dais'), at(4, 4, 'dais'), at(5, 4, 'dais'),
    at(1, 2, 'cabinet'), at(6, 3, 'cabinet'),
    at(4, 24, 'statue'), at(4, 23, 'stone'), at(5, 27, 'mat'),
  ],
};
