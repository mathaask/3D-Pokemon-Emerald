import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BattleSky } from '../src/render/battle/sky';
import { arenaLook } from '../src/render/battle/look';
import { arenaPalette } from '../src/render/battle/palette';

describe('BattleSky', () => {
  it('draws after the arena at the far plane, never writing depth', () => {
    const s = new BattleSky();
    const m = s.mesh.material as THREE.ShaderMaterial;
    expect(s.mesh.renderOrder).toBe(10);
    expect(m.depthWrite).toBe(false); expect(m.depthTest).toBe(true); expect(m.side).toBe(THREE.BackSide);
    expect(m.vertexShader).toContain('xyww');
    expect(m.fragmentShader).toContain('arenaClouds');
  });
  it('has clouds and night stars outdoors, a plain gradient indoors', () => {
    const s = new BattleSky(), u = (s.mesh.material as THREE.ShaderMaterial).uniforms;
    s.setLook(arenaLook('grass', arenaPalette('grass', null), 22), 'outdoor', 0);
    expect(u.uClouds.value).toBe(1); expect(u.uNight.value).toBe(1);
    s.setLook(arenaLook('gym', arenaPalette('gym', null), 22), 'indoor', 0);
    expect(u.uClouds.value).toBe(0); expect(u.uNight.value).toBe(0);
  });
});
