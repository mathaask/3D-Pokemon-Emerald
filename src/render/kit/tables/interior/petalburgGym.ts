// gTileset_PetalburgGym: Petalburg Gym 8.1 (nine rooms stacked north to south, sliding doors). Curated by Phase 4b Task 4a
// from the map (vendor data/layouts/PetalburgCity_Gym/map.bin), the sheet (npx tsx tools/map-atlas.ts --no-maps
// --sheet-only PetalburgGym --sheet-scale 5 --sheet-chunk 32), the worklists out/interior-ids-4b.task2.txt /
// out/live-ids.task2.txt, data/maps/PetalburgCity_Gym/scripts.inc and field_specials.c.
//
// - Rooms: boards (the left column's shaded boards and the strip under the wall included); in each training room a
//   tatami square (orange, green or blue frames: `rug`); Norman's room (rows 0–7) has his stage (`dais`, blocked edges
//   and the walkable top and front he and the player stand on), shoji windows and the gym emblem; the entrance room
//   (rows 104–111) has yellow tiles, two statues (the dome over the walkable cell north of each is floor) and a flower
//   alcove in its back wall (`decor`, framed by wall pillars).
// - Each room's back wall carries its name plaque (`decor`).
// - Sliding doors (gymDoor; F33): field_specials.c PetalburgGymSetDoorMetatiles writes a door as two cells, the frame id
//   at (x, y) and frame + 8 below it, both `| MAPGRID_IMPASSABLE` (blocked TRUE). The map holds Frame0 (0x218 / 0x220): it
//   IS the closed door (Task 1's i_pz_petalburg entry: "frame 0, 0x218, is the closed door the map holds"); the frames
//   slide it open from the middle (Frame4 + 8 = 0x224, METATILE_PetalburgGym_Door, PETALBURG_GYM_DOOR, the open door).
//   States follow the frame's openness k/4 on the 6-state scale (open 0, .2, … 1): Frame0–4 → 0, 1, 3, 4, 5, so the
//   map's closed door reads closed and the last frame fully open (state 2 is unused here).
// - RoomEntrance_Left / _Right (0x210 / 0x211, SOUTH_ARROW_WARP, set FALSE by the Set*RoomDoorMetatiles scripts on the
//   room's south row once its door is open): an exit mat appearing over boards. `mat` (its behaviour's kind): neither a
//   mechanic nor inert (no label can be: its behaviour is an arrow warp), so the change rebuilds (see the Task 4a report).

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);

// Floors.
put('boards', 0x201, 0x209, 0x212, 0x213, 0x214,
  0x22a, 0x232);                                                          // Norman's room: white floor markings
put('tiles', 0x205, 0x206, 0x20d, 0x20e, 0x215, 0x216, 0x22b, 0x22c,      // the entrance room's yellow tiles
  0x240);                                                                 // the statues' domes (walkable)
put('rug',                                                                // the tatami squares (orange, green, blue)
  ...range(0x241, 0x247), ...range(0x249, 0x24f), ...range(0x251, 0x257), ...range(0x259, 0x25f),
  ...range(0x2a1, 0x2a7), ...range(0x2a9, 0x2af), ...range(0x2b1, 0x2b7), ...range(0x2b9, 0x2bf),
  ...range(0x2c1, 0x2c7), ...range(0x2c9, 0x2cf), ...range(0x2d1, 0x2d7), ...range(0x2d9, 0x2df));
put('mat', 0x210, 0x211);                                                 // RoomEntrance_Left / _Right (scripted)

// Wall rows.
put('wall', 0x202, 0x203, 0x204, 0x20a, 0x20b, 0x20c,
  0x250, 0x258, 0x2b0, 0x2b8);                                            // the pillars framing the flower alcove
put('window', 0x228, 0x229, 0x230, 0x231);                                // Norman's room: shoji windows
put('decor', 0x207, 0x20f,                                                // the gym emblem over Norman's stage
  0x21d, 0x21e, 0x21f,                                                    // the rooms' name plaques
  0x2a0, 0x2a8);                                                          // the flower in its alcove

// Furniture.
put('dais', 0x233, 0x234, 0x235, 0x236, 0x237, 0x23b, 0x23c, 0x23d, 0x23e, 0x23f);   // Norman's stage
put('statue', 0x248);

// Sliding doors: Frame k at (x, y), Frame k + 8 below; all blocked.
const DOOR_STATE = [0, 1, 3, 4, 5];
for (let k = 0; k < 5; k++) {
  for (const m of [0x218 + k, 0x220 + k]) {
    ids.set(m, 'gymDoor');
    puzzle.set(m, { kind: 'gymDoor', state: DOOR_STATE[k], variant: 0, blocked: true });
  }
}

const at = (x: number, y: number, id: InteriorId) => ({ map: [8, 1] as [number, number], x, y, id });

export const PETALBURG_GYM: InteriorTable = {
  name: 'PetalburgGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['8.1'],
  pins: [
    // Norman's room
    at(4, 5, 'boards'), at(0, 4, 'boards'), at(1, 2, 'boards'), at(0, 0, 'wall'), at(3, 1, 'wall'),
    at(1, 0, 'window'), at(2, 1, 'window'), at(4, 0, 'decor'), at(4, 1, 'decor'),
    at(4, 2, 'dais'), at(2, 2, 'dais'), at(4, 3, 'dais'), at(6, 3, 'dais'),
    // training rooms: plaques, tatami, doors (closed: Frame0 and Frame0 + 8)
    at(4, 13, 'decor'), at(1, 15, 'boards'), at(2, 17, 'rug'), at(4, 69, 'rug'), at(4, 56, 'rug'),
    at(7, 13, 'gymDoor'), at(7, 14, 'gymDoor'), at(1, 26, 'gymDoor'), at(1, 27, 'gymDoor'),
    at(1, 52, 'gymDoor'), at(7, 53, 'gymDoor'), at(1, 104, 'gymDoor'), at(7, 105, 'gymDoor'),
    at(6, 85, 'boards'),                                                  // a RoomEntrance cell before its mat appears
    // the entrance room
    at(4, 104, 'decor'), at(4, 105, 'decor'), at(3, 104, 'wall'), at(5, 105, 'wall'),
    at(4, 108, 'tiles'), at(0, 107, 'tiles'), at(1, 110, 'statue'), at(7, 110, 'statue'), at(1, 109, 'tiles'),
    at(4, 111, 'mat'),
  ],
};
