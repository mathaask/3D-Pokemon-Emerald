import { describe, it, expect } from 'vitest';
import { arenaLook } from '../src/render/battle/look';
import { arenaPalette } from '../src/render/battle/palette';
import { timeOfDay } from '../src/render/overworld/timeOfDay';

const look = (k: Parameters<typeof arenaPalette>[0], hour: number) => arenaLook(k, arenaPalette(k, null), hour);
describe('arenaLook', () => {
  it('lights outdoor arenas by the hour as the overworld', () => {
    expect(look('grass', 12).sunI).toBeCloseTo(timeOfDay(12).sunI, 6);
    expect(look('grass', 12).night).toBe(0);
    expect(look('grass', 22).night).toBe(1);
    expect(look('grass', 12).clouds).toBe(1);
  });
  it('keeps indoor arenas at the same light whatever the hour', () => {
    expect(look('gym', 23).night).toBe(0);
    expect(look('gym', 23).sunI).toBe(look('gym', 12).sunI);
    expect(look('gym', 12).clouds).toBe(0);
  });
  it('closes the fog in caves and underwater, blue under the sea', () => {
    expect(look('cave', 12).fogFar).toBeLessThan(look('grass', 12).fogFar);
    const u = look('underwater', 12);
    expect(u.fog.b).toBeGreaterThan(u.fog.r); expect(u.caustics).toBe(1);
  });
});
