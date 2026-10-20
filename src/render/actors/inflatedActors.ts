// Inflated actors (Modern): every upright sprite as a camera-facing grid mesh (ACTOR_GRID segments)
// pushed towards the camera by the inflation field (SpriteField, sprite px), shaded by the scene's
// lights with normals from the field's gradient, with a sky-tinted rim. It casts its silhouette as a
// shadow (an alpha-tested depth twin with the same displacement) and receives shadows (trees).
// One instanced draw call; the instance layout is the cards' (Billboards): aFoot, aSize (width,
// height, lift, 0), aUv. The front silhouette is the sprite's own (alpha test on the game's frame).
// Not tied to the overworld: battles can reuse it with any atlas and field of the same layout.

import * as THREE from 'three';
import { DEPTH_FRAG, type BillboardSpec } from '../overworld/billboards';

/** Grid segments per actor (spec §6): one per sprite pixel of a 16×32 character. */
export const ACTOR_GRID = { x: 16, y: 32 };
/** Rim strength (× the sky colour). */
export const RIM = 0.35;
/** The contact shadow under each inflated actor (the sun shadow is its silhouette). */
export const CONTACT = { strength: 0.25, scale: 0.75 };
/** Instances (gSprites has 64 entries). */
export const MAX_ACTORS = 64;
/** Share of the sprite's height over which the depth relief fades in from the feet (tall-grass blades
 *  reach ~0.35 of a 2-unit character): the legs stay at the card's depth. Shading is not affected. */
export const RELIEF_FADE = { from: 0.15, to: 0.55 };
/** How far (world units) the shadow twin is pushed away from the light: the sheet stands steeply to a high
 *  sun, so its own depth varies more across the soft-shadow filter than the global bias covers (grainy
 *  self-shadow acne). The cast shadow does not move (the push follows the light's rays). */
export const SHADOW_PUSH = 0.3;
/** Share of the cards' light (charLight) the actors' diffuse light never drops below. */
export const LIGHT_FLOOR = 0.6;
/** Soft ceiling of a point light's irradiance on an actor (the Flash lantern). */
export const LAMP_CEILING = 5;

// The field at an atlas uv, clamped to the sprite's own rectangle (texels, rows bottom-up): never
// reads a neighbouring slot; its gradient in px per px (scale-free). The relief faces the viewer: each
// point of the card rises along its own ray to the eye (uEye), so the camera sees exactly the sprite's
// pixels; the shading normal (world) is the actor's facing (towards the eye) tilted by the gradient
// across the screen's right / up axes, as a bas-relief of the sprite seen face-on.
const FIELD_GLSL = /* glsl */ `
uniform sampler2D tField;
uniform vec2 uAtlasSize;
uniform vec3 uRight;   // camera right on XZ (unit): the sheet's x axis
uniform vec3 uEye;     // the camera's position (world): the relief rises towards it
varying vec3 vFacing;  // unit, from the actor towards the eye
float fieldH(vec2 uv, vec4 rect) {
  return texture(tField, clamp(uv * uAtlasSize, rect.xy + 0.5, rect.zw - 0.5) / uAtlasSize).r;
}
vec2 fieldGrad(vec2 uv, vec4 rect) {
  vec2 t = 1.0 / uAtlasSize;
  return 0.5 * vec2(fieldH(uv + vec2(t.x, 0.0), rect) - fieldH(uv - vec2(t.x, 0.0), rect),
                    fieldH(uv + vec2(0.0, t.y), rect) - fieldH(uv - vec2(0.0, t.y), rect));
}
vec3 actorNormal(vec3 f, vec2 g) {
  vec3 r = normalize(uRight - dot(uRight, f) * f); // screen right, then screen up = f x r
  return normalize(f - g.x * r - g.y * cross(f, r));
}
`;

const VERT_PRELUDE = /* glsl */ `
attribute vec3 aFoot;   // world position of the sprite's foot point
attribute vec4 aSize;   // width, height, lift (world units), 0
attribute vec4 aUv;     // u0, v0 (top), u1, v1 (bottom)
varying vec2 vAtlasUv;
varying vec4 vRect;     // the sprite's rectangle in atlas texels: x0, y0 (bottom), x1, y1 (top)
${FIELD_GLSL}
`;

