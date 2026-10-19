import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { MB } from '../src/game/behaviors';
import { cellLook, groundMaterial, GroundMat, terrainFamily } from '../src/render/kit/terrain';
import { Claims, CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
import { NO_EVENTS } from '../src/render/kit/events';
import { createKitUniforms } from '../src/render/kit/materials';
import { analyze, K } from '../src/render/overworld/analyze';
import { fakeAnalysis, fakeGrid, fakeInfo } from './helpers/fakeMap';

describe('groundMaterial', () => {
  const grass: [number, number, number] = [0.45, 0.78, 0.65];
  it('behaviour wins over colour', () => {
    expect(groundMaterial(MB.SAND, grass)).toBe(GroundMat.Sand);
    expect(groundMaterial(MB.FORTREE_BRIDGE, grass)).toBe(GroundMat.Deck);
    expect(groundMaterial(MB.ASHGRASS, grass)).toBe(GroundMat.Gravel);
  });
  it('falls back to the colour class', () => {
    expect(groundMaterial(MB.NORMAL, grass)).toBe(GroundMat.Grass);
    expect(groundMaterial(MB.NORMAL, [0.65, 0.84, 0.78])).toBe(GroundMat.Path);
    expect(groundMaterial(MB.NORMAL, [0.81, 0.81, 0.87])).toBe(GroundMat.Paving);
  });
  it('beach shallows are sand', () => {
    expect(groundMaterial(MB.SHALLOW_WATER, [0.61, 0.65, 0.74])).toBe(GroundMat.Sand);
  });
});

/** BGR555 pixel of an sRGB colour given in 31sts. */
const px = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);

describe('cellLook', () => {
  it('ignores dark outline and shadow pixels', () => {
    const a = fakeAnalysis(['...']);
    a.info.bottom.fill(px(7, 10, 0), 5 * 256, 5 * 256 + 150); // dark olive shadow (dominant)
    a.info.bottom.fill(px(7, 17, 6), 5 * 256 + 150, 6 * 256); // the grass itself
    expect(cellLook(a, 5, new Map()).tint).toEqual([7 / 31, 17 / 31, 6 / 31]);
  });
  it('takes a deck colour from the planks on the top layer', () => {
    const a = fakeAnalysis(['...']);
    a.info.attributes[5] = MB.FORTREE_BRIDGE;
    a.info.bottom.fill(px(7, 17, 6), 5 * 256, 6 * 256); // canopy under the bridge
    a.info.both.fill(px(8, 9, 13), 5 * 256, 5 * 256 + 140); // plank outlines
    a.info.both.fill(px(25, 26, 20), 5 * 256 + 140, 6 * 256); // planks
    const look = cellLook(a, 5, new Map());
    expect(look.mat).toBe(GroundMat.Deck);
    expect(look.tint).toEqual([25 / 31, 26 / 31, 20 / 31]);
  });
});

describe('terrain extract', () => {
  it('covers walkable cells and the ground under claimed objects', () => {
    const a = fakeAnalysis(['....', '.##.', '....']);
    const claims = new Claims(a.N);
    const objectCell = a.idx(1, 1);
    claims.claim(objectCell, CLAIM_OBJECT);
    claims.groundY[objectCell] = 0.5;
    const p = terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    const covered = new Set(p.cells.map((c) => c.i));
    expect(covered.has(a.idx(0, 0))).toBe(true);
    expect(covered.has(objectCell)).toBe(true);
    expect(p.cells.find((c) => c.i === objectCell)!.h).toBe(0.5);
    // the unclaimed block cell keeps its legacy ground
    expect(covered.has(a.idx(2, 1))).toBe(false);
    expect(a.kind[a.idx(2, 1)]).toBe(K.Block);
    for (const c of p.cells) expect(claims.has(c.i, CLAIM_SURFACE)).toBe(true);
  });
  it('leaves walk-in doors, ladders, treehouse walkways and bike rails to the legacy pixel art', () => {
    const info = fakeInfo();
    info.attributes[3] = MB.NON_ANIMATED_DOOR;
    info.attributes[4] = MB.LADDER;
    info.attributes[5] = MB.NO_RUNNING; // Fortree's treehouse platforms and their ladders
    info.attributes[6] = MB.HORIZONTAL_RAIL; // Acro Bike rail over water (rail on the top layer)
    const grid = fakeGrid(['......', '......']);
    for (let x = 1; x <= 4; x++) grid.cells[x] = (x + 2) | 0x3000;
    const a = analyze(grid, { info, generalPrimary: false, indoor: false, underground: false, margin: 1 });
    const claims = new Claims(a.N);
    const p = terrainFamily.extract({ a, events: NO_EVENTS, quality: 'medium' }, claims);
    const covered = new Set(p.cells.map((c) => c.i));
    for (let x = 1; x <= 4; x++) {
      expect(a.kind[a.idx(x, 0)]).toBe(K.Floor);
      expect(covered.has(a.idx(x, 0))).toBe(false);
      expect(claims.has(a.idx(x, 0), CLAIM_SURFACE)).toBe(false);
    }
    expect(covered.has(a.idx(0, 0))).toBe(true);
    expect(covered.has(a.idx(5, 0))).toBe(true);
  });
});

describe('terrain build', () => {
  it('emits one top per cell plus banks, every triangle facing its normal', () => {
    const a = fakeAnalysis(['.....', '.###.', '.....']);
    const claims = new Claims(a.N);
    // Ground under claimed objects at assorted heights (row 0 is at 1, row 2 at 0): banks rising
    // and falling in both directions.
    [1.5, 0.25, 0.75].forEach((h, k) => {
      claims.claim(a.idx(k + 1, 1), CLAIM_OBJECT);
      claims.groundY[a.idx(k + 1, 1)] = h;
    });
    const ctx = { a, events: NO_EVENTS, quality: 'medium' as const };
    const p = terrainFamily.extract(ctx, claims);
    const kit = { uniforms: createKitUniforms(), quality: 'medium' as const, disposables: [] as { dispose(): void }[] };
    const mesh = terrainFamily.build(p, ctx, kit) as THREE.Mesh;
    expect(kit.disposables).toHaveLength(1);
    const pos = mesh.geometry.getAttribute('position');
    const nor = mesh.geometry.getAttribute('normal');
    const quads = pos.count / 6;
    expect(quads).toBeGreaterThan(p.cells.length);
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), n = new THREE.Vector3();
    const kinds = new Set<string>();
    for (let t = 0; t < pos.count; t += 3) {
      va.fromBufferAttribute(pos, t);
      vb.fromBufferAttribute(pos, t + 1).sub(va);
      vc.fromBufferAttribute(pos, t + 2).sub(va);
      n.fromBufferAttribute(nor, t);
      expect(vb.cross(vc).dot(n)).toBeGreaterThan(0);
      kinds.add(n.toArray().map((v) => Math.sign(Math.round(v * 10))).join(','));
    }
    // tops, both S-bank orientations and both E-bank orientations
    for (const k of ['0,1,0', '0,0,1', '0,1,-1', '1,0,0', '-1,0,0']) expect(kinds.has(k)).toBe(true);
  });
});
