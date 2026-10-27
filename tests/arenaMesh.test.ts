import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { polarIndex, ringBands } from '../src/render/battle/parts/mesh';

/** Each triangle's face normal (b − a) × (c − a) for `idx` over the points `p`. */
const normals = (p: THREE.Vector3[], idx: number[]) => {
  const out: THREE.Vector3[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = p[idx[t]], b = p[idx[t + 1]], c = p[idx[t + 2]];
    out.push(new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)));
  }
  return out;
};
/** Angle of segment s of n (as every polar part lays its rings out: x = cos, z = sin). */
const ang = (s: number, n: number) => (s / n) * Math.PI * 2;

describe('arena mesh indexing (parts/mesh.ts)', () => {
  it('polarIndex: a fan from the centre and the bands between the rings, every triangle facing up, at its base', () => {
    const rings = 3, segs = 8, base = 5;
    const p = [...Array.from({ length: base }, () => new THREE.Vector3(99, 99, 99)), new THREE.Vector3()];
    for (let k = 1; k <= rings; k++) for (let s = 0; s < segs; s++) p.push(new THREE.Vector3(Math.cos(ang(s, segs)) * k, 0.1 * k, Math.sin(ang(s, segs)) * k));
    const idx = polarIndex(rings, segs, { base });
    expect(idx).toHaveLength((segs + (rings - 1) * segs * 2) * 3);
    expect(Math.min(...idx)).toBe(base);
    expect(Math.max(...idx)).toBe(base + rings * segs);
    for (const n of normals(p, idx)) expect(n.y).toBeGreaterThan(0);
    // (appended to `out`)
    const out = [1, 2, 3];
    expect(polarIndex(rings, segs, { base, out })).toBe(out);
    expect(out.slice(3)).toEqual(idx);
  });

  it('ringBands: a band whose rings run down faces out; flipped, one whose rings run up; stored by columns, the same triangles', () => {
    const rows = 4, segs = 12;
    const at = (k: number, s: number, up: boolean) => new THREE.Vector3(Math.cos(ang(s, segs)), up ? k : -k, Math.sin(ang(s, segs)));
    const byRows = (up: boolean) => Array.from({ length: rows * segs }, (_, i) => at(Math.floor(i / segs), i % segs, up));
    const outward = (p: THREE.Vector3[], idx: number[]) => normals(p, idx).every((n, t) => {
      const c = p[idx[t * 3]].clone().add(p[idx[t * 3 + 1]]).add(p[idx[t * 3 + 2]]);
      return n.x * c.x + n.z * c.z > 0;
    });
    expect(outward(byRows(false), ringBands(rows, segs))).toBe(true);
    expect(outward(byRows(true), ringBands(rows, segs))).toBe(false);
    expect(outward(byRows(true), ringBands(rows, segs, { flip: true }))).toBe(true);
    // (stored segment by segment: vertex (k, s) at s × rows + k)
    const byColumns = Array.from({ length: rows * segs }, (_, i) => at(i % rows, Math.floor(i / rows), false));
    const cols = ringBands(rows, segs, { columns: true });
    expect(outward(byColumns, cols)).toBe(true);
    const tri = (p: THREE.Vector3[], idx: number[]) => new Set(Array.from({ length: idx.length / 3 }, (_, t) =>
      [0, 1, 2].map((j) => p[idx[t * 3 + j]].toArray().map((v) => v.toFixed(6)).join(',')).join(' ')));
    expect(tri(byColumns, cols)).toEqual(tri(byRows(false), ringBands(rows, segs)));
  });
});
