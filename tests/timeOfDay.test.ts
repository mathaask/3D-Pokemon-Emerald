import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  timeOfDay, nightFactor, indoorLight, INDOOR_DAY, INDOOR_NIGHT, ACTOR_NIGHT_FLOOR, actorFloorShare, indoorCardLight,
} from '../src/render/overworld/timeOfDay';

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

describe('indoor actors over dusk and dawn (D8: within 0.9–1.15× their day light at every hour)', () => {
  const LUMA = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  const day = LUMA(indoorCardLight(INDOOR_DAY));
  /** Linear proxy of an actor's light against the day (calibrated on the harness: at hour 19 the old floor gave 0.707,
   *  measured 0.865 in sRGB ≈ 0.707^(1/2.2)): the room's light on it, lifted to its floor's share of the day. */
  const actor = (h: number) => {
    const k = nightFactor(h);
    return Math.max(LUMA(indoorCardLight(indoorLight(k))) / day, actorFloorShare(k));
  };
  const room = (h: number) => LUMA(indoorCardLight(indoorLight(nightFactor(h)))) / day;
  it('keeps the actors near their day light while the room dims, at every hour of dusk and dawn', () => {
    const hours: number[] = [];
    for (let h = 17; h <= 21 + 1e-9; h += 0.05) hours.push(h);
    for (let h = 5; h <= 7 + 1e-9; h += 0.05) hours.push(h);
    for (const h of hours) {
      // ≥ 0.85 linear ≈ ≥ 0.93 in sRGB: margin over the 0.9 gate; never above the day
      expect(actor(h), `hour ${h.toFixed(2)}`).toBeGreaterThanOrEqual(0.85);
      expect(actor(h), `hour ${h.toFixed(2)}`).toBeLessThanOrEqual(1 + 1e-9);
    }
    // the numbers (linear): room dims to 0.42, the actors hold 0.89–1
    expect(room(19)).toBeCloseTo(0.707, 2); expect(actor(19)).toBeCloseTo(0.95, 2);            // dusk twins (hour 19)
    expect(room(21)).toBeCloseTo(0.42, 2); expect(actor(21)).toBeCloseTo(0.95, 2);             // night twins (hour 21)
    expect(room(18.5)).toBeCloseTo(0.912, 2); expect(actor(18.5)).toBeCloseTo(0.912, 2);       // early dusk: the room's own
    expect(room(6)).toBeCloseTo(0.891, 2); expect(actor(6)).toBeCloseTo(0.891, 2);             // late dawn
    expect(room(5.5)).toBeCloseTo(0.639, 2); expect(actor(5.5)).toBeCloseTo(0.95, 2);          // dawn
    // (the old floor, ACTOR_NIGHT_FLOOR × nightK, fell to the room's 0.707 at hour 19: 0.865 in sRGB, under the gate)
    expect(Math.max(room(19), ACTOR_NIGHT_FLOOR * nightFactor(19))).toBeLessThan(0.75);
  });
  it('leaves the day exactly as today: no floor at nightK 0, the full floor at night', () => {
    expect(actorFloorShare(0)).toBe(0);
    expect(actorFloorShare(1)).toBe(ACTOR_NIGHT_FLOOR);
    for (let k = 0; k < 1; k += 0.01) expect(actorFloorShare(k + 0.01)).toBeGreaterThanOrEqual(actorFloorShare(k));   // smooth, rising
    const c = indoorCardLight(INDOOR_DAY);
    const D = INDOOR_DAY;
    expect(c.r).toBe((D.sky.r * D.hemiI + D.sunColor.r * D.sunI * 0.75) * (1 / Math.PI));       // updateLighting's formula
  });
});
