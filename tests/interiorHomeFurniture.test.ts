// Home furniture geometry (Phase 4 Task 9, phase A): the pure builders behind furnitureHome.ts' generators, on plain
// pieces (footprints, colours, facing, seed) — no Task 6 types.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Soup } from '../src/render/kit/soup';
import {
  HOME_BUILDERS, HOME_KINDS, LOW_SEAT, homeColors, roundBox, blob, type HomeKind, type HomePiece, type HomeRect, type HomeSoups,
} from '../src/render/kit/interior/geom/homeFurniture';
import type { PartColors } from '../src/render/kit/interior/colors';
import type { Quality } from '../src/render/post';

/** The plan's real-world sizes (FURNITURE_SPEC, Task 6) for the kinds built here. */
const SPEC: Record<HomeKind, { height: number; depth: number }> = {
  bed: { height: 0.55, depth: 2.0 }, table: { height: 0.75, depth: 1.6 }, chair: { height: 0.9, depth: 0.6 },
  tv: { height: 1.1, depth: 0.5 }, bookshelf: { height: 2.1, depth: 0.45 }, plant: { height: 1.3, depth: 0.7 },
  fridge: { height: 1.9, depth: 0.5 }, sink: { height: 0.95, depth: 0.5 }, cabinet: { height: 1.0, depth: 0.5 },
  crate: { height: 0.8, depth: 0.8 }, trashCan: { height: 0.6, depth: 0.5 }, vase: { height: 0.6, depth: 0.5 },
};
/** Task 6's fitFurniture, free-standing: columns x0..x1, rows y0..y1 at floor h. */
const fit = (k: HomeKind, x0: number, x1: number, y0: number, y1: number, h = 0): HomeRect => {
  const z1 = y1 + 1 + h;
  return { x0, x1: x1 + 1, z0: z1 - Math.min(SPEC[k].depth, y1 - y0 + 1), z1, y: h, height: SPEC[k].height };
};
const COLORS: PartColors = { main: [0.26, 0.29, 0.42], second: [0.84, 0.81, 0.39], accent: [0.97, 0.55, 0.39], dark: [0.13, 0.15, 0.21] };
/** As the furniture helper's piece(): cells (2..3, 4..5) at floor 0. */
const piece = (kind: HomeKind, o: Partial<HomePiece> = {}): HomePiece => ({
  foot: fit(kind, 2, 3, 4, 5), cellFeet: [fit(kind, 2, 2, 4, 4), fit(kind, 3, 3, 4, 4), fit(kind, 2, 2, 5, 5), fit(kind, 3, 3, 5, 5)],
  facing: null, colors: COLORS, seed: 1234, ...o,
});
const soups = (): HomeSoups => ({ body: new Soup(), glass: new Soup(), glow: new Soup() });
const run = (kind: HomeKind, q: Quality = 'medium', o: Partial<HomePiece> = {}) => {
  const s = soups();
  HOME_BUILDERS[kind](piece(kind, o), s, q);
  return s;
};
const boxOf = (...ss: Soup[]) => {
  const b = new THREE.Box3();
  for (const s of ss) if (!s.empty) { const g = s.geometry(); g.computeBoundingBox(); b.union(g.boundingBox!); }
  return b;
};
const tris = (s: HomeSoups) => [s.body, s.glass, s.glow].reduce((n, x) => n + (x.empty ? 0 : x.geometry().getAttribute('position').count / 3), 0);
const hash = (s: HomeSoups) => {
  let h = 0;
  for (const x of [s.body, s.glass, s.glow]) {
    if (x.empty) continue;
    const g = x.geometry();
    for (const a of ['position', 'normal', 'color']) for (const v of g.getAttribute(a).array as Float32Array) h = (Math.imul(h, 31) + Math.round(v * 1e4)) | 0;
  }
  return h;
};
/** The xs of every vertex of `s` (rounded). */
const xs = (s: Soup) => [...(s.geometry().getAttribute('position').array as Float32Array)].filter((_, i) => i % 3 === 0);

