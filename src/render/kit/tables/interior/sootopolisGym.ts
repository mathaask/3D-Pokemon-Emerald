// gTileset_SootopolisGym: Sootopolis Gym 1F / B1F 15.0 / 15.1 (thin ice, tiers, hidden stairs), curated by Phase 4b
// Task 4b (worklists out/interior-ids-4b.task2.txt and out/live-ids.task2.txt; sheet: npx tsx tools/map-atlas.ts --no-maps
// --sheet-only SootopolisGym --sheet-scale 5 --sheet-chunk 32).
//
// Both floors are a stepped pyramid rising northward (D13). 1F: the entrance (rows 22–25) → ice field 1 (rows 17–19) → 2
// (12–14) → 3 (6–9) → Juan's platform (2–3), each joined at x = 8 by a passage through a two-row face band (a white lip
// row over a lavender face row: rows 20–21, 15–16, 10–11, 4–5); the dark slate terraces outside the walls step down the
// same way (their faces: rows 18–19, 14–15, 9–10, 2–3). B1F: four snow rooms (rows 6–9, 12–14, 17–19, 22–25) under rock
// faces with a snow lip (rows 10–11, 15–16, 20–21), slides at x = 8 between them.
// Labelling rules beyond the brief's:
// - `tierFace`: every cell of a horizontal face band, lip row and face row alike, its corner and end pieces, the posts
//   flanking the passages, the waterfalls running down a face (0x268–0x271) and B1F's rock faces and rock bands (the
//   two face rows vote a rise of 2, as the passages do). The vertical side walls of the rooms (1F: the white tops
//   0x244 / 0x241 and lavender inner faces 0x24D / 0x248) are `wall`; B1F's rock side walls (0x25D / 0x25E, the outer
//   strips 0x22D / 0x22F) are `ridge`.
// - `tier`: every floor of a tiered map is a tier top: Juan's platform and the entrance share their ids, the dark slate
//   terraces (0x208–0x220, blocked or not), the waterfalls' splash pools at a face's foot (0x278 / 0x279: floor art, on
//   Juan's platform blocked), B1F's snow (0x211) and its light ice terraces (0x201 / 0x22E).
// - Mechanics: thin ice 0x20D / 0x215 (intact; 0x215 the shadowed row under a face) → `…Ice_Cracked` 0x20E → `…Ice_Broken`
//   0x206 (field_tasks.c, `MapGridSetMetatileIdAt`: collision cleared, so never blocked); hidden stairs 0x20F (the ice
//   slope, SLIDE_SOUTH) → `…Stairs` 0x207 (the 1F stairs script, FALSE). B1F's slides and the permanent entrance stairs
//   (1F 8,20–21) are the same ids: ramps between two tiers in both states (F9).
// - The boulders on the ice (0x203, 0x216 under a face) are `ridge`; Juan's purple dais (walkable) `dais`; the gym
//   statues `statue` (their walkable tops too: the statue overhangs north, like Phase 4's plants); the emblem in the
//   back wall `decor`; the 1F ladder down `stairsDown`, B1F's ladder up (its rung cell on the rock too) `stairsUp`.

import { SYM } from '../../../../game/symbols';
import type { InteriorId, InteriorTable, PuzzleId } from '../building';

/** The two thin-ice ids of the intact state (0x215: the row under a face), cracked and broken (field_tasks.c). */
const ICE_INTACT = [0x20d, 0x215], ICE_CRACKED = 0x20e, ICE_BROKEN = 0x206;
/** The hidden stairs: the ice slope (hidden) and `METATILE_SootopolisGym_Stairs` (risen). */
const STAIRS_HIDDEN = 0x20f, STAIRS_RISEN = 0x207;

const labels: [InteriorId, number[]][] = [
  // Tier tops: Juan's platform and the entrance floor (shared ids, 0x24F the statues' shadow), the splash pools at the
  // foot of the waterfalls, the dark slate terraces; B1F's snow and light ice terraces.
  ['tier', [0x23e, 0x23f, 0x246, 0x247, 0x24f, 0x257, 0x25f, 0x278, 0x279, 0x208, 0x210, 0x218, 0x220,
    0x211, 0x201, 0x22e]],
  // Face bands (lip + face rows, corners, ends, passage posts, waterfalls); B1F's rock faces, bands and their corners.
  ['tierFace', [0x24a, 0x252, 0x23a, 0x23b, 0x242, 0x243, 0x23c, 0x239, 0x245, 0x240, 0x24c, 0x249, 0x255, 0x250,
    0x24e, 0x256, 0x258, 0x259, 0x25b, 0x260, 0x261, 0x262, 0x268, 0x269, 0x270, 0x271,
    0x209, 0x219, 0x21d, 0x21e, 0x226, 0x225, 0x227, 0x235, 0x237, 0x23d]],
  // The rooms' vertical side walls (1F): white tops and lavender inner faces.
  ['wall', [0x244, 0x24d, 0x248, 0x241]],
  // Boulders on the ice; B1F's rock side walls and outer rock strips.
  ['ridge', [0x203, 0x216, 0x25d, 0x25e, 0x22d, 0x22f]],
  ['decor', [0x254, 0x25c]],                     // the gym emblem in the back wall
  ['dais', [0x231, 0x22a, 0x22b, 0x22c, 0x236, 0x204, 0x232, 0x233, 0x234, 0x205]],
  ['statue', [0x217, 0x21f]],
  ['stairsDown', [0x21c]],                       // 1F: the ladder down to B1F (LADDER warp)
  ['stairsUp', [0x214, 0x20c]],                  // B1F: the ladder up (LADDER warp) and its top on the rock
  ['thinIce', [...ICE_INTACT, ICE_CRACKED, ICE_BROKEN]],
  ['hiddenStairs', [STAIRS_HIDDEN, STAIRS_RISEN]],
];

