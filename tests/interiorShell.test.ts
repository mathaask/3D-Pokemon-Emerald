import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { fakeInterior } from './helpers/fakeInterior';
import { Claims, CLAIM_OBJECT } from '../src/render/overworld/claims';
import type { MapAnalysis } from '../src/render/overworld/analyze';
import type { GridEvents } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { interiorIds } from '../src/render/kit/tables/building';
import { roomLayout, RECESS, WALL_H, WALL_T } from '../src/render/kit/interior/room';
import { SHELL, maxProfileDepth, shellProfile } from '../src/render/kit/interior/wallParts';
import { INNER_NORMAL } from '../src/render/kit/interior/cutaway';
import { BUILDING_BODY } from '../src/render/kit/buildings';
import { RUN_NORMAL } from '../src/render/kit/interior/geom/shellParts';
import { ROOM_GLASS, SHELL_CATALOGUE, clockGeometry, shellFamily } from '../src/render/kit/interior/shell';

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
/** A clock and a decal in the band, a strip partition from the back wall, a dividing wall. */
const PARTS = [
  '            ',
  ' WWCWWDWWWW ',
  ' WWWWWDWWWW ',
  ' ....W..... ',
  ' ....W..... ',
  ' ....W..... ',
  ' .......... ',
  ' WWW....... ',
  ' ....M..... ',
  '            ',
];

/** shellFamily's extract + build on a fake interior (kitMaterial on createKitUniforms()). */
function buildShell(a: MapAnalysis, events: GridEvents) {
  const claims = new Claims(a.N), ctx = { a, events, quality: 'medium' as const };
  const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] };
  const p = shellFamily.extract(ctx, claims);
  const group = shellFamily.build(p, ctx, kit)!;
  return { group, claims, p, kit };
}

