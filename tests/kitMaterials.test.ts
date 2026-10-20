import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { kitMaterial, createKitUniforms, FADE_PER_SPRITE_PX, MAX_ACTORS, setKitActors, setKitFocus } from '../src/render/kit/materials';
import { CAMERA_PRESETS } from '../src/render/overworld/overworldView';

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
    // a 2-unit character 6 units away fills 2 / 12 of the 400 px: radius FADE_PER_SPRITE_PX of that
    expect(u.uFadeRadius.value).toBeCloseTo(FADE_PER_SPRITE_PX * 400 * (2 / 12));
  });
  it('scales the radius with the projected height of the character (zoomed in, the battle zoom)', () => {
    const u = createKitUniforms();
    setKitFocus(u, new THREE.Vector3(0, 0, 4), camera, 800, 400); // 6 units away
    const far = u.uFadeRadius.value;
    setKitFocus(u, new THREE.Vector3(0, 0, 7), camera, 800, 400); // 3 units away: twice as tall
    expect(u.uFadeRadius.value).toBeCloseTo(2 * far);
    setKitFocus(u, new THREE.Vector3(0, 0, 4), camera, 1600, 800); // a target of twice the pixels
    expect(u.uFadeRadius.value).toBeCloseTo(2 * far);
  });
  it('keeps the tuned radius (0.11 x the target height) for the Classic camera at its default zoom', () => {
    // as OverworldView places it: looking at the target + 0.9 up, from the preset's pitch and distance
    const p = CAMERA_PRESETS[0];
    const cam = new THREE.PerspectiveCamera(p.fov, 1.6, 0.1, 500);
    const look = new THREE.Vector3(10, 0.9, 10);
    cam.position.copy(look).add(new THREE.Vector3(0, Math.sin(p.pitch), Math.cos(p.pitch)).multiplyScalar(p.distance));
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const u = createKitUniforms();
    setKitFocus(u, new THREE.Vector3(10, 0, 10), cam, 1280, 800);
    expect(u.uFadeRadius.value / (0.11 * 800)).toBeCloseTo(1, 1);
  });
  it('caps the radius at half the target height (a character right under the camera)', () => {
    const u = createKitUniforms();
    setKitFocus(u, new THREE.Vector3(0, -0.7, 9.5), camera, 800, 400);
    expect(u.uFadeRadius.value).toBe(200);
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
  it('the shadow-depth twin sways with the wind but does not bend around actors', () => {
    // KIT_BEND parts the blades as the camera sees them (cameraPosition); in the shadow pass that is
    // the light's camera, so the shadow would bend the wrong way: the twin casts the unbent blades.
    const k = kitMaterial(u, { wind: 0.08, windHeight: 0.6, bend: true });
    expect(k.material.defines).toHaveProperty('KIT_BEND');
    expect(k.depth!.defines).toHaveProperty('KIT_WIND');
    expect(k.depth!.defines).not.toHaveProperty('KIT_BEND');
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
