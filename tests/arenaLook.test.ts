import { describe, it, expect } from 'vitest';
import { arenaLook } from '../src/render/battle/look';
import { arenaPalette } from '../src/render/battle/palette';
import { timeOfDay } from '../src/render/overworld/timeOfDay';
import { ARENA_KINDS, ARENA_SETTING } from '../src/render/battle/arenaKind';
import { toLinear } from '../src/render/kit/palette';
import * as THREE from 'three';

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
  it('darkens the fog of every open-sky arena at night as the overworld (the Sky Pillar too); by day the Sky Pillar fog is pulled to its backdrop', () => {
    const lumaOf = (c: { r: number; g: number; b: number }) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    const open = ARENA_KINDS.filter((k) => ['outdoor', 'water', 'sky'].includes(ARENA_SETTING[k]));
    expect(open).toContain('rayquaza');
    const grass = lumaOf(look('grass', 22).fog);
    for (const k of open) {
      const night = lumaOf(look(k, 22).fog), day = lumaOf(look(k, 12).fog);
      // (at 22 h rayquaza's fog was (0.413, 0.487, 0.567): ≈ 8× grass's (0.05, 0.07, 0.16) — the far clouds glowed)
      expect(Math.abs(night - grass), k).toBeLessThan(0.02);
      expect(night, k).toBeLessThan(day);
    }
    // (by day — the night factor 0 — the Sky Pillar's fog is still the hour's lerped half-way to its backdrop, the wall)
    for (const hour of [7, 11, 12, 16, 18]) {
      const p = arenaPalette('rayquaza', null), want = new THREE.Color().copy(timeOfDay(hour).fog).lerp(new THREE.Color(...toLinear(p.wall)), 0.5);
      expect(look('rayquaza', hour).fog.equals(want), `${hour} h`).toBe(true);
    }
  });
  it('closes the fog in caves and underwater, blue under the sea', () => {
    expect(look('cave', 12).fogFar).toBeLessThan(look('grass', 12).fogFar);
    const u = look('underwater', 12);
    expect(u.fog.b).toBeGreaterThan(u.fog.r); expect(u.caustics).toBe(1);
  });
});
