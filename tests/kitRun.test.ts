import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { extractAll, buildAll, disposeKit, type Family, type KitContext } from '../src/render/kit/semantics';
import { createKitUniforms } from '../src/render/kit/materials';
import { CLAIM_OBJECT, CLAIM_SURFACE } from '../src/render/overworld/claims';
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

  it('rebuilding a World leaves exactly one kit group', () => {
    const atlas = new MetatileAtlas({ vram: null, palette: null } as never, 1);
    const u = createKitUniforms();
    const mats = createWorldMaterials(atlas.target.texture, u);
    const world = new World(atlas, mats, u, [claimer('box', 5, CLAIM_OBJECT)]);
    const opts = { info: fakeInfo(), generalPrimary: false, indoor: false, underground: false };
    const ctxB = { style: 'modern' as const, events: NO_EVENTS, quality: 'medium' as const };
    world.build(fakeGrid(['....', '.#..', '....']), opts, ctxB);
    world.build(fakeGrid(['....', '.#..', '....']), opts, ctxB);
    expect(world.group.children.filter((o) => o.name === 'kit')).toHaveLength(1);
    world.build(fakeGrid(['....', '.#..', '....']), opts, { ...ctxB, style: 'retro' });
    expect(world.group.children.filter((o) => o.name === 'kit')).toHaveLength(0);
  });
});
