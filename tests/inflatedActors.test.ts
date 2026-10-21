import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InflatedActors, ACTOR_GRID, LAMP_CEILING, SHADOW_PUSH, SHADE_GAIN, SHADE_STEP, MASK_GLSL } from '../src/render/actors/inflatedActors';
import { heights, INFLATE } from '../src/render/actors/inflateMath';
import { XBR_GLSL } from '../src/render/actors/xbr.glsl';
import { Billboards } from '../src/render/overworld/billboards';

const spec = (x: number) => ({ footX: x, footY: 0, footZ: 3, width: 1, height: 2, lift: 0, flat: false,
  slot: { u0: 0, v0: 32 / 512, u1: 16 / 1024, v1: 0 } });
const make = () => new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() });

describe('InflatedActors', () => {
  it('draws one instanced 16x32 grid per actor', () => {
    const a = make();
    a.set([spec(1), spec(2)], new THREE.Vector3(1, 0, 0));
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.instanceCount).toBe(2);
    expect(g.getAttribute('position').count).toBe((ACTOR_GRID.x + 1) * (ACTOR_GRID.y + 1));
    expect(g.getAttribute('aFoot').getX(1)).toBe(2);
  });
  it('shares its instance buffers with a 4-vertex contact-shadow geometry', () => {
    const a = make();
    const s = a.geometryForShadows();
    a.set([spec(1)], new THREE.Vector3(1, 0, 0));
    expect(s.instanceCount).toBe(1);
    expect(s.getAttribute('aFoot')).toBe((a.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('aFoot'));
    expect(s.getAttribute('position').count).toBe(4);
  });
  it('re-uploads only the instance attributes that changed, over every instance ever set', () => {
    const a = make();
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    const attr = (k: string) => g.getAttribute(k) as THREE.InstancedBufferAttribute;
    const right = new THREE.Vector3(1, 0, 0);
    a.set([spec(1), spec(2)], right);
    const v = () => ['aFoot', 'aSize', 'aUv'].map((k) => attr(k).version);
    const first = v();
    a.set([spec(1), spec(2)], right); // a still scene: nothing to upload
    expect(v()).toEqual(first);
    a.set([spec(1)], right);          // fewer actors, same data
    expect(v()).toEqual(first);
    a.set([spec(1.5)], right);        // one moved: its feet only, over both instances ever set
    expect(v()).toEqual([first[0] + 1, first[1], first[2]]);
    expect(attr('aFoot').updateRanges).toEqual([{ start: 0, count: 6 }]);
  });
  it('re-uploads only the attribute a change touches (a new animation frame: uv; a jump: size)', () => {
    const a = make();
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    const v = () => ['aFoot', 'aSize', 'aUv'].map((k) => (g.getAttribute(k) as THREE.BufferAttribute).version);
    const right = new THREE.Vector3(1, 0, 0);
    a.set([spec(1)], right);
    const first = v();
    a.set([{ ...spec(1), slot: { u0: 16 / 1024, v0: 32 / 512, u1: 32 / 1024, v1: 0 } }], right);
    expect(v()).toEqual([first[0], first[1], first[2] + 1]);
    a.set([{ ...spec(1), slot: { u0: 16 / 1024, v0: 32 / 512, u1: 32 / 1024, v1: 0 }, lift: 0.5 }], right);
    expect(v()).toEqual([first[0], first[1] + 1, first[2] + 1]);
  });
  it('casts and receives shadows through a depth twin drawn on both faces with the same relief', () => {
    const a = make();
    expect(a.mesh.castShadow && a.mesh.receiveShadow).toBe(true);
    const depth = a.mesh.customDepthMaterial as THREE.ShaderMaterial;
    expect(depth).toBeInstanceOf(THREE.ShaderMaterial);
    // three gives a custom depth material the main material's shadowSide (default: the opposite face)
    expect((a.mesh.material as THREE.MeshStandardMaterial).shadowSide).toBe(THREE.DoubleSide);
    // the twin rises like the mesh (along the ray to the eye, by the field) and is pushed away from the light
    expect(depth.vertexShader).toContain('normalize(uEye - card) * (fieldH(auv, vRect) * pxWorld * relief)');
    expect(depth.vertexShader).toContain(`mvPosition.z -= ${SHADOW_PUSH}`);
  });
  it('patches the standard shader chunks it relies on (catches three chunk renames)', () => {
    const s = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (make().mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
    expect(s.vertexShader).toContain('tField');
    expect(s.vertexShader).not.toContain('#include <begin_vertex>');
    expect(s.vertexShader).not.toContain('#include <beginnormal_vertex>');
    expect(s.fragmentShader).toContain('discard');
    expect(s.fragmentShader).toContain('uRim');
    // the light floor and the point lights' soft ceiling (lights_pars_begin inlined and patched)
    expect(s.fragmentShader).toContain('uFloor');
    expect(s.fragmentShader).not.toContain('#include <lights_pars_begin>');
    expect(s.fragmentShader).toContain(`light.color /= 1.0 + max(light.color.r, max(light.color.g, light.color.b)) / ${LAMP_CEILING.toFixed(1)};`);
    // the shading slope (not the relief's) and the highlight shoulder before the output
    expect(s.fragmentShader).toContain('shadeSlope(vAtlasUv, vRect)');
    expect(s.fragmentShader.indexOf('outgoingLight *=')).toBeLessThan(s.fragmentShader.indexOf('#include <opaque_fragment>'));
    // mean-preserving relief light (Lambert on facing + slope), the floor's hue blend, the actor mask last
    expect(s.fragmentShader).toContain('reflectedLight.directDiffuse *= actorSec');
    expect(s.fragmentShader).toContain('smoothstep(1.5, 4.0, k)');
    expect(s.fragmentShader.indexOf(MASK_GLSL)).toBeGreaterThan(s.fragmentShader.indexOf('#include <dithering_fragment>'));
  });
  it('shades mean-preserving: the shading slope averages to ~0 over a sprite (Lambert on facing + slope keeps the card\'s mean light)', () => {
    // a 16x32 character: head disc, body, two legs (rows bottom-up, as the atlas)
    const w = 16, h = 32, alpha = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const head = (x - 7.5) ** 2 + (y - 24) ** 2 < 36, body = x >= 3 && x <= 12 && y >= 5 && y <= 19;
      const legs = y < 5 && ((x >= 4 && x <= 6) || (x >= 9 && x <= 11));
      alpha[y * w + x] = head || body || legs ? 1 : 0;
    }
    const hs = heights(alpha, w, h, INFLATE);
    const at = (x: number, y: number) => hs[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    const k = SHADE_GAIN * 2 / INFLATE.amp ** 2, s = SHADE_STEP;
    let sx = 0, sy = 0, mag = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (!alpha[y * w + x]) continue;
      const gx = k * at(x, y) * (at(x + s, y) - at(x - s, y)) / (2 * s), gy = k * at(x, y) * (at(x, y + s) - at(x, y - s)) / (2 * s);
      sx += gx; sy += gy; mag += Math.hypot(gx, gy); n++;
    }
    expect(mag / n).toBeGreaterThan(0.5); // a real tilt …
    expect(Math.hypot(sx, sy) / n).toBeLessThan(0.1 * (mag / n)); // … that cancels over the sprite
  });
  it('samples through xBR with HD edges and the nearest texel with Pixel, in the actor and its shadow twin', () => {
    const a = make();
    const s = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (a.mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
    const depth = a.mesh.customDepthMaterial as THREE.ShaderMaterial;
    for (const f of [s.fragmentShader, depth.fragmentShader]) {
      expect(f).toContain(XBR_GLSL);
      // Pixel: Task 5's nearest texel, fetched before (outside) the smoothing branch; the derivative too
      expect(f).toMatch(/vec4 t = texture\(tAtlas, uv\);[^]*fwidth\(p\.x \+ p\.y\)[^]*if \(uSmooth > 0\.5\) \{[^]*xbrSample\(tAtlas, p, rect, delta\)/);
    }
    expect(s.fragmentShader).toContain('vec4 actorTexel = actorSample(vAtlasUv, vRect);\nif (actorTexel.a < 0.5) discard;');
    expect(depth.fragmentShader).toContain('if (actorSample(vUv, vRect).a < 0.5) discard;');
    // one uniform for both (the cast shadow's silhouette follows the actor's); HD by default
    const u = (a as unknown as { uniforms: { uSmooth: { value: number } } }).uniforms.uSmooth;
    expect((s.uniforms as Record<string, unknown>).uSmooth).toBe(u);
    expect(depth.uniforms.uSmooth).toBe(u);
    expect(u.value).toBe(1);
    a.setSmoothing(false);
    expect(u.value).toBe(0);
    a.setSmoothing(true);
    expect(u.value).toBe(1);
  });
  it('draws flat magenta for the harness\'s actor mask (inflated actors and cards)', () => {
    const a = make();
    const u = () => (a as unknown as { uniforms: { uMask: { value: number } } }).uniforms.uMask.value;
    a.setMask(true);
    expect(u()).toBe(1);
    a.setMask(false);
    expect(u()).toBe(0);
    const b = new Billboards({ target: { texture: new THREE.Texture() } });
    b.setMask(true);
    expect(b.material.uniforms.uMask.value).toBe(1);
    expect(b.material.fragmentShader).toContain('uMask');
  });
});

describe('Billboards', () => {
  const card = (x: number, tint?: [number, number, number, number]) => ({ ...spec(x), tint });
  it('re-uploads only the instance attributes that changed', () => {
    const b = new Billboards({ target: { texture: new THREE.Texture() } });
    const g = b.mesh.geometry as THREE.InstancedBufferGeometry;
    const v = () => ['aFoot', 'aSize', 'aUv', 'aTint'].map((k) => (g.getAttribute(k) as THREE.BufferAttribute).version);
    const right = new THREE.Vector3(1, 0, 0), light = new THREE.Color(1, 1, 1);
    b.set([card(1), card(2)], right, light);
    const first = v();
    b.set([card(1), card(2)], right, light);
    expect(v()).toEqual(first);
    b.set([card(1), card(2, [0.5, 0.5, 0.5, 1])], right, light);
    expect(v()).toEqual([first[0], first[1], first[2], first[3] + 1]);
    expect(b.count).toBe(2);
  });
});
