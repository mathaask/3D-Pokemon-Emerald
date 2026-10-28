// gTileset_EliteFour: the Elite Four rooms 16.0–16.3, the Champion's room 16.4 and the halls 16.5–16.9 (Hall 4, 16.8,
// is the long one). Curated by Phase 4b Task 4c (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt;
// sheet: npx tsx tools/map-atlas.ts --no-maps --sheet-only EliteFour --sheet-scale 5 --sheet-chunk 32).
//
// Mechanics (the live ids; their scripts: the rooms' scripts.inc and the shared PokemonLeague_EliteFour_* scripts the
// ROM's bytecode walk reaches, F15):
// - The exit door, 1 × 2 cells in the back wall at (6, 1)–(6, 2): closed `0x202` / `0x20A` (Champion: `0x31E` /
//   `0x326`), blocked in the map; on a win the script sets `OpenDoor_Frame` / `OpenDoor_Opening` (`0x344` / `0x345`;
//   Champion `0x346` / `0x347`), FALSE. `gymDoor` state 0 closed, state 5 open (the kind's last frame). The halls show
//   `0x344` / `0x345` in their own door, always open.
// - The entrance, 3 × 2 cells in the south wall at (5–7, 12–13) of 16.0–16.3: open it shows the room's own floor
//   (plain ids), and the walk-in script (and every later load) closes it with `EntryDoor_ClosedTop` /
//   `_ClosedBottom` (`0x206` / `0x20E`), TRUE. `gymDoor` state 0; the open cells are listed by position
//   (`puzzleCells`, F4: offId the floor id, offState 5).
// - The spotlights in the back wall's foot row (y 2): on `0x20C` / `0x20D`, switched off on a win with
//   `Left/RightSpotlightOff` (`0x2DD` / `0x2DE`), TRUE as before (no collision change). Inert: `legacy` in both
//   states (band cells: the shell draws them as decals whatever they hold).
// Static ramps and tiers (D13: real raised platforms; the ramp kind is `hiddenStairs`, here always state 1, the steps):
// - The halls: a landing (y 3–4, `tier`) at the top of a long staircase (x 4–6 from y 5 down to the map's south edge,
//   `hiddenStairs`); the landing's face is the lit lip (y 5–6) and the dark wall under it (to the south edge, with
//   lamps in Hall 4: `0x34A`, walkable in the ROM but walled in), all `tierFace`; the orange handrails flanking the
//   staircase (x 3 and x 7) are the ramp's side faces, `tierFace`.
// - The Champion's room: an octagonal dais (`tier`: its top and its walkable front lip y 9), its face (the chamfers
//   and the rows under it to the south edge, `tierFace`), the staircase up to it from the entrance (x 5–7, y 10–12) and
//   the steps from it up to the door (x 5–7, y 3–4), `hiddenStairs`.
// Other labels:
// - `wall`: the wall rows (paint, panels, the door frames), the south wall's walkable top row (y 11 of the rooms: the
//   player walks behind it), the Champion's glass walls.
// - `tiles`: the rooms' floors (their dark border rows included).
// - The rooms' themed side blocks (x 0–1 and 11–12, y 4–8, blocked): Sidney's speaker stacks `machine`; Phoebe's
//   ruined stone, Glacia's ice blocks and Drake's scaled rock `ridge` (solid masses carrying their art).
// - `legacy`: the battle square's floor markings (the Poké Ball and lines, x 4–8 y 4–9 of each room; Phase 4's
//   Poké Ball inlay rule) and the spotlights.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleCellPin, PuzzleId } from '../building';

const ids = new Map<number, InteriorId>();
const put = (id: InteriorId, ...ms: number[]) => { for (const m of ms) ids.set(m, id); };
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>();
const mech = (kind: PuzzleId['kind'], state: number, blocked: boolean, ...ms: number[]) => {
  for (const m of ms) { puzzle.set(m, { kind, state, variant: 0, blocked }); ids.set(m, kind); }
};

