// tools/lib/decompEdits.ts: the grid word an edit writes (pure) and, where the decomp is on the machine
// (vendor/pokeemerald-src, gitignored like the ROM), the script and C lists it reads.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { editRaw, scriptEdits, cMetatiles, metatileId } from '../tools/lib/decompEdits';

const haveDecomp = fs.existsSync(path.resolve(import.meta.dirname, '../vendor/pokeemerald-src/include/constants/metatile_labels.h'));

describe('editRaw (MapGridSetMetatileIdAt)', () => {
  it('keeps the elevation, takes the id and the collision of the edit', () => {
    expect(editRaw(0x320d, { metatile: 0x20e, blocked: false })).toBe(0x320e);
    expect(editRaw(0x320d, { metatile: 0x20e, blocked: true })).toBe(0x3e0e);
    // a blocked cell made passable loses its collision
    expect(editRaw(0x1c05, { metatile: 0x206, blocked: false })).toBe(0x1206);
    expect(editRaw(0x0000, { metatile: 0x7ff, blocked: false })).toBe(0x03ff);
  });
});

describe.skipIf(!haveDecomp)('decomp lists (vendor/pokeemerald-src)', () => {
  it('reads a script label up to the next one, map-local', () => {
    const e = scriptEdits('SootopolisCity_Gym_1F', 'SootopolisCity_Gym_1F_EventScript_OpenFirstStairs');
    expect(e.map((c) => [c.x, c.y, c.blocked])).toEqual([[8, 15, false], [8, 16, false]]);
    expect(e[0].metatile).toBe(metatileId('METATILE_SootopolisGym_Stairs'));
    // the whole file: every label's
    expect(scriptEdits('SootopolisCity_Gym_1F').length).toBe(6);
    expect(() => scriptEdits('SootopolisCity_Gym_1F', 'NoSuchLabel')).toThrow(/no script label/);
  });

  it('resolves label offsets and the C writers', () => {
    expect(metatileId('METATILE_PetalburgGym_SlidingDoor_Frame0+8')).toBe(metatileId('METATILE_PetalburgGym_SlidingDoor_Frame0') + 8);
    expect(() => metatileId('METATILE_NoSuch')).toThrow(/unknown metatile/);
    const ft = cMetatiles('field_tasks.c');
    expect(ft.has('METATILE_SootopolisGym_Ice_Cracked')).toBe(true);
    expect(ft.has('METATILE_Pacifidlog_SubmergedLogs_HorizontalLeft')).toBe(true);
    expect(ft.has('METATILE_Fallarbor_NormalGrass')).toBe(true);
    expect(cMetatiles('field_specials.c').has('METATILE_PetalburgGym_SlidingDoor_Frame4')).toBe(true);
    // the rotating tile puzzle moves statues: no metatile write
    expect(cMetatiles('rotating_tile_puzzle.c').size).toBe(0);
  });
});