let g: THREE.Object3D, claims: Claims, bandCells: number[];
const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
/** Vertices of `o`'s geometry strictly inside x0..x1 and below yMax (a wall standing in a doorway has some). */
const wallQuadsBelow = (o: THREE.Object3D, r: { x0: number; x1: number; yMax: number }) => {
  const p = (o as THREE.Mesh).geometry.getAttribute('position');
  let n = 0;
  for (let i = 0; i < p.count; i++) if (p.getX(i) > r.x0 && p.getX(i) < r.x1 && p.getY(i) < r.yMax) n++;
  return n;
};
beforeAll(() => {
  const { a } = fakeInterior(HOUSE);                          // (seeds interiorIds(a))
  ({ group: g, claims } = buildShell(a, { warps: [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }], signs: [] }));
  const L = roomLayout(a, interiorIds(a), [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
  bandCells = [...L.band.keys()].filter((i) => L.band[i] === 1);
});
const DEPTH = maxProfileDepth(shellProfile(WALL_H, SHELL.wainscot, WALL_T));   // the crown: 0.16

describe('interior shell (brief)', () => {
  it('builds one wall mesh per direction, tagged for the cutaway', () => {
    expect(['N', 'E', 'S', 'W'].map((d) => g.getObjectByName(`walls${d}`)!.userData.wallDir)).toEqual(['N', 'E', 'S', 'W']);
  });
  it('stands the back wall in the recess, WALL_H tall, and leaves the room open', () => {
    const n = box(g.getObjectByName('wallsN')!);
    expect(n.max.z).toBeCloseTo(3 - RECESS + DEPTH, 2); expect(n.max.y).toBeCloseTo(WALL_H, 2);
    expect(n.min.z).toBeCloseTo(3 - RECESS - WALL_T, 2);
    expect(box(g.getObjectByName('wallsS')!).min.z).toBeCloseTo(8 - DEPTH, 2);
  });
  it('opens the doorway and glazes the window', () => {
    expect(wallQuadsBelow(g.getObjectByName('wallsS')!, { x0: 5.05, x1: 5.95, yMax: 2.0 })).toBe(0);
    const glass = box(g.getObjectByName('roomWindows')!);
    expect(glass.min.x).toBeGreaterThanOrEqual(3); expect(glass.max.x).toBeLessThanOrEqual(5);
    expect(String(ROOM_GLASS.fragColor ?? '') + String(ROOM_GLASS.fragHead ?? '')).toContain('uOutdoorNight');
  });
  it('claims every band cell so no legacy face stands in front of the wall', () => {
    expect(bandCells.length).toBeGreaterThan(0);
    for (const i of bandCells) expect(claims.has(i, CLAIM_OBJECT)).toBe(true);
  });
});

describe('interior shell (more)', () => {
  it('tags walls and fixtures with their direction, the glass N; the window fixtures on the back wall', () => {
    for (const d of ['N', 'E', 'S', 'W']) {
      const f = g.getObjectByName(`fixtures${d}`);
      if (f) expect(f.userData.wallDir).toBe(d);
    }
    expect(g.getObjectByName('fixturesN')).toBeDefined();
    expect(g.getObjectByName('fixturesS')).toBeDefined();   // the door frame and slab
    expect(g.getObjectByName('roomWindows')!.userData.wallDir).toBe('N');
  });
  it('uses only catalogued material kinds (BUILDING_BODY / ROOM_GLASS on PNC, cast)', () => {
    expect(SHELL_CATALOGUE.map((e) => [e.material, e.castShadow])).toEqual([[BUILDING_BODY, true], [ROOM_GLASS, true]]);
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      expect(Object.keys(m.geometry.attributes).sort()).toEqual(['color', 'normal', 'position']);
      expect(m.castShadow).toBe(true);
    });
  });
  it('the run normals are the cutaway\'s', () => {
    expect(RUN_NORMAL).toBe(INNER_NORMAL);
  });
  it('draws partitions solid and never cut away, the clock modelled, the decal textured (disposed with the world)', () => {
    const { a } = fakeInterior(PARTS);
    const { group, kit, p } = buildShell(a, { warps: [{ x: 5, y: 8, dest: 'X' }], signs: [] });
    const part = group.getObjectByName('partitions') as THREE.Mesh;
    expect(part).toBeDefined();
    expect(part.userData.wallDir).toBeUndefined();
    expect(box(part).max.y).toBeCloseTo(WALL_H / 2, 5);
    const decals = group.getObjectByName('wallDecals') as THREE.Mesh;
    expect(decals.userData.wallDir).toBe('N');
    expect(decals.castShadow).toBe(false);
    expect(Object.keys(decals.geometry.attributes).sort()).toEqual(['normal', 'position', 'uv']);
    expect((decals.material as THREE.MeshStandardMaterial).map).toBeInstanceOf(THREE.DataTexture);
    expect(kit.disposables.length).toBe(1);
    expect(p!.decals.map((f) => f.kind)).toEqual(['decor']);
    // the clock hangs on the back wall in fixturesN, over column 3
    const fx = box(group.getObjectByName('fixturesN')!);
    expect(fx.min.x).toBeGreaterThan(3 - 0.01); expect(fx.max.x).toBeLessThan(4 + 0.01);
  });
  it('builds nothing on a map with no room', () => {
    const { a } = fakeInterior(['   ', '   ']);
    const claims = new Claims(a.N), ctx = { a, events: { warps: [], signs: [] }, quality: 'medium' as const };
    expect(shellFamily.extract(ctx, claims)).toBeNull();
    expect(shellFamily.build(null, ctx, { uniforms: createKitUniforms(), quality: 'medium', disposables: [] })).toBeNull();
  });
  it('clockGeometry is a PNC clock facing +z', () => {
    const c = clockGeometry(0.25, [1, 1, 1], [0.2, 0.2, 0.2]);
    c.computeBoundingBox();
    expect(c.boundingBox!.max.x).toBeCloseTo(0.25, 2);
    expect(c.boundingBox!.min.z).toBeGreaterThanOrEqual(-1e-6);
  });
});
