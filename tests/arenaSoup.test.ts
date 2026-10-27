import { describe, it, expect } from 'vitest';
import { Soup, lathe, lin } from '../src/render/battle/parts/soup';
import { pillarGeometry } from '../src/render/battle/parts/rooms';
import { toLinear, type RGB } from '../src/render/kit/palette';

describe("the special arenas' geometry writer (parts/soup.ts)", () => {
  const A: RGB = [1, 0, 0], B: RGB = [0, 1, 0], C: RGB = [0, 0, 1];
  const prof = [[1, 0], [1, 1], [0.5, 2]] as const;
  /** The colour of each vertex of a lathe of `prof` (4 sides), by its height. */
  const colours = (cols: Parameters<typeof lathe>[3]) => {
    const s = new Soup();
    lathe(s, [0, 0, 0], prof, cols, 4);
    const g = s.geometry(), p = g.getAttribute('position'), c = g.getAttribute('color');
    const byY = new Map<number, Set<string>>();
    for (let i = 0; i < p.count; i++) {
      const key = `${c.getX(i)},${c.getY(i)},${c.getZ(i)}`;
      if (!byY.has(p.getY(i))) byY.set(p.getY(i), new Set());
      byY.get(p.getY(i))!.add(key);
    }
    return { count: p.count, byY };
  };
  const k = (c: RGB) => c.join(',');

  it('colours a lathe per step, per point (a gradient), or per step with a pair (its start, its end)', () => {
    // per step: one colour on each step's rows
    const step = colours([A, B]);
    expect(step.count).toBe(2 * 4 * 6);
    expect([...step.byY.get(0)!]).toEqual([k(A)]);
    expect([...step.byY.get(2)!]).toEqual([k(B)]);
    expect(new Set(step.byY.get(1)!)).toEqual(new Set([k(A), k(B)]));
    // per point
    const point = colours([A, B, C]);
    expect([...point.byY.get(0)!]).toEqual([k(A)]);
    expect(new Set(point.byY.get(1)!)).toEqual(new Set([k(B)]));
    expect([...point.byY.get(2)!]).toEqual([k(C)]);
    // a pair: the first step a gradient A → B, the second plain C
    const pair = colours([[A, B], C]);
    expect([...pair.byY.get(0)!]).toEqual([k(A)]);
    expect(new Set(pair.byY.get(1)!)).toEqual(new Set([k(B), k(C)]));
    expect([...pair.byY.get(2)!]).toEqual([k(C)]);
  });

  it("builds the pillar's shaft darker at its foot (a pair step of the lathe)", () => {
    const col: RGB = [0.8, 0.7, 0.6], g = pillarGeometry(0.5, 9, col), p = g.getAttribute('position'), c = g.getAttribute('color');
    // the shaft runs from the base mouldings' top (plinth 0.3 + 0.38) to under the capital (9 − abacus 0.34 − 0.42): at its
    // foot (radius 0.5) 0.9 × the colour, at its top (0.93 × 0.5) the colour (linear): three corners of each of its 16 quads
    const top = lin(col), foot = top.map((x) => x * 0.9) as RGB;
    const at = (y: number, r: number, want: RGB) => {
      let n = 0;
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(p.getY(i) - y) > 1e-5 || Math.abs(Math.hypot(p.getX(i), p.getZ(i)) - r) > 1e-4) continue;
        if ([c.getX(i), c.getY(i), c.getZ(i)].every((x, j) => Math.abs(x - want[j]) < 1e-6)) n++;
      }
      return n;
    };
    expect(at(0.68, 0.5, foot)).toBe(3 * 16);
    expect(at(9 - 0.34 - 0.42, 0.93 * 0.5, top)).toBe(3 * 16);
    expect(lin([2, -1, 0.5])).toEqual(toLinear([1, 0, 0.5]));
  });
});
