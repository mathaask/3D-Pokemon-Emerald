// gTileset_CableClub: the Hall of Fame 16.11 only (its link rooms stay out of scope). Curated by Phase 4b Task 4c
// (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps
// --sheet-only CableClub --sheet-scale 5 --sheet-chunk 32). No live ids: nothing on 16.11 changes at runtime.
//
// The room: a purple hall, its floor ICE behaviour (cosmetic: the floor kind `ice`, no mechanic); two wall consoles each
// side of the back wall, an alcove in the middle of it holding the big screen, and the Hall of Fame machine in front of
// the alcove, where the player sets down the team (the room's one `dais`, Task 11a: "the Hall of Fame platform").
// - `wall`: the back wall's corners and paint, the side walls (blocked), the alcove's back and its blocked base row
//   (y 3, the lip under the screen), the entrance's blocked corners.
// - `decor`: the four wall consoles (green screen over a keyboard: 2 rows) and the alcove's big screen.
// - `ice`: every walkable cell (the floor, its lit edge strips beside the side walls, the strip under the consoles, the
//   machine's walkable foot row y 5 (the art overhangs, the machine stands on y 4), the entrance steps at y 16).
// - `dais`: the machine (y 4, blocked).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). None on the Hall of Fame. */
const puzzle = new Map<number, PuzzleId>();

put('wall',
  0x2cc, 0x2cd, 0x2ce, 0x2cf, 0x2d4, 0x2d5, 0x2d6, 0x2d7,               // the back wall's corners (y 0–1)
  0x2dc, 0x2dd, 0x2de, 0x2df,                                           // their foot (y 2, blocked)
  0x2e4, 0x2e7, 0x2ec, 0x2ef,                                           // the side walls and their south ends
  0x2d0, 0x2d1, 0x2d2, 0x2d3, 0x2d8, 0x2d9, 0x2da, 0x2db,               // the alcove's back (y 0–1)
  0x2e8, 0x2e9, 0x2ea, 0x2f0, 0x2eb,                                    // the alcove's blocked base (y 3)
  0x2ff, 0x2f7);                                                        // the entrance's corners (y 16)
put('decor',
  0x2f4, 0x2f5, 0x2fc, 0x2fd,                                           // the wall consoles (screen y 0, keyboard y 1)
  0x2e0, 0x2e1, 0x2e2, 0x2e3);                                          // the alcove's big screen (y 2)
put('ice', 0x2f6, 0x2fe, 0x2e5, 0x2e6, 0x2ed, 0x2ee, 0x2f9, 0x2fa, 0x2fb, 0x2f8);
put('dais', 0x2f1, 0x2f2, 0x2f3);                                       // the Hall of Fame machine

export const CABLE_CLUB: InteriorTable = {
  name: 'CableClub', ids, puzzle, target: 0.97,
  pins: [
    { map: [16, 11], x: 0, y: 5, id: 'wall' }, { map: [16, 11], x: 14, y: 0, id: 'wall' },
    { map: [16, 11], x: 7, y: 0, id: 'wall' }, { map: [16, 11], x: 7, y: 3, id: 'wall' },
    { map: [16, 11], x: 3, y: 0, id: 'decor' }, { map: [16, 11], x: 11, y: 1, id: 'decor' }, { map: [16, 11], x: 7, y: 2, id: 'decor' },
    { map: [16, 11], x: 7, y: 4, id: 'dais' }, { map: [16, 11], x: 6, y: 4, id: 'dais' },
    { map: [16, 11], x: 7, y: 10, id: 'ice' }, { map: [16, 11], x: 1, y: 8, id: 'ice' }, { map: [16, 11], x: 7, y: 5, id: 'ice' },
    { map: [16, 11], x: 3, y: 2, id: 'ice' }, { map: [16, 11], x: 7, y: 16, id: 'ice' },
  ],
  primary: SYM.gTileset_Building,
  maps: ['16.11'],
};
