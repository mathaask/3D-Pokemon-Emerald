// gTileset_RustboroGym: Rustboro Gym 11.3 (a maze of rock walls). Curated by Phase 4b Task 4a from the map (vendor
// data/layouts/RustboroCity_Gym/map.bin), the sheet (npx tsx tools/map-atlas.ts --no-maps --sheet-only RustboroGym
// --sheet-scale 5 --sheet-chunk 32) and the worklist out/interior-ids-4b.task2.txt. No id is written at runtime.
//
// - Floor: the pink-and-white tiles, with their shadow variants and the maze walls' north lips overhanging walkable cells
//   (0x218–0x21A, 0x22C–0x22E, 0x230, 0x232–0x235: walkable, so floor by Phase 4's rule), and the statues' domes.
// - The maze: brown rock blocks with dark rims, every cell blocked (tops, rims, the grey-green front faces): `mazeWall`
//   (D7 masses). They stand on the floor, nothing stands on them: no tier.
// - Back wall rows 0–1 (and its corners at row 2) `wall`, the gym emblem `decor`; Roxanne's stage `dais` (blocked ends,
//   walkable top and front).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None here. */
const puzzle = new Map<number, PuzzleId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };

put('tiles',
  0x201, 0x202, 0x203, 0x204, 0x216, 0x21b, 0x22f, 0x237,                 // tiles, shaded tiles
  0x218, 0x219, 0x21a, 0x22c, 0x22d, 0x22e, 0x230, 0x232, 0x233, 0x234, 0x235,   // the walls' lips over walkable cells
  0x21e);                                                                 // the statues' domes (walkable)
put('wall', 0x205, 0x206, 0x207, 0x20d, 0x20e, 0x20f, 0x215, 0x217);
put('decor', 0x21f, 0x227);                                               // the gym emblem
put('dais', 0x208, 0x209, 0x20a, 0x20b, 0x20c, 0x210, 0x211, 0x212, 0x213, 0x214);   // Roxanne's stage
put('statue', 0x226);
put('mazeWall', 0x21d, 0x220, 0x221, 0x222, 0x223, 0x224, 0x225, 0x228, 0x229, 0x22a, 0x22b, 0x231);

const at = (x: number, y: number, id: InteriorId) => ({ map: [11, 3] as [number, number], x, y, id });

export const RUSTBORO_GYM: InteriorTable = {
  name: 'RustboroGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['11.3'],
  pins: [
    at(4, 4, 'tiles'), at(1, 3, 'tiles'), at(5, 5, 'tiles'), at(6, 8, 'tiles'), at(1, 10, 'tiles'),
    at(0, 0, 'wall'), at(4, 1, 'wall'), at(10, 2, 'wall'), at(5, 0, 'decor'), at(5, 1, 'decor'),
    at(5, 2, 'dais'), at(3, 2, 'dais'), at(7, 3, 'dais'),
    at(4, 6, 'mazeWall'), at(4, 7, 'mazeWall'), at(0, 9, 'mazeWall'), at(10, 12, 'mazeWall'), at(4, 10, 'mazeWall'),
    at(2, 18, 'statue'), at(2, 17, 'tiles'), at(5, 19, 'mat'),
  ],
};