const ids = new Map<number, InteriorId>(labels.flatMap(([id, ms]) => ms.map((m): [number, InteriorId] => [m, id])));
/** Mechanic ids → their meaning (every key also in `ids`, labelled with its kind). */
const puzzle = new Map<number, PuzzleId>([
  ...ICE_INTACT.map((m): [number, PuzzleId] => [m, { kind: 'thinIce', state: 0, variant: 0, blocked: false }]),
  [ICE_CRACKED, { kind: 'thinIce', state: 1, variant: 0, blocked: false }],
  [ICE_BROKEN, { kind: 'thinIce', state: 2, variant: 0, blocked: false }],
  [STAIRS_HIDDEN, { kind: 'hiddenStairs', state: 0, variant: 0, blocked: false }],
  [STAIRS_RISEN, { kind: 'hiddenStairs', state: 1, variant: 0, blocked: false }],
]);

export const SOOTOPOLIS_GYM: InteriorTable = {
  name: 'SootopolisGym', ids, puzzle, target: 0.97,
  primary: SYM.gTileset_Building,
  maps: ['15.0', '15.1'],
  pins: [
    // 1F (15.0): thin ice, intact (the cells i_pz_sootopolis cracks and breaks read thinIce in every state: `puzzle`)
    { map: [15, 0], x: 4, y: 7, id: 'thinIce' },
    { map: [15, 0], x: 3, y: 6, id: 'thinIce' },       // 0x215, the shadowed row under the face
    { map: [15, 0], x: 8, y: 6, id: 'thinIce' },       // just south of the third hidden stairs
    // hidden stairs: hidden (the ice slope, 0x20F) and risen (the entrance stairs, 0x207)
    { map: [15, 0], x: 8, y: 4, id: 'hiddenStairs' },
    { map: [15, 0], x: 8, y: 16, id: 'hiddenStairs' },
    { map: [15, 0], x: 8, y: 20, id: 'hiddenStairs' },
    // face bands between Juan's platform and ice field 3 (lip, face, post), a terrace face's waterfall
    { map: [15, 0], x: 5, y: 4, id: 'tierFace' },
    { map: [15, 0], x: 5, y: 5, id: 'tierFace' },
    { map: [15, 0], x: 7, y: 4, id: 'tierFace' },
    { map: [15, 0], x: 9, y: 21, id: 'tierFace' },
    { map: [15, 0], x: 1, y: 15, id: 'tierFace' },
    // side walls, boulders
    { map: [15, 0], x: 1, y: 6, id: 'wall' },
    { map: [15, 0], x: 14, y: 7, id: 'wall' },
    { map: [15, 0], x: 4, y: 8, id: 'ridge' },
    { map: [15, 0], x: 5, y: 6, id: 'ridge' },
    // tier tops: Juan's platform, the entrance, a dark terrace (walkable), a splash pool (blocked)
    { map: [15, 0], x: 4, y: 3, id: 'tier' },
    { map: [15, 0], x: 8, y: 23, id: 'tier' },
    { map: [15, 0], x: 16, y: 5, id: 'tier' },
    { map: [15, 0], x: 4, y: 2, id: 'tier' },
    // Juan's dais, the emblem, the statues, the ladder, the exit mat
    { map: [15, 0], x: 8, y: 2, id: 'dais' },
    { map: [15, 0], x: 8, y: 0, id: 'decor' },
    { map: [15, 0], x: 6, y: 24, id: 'statue' },
    { map: [15, 0], x: 10, y: 23, id: 'statue' },
    { map: [15, 0], x: 11, y: 22, id: 'stairsDown' },
    { map: [15, 0], x: 8, y: 25, id: 'mat' },
    // B1F (15.1): snow, the slides, the rock faces, the side walls, the ladder, the light terraces
    { map: [15, 1], x: 5, y: 7, id: 'tier' },
    { map: [15, 1], x: 8, y: 10, id: 'hiddenStairs' },
    { map: [15, 1], x: 8, y: 21, id: 'hiddenStairs' },
    { map: [15, 1], x: 5, y: 10, id: 'tierFace' },
    { map: [15, 1], x: 5, y: 11, id: 'tierFace' },
    { map: [15, 1], x: 2, y: 19, id: 'tierFace' },
    { map: [15, 1], x: 1, y: 7, id: 'ridge' },
    { map: [15, 1], x: 15, y: 7, id: 'ridge' },
    { map: [15, 1], x: 0, y: 6, id: 'ridge' },
    { map: [15, 1], x: 11, y: 22, id: 'stairsUp' },
    { map: [15, 1], x: 11, y: 21, id: 'stairsUp' },
    { map: [15, 1], x: 0, y: 0, id: 'tier' },
    { map: [15, 1], x: 0, y: 11, id: 'tier' },
  ],
};
