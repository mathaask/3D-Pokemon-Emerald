import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fakeInterior } from './helpers/fakeInterior';
import { roomLayout, RECESS, WALL_H, WALL_T, type WallDir, type WallFeature } from '../src/render/kit/interior/room';
import { SHELL, maxProfileDepth, shellProfile, type ShellColors } from '../src/render/kit/interior/wallParts';
import { Soup } from '../src/render/kit/soup';
import {
  DECAL_OFFSET, LINTEL_H, PARTITION_H, RUN_NORMAL, ROOM_GLASS, SHELL_CROWN_DEPTH, SHELL_PROFILE, bandRect, buildShellSoups,
  clockGeometry, cropProfile, decalGeometry, packDecals, partitionLoops, runEnds, shellRuns,
} from '../src/render/kit/interior/geom/shellParts';

const HOUSE = [
  '          ',
  ' WWOOWWWW ',
  ' WWOOWFWW ',
  ' ........ ',
  ' ..TT.... ',
  ' ..TT..rr ',
  ' ......rr ',
  ' ....M... ',
  '          ',
];
const DOOR = [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }];
/** A strip partition hanging from the back wall (column 5, rows 3–5) and a dividing wall against the west wall (row 7,
 *  columns 1–3), a clock and a decal in the band, an east arrow-warp door. */
const PARTS = [
  '            ',
  ' WWCWWDWWWW ',
  ' WWWWWDWWWW ',
  ' ....W..... ',
  ' ....W..... ',
  ' ....W..... ',
  ' .........E ',
  ' WWW....... ',
  ' .......... ',
  ' .......... ',
  '            ',
];
const COLORS: ShellColors = { base: [0.4, 0.3, 0.2], wainscot: [0.7, 0.6, 0.5], panel: [0.72, 0.62, 0.52], trim: [0.9, 0.9, 0.85], wall: [0.8, 0.85, 0.7] };

const geo = (s: Soup) => s.geometry();
const box = (s: Soup) => { const g = geo(s); g.computeBoundingBox(); return g.boundingBox!; };
const positions = (s: Soup): THREE.Vector3[] => {
  const p = geo(s).getAttribute('position'), out: THREE.Vector3[] = [];
  for (let i = 0; i < p.count; i++) out.push(new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i)));
  return out;
};
/** Vertices strictly inside x0..x1 (or z0..z1) and below yMax. */
const countIn = (s: Soup, r: { x0?: number; x1?: number; z0?: number; z1?: number; yMax: number }) =>
  positions(s).filter((v) => (r.x0 === undefined || (v.x > r.x0 && v.x < r.x1!)) && (r.z0 === undefined || (v.z > r.z0 && v.z < r.z1!)) && v.y < r.yMax).length;
const has = (s: Soup, x: number, y: number, z: number) => positions(s).some((v) => Math.abs(v.x - x) < 1e-5 && Math.abs(v.y - y) < 1e-5 && Math.abs(v.z - z) < 1e-5);

describe('shell parts: profile', () => {
  it('exports the crown depth (F9): 0.16 into the room', () => {
    expect(SHELL_CROWN_DEPTH).toBeCloseTo(0.16, 6);
    expect(SHELL_CROWN_DEPTH).toBe(maxProfileDepth(shellProfile(WALL_H, SHELL.wainscot, WALL_T)));
    expect(Math.min(...SHELL_PROFILE.pts.map(([d]) => d))).toBeCloseTo(-WALL_T, 6);
  });
  it('crops the profile to a lintel (soffit first, facing down) and a sill (closed on top)', () => {
    const top = cropProfile(SHELL_PROFILE, LINTEL_H, WALL_H);
    expect(Math.min(...top.pts.map(([, h]) => h))).toBeCloseTo(LINTEL_H, 6);
    expect(Math.max(...top.pts.map(([, h]) => h))).toBeCloseTo(WALL_H, 6);
    expect(top.pts[0]).toEqual([-WALL_T, LINTEL_H]);
    expect(top.pts[1][1]).toBeCloseTo(LINTEL_H, 6);
    expect(top.pts[1][0]).toBeGreaterThanOrEqual(0);
    expect(top.col.length).toBe(top.pts.length - 1);
    const sill = cropProfile(SHELL_PROFILE, -Infinity, 0.6);
    expect(Math.max(...sill.pts.map(([, h]) => h))).toBeCloseTo(0.6, 6);
    expect(sill.pts[0]).toEqual(SHELL_PROFILE.pts[0]);
    expect(sill.pts[sill.pts.length - 2]).toEqual([-WALL_T, 0.6]);
    // the sill's top runs from the wainscot's face (0.02) back to the outer face
    expect(sill.pts[sill.pts.length - 3][0]).toBeCloseTo(0.02, 6);
  });
});

