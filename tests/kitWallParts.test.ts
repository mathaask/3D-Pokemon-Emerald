import { describe, it, expect } from 'vitest';
import { wallPath, shellProfile, shellPalette, maxProfileDepth, SHELL, SHELF, addWindow, addShelf, wallFrameAt, WINDOW } from '../src/render/kit/interior/wallParts';
import { Soup } from '../src/render/kit/soup';
import * as THREE from 'three';

const C = shellPalette({ base: [0.4, 0.3, 0.2], wainscot: [0.7, 0.55, 0.4], panel: [0.72, 0.57, 0.42], trim: [1, 1, 1], wall: [0.9, 0.88, 0.8] });
/** Some vertex of `g` lies at (x, *, z). */
const hasXZ = (g: THREE.BufferGeometry, x: number, z: number) => {
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < 1e-5 && Math.abs(p.getZ(i) - z) < 1e-5) return true;
  return false;
};
/** Some vertex of `g` lies at x with a normal of x-component `nx` (a square cap face). */
const hasCap = (g: THREE.BufferGeometry, x: number, nx: number) => {
  const p = g.getAttribute('position'), n = g.getAttribute('normal');
  for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - x) < 1e-5 && Math.abs(n.getX(i) - nx) < 1e-3) return true;
  return false;
};
describe('wall parts', () => {
  it('builds a closed rectangular room with mitred corners and no caps', () => {
    const s = new Soup(), T = SHELL.thick;
    wallPath(s, [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]], [[0, 1], [-1, 0], [0, -1], [1, 0]], 0, shellProfile(2.6, SHELL.wainscot), C, false);
    const g = s.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(-T, 5); expect(g.boundingBox!.max.x).toBeCloseTo(6 + T, 5);
    expect(g.boundingBox!.max.y).toBeCloseTo(2.6, 5);
    // the closing corner (first point = last) is mitred like the others: outer corner at (−T, −T), no square end at (−T, 0) / (0, −T)
    expect(hasXZ(g, -T, -T)).toBe(true); expect(hasXZ(g, 6 + T, 4 + T)).toBe(true);
    expect(hasXZ(g, -T, 0)).toBe(false); expect(hasXZ(g, 0, -T)).toBe(false);
  });
  it('mitres an open end against the wall it meets, and takes the thickness', () => {
    const s = new Soup(), t = 0.3, prof = shellProfile(2.6, SHELL.wainscot, t);
    wallPath(s, [[0, 0], [6, 0]], [[0, 1]], 0, prof, C, true, [[1, 0], null]);  // meets a west wall (inward +x) at x = 0
    const g = s.geometry(); g.computeBoundingBox();
    expect(hasXZ(g, -t, -t)).toBe(true); expect(hasXZ(g, 0, -t)).toBe(false);     // mitred start, square end at x = 6
    expect(hasXZ(g, 6, -t)).toBe(true);
    expect(g.boundingBox!.max.z).toBeCloseTo(maxProfileDepth(prof), 5);           // the crown: 0.16 into the room
  });
  it('caps an open wall at both ends', () => {
    const a = new Soup(), b = new Soup(), prof = shellProfile(2.6, SHELL.wainscot);
    wallPath(a, [[0, 0], [5, 0]], [[0, 1]], 0, prof, C, false);
    wallPath(b, [[0, 0], [5, 0]], [[0, 1]], 0, prof, C, true);
    expect(b.geometry().getAttribute('position').count).toBeGreaterThan(a.geometry().getAttribute('position').count);
    // a square cap face at each end: −x normals at x = 0, +x normals at x = 5 (none without caps)
    expect(hasCap(b.geometry(), 0, -1)).toBe(true); expect(hasCap(b.geometry(), 5, 1)).toBe(true);
    expect(hasCap(a.geometry(), 0, -1)).toBe(false); expect(hasCap(a.geometry(), 5, 1)).toBe(false);
  });
  it('ignores caps on a closed path', () => {
    const a = new Soup(), b = new Soup(), prof = shellProfile(2.6, SHELL.wainscot);
    const path: [number, number][] = [[0, 0], [6, 0], [6, 4], [0, 4], [0, 0]], inward: [number, number][] = [[0, 1], [-1, 0], [0, -1], [1, 0]];
    wallPath(a, path, inward, 0, prof, C, false);
    wallPath(b, path, inward, 0, prof, C, true);
    expect(b.geometry().getAttribute('position').count).toBe(a.geometry().getAttribute('position').count);
  });
  it('throws on a corner between opposite normals (a U-turn, or an end meeting its own wall reversed)', () => {
    const prof = shellProfile(2.6, SHELL.wainscot);
    expect(() => wallPath(new Soup(), [[0, 0], [6, 0]], [[0, 1]], 0, prof, C, true, [[0, -1], null])).toThrow(/opposite/);
  });
  it('sizes a window by its argument and keeps the battle default', () => {
    const body = new Soup(), glass = new Soup(), F = wallFrameAt([0, 0, 0], [1, 0, 0], [0, 0, 1], [-5, 5]);
    addWindow(body, glass, F, 0, [1, 1, 1], { ...WINDOW, width: 1.2 });
    const g = glass.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(1.2, 5);
    const glass2 = new Soup();
    addWindow(new Soup(), glass2, F, 0, [1, 1, 1]);
    const g2 = glass2.geometry(); g2.computeBoundingBox();
    expect(WINDOW.width).toBe(2.3); expect(g2.boundingBox!.max.x - g2.boundingBox!.min.x).toBeCloseTo(2.3, 5);
  });
  it('sizes a bookcase to a footprint depth and height (battle default SHELF.depth)', () => {
    const body = new Soup(), F = wallFrameAt([0, 0, 0], [1, 0, 0], [0, 0, 1], [-5, 5]);
    addShelf(body, F, 0, [0.5, 0.35, 0.2], 1, 1.0, 2.1, 0.45);
    const g = body.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.max.z).toBeLessThanOrEqual(0.45 + 1e-6); expect(g.boundingBox!.max.y).toBeCloseTo(2.1, 5);
    expect(SHELF.depth).toBe(0.58);
  });
});
