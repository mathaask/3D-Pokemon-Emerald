import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectModels, MAX_PER_KIND, MIN_LUMA, BERRY_DEFAULT, BERRY_MIN_LUMA, berryColors } from '../src/render/actors/objectModels';
import { FRAG_SHOULDER, LIGHT_FLOOR, lampCeiling } from '../src/render/actors/inflatedActors';
import { createKitUniforms } from '../src/render/kit/materials';
import { luma, lush, NIGHT_SOIL_GLSL, soften, toLinear, type RGB } from '../src/render/kit/palette';
import type { ObjectModelKind } from '../src/render/actors/objectMap';
import type { SpriteColors } from '../src/render/actors/spriteColors';
import { berryPlantGeo } from '../src/render/actors/models';

const colors = { main: null, accent: null, green: null };
const count = (m: ObjectModels, k: string) => (m.group.getObjectByName(k) as THREE.InstancedMesh).count;

describe('ObjectModels', () => {
  it('places one instance per object and clears them when the objects are gone', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set([{ kind: 'pokeball', stage: 0, x: 3, y: 0, z: 5, colors }, { kind: 'boulder', stage: 0, x: 4, y: 1, z: 6, colors }]);
    expect(count(m, 'pokeball')).toBe(1);
    expect(count(m, 'boulder')).toBe(1);
    const at = new THREE.Matrix4();
    (m.group.getObjectByName('boulder') as THREE.InstancedMesh).getMatrixAt(0, at);
    expect(new THREE.Vector3().setFromMatrixPosition(at).toArray()).toEqual([4, 1, 6]);
    m.set([]);
    expect(count(m, 'pokeball')).toBe(0);
    expect(count(m, 'boulder')).toBe(0);
  });
  it('caps each kind at 16 instances', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set(Array.from({ length: 20 }, (_, i) => ({ kind: 'pokeball' as const, stage: 0, x: i, y: 0, z: 0, colors })));
    expect(count(m, 'pokeball')).toBe(MAX_PER_KIND);
  });
  it('draws a body per berry tree and its berries at the anchors', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set([{ kind: 'berry', stage: 5, x: 2, y: 0, z: 2, colors }, { kind: 'berry', stage: 5, x: 5, y: 0, z: 2, colors },
           { kind: 'berry', stage: 1, x: 8, y: 0, z: 2, colors }]);
    expect(count(m, 'berry5')).toBe(2);
    expect(count(m, 'berry1')).toBe(1);
    expect(count(m, 'berryFruit')).toBe(2 * berryPlantGeo(5, 0).anchors.length);
    expect(count(m, 'berryFlower')).toBe(0);
    m.set([]);
    expect(count(m, 'berryFruit')).toBe(0);
    expect(m.supports('berry')).toBe(true);
  });
});

// ---- beyond the brief ----

