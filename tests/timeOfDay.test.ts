import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { timeOfDay, nightFactor, indoorLight, INDOOR_DAY, INDOOR_NIGHT, ACTOR_NIGHT_FLOOR } from '../src/render/overworld/timeOfDay';

describe('timeOfDay (the overworld keyframes)', () => {
  it('blends the keyframes', () => {
    expect(timeOfDay(9).sunI).toBeCloseTo(2.4);
    expect(timeOfDay(12).sunI).toBeCloseTo(2.4 + (2.3 - 2.4) * (3 / 7), 6);
    expect(timeOfDay(22).fog.getHex()).toBe(timeOfDay(23).fog.getHex());
    expect(timeOfDay(18).sunColor.r).toBeCloseTo(1.0);
  });
  it('ramps the night in after sunset and out after sunrise', () => {
    expect(nightFactor(12)).toBe(0);
    expect(nightFactor(22)).toBe(1);
    expect(nightFactor(19)).toBeCloseTo((19 - 18.3) / 1.5, 6);
    expect(nightFactor(5.6)).toBeCloseTo(0.5, 6);
  });
});

describe('indoor light (D8: the in-scope rooms follow the clock)', () => {
  it('lights a room as today at day and blends to the lamp-lit night', () => {
    const day = indoorLight(0);
    expect(day.sunColor.equals(new THREE.Color(1.0, 0.95, 0.85))).toBe(true); expect(day.sunI).toBe(1.5);
    expect(day.sky.equals(new THREE.Color(1.0, 0.97, 0.92))).toBe(true); expect(day.ground.equals(new THREE.Color(0.55, 0.5, 0.45))).toBe(true);
    expect(day.hemiI).toBe(1.7);                                          // today's indoor constants, bit for bit
    const night = indoorLight(1);
    expect(night.sunI).toBe(INDOOR_NIGHT.sunI); expect(night.hemiI).toBe(INDOOR_NIGHT.hemiI);
    expect(night.sunI).toBeLessThan(day.sunI); expect(night.hemiI).toBeLessThan(day.hemiI);
    expect(indoorLight(0.5).sunI).toBeCloseTo((day.sunI + night.sunI) / 2, 6);
  });
  it('writes into `out` without touching the constants, and keeps the actor floor a share of the day', () => {
    const out = indoorLight(1);
    const again = indoorLight(0, out);
    expect(again).toBe(out);
    expect(again.sunColor.equals(INDOOR_DAY.sunColor)).toBe(true);
    expect(INDOOR_NIGHT.sunColor.equals(INDOOR_DAY.sunColor)).toBe(false);
    expect(indoorLight(2).sunI).toBe(INDOOR_NIGHT.sunI);                 // (clamped)
    expect(ACTOR_NIGHT_FLOOR).toBeGreaterThan(0.85); expect(ACTOR_NIGHT_FLOOR).toBeLessThanOrEqual(1);
  });
});