describe('home furniture geometry', () => {
  it.each(HOME_KINDS)('%s stays inside its footprint at its height', (kind) => {
    const s = run(kind), p = piece(kind), f = p.foot, b = boxOf(s.body, s.glass, s.glow);
    expect(b.min.x).toBeGreaterThanOrEqual(f.x0 - 1e-3); expect(b.max.x).toBeLessThanOrEqual(f.x1 + 1e-3);
    expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-3); expect(b.max.z).toBeLessThanOrEqual(f.z1 + 1e-3);
    expect(b.min.y).toBeGreaterThanOrEqual(-1e-3);
    expect(b.max.y).toBeCloseTo(SPEC[kind].height, 2);
    expect(s.body.empty).toBe(false);
    expect(s.glass.empty).toBe(true);
    expect(s.glow.empty).toBe(kind !== 'tv');                        // only the TV's screen glows
  });

  it('stands on the floor it is given', () => {
    const f = fit('table', 2, 3, 4, 5, 1), s = soups();
    HOME_BUILDERS.table(piece('table', { foot: f, cellFeet: [] }), s, 'medium');
    const b = boxOf(s.body);
    expect(b.min.y).toBeCloseTo(1, 3); expect(b.max.y).toBeCloseTo(1.75, 2);
  });

  it('turns a chair to face its table, its back away from it', () => {
    const at = (facing: 'E' | 'W' | 'N' | 'S') => {
      const s = run('chair', 'medium', { facing });
      const g = s.body.geometry(), p = g.getAttribute('position');
      // the back: everything above the seat cushion
      const hi = new THREE.Box3();
      for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.55) hi.expandByPoint(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
      return { all: boxOf(s.body), hi };
    };
    const east = at('E'), west = at('W'), south = at('S');
    expect(east.all.equals(west.all)).toBe(false);
    const cx = (b: THREE.Box3) => (b.min.x + b.max.x) / 2;
    expect(cx(east.hi)).toBeLessThan(cx(east.all));                  // facing east: its back on the west
    expect(cx(west.hi)).toBeGreaterThan(cx(west.all));
    expect(south.hi.max.z).toBeLessThan((south.all.min.z + south.all.max.z) / 2 + 1e-6);  // facing south: back north
    expect(boxOf(run('chair', 'medium', { facing: null }).body).equals(south.all)).toBe(true);  // no table: faces south
  });

  it('makes a chair on walkable cells a low seat that still faces its table', () => {
    const low = (facing: 'E' | 'W') => {
      const p = piece('chair'), foot = { ...p.foot, height: 0.45 };
      const s = soups();
      HOME_BUILDERS.chair({ ...p, foot, cellFeet: p.cellFeet.map((c) => ({ ...c, height: 0.45 })), facing }, s, 'medium');
      return boxOf(s.body);
    };
    expect(LOW_SEAT).toBeGreaterThanOrEqual(0.45);
    expect(low('E').max.y).toBeLessThanOrEqual(0.45 + 1e-6);
    expect(low('E').max.y).toBeGreaterThan(0.4);
    expect(low('E').equals(low('W'))).toBe(false);
  });

  it('keeps a bed with a walkable head cell low enough to step onto', () => {
    const p = piece('bed', { foot: fit('bed', 2, 2, 4, 5), cellFeet: [{ ...fit('bed', 2, 2, 4, 4), height: 0.45 }, fit('bed', 2, 2, 5, 5)] });
    const s = soups();
    HOME_BUILDERS.bed(p, s, 'medium');
    expect(boxOf(s.body).max.y).toBeLessThanOrEqual(0.45 + 1e-6);
  });

  it('makes one item per column: stacked or side-by-side items never merge', () => {
    for (const kind of ['chair', 'plant', 'crate', 'vase', 'trashCan'] as const) {
      const x = xs(run(kind).body);
      expect(x.some((v) => v < 3), kind).toBe(true); expect(x.some((v) => v > 3), kind).toBe(true);
      expect(x.filter((v) => Math.abs(v - 3) < 0.02), kind).toEqual([]);   // a gap between the two columns
    }
  });

  it('sizes the bookcase to its footprint: width, height and depth', () => {
    const p = piece('bookshelf', { foot: { ...fit('bookshelf', 2, 4, 1, 1), z0: 1.59, z1: 2 } });
    const s = soups();
    HOME_BUILDERS.bookshelf(p, s, 'medium');
    const b = boxOf(s.body);
    expect(b.min.x).toBeCloseTo(2, 3); expect(b.max.x).toBeCloseTo(5, 3);
    expect(b.max.z).toBeCloseTo(2, 3); expect(b.min.z).toBeGreaterThanOrEqual(1.59 - 1e-6); expect(b.min.z).toBeLessThan(1.61);
    expect(b.max.y).toBeCloseTo(2.1, 3);
  });

  it('builds kitchens, tables and cabinets across their south row only', () => {
    // an L of cells: the north row x 3..4, the south row x 2..4: the counter spans the south row
    const f = fit('cabinet', 2, 4, 0, 1);
    const p = piece('cabinet', { foot: f, cellFeet: [fit('cabinet', 3, 3, 0, 0), fit('cabinet', 4, 4, 0, 0), fit('cabinet', 2, 2, 1, 1), fit('cabinet', 3, 3, 1, 1), fit('cabinet', 4, 4, 1, 1)] });
    const s = soups();
    HOME_BUILDERS.cabinet(p, s, 'medium');
    const b = boxOf(s.body);
    expect(b.min.x).toBeLessThan(2.1); expect(b.max.x).toBeGreaterThan(4.9);
    expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-6);
  });

  it('puts the TV screen in the glow soup, facing the room', () => {
    const s = run('tv'), g = s.glow.geometry(), n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getZ(i)).toBeCloseTo(1, 5);
    const b = boxOf(s.glow);
    expect(b.max.y).toBeLessThanOrEqual(1.1); expect(b.max.y - b.min.y).toBeGreaterThan(0.3);
  });

  it('is deterministic and scales with quality', () => {
    for (const kind of HOME_KINDS) {
      expect(hash(run(kind, 'medium')), kind).toBe(hash(run(kind, 'medium')));
      expect(tris(run(kind, 'low')), kind).toBeLessThanOrEqual(tris(run(kind, 'high')));
    }
    expect(tris(run('plant', 'low'))).toBeLessThan(tris(run('plant', 'high')));
    expect(hash(run('plant', 'medium', { seed: 1 }))).not.toBe(hash(run('plant', 'medium', { seed: 2 })));
  });
});