describe('shell parts: HOUSE shell', () => {
  const { a, ids } = fakeInterior(HOUSE);
  const L = roomLayout(a, ids, DOOR);
  const S = buildShellSoups({ a, L, colors: COLORS });
  it('stands the back wall in the recess, WALL_H tall, its crown into the room, its outer face WALL_T back', () => {
    const n = box(S.walls.N);
    expect(n.max.z).toBeCloseTo(3 - RECESS + SHELL_CROWN_DEPTH, 5);
    expect(n.max.y).toBeCloseTo(WALL_H, 5);
    expect(n.min.z).toBeCloseTo(3 - RECESS - WALL_T, 5);
    expect(box(S.walls.S).min.z).toBeCloseTo(8 - SHELL_CROWN_DEPTH, 5);
  });
  it('mitres the corners (outer and crown points shared by both walls)', () => {
    // back-right corner: N line 2.5, E line 9
    for (const s of [S.walls.N, S.walls.E]) {
      expect(has(s, 9 + WALL_T, WALL_H, 2.5 - WALL_T)).toBe(true);
      expect(has(s, 9 - 0.16, WALL_H, 2.5 + 0.16)).toBe(true);
    }
  });
  it('opens the doorway under a lintel at 2.1, framed, a closed slab in it', () => {
    expect(countIn(S.walls.S, { x0: 5.0001, x1: 5.9999, yMax: LINTEL_H - 1e-4 })).toBe(0);
    // the lintel: its soffit at 2.1 from the inner face (z 8) to the outer one (8 + WALL_T), over the gap
    for (const x of [5, 6]) for (const z of [8, 8 + WALL_T]) expect(has(S.walls.S, x, LINTEL_H, z)).toBe(true);
    expect(has(S.walls.S, 5, WALL_H, 8 - SHELL_CROWN_DEPTH)).toBe(true);
    const f = box(S.fixtures.S);
    expect(f.min.x).toBeLessThan(5); expect(f.max.x).toBeGreaterThan(6);
    expect(countIn(S.fixtures.S, { x0: 5.1, x1: 5.9, yMax: 1 })).toBeGreaterThan(0);   // the slab
  });
  it('glazes the window inside its feature and cuts the wall behind the glass', () => {
    const g = box(S.glass);
    expect(g.min.x).toBeGreaterThanOrEqual(3); expect(g.max.x).toBeLessThanOrEqual(5);
    expect(g.min.z).toBeCloseTo(2.5 + 0.012, 5);
    // no wall vertex strictly inside the glass rectangle (x 3.15–4.85, y 0.2–2.3)
    expect(positions(S.walls.N).filter((v) => v.x > 3.151 && v.x < 4.849 && v.y > 0.201 && v.y < 2.299).length).toBe(0);
    expect(box(S.fixtures.N).max.z).toBeGreaterThan(2.5 + 0.1);   // the sill
  });
  it('has no partition, no decal', () => {
    expect(S.partitions.empty).toBe(true);
    expect(S.decals).toEqual([]);
  });
});

