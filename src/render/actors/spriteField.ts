// The inflation field of the sprite atlas, on the GPU: for every texel of the slots it covers, the height
// (sprite px) the inflated actors displace their front sheet by. Four passes over those slots
// (instanced quads, on the caller's slot attribute: the atlas's own for the overworld, the battlers' in a battle),
// mirroring inflateMath.ts exactly:
//   1 rows    (atlas → A): distance to the nearest transparent texel of the row (≤ WINDOW, else WINDOW + 1)
//   2 columns (A → B):     exact Euclidean distance d − 0.5, profile AMP·sqrt(clamp(d, 0, CAP))
//   3 blur x  (B → A)      4 blur y, masked to the opaque texels (A → B = `texture`)
// Every read stays inside the sprite's own rectangle (outside it is transparent / 0), so neighbouring
// slots never bleed into each other. The overworld recomputes it with every atlas update (sprites animate and change
// slot every frame), the battle only when a battler's slot or tiles change (BattleView.updateField); same size and
// layout as the atlas. Not tied to the overworld (the battle has an instance of its own, with its own parameters).

import * as THREE from 'three';
import { SLOT, SLOT_COLS, SLOT_ROWS } from '../spriteAtlas';
import { INFLATE, blurWeights, type InflateParams } from './inflateMath';
import { glslFloat } from './glsl';

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

  /** Compiles the 4 pass programs (compileAsync) before the field first runs: a session started in Retro
   *  computes no field until it switches to Modern. Resolves when they are ready. */
  compile(renderer: THREE.WebGLRenderer): Promise<void> {
    return Promise.all(this.passes.map((p) => renderer.compileAsync(p.scene, this.camera))).then(() => undefined);
  }

  /** Draws the 4 passes over the first `count` slots of `slots` (instanced quads, like the atlas); every other texel of
   *  the result is 0. */
  update(renderer: THREE.WebGLRenderer, atlas: THREE.Texture, slots: THREE.InstancedBufferAttribute, count: number): void {
    // the caller's slot attribute, not a copy: the overworld's field covers every used slot of the atlas (its own
    // slotRects), the battle's only its battlers' (BattleView.fieldRects)
    if (this.geometry.getAttribute('aSlotSize') !== slots) this.geometry.setAttribute('aSlotSize', slots);
    this.geometry.instanceCount = count;
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false; // (the result clears once, below)
    renderer.setClearColor(0x000000, 0);
    for (let i = 0; i < this.passes.length; i++) {
      const pass = this.passes[i];
      pass.material.uniforms.tAtlas.value = atlas;
      renderer.setRenderTarget(pass.target);
      // Only the result is cleared, before its first pass (2): every pass writes every texel of each sprite rectangle and
      // reads none outside one (inside(): the intermediate target's stale texels are never read), and the result is 0
      // around the rectangles (the self-test's reference). A full clear of a 1024×512 half-float target per pass was most
      // of an update's GPU time (Phase 3 Task 5: ~0.2 ms of it on the dev iGPU).
      if (i === 1) renderer.clear(true, false, false);
      if (count > 0) renderer.render(pass.scene, this.camera);
    }
    renderer.setRenderTarget(prev);
    renderer.setClearColor(this.clearColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
  }

  /**
   * Frees the targets, materials and quad. The last `slots` attribute belongs to the caller (the atlas's
   * slotRects, which the atlas keeps filling): its GL buffer is kept unless `releaseSlots` (a caller's own, e.g. a fixture).
   */
  dispose(releaseSlots = false): void {
    if (!releaseSlots) this.geometry.deleteAttribute('aSlotSize');
    this.geometry.dispose();
    for (const p of this.passes) p.material.dispose();
    this.ping.dispose();
    this.target.dispose();
  }
}