// ---- the mechanics
mech('gymDoor', 0, true, 0x202, 0x20a);                   // the exit door, closed (map collision: blocked)
mech('gymDoor', 0, true, 0x31e, 0x326);                   // the Champion's exit door, closed
mech('gymDoor', 5, false, 0x344, 0x345);                  // OpenDoor_Frame / _Opening (script FALSE; the halls' door)
mech('gymDoor', 5, false, 0x346, 0x347);                  // OpenDoorChampion_Frame / _Opening (script FALSE)
mech('gymDoor', 0, true, 0x206, 0x20e);                   // EntryDoor_ClosedTop / _ClosedBottom (script TRUE)
mech('hiddenStairs', 1, false,
  0x2d9, 0x2da, 0x2e1, 0x2e2,                             // the halls' staircase (and the Champion's door steps)
  0x33e, 0x33f,                                           // the Champion's door steps, their sides (y 3)
  0x32d, 0x32e, 0x32f, 0x335, 0x336, 0x337);              // the Champion's staircase up from the entrance

// ---- walls
put('wall',
  0x207, 0x208, 0x20f,                                    // the wall top (y 0; y 11 of the rooms, walkable)
  0x204, 0x205,                                           // the rooms' back-wall panels (y 1)
  0x201, 0x203, 0x209, 0x20b,                             // the exit door's frame
  0x2d5, 0x2d6, 0x348, 0x349,                             // the south wall's panels (rooms), the halls' back wall
  0x2e5, 0x2e6, 0x2d7, 0x2df,                             // the entrance's frame
  // the Champion's octagonal glass walls and the door's frame
  0x2e8, 0x2e9, 0x2ea, 0x2eb, 0x2ee, 0x2ef, 0x2f1, 0x2f2, 0x2f6, 0x2f9, 0x2fa, 0x2fe, 0x301, 0x302, 0x306, 0x309,
  0x30a, 0x30d, 0x30e, 0x311, 0x316, 0x2f0, 0x2f8, 0x2f7, 0x2ff, 0x300, 0x307, 0x308, 0x30c, 0x30f, 0x314,
  0x2ec, 0x2ed, 0x2f4, 0x2f5, 0x2fc, 0x2fd,
  0x31d, 0x31f, 0x325, 0x327);

// ---- floors
put('tiles',
  0x212, 0x228, 0x22c, 0x211, 0x239, 0x23d, 0x236, 0x237, 0x235,           // Sidney
  0x242, 0x258, 0x25c, 0x269, 0x26a, 0x26d, 0x26e, 0x26f, 0x260,           // Phoebe
  0x272, 0x288, 0x28c, 0x299, 0x29a, 0x29d, 0x296, 0x297, 0x295,           // Glacia
  0x2a2, 0x2b8, 0x2bc, 0x2c9, 0x2ca, 0x2cd, 0x2c6, 0x2c7, 0x2c5,           // Drake
  0x234, 0x264, 0x294, 0x2c4);                                              // the entrance's lower row (open)

// ---- tiers (D13)
put('tier',
  0x2d0, 0x2d1,                                                             // the halls' landing
  0x313, 0x312, 0x315, 0x304, 0x305, 0x319, 0x31b, 0x30b, 0x322);           // the Champion's dais (0x322: its front lip)
put('tierFace',
  0x2dc, 0x2e4, 0x2e7, 0x34a,                                               // the halls: the landing's lip and face
  0x2d8, 0x2db, 0x2e0, 0x2e3,                                               // the halls' handrails
  0x318, 0x31c, 0x320, 0x321, 0x323, 0x324,                                 // the Champion's dais: chamfer faces
  0x328, 0x329, 0x32a, 0x32b, 0x32c, 0x331, 0x332, 0x333, 0x338, 0x339,     // … and the rows under it
  0x33a, 0x33b, 0x33c, 0x33d);

