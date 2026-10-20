import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { extractAll, buildAll, disposeKit, type Family, type KitContext } from '../src/render/kit/semantics';
import { createKitUniforms } from '../src/render/kit/materials';
import { CLAIM_BLADES, CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_TOP } from '../src/render/overworld/claims';
import { hidesGrassOverlay } from '../src/render/overworld/overworldView';
import { SpriteKind } from '../src/game/spriteKinds';
import { NO_EVENTS } from '../src/render/kit/events';
import { World } from '../src/render/overworld/world';
import { MetatileAtlas } from '../src/render/overworld/metatileAtlas';
import { createWorldMaterials } from '../src/render/overworld/materials';
import { fakeAnalysis, fakeGrid, fakeInfo } from './helpers/fakeMap';

const kit = (): KitContext => ({ uniforms: createKitUniforms(), quality: 'medium', disposables: [] });
const ctx = () => ({ a: fakeAnalysis(['....', '.#..', '....']), events: NO_EVENTS, quality: 'medium' as const });

const claimer = (name: string, i: number, bit: number, fail?: 'extract' | 'build'): Family<number> => ({
  name,
  extract(_c, claims) {
    claims.claim(i, bit);
    if (fail === 'extract') throw new Error('boom');
    return i;
  },
  build() {
    if (fail === 'build') throw new Error('boom');
    return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  },
});

describe('semantic core', () => {
  it('rolls back a family whose extract throws, and keeps running the rest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ex = extractAll(ctx(), [claimer('bad', 5, CLAIM_OBJECT, 'extract'), claimer('good', 6, CLAIM_SURFACE)]);
    expect(ex.claims.bits[5]).toBe(0);
    expect(ex.claims.bits[6]).toBe(CLAIM_SURFACE);
    expect(ex.report.map((r) => r.ok)).toEqual([false, true]);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('a build failure clears exactly the bits that family added', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fams = [claimer('a', 5, CLAIM_OBJECT, 'build'), claimer('b', 5, CLAIM_SURFACE)];
    const c = ctx();
    const ex = extractAll(c, fams);
    const group = buildAll(ex, c, fams, kit());
    expect(ex.claims.bits[5]).toBe(CLAIM_SURFACE);
    expect(group.children.map((o) => o.name)).toEqual(['b']);
    warn.mockRestore();
  });

  it('dispose removes all kit objects and frees non-shared resources', () => {
    const k = kit();
    const root = new THREE.Group();
    const parent = new THREE.Group();
    parent.add(root);
    const g1 = new THREE.BoxGeometry();
    const shared = new THREE.BoxGeometry();
    shared.userData.shared = true;
    const m1 = new THREE.MeshBasicMaterial();
    root.add(new THREE.Mesh(g1, m1), new THREE.Mesh(shared, m1));
    // Instanced meshes over shared geometry: their own instance buffers must still be freed.
    const inst = new THREE.InstancedMesh(shared, m1, 4);
    const instDisposed = vi.fn();
    inst.addEventListener('dispose', instDisposed);
    root.add(inst);
    const tex = { dispose: vi.fn() };
    k.disposables.push(tex);
    const sg = vi.spyOn(g1, 'dispose');
    const ss = vi.spyOn(shared, 'dispose');
    disposeKit(root, k);
    expect(sg).toHaveBeenCalled();
    expect(ss).not.toHaveBeenCalled();
    expect(instDisposed).toHaveBeenCalledOnce();
    expect(tex.dispose).toHaveBeenCalled();
    expect(parent.children).toHaveLength(0);
  });

  it("places characters on the walkable surface a family draws, else on the analysis' ground", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // the cell (2, 2) is walkable ground at height 0; the family lays its own floor there at 1.5
    const grid = fakeGrid(['....', '.#..', '....']);
    const opts = { info: fakeInfo(), generalPrimary: false, indoor: false, underground: false, underwater: false };
    const a = fakeAnalysis(['....', '.#..', '....'], { margin: 14 });
    const floor = (fail?: 'extract' | 'build'): Family<number> => ({
      name: 'floor',
      extract(_c, claims) {
        const i = a.idx(2, 2);
        claims.claim(i, CLAIM_SURFACE);
        claims.surfaceY[i] = 1.5;
        if (fail === 'extract') throw new Error('boom');
        return i;
      },
      build() {
        if (fail === 'build') throw new Error('boom');
        return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      },
    });
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    const mats = createWorldMaterials(atlas.target.texture, u);
    const modern = { style: 'modern' as const, events: NO_EVENTS, quality: 'medium' as const };
    const world = new World(atlas, mats, u, [floor()]);
    world.build(grid, opts, modern);
    expect(world.heightAt(2.5, 2.5)).toBe(1.5);
    expect(world.heightAt(2.9, 2.1)).toBe(1.5); // (the whole cell)
    expect(world.heightAt(1.5, 2.5)).toBe(a.height[a.idx(1, 2)]); // other cells: the analysis
    expect(world.heightAt(3.5, 0.5)).toBe(a.height[a.idx(3, 0)]);
    // Retro, and a family whose extract or build fails: the analysis height, as before
    world.build(grid, opts, { ...modern, style: 'retro' });
    expect(world.heightAt(2.5, 2.5)).toBe(a.height[a.idx(2, 2)]);
    for (const fail of ['extract', 'build'] as const) {
      const w = new World(atlas, mats, u, [floor(fail)]);
      w.build(grid, opts, modern);
      expect(w.heightAt(2.5, 2.5)).toBe(a.height[a.idx(2, 2)]);
    }
    warn.mockRestore();
  });

  it('rebuilding a World leaves exactly one kit group', () => {
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    const mats = createWorldMaterials(atlas.target.texture, u);
    const world = new World(atlas, mats, u, [claimer('box', 5, CLAIM_OBJECT)]);
    const opts = { info: fakeInfo(), generalPrimary: false, indoor: false, underground: false, underwater: false };
    const ctxB = { style: 'modern' as const, events: NO_EVENTS, quality: 'medium' as const };
    world.build(fakeGrid(['....', '.#..', '....']), opts, ctxB);
    world.build(fakeGrid(['....', '.#..', '....']), opts, ctxB);
    expect(world.group.children.filter((o) => o.name === 'kit')).toHaveLength(1);
    world.build(fakeGrid(['....', '.#..', '....']), opts, { ...ctxB, style: 'retro' });
    expect(world.group.children.filter((o) => o.name === 'kit')).toHaveLength(0);
  });
});