describe('shell parts: partitions, bridges, clocks, decals, side doors', () => {
  const { a, ids } = fakeInterior(PARTS);
  const warps = [{ x: 10, y: 6, dest: 'X' }];
  const L = roomLayout(a, ids, warps);
  const S = buildShellSoups({ a, L, colors: COLORS, clockColors: () => ({ face: [1, 1, 1], rim: [0.2, 0.2, 0.2] }) });
  it('the layout has the partitions this fixture means', () => {
    expect(L.partition[a.idx(5, 3)]).toBe(1);
    expect(L.partition[a.idx(1, 7)]).toBe(1);
    expect(L.doors).toEqual([{ dir: 'E', line: 11, from: 6, to: 7 }]);
  });
  it('bridges the outer walls over partition ends: one back wall, one west wall', () => {
    const runs = shellRuns(a, L);
    expect(runs.filter((r) => r.dir === 'N')).toEqual([{ dir: 'N', line: 3 - RECESS, from: 1, to: 11, floorY: 0 }]);
    expect(runs.filter((r) => r.dir === 'W')).toEqual([{ dir: 'W', line: 1, from: 3 - RECESS, to: 10, floorY: 0 }]);
    expect(runs.some((r) => 'partition' in r)).toBe(false);
  });
  it('finds each outer run end its corner neighbour', () => {
    const runs = shellRuns(a, L);
    const n = runs.find((r) => r.dir === 'N')!;
    expect(runEnds(runs, n)).toEqual([RUN_NORMAL.W, RUN_NORMAL.E]);
  });
  it('builds the partitions half-height and solid: closed outlines, a lid over the whole footprint', () => {
    const loops = partitionLoops(a, L);
    expect(loops.length).toBe(2);
    const strip = loops.find((l) => l.path.some(([x]) => x === 6))!;
    // the strip reaches back into the recess to the back wall's face
    expect(Math.min(...strip.path.map(([, z]) => z))).toBeCloseTo(3 - RECESS, 6);
    expect(Math.max(...strip.path.map(([, z]) => z))).toBeCloseTo(6, 6);
    expect(strip.path[0]).toEqual(strip.path[strip.path.length - 1]);
    const b = box(S.partitions);
    expect(b.max.y).toBeCloseTo(PARTITION_H, 5);
    expect(b.min.y).toBeLessThanOrEqual(0);
    // the lid: every point of the footprint is under an upward triangle at PARTITION_H
    const g = geo(S.partitions), p = g.getAttribute('position'), nrm = g.getAttribute('normal');
    const lid: THREE.Triangle[] = [];
    for (let i = 0; i < p.count; i += 3) {
      if (nrm.getY(i) < 0.99 || Math.abs(p.getY(i) - PARTITION_H) > 1e-5) continue;
      lid.push(new THREE.Triangle(new THREE.Vector3(p.getX(i), 0, p.getZ(i)), new THREE.Vector3(p.getX(i + 1), 0, p.getZ(i + 1)),
        new THREE.Vector3(p.getX(i + 2), 0, p.getZ(i + 2))));
    }
    const covered = (x: number, z: number) => lid.some((t) => t.containsPoint(new THREE.Vector3(x, 0, z)));
    for (const [x, z] of [[5.5, 2.6], [5.1, 4], [5.9, 5.9], [1.1, 7.1], [2.5, 7.5], [3.9, 7.9]]) expect(covered(x, z)).toBe(true);
    expect(covered(4.5, 4)).toBe(false);
  });
  it('hangs the clock in its row of the band (row 0 = the top) and the decal over its two rows', () => {
    const clock = L.features.find((f) => f.kind === 'clock')!;
    const r = bandRect(clock, 0.2, WALL_H - 0.3);
    expect(r.y1).toBeCloseTo(WALL_H - 0.3, 6);
    expect(r.y0).toBeCloseTo(0.2 + (WALL_H - 0.5) / 2, 6);
    const cb = box(S.fixtures.N);
    expect(cb.min.x).toBeGreaterThan(3 - 0.01); expect(cb.max.x).toBeLessThan(4 + 0.01);
    expect(cb.min.y).toBeGreaterThan(r.y0 - 0.01);
    expect(S.decals.map((f) => [f.kind, f.x0, f.x1, f.row0, f.row1])).toEqual([['decor', 6, 7, 0, 1]]);
    expect(S.decalRects[0].z).toBeCloseTo(3 - RECESS + DECAL_OFFSET, 6);
  });
  it('cuts the east doorway', () => {
    expect(countIn(S.walls.E, { z0: 6.0001, z1: 6.9999, yMax: LINTEL_H - 1e-4 })).toBe(0);
    expect(countIn(S.fixtures.E, { z0: 6.1, z1: 6.9, yMax: 1 })).toBeGreaterThan(0);
  });
  it('tags nothing it cannot build', () => {
    expect(S.skipped).toEqual([]);
  });
});

