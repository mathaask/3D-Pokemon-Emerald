import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { PostFX, tiltShiftFor, gtaoDenoiseNoise } from '../src/render/post';
import { setAoPrepassMaterial, aoPrepassMaterial } from '../src/render/aoPrepass';
import { shadowSettings } from '../src/render/overworld/overworldView';

/** The parts of a WebGLRenderer PostFX touches outside of rendering, at a given pixel ratio. */
function fakeRenderer(cssW: number, cssH: number, ratio: number): THREE.WebGLRenderer {
  return {
    getPixelRatio: () => ratio,
    getSize: (v: THREE.Vector2) => v.set(cssW, cssH),
    getDrawingBufferSize: (v: THREE.Vector2) => v.set(cssW * ratio, cssH * ratio),
  } as unknown as THREE.WebGLRenderer;
}

/** uResolution of the tilt-shift passes (the ShaderPasses with a uDirection uniform). */
function tiltResolutions(post: PostFX): THREE.Vector2[] {
  return post.composer.passes
    .filter((p) => (p as { uniforms?: Record<string, unknown> }).uniforms?.uDirection)
    .map((p) => (p as unknown as { uniforms: { uResolution: { value: THREE.Vector2 } } }).uniforms.uResolution.value);
}

describe('PostFX sizing', () => {
  it('draws the scene into a target the size of the drawing buffer on a HiDPI screen', () => {
    // 1280 x 800 CSS pixels at a pixel ratio of 2: a 2560 x 1600 drawing buffer
    const post = new PostFX(fakeRenderer(1280, 800, 2), new THREE.Scene(), new THREE.PerspectiveCamera(), 'medium');
    post.setSize(2560, 1600);
    expect(post.sceneTargetSize().toArray()).toEqual([2560, 1600]);
    expect([post.composer.renderTarget1.width, post.composer.renderTarget1.height]).toEqual([2560, 1600]);
    // the blur steps are in pixels of the image it blurs
    const res = tiltResolutions(post);
    expect(res).toHaveLength(2);
    for (const r of res) expect(r.toArray()).toEqual([2560, 1600]);
  });

  it('follows resizes, at any pixel ratio', () => {
    const post = new PostFX(fakeRenderer(1000, 500, 1), new THREE.Scene(), new THREE.PerspectiveCamera(), 'low');
    post.setSize(1000, 500);
    expect(post.sceneTargetSize().toArray()).toEqual([1000, 500]);
    post.setSize(640, 480);
    const out = new THREE.Vector2();
    expect(post.sceneTargetSize(out)).toBe(out);
    expect(out.toArray()).toEqual([640, 480]);
  });
});

describe('tilt-shift by world style', () => {
  it('Modern blurs less, over a wider sharp band, than Retro (the plan defaults)', () => {
    expect(tiltShiftFor('retro')).toEqual({ focus: 0.52, band: 0.22, strength: 2.2 });
    expect(tiltShiftFor('modern')).toEqual({ focus: 0.52, band: 0.3, strength: 1.2 });
  });

  it('applies to both blur passes', () => {
    const post = new PostFX(fakeRenderer(800, 600, 1), new THREE.Scene(), new THREE.PerspectiveCamera(), 'medium');
    const t = tiltShiftFor('modern');
    post.setTiltShift(t.focus, t.band, t.strength);
    const passes = post.composer.passes.filter((p) => (p as { uniforms?: Record<string, unknown> }).uniforms?.uDirection) as unknown as
      { uniforms: Record<string, { value: number }> }[];
    for (const p of passes) expect([p.uniforms.uFocus.value, p.uniforms.uBand.value, p.uniforms.uStrength.value]).toEqual([0.52, 0.3, 1.2]);
  });
});