describe('ObjectModels tints, uploads and precompile', () => {
  const mesh = (m: ObjectModels, k: string) => m.group.getObjectByName(k) as THREE.InstancedMesh;
  const tints = (m: ObjectModels, k: string) => mesh(m, k).userData.tints as { a: THREE.Color; b: THREE.Color; h: THREE.Color };
  const lin = (c: RGB) => new THREE.Color(...toLinear(c));
  const at = (kind: ObjectModelKind, c: SpriteColors, x = 0) => ({ kind, stage: 0, x, y: 0, z: 0, colors: c });

  it('has meshes for every model kind, the berry plants included', () => {
    const m = new ObjectModels(createKitUniforms());
    for (const k of ['pokeball', 'boulder', 'crackedRock', 'cutTree', 'truck', 'berry'] as const) expect(m.supports(k)).toBe(true);
  });
  it("tints a kind from its first instance's sprite colours, the defaults where one is missing", () => {
    const m = new ObjectModels(createKitUniforms());
    const red: RGB = [0.8, 0.2, 0.1], grey: RGB = [0.7, 0.7, 0.72], blue: RGB = [0.1, 0.2, 0.9];
    m.set([at('pokeball', { main: grey, accent: red, green: null }), at('pokeball', { main: null, accent: blue, green: null }, 2),
      at('truck', { main: grey, accent: blue, green: null })]);
    expect(tints(m, 'pokeball').a.equals(lin(red))).toBe(true);
    expect(tints(m, 'truck').a.equals(lin(grey))).toBe(true);
    expect(tints(m, 'truck').b.equals(lin(blue))).toBe(true);
    m.set([at('pokeball', colors), at('truck', colors)]);
    expect(tints(m, 'pokeball').a.equals(lin([0.86, 0.16, 0.16]))).toBe(true);
    expect(tints(m, 'truck').a.equals(lin([0.26, 0.26, 0.48]))).toBe(true); // (navy, as the sprite's side)
    expect(tints(m, 'truck').b.equals(lin([0.2, 0.35, 0.8]))).toBe(true);
  });
  it("tints a rock from its sprite's tones: body, the highlight its tops blend to, the crevice of its cracks", () => {
    const m = new ObjectModels(createKitUniforms());
    const body: RGB = [123 / 255, 115 / 255, 66 / 255], high: RGB = [181 / 255, 165 / 255, 99 / 255], crev: RGB = [58 / 255, 58 / 255, 25 / 255];
    const main: RGB = [58 / 255, 58 / 255, 25 / 255];   // pickColors' main: the darkest body shade, not used
    m.set([{ ...at('crackedRock', { main, accent: null, green: null }), tones: { body, highlight: high, crevice: crev, dark: crev } }]);
    expect(tints(m, 'crackedRock').a.equals(lin(body))).toBe(true);
    expect(tints(m, 'crackedRock').h.equals(lin(high))).toBe(true);
    expect(tints(m, 'crackedRock').b.equals(lin(crev))).toBe(true);
    // MIN_LUMA only as a safety floor: a body darker than it is lifted (hue kept)
    const m2 = new ObjectModels(createKitUniforms());
    m2.set([{ ...at('boulder', colors), tones: { body: crev, highlight: high, crevice: crev, dark: null } }]);
    const k = MIN_LUMA.rock / luma(crev), got = tints(m2, 'boulder').a, want = lin([crev[0] * k, crev[1] * k, crev[2] * k]);
    for (const ch of ['r', 'g', 'b'] as const) expect(got[ch]).toBeCloseTo(want[ch], 6);
  });
  it("tints the Cut tree's crown (its material colour) in the sprite's highlight, not its outline-darkened green", () => {
    const m = new ObjectModels(createKitUniforms());
    const lime: RGB = [115 / 255, 189 / 255, 0];
    const band: RGB = [16 / 255, 58 / 255, 0], crev: RGB = [123 / 255, 66 / 255, 66 / 255];
    m.set([{ ...at('cutTree', { main: null, accent: null, green: [0.18, 0.37, 0] }), tones: { body: null, highlight: lime, crevice: crev, dark: band } }]);
    const tree = mesh(m, 'cutTree');
    expect(tints(m, 'cutTree').a.equals(lin(soften(lime)))).toBe(true);
    expect(tints(m, 'cutTree').b.equals(lin(band))).toBe(true);   // uTrunk: the under-rim in the sprite's dark band
    expect((tree.material as THREE.MeshStandardMaterial).color.equals(tints(m, 'cutTree').a)).toBe(true);
    // (without tones: its green, lifted to the floor)
    const m2 = new ObjectModels(createKitUniforms());
    m2.set([at('cutTree', { main: null, accent: null, green: [0.18, 0.37, 0] })]);
    expect(luma(lush([0.18, 0.37, 0]))).toBeLessThan(MIN_LUMA.leaves);
    const c = tints(m2, 'cutTree').a;
    expect(luma([c.r, c.g, c.b].map((v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)) as RGB)).toBeCloseTo(MIN_LUMA.leaves, 3);
  });
  it("paints the truck's box in the sprite's navy (crevice), its roof and trim in the blue, its logo in the grey-blue", () => {
    const m = new ObjectModels(createKitUniforms());
    const navy: RGB = [66 / 255, 66 / 255, 123 / 255], grey: RGB = [107 / 255, 123 / 255, 156 / 255], blue: RGB = [90 / 255, 99 / 255, 1];
    // (the highlight tone averages in the white cab: the logo takes main, the swoosh's grey-blue, not it)
    const pale: RGB = [173 / 255, 184 / 255, 203 / 255];
    m.set([{ ...at('truck', { main: grey, accent: blue, green: null }), tones: { body: blue, highlight: pale, crevice: navy, dark: null } }]);
    expect(tints(m, 'truck').a.equals(lin(navy))).toBe(true);
    expect(tints(m, 'truck').b.equals(lin(blue))).toBe(true);
    expect(tints(m, 'truck:logo').a.equals(lin(grey))).toBe(true);
    expect(count(m, 'truck:logo')).toBe(1);
    expect(mesh(m, 'truck:logo').castShadow).toBe(false);
  });
  it('draws a flipped boulder as its rewound mirror image (another mesh: a negative instance scale would turn it inside out)', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set([{ ...at('boulder', colors), flip: true }, { ...at('boulder', colors, 2) }, { ...at('pokeball', colors), flip: true }]);
    expect(count(m, 'boulder')).toBe(1);
    expect(count(m, 'boulder:mirror')).toBe(1);
    expect(count(m, 'pokeball')).toBe(1);
    expect(m.count).toBe(3);
    const g = mesh(m, 'boulder:mirror').geometry, src = mesh(m, 'boulder').geometry;
    expect(g.getAttribute('position').getX(1)).toBeCloseTo(-src.getAttribute('position').getX(2), 6);
    // every triangle still faces out: its winding agrees with its normals
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
    let out = 0;
    for (let t = 0; t < p.count; t += 3) {
      a.fromBufferAttribute(p, t); b.fromBufferAttribute(p, t + 1); c.fromBufferAttribute(p, t + 2);
      nn.fromBufferAttribute(n, t).add(c.clone().set(n.getX(t + 1), n.getY(t + 1), n.getZ(t + 1)));
      if (b.clone().sub(a).cross(c.clone().sub(a)).dot(nn) > 0) out++;
    }
    expect(out / (p.count / 3)).toBeGreaterThan(0.98);
  });
  it('turns a mirrored truck half way round (cab to +X); other kinds ignore the flag', () => {
    const m = new ObjectModels(createKitUniforms());
    const e = (k: string) => mesh(m, k).instanceMatrix.array;
    m.set([{ ...at('truck', colors), mirror: true }, { ...at('pokeball', colors), mirror: true }]);
    expect(e('truck')[0]).toBeCloseTo(-1, 6);
    expect(e('truck:logo')[0]).toBeCloseTo(-1, 6);
    expect(e('pokeball')[0]).toBe(1);
  });
  it('lights the models no darker than the inflated actors\' floor (LIGHT_FLOOR × the cards\' light), uniform-driven', () => {
    const m = new ObjectModels(createKitUniforms());
    for (const k of ['boulder', 'cutTree']) {
      const shader = { uniforms: {} as Record<string, { value: unknown }>, defines: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
        fragmentShader: THREE.ShaderLib.standard.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
      (mesh(m, k).material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
      expect(shader.fragmentShader).toContain('floorLight');
      // the inflated actors' lamp ceiling (point lights) and soft shoulder, patched in
      expect(shader.fragmentShader).toContain(lampCeiling(THREE.ShaderChunk.lights_pars_begin));
      expect(shader.fragmentShader).toContain(FRAG_SHOULDER + '#include <opaque_fragment>');
      m.setLightFloor(new THREE.Color(0.5, 0.25, 1));
      expect((shader.uniforms.uFloor.value as THREE.Color).toArray()).toEqual([0.5 * LIGHT_FLOOR, 0.25 * LIGHT_FLOOR, LIGHT_FLOOR]);
    }
  });
  it('uploads the instance matrices only when one changed', () => {
    const m = new ObjectModels(createKitUniforms());
    const v = () => mesh(m, 'boulder').instanceMatrix.version;
    m.set([at('boulder', colors, 1)]);
    const first = v();
    m.set([at('boulder', colors, 1)]);
    expect(v()).toBe(first);                 // a still frame uploads nothing
    m.set([at('boulder', colors, 2)]);
    expect(v()).toBeGreaterThan(first);      // pushed
  });
  it('shows every mesh while it compiles (one render, its shadow pass included) and restores them after', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set([at('boulder', colors)]);
    m.group.visible = false;                 // (Retro)
    const seen: { compiled: string[]; rendered: string[] } = { compiled: [], rendered: [] };
    const shown = () => m.group.children.filter((o) => o.visible && m.group.visible && (o as THREE.InstancedMesh).count > 0).map((o) => o.name);
    let target: unknown = 'screen';
    const renderer = {
      getRenderTarget: () => target, setRenderTarget: (t: unknown) => { target = t; },
      compileAsync: () => { seen.compiled = shown(); expect(target).toBeInstanceOf(THREE.WebGLRenderTarget); return Promise.resolve(); },
      render: () => { seen.rendered = shown(); },
    } as unknown as THREE.WebGLRenderer;
    const done = m.precompile(renderer, new THREE.Scene(), new THREE.PerspectiveCamera());
    const all = ['pokeball', 'boulder', 'boulder:mirror', 'crackedRock', 'cutTree', 'truck', 'truck:logo',
      'berry1', 'berry2', 'berry3', 'berry4', 'berry5', 'berryFlower', 'berryFruit'];
    expect(seen.compiled.sort()).toEqual([...all].sort());
    expect(seen.rendered.sort()).toEqual([...all].sort());
    expect(target).toBe('screen');
    expect(m.group.visible).toBe(false);
    expect(count(m, 'boulder')).toBe(1);
    expect(count(m, 'pokeball')).toBe(0);
    expect(mesh(m, 'pokeball').visible).toBe(false);
    return done;
  });
  it("keys every model material's programs apart from the kit's (its extra shader patches are not in the kit's key)", () => {
    const m = new ObjectModels(createKitUniforms());
    for (const o of m.group.children) {
      const mat = (o as THREE.Mesh).material as THREE.Material;
      expect(mat.customProgramCacheKey(), o.name).toMatch(/^kit:.*:model$/);
    }
    // (the Cut tree's sway twin is the kit's own depth material, unpatched: its key stays the kit's)
    const twin = mesh(m, 'cutTree').customDepthMaterial!;
    expect(twin.customProgramCacheKey()).toMatch(/:depth$/);
  });
  it('gives every model a shadow-depth material of its own (none uses three\'s shared one)', () => {
    const m = new ObjectModels(createKitUniforms());
    for (const o of m.group.children) expect((o as THREE.Mesh).customDepthMaterial).toBeDefined();
  });
});