describe('shell parts: clock, decals, glass', () => {
  it('builds a round wall clock facing the room (PNC)', () => {
    const g = clockGeometry(0.3, [0.95, 0.95, 0.9], [0.3, 0.2, 0.1]);
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position']);
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.max.x).toBeCloseTo(0.3, 2); expect(b.min.x).toBeCloseTo(-0.3, 2);
    expect(b.max.y).toBeCloseTo(0.3, 2); expect(b.min.z).toBeGreaterThanOrEqual(-1e-6);
    expect(b.max.z).toBeLessThan(0.12);
    // its face looks into the room (+z)
    const n = g.getAttribute('normal');
    let front = 0;
    for (let i = 0; i < n.count; i++) if (n.getZ(i) > 0.99) front++;
    expect(front).toBeGreaterThan(0);
  });
  it('packs the decals Scale4x into one texture, gutters against bleeding, transparent pixels in the wall colour', () => {
    const { a, ids } = fakeInterior(PARTS);
    const L = roomLayout(a, ids, []);
    const decor = L.features.filter((f) => f.kind === 'decor');
    const both = new Uint16Array(1024 * 256).fill(0x8000);
    const mt = a.mt[decor[0].cells[0]];
    both.fill(31, mt * 256, mt * 256 + 128);   // red top half, transparent bottom half
    const P = packDecals(both, a.mt, decor, [0, 0, 1]);
    expect(P.width % 4).toBe(0); expect(P.height % 4).toBe(0);
    expect(P.data.length).toBe(P.width * P.height * 4);
    const [u0, v0, u1, v1] = P.uv[0];
    expect(u0).toBeGreaterThan(0); expect(u1).toBeLessThanOrEqual(1); expect(v0).toBeGreaterThanOrEqual(0); expect(v1).toBeLessThan(1);
    const at = (u: number, v: number) => {
      const x = Math.floor(u * P.width), y = Math.floor(v * P.height), o = (y * P.width + x) * 4;
      return [...P.data.subarray(o, o + 4)];
    };
    // the feature's top (v near v1) is red, the transparent part blue (the fill), all opaque
    const top = at((u0 + u1) / 2, v1 - (v1 - v0) * 0.1), mid = at((u0 + u1) / 2, v0 + (v1 - v0) * 0.6);
    expect(top[0]).toBeGreaterThan(200); expect(top[2]).toBeLessThan(40); expect(top[3]).toBe(255);
    expect(mid[2]).toBeGreaterThan(200); expect(mid[0]).toBeLessThan(40);
    const g = decalGeometry([{ x0: 1, x1: 2, y0: 0.5, y1: 1.5, z: 3, uv: P.uv[0] }]);
    expect(g.getAttribute('uv').count).toBe(4);
    expect(g.getIndex()!.count).toBe(6);
  });
  it('ROOM_GLASS: vertex colours, smooth, fades, turns to night blue by uOutdoorNight', () => {
    expect(ROOM_GLASS.vertexColors).toBe(true);
    expect(ROOM_GLASS.roughness).toBe(0.15);
    expect(ROOM_GLASS.fade).toBe(true);
    expect(ROOM_GLASS.hookKey).toBe('roomGlass');
    expect(String(ROOM_GLASS.fragColor ?? '') + String(ROOM_GLASS.fragHead ?? '')).toContain('uOutdoorNight');
    expect(ROOM_GLASS.fragHead).toContain('uniform float uOutdoorNight;');
  });
});

describe('shell parts: run normals', () => {
  it('match the cutaway convention (into the room)', () => {
    const want: Record<WallDir, [number, number]> = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] };
    expect(RUN_NORMAL).toEqual(want);
    const f: WallFeature = { kind: 'decor', x0: 0, x1: 1, row0: 1, row1: 2, rows: 3, cells: [] };
    const r = bandRect(f, 0, 3);
    expect([r.y0, r.y1]).toEqual([0, 2]);
  });
});