// main(): the grid vertex's atlas uv (x in [-0.5, 0.5], y in [0, 1] across the sprite), its point on
// the flat card and the actor's facing ...
const VERT_CARD = /* glsl */ `
vec2 local = position.xy;
vec2 auv = vec2(mix(aUv.x, aUv.z, local.x + 0.5), mix(aUv.w, aUv.y, local.y));
vRect = vec4(aUv.x, aUv.w, aUv.z, aUv.y) * uAtlasSize.xyxy;
vAtlasUv = auv;
vec3 card = aFoot + uRight * (local.x * aSize.x) + vec3(0.0, local.y * aSize.y + aSize.z, 0.0);
vFacing = normalize(uEye - (aFoot + vec3(0.0, 0.5 * aSize.y + aSize.z, 0.0)));
`;

// ... and its position: pushed towards the eye by the field (sprite px → world units). The relief fades
// in above the legs (RELIEF_FADE): they keep the card's depth, so 3D grass blades in front still hide them.
const VERT_POSITION = /* glsl */ `
float pxWorld = aSize.x / max((aUv.z - aUv.x) * uAtlasSize.x, 1.0);
float relief = smoothstep(${RELIEF_FADE.from.toFixed(2)}, ${RELIEF_FADE.to.toFixed(2)}, local.y);
vec3 transformed = card + normalize(uEye - card) * (fieldH(auv, vRect) * pxWorld * relief);
`;

const FRAG_PRELUDE = /* glsl */ `
uniform sampler2D tAtlas;
uniform vec3 uRimColor;
uniform float uRim;
uniform vec3 uFloor;
varying vec2 vAtlasUv;
varying vec4 vRect;
${FIELD_GLSL}
`;

const FRAG_COLOR = /* glsl */ `
vec4 actorTexel = texture(tAtlas, vAtlasUv);
if (actorTexel.a < 0.5) discard;
diffuseColor.rgb *= actorTexel.rgb;
`;

// per-pixel normal (smooth across the grid's facets), in view space
const FRAG_NORMAL = /* glsl */ `
normal = normalize((viewMatrix * vec4(actorNormal(normalize(vFacing), fieldGrad(vAtlasUv, vRect)), 0.0)).xyz);
`;

const FRAG_RIM = /* glsl */ `
totalEmissiveRadiance += uRimColor * uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
`;

// Point lights (the cave lantern, carried at the player's chest) reach an actor with a soft ceiling
// (irradiance E -> E / (1 + E / LAMP_CEILING)): a face next to the lamp is lit warm, not blown out.
const POINT_ATTENUATION = 'light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );';
const LAMP_GLSL = `\nlight.color /= 1.0 + max(light.color.r, max(light.color.g, light.color.b)) / ${LAMP_CEILING.toFixed(2)};`;

// The diffuse light never drops below uFloor (LIGHT_FLOOR × the cards' light): actors stay readable in
// the dark (a cave beyond the lantern, deep shade) and never turn black.
const FRAG_FLOOR = /* glsl */ `
reflectedLight.indirectDiffuse += max(vec3(0.0),
  material.diffuseColor * uFloor - reflectedLight.directDiffuse - reflectedLight.indirectDiffuse);
`;

const DEPTH_VERT = /* glsl */ `
#include <common>
${VERT_PRELUDE}
varying vec2 vUv;
void main() {
${VERT_CARD}
${VERT_POSITION}
  vUv = vAtlasUv;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  mvPosition.z -= ${SHADOW_PUSH.toFixed(3)}; // away from the light, along its rays
  gl_Position = projectionMatrix * mvPosition;
}
`;

/** Replaces `chunk` in `src`; throws if three renamed it (the patch would silently do nothing). */
function patch(src: string, chunk: string, by: string): string {
  const include = `#include <${chunk}>`;
  if (!src.includes(include)) throw new Error(`inflatedActors: three shader chunk <${chunk}> not found`);
  return src.replace(include, by);
}

