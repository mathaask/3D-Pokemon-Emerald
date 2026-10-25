import { describe, it, expect } from 'vitest';
import { scatter, stageKeepOut } from '../src/render/battle/parts/scatter';
import { STAGE } from '../src/render/battle/stage';

describe('scatter', () => {
  const ko = stageKeepOut(STAGE);
  const o = { centre: { x: STAGE.centre.x, z: STAGE.centre.z }, r0: 3, r1: 20, count: 200, minGap: 1, keepOut: ko.ellipses };
  it('is deterministic, inside its annulus, spaced, and outside the keep-outs', () => {
    const a = scatter(7, o), b = scatter(7, o);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(100);
    for (const p of a) {
      const r = Math.hypot(p.x - o.centre.x, p.z - o.centre.z);
      expect(r).toBeGreaterThanOrEqual(3); expect(r).toBeLessThanOrEqual(20);
      for (const e of ko.ellipses) expect(((p.x - e.x) / e.rx) ** 2 + ((p.z - e.z) / e.rz) ** 2).toBeGreaterThanOrEqual(1);
    }
    for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++)
      expect(Math.hypot(a[i].x - a[j].x, a[i].z - a[j].z)).toBeGreaterThanOrEqual(1 - 1e-9);
  });
  it('keeps tall things off the camera\'s side of the stage', () => {
    expect(ko.tallOk(STAGE.centre.x, STAGE.centre.z - 15)).toBe(true);
    expect(ko.tallOk(STAGE.centre.x + 2, STAGE.centre.z - 5)).toBe(false);   // too near
    expect(ko.tallOk(STAGE.centre.x + 8, STAGE.centre.z + 7)).toBe(false);   // where the camera swings at yaw 0.9
  });
});
