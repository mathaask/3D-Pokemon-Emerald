import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pokeBallGeo, boulderGeo, crackedRockGeo, cutTreeGeo, truckGeo, truckLogoGeo } from '../src/render/actors/models';

const box = (g: THREE.BufferGeometry) => { g.computeBoundingBox(); return g.boundingBox!; };
const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.getAttribute('position').count) / 3;

describe('object model geometry', () => {
  it('has the agreed sizes and stands on y = 0', () => {
    const b = box(pokeBallGeo());
    expect(b.min.y).toBeCloseTo(0, 2); expect(b.max.y).toBeCloseTo(0.54, 1); expect(b.max.x).toBeCloseTo(0.27, 1);
    const r = box(boulderGeo(1)); expect(r.max.x - r.min.x).toBeLessThanOrEqual(1.0); expect(r.min.y).toBeGreaterThanOrEqual(-0.02);
    const c = box(crackedRockGeo(1)); expect(c.max.y).toBeLessThan(0.75);
    expect(box(cutTreeGeo(1)).max.y).toBeGreaterThan(0.9);
    const t = box(truckGeo()); expect(t.max.x - t.min.x).toBeCloseTo(3.0, 0); expect(t.max.y).toBeLessThan(2.1);
  });
  it('uses only the tint codes 0, 0.5 and 1 in the colour alpha', () => {
    for (const g of [pokeBallGeo(), boulderGeo(1), crackedRockGeo(1), truckGeo()]) {
      const col = g.getAttribute('color');
      expect(col.itemSize).toBe(4);
      for (let i = 0; i < col.count; i++) expect([0, 0.5, 1].some((c) => Math.abs(col.getW(i) - c) < 0.01)).toBe(true);
    }
  });
  it('stays within its triangle budget', () => {
    expect(tris(pokeBallGeo())).toBeLessThanOrEqual(2000);
    expect(tris(boulderGeo(1))).toBeLessThanOrEqual(1500);
    expect(tris(crackedRockGeo(1))).toBeLessThanOrEqual(1500);
    expect(tris(cutTreeGeo(1))).toBeLessThanOrEqual(3000);
    expect(tris(truckGeo())).toBeLessThanOrEqual(2500);
  });
  it('points the boulder normals outwards', () => {
    const g = boulderGeo(3), p = g.getAttribute('position'), n = g.getAttribute('normal');
    const c = box(g).getCenter(new THREE.Vector3());
    let out = 0;
    for (let i = 0; i < p.count; i++)
      if ((p.getX(i) - c.x) * n.getX(i) + (p.getY(i) - c.y) * n.getY(i) + (p.getZ(i) - c.z) * n.getZ(i) > 0) out++;
    expect(out / p.count).toBeGreaterThan(0.95);
  });

  // ---- beyond the brief ----
  it("uses only the tint codes in the truck logo too, and keeps the Cut tree's crown (1) and dark band (< 0.5) apart", () => {
    const col = truckLogoGeo().getAttribute('color');
    for (let i = 0; i < col.count; i++) expect([0, 0.5, 1].some((c) => Math.abs(col.getW(i) - c) < 0.01)).toBe(true);
    const tree = cutTreeGeo(1).getAttribute('color'), a = new Set<number>();
    for (let i = 0; i < tree.count; i++) a.add(Math.round(tree.getW(i) * 100) / 100);
    expect(a.has(1)).toBe(true);
    expect([...a].some((w) => w < 0.5)).toBe(true);
  });
});