describe('sun shadow quality', () => {
  it('Retro keeps the pre-Phase-1 shadows at every quality: a 2048 map, three\'s default 1-texel radius', () => {
    for (const q of ['low', 'medium', 'high'] as const) expect(shadowSettings(q, 'retro')).toEqual({ size: 2048, radius: 1 });
  });

  it('Modern: map size by quality (low 1024, medium 2048, high 4096)', () => {
    expect(shadowSettings('low', 'modern').size).toBe(1024);
    expect(shadowSettings('medium', 'modern').size).toBe(2048);
    expect(shadowSettings('high', 'modern').size).toBe(4096);
  });

  it('soft edges: a filter radius of more than one texel at medium and high', () => {
    expect(shadowSettings('medium', 'modern').radius).toBeGreaterThan(1);
    expect(shadowSettings('high', 'modern').radius).toBeGreaterThan(1);
  });

  it('the penumbra is about as wide on the ground at every quality (radius in texels grows with the map)', () => {
    const world = (q: 'low' | 'medium' | 'high') => shadowSettings(q, 'modern').radius / shadowSettings(q, 'modern').size;
    expect(world('high') / world('medium')).toBeCloseTo(1, 1);
    expect(world('low') / world('medium')).toBeCloseTo(1, 1);
  });
});

describe('GTAO at High', () => {
  /** PostFX's GTAO pass (High). */
  const gtaoOf = (post: PostFX) => post.composer.passes.find((p) => p instanceof GTAOPass) as GTAOPass;

  it('draws the same denoise noise on every page load (three seeds it from Math.random)', () => {
    const noise = (seed: number) => {
      // (a different Math.random per construction: two page loads)
      const random = vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
      try {
        const ao = gtaoOf(new PostFX(fakeRenderer(800, 600, 1), new THREE.Scene(), new THREE.PerspectiveCamera(), 'high'));
        expect(ao.pdMaterial.uniforms.tNoise.value).toBe(ao.pdNoiseTexture);
        return ao.pdNoiseTexture.image.data as Uint8Array;
      } finally {
        random.mockRestore();
      }
    };
    const a = noise(1), b = noise(424242);
    expect(a.length).toBe(64 * 64 * 4);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(new Set(a).size).toBeGreaterThan(100); // (noise, not a constant)
    expect(Array.from(gtaoDenoiseNoise(7).image.data as Uint8Array)).not.toEqual(Array.from(a));
  });

  it('draws a mesh with a prepass material of its own in the depth/normal prepass, and its own material again after', () => {
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
    const own = new THREE.MeshStandardMaterial(), prepass = new THREE.ShaderMaterial();
    const actor = new THREE.Mesh(new THREE.PlaneGeometry(), own), plain = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshStandardMaterial());
    const hidden = new THREE.Group();
    hidden.visible = false;
    scene.add(actor, plain, hidden);
    setAoPrepassMaterial(actor, prepass);
    expect(prepass.allowOverride).toBe(false);
    expect(aoPrepassMaterial(actor)).toBe(prepass);
    expect(aoPrepassMaterial(plain)).toBeUndefined();
    const seen: (THREE.Material | THREE.Material[])[] = [];
    // (the renderer calls GTAOPass.render makes; render() records the prepass's materials: its override draw)
    const r = {
      ...fakeRenderer(800, 600, 1), autoClear: true, getClearColor: (c: THREE.Color) => c, getClearAlpha: () => 1,
      setRenderTarget: () => {}, setClearColor: () => {}, setClearAlpha: () => {}, clear: () => {},
      render: (s: THREE.Object3D) => { if ((s as THREE.Scene).overrideMaterial) seen.push(actor.material, plain.material); },
    } as unknown as THREE.WebGLRenderer;
    const post = new PostFX(r, scene, camera, 'high');
    gtaoOf(post).render(r, new THREE.WebGLRenderTarget(8, 8), new THREE.WebGLRenderTarget(8, 8), 0, false);
    expect(seen).toEqual([prepass, plain.material]);
    expect(actor.material).toBe(own);
  });
});
