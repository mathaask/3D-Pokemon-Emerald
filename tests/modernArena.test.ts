import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModernArena, ArenaColorLock, type ArenaPart } from '../src/render/battle/modernArena';
import { createKitUniforms } from '../src/render/kit/materials';
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
