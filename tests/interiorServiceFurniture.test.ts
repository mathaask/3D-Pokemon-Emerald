import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Soup, lin } from '../src/render/kit/soup';
import type { RGB } from '../src/render/kit/palette';
import type { PartColors } from '../src/render/kit/interior/colors';
import {
  BALL_RED, STAIRS_TOP, buildCounter, buildHealer, buildMartShelf, buildPc, buildStairsDown, buildStairsUp, counterRects,
  type Rect, type ServiceSoups, type Sized,
} from '../src/render/kit/interior/geom/serviceFurniture';

const COLORS: PartColors = { main: [0.9, 0.85, 0.8], second: [0.7, 0.75, 0.85], accent: [0.85, 0.3, 0.35], dark: [0.25, 0.22, 0.2] };
const soups = (): ServiceSoups => ({ tall: new Soup(), low: new Soup(), glow: new Soup(), glowLow: new Soup() });
/** Task 6's fitFurniture for one rectangle of cells (free-standing): x [x0, x1 + 1], z1 = y1 + 1 + h, z0 = z1 − min(depth, rows). */
const fit = (x0: number, x1: number, y0: number, y1: number, depth: number, height: number, h = 0): Sized => {
  const z1 = y1 + 1 + h;
  return { x0, x1: x1 + 1, z0: z1 - Math.min(depth, y1 - y0 + 1), z1, y: h, height };
};
const boxOf = (...ss: Soup[]): THREE.Box3 => {
  const b = new THREE.Box3();
  for (const s of ss) if (!s.empty) b.union(new THREE.Box3().setFromBufferAttribute(s.geometry().getAttribute('position') as THREE.BufferAttribute));
  return b;
};
const all = (o: ServiceSoups) => boxOf(o.tall, o.low, o.glow, o.glowLow);
const tris = (o: ServiceSoups) => [o.tall, o.low, o.glow, o.glowLow].reduce((n, s) => n + (s.empty ? 0 : s.geometry().getAttribute('position').count / 3), 0);
const hash = (o: ServiceSoups) => {
  let h = 0;
  for (const s of [o.tall, o.low, o.glow, o.glowLow]) {
    if (s.empty) continue;
    const a = s.geometry().getAttribute('position').array as Float32Array;
    for (let i = 0; i < a.length; i++) h = (Math.imul(h, 31) + Math.round(a[i] * 1e4)) | 0;
  }
  return h;
};
/** Triangles whose vertices are all `srgb` (linear, within 1e-3), grouped by shared vertex positions. */
const clusters = (s: Soup, srgb: RGB): number => {
  const g = s.geometry(), p = g.getAttribute('position'), c = g.getAttribute('color'), want = lin(srgb);
  const key = (i: number) => `${p.getX(i).toFixed(5)},${p.getY(i).toFixed(5)},${p.getZ(i).toFixed(5)}`;
  const is = (i: number) => Math.abs(c.getX(i) - want[0]) < 1e-3 && Math.abs(c.getY(i) - want[1]) < 1e-3 && Math.abs(c.getZ(i) - want[2]) < 1e-3;
  const parent = new Map<string, string>();
  const find = (k: string): string => { while (parent.get(k) !== k) k = parent.get(k)!; return k; };
  for (let t = 0; t < p.count; t += 3) {
    if (!is(t) || !is(t + 1) || !is(t + 2)) continue;
    const ks = [key(t), key(t + 1), key(t + 2)];
    for (const k of ks) if (!parent.has(k)) parent.set(k, k);
    for (const k of ks.slice(1)) parent.set(find(k), find(ks[0]));
  }
  return new Set([...parent.keys()].map(find)).size;
};
const inside = (b: THREE.Box3, f: Rect, onFloor = true) => {
  expect(b.min.x).toBeGreaterThanOrEqual(f.x0 - 1e-3); expect(b.max.x).toBeLessThanOrEqual(f.x1 + 1e-3);
  expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-3); expect(b.max.z).toBeLessThanOrEqual(f.z1 + 1e-3);
  if (onFloor) expect(b.min.y).toBeGreaterThanOrEqual(f.y - 1e-3);
};
const cellsOf = (x0: number, x1: number, y0: number, y1: number) => {
  const xy: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) xy.push([x, y]);
  return xy;
};

