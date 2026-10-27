import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModernArena, ArenaColorLock, type ArenaPart } from '../src/render/battle/modernArena';
import { createKitUniforms, kitMaterialKind } from '../src/render/kit/materials';
import { GROUND_PART } from '../src/render/battle/parts/ground';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';

const part = (name: string, kinds: ArenaPart['kinds'], build: ArenaPart['build']): ArenaPart => ({ name, kinds, catalogue: () => [], build });

describe('ModernArena', () => {
  it('covers a kind only where a ground part does', () => {
    expect(new ModernArena(createKitUniforms(), []).covers('grass')).toBe(false);
    const a = new ModernArena(createKitUniforms(), [part('ground', ['grass'], () => new THREE.Group())]);
    expect(a.covers('grass')).toBe(true); expect(a.covers('cave')).toBe(false);
  });
  it('builds once per kind, colours and quality, and replaces the previous build', () => {
    let n = 0;
    const a = new ModernArena(createKitUniforms(), [part('ground', 'all', () => { n++; return new THREE.Group(); })]);
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(true);
    a.build('grass', defaultArenaColors('grass'), 'medium');
    expect(n).toBe(1);
    a.build('sand', defaultArenaColors('sand'), 'medium');
    expect(n).toBe(2);
    expect(a.group.children).toHaveLength(1);
  });
  it('empties itself when a part throws and warns once per kind', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = new ModernArena(createKitUniforms(), [part('ground', 'all', () => new THREE.Group()), part('trees', 'all', () => { throw new Error('boom'); })]);
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(false);
    expect(a.failed).toBe(true);
    expect(a.group.children).toHaveLength(0);
    a.build('grass', defaultArenaColors('grass'), 'high');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  /** A mesh whose geometry throws when freed (a part handing back a malformed object). */
  const badMesh = () => {
    const m = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial());
    m.geometry.dispose = () => { throw new Error('dispose'); };
    return m;
  };
  it('fails safe when freeing the failed build throws: failed and warned first, the arena emptied, the key left failed', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = new ModernArena(createKitUniforms(), [part('ground', 'all', badMesh), part('trees', 'all', () => { throw new Error('boom'); })]);
    expect(() => a.build('grass', defaultArenaColors('grass'), 'medium')).not.toThrow();
    expect(a.failed).toBe(true);
    expect(a.group.children).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("arena part 'trees' failed for grass");
    // (the same call again — the identity fast path, then the key's —: still failed, today's arena)
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(false);
    expect(a.build('grass', { ...defaultArenaColors('grass') }, 'medium')).toBe(false);
    warn.mockRestore();
  });
  it('builds the next arena when freeing the last one throws: the old one dropped, the new one alone', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let n = 0;
    const a = new ModernArena(createKitUniforms(), [part('ground', 'all', () => (n++ === 0 ? badMesh() : new THREE.Group()))]);
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(true);
    expect(a.build('sand', defaultArenaColors('sand'), 'medium')).toBe(true);
    expect(a.failed).toBe(false);
    expect(a.group.children).toHaveLength(1);
    expect((a.group.children[0] as THREE.Mesh).isMesh).toBeFalsy();
    warn.mockRestore();
  });
  it('locks the colours: defaults until the first valid sample, then that sample for the battle', () => {
    const lock = new ArenaColorLock();
    const a = { ...defaultArenaColors('grass'), platform: [0.1, 0.8, 0.2] as [number, number, number] };
    const b = { ...defaultArenaColors('grass'), platform: [0.9, 0.1, 0.1] as [number, number, number] };
    expect(lock.observe('grass', null)).toEqual(defaultArenaColors('grass'));
    expect(lock.observe('grass', a)).toEqual(a);
    expect(lock.observe('grass', b)).toEqual(a);
    expect(lock.observe('grass', null)).toEqual(a);
    expect(lock.observe('sand', null)).toEqual(defaultArenaColors('sand'));
  });
  it('hands out a fresh colours object exactly when the colours change (the build\'s identity fast path), and says when it holds a sample', () => {
    const lock = new ArenaColorLock();
    const d = lock.observe('grass', null);
    expect(lock.observe('grass', null)).toBe(d);
    expect(lock.locked('grass')).toBe(false);
    const sample = { ...defaultArenaColors('grass'), platform: [0.2, 0.7, 0.3] as [number, number, number] };
    const s = lock.observe('grass', sample);
    expect(s).not.toBe(d); expect(s).not.toBe(sample);
    sample.platform[0] = 0.9;   // (the caller's object is not kept)
    expect(lock.observe('grass', null).platform[0]).toBe(0.2);
    expect(lock.observe('grass', null)).toBe(s);
    expect(lock.locked('grass')).toBe(true); expect(lock.locked('sand')).toBe(false);
  });
  it('builds every kind with the foundation parts', () => {
    const a = new ModernArena(createKitUniforms());
    for (const k of ARENA_KINDS) { expect(a.covers(k)).toBe(true); expect(a.build(k, defaultArenaColors(k), 'medium'), k).toBe(true); }
    a.dispose();
  });
});