// ---- the themed side blocks
put('machine',                                                              // Sidney's speaker stacks
  0x23e, 0x216, 0x21d, 0x21e, 0x225, 0x226, 0x23f, 0x23a, 0x22d, 0x22e, 0x217, 0x215, 0x21f, 0x227, 0x22f);
put('ridge',
  0x245, 0x246, 0x24d, 0x24e, 0x255, 0x256, 0x25d, 0x25e, 0x265, 0x266,     // Phoebe's ruined stone
  0x247, 0x241, 0x24f, 0x257, 0x267, 0x340, 0x341, 0x342, 0x343,
  0x29e, 0x276, 0x27d, 0x27e, 0x285, 0x286, 0x28d, 0x271, 0x28e,           // Glacia's ice blocks
  0x277, 0x275, 0x27f, 0x287, 0x28f,
  0x2ce, 0x2a6, 0x2ad, 0x2ae, 0x2b5, 0x2b6, 0x2bd, 0x2a1, 0x2be,           // Drake's scaled rock
  0x2a7, 0x2a5, 0x2af, 0x2b7, 0x2bf);

// ---- legacy
put('legacy',
  0x20c, 0x20d, 0x2dd, 0x2de,                                               // the spotlights, on / off (live, inert)
  // the battle square's markings (x 4–8, y 4–9), per room
  0x210, 0x213, 0x214, 0x218, 0x21c, 0x219, 0x21a, 0x21b, 0x220, 0x221, 0x222, 0x223, 0x224,
  0x229, 0x22a, 0x22b, 0x231, 0x232, 0x233, 0x238, 0x23b, 0x23c,
  0x240, 0x243, 0x244, 0x248, 0x24c, 0x249, 0x24a, 0x24b, 0x250, 0x251, 0x252, 0x253, 0x254,
  0x259, 0x25a, 0x25b, 0x261, 0x262, 0x263, 0x268, 0x26b, 0x26c,
  0x270, 0x273, 0x274, 0x278, 0x27c, 0x279, 0x27a, 0x27b, 0x280, 0x281, 0x282, 0x283, 0x284,
  0x289, 0x28a, 0x28b, 0x291, 0x292, 0x293, 0x298, 0x29b, 0x29c,
  0x2a0, 0x2a3, 0x2a4, 0x2a8, 0x2ac, 0x2a9, 0x2aa, 0x2ab, 0x2b0, 0x2b1, 0x2b2, 0x2b3, 0x2b4,
  0x2b9, 0x2ba, 0x2bb, 0x2c1, 0x2c2, 0x2c3, 0x2c8, 0x2cb, 0x2cc);

/** The entrance of each Elite Four room (5–7, 12–13): open, it shows the room's floor (`floor` y 12, `lower` y 13). */
const entrance = (floor: number, lower: number): PuzzleCellPin[] => [5, 6, 7].flatMap((x) => [
  { x, y: 12, kind: 'gymDoor' as const, variant: 0, offId: floor, offState: 5 },
  { x, y: 13, kind: 'gymDoor' as const, variant: 0, offId: lower, offState: 5 },
]);

