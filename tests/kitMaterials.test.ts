import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { kitMaterial, releaseKitMaterial, createKitUniforms, FADE_CORE, FADE_PER_SPRITE_PX, MAX_ACTORS, setKitActors, setKitFocus, WARM_GLOW_GLSL } from '../src/render/kit/materials';
import { createWorldMaterials } from '../src/render/overworld/materials';
import { CAMERA_PRESETS } from '../src/render/overworld/overworldView';

describe('setKitFocus', () => {
  // Looks straight down -Z from (0, 0.7, 10): a point at the camera's height projects to the centre.
  const camera = new THREE.PerspectiveCamera(90, 2, 0.1, 100);
  camera.position.set(0, 0.7, 10);
  camera.lookAt(0, 0.7, 0);
  camera.updateMatrixWorld();

  it("centres on the sprite's middle (feet + 1) in target pixels, depth of the chest along the view axis", () => {
    const u = createKitUniforms();
    setKitFocus(u, new THREE.Vector3(0, 0, 4), camera, 800, 400);
    expect(u.uFocusPx.value.x).toBeCloseTo(400);
    // fov 90 at depth 6: the middle, 0.3 above the axis, is 0.3 / 6 of the half-height up
    expect(u.uFocusPx.value.y).toBeCloseTo(200 + 200 * (0.3 / 6));
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
    // (aspect 2); the sprite's middle lands half-way to both.
    setKitFocus(u, new THREE.Vector3(5, 2.2, 5), camera, 800, 400);
    expect(u.uFocusPx.value.x).toBeCloseTo(600);
    expect(u.uFocusPx.value.y).toBeCloseTo(300);
  });
  it('the whole sprite, feet to head top, lies in the fully faded core (never hidden), from every camera', () => {
    // as OverworldView places the camera: looking at the target + 0.9 up, from a preset's pitch and
    // distance, at its zoom and with the battle zoom pushing in
    for (const p of CAMERA_PRESETS) {
      for (const zoom of [0.45, 1, 2.5]) {
        const cam = new THREE.PerspectiveCamera(p.fov, 1.6, 0.1, 500);
        const look = new THREE.Vector3(10, 0.9, 10);
        cam.position.copy(look).add(new THREE.Vector3(0, Math.sin(p.pitch), Math.cos(p.pitch)).multiplyScalar(p.distance * zoom));
        cam.lookAt(look);
        cam.updateMatrixWorld();
        const u = createKitUniforms();
        const feet = new THREE.Vector3(10, 0, 10);
        setKitFocus(u, feet, cam, 1280, 800);
        const r = u.uFadeRadius.value;
        if (r >= 400) continue; // (capped: a character filling the screen)
        // feet, head top (2 up), and the head's corners (a 16-px sprite's head spans about +-0.3, its feet +-0.25)
        for (const [dx, dy] of [[0, 0], [0, 2], [-0.3, 2], [0.3, 2], [-0.25, 0], [0.25, 0]]) {
          const q = new THREE.Vector3(feet.x + dx, feet.y + dy, feet.z).project(cam);
          const d = Math.hypot((q.x * 0.5 + 0.5) * 1280 - u.uFocusPx.value.x, (q.y * 0.5 + 0.5) * 800 - u.uFocusPx.value.y);
          expect(d, `${p.name} zoom ${zoom} (${dx}, ${dy})`).toBeLessThanOrEqual(FADE_CORE * r);
        }
      }
    }
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
  it('house windows, special facades and the legacy walls glow in one warm colour', () => {
    const shader = () => ({ uniforms: {}, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <emissivemap_fragment>' });
    const kitGlass = shader();
    kitMaterial(u, { glow: 1.6 }).material.onBeforeCompile(kitGlass as never, undefined as never);
    expect(kitGlass.fragmentShader).toContain(`totalEmissiveRadiance += ${WARM_GLOW_GLSL}`);
    const legacy = shader();
    createWorldMaterials(new THREE.Texture(), u).opaque.onBeforeCompile(legacy as never, undefined as never);
    expect(legacy.fragmentShader).toContain(`totalEmissiveRadiance += ${WARM_GLOW_GLSL}`);
    expect(WARM_GLOW_GLSL).toBe('vec3(1.0, 0.72, 0.38)');
  });
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
  it("ends a one-line fragHead with a newline (three's shader starts with a #define)", () => {
    const k = kitMaterial(u, { fragHead: 'uniform sampler2D tX;', fragEmissive: 'totalEmissiveRadiance += vec3(texture(tX, vec2(0.0)).r);' });
    const shader = { uniforms: {}, vertexShader: '', fragmentShader: '#define STANDARD\n#include <emissivemap_fragment>' };
    k.material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain('uniform sampler2D tX;\n#define STANDARD');
  });
  it('vertTransform alone adds a depth material', () => {
    const k = kitMaterial(u, { vertTransform: 'transformed.y += 0.1;' });
    expect(k.depth).not.toBeNull();
    expect(k.depth!.defines).not.toHaveProperty('KIT_WIND');
  });
});

describe('kit material pool (shader programs live for the session)', () => {
  // three destroys a shader program when the last material using it is disposed: a world rebuild that
  // disposed its kit materials made the next build's identical ones recompile every program on the
  // first frame (+80-100 ms per map crossing). Released kit materials wait for the next build instead.
  const shader = () => ({ uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <begin_vertex>', fragmentShader: '#include <color_fragment>' });
  const opts = (tex: THREE.Texture, map: THREE.Texture | null, tint: number) => ({
    vertexColors: true, roughness: 0.6, fade: true, wind: 0.1, windHeight: 2, map, color: tint,
    uniforms: { tCells: { value: tex }, uSize: { value: new THREE.Vector2(tint, 1) } },
    fragHead: 'uniform sampler2D tCells;', fragColor: 'diffuseColor.rgb *= texture(tCells, vec2(0.5)).rgb;', hookKey: 'poolTest',
  });

  it("hands a released material (and its depth twin) to the next build, with that build's values", () => {
    const u = createKitUniforms();
    const t1 = new THREE.Texture(), m1 = new THREE.Texture(), t2 = new THREE.Texture(), m2 = new THREE.Texture();
    const a = kitMaterial(u, opts(t1, m1, 0xff0000));
    const first = shader();
    a.material.onBeforeCompile(first as never, undefined as never);
    expect(first.uniforms.tCells.value).toBe(t1);
    let disposed = 0;
    a.material.addEventListener('dispose', () => disposed++);
    a.depth!.addEventListener('dispose', () => disposed++);
    releaseKitMaterial(a.material);
    releaseKitMaterial(a.depth!); // (a mesh's customDepthMaterial: released with its twin, once)
    const b = kitMaterial(u, { ...opts(t2, m2, 0x00ff00), roughness: 0.3, wind: 0.2 });
    expect(b.material).toBe(a.material);
    expect(b.depth).toBe(a.depth);
    expect(disposed).toBe(0);
    expect(b.material.map).toBe(m2);
    expect(b.material.roughness).toBe(0.3);
    expect(b.material.color.getHex()).toBe(new THREE.Color(0x00ff00).getHex());
    // the uniform objects its programs were compiled with now hold the new build's values
    expect(first.uniforms.tCells.value).toBe(t2);
    expect((first.uniforms.uSize.value as THREE.Vector2).x).toBe(0x00ff00);
    expect(first.uniforms.uWindAmp.value).toBe(0.2);
    const again = shader();
    b.material.onBeforeCompile(again as never, undefined as never);
    expect(again.uniforms.tCells).toBe(first.uniforms.tCells);
  });

  it('a released material keeps no texture of its old build', () => {
    const u = createKitUniforms();
    const a = kitMaterial(u, opts(new THREE.Texture(), new THREE.Texture(), 1));
    const s = shader();
    a.material.onBeforeCompile(s as never, undefined as never);
    releaseKitMaterial(a.material);
    expect(a.material.map).toBeNull();
    expect(s.uniforms.tCells.value).toBeNull();
  });

  it('never hands out a material in use, nor one compiled for other options', () => {
    const u = createKitUniforms();
    const t = new THREE.Texture();
    const a = kitMaterial(u, opts(t, t, 1));
    expect(kitMaterial(u, opts(t, t, 1)).material).not.toBe(a.material); // (a is still in use)
    releaseKitMaterial(a.material);
    expect(kitMaterial(u, { ...opts(t, t, 1), side: THREE.DoubleSide }).material).not.toBe(a.material);
    expect(kitMaterial(u, opts(t, null, 1)).material).not.toBe(a.material);
    expect(kitMaterial(u, { ...opts(t, t, 1), pattern: 'planks' as const }).material).not.toBe(a.material);
    expect(kitMaterial(u, { ...opts(t, t, 1), fragColor: '' }).material).not.toBe(a.material);
    expect(kitMaterial(createKitUniforms(), opts(t, t, 1)).material).not.toBe(a.material); // (another view)
    expect(kitMaterial(u, opts(t, t, 1)).material).toBe(a.material);
  });

  it("is reused without carrying a water surface's depthWrite to the next user", () => {
    const u = createKitUniforms();
    const a = kitMaterial(u, { transparent: true, depthWrite: false });
    expect(a.material.depthWrite).toBe(false);
    releaseKitMaterial(a.material);
    const b = kitMaterial(u, { transparent: true });
    expect(b.material).toBe(a.material);
    expect(b.material.depthWrite).toBe(true);
  });

  it('other materials are disposed', () => {
    const m = new THREE.MeshBasicMaterial();
    let disposed = false;
    m.addEventListener('dispose', () => { disposed = true; });
    releaseKitMaterial(m);
    expect(disposed).toBe(true);
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