describe('grass overlay sprite', () => {
  it('is hidden in Modern only where 3D blades stand on its cell', () => {
    expect(hidesGrassOverlay(SpriteKind.Grass, 'modern', true)).toBe(true);
    // short grass, or tall grass the grass family did not draw (its build failed): the GBA overlay
    expect(hidesGrassOverlay(SpriteKind.Grass, 'modern', false)).toBe(false);
    expect(hidesGrassOverlay(SpriteKind.Grass, 'retro', true)).toBe(false);
    expect(hidesGrassOverlay(SpriteKind.Upright, 'modern', true)).toBe(false);
  });

  it("the world knows where the grass family's blades stand (none in Retro, nor after a failed build)", () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const grid = fakeGrid(['....', '....']);
    const opts = { info: fakeInfo(), generalPrimary: false, indoor: false, underground: false, underwater: false };
    const a = fakeAnalysis(['....', '....'], { margin: 14 });
    const blades = (fail?: 'build'): Family<number> => ({
      name: 'grass',
      extract(_c, claims) { claims.claim(a.idx(2, 1), CLAIM_TOP | CLAIM_BLADES); return 0; },
      build() {
        if (fail) throw new Error('boom');
        return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
      },
    });
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    const mats = createWorldMaterials(atlas.target.texture, u);
    const modern = { style: 'modern' as const, events: NO_EVENTS, quality: 'medium' as const };
    const world = new World(atlas, mats, u, [blades()]);
    world.build(grid, opts, modern);
    expect(world.hasGrassBlades(2.5, 1.5)).toBe(true);
    expect(world.hasGrassBlades(2.1, 1.9)).toBe(true);
    expect(world.hasGrassBlades(1.5, 1.5)).toBe(false);
    expect(world.hasGrassBlades(-40, -40)).toBe(false); // (outside the grid)
    world.build(grid, opts, { ...modern, style: 'retro' });
    expect(world.hasGrassBlades(2.5, 1.5)).toBe(false);
    const failed = new World(atlas, mats, u, [blades('build')]);
    failed.build(grid, opts, modern);
    expect(failed.hasGrassBlades(2.5, 1.5)).toBe(false);
    warn.mockRestore();
  });
});
