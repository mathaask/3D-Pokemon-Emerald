import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  InflatedActors, ACTOR_GRID, LAMP_CEILING, SHADOW_PUSH, SHADE_GAIN, SHADE_STEP, MASK_GLSL, MAX_ACTORS, INST_UNIFORM_VECTORS,
  INST_UNIFORMS_MIN_VERTEX_VECTORS, instanceUniformsFit, instanceUniformsFailed, BATTLE_VARIANT,
} from '../src/render/actors/inflatedActors';
import { heights, INFLATE } from '../src/render/actors/inflateMath';
import { XBR_GLSL } from '../src/render/actors/xbr.glsl';
import { Billboards } from '../src/render/overworld/billboards';

const spec = (x: number) => ({ footX: x, footY: 0, footZ: 3, width: 1, height: 2, lift: 0, flat: false,
  slot: { u0: 0, v0: 32 / 512, u1: 16 / 1024, v1: 0 } });
const make = () => new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() });
/** The attribute fallback (a device with too few vertex uniform vectors). */
const makeAttributes = () => new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() }, undefined, false);
/** The main material's shaders: its onBeforeCompile applied to three's standard shaders. */
const patched = (a: InflatedActors) => {
  const s = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
    uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
  (a.mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
  return s;
};

describe('InflatedActors variants (battle)', () => {
  it('a battle variant has its own program keys and full relief to the feet', () => {
    const a = new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() }, undefined, true, BATTLE_VARIANT);
    expect((a.mesh.material as THREE.Material).customProgramCacheKey()).toBe('actor:inflated-battle:1:uniforms');
    expect((a.mesh.customDepthMaterial as THREE.Material).customProgramCacheKey()).toBe('actor:inflated-battle-depth:1:uniforms');
    expect(patched(a).vertexShader).toContain('float relief = 1.0;');
  });
  it('the overworld variant keeps its keys and its relief fade', () => {
    const a = make();
    expect((a.mesh.material as THREE.Material).customProgramCacheKey()).toBe('actor:inflated:1:uniforms');
    expect(patched(a).vertexShader).toContain('smoothstep(0.15, 0.55, local.y)');
  });
  it('checks the uniform-array programs of the variant it is asked about', () => {
    const failed = [{ cacheKey: 'x,actor:inflated-battle:1:uniforms', diagnostics: { runnable: false } }];
    expect(instanceUniformsFailed(failed)).toBe(false);
    expect(instanceUniformsFailed(failed, 'battle')).toBe(true);
  });
  it('samples the battle variant\'s HD edges through baked xBR decisions (tXbr), main and twin; the overworld\'s per fragment', () => {
    const bake = new THREE.Texture();
    const a = new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() }, undefined, true, BATTLE_VARIANT, bake);
    const s = patched(a), depth = a.mesh.customDepthMaterial as THREE.ShaderMaterial;
    for (const f of [s.fragmentShader, depth.fragmentShader]) expect(f).toContain('t = xbrSampleBaked(tAtlas, tXbr, p, rect, delta);');
    expect((s.uniforms as Record<string, THREE.IUniform>).tXbr.value).toBe(bake);
    expect(depth.uniforms.tXbr.value).toBe(bake);
    const o = patched(make());
    expect(o.fragmentShader).not.toContain('xbrSampleBaked');
    expect('tXbr' in o.uniforms).toBe(false);
  });
  it('keeps a zero-width actor finite (a battler growing from nothing at send-out): the battle shader guards its texel size', () => {
    // (set() only copies finite spec numbers: a NaN could only arise in the shader, dividing by the slot's texel width)
    const a = new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() }, undefined, true, BATTLE_VARIANT);
    expect(patched(a).vertexShader).toContain('float pxWorld = aSize.x / max((aUv.z - aUv.x) * uAtlasSize.x, 1.0);');
  });
});

