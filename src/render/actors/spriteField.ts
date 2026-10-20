// The inflation field of the sprite atlas, on the GPU: for every texel of every used slot, the height
// (sprite px) the inflated actors displace their front sheet by. Four passes over the used slots
// (instanced quads, sharing the atlas's slot attribute), mirroring inflateMath.ts exactly:
//   1 rows    (atlas → A): distance to the nearest transparent texel of the row (≤ WINDOW, else WINDOW + 1)
//   2 columns (A → B):     exact Euclidean distance d − 0.5, profile AMP·sqrt(clamp(d, 0, CAP))
//   3 blur x  (B → A)      4 blur y, masked to the opaque texels (A → B = `texture`)
// Every read stays inside the sprite's own rectangle (outside it is transparent / 0), so neighbouring
// slots never bleed into each other. Recomputed whenever the atlas is (sprites animate and change slot
// every frame); same size and layout as the atlas. Not tied to the overworld (battles can reuse it).

import * as THREE from 'three';
import { SLOT, SLOT_COLS, SLOT_ROWS } from '../spriteAtlas';
import { INFLATE, blurWeights, type InflateParams } from './inflateMath';

const VERT = /* glsl */ `
  in vec3 position;     // unit quad 0..1
  in vec4 aSlotSize;    // slot x, slot y (slot units), width, height (px): the atlas's attribute
  flat out vec4 vSlot;  // sprite origin (texels), width, height
  uniform vec2 uSize;
  void main() {
    vec2 o = aSlotSize.xy * ${SLOT}.0;
    vSlot = vec4(o, aSlotSize.zw);
    vec2 px = o + position.xy * aSlotSize.zw;
    gl_Position = vec4(px / uSize * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform sampler2D tAtlas;
  uniform sampler2D tSrc;
  uniform float uW[7];
  flat in vec4 vSlot;
  out vec4 fragColor;

  bool inside(ivec2 p) {
    ivec2 o = ivec2(vSlot.xy);
    return all(greaterThanEqual(p, o)) && all(lessThan(p, o + ivec2(vSlot.zw)));
  }
  float opaque(ivec2 p) { return (inside(p) && texelFetch(tAtlas, p, 0).a >= 0.5) ? 1.0 : 0.0; }
  // the previous pass, 0 outside the sprite
  float src(ivec2 p) { return inside(p) ? texelFetch(tSrc, p, 0).r : 0.0; }

  void main() {
    ivec2 p = ivec2(gl_FragCoord.xy);
    float v = 0.0;
  #if PASS == 1
    if (opaque(p) > 0.5) {
      v = float(WINDOW + 1);
      for (int k = 1; k <= WINDOW; k++) {
        if (opaque(p - ivec2(k, 0)) < 0.5 || opaque(p + ivec2(k, 0)) < 0.5) { v = float(k); break; }
      }
    }
  #elif PASS == 2
    if (opaque(p) > 0.5) {
      float best = 1e9;
      for (int k = -WINDOW; k <= WINDOW; k++) {
        float g = src(p + ivec2(0, k));
        best = min(best, float(k * k) + g * g);
      }
      float d = sqrt(best) - 0.5;
      v = AMP * sqrt(clamp(d, 0.0, CAP));
    }
  #elif PASS == 3
    for (int k = -3; k <= 3; k++) v += uW[k + 3] * src(p + ivec2(k, 0));
  #else
    for (int k = -3; k <= 3; k++) v += uW[k + 3] * src(p + ivec2(0, k));
    v *= opaque(p);
  #endif
    fragColor = vec4(v, 0.0, 0.0, 1.0);
  }
`;

/** A GLSL float literal. */
const glslFloat = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

interface Pass { scene: THREE.Scene; material: THREE.RawShaderMaterial; target: THREE.WebGLRenderTarget }

export class SpriteField {
  /** R = blurred inflation height in sprite px; same size and layout as the atlas; LinearFilter. */
  readonly texture: THREE.Texture;
  /** The final pass's target (holds `texture`): read back by the self-test. */
  readonly target: THREE.WebGLRenderTarget;
  readonly params: InflateParams;
  private ping: THREE.WebGLRenderTarget;
  private geometry = new THREE.InstancedBufferGeometry();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private passes: Pass[] = [];
  private clearColor = new THREE.Color();

  constructor(width = SLOT * SLOT_COLS, height = SLOT * SLOT_ROWS, params: InflateParams = INFLATE) {
    this.params = params;
    // RGBA16F (4 MB each at 1024×512): the passes ping-pong A → B → A → B; B holds the result
    const opts = (filter: THREE.MagnificationTextureFilter): THREE.RenderTargetOptions => ({
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: filter,
      magFilter: filter,
      generateMipmaps: false,
      depthBuffer: false,
    });
    this.ping = new THREE.WebGLRenderTarget(width, height, opts(THREE.NearestFilter));
    this.target = new THREE.WebGLRenderTarget(width, height, opts(THREE.LinearFilter));
    this.texture = this.target.texture;
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geometry.instanceCount = 0;
    const weights = blurWeights(params.sigma);
    const io: [THREE.Texture | null, THREE.WebGLRenderTarget][] = [
      [null, this.ping], [this.ping.texture, this.target], [this.target.texture, this.ping], [this.ping.texture, this.target],
    ];
    io.forEach(([src, target], i) => {
      const material = new THREE.RawShaderMaterial({
        glslVersion: THREE.GLSL3,
        vertexShader: VERT,
        fragmentShader: FRAG,
        defines: { PASS: i + 1, WINDOW: Math.round(params.window), AMP: glslFloat(params.amp), CAP: glslFloat(params.cap) },
        uniforms: {
          tAtlas: { value: null },
          tSrc: { value: src },
          uW: { value: weights },
          uSize: { value: new THREE.Vector2(width, height) },
        },
        blending: THREE.NoBlending,
        depthTest: false,
        depthWrite: false,
      });
      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.frustumCulled = false;
      const scene = new THREE.Scene();
      scene.add(mesh);
      this.passes.push({ scene, material, target });
    });
  }

  /** Draws the 4 passes over the first `count` slots of `slots` (instanced quads, like the atlas). */
  update(renderer: THREE.WebGLRenderer, atlas: THREE.Texture, slots: THREE.InstancedBufferAttribute, count: number): void {
    // the atlas's own attribute (no copy): the field always covers the slots of the atlas it reads
    if (this.geometry.getAttribute('aSlotSize') !== slots) this.geometry.setAttribute('aSlotSize', slots);
    this.geometry.instanceCount = count;
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false; // (each pass clears once, below)
    renderer.setClearColor(0x000000, 0);
    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      pass.material.uniforms.tAtlas.value = atlas;
      renderer.setRenderTarget(pass.target);
      renderer.clear(true, false, false);
      if (count > 0) renderer.render(pass.scene, this.camera);
    }
    renderer.setRenderTarget(prev);
    renderer.setClearColor(this.clearColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    // the slot attribute belongs to the atlas (shared, not copied): disposing it would free its buffer
    this.geometry.deleteAttribute('aSlotSize');
    this.geometry.dispose();
    for (const p of this.passes) p.material.dispose();
    this.ping.dispose();
    this.target.dispose();
  }
}