describe('ObjectModels berry plants', () => {
  const mesh = (m: ObjectModels, k: string) => m.group.getObjectByName(k) as THREE.InstancedMesh;
  const color = (m: ObjectModels, k: string, i = 0) => mesh(m, k).instanceColor!.array.slice(i * 3, i * 3 + 3);
  const lin = (c: RGB) => Array.from(new Float32Array(toLinear(c)));
  const plant = (stage: number, c: SpriteColors, x = 0, yaw?: number) => ({ kind: 'berry' as const, stage, x, y: 1, z: 3, colors: c, yaw });

  it('carries its flowers at stage 4, its berries at stage 5, nothing at stages 1-3; an empty frame clears them all', () => {
    const m = new ObjectModels(createKitUniforms());
    m.set([1, 2, 3, 4, 5].map((s) => plant(s, colors, s)));
    for (const s of [1, 2, 3, 4, 5]) expect(count(m, `berry${s}`)).toBe(1);
    expect(count(m, 'berryFlower')).toBe(berryPlantGeo(4, 0).anchors.length);
    expect(count(m, 'berryFruit')).toBe(berryPlantGeo(5, 0).anchors.length);
    expect(m.count).toBe(5);                  // (objects: a plant counts once)
    m.set([]);
    for (const k of ['berry1', 'berry2', 'berry3', 'berry4', 'berry5', 'berryFlower', 'berryFruit']) {
      expect(count(m, k)).toBe(0);
      expect(mesh(m, k).visible).toBe(false);
    }
    expect(m.count).toBe(0);
  });
  it("places each flower or berry at its anchor on the plant (the plant's placement × the anchor)", () => {
    const m = new ObjectModels(createKitUniforms());
    const yaw = 1.3;                          // (0..2π → a full turn, by object: yaw − π)
    m.set([plant(5, colors, 4, yaw)]);
    const turn = yaw - Math.PI;
    const at = new THREE.Matrix4(), body = new THREE.Matrix4();
    mesh(m, 'berry5').getMatrixAt(0, body);
    expect(new THREE.Vector3().setFromMatrixPosition(body).toArray()).toEqual([4, 1, 3]);
    berryPlantGeo(5, 0).anchors.forEach((a, i) => {
      mesh(m, 'berryFruit').getMatrixAt(i, at);
      const want = a.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).add(new THREE.Vector3(4, 1, 3));
      expect(new THREE.Vector3().setFromMatrixPosition(at).distanceTo(want)).toBeLessThan(1e-5);
    });
  });
  it('turns every plant a full turn by object, but a sprout only ±0.5 rad (its V stays across the view)', () => {
    const m = new ObjectModels(createKitUniforms());
    const angle = (k: string) => { const e = new THREE.Matrix4(); mesh(m, k).getMatrixAt(0, e); return Math.atan2(e.elements[8], e.elements[0]); };
    m.set([1, 2, 3, 4, 5].map((s) => plant(s, colors, s, 0.2)));
    for (const s of [1, 3, 4, 5]) expect(angle(`berry${s}`)).toBeCloseTo(0.2 - Math.PI, 5);
    expect(angle('berry2')).toBeCloseTo((0.2 / Math.PI - 1) * 0.5, 5);
  });
  it("colours each plant from its own sprite: leaves its green (lush, lifted), flowers and berries its accent", () => {
    const m = new ObjectModels(createKitUniforms());
    const green: RGB = [60 / 255, 115 / 255, 0], pink: RGB = [222 / 255, 148 / 255, 115 / 255], red: RGB = [206 / 255, 99 / 255, 74 / 255];
    m.set([plant(4, { main: null, accent: pink, green }), plant(5, { main: null, accent: red, green: null }, 2),
      plant(5, colors, 4)]);
    const leaves = lush(green), k = BERRY_MIN_LUMA.leaves / luma(leaves);
    expect(luma(leaves)).toBeLessThan(BERRY_MIN_LUMA.leaves);   // (the picker's mean takes in the outline green)
    color(m, 'berry4').forEach((v, i) => expect(v).toBeCloseTo(lin(leaves.map((c) => c * k) as RGB)[i], 5));
    expect(Array.from(color(m, 'berryFlower'))).toEqual(lin(pink));
    expect(Array.from(color(m, 'berry5'))).toEqual(lin([0.3, 0.6, 0.3]));      // no green: the default leaves
    expect(Array.from(color(m, 'berryFruit'))).toEqual(lin(red));
    const n = berryPlantGeo(5, 0).anchors.length;
    expect(Array.from(color(m, 'berryFruit', n))).toEqual(lin(BERRY_DEFAULT.fruit));   // the next plant's: no accent
    expect(BERRY_DEFAULT.petals).toEqual([0.95, 0.55, 0.75]);
    // a dark accent (an outline) is lifted to the floor, hue kept
    const dark: RGB = [99 / 255, 0, 25 / 255];
    expect(berryColors({ main: null, accent: dark, green: null }).fruit.map((v) => +v.toFixed(5)))
      .toEqual(toLinear(dark.map((c) => c * (BERRY_MIN_LUMA.fruit / luma(dark))) as RGB).map((v) => +v.toFixed(5)));
  });
  it('uploads matrices and colours only when one changed', () => {
    const m = new ObjectModels(createKitUniforms());
    const v = () => [mesh(m, 'berry5').instanceMatrix.version, mesh(m, 'berry5').instanceColor!.version,
      mesh(m, 'berryFruit').instanceMatrix.version, mesh(m, 'berryFruit').instanceColor!.version];
    m.set([plant(5, colors, 1)]);
    const first = v();
    m.set([plant(5, colors, 1)]);
    expect(v()).toEqual(first);                // a still frame uploads nothing
    m.set([plant(5, colors, 2)]);
    expect(v()[0]).toBeGreaterThan(first[0]);
    expect(v()[2]).toBeGreaterThan(first[2]);  // (the berries move with their plant)
    expect(v()[1]).toBe(first[1]);
    m.set([plant(5, { main: null, accent: [0.2, 0.3, 0.9], green: null }, 2)]);
    expect(v()[3]).toBeGreaterThan(first[3]);  // new colours
  });
  it('lets an instance colour tint only the tinted parts: fixed colours (soil, the flowers\' heart) keep their own', () => {
    const m = new ObjectModels(createKitUniforms());
    const shader = { uniforms: {} as Record<string, { value: unknown }>, defines: {}, vertexShader: THREE.ShaderLib.standard.vertexShader,
      fragmentShader: THREE.ShaderLib.standard.fragmentShader } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (mesh(m, 'berryFlower').material as THREE.Material).onBeforeCompile(shader, {} as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('if (color.a < 0.75) vColor.rgb *= instanceColor.rgb;');
    // the mounds' soil (code 0.85) is moonlit at night, as the berry beds are
    expect(shader.fragmentShader).toContain('if (vColor.a > 0.75 && vColor.a < 0.95) ' + NIGHT_SOIL_GLSL);
    // the berry materials keep the models' program: the same hooks, uniforms and cache key as the others
    const key = (k: string) => (mesh(m, k).material as THREE.Material).customProgramCacheKey();
    expect(key('berry1')).toBe(key('pokeball'));
    expect(key('berryFruit')).toBe(key('pokeball'));
    expect(mesh(m, 'berry1').customDepthMaterial).not.toBe(mesh(m, 'pokeball').customDepthMaterial);
    expect(mesh(m, 'berryFlower').castShadow).toBe(false);
    expect(mesh(m, 'berry3').castShadow).toBe(true);
  });
});