describe('InflatedActors', () => {
  it('draws one instanced 16x32 grid per actor, its instance data in a uniform array (no instance vertex buffer)', () => {
    const a = make();
    a.set([spec(1), { ...spec(2), lift: 0.25 }], new THREE.Vector3(1, 0, 0));
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.instanceCount).toBe(2);
    expect(g.getAttribute('position').count).toBe((ACTOR_GRID.x + 1) * (ACTOR_GRID.y + 1));
    // per actor 3 vec4s: foot, size (width, height, lift, 0), uv (u0, v0, u1, v1)
    expect(Array.from(a.instances.slice(12, 24))).toEqual([2, 0, 3, 0, 1, 2, 0.25, 0, 0, 32 / 512, 16 / 1024, 0].map(Math.fround));
    expect(Object.keys(g.attributes).sort()).toEqual(['normal', 'position']);
    // the main and the depth twin read the same array, by instance (the cards' layout names kept as macros)
    const depth = a.mesh.customDepthMaterial as THREE.ShaderMaterial;
    expect(depth.uniforms.uInst.value).toBe(a.instances);
    expect(depth.vertexShader).toContain('#define aFoot (uInst[gl_InstanceID * 3].xyz)');
  });
  it('shares its contact shadows\' instance attributes (foot, size) between their 4-vertex geometries', () => {
    const a = make();
    const s = a.geometryForShadows(), t = a.geometryForShadows();
    a.set([spec(1)], new THREE.Vector3(1, 0, 0));
    expect(s.instanceCount).toBe(1);
    expect(s.getAttribute('aFoot')).toBe(t.getAttribute('aFoot'));
    expect(s.getAttribute('aSize')).toBe(t.getAttribute('aSize'));
    expect(s.getAttribute('aFoot').getX(0)).toBe(1);
    expect(s.getAttribute('position').count).toBe(4);
  });
  it('re-uploads only the contact shadows\' attributes that changed, over every instance ever set', () => {
    const a = make();
    const g = a.geometryForShadows();
    const attr = (k: string) => g.getAttribute(k) as THREE.InstancedBufferAttribute;
    const right = new THREE.Vector3(1, 0, 0);
    a.set([spec(1), spec(2)], right);
    const v = () => ['aFoot', 'aSize'].map((k) => attr(k).version);
    const first = v();
    a.set([spec(1), spec(2)], right); // a still scene: nothing to upload
    expect(v()).toEqual(first);
    a.set([spec(1)], right);          // fewer actors, same data
    expect(v()).toEqual(first);
    a.set([spec(1.5)], right);        // one moved: its feet only, over both instances ever set
    expect(v()).toEqual([first[0] + 1, first[1]]);
    expect(attr('aFoot').updateRanges).toEqual([{ start: 0, count: 6 }]);
  });
  it('re-uploads only the attribute a change touches (a new animation frame: none; a jump: size)', () => {
    const a = make();
    const g = a.geometryForShadows();
    const v = () => ['aFoot', 'aSize'].map((k) => (g.getAttribute(k) as THREE.BufferAttribute).version);
    const right = new THREE.Vector3(1, 0, 0);
    a.set([spec(1)], right);
    const first = v();
    a.set([{ ...spec(1), slot: { u0: 16 / 1024, v0: 32 / 512, u1: 32 / 1024, v1: 0 } }], right);
    expect(v()).toEqual(first);
    expect(a.instances[8]).toBe(Math.fround(16 / 1024));
    a.set([{ ...spec(1), slot: { u0: 16 / 1024, v0: 32 / 512, u1: 32 / 1024, v1: 0 }, lift: 0.5 }], right);
    expect(v()).toEqual([first[0], first[1] + 1]);
  });
  it('uses the uniform array only where the device has the vertex uniform vectors for it (URL override 0 / 1)', () => {
    expect(INST_UNIFORM_VECTORS).toBe(MAX_ACTORS * 3);
    expect(INST_UNIFORMS_MIN_VERTEX_VECTORS).toBe(320);
    expect(instanceUniformsFit(256)).toBe(false);   // WebGL2's guaranteed minimum
    expect(instanceUniformsFit(319)).toBe(false);
    expect(instanceUniformsFit(320)).toBe(true);
    expect(instanceUniformsFit(4096)).toBe(true);   // ANGLE D3D11
    expect(instanceUniformsFit(4096, '0')).toBe(false);
    expect(instanceUniformsFit(256, '1')).toBe(true);
    expect(instanceUniformsFit(4096, 'x')).toBe(true);
  });
  it("decides on the attribute fallback at run time when a uniform-array program (main or twin) did not link", () => {
    // (three's renderer.info.programs: cache keys end with the material's customProgramCacheKey; diagnostics once used)
    const p = (key: string, runnable?: boolean) => ({ cacheKey: `standard,1,2,${key}`, ...(runnable === undefined ? {} : { diagnostics: { runnable } }) });
    expect(instanceUniformsFailed([])).toBe(false);
    expect(instanceUniformsFailed([p('actor:inflated:1:uniforms'), p('actor:inflated-depth:1:uniforms')])).toBe(false);
    expect(instanceUniformsFailed([p('actor:inflated:1:uniforms', true)])).toBe(false);   // linked with a log
    expect(instanceUniformsFailed([p('actor:inflated:1:uniforms', false)])).toBe(true);
    expect(instanceUniformsFailed([p('actor:inflated-depth:1:uniforms', false)])).toBe(true);
    // another program's failure, or the attribute variant's, is not the uniform array's
    expect(instanceUniformsFailed([p('kit:tree', false), p('actor:inflated:1:attributes', false)])).toBe(false);
  });
  it('compiles each variant to its own programs: the uniform array, or attributes of the same names', () => {
    const shaders = (a: InflatedActors) => {
      const s = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
        uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
      const m = a.mesh.material as THREE.MeshStandardMaterial;
      m.onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
      const depth = a.mesh.customDepthMaterial as THREE.ShaderMaterial;
      return { main: s.vertexShader, depth: depth.vertexShader, keys: [m.customProgramCacheKey(), depth.customProgramCacheKey()] };
    };
    const u = shaders(make()), at = shaders(makeAttributes());
    for (const v of [u.main, u.depth]) {
      expect(v).toContain(`uniform vec4 uInst[${INST_UNIFORM_VECTORS}];`);
      expect(v).toContain('#define aUv (uInst[gl_InstanceID * 3 + 2])');
      expect(v).not.toContain('attribute vec3 aFoot;');
    }
    for (const v of [at.main, at.depth]) {
      expect(v).toMatch(/attribute vec3 aFoot;\s*attribute vec4 aSize;\s*attribute vec4 aUv;/);
      expect(v).not.toContain('uInst');
      // the same body reads them
      expect(v).toContain('vec3 card = aFoot + uRight * (local.x * aSize.x)');
    }
    expect(u.keys).toEqual(['actor:inflated:1:uniforms', 'actor:inflated-depth:1:uniforms']);
    expect(at.keys).toEqual(['actor:inflated:1:attributes', 'actor:inflated-depth:1:attributes']);
  });
  it('attribute fallback: the grid carries foot / size / uv instance attributes (shared with the contact shadows), uploaded on change', () => {
    const a = makeAttributes();
    expect(a.instanceUniforms).toBe(false);
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    const s = a.geometryForShadows();
    const right = new THREE.Vector3(1, 0, 0);
    a.set([spec(1), { ...spec(2), lift: 0.25 }], right);
    expect(g.instanceCount).toBe(2);
    expect(Array.from((g.getAttribute('aFoot') as THREE.InstancedBufferAttribute).array.slice(3, 6))).toEqual([2, 0, 3]);
    expect((g.getAttribute('aSize') as THREE.InstancedBufferAttribute).getZ(1)).toBe(0.25);
    expect((g.getAttribute('aUv') as THREE.InstancedBufferAttribute).getZ(0)).toBe(Math.fround(16 / 1024));
    expect(s.getAttribute('aFoot')).toBe(g.getAttribute('aFoot'));
    expect(Array.from(a.instances.slice(0, 12)).every((x) => x === 0)).toBe(true); // (the uniform array stays unused)
    const v = () => ['aFoot', 'aSize', 'aUv'].map((k) => (g.getAttribute(k) as THREE.BufferAttribute).version);
    const first = v();
    a.set([spec(1), { ...spec(2), lift: 0.25 }], right);       // still: nothing uploads
    expect(v()).toEqual(first);
    a.set([{ ...spec(1), slot: { u0: 16 / 1024, v0: 32 / 512, u1: 32 / 1024, v1: 0 } }, { ...spec(2), lift: 0.25 }], right);
    expect(v()).toEqual([first[0], first[1], first[2] + 1]); // a new animation frame: uv only
    expect((g.getAttribute('aUv') as THREE.InstancedBufferAttribute).updateRanges).toEqual([{ start: 0, count: 8 }]);
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

/** Evaluates a GLSL expression of the cards' vertex shader in JS (vec components, mix: the subset those lines use). Only
 *  arithmetic on the given names and mix() is accepted (the expression is our own shader's, checked before it runs). */
function glslEval(expr: string, env: Record<string, unknown>): number {
  const names = new Set([...Object.keys(env), 'mix']);
  const ids = expr.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
  if (!/^[A-Za-z_0-9.+\-*/(), ]+$/.test(expr) || ids.some((id) => !names.has(id) && !/^[xyzw]$/.test(id))) {
    throw new Error(`not a plain arithmetic GLSL expression: ${expr}`);
  }
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  return new Function(...Object.keys(env), 'mix', `return ${expr};`)(...Object.values(env), mix) as number;
}
/** The arguments of a GLSL call `name(a, b, …)` in `src` (top-level commas). */
function glslArgs(src: string, call: string): string[] {
  const at = src.indexOf(call + '(');
  if (at < 0) throw new Error(`no ${call}( in ${src}`);
  const args: string[] = [];
  let depth = 0, cur = '';
  for (const ch of src.slice(at + call.length + 1)) {
    if (ch === '(') depth++;
    if (ch === ')' && depth-- === 0) break;
    if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  args.push(cur.trim());
  return args;
}

describe('Billboards', () => {
  const card = (x: number, tint?: [number, number, number, number]) => ({ ...spec(x), tint });
  it('lays a flat decal as the GBA draws it: its far edge (up the screen, −Z) samples the sprite\'s top row (v0)', () => {
    const b = new Billboards({ target: { texture: new THREE.Texture() } });
    for (const vs of [b.material.vertexShader, (b.mesh.customDepthMaterial as THREE.ShaderMaterial).vertexShader]) {
      const flat = /if \(aSize\.w > 0\.5\) \{([^]*?)\} else \{/.exec(vs)![1];
      // (the uv line of the flat branch, else the one both branches share)
      const uvLine = /vUv = vec2\(.*\);/.exec(flat)?.[0] ?? /vUv = vec2\(.*\);/.exec(vs)![0];
      const zExpr = glslArgs(flat, 'vec3')[2], vExpr = glslArgs(uvLine, 'vec2')[1];
      const aUv = { x: 0, y: 0.75, z: 1, w: 0.25 }, aSize = { x: 1, y: 2, z: 0, w: 1 }; // v0 (top) 0.75, v1 (bottom) 0.25
      const corner = (ly: number) => ({ z: glslEval(zExpr, { local: { x: 0, y: ly }, aSize, aUv }), v: glslEval(vExpr, { local: { x: 0, y: ly }, aSize, aUv }) });
      const [a, c] = [corner(0), corner(1)];
      const far = a.z < c.z ? a : c, near = a.z < c.z ? c : a;
      expect(far.v).toBeCloseTo(aUv.y, 6);   // the sprite's top row
      expect(near.v).toBeCloseTo(aUv.w, 6);  // its bottom row nearest the camera
      expect(near.z - far.z).toBeCloseTo(aSize.y, 6);
    }
  });
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
