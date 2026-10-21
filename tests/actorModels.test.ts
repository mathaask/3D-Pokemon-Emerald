import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pokeBallGeo, boulderGeo, crackedRockGeo, cutTreeGeo, truckGeo, truckLogoGeo, berryPlantGeo, berryFruitGeo, berryFlowerGeo } from '../src/render/actors/models';

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
  it('grows with the berry stage and carries flowers / berries on the last two', () => {
    const top = (s: 1 | 2 | 3 | 4 | 5) => box(berryPlantGeo(s, 7).body).max.y;
    expect(top(1)).toBeLessThan(top(2));
    expect(top(2)).toBeLessThan(top(3));
    expect(top(3)).toBeLessThan(top(4));
    expect(top(5)).toBeGreaterThanOrEqual(top(4) - 0.05);
    for (const s of [1, 2, 3] as const) expect(berryPlantGeo(s, 7).anchors).toHaveLength(0);
    for (const s of [4, 5] as const) {
      const n = berryPlantGeo(s, 7).anchors.length;
      expect(n).toBeGreaterThanOrEqual(5); expect(n).toBeLessThanOrEqual(7);
    }
    const b = box(berryPlantGeo(5, 7).body); expect(b.max.x - b.min.x).toBeLessThanOrEqual(1.0);
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
  it('builds the berry plants, flowers and berries from the tint codes, standing on the ground, within their budgets', () => {
    const plants = ([1, 2, 3, 4, 5] as const).map((s) => berryPlantGeo(s, 0).body);
    for (const g of [...plants, berryFruitGeo(), berryFlowerGeo()]) {
      const col = g.getAttribute('color');
      for (let i = 0; i < col.count; i++) expect([0, 0.5, 0.85, 1].some((c) => Math.abs(col.getW(i) - c) < 0.01)).toBe(true);
    }
    // (the soil of the mounds: 0.85, moonlit at night; stage 1 is all soil, the flowers and berries have none)
    const codes = (g: THREE.BufferGeometry) => new Set(Array.from({ length: g.getAttribute('color').count }, (_, i) => +g.getAttribute('color').getW(i).toFixed(2)));
    expect([...codes(plants[0])]).toEqual([0.85]);
    for (const g of plants.slice(1)) expect(codes(g).has(0.85) && codes(g).has(0.5)).toBe(true);
    for (const g of [berryFruitGeo(), berryFlowerGeo()]) expect(codes(g).has(0.85)).toBe(false);
    for (const g of plants) {
      expect(box(g).min.y).toBeGreaterThan(-0.02);
      expect(box(g).max.x - box(g).min.x).toBeLessThanOrEqual(1.0);
      expect(box(g).max.z - box(g).min.z).toBeLessThanOrEqual(1.0);
      expect(tris(g)).toBeLessThanOrEqual(2500);
    }
    expect(box(plants[0]).max.y).toBeCloseTo(0.12, 1);     // the soil mound
    const fruit = box(berryFruitGeo()), flower = box(berryFlowerGeo());
    expect(fruit.max.x).toBeCloseTo(0.07, 3);              // r 0.07 round its centre (the anchor)
    expect(fruit.min.y).toBeLessThan(-0.06);
    expect(Math.max(flower.max.x, flower.max.z)).toBeCloseTo(0.09, 1);
    expect(flower.max.y - flower.min.y).toBeLessThan(0.05);   // a disc facing up
    // (a few px on screen, up to 7 a plant: sub-pixel triangles cost the GPU more than they show)
    expect(tris(berryFruitGeo()) + tris(berryFlowerGeo())).toBeLessThanOrEqual(500);
  });
  it('hangs the flowers and berries on the bush\'s crown, its normals pointing out, the same anchors for a seed', () => {
    for (const s of [4, 5] as const) {
      const p = berryPlantGeo(s, 3);
      expect(berryPlantGeo(s, 3)).toBe(p);                 // cached per (stage, seed)
      expect(p.normals).toHaveLength(p.anchors.length);
      p.anchors.forEach((a, i) => {
        expect(a.y).toBeGreaterThan(0.35);                 // on the crown, not the stems
        expect(p.normals[i].length()).toBeCloseTo(1, 5);
        expect(p.normals[i].dot(new THREE.Vector3(a.x, 0, a.z).normalize()) + p.normals[i].y).toBeGreaterThan(0);
      });
    }
    expect(berryPlantGeo(4, 3).body).toBe(berryPlantGeo(5, 3).body);   // (one bush: flowers or berries on it)
  });
  it("puts the far side's logo at the same place along the box as the near side's (mirrored, not turned)", () => {
    const p = truckLogoGeo().getAttribute('position');
    const near = [Infinity, -Infinity], far = [Infinity, -Infinity];
    for (let i = 0; i < p.count; i++) {
      const r = p.getZ(i) > 0 ? near : far;
      r[0] = Math.min(r[0], p.getX(i)); r[1] = Math.max(r[1], p.getX(i));
    }
    expect(far[0]).toBeCloseTo(near[0], 4);
    expect(far[1]).toBeCloseTo(near[1], 4);
  });
});
