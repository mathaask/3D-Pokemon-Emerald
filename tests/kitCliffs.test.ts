import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { cliffFamily, isRocky, setRockIds, type CliffPlacement, type CliffRun } from '../src/render/kit/cliffs';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS, type GridEvents } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { analyze, type MapAnalysis } from '../src/render/overworld/analyze';
import { fakeInfo } from './helpers/fakeMap';
import { MB } from '../src/game/behaviors';

// A plateau (rows 0-1) above a two-row rock face (rows 2-3) above lowland (rows 4-5).
function plateau() {
  const info = fakeInfo();
  // metatile 2 (face) = brown rock pixels
  info.both.fill((10 << 10) | (14 << 5) | 22, 2 * 256, 3 * 256);
  const rows = ['....', '....', '####', '####', '....', '....'];
  const w = 4, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = ch === '#' ? 2 | 0x0400 : 1 | 0x3000; }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: false, indoor: false, underground: false, underwater: false, margin: 0 });
}

describe('cliff extract', () => {
  it('turns a rock face between two levels into cliff runs', () => {
    const a = plateau();
    const claims = new Claims(a.N);
    const p = cliffFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    expect(p.runs).toHaveLength(4);
    expect(p.runs[0].topH).toBeGreaterThan(p.runs[0].hB);
    for (let x = 0; x < 4; x++) {
      expect(claims.has(a.idx(x, 2), CLAIM_OBJECT)).toBe(true);
      expect(claims.has(a.idx(x, 3), CLAIM_SURFACE)).toBe(true);
    }
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);
const ROCK = px(22, 14, 10), ROCK2 = px(16, 10, 8), ASH = px(21, 21, 17), LEAF = px(10, 22, 8), NAVY = px(8, 9, 13);

/**
 * Synthetic outdoor map. Cells: '.' lowland (metatile 1, elevation 1), 'P' plateau (metatile 1,
 * elevation 3), '#' rock (metatile 2), 'r' darker rock (metatile 3), 'C' tree crown (4), 'k'
 * trunk on ash (5), 's' sign post (6), 'v' ledge jumping south (7), 'T' a tree (8). `paint`
 * colours the tiles.
 */
function map(rows: string[], paint: (info: ReturnType<typeof fakeInfo>) => void = () => {},
  opts: { indoor?: boolean; underwater?: boolean; general?: boolean } = {}): MapAnalysis {
  const info = fakeInfo();
  const fill = (m: number, c: number, n = 256) => { info.both.fill(c, m * 256, m * 256 + n); info.bottom.fill(c, m * 256, m * 256 + n); };
  fill(2, ROCK);
  fill(3, ROCK2);
  fill(4, LEAF); info.green[4] = 0.4; // foliage, but below the analysis' tree threshold (Route 113's ash trees)
  fill(5, ASH); fill(5, ROCK, 40); // a trunk: mostly the ash ground around it
  fill(6, ROCK);
  info.attributes[7] = MB.JUMP_SOUTH;
  fill(8, LEAF); info.green[8] = 0.7;
  paint(info);
  const code: Record<string, number> = { '.': 1 | 0x1000, P: 1 | 0x3000, '#': 2 | 0x0400, r: 3 | 0x0400, C: 4 | 0x0400, k: 5 | 0x0400, s: 6 | 0x0400, v: 7 | 0x1000, T: 8 | 0x0400 };
  const w = rows[0].length, h = rows.length;
  const cells = new Uint16Array(w * h);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { cells[y * w + x] = code[ch]; }));
  return analyze({ width: w, height: h, cells, border: [1, 1, 1, 1], borderW: 2, borderH: 2, borderPhase: 0 },
    { info, generalPrimary: opts.general ?? false, indoor: opts.indoor ?? false, underground: false, underwater: opts.underwater ?? false, margin: 0 });
}

const extract = (a: MapAnalysis, events: GridEvents = NO_EVENTS) => {
  const claims = new Claims(a.N);
  return { claims, p: cliffFamily.extract({ a, events, quality: 'medium' }, claims) };
};

describe('isRocky', () => {
  const tile = (c: number, green = 0) => {
    const a = map(['..']);
    a.info.both.fill(c, 9 * 256, 10 * 256);
    a.info.green[9] = green;
    return isRocky(a, 9);
  };
  it('takes brown rock and the dark muted shadow side of a rock', () => {
    expect(tile(ROCK)).toBe(true);
    expect(tile(px(12, 8, 10))).toBe(true); // Route 113's mauve rock shade
  });
  it('rejects a navy window, foliage and grass', () => {
    expect(tile(NAVY)).toBe(false);
    expect(tile(ROCK, 0.25)).toBe(false); // an ash-covered tree crown
    expect(tile(px(14, 24, 20))).toBe(false);
  });
});

describe('cliff rules', () => {
  it('leaves a block mass standing on a door to the legacy art (an undetected building)', () => {
    const rows = ['......', '.####.', '.####.', '.####.', '......', '......'];
    expect(extract(map(rows)).p.runs.length).toBe(4); // as a rock mass without the door
    const door: GridEvents = { warps: [{ x: 2, y: 4, dest: 'Somewhere' }], signs: [] };
    const { p, claims } = extract(map(rows), door);
    expect(p.runs).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('does not take a tree line whose trunk row is the colour of the ground', () => {
    const ash = (info: ReturnType<typeof fakeInfo>) => { info.both.fill(ASH, 256, 512); info.bottom.fill(ASH, 256, 512); };
    const { p } = extract(map(['PPPP', 'PPPP', 'CCCC', 'kkkk', '....', '....'], ash));
    expect(p.runs).toEqual([]);
    // the same rows in rock are a cliff
    expect(extract(map(['PPPP', 'PPPP', '####', '####', '....', '....'], ash)).p.runs.length).toBe(4);
  });

  it('makes a rock mass two columns wide a block with a rock top, but not a 1-wide strip', () => {
    const a = map(['.......', '.##..#.', '.##..#.', '.##..#.', '.......']);
    const { p, claims } = extract(a);
    expect(p.runs.map((r) => r.x + 0)).toEqual([1, 2]); // (+ 0: the analysis' minX is -0)
    expect(claims.has(a.idx(1, 1), CLAIM_SURFACE)).toBe(false); // top row: ground at the top
    expect(claims.groundY[a.idx(1, 1)]).toBe(p.runs[0].topH);
    expect(claims.groundMt[a.idx(1, 1)]).toBe(2); // rock on top
    expect(claims.has(a.idx(1, 3), CLAIM_SURFACE)).toBe(true);
    for (let y = 1; y <= 3; y++) expect(claims.bits[a.idx(5, y)]).toBe(0);
  });

  it('leaves a long 1-wide strip (a wall edge) to the legacy art, and the short mass at its foot with it', () => {
    // column 1 is rock for six rows with rock beside it for only two: not a mass
    const { p, claims } = extract(map(['.......', '.#.....', '.#.....', '.#.....', '.#.....', '.##....', '.##....', '.......']));
    expect(p.runs).toEqual([]);
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('keeps only walls standing on a line: a lone face column stays legacy', () => {
    expect(extract(map(['PPPP', 'PPPP', 'P#PP', 'P#PP', '....', '....'])).p.runs).toEqual([]);
    expect(extract(map(['PPPP', 'PPPP', 'P##P', 'P##P', '....', '....'])).p.runs.length).toBe(2);
  });

  it('takes the level beside a face column whose top meets a tree (a terrace corner)', () => {
    const { p } = extract(map(['PPPP', 'PTPP', 'P##P', 'P##P', '....', '....']));
    expect(p.runs.map((r) => [r.x, r.topH])).toEqual([[1, 2], [2, 2]]);
  });

  it('gives one connected cliff one rock colour', () => {
    const { p } = extract(map(['PPPP', 'PPPP', '##rr', '##rr', '....', '....']));
    expect(p.runs).toHaveLength(4);
    for (const r of p.runs) expect(r.tint).toEqual(p.runs[0].tint);
  });

  it('closes higher ground beside a lower face with a rock side panel', () => {
    const { p } = extract(map(['PPPPPP', 'PPPPPP', '##PPPP', '##PPPP', '......', '......']));
    expect(p.runs.map((r) => [r.x + 0, r.hB, r.topH])).toEqual([[0, 0, 2], [1, 0, 2]]);
    const sides = p.sides.filter((s) => s.px === 2);
    expect(sides.map((s) => [s.dir, s.zt, s.zb, s.y0, s.y1])).toEqual([[-1, 4, 5, 0, 2], [-1, 5, 6, 0, 2]]);
  });

  it('treats a sign post at the foot of a face as the ground in front of it', () => {
    const a = map(['PPPP', 'PPPP', '####', '####', '.s..', '....']);
    const { claims } = extract(a, { warps: [], signs: [{ x: 1, y: 4 }] });
    expect(claims.bits[a.idx(1, 4)]).toBe(0);
    expect(claims.has(a.idx(1, 2), CLAIM_SURFACE)).toBe(true);
    expect(claims.has(a.idx(1, 3), CLAIM_SURFACE)).toBe(true);
  });

  it('puts a ledge lip on each jump cell, facing its jump', () => {
    const { p } = extract(map(['....', 'vvvv', '....']));
    expect(p.ledges.map((l) => [l.x, l.y, l.dir])).toEqual([[0, 1, 'S'], [1, 1, 'S'], [2, 1, 'S'], [3, 1, 'S']]);
  });

  it('does nothing indoors', () => {
    const { p, claims } = extract(map(['PPPP', 'PPPP', '####', '####', '....'], () => {}, { indoor: true }));
    expect(p).toEqual({ runs: [], sides: [], ledges: [] });
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('does nothing on a Dive map (its rock is the seabed)', () => {
    const rows = ['PPPP', 'PPPP', '####', '####', '....', '....'];
    expect(extract(map(rows)).p.runs.length).toBe(4);
    const { p, claims } = extract(map(rows, () => {}, { underwater: true }));
    expect(p).toEqual({ runs: [], sides: [], ledges: [] });
    expect(claims.bits.every((b) => b === 0)).toBe(true);
  });

  it('takes curated rock ids even in the colour of the ground', () => {
    // the face tiles share the ash ground's colour: not rock by colour, rock by the General table
    const ash = (info: ReturnType<typeof fakeInfo>) => {
      for (const m of [1, 2]) { info.both.fill(ASH, m * 256, (m + 1) * 256); info.bottom.fill(ASH, m * 256, (m + 1) * 256); }
    };
    const rows = ['PPPP', 'PPPP', '####', '####', '....', '....'];
    expect(extract(map(rows, ash, { general: true })).p.runs).toEqual([]);
    setRockIds((m) => m === 2);
    try {
      expect(extract(map(rows, ash, { general: true })).p.runs.length).toBe(4);
    } finally {
      setRockIds(() => false);
    }
  });
});

describe('cliff build', () => {
  const kit = () => ({ uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] });
  const build = (p: CliffPlacement) => cliffFamily.build(p, { a: map(['..']), events: NO_EVENTS, quality: 'medium' }, kit()) as THREE.Mesh;
  const run = (x: number, hB: number, topH: number, lip: CliffRun['lip'] = null): CliffRun => ({ x, zf: 6, hB, topH, tint: [0.6, 0.5, 0.4], lip });

  it('turns every triangle the way its normal says (no inward wedge tips, caps or lips)', () => {
    const p: CliffPlacement = {
      runs: [run(3, 0, 2, [0.4, 0.7, 0.4]), run(4, 0, 1), run(8, -0.3, 1)],
      sides: [
        { px: 6, dir: -1, zt: 4, zb: 5, y0: 0, y1: 2, tint: [0.6, 0.5, 0.4] },
        { px: 7, dir: 1, zt: 4, zb: 5, y0: 0, y1: 2, tint: [0.6, 0.5, 0.4] },
      ],
      ledges: (['S', 'N', 'E', 'W'] as const).map((dir, k) => ({ x: 10 + 2 * k, y: 3, h: 0, dir, grass: [0.4, 0.7, 0.4] as [number, number, number] })),
    };
    const g = build(p).geometry;
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
    const v = (k: number) => new THREE.Vector3().fromBufferAttribute(pos, k);
    let checked = 0;
    for (let t = 0; t < pos.count; t += 3) {
      const geo = v(t + 1).sub(v(t)).cross(v(t + 2).sub(v(t)));
      if (geo.length() < 1e-9) continue;
      expect(geo.dot(new THREE.Vector3().fromBufferAttribute(nor, t))).toBeGreaterThan(0);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('gives side-by-side walls the same vertices along their shared edge, whatever their feet', () => {
    // the same wall line and top; one stands in water (foot at the water level), one on the ground
    const edge = (r: CliffRun) => {
      const g = build({ runs: [r], sides: [], ledges: [] }).geometry;
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal');
      const out = new Map<string, number>();
      for (let k = 0; k < pos.count; k++) {
        if (nor.getZ(k) !== 1 || Math.abs(pos.getX(k) - 4) > 1e-6 || pos.getY(k) < -1e-6) continue;
        out.set(pos.getY(k).toFixed(4), pos.getZ(k));
      }
      return out;
    };
    const west = edge(run(3, -0.3, 2)), east = edge(run(4, 0, 2));
    expect(east.size).toBeGreaterThan(4);
    for (const [y, z] of east) expect(west.get(y)).toBe(z);
  });
  it('builds walls that stand out from their line and meet the plateau at the top edge', () => {
    const p: CliffPlacement = { runs: [{ x: 3, zf: 6, hB: 0, topH: 2, tint: [0.6, 0.5, 0.4], lip: null }], sides: [], ledges: [] };
    const a = map(['..']);
    const mesh = cliffFamily.build(p, { a, events: NO_EVENTS, quality: 'medium' }, kit()) as THREE.Mesh;
    const pos = mesh.geometry.getAttribute('position'), nor = mesh.geometry.getAttribute('normal');
    let face = 0;
    for (let i = 0; i < pos.count; i++) {
      if (nor.getZ(i) !== 1) continue; // the wall itself (side wedges face ±X)
      face++;
      expect(pos.getZ(i)).toBeGreaterThanOrEqual(6);
      if (Math.abs(pos.getY(i) - 2) < 1e-6) expect(pos.getZ(i)).toBeCloseTo(6, 6);
    }
    expect(face).toBeGreaterThan(0);
    expect(mesh.castShadow).toBe(true);
  });
  it('builds nothing for an empty placement', () => {
    expect(cliffFamily.build({ runs: [], sides: [], ledges: [] }, { a: map(['..']), events: NO_EVENTS, quality: 'medium' }, kit())).toBeNull();
  });
});
