// Upright camera-facing cards for every world sprite (player, NPCs, field effects).
// One instanced draw call; images come from the SpriteAtlas.

import * as THREE from 'three';

const MAX = 128;

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 aFoot;      // world position of the sprite's foot point
  attribute vec4 aSize;      // width, height (world units), lift (world units), flat (1 = lies on ground)
  attribute vec4 aUv;        // u0, v0 (top), u1, v1 (bottom)
  attribute vec4 aTint;      // rgb multiplier, alpha
  uniform vec3 uRight;       // camera right vector projected on XZ
  varying vec2 vUv;
  varying vec4 vTint;
  varying vec3 vWorld;
  void main() {
    vec2 local = position.xy; // x in [-0.5, 0.5], y in [0, 1]
    vec3 p;
    if (aSize.w > 0.5) {
      // flat decal on the ground (ripples, footprints)
      p = aFoot + vec3(local.x * aSize.x, 0.02, (local.y - 1.0) * aSize.y);
    } else {
      p = aFoot + uRight * (local.x * aSize.x) + vec3(0.0, local.y * aSize.y + aSize.z, 0.0);
    }
    vUv = vec2(mix(aUv.x, aUv.z, local.x + 0.5), mix(aUv.w, aUv.y, local.y));
    vTint = aTint;
    vWorld = p;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D tAtlas;
  uniform vec3 uLight;       // ambient + sun contribution for characters
  varying vec2 vUv;
  varying vec4 vTint;
  varying vec3 vWorld;
  void main() {
    vec4 c = texture2D(tAtlas, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb * uLight * vTint.rgb, vTint.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/** Shadow-depth fragment of an alpha-tested atlas sprite (varying `vUv`): the cards' and the inflated actors' twins. */
export const DEPTH_FRAG = /* glsl */ `
  #include <common>
  #include <packing>
  uniform sampler2D tAtlas;
  varying vec2 vUv;
  void main() {
    if (texture2D(tAtlas, vUv).a < 0.5) discard;
    gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
  }
`;

export interface BillboardSpec {
  footX: number;
  footY: number;
  footZ: number;
  width: number;
  height: number;
  lift: number;
  flat: boolean;
  slot: { u0: number; v0: number; u1: number; v1: number };
  tint?: [number, number, number, number];
}

export class Billboards {
  readonly mesh: THREE.Mesh;
  private geometry: THREE.InstancedBufferGeometry;
  private foot: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private uv: THREE.InstancedBufferAttribute;
  private tint: THREE.InstancedBufferAttribute;
  readonly material: THREE.ShaderMaterial;
  private depthMaterial: THREE.ShaderMaterial;

  /** `atlas`: the sprite atlas (SpriteAtlas) whose render target the cards sample. */
  constructor(atlas: { target: { texture: THREE.Texture } }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.foot = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    this.tint = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4);
    for (const a of [this.foot, this.size, this.uv, this.tint]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aFoot', this.foot);
    this.geometry.setAttribute('aSize', this.size);
    this.geometry.setAttribute('aUv', this.uv);
    this.geometry.setAttribute('aTint', this.tint);
    this.geometry.instanceCount = 0;

    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        tAtlas: { value: null },
        uRight: { value: new THREE.Vector3(1, 0, 0) },
        uLight: { value: new THREE.Vector3(1, 1, 1) },
      },
    ]);
    uniforms.tAtlas.value = atlas.target.texture;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      fog: true,
      side: THREE.DoubleSide,
    });
    this.depthMaterial = new THREE.ShaderMaterial({
      vertexShader: VERT.replace('#include <fog_vertex>', '').replace('#include <fog_pars_vertex>', ''),
      fragmentShader: DEPTH_FRAG,
      uniforms: { tAtlas: uniforms.tAtlas, uRight: uniforms.uRight },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = this.depthMaterial;
    this.mesh.renderOrder = 2;
  }

  /** A geometry sharing this mesh's instance attributes (used by BlobShadows). */
  geometryForShadows(): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.index = this.geometry.index;
    g.setAttribute('position', this.geometry.getAttribute('position'));
    g.setAttribute('aFoot', this.foot);
    g.setAttribute('aSize', this.size);
    this.shadowGeometries.push(g);
    return g;
  }

  private shadowGeometries: THREE.InstancedBufferGeometry[] = [];

  /** Cards drawn (instances). */
  get count(): number {
    return this.geometry.instanceCount;
  }

  set(list: BillboardSpec[], cameraRight: THREE.Vector3, light: THREE.Color): void {
    const n = Math.min(MAX, list.length);
    for (let i = 0; i < n; i++) {
      const s = list[i];
      this.foot.setXYZ(i, s.footX, s.footY, s.footZ);
      this.size.setXYZW(i, s.width, s.height, s.lift, s.flat ? 1 : 0);
      this.uv.setXYZW(i, s.slot.u0, s.slot.v0, s.slot.u1, s.slot.v1);
      const t = s.tint ?? [1, 1, 1, 1];
      this.tint.setXYZW(i, t[0], t[1], t[2], t[3]);
    }
    this.geometry.instanceCount = n;
    for (const g of this.shadowGeometries) g.instanceCount = n;
    for (const a of [this.foot, this.size, this.uv, this.tint]) a.needsUpdate = true;
    this.material.uniforms.uRight.value.copy(cameraRight);
    this.material.uniforms.uLight.value.set(light.r, light.g, light.b);
  }
}

const SHADOW_VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 aFoot;
  attribute vec4 aSize;   // width, height, lift, flat
  uniform float uScale;   // size multiplier (1 under cards)
  varying vec2 vLocal;
  varying float vFade;
  void main() {
    // Shrink and fade the shadow as the sprite lifts off the ground (jumps).
    float k = 1.0 / (1.0 + aSize.z * 0.8);
    vec2 r = vec2(aSize.x * 0.42, aSize.x * 0.24) * k * uScale;
    vec3 p = aFoot + vec3(position.x * r.x * 2.0, 0.015, (position.y - 0.5) * r.y * 2.0);
    vLocal = vec2(position.x * 2.0, (position.y - 0.5) * 2.0);
    vFade = k * (aSize.w > 0.5 ? 0.0 : 1.0);
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const SHADOW_FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uStrength;
  varying vec2 vLocal;
  varying float vFade;
  void main() {
    float d = length(vLocal);
    float a = smoothstep(1.0, 0.35, d) * uStrength * vFade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(0.02, 0.03, 0.05, a);
    #include <fog_fragment>
  }
`;

/**
 * Soft elliptical contact shadows under sprites, sharing their instance buffers: under the cards
 * (Billboards) or the inflated actors — any source of a 4-vertex quad with the aFoot / aSize
 * instance attributes (aSize.w = 1 marks a flat decal, which gets none).
 */
export class BlobShadows {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;

  constructor(source: { geometryForShadows(): THREE.InstancedBufferGeometry }) {
    const g = source.geometryForShadows();
    this.material = new THREE.ShaderMaterial({
      vertexShader: SHADOW_VERT,
      fragmentShader: SHADOW_FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uStrength: { value: 0.45 }, uScale: { value: 1 } }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
  }

  setStrength(v: number): void {
    this.material.uniforms.uStrength.value = v;
  }

  /** Size of the ellipse relative to the sprite's width (default 1). */
  setScale(k: number): void {
    this.material.uniforms.uScale.value = k;
  }
}
