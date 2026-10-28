// The interior kit in the World on real maps (Phase 4 Task 6, needs the ROM): the interior families run on in-scope
// interiors in Modern only, a failing one is rolled back (warned once per map), in-scope floors are flat, and the
// furniture core reads real rooms as the rulings say (walkable seats low, one chair per cell).
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/interiorWorld.test.ts

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import { loadStaticMap } from './helpers/staticMap';
import { MetatileAtlas } from '../../src/render/overworld/metatileAtlas';
import { World, type WorldStyle } from '../../src/render/overworld/world';
import { createHdWorldMaterials, createWorldMaterials } from '../../src/render/overworld/materials';
import { createKitUniforms } from '../../src/render/kit/materials';
import { gridEvents } from '../../src/render/kit/events';
import { analyze } from '../../src/render/overworld/analyze';
import { Claims } from '../../src/render/overworld/claims';
import { furnitureFamilyWith, WALKABLE_SEAT, type FurnitureGenerator } from '../../src/render/kit/interior/furniture';
import { FURNITURE_KINDS, type FurnitureKind } from '../../src/render/kit/tables/building';

const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
const u = createKitUniforms();
// (the view's: today's legacy materials, with their HD twins for the cells the interior kit leaves — Task 11)
const world = new World(atlas, { ...createWorldMaterials(atlas.target.texture, u), hd: createHdWorldMaterials(atlas.target.texture, u) }, u);
let warn: ReturnType<typeof vi.spyOn>;
beforeAll(() => { warn = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => { warn.mockRestore(); world.dispose(); });

const build = (g: number, n: number, style: WorldStyle, interiorKit = true) => {
  const s = loadStaticMap(g, n);
  world.build(s.grid, s.opts, { style, events: gridEvents(s.map.events, 0), quality: 'medium', mapKey: `${g}.${n}`, interiorKit });
  return s;
};
/** The world's legacy pixel-geometry meshes (World.addMesh: the ones carrying aGlow). */
const legacyMeshes = (w: World) => w.group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).isMesh && !!(o as THREE.Mesh).geometry.getAttribute('aGlow'));
const report = (g: number, n: number, style: WorldStyle, interiorKit = true) => {
  build(g, n, style, interiorKit);
  return world.kitReport.map((r) => `${r.name}:${r.ok}`);
};

describe('interior kit in the World', () => {
  it('runs the interior families on in-scope interiors in Modern only', () => {
    expect(report(2, 2, 'modern')).toEqual(['furniture:true', 'shell:true', 'floor:true']);
    expect(world.interiorKitRan).toBe(true);
    expect(report(2, 2, 'retro')).toEqual([]);
    expect(world.interiorKitRan).toBe(false);
    expect(report(2, 2, 'modern', false)).toEqual([]);
    expect(world.interiorKitRan).toBe(false);
    expect(report(8, 1, 'modern')).toEqual([]);                 // Petalburg Gym: out of scope
    expect(report(0, 10, 'modern')).toContain('terrain:true');  // outdoors as before
  });

  it('draws the ground plane after the room in in-scope Modern interiors only (hidden by depth under the floor)', () => {
    const base = () => world.group.children.find((o) => (o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry.type === 'PlaneGeometry')!;
    build(2, 2, 'modern'); expect(base().renderOrder).toBe(1);
    build(2, 2, 'retro'); expect(base().renderOrder).toBe(0);
    build(8, 1, 'modern'); expect(base().renderOrder).toBe(0);  // out of scope
    build(0, 10, 'modern'); expect(base().renderOrder).toBe(0);
  });

  it('rolls a failing interior family back, warning once per map', () => {
    world.setFailFamily('furniture');
    expect(report(2, 2, 'modern')).toEqual(['furniture:false', 'shell:true', 'floor:true']);
    report(2, 2, 'modern');
    expect(warn.mock.calls.filter((c: unknown[]) => String(c[0]).includes('furniture failed'))).toHaveLength(1);
    expect(world.interiorKitRan).toBe(true);                    // (it ran: the room light follows the clock all the same)
    world.setFailFamily(null);
  });

  it('flattens the floors of in-scope interiors in Modern only (the solver heights of counter rings)', () => {
    for (const [g, n] of [[13, 17], [13, 19], [13, 20], [23, 0]]) {
      const heights = (style: WorldStyle) => {
        const s = build(g, n, style);
        const hs = new Set<number>();
        for (let y = 0; y < s.grid.height; y++) for (let x = 0; x < s.grid.width; x++) hs.add(world.heightAt(x + 0.5, y + 0.5));
        return [...hs];
      };
      expect(heights('modern'), `${g}.${n}`).toEqual([0]);
      expect(heights('retro').some((h) => h !== 0), `${g}.${n} retro keeps today's heights`).toBe(true);
    }
  });

  it('caps the walkable head of the beds on 1.1, 1.3 and 6.6 low (the walkable-furniture ruling)', () => {
    for (const [g, n] of [[1, 1], [1, 3], [6, 6]]) {
      const s = loadStaticMap(g, n);
      const a = analyze(s.grid, { ...s.opts, margin: 14 });
      const stub: FurnitureGenerator = () => {};
      const beds = furnitureFamilyWith({ bed: stub }).extract({ a, events: gridEvents(s.map.events, 0), quality: 'medium' }, new Claims(a.N));
      const heads = beds.flatMap((b) => b.cellFeet.filter((_, k) => a.col[b.cells[k]] === 0));
      expect(heads.length, `${g}.${n}`).toBeGreaterThan(0);
      for (const f of heads) expect(f.height, `${g}.${n}`).toBeLessThanOrEqual(WALKABLE_SEAT);
    }
  });

  it("reads Brendan's kitchen table: one walkable low seat per chair cell, each facing the table", () => {
    const s = loadStaticMap(1, 0);
    const a = analyze(s.grid, { ...s.opts, margin: 14 });
    const stub: FurnitureGenerator = () => {};
    const gens = Object.fromEntries(FURNITURE_KINDS.map((k) => [k, stub])) as Record<FurnitureKind, FurnitureGenerator>;
    const pieces = furnitureFamilyWith(gens).extract({ a, events: gridEvents(s.map.events, 0), quality: 'medium' }, new Claims(a.N));
    const chairs = pieces.filter((p) => p.kind === 'chair');
    expect(chairs.map((p) => p.xy)).toEqual([[[2, 6]], [[5, 6]], [[2, 7]], [[5, 7]]]);
    expect(chairs.map((p) => p.facing)).toEqual(['E', 'W', 'E', 'W']);
    for (const c of chairs) expect(c.foot.height).toBeLessThanOrEqual(WALKABLE_SEAT);
    expect(pieces.filter((p) => p.kind === 'table').map((p) => p.xy)).toEqual([[[3, 6], [4, 6], [3, 7], [4, 7]]]);
  });

  it('draws unknown interior cells with the HD legacy materials, everything else with today\'s', () => {
    const mats = (g: number, n: number, style: WorldStyle) => { build(g, n, style); return legacyMeshes(world).map((m) => (m.material as THREE.Material).customProgramCacheKey()); };
    const pc = mats(2, 2, 'modern');
    expect(pc.length).toBeGreaterThan(0);
    expect(pc.every((k) => k.endsWith('-hd') || k === 'world-water')).toBe(true);
    expect(mats(2, 2, 'retro').some((k) => k.endsWith('-hd'))).toBe(false);
    expect(mats(8, 1, 'modern').some((k) => k.endsWith('-hd'))).toBe(false);
    expect(mats(0, 10, 'modern').some((k) => k.endsWith('-hd'))).toBe(false);
  });
});