describe('home furniture shapes', () => {
  it('rounds a box inside its bounds, faces outwards', () => {
    const s = new Soup();
    roundBox(s, 0, 1, 0, 0.5, 0, 0.6, 0.08, [1, 1, 1], 2);
    const g = s.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.min.toArray().map((v) => +v.toFixed(5))).toEqual([0, 0, 0]);
    expect(g.boundingBox!.max.toArray().map((v) => +v.toFixed(5))).toEqual([1, 0.5, 0.6]);
    // every triangle's winding agrees with its normals (outwards)
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const v = (i: number) => new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    let bad = 0;
    for (let i = 0; i < p.count; i += 3) {
      const c = new THREE.Vector3().subVectors(v(i + 1), v(i)).cross(new THREE.Vector3().subVectors(v(i + 2), v(i)));
      if (c.lengthSq() < 1e-12) continue;
      const nn = new THREE.Vector3(n.getX(i) + n.getX(i + 1) + n.getX(i + 2), n.getY(i) + n.getY(i + 1) + n.getY(i + 2), n.getZ(i) + n.getZ(i + 1) + n.getZ(i + 2));
      if (c.dot(nn) < 0) bad++;
    }
    expect(bad).toBe(0);
  });
  it('makes a blob exactly its radii', () => {
    const s = new Soup();
    blob(s, [1, 2, 3], 0.3, 0.2, 0.25, [[0.2, 0.5, 0.2], [0.4, 0.8, 0.4]], 12);
    const g = s.geometry(); g.computeBoundingBox();
    expect(g.boundingBox!.min.x).toBeCloseTo(0.7, 5); expect(g.boundingBox!.max.y).toBeCloseTo(2.2, 5);
    expect(g.boundingBox!.max.z).toBeCloseTo(3.25, 5);
  });
});

describe('home furniture colours', () => {
  const pc = (main: number[], second: number[], accent: number[], dark: number[] = [0.1, 0.1, 0.1]): PartColors =>
    ({ main, second, accent, dark }) as PartColors;
  const hex = (h: string) => [0, 2, 4].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
  it('skips the outline colour and lays a cloth only where the art shows one', () => {
    // Brendan's 1F table: a pink cloth over wood; the lab desk: plain wood
    const brendan = homeColors('table', pc(hex('f7ceef'), hex('6b94c5'), hex('ad8c3a')));
    expect(brendan.cloth).not.toBeNull();
    const lab = homeColors('table', pc(hex('424252'), hex('fff77b'), hex('fff77b')));
    expect(lab.cloth).toBeNull();
    expect(lab.wood[2]).toBeLessThan(lab.wood[0]);                   // yellow wood, not the outline's blue-grey
  });
  it('gives a bed its blanket from the art and white linen', () => {
    const c = homeColors('bed', pc(hex('424a6b'), hex('a5a5ff'), hex('bdb531')));
    expect(c.blanket[2]).toBeGreaterThan(c.blanket[0]);              // lavender
    expect(Math.min(...c.linen)).toBeGreaterThan(0.8);
  });
  it('takes no red for wood, and gives the white-art beds and bookcases white (look review, Phase B)', () => {
    // the lab's bookcases: outline, white, red books → a white case, not red
    const lab = homeColors('bookshelf', pc(hex('424252'), hex('ffffff'), hex('d65242')));
    expect(Math.min(...lab.wood)).toBeGreaterThan(0.8);
    // Brendan's bed: white quilt, orange-wood frame → a pale quilt, the orange on the frame
    const bed = homeColors('bed', pc(hex('ffffff'), hex('52526b'), hex('e69421')));
    expect(Math.min(...bed.blanket)).toBeGreaterThan(0.7);
    expect(bed.wood[0] - bed.wood[2]).toBeGreaterThan(0.4);
  });
  it('keeps plants green when the art has no green, and every colour soft', () => {
    const c = homeColors('plant', pc(hex('424a6b'), hex('d6d6b5'), hex('bdb531')));
    expect(c.leaf[1]).toBeGreaterThan(c.leaf[0]); expect(c.leaf[1]).toBeGreaterThan(c.leaf[2]);
    for (const k of HOME_KINDS) {
      for (const v of Object.values(homeColors(k, COLORS))) if (v) for (const ch of v) { expect(ch).toBeGreaterThanOrEqual(0.04 - 1e-9); expect(ch).toBeLessThanOrEqual(1); }
    }
  });
});
