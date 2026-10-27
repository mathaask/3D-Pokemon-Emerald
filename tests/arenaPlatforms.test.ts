import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { platformMeshes, PLATFORM_STYLE, type PlatformStyle } from '../src/render/battle/parts/platforms';
import { arenaPalette } from '../src/render/battle/palette';
import { PLATFORM_FOOTPRINT, GROUND_Y, WATER_Y } from '../src/render/battle/stage';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';

const f = PLATFORM_FOOTPRINT.player;
const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;
const KIND: Record<PlatformStyle, Parameters<typeof arenaPalette>[0]> = { earthGrass: 'grass', sandMound: 'sand', stoneSlab: 'gym',
  lilyPad: 'pond', rippleRing: 'water', caveRock: 'cave', seabedRock: 'underwater' };

describe('platforms', () => {
  it('give every kind a style', () => { for (const k of ARENA_KINDS) expect(PLATFORM_STYLE[k]).toBeDefined(); });
  for (const style of Object.keys(KIND) as PlatformStyle[]) {
    it(`${style}: the battler stands at y ≈ 0 on a footprint-sized top, within budget`, () => {
      const m = platformMeshes(style, f, 1, arenaPalette(KIND[style], null), KIND[style]);
      const surface = m.top ?? m.body ?? m.ripple!;
      const b = box(surface);
      expect(b.max.y).toBeGreaterThan(style === 'rippleRing' || style === 'lilyPad' ? WATER_Y - 0.01 : -0.02);
      expect(b.max.y).toBeLessThan(0.05);
      expect(b.max.x).toBeGreaterThanOrEqual(0.95 * f.rx); expect(b.max.x).toBeLessThanOrEqual(1.45 * f.rx);
      for (const g of [m.top, m.body, m.ripple]) if (g) expect(tris(g)).toBeLessThanOrEqual(6000);
      if (m.body && style !== 'lilyPad') expect(box(m.body).min.y).toBeLessThanOrEqual(GROUND_Y);
      expect(m.skirt === null).toBe(style !== 'earthGrass');
      expect(m.ripple === null).toBe(style !== 'rippleRing');
    });
  }
  it('cuts the lily pad\'s notch', () => {
    const g = platformMeshes('lilyPad', f, 1, arenaPalette('pond', null), 'pond').body!;
    const p = g.getAttribute('position');
    let inNotch = 0;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getX(i) / f.rx, -p.getZ(i) / f.rz), r = Math.hypot(p.getX(i) / f.rx, p.getZ(i) / f.rz);
      if (r > 0.3 && r < 0.95 && Math.abs(a) < THREE.MathUtils.degToRad(6)) inNotch++;
    }
    expect(inNotch).toBe(0);
  });
});
