import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { kitMaterial, createKitUniforms, MAX_ACTORS, setKitActors, setKitFocus } from '../src/render/kit/materials';

describe('setKitFocus', () => {
  // Looks straight down -Z from (0, 0.7, 10): a point at the camera's height projects to the centre.
  const camera = new THREE.PerspectiveCamera(90, 2, 0.1, 100);
  camera.position.set(0, 0.7, 10);
  camera.lookAt(0, 0.7, 0);
  camera.updateMatrixWorld();

  it('centres on the chest (feet + 0.7) in target pixels, depth along the view axis', () => {
    const u = createKitUniforms();
    setKitFocus(u, new THREE.Vector3(0, 0, 4), camera, 800, 400);
    expect(u.uFocusPx.value.x).toBeCloseTo(400);
    expect(u.uFocusPx.value.y).toBeCloseTo(200);
    expect(u.uFocusDepth.value).toBeCloseTo(6);
    expect(u.uFadeRadius.value).toBeCloseTo(44);
  });
  it('maps off-centre points with y up (gl_FragCoord convention)', () => {
    const u = createKitUniforms();
    // fov 90 at depth 5: the top edge is 5 units above the axis, the right edge 10 units right
    // (aspect 2); the chest lands half-way to both.
    setKitFocus(u, new THREE.Vector3(5, 2.5, 5), camera, 800, 400);
    expect(u.uFocusPx.value.x).toBeCloseTo(600);
    expect(u.uFocusPx.value.y).toBeCloseTo(300);
  });
  it('null disables the fade', () => {
    const u = createKitUniforms();
    setKitFocus(u, new THREE.Vector3(0, 0, 4), camera, 800, 400);
    setKitFocus(u, null, camera, 800, 400);
    expect(u.uFadeRadius.value).toBe(0);
  });
});

describe('kitMaterial', () => {
  const u = createKitUniforms();
  it('wind adds a matching depth material', () => {
    const k = kitMaterial(u, { wind: 0.1, windHeight: 2 });
    expect(k.material.defines).toHaveProperty('KIT_WIND');
    expect(k.depth).not.toBeNull();
  });
  it('rigid materials need no custom depth', () => {
    expect(kitMaterial(u, { fade: true }).depth).toBeNull();
  });
  it('features map to defines and distinct program keys', () => {
    const a = kitMaterial(u, { fade: true, pattern: 'roofTiles' }).material;
    const b = kitMaterial(u, { fade: true }).material;
    expect(a.defines).toHaveProperty('KIT_FADE');
    expect(a.defines).toHaveProperty('KIT_PATTERN_ROOF');
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });
  it('different GLSL hooks get different program keys without a hookKey', () => {
    const a = kitMaterial(u, { fade: true, fragColor: 'diffuseColor.rgb *= 0.5;' }).material;
    const b = kitMaterial(u, { fade: true, fragColor: 'diffuseColor.rgb *= 0.7;' }).material;
    const a2 = kitMaterial(u, { fade: true, fragColor: 'diffuseColor.rgb *= 0.5;' }).material;
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toBe(a2.customProgramCacheKey());
  });
  it('vertTransform alone adds a depth material', () => {
    const k = kitMaterial(u, { vertTransform: 'transformed.y += 0.1;' });
    expect(k.depth).not.toBeNull();
    expect(k.depth!.defines).not.toHaveProperty('KIT_WIND');
  });
});

describe('setKitActors', () => {
  it('fills the grass-bending slots with the feet nearest the focus, the rest far away', () => {
    const u = createKitUniforms();
    const feet = Array.from({ length: MAX_ACTORS + 2 }, (_, i) => ({ x: 10 - i, y: 0, z: 0 }));
    setKitActors(u, feet, new THREE.Vector3(0, 0, 0));
    expect(u.uActors.value.map((v) => v.x)).toEqual(feet.slice(2).reverse().map((f) => f.x));
    setKitActors(u, [{ x: 3, y: 1, z: 4 }], new THREE.Vector3(0, 0, 0));
    expect(u.uActors.value[0].toArray()).toEqual([3, 1, 4]);
    for (const v of u.uActors.value.slice(1)) expect(v.x).toBeGreaterThan(1000);
  });
});
