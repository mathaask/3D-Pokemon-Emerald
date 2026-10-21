import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ObjectModels, MAX_PER_KIND, MIN_LUMA } from '../src/render/actors/objectModels';
import { LIGHT_FLOOR } from '../src/render/actors/inflatedActors';
import { createKitUniforms } from '../src/render/kit/materials';
import { luma, lush, soften, toLinear, type RGB } from '../src/render/kit/palette';
import type { ObjectModelKind } from '../src/render/actors/objectMap';
import type { SpriteColors } from '../src/render/actors/spriteColors';

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
});

// ---- beyond the brief ----

describe('ObjectModels tints, uploads and precompile', () => {
  const mesh = (m: ObjectModels, k: string) => m.group.getObjectByName(k) as THREE.InstancedMesh;
  const tints = (m: ObjectModels, k: string) => mesh(m, k).userData.tints as { a: THREE.Color; b: THREE.Color; h: THREE.Color };
  const lin = (c: RGB) => new THREE.Color(...toLinear(c));
  const at = (kind: ObjectModelKind, c: SpriteColors, x = 0) => ({ kind, stage: 0, x, y: 0, z: 0, colors: c });

  it('has meshes for the five Task 8 kinds (berry plants come later)', () => {
    const m = new ObjectModels(createKitUniforms());
    for (const k of ['pokeball', 'boulder', 'crackedRock', 'cutTree', 'truck'] as const) expect(m.supports(k)).toBe(true);
    expect(m.supports('berry')).toBe(false);
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
    expect(tints(m, 'truck').a.equals(lin([0.92, 0.92, 0.9]))).toBe(true);
    expect(tints(m, 'truck').b.equals(lin([0.2, 0.35, 0.8]))).toBe(true);
  });
  it("tints a rock from its sprite's tones: body, the highlight its tops blend to, the crevice of its cracks", () => {
    const m = new ObjectModels(createKitUniforms());
    const body: RGB = [123 / 255, 115 / 255, 66 / 255], high: RGB = [181 / 255, 165 / 255, 99 / 255], crev: RGB = [58 / 255, 58 / 255, 25 / 255];
    const main: RGB = [58 / 255, 58 / 255, 25 / 255];   // pickColors' main: the darkest body shade, not used
    m.set([{ ...at('crackedRock', { main, accent: null, green: null }), tones: { body, highlight: high, crevice: crev } }]);
    expect(tints(m, 'crackedRock').a.equals(lin(body))).toBe(true);
    expect(tints(m, 'crackedRock').h.equals(lin(high))).toBe(true);
    expect(tints(m, 'crackedRock').b.equals(lin(crev))).toBe(true);
    // MIN_LUMA only as a safety floor: a body darker than it is lifted (hue kept)
    const m2 = new ObjectModels(createKitUniforms());
    m2.set([{ ...at('boulder', colors), tones: { body: crev, highlight: high, crevice: crev } }]);
    const k = MIN_LUMA.rock / luma(crev), got = tints(m2, 'boulder').a, want = lin([crev[0] * k, crev[1] * k, crev[2] * k]);
    for (const ch of ['r', 'g', 'b'] as const) expect(got[ch]).toBeCloseTo(want[ch], 6);
  });
  it("tints the Cut tree's crown (its material colour) in the sprite's highlight, not its outline-darkened green", () => {
    const m = new ObjectModels(createKitUniforms());
    const lime: RGB = [115 / 255, 189 / 255, 0];
    m.set([{ ...at('cutTree', { main: null, accent: null, green: [0.18, 0.37, 0] }), tones: { body: null, highlight: lime, crevice: null } }]);
    const tree = mesh(m, 'cutTree');
    expect(tints(m, 'cutTree').a.equals(lin(soften(lime)))).toBe(true);
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
    m.set([{ ...at('truck', { main: grey, accent: blue, green: null }), tones: { body: blue, highlight: grey, crevice: navy } }]);
    expect(tints(m, 'truck').a.equals(lin(navy))).toBe(true);
    expect(tints(m, 'truck').b.equals(lin(blue))).toBe(true);
    expect(tints(m, 'truck:logo').a.equals(lin(grey))).toBe(true);
    expect(count(m, 'truck:logo')).toBe(1);
    expect(mesh(m, 'truck:logo').castShadow).toBe(false);
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
    const all = ['pokeball', 'boulder', 'crackedRock', 'cutTree', 'truck', 'truck:logo'];
    expect(seen.compiled.sort()).toEqual([...all].sort());
    expect(seen.rendered.sort()).toEqual([...all].sort());
    expect(target).toBe('screen');
    expect(m.group.visible).toBe(false);
    expect(count(m, 'boulder')).toBe(1);
    expect(count(m, 'pokeball')).toBe(0);
    expect(mesh(m, 'pokeball').visible).toBe(false);
    return done;
  });
  it('gives every model a shadow-depth material of its own (none uses three\'s shared one)', () => {
    const m = new ObjectModels(createKitUniforms());
    for (const o of m.group.children) expect((o as THREE.Mesh).customDepthMaterial).toBeDefined();
  });
});
