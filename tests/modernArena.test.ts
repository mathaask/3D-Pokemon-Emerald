import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModernArena, type ArenaPart } from '../src/render/battle/modernArena';
import { createKitUniforms } from '../src/render/kit/materials';
import { defaultArenaColors } from '../src/render/battle/bgSample';

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
});
