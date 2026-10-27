// xBR's decisions of a sprite atlas's slots, baked (the battlers': XBR_DECIDE_GLSL): per texel of each slot rectangle
// the four corners' decisions (0..15 in r, g, b, a: see xbr.glsl.ts), which xbrSampleBaked then applies at every
// fragment — the same result as xbrSample at a fraction of its cost where a texel covers many screen pixels. One pass
// over the given slots (instanced quads in the atlas's slot layout, as SpriteField's), reading only inside each rectangle
// (xbrFetch: outside is transparent, as xbrSample reads it); the rest of the target is 0 (no decision: E as it is).
// Recomputed whenever a slot's colours change (BattleView.updateField).

import * as THREE from 'three';
import { SLOT, SLOT_COLS, SLOT_ROWS } from '../spriteAtlas';
import { XBR_GLSL, XBR_DECIDE_GLSL } from './xbr.glsl';

const VERT = /* glsl */ `
  in vec3 position;     // unit quad 0..1
  in vec4 aSlotSize;    // slot x, slot y (slot units), width, height (px): the atlas's layout
  flat out vec4 vSlot;  // sprite origin (texels), width, height
  uniform vec2 uSize;
  void main() {
    vec2 o = aSlotSize.xy * ${SLOT}.0;
    vSlot = vec4(o, aSlotSize.zw);
    gl_Position = vec4((o + position.xy * aSlotSize.zw) / uSize * 2.0 - 1.0, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  precision highp int;
  uniform sampler2D tAtlas;
  flat in vec4 vSlot;
  out vec4 fragColor;
  ${XBR_GLSL}
  ${XBR_DECIDE_GLSL}
  void main() {
    ivec2 o = ivec2(vSlot.xy);
    fragColor = xbrDecisions(tAtlas, ivec2(gl_FragCoord.xy), ivec4(o, o + ivec2(vSlot.zw))) / 255.0;
  }
`;

export class XbrBake {
  /** RGBA8, the atlas's size and layout, NearestFilter: the decisions (× 1/255). */
  readonly target: THREE.WebGLRenderTarget;
  private geometry = new THREE.InstancedBufferGeometry();
  private material: THREE.RawShaderMaterial;
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private clearColor = new THREE.Color();

  constructor(width = SLOT * SLOT_COLS, height = SLOT * SLOT_ROWS) {
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false,
    });
    this.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0]), 3));
    this.geometry.instanceCount = 0;
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: VERT, fragmentShader: FRAG,
      uniforms: { tAtlas: { value: null }, uSize: { value: new THREE.Vector2(width, height) } },
      blending: THREE.NoBlending, depthTest: false, depthWrite: false,
    });
    const mesh = new THREE.Mesh(this.geometry, this.material);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  get texture(): THREE.Texture {
    return this.target.texture;
  }

  /** Compiles the pass's program (compileAsync) before it first runs; resolves when it is ready. */
  compile(renderer: THREE.WebGLRenderer): Promise<void> {
    return renderer.compileAsync(this.scene, this.camera).then(() => undefined);
  }

  /** Bakes the decisions of the first `count` slots of `slots` (the atlas's slot layout) from `atlas`. */
  update(renderer: THREE.WebGLRenderer, atlas: THREE.Texture, slots: THREE.InstancedBufferAttribute, count: number): void {
    if (this.geometry.getAttribute('aSlotSize') !== slots) this.geometry.setAttribute('aSlotSize', slots);
    this.geometry.instanceCount = count;
    this.material.uniforms.tAtlas.value = atlas;
    const prev = renderer.getRenderTarget();
    renderer.getClearColor(this.clearColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.target);
    renderer.clear(true, false, false);
    if (count > 0) renderer.render(this.scene, this.camera);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(this.clearColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
  }

  /** Frees the target, material and quad (`releaseSlots`: the last slot attribute's GL buffer too: a caller's own). */
  dispose(releaseSlots = false): void {
    if (!releaseSlots) this.geometry.deleteAttribute('aSlotSize');
    this.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
