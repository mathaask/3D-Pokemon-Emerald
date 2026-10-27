// Interior floors and window light shafts (Phase 4 Task 8): the brief's tests against the wired modules, plus the
// floor family (claims, meshes, catalogue). The pure parts' own tests: tests/interiorFloorPatterns.test.ts.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { encodeFloor, floorCells, floorFamily, FloorMat, FLOOR_CATALOGUE } from '../src/render/kit/interior/floors';
import { roomShaftMaterial, shaftGeometry } from '../src/render/kit/interior/shafts';
import { roomLayout, windowRect, RECESS } from '../src/render/kit/interior/room';
import { CLAIM_OBJECT, CLAIM_SURFACE, Claims } from '../src/render/overworld/claims';
import { createKitUniforms } from '../src/render/kit/materials';
import type { MapAnalysis } from '../src/render/overworld/analyze';
import type { InteriorId } from '../src/render/kit/tables/building';
import type { GridEvents } from '../src/render/kit/events';
import type { KitContext, SemanticContext } from '../src/render/kit/semantics';
import { fakeInterior } from './helpers/fakeInterior';

/** Claims with the table cells claimed CLAIM_OBJECT, as the furniture family would. */
const claimsWithTable = (a: MapAnalysis, ids: readonly (InteriorId | null)[]) => {
  const c = new Claims(a.N);
  ids.forEach((id, i) => { if (id === 'table') c.claim(i, CLAIM_OBJECT); });
  return c;
};
const HOUSE = ['          ', ' WWOOWWWW ', ' WWOOWFWW ', ' ........ ', ' ..TT.... ', ' ..TT..rr ', ' ......rr ', ' ....M... ', '          '];

describe('interior floors', () => {
  it('gives the rug its kind and border edges, and the table cells the rug under them', () => {
    const { a, ids } = fakeInterior(['          ', ' WWWWWWWW ', ' ........ ', ' ..rrrr.. ', ' ..rTTr.. ', ' ..rrrr.. ', ' ........ ', '          ']);
    const cells = floorCells(a, ids, roomLayout(a, ids, []), claimsWithTable(a, ids));
    const at = (x: number, y: number) => cells.find((c) => c.i === a.idx(x, y))!;
    expect(at(4, 4).mat).toBe(FloorMat.Rug);                        // under the table: the rug around it
    expect(at(3, 3).edges).toBe(0b1001);                             // NW corner of the rug: border N and W
    expect(at(4, 3).edges).toBe(0b0001);
    expect(at(5, 2).mat).toBe(FloorMat.Boards);
  });
  it('leaves the stairwell without floor', () => {
    const { a, ids } = fakeInterior(['        ', ' WWWWWW ', ' ...s.. ', ' ...... ', '        ']);
    const cells = floorCells(a, ids, roomLayout(a, ids, []), new Claims(a.N));
    expect(cells.some((c) => c.i === a.idx(4, 2))).toBe(false);
    expect(cells.some((c) => c.i === a.idx(3, 2))).toBe(true);
  });
  it('packs kind and edges in the alpha byte', () => {
    const { a } = fakeInterior(['    ', ' .. ', '    ']);
    const data = encodeFloor(a, [{ i: 7, h: 0, mat: FloorMat.Rug, tint: [1, 0.5, 0], edges: 0b0101 }]);
    expect([...data.subarray(28, 32)]).toEqual([255, 128, 0, (3 << 4) | 0b0101]);
  });
  it('lays one shaft per window, from the glass to the floor, gone at night', () => {
    const { a, ids } = fakeInterior(HOUSE);
    const L = roomLayout(a, ids, [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }]);
    const g = shaftGeometry(L)!; g.computeBoundingBox();
    const w = windowRect(L, L.features[0]);
    expect(g.boundingBox!.min.y).toBeCloseTo(0, 1);
    expect(g.boundingBox!.max.y).toBeLessThanOrEqual(w.y1 + 1e-3); expect(g.boundingBox!.max.y).toBeGreaterThan(w.y0);
    expect(g.boundingBox!.min.x).toBeGreaterThanOrEqual(w.x0 - 1e-3); expect(g.boundingBox!.max.z).toBeGreaterThan(3 - RECESS);
    const m = roomShaftMaterial(0.4);
    expect(m.transparent).toBe(true); expect(m.depthWrite).toBe(false); expect(m.blending).toBe(THREE.AdditiveBlending);
    expect(String(m.fragEmissive ?? '') + String(m.fragColor ?? '')).toContain('uOutdoorNight');
  });
});

describe('floor family', () => {
  const contexts = (rows: string[]) => {
    const { a, ids } = fakeInterior(rows);
    const events = { warps: [{ x: 5, y: 7, dest: 'LITTLEROOT_TOWN' }] } as unknown as GridEvents;
    const ctx: SemanticContext = { a, events, quality: 'medium' };
    const kit: KitContext = { uniforms: createKitUniforms(), quality: 'medium', disposables: [] };
    return { a, ids, ctx, kit };
  };

  it('claims the surface of every floor cell, after furniture, and draws the floor and the shafts', () => {
    const { a, ids, ctx, kit } = contexts(HOUSE);
    const claims = claimsWithTable(a, ids);
    const cells = floorFamily.extract(ctx, claims);
    expect(cells.length).toBeGreaterThan(40);
    expect(cells.every((c) => claims.has(c.i, CLAIM_SURFACE))).toBe(true);
    expect(claims.has(a.idx(3, 4), CLAIM_SURFACE)).toBe(true);           // under the table
    const root = floorFamily.build(cells, ctx, kit)!;
    const floor = root.getObjectByName('floor') as THREE.Mesh, shafts = root.getObjectByName('shafts') as THREE.Mesh;
    expect(floor.receiveShadow).toBe(true); expect(floor.castShadow).toBe(false);
    // (every cell claimed; behind the back wall (the band's north row) no quad)
    expect(floor.geometry.getAttribute('position').count).toBe(cells.filter((c) => (c.north ?? 0) < 1).length * 6);
    expect(cells.some((c) => (c.north ?? 0) >= 1)).toBe(true);
    expect(shafts.castShadow).toBe(false);
    expect(shafts.geometry.getAttribute('color').itemSize).toBe(3);
    // (every window is in the back wall: the shafts are cut away with it, never a stray streak at yaw π — review C1 M2)
    expect(shafts.userData.wallDir).toBe('N'); expect(floor.userData.wallDir).toBeUndefined();
    expect(kit.disposables).toHaveLength(1);                              // the cell texture
  });

  it('draws nothing in a room with neither floor nor window, and lists both programs in its catalogue', () => {
    const { ctx, kit, a } = contexts(['    ', ' ?? ', '    ']);
    expect(floorFamily.build(floorFamily.extract(ctx, new Claims(a.N)), ctx, kit)).toBeNull();
    expect(FLOOR_CATALOGUE.map((e) => [e.material.hookKey, Object.keys(e.attrs).join(','), e.castShadow])).toEqual([
      ['interiorFloor', 'position,normal', false], ['roomShaft', 'position,normal,color', false],
    ]);
  });
});