describe('service furniture geometry', () => {
  it('builds a computer: low, inside its footprint, 1.2 tall, its screen in glowLow', () => {
    const f = fit(2, 3, 4, 5, 0.6, 1.2), o = soups();
    buildPc(o, f, COLORS, 'medium');
    inside(all(o), f); expect(all(o).max.y).toBeCloseTo(1.2, 3);
    expect(o.tall.empty && o.glow.empty).toBe(true); expect(o.glowLow.empty).toBe(false);
  });

  it('gives the healing machine six cradles and a lit panel, tall, inside its footprint', () => {
    const f = fit(2, 3, 4, 5, 0.8, 1.3), o = soups();
    buildHealer(o, f, COLORS, 'medium');
    inside(all(o), f); expect(all(o).max.y).toBeCloseTo(1.3, 3);
    expect(o.low.empty && o.glowLow.empty).toBe(true); expect(o.glow.empty).toBe(false);
    expect(clusters(o.tall, BALL_RED)).toBe(6);
  });

  it.each([['counter', 1.0, false], ['pcCounter', 1.05, true]] as const)('builds a %s: low, inside its footprint, at its height', (_, height, band) => {
    const xy = cellsOf(2, 3, 4, 5), feet = xy.map(([x, y]) => fit(x, x, y, y, 0.9, height));
    const s = new Soup();
    buildCounter(s, counterRects(xy, feet), height, COLORS, 'medium', band);
    const b = boxOf(s); inside(b, fit(2, 3, 4, 5, 0.9, height)); expect(b.max.y).toBeCloseTo(height, 3);
  });

  it('cuts a counter into rectangles cell by cell, an L arm reaching its bar', () => {
    const xy: [number, number][] = [[2, 4], [3, 4], [3, 5]], feet = xy.map(([x, y]) => fit(x, x, y, y, 0.9, 1.05));
    const rs = counterRects(xy, feet);
    expect(rs.map((r) => [r.x0, r.x1, +r.z0.toFixed(3), r.z1])).toEqual([[2, 4, 4.1, 5], [3, 4, 5, 6]]);
    expect(rs[0].open).toEqual({ n: true, e: true, s: false, w: true });
    expect(rs[1].open).toEqual({ n: false, e: true, s: true, w: true });
    const sq = counterRects(cellsOf(2, 3, 4, 5), cellsOf(2, 3, 4, 5).map(([x, y]) => fit(x, x, y, y, 0.9, 1)));
    expect(sq).toHaveLength(1); expect(sq[0]).toMatchObject({ x0: 2, x1: 4, z1: 6 }); expect(sq[0].z0).toBeCloseTo(5.1, 6);
    const side = counterRects([[2, 4], [3, 4]], [fit(2, 2, 4, 4, 0.9, 1), fit(3, 3, 4, 4, 0.9, 1)]);
    expect(side).toHaveLength(1);
    // the nurse's U against the wall (z 1.525): the west arm runs from the wall down to the bar; a walkable cell caps it
    const U: [number, number][] = [[4, 1], [4, 2], [4, 3], [5, 3], [6, 3]];
    const wall = (x: number, y: number) => { const f = fit(x, x, y, y, 0.9, 1.05); return { ...f, z0: Math.max(f.z0, 1.525) }; };
    const uf = U.map(([x, y]) => wall(x, y)); uf[1] = { ...uf[1], height: 0.45 };
    const ur = counterRects(U, uf);
    expect(ur.map((r) => [r.x0, r.x1, r.z0, r.z1, r.height])).toEqual([[4, 5, 1.525, 3, 0.45], [4, 7, 3, 4, 1.05]]);
  });

  it('follows an L-shaped counter cell by cell, never over the walkable cell inside the L', () => {
    const xy: [number, number][] = [[2, 4], [3, 4], [3, 5]], feet = xy.map(([x, y]) => fit(x, x, y, y, 0.9, 1.05));
    const s = new Soup();
    buildCounter(s, counterRects(xy, feet), 1.05, COLORS, 'medium', true);
    const p = s.geometry().getAttribute('position');
    let joined = false;
    for (let i = 0; i < p.count; i++) {
      expect(p.getX(i) < 3 - 1e-3 && p.getZ(i) > 5 + 1e-3).toBe(false);          // nothing over (2, 5)
      if (p.getX(i) > 3 && Math.abs(p.getZ(i) - 5) < 1e-6) joined = true;          // the arm meets the bar
    }
    expect(joined).toBe(true);
  });

  it('builds a Mart gondola: tall, inside its footprint, 1.6 tall, seeded goods, more sides at higher quality', () => {
    const f = fit(2, 3, 4, 5, 1.4, 1.6), run = (seed: number, q: 'low' | 'medium' | 'high' = 'medium') => {
      const o = soups(); buildMartShelf(o, f, COLORS, seed, q); return o;
    };
    const o = run(7);
    inside(all(o), f); expect(all(o).max.y).toBeCloseTo(1.6, 3); expect(o.low.empty).toBe(true);
    expect(hash(run(7))).toBe(hash(o)); expect(hash(run(8))).not.toBe(hash(o));
    expect(tris(run(7, 'low'))).toBeLessThan(tris(run(7, 'high')));
    // a wall unit (one-sided) has half the shelves of a gondola on the same footprint
    const wf = { ...f, z0: f.z1 - 0.41 }, one = soups(), two = soups();
    buildMartShelf(one, wf, COLORS, 7, 'medium', true); buildMartShelf(two, wf, COLORS, 7, 'medium');
    inside(all(one), wf); expect(tris(one)).toBeLessThan(tris(two));
    // a gondola deeper than wide runs along z
    const g = fit(5, 5, 2, 4, 1.4, 1.6), d = soups(); buildMartShelf(d, { ...g, z0: g.z1 - 2.5 }, COLORS, 3, 'medium');
    inside(all(d), { ...g, z0: g.z1 - 2.5 });
  });

  it('climbs the stairs into the wall and sinks the stairwell under the floor', () => {
    const f = fit(2, 3, 4, 5, 1, STAIRS_TOP), up = soups();
    buildStairsUp(up, f, 'N', 'W', COLORS, 'medium');
    const b = all(up); inside(b, f); expect(b.max.y).toBeCloseTo(1.6, 1); expect(up.low.empty).toBe(true);
    // the flight rises north: its north half's steps stand higher than its south half's (the rail on the west aside)
    const p = up.tall.geometry().getAttribute('position');
    let north = 0, south = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) < 2.2) continue;
      if (p.getZ(i) < 5.5) north = Math.max(north, p.getY(i)); else south = Math.max(south, p.getY(i));
    }
    expect(north).toBeGreaterThan(south + 0.5);
    const r: Rect = { x0: 2, x1: 4, z0: 4, z1: 6, y: 0 }, down = soups();
    buildStairsDown(down, r, 'N', COLORS, 'medium');
    const d = all(down); expect(d.min.y).toBeLessThan(-0.5); expect(d.min.y).toBeCloseTo(-1.7, 3); inside(d, r, false);
    expect(d.max.y).toBeGreaterThan(0.8);                                                  // the rail round the hole
    expect(down.tall.empty).toBe(true);
  });

  it('turns the stairs with their direction', () => {
    const f = fit(2, 3, 4, 5, 2, STAIRS_TOP), E = soups(), W = soups();
    buildStairsUp(E, f, 'E', null, COLORS, 'low'); buildStairsUp(W, f, 'W', null, COLORS, 'low');
    inside(all(E), f); inside(all(W), f); expect(hash(E)).not.toBe(hash(W));
  });
});