/** Writes `v` (as float32) at `a[k]`; 1 if that changed the value, else 0. */
function put(a: Float32Array, k: number, v: number): number {
  const f = Math.fround(v);
  if (a[k] === f) return 0;
  a[k] = f;
  return 1;
}

/** Marks the first `n` instances of `a` for upload (whole instances; at most MAX_ACTORS). */
function markRange(a: THREE.InstancedBufferAttribute, n: number): void {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}

/** three's lights_pars_begin with the point lights' soft ceiling; throws if the attenuation line changed. */
function lampCeiling(parsBegin: string): string {
  if (!parsBegin.includes(POINT_ATTENUATION)) throw new Error('inflatedActors: point-light attenuation not found in lights_pars_begin');
  return parsBegin.replace(POINT_ATTENUATION, POINT_ATTENUATION + LAMP_GLSL);
}

export class InflatedActors {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.InstancedBufferGeometry();
  private quad: THREE.BufferGeometry;
  private foot = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTORS * 3), 3);
  private size = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTORS * 4), 4);
  private uv = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTORS * 4), 4);
  private shadowGeometries: THREE.InstancedBufferGeometry[] = [];
  /** The most instances ever set (the uploaded part of the instance buffers). */
  private used = 0;
  private uniforms: {
    tAtlas: { value: THREE.Texture }; tField: { value: THREE.Texture }; uRight: { value: THREE.Vector3 };
    uEye: { value: THREE.Vector3 }; uAtlasSize: { value: THREE.Vector2 }; uRimColor: { value: THREE.Color };
    uRim: { value: number }; uFloor: { value: THREE.Color };
  };

  /**
   * `atlas`: the sprite atlas the actors sample; `field`: its inflation field (same layout, R = height in
   * sprite px); `rimColor`: the rim's colour (kept by reference: the sky's, updated by the owner).
   */
  constructor(atlas: THREE.Texture, field: THREE.Texture, rimColor: { value: THREE.Color },
    atlasSize = new THREE.Vector2(1024, 512)) {
    const grid = new THREE.PlaneGeometry(1, 1, ACTOR_GRID.x, ACTOR_GRID.y);
    grid.translate(0, 0.5, 0); // x in [-0.5, 0.5], y in [0, 1]
    this.geometry.index = grid.index;
    this.geometry.setAttribute('position', grid.getAttribute('position'));
    // (unused by the shader, which builds its own normal: its presence enables the shadow normal bias)
    this.geometry.setAttribute('normal', grid.getAttribute('normal'));
    for (const a of [this.foot, this.size, this.uv]) a.setUsage(THREE.DynamicDrawUsage);
    this.geometry.setAttribute('aFoot', this.foot);
    this.geometry.setAttribute('aSize', this.size);
    this.geometry.setAttribute('aUv', this.uv);
    this.geometry.instanceCount = 0;
    this.quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

    const u = this.uniforms = {
      tAtlas: { value: atlas }, tField: { value: field }, uRight: { value: new THREE.Vector3(1, 0, 0) },
      uEye: { value: new THREE.Vector3(0, 0, 1e5) }, uAtlasSize: { value: atlasSize.clone() }, uRimColor: rimColor,
      uRim: { value: RIM }, uFloor: { value: new THREE.Color(0, 0, 0) },
    };
    const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    // the sun may light the sheet from behind: its depth twin draws both faces
    material.shadowSide = THREE.DoubleSide;
    material.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, u);
      let v = VERT_PRELUDE + s.vertexShader;
      v = patch(v, 'beginnormal_vertex', VERT_CARD + 'vec3 objectNormal = actorNormal(vFacing, fieldGrad(auv, vRect));');
      v = patch(v, 'begin_vertex', VERT_POSITION);
      s.vertexShader = v;
      let f = FRAG_PRELUDE + s.fragmentShader;
      f = patch(f, 'map_fragment', '#include <map_fragment>\n' + FRAG_COLOR);
      f = patch(f, 'normal_fragment_maps', '#include <normal_fragment_maps>\n' + FRAG_NORMAL);
      f = patch(f, 'emissivemap_fragment', '#include <emissivemap_fragment>\n' + FRAG_RIM);
      f = patch(f, 'lights_pars_begin', lampCeiling(THREE.ShaderChunk.lights_pars_begin));
      f = patch(f, 'lights_fragment_end', '#include <lights_fragment_end>\n' + FRAG_FLOOR);
      s.fragmentShader = f;
    };
    material.customProgramCacheKey = () => 'actor:inflated:1';

    const depth = new THREE.ShaderMaterial({
      vertexShader: DEPTH_VERT,
      fragmentShader: DEPTH_FRAG,
      uniforms: { tAtlas: u.tAtlas, tField: u.tField, uRight: u.uRight, uEye: u.uEye, uAtlasSize: u.uAtlasSize },
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'inflatedActors';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = depth;
    this.mesh.renderOrder = 2;
  }

  /** Actors drawn (instances). */
  get count(): number {
    return this.geometry.instanceCount;
  }

  /**
   * This frame's actors, in the cards' placement (`flat` and `tint` are ignored). `cameraRight`: the
   * camera's right vector on XZ (unit); `eye`: the camera's position (world), which the relief rises
   * towards (default: far away horizontally, ahead of `cameraRight`).
   */
  set(list: readonly BillboardSpec[], cameraRight: THREE.Vector3, eye?: THREE.Vector3): void {
    const n = Math.min(MAX_ACTORS, list.length);
    const foot = this.foot.array as Float32Array, size = this.size.array as Float32Array, uv = this.uv.array as Float32Array;
    let dFoot = 0, dSize = 0, dUv = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i];
      dFoot |= put(foot, i * 3, s.footX) | put(foot, i * 3 + 1, s.footY) | put(foot, i * 3 + 2, s.footZ);
      dSize |= put(size, i * 4, s.width) | put(size, i * 4 + 1, s.height) | put(size, i * 4 + 2, s.lift) | put(size, i * 4 + 3, 0);
      dUv |= put(uv, i * 4, s.slot.u0) | put(uv, i * 4 + 1, s.slot.v0) | put(uv, i * 4 + 2, s.slot.u1) | put(uv, i * 4 + 3, s.slot.v1);
    }
    // Upload only the attributes that changed: on ANGLE (D3D11, Intel) each draw reading an instance
    // buffer re-uploaded this frame cost ~0.3-0.5 ms of GPU time (measured), so a still scene uploads
    // nothing. (Up to the most instances ever set: the GPU copy mirrors the arrays there, whatever the
    // instance count did in between.)
    this.used = Math.max(this.used, n);
    if (dFoot) markRange(this.foot, this.used);
    if (dSize) markRange(this.size, this.used);
    if (dUv) markRange(this.uv, this.used);
    this.geometry.instanceCount = n;
    for (const g of this.shadowGeometries) g.instanceCount = n;
    this.uniforms.uRight.value.copy(cameraRight);
    if (eye) this.uniforms.uEye.value.copy(eye);
    else this.uniforms.uEye.value.set(-cameraRight.z, 0, cameraRight.x).multiplyScalar(1e5);
  }

  /** The light flat sprite cards would get here (charLight): the actors' diffuse light stays ≥ LIGHT_FLOOR × it. */
  setLightFloor(cardLight: THREE.Color): void {
    this.uniforms.uFloor.value.copy(cardLight).multiplyScalar(LIGHT_FLOOR);
  }

  /** HD edge smoothing of the sprite pixels (Task 6); no-op for now. */
  setSmoothing(_on: boolean): void {}

  /** A 4-vertex quad geometry sharing this mesh's aFoot / aSize instance attributes (BlobShadows). */
  geometryForShadows(): THREE.InstancedBufferGeometry {
    const g = new THREE.InstancedBufferGeometry();
    g.index = this.quad.index;
    g.setAttribute('position', this.quad.getAttribute('position'));
    g.setAttribute('aFoot', this.foot);
    g.setAttribute('aSize', this.size);
    g.instanceCount = this.geometry.instanceCount;
    this.shadowGeometries.push(g);
    return g;
  }
}
