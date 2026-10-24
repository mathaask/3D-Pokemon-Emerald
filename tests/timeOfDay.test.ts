import { describe, it, expect } from 'vitest';
import { timeOfDay, nightFactor } from '../src/render/overworld/timeOfDay';

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