export const ELITE_FOUR: InteriorTable = {
  name: 'EliteFour', ids, puzzle, target: 0.97,
  pins: [
    // Sidney (16.0)
    { map: [16, 0], x: 6, y: 1, id: 'gymDoor' }, { map: [16, 0], x: 6, y: 2, id: 'gymDoor' },       // exit, closed
    { map: [16, 0], x: 6, y: 12, id: 'gymDoor' }, { map: [16, 0], x: 5, y: 13, id: 'gymDoor' },     // entrance, open
    { map: [16, 0], x: 4, y: 12, id: 'wall' }, { map: [16, 0], x: 6, y: 0, id: 'wall' }, { map: [16, 0], x: 6, y: 11, id: 'wall' },
    { map: [16, 0], x: 3, y: 1, id: 'wall' }, { map: [16, 0], x: 1, y: 2, id: 'legacy' }, { map: [16, 0], x: 6, y: 6, id: 'legacy' },
    { map: [16, 0], x: 2, y: 6, id: 'tiles' }, { map: [16, 0], x: 6, y: 3, id: 'tiles' }, { map: [16, 0], x: 0, y: 10, id: 'tiles' },
    { map: [16, 0], x: 1, y: 6, id: 'machine' }, { map: [16, 0], x: 12, y: 4, id: 'machine' },
    // Phoebe (16.1), Glacia (16.2), Drake (16.3)
    { map: [16, 1], x: 0, y: 6, id: 'ridge' }, { map: [16, 1], x: 12, y: 7, id: 'ridge' }, { map: [16, 1], x: 9, y: 7, id: 'tiles' },
    { map: [16, 1], x: 7, y: 13, id: 'gymDoor' }, { map: [16, 1], x: 8, y: 9, id: 'legacy' },
    { map: [16, 2], x: 1, y: 7, id: 'ridge' }, { map: [16, 2], x: 6, y: 12, id: 'gymDoor' }, { map: [16, 2], x: 4, y: 4, id: 'legacy' },
    { map: [16, 3], x: 11, y: 5, id: 'ridge' }, { map: [16, 3], x: 6, y: 13, id: 'gymDoor' }, { map: [16, 3], x: 12, y: 9, id: 'tiles' },
    // the Champion (16.4)
    { map: [16, 4], x: 6, y: 1, id: 'gymDoor' }, { map: [16, 4], x: 6, y: 2, id: 'gymDoor' },       // exit, closed
    { map: [16, 4], x: 6, y: 6, id: 'tier' }, { map: [16, 4], x: 2, y: 7, id: 'tier' }, { map: [16, 4], x: 6, y: 9, id: 'tier' },
    { map: [16, 4], x: 6, y: 11, id: 'hiddenStairs' }, { map: [16, 4], x: 6, y: 4, id: 'hiddenStairs' }, { map: [16, 4], x: 5, y: 3, id: 'hiddenStairs' },
    { map: [16, 4], x: 3, y: 10, id: 'tierFace' }, { map: [16, 4], x: 8, y: 12, id: 'tierFace' }, { map: [16, 4], x: 2, y: 8, id: 'tierFace' },
    { map: [16, 4], x: 1, y: 3, id: 'wall' }, { map: [16, 4], x: 6, y: 0, id: 'wall' }, { map: [16, 4], x: 0, y: 10, id: 'wall' },
    // the halls (16.5, Hall 4 16.8)
    { map: [16, 5], x: 5, y: 1, id: 'gymDoor' }, { map: [16, 5], x: 5, y: 2, id: 'gymDoor' },       // the door, open
    { map: [16, 5], x: 2, y: 3, id: 'tier' }, { map: [16, 5], x: 8, y: 4, id: 'tier' },
    { map: [16, 5], x: 5, y: 9, id: 'hiddenStairs' }, { map: [16, 5], x: 4, y: 5, id: 'hiddenStairs' },
    { map: [16, 5], x: 1, y: 5, id: 'tierFace' }, { map: [16, 5], x: 9, y: 10, id: 'tierFace' }, { map: [16, 5], x: 3, y: 8, id: 'tierFace' },
    { map: [16, 5], x: 2, y: 2, id: 'wall' }, { map: [16, 5], x: 4, y: 1, id: 'wall' },
    { map: [16, 8], x: 1, y: 7, id: 'tierFace' }, { map: [16, 8], x: 1, y: 2, id: 'legacy' }, { map: [16, 8], x: 6, y: 30, id: 'hiddenStairs' },
  ],
  primary: SYM.gTileset_Building,
  maps: ['16.0', '16.1', '16.2', '16.3', '16.4', '16.5', '16.6', '16.7', '16.8', '16.9'],
  puzzleCells: {
    '16.0': entrance(0x22c, 0x234), '16.1': entrance(0x25c, 0x264),
    '16.2': entrance(0x28c, 0x294), '16.3': entrance(0x2bc, 0x2c4),
  },
};
