// Furniture generator test helpers (Phase 4 Task 6; shared by Tasks 9 and 10): a test piece, empty soups, their bounds,
// a run of one generator, a hash, triangle and colour-cluster counts.
import * as THREE from 'three';
import { fitFurniture, newFurnitureOut, type FurnitureGenerator, type FurnitureOut, type FurniturePiece } from '../../src/render/kit/interior/furniture';
import type { FurnitureKind } from '../../src/render/kit/tables/building';
import type { PartColors } from '../../src/render/kit/interior/colors';
import { lin, type Soup } from '../../src/render/kit/soup';
import type { RGB } from '../../src/render/kit/palette';
import type { Quality } from '../../src/render/post';

/** The test piece's colours (sRGB). */
export const TEST_COLORS: PartColors = { main: [0.8, 0.6, 0.4], second: [0.5, 0.4, 0.3], accent: [0.2, 0.5, 0.8], dark: [0.15, 0.12, 0.1] };

const SOUPS: readonly (keyof FurnitureOut)[] = ['tall', 'low', 'glow', 'glowLow'];

/** A 2 × 2 piece of `kind` on cells (2..3, 4..5) at floor 0, free-standing: foot = fitFurniture(kind, 2, 3, 4, 5, 0,
 *  −Infinity), cellFeet its four cells, TEST_COLORS, seed 1, no facing; `overrides` replace any field. */
export function piece(kind: FurnitureKind, overrides: Partial<FurniturePiece> = {}): FurniturePiece {
  const xy: [number, number][] = [[2, 4], [3, 4], [2, 5], [3, 5]];
  return {
    kind, cells: [0, 1, 2, 3], xy, floorY: 0,
    foot: fitFurniture(kind, 2, 3, 4, 5, 0, -Infinity),
    cellFeet: xy.map(([x, y]) => fitFurniture(kind, x, x, y, y, 0, -Infinity)),
    facing: null, colors: TEST_COLORS, seed: 1,
    ...overrides,
  };
}

/** Four empty soups. */
export const newOut = (): FurnitureOut => newFurnitureOut();

/** The bounding box of all four soups (empty: an empty box). */
export function boxOf(out: FurnitureOut): THREE.Box3 {
  const b = new THREE.Box3();
  for (const k of SOUPS) if (!out[k].empty) b.expandByObject(new THREE.Mesh(out[k].geometry()));
  return b;
}

/** A fresh newOut() filled by generators[kind](piece(kind, overrides), out, q). */
export function run(generators: Partial<Record<FurnitureKind, FurnitureGenerator>>, kind: FurnitureKind, q: Quality = 'medium',
  overrides?: Partial<FurniturePiece>): FurnitureOut {
  const gen = generators[kind];
  if (!gen) throw new Error(`no generator for ${kind}`);
  const out = newOut();
  gen(piece(kind, overrides), out, q);
  return out;
}

/** FNV-1a over every soup's attribute bytes, in a fixed order (soup, attribute). */
export function hashOut(out: FurnitureOut): string {
  let h = 0x811c9dc5;
  for (const k of SOUPS) {
    h = Math.imul(h ^ 0x7c, 0x01000193);
    if (out[k].empty) continue;
    const g = out[k].geometry();
    for (const name of ['position', 'normal', 'color']) {
      const bytes = new Uint8Array((g.getAttribute(name).array as Float32Array).buffer);
      for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
    }
  }
  return (h >>> 0).toString(36);
}

/** Triangles in all four soups. */
export function tris(out: FurnitureOut): number {
  let n = 0;
  for (const k of SOUPS) if (!out[k].empty) n += out[k].geometry().getAttribute('position').count / 3;
  return n;
}

/** Clusters of `soup`'s triangles coloured `srgb` (every vertex's colour equals lin(srgb) within 1e-3): triangles that
 *  share a vertex position (to 1e-4) are one cluster. */
export function countClusters(soup: Soup, srgb: RGB): number {
  if (soup.empty) return 0;
  const g = soup.geometry();
  const p = g.getAttribute('position'), c = g.getAttribute('color');
  const want = lin(srgb);
  const match = (v: number) => Math.abs(c.getX(v) - want[0]) < 1e-3 && Math.abs(c.getY(v) - want[1]) < 1e-3 && Math.abs(c.getZ(v) - want[2]) < 1e-3;
  const key = (v: number) => `${Math.round(p.getX(v) * 1e4)},${Math.round(p.getY(v) * 1e4)},${Math.round(p.getZ(v) * 1e4)}`;
  const tris: number[] = [];
  for (let t = 0; t < p.count / 3; t++) if (match(3 * t) && match(3 * t + 1) && match(3 * t + 2)) tris.push(t);
  const parent = tris.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const owner = new Map<string, number>();
  tris.forEach((t, k) => {
    for (let v = 3 * t; v < 3 * t + 3; v++) {
      const o = owner.get(key(v));
      if (o === undefined) owner.set(key(v), k);
      else parent[find(k)] = find(o);
    }
  });
  return new Set(tris.map((_, k) => find(k))).size;
}
