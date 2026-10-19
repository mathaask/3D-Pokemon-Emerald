import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rng, hashCell, toWorld, noise3, MeshBuilder } from '../src/render/kit/geom';

describe('geom', () => {
  it('rng is deterministic and in [0, 1)', () => {
    const a = rng(42), b = rng(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('hashCell separates neighbours', () => {
    expect(hashCell(3, 4)).toBe(hashCell(3, 4));
    expect(hashCell(3, 4)).not.toBe(hashCell(4, 3));
    expect(hashCell(3, 4)).not.toBe(hashCell(3, 4, 1));
  });
  it('toWorld un-projects (x, y, h) → (x, h, y + h)', () => {
    expect(toWorld(3, 5, 2).toArray()).toEqual([3, 2, 7]);
  });
  it('noise3 is bounded and continuous', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137, y = i * 0.071, z = i * 0.019;
      const n = noise3(x, y, z);
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - noise3(x + 1e-3, y, z))).toBeLessThan(0.02);
    }
  });
  it('MeshBuilder.quad faces the given normal whatever the corner order', () => {
    const mb = new MeshBuilder();
    mb.quad([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, 1], [1, 1, 1]); // clockwise seen from +Z
    const g = mb.build();
    const p = g.getAttribute('position');
    expect(p.count).toBe(6);
    const v = (k: number) => new THREE.Vector3().fromBufferAttribute(p, k);
    const n = v(1).sub(v(0)).cross(v(2).sub(v(0)));
    expect(n.z).toBeGreaterThan(0);
  });
});