describe('ModernArena: freeing a build (review B M4)', () => {
  /** A build's kit materials and the DataTextures their uniforms hold (onBeforeCompile on a stub hands the slots over). */
  const contents = (root: THREE.Object3D) => {
    const materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        if (!kitMaterialKind(mat)) continue;
        materials.add(mat);
        const s = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
        mat.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
        for (const u of Object.values(s.uniforms)) if ((u.value as THREE.DataTexture | null)?.isDataTexture) textures.add(u.value as THREE.Texture);
      }
    });
    return { materials, textures };
  };
  const sampled = (kind: 'pond' | 'grass') => ({ ...defaultArenaColors(kind), platform: [0.3, 0.6, 0.25] as [number, number, number] });

  it("frees a build's textures and hands its kit materials back on a rebuild: the rebuild draws with the very same ones", () => {
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const a = new ModernArena(createKitUniforms());
    expect(a.build('pond', defaultArenaColors('pond'), 'medium')).toBe(true);
    const first = contents(a.group);
    // (the ground's cells and the water's field: the lily pads have no tops of their own)
    expect(first.textures.size).toBe(2);
    expect(dispose.mock.contexts.filter((t) => first.textures.has(t as THREE.Texture))).toHaveLength(0);
    // (the battle's sampled colours: a rebuild of the same kind)
    expect(a.build('pond', sampled('pond'), 'medium')).toBe(true);
    for (const t of first.textures) expect(dispose.mock.contexts, 'a texture of the first build freed').toContain(t);
    const second = contents(a.group);
    expect(second.materials).toEqual(first.materials);
    // (a kind of other parts: of each material kind both draw with, it takes the pooled ones before making any)
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(true);
    for (const t of second.textures) expect(dispose.mock.contexts).toContain(t);
    const third = [...contents(a.group).materials];
    const of = (list: Iterable<THREE.Material>, kind: string | null) => [...list].filter((m) => kitMaterialKind(m) === kind);
    let shared = 0;
    for (const kind of new Set(third.map((m) => kitMaterialKind(m)))) {
      const was = of(second.materials, kind), now = of(third, kind);
      expect(now.filter((m) => second.materials.has(m)).length, kind!).toBe(Math.min(was.length, now.length));
      shared += Math.min(was.length, now.length);
    }
    expect(shared).toBeGreaterThan(0);
    a.dispose();
    dispose.mockRestore();
  });

  it('leaves nothing of a build a part fails in: its textures freed, its kit materials back in the pool', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispose = vi.spyOn(THREE.Texture.prototype, 'dispose');
    const u = createKitUniforms();
    let built: THREE.Mesh | null = null, extra: THREE.DataTexture | null = null, cells = new Set<THREE.Texture>();
    const ground = part('ground', 'all', (ctx) => {
      built = GROUND_PART.build(ctx) as THREE.Mesh;
      cells = contents(built).textures;
      return built;
    });
    const failing = part('boom', 'all', (ctx) => {
      ctx.disposables.push(extra = new THREE.DataTexture(new Uint8Array(4), 1, 1));
      throw new Error('boom');
    });
    const a = new ModernArena(u, [ground, failing]);
    expect(a.build('grass', defaultArenaColors('grass'), 'medium')).toBe(false);
    expect(a.group.children).toHaveLength(0);
    expect(cells.size).toBe(1);
    for (const t of [...cells, extra!]) expect(dispose.mock.contexts, 'a texture of the failed build freed').toContain(t);
    // (the ground's material is back in the pool: the next build takes it)
    const material = built!.material;
    const b = new ModernArena(u, [ground]);
    expect(b.build('grass', defaultArenaColors('grass'), 'medium')).toBe(true);
    expect(built!.material).toBe(material);
    expect((b.group.children[0] as THREE.Mesh).material).toBe(material);
    b.dispose();
    dispose.mockRestore();
    warn.mockRestore();
  });
});
