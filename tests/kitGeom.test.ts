import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rng, hashCell, toWorld, noise2, noise3, MeshBuilder, QuadWriter, type V3 } from '../src/render/kit/geom';

/** Every triangle with area faces the same way as its stored normal. */
function facesItsNormals(g: THREE.BufferGeometry): number {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  const v = (k: number) => new THREE.Vector3().fromBufferAttribute(p, k);
  let checked = 0;
  for (let t = 0; t < p.count; t += 3) {
    const geo = v(t + 1).sub(v(t)).cross(v(t + 2).sub(v(t)));
    if (geo.length() < 1e-9) continue;
    expect(geo.dot(new THREE.Vector3().fromBufferAttribute(n, t))).toBeGreaterThan(0);
    checked++;
  }
  return checked;
}

// A triangle given as a quad whose first edge is zero (a === b), facing -X.
const TRI: [V3, V3, V3, V3] = [[0, 1, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]];

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
  it('MeshBuilder.quad faces the normal when two corners coincide', () => {
    for (const normal of [[-1, 0, 0], [1, 0, 0]] as V3[]) {
      const mb = new MeshBuilder();
      mb.quad(...TRI, normal, [1, 1, 1]);
      expect(facesItsNormals(mb.build())).toBe(1);
    }
  });
  it('QuadWriter faces the normal whatever the corner order, and when two corners coincide', () => {
    for (const normal of [[-1, 0, 0], [1, 0, 0]] as V3[]) {
      const w = new QuadWriter();
      w.quad(...TRI, normal, [1, 1, 1]);
      w.quad([0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0], [0, 0, normal[0]], [1, 1, 1]);
      w.box(0, 1, 0, 1, 0, 1, [1, 1, 1]);
      const g = w.geometry();
      expect(facesItsNormals(g)).toBe(1 + 2 + 12);
      expect(g.boundingSphere!.radius).toBeCloseTo(Math.sqrt(3) / 2, 6); // around the unit box
    }
  });
  it('noise2 is deterministic, bounded and continuous', () => {
    for (let i = 0; i < 200; i++) {
      const x = i * 0.137, y = i * 0.071;
      const n = noise2(x, y, 5);
      expect(n).toBe(noise2(x, y, 5));
      expect(Math.abs(n)).toBeLessThanOrEqual(1);
      expect(Math.abs(n - noise2(x + 1e-3, y, 5))).toBeLessThan(0.02);
    }
    expect(noise2(0.5, 0.5, 1)).not.toBe(noise2(0.5, 0.5, 2));
  });
});
