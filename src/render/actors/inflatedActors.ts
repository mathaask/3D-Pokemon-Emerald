// Inflated actors (Modern): every upright sprite as a camera-facing grid mesh (ACTOR_GRID segments)
// pushed towards the camera by the inflation field (SpriteField, sprite px), shaded by the scene's
// lights with per-pixel normals from the field (SHADE_GAIN), a sky-tinted rim, a light floor and a
// highlight shoulder. It casts its silhouette as a shadow (an alpha-tested depth twin with the same
// displacement, pushed away from the light) and receives shadows (trees).
// One instanced draw call; the instance data is the cards' (Billboards: foot, size (width, height, lift, 0), uv), read
// from a uniform array by gl_InstanceID: on ANGLE (D3D11, Intel) the first draw of this grid that reads an instance
// vertex buffer re-uploaded this frame cost ~0.3-0.5 ms of GPU time wherever it fell (the shadow twin, the main pass,
// a 1×1 pre-draw: Phase 2 Task 12), a uniform array nothing measurable. A device with too few vertex uniform vectors
// for that array (instanceUniformsFit) reads the same data from instance attributes instead (uploaded on change).
// The contact shadows keep instance attributes.
// The front silhouette is the sprite's own (alpha test on the game's frame; with HD edges, setSmoothing, on its
// xBR-smoothed outline — the shadow's too).
// Not tied to the overworld: a variant (InflatedVariant) gives another scene its own programs, field parameters and relief
// — the battle's (BATTLE_VARIANT: 64-px pictures, relief down to the feet) — with any atlas and field of the same layout.

import * as THREE from 'three';
import { ACTOR_RENDER_ORDER, type BillboardSpec } from '../overworld/billboards';
import { put, markRange } from '../instanceUpload';
import { INFLATE, BATTLE_INFLATE, type InflateParams } from './inflateMath';
import { SLOT, SLOT_COLS, SLOT_ROWS } from '../spriteAtlas';
import { XBR_GLSL, XBR_BAKED_GLSL } from './xbr.glsl';
import { afterChunk, glslFloat, patchChunk } from './glsl';

/** Grid segments per actor (spec §6): one per sprite pixel of a 16×32 character. */
export const ACTOR_GRID = { x: 16, y: 32 };
/** Rim strength (× the sky colour × the surface colour; a uniform). */
export const RIM = 0.6;
/** The contact shadow under each inflated actor (the sun shadow is its silhouette). */
export const CONTACT = { strength: 0.25, scale: 0.75 };
/** Instances (gSprites has 64 entries). */
export const MAX_ACTORS = 64;
/** vec4s of instance data per actor in the uInst uniform array: foot, size, uv. */
const INST_VEC4 = 3;
/** Vertex uniform vectors the uInst array takes (MAX_ACTORS × INST_VEC4 = 192). */
export const INST_UNIFORM_VECTORS = MAX_ACTORS * INST_VEC4;
/**
 * Fewest vertex uniform vectors (gl MAX_VERTEX_UNIFORM_VECTORS) for the uniform-array path; below it the actors read
 * instance attributes (same data, uploaded on change). Estimate for the main program's vertex stage: uInst 192, three's
 * standard material ≈ 21 (model/view/projection/normal matrices, camera), ≈ 9 per shadow-casting directional light
 * (shadow matrix + DirectionalLightShadow; the overworld's sun), ≈ 11 per shadow-casting point light (none today), ours 3
 * (uRight, uEye, uAtlasSize): ≈ 225 for the overworld — over WebGL2's guaranteed 256 once a second shadowed light
 * arrives, and drivers count some vectors more coarsely. 192 + 128 = 320 leaves ≈ 95 vectors of margin (8+ more
 * shadowed lights). Desktop GPUs (ANGLE D3D11: 4096) report far more; mobile GPUs vary, down to WebGL2's minimum of 256
 * (attributes). A device that reports enough but still fails to link falls back at run time (instanceUniformsFailed).
 */
export const INST_UNIFORMS_MIN_VERTEX_VECTORS = INST_UNIFORM_VECTORS + 128;

/** Whether the actors can read their instance data from the uniform array on a device with `maxVertexUniforms` vertex
 *  uniform vectors (renderer.capabilities.maxVertexUniforms). `override` (the URL's `?actorUniforms=`): '0' forces the
 *  attribute fallback, '1' the uniform array; anything else decides by the device. */
export function instanceUniformsFit(maxVertexUniforms: number, override?: string | null): boolean {
  if (override === '0') return false;
  if (override === '1') return true;
  return maxVertexUniforms >= INST_UNIFORMS_MIN_VERTEX_VECTORS;
}

/** The program keys (customProgramCacheKey) of the actors' main material and shadow twin, per instance-data path and
 *  variant (its tag; '' = the overworld's: 'actor:inflated:1:…'). */
const programKey = (twin: boolean, uniforms: boolean, tag = '') =>
  `actor:inflated${tag ? '-' + tag : ''}${twin ? '-depth' : ''}:1:${uniforms ? 'uniforms' : 'attributes'}`;

/** A shader program as three lists it (renderer.info.programs): its cache key (ending with the material's
 *  customProgramCacheKey) and, once it was first used with renderer.debug.checkShaderErrors on (three's default), its
 *  link diagnostics (none when it linked without a log). */
export interface ProgramInfo { cacheKey: string; diagnostics?: { runnable: boolean } }

/** Whether a program of the uniform-array path (main or shadow twin) of the variant tagged `tag` ('' = the overworld's)
 *  failed to link on this device although instanceUniformsFit let it through (a driver counting vectors more coarsely):
 *  those actors then need the attribute path (ActorLayer / BattleActors.checkInstanceUniforms, after the precompile). */
export function instanceUniformsFailed(programs: readonly ProgramInfo[], tag = ''): boolean {
  const keys = [programKey(false, true, tag), programKey(true, true, tag)];
  return programs.some((p) => p.diagnostics?.runnable === false && keys.some((k) => p.cacheKey.endsWith(k)));
}

/** How far the shading normal tilts: tan(tilt) across the body. The slope is that of the field's distance
 *  estimate (h / amp)², which rises evenly from the outline (the sqrt profile's slope is steepest at the
 *  outline): each body part shades like a pillow, the pixels along the outline keep their colour.
 *  Independent of the field's amp (the relief's depth: the variant's params.amp normalises it). Baked into the shader
 *  (compile-time). */
export const SHADE_GAIN = 2.75;
/** The shading slope's central differences span ±SHADE_STEP texels (smooths creases between lobes).
 *  Baked into the shader (compile-time). */
export const SHADE_STEP = 2;
/** Share of the sprite's height over which the depth relief fades in from the feet (tall-grass blades
 *  reach ~0.35 of a 2-unit character): the legs stay at the card's depth. Shading is not affected.
 *  Baked into the shader (compile-time). */
export const RELIEF_FADE = { from: 0.15, to: 0.55 };

/** What makes one scene's inflated actors differ from another's: their own programs (`tag` in the program keys), the
 *  field parameters their field is computed with (the shading slope's normaliser uses params.amp) and the relief's fade
 *  above the feet. Baked into the shaders (compile-time). */
export interface InflatedVariant {
  /** '' = the overworld's: its program keys stay 'actor:inflated:1:…'. */
  tag: string;
  /** The field's parameters (SpriteField's). */
  params: InflateParams;
  /** The relief fades in over this share of the sprite's height from the feet; null: full relief down to the feet. */
  reliefFade: { from: number; to: number } | null;
  /** HD edges from baked xBR decisions (XbrBake; the constructor's `xbrBake` texture): the same result, for sprites
   *  magnified so far that xBR's per-fragment decisions dominate (the battlers, ~5×). Absent: xBR per fragment. */
  xbrBaked?: boolean;
}

/** The overworld's characters: 16×32 sprites, the legs at the card's depth (3D grass blades hide them). */
export const OVERWORLD_VARIANT: InflatedVariant = { tag: '', params: INFLATE, reliefFade: RELIEF_FADE };
/** The battlers (Phase 3): 64-px Pokémon and trainer pictures on their platforms, relief down to the feet. */
export const BATTLE_VARIANT: InflatedVariant = { tag: 'battle', params: BATTLE_INFLATE, reliefFade: null, xbrBaked: true };
/** How far (world units) the shadow twin is pushed away from the light: the sheet stands steeply to a high
 *  sun, so its own depth varies more across the soft-shadow filter than the global bias covers (grainy
 *  self-shadow acne). The cast shadow does not move (the push follows the light's rays). Baked into the
 *  shader (compile-time). */
export const SHADOW_PUSH = 0.3;
/** Share of the cards' light (charLight, by luminance) the actors' diffuse light never drops below; the
 *  lit colour keeps its hue (a uniform, set per frame). It also sets how deep a received shadow gets. */
export const LIGHT_FLOOR = 0.6;
/** Soft ceiling of a point light's irradiance on an actor (the Flash lantern). Baked into the shader
 *  (compile-time). */
export const LAMP_CEILING = 9;
/** The actors' outgoing light eases from `knee` towards `max` (linear, per brightest channel, hue kept):
 *  under the bloom threshold, so sun-facing pale pixels never glow. Baked into the shader (compile-time). */
export const SHOULDER = { knee: 0.8, max: 1.0 };

// The field at an atlas uv, clamped to the sprite's own rectangle (texels, rows bottom-up): never
// reads a neighbouring slot; its gradient in px per px (scale-free). The relief faces the viewer: each
// point of the card rises along its own ray to the eye (uEye), so the camera sees exactly the sprite's
// pixels; the shading normal (world) is the actor's facing (towards the eye) tilted by the shading
// slope across the screen's right / up axes, as a bas-relief of the sprite seen face-on. (Per variant: the slope's
// normaliser is its field's amp.)
const fieldGlsl = (v: InflatedVariant) => /* glsl */ `
uniform sampler2D tField;
uniform vec2 uAtlasSize;
uniform vec3 uRight;   // camera right on XZ (unit): the sheet's x axis
uniform vec3 uEye;     // the camera's position (world): the relief rises towards it
varying vec3 vFacing;  // unit, from the actor towards the eye
float fieldH(vec2 uv, vec4 rect) {
  return texture(tField, clamp(uv * uAtlasSize, rect.xy + 0.5, rect.zw - 0.5) / uAtlasSize).r;
}
// central differences over ±s texels (px per px)
vec2 fieldGrad(vec2 uv, vec4 rect, float s) {
  vec2 t = s / uAtlasSize;
  return (0.5 / s) * vec2(fieldH(uv + vec2(t.x, 0.0), rect) - fieldH(uv - vec2(t.x, 0.0), rect),
                          fieldH(uv + vec2(0.0, t.y), rect) - fieldH(uv - vec2(0.0, t.y), rect));
}
// SHADE_GAIN x the slope of (h / amp)^2 = SHADE_GAIN x 2 h grad(h) / amp^2, over ±SHADE_STEP texels
vec2 shadeSlope(vec2 uv, vec4 rect) {
  return ${glslFloat(SHADE_GAIN * 2 / (v.params.amp * v.params.amp))} * fieldH(uv, rect) * fieldGrad(uv, rect, ${glslFloat(SHADE_STEP)});
}
vec3 actorNormal(vec3 f, vec2 g) {
  vec3 r = normalize(uRight - dot(uRight, f) * f); // screen right, then screen up = f x r
  return normalize(f - g.x * r - g.y * cross(f, r));
}
`;

// Per actor: its foot point (world), size (width, height, lift; world units, 0), atlas uv (u0, v0 top, u1, v1 bottom) —
// the cards' (Billboards) instance layout: from the uniform array by gl_InstanceID (INST_VEC4 vec4s each, see
// InflatedActors.set) or, on a device with too few vertex uniform vectors, from instance attributes of those names.
const INSTANCE_UNIFORMS_GLSL = /* glsl */ `
uniform vec4 uInst[${INST_UNIFORM_VECTORS}];
#define aFoot (uInst[gl_InstanceID * ${INST_VEC4}].xyz)
#define aSize (uInst[gl_InstanceID * ${INST_VEC4} + 1])
#define aUv (uInst[gl_InstanceID * ${INST_VEC4} + 2])
`;
const INSTANCE_ATTRIBUTES_GLSL = /* glsl */ `
attribute vec3 aFoot;
attribute vec4 aSize;
attribute vec4 aUv;
`;

const vertPrelude = (uniforms: boolean, v: InflatedVariant) => /* glsl */ `
${uniforms ? INSTANCE_UNIFORMS_GLSL : INSTANCE_ATTRIBUTES_GLSL}
varying vec2 vAtlasUv;
varying vec4 vRect;     // the sprite's rectangle in atlas texels: x0, y0 (bottom), x1, y1 (top)
${fieldGlsl(v)}
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

// ... its vertex normal: the facing (the fragment shader builds the per-pixel normal; this one only offsets
// the shadow lookup, three's normal bias) ...
const VERT_NORMAL = 'vec3 objectNormal = vFacing;';

// ... and its position: pushed towards the eye by the field (sprite px → world units; the texel size guarded: a sprite
// scaled to nothing stays finite). The overworld's relief fades in above the legs (RELIEF_FADE): they keep the card's
// depth, so 3D grass blades in front still hide them; a variant without a fade (the battlers) has it down to the feet.
const vertPosition = (v: InflatedVariant) => /* glsl */ `
float pxWorld = aSize.x / max((aUv.z - aUv.x) * uAtlasSize.x, 1.0);
${v.reliefFade ? `float relief = smoothstep(${glslFloat(v.reliefFade.from)}, ${glslFloat(v.reliefFade.to)}, local.y);` : 'float relief = 1.0;'}
vec3 transformed = card + normalize(uEye - card) * (fieldH(auv, vRect) * pxWorld * relief);
`;

// The sprite's colour at an atlas uv (after tAtlas, uAtlasSize): the nearest texel (Pixel), or with uSmooth its
// HD edges — xBR at the continuous texel position, blended over about one screen pixel (delta), straight
// alpha (the atlas's transparent texels are black: a blend with them comes out premultiplied). Shared by the
// actors and their depth twin, so the cast shadow has the smoothed silhouette too. The nearest fetch and the
// derivative stay outside the branch (uniform control flow; the Pixel path is Task 5's code).
// A variant with baked xBR decisions (xbrBaked: the battlers') reads them from tXbr (XbrBake): the same result.
const sampleGlsl = (v: InflatedVariant) => v.xbrBaked ? /* glsl */ `
uniform float uSmooth;  // 1: HD edges (xBR), 0: nearest texels
uniform sampler2D tXbr; // the atlas's xBR decisions (XbrBake)
${XBR_GLSL}
${XBR_BAKED_GLSL}
vec4 actorSample(vec2 uv, vec4 rect) {
  vec4 t = texture(tAtlas, uv);
  vec2 p = uv * uAtlasSize;
  float delta = clamp(0.5 * fwidth(p.x + p.y), 0.02, 0.5);
  if (uSmooth > 0.5) {
    t = xbrSampleBaked(tAtlas, tXbr, p, rect, delta);
    t.rgb /= max(t.a, 1e-4);
  }
  return t;
}
` : /* glsl */ `
uniform float uSmooth;  // 1: HD edges (xBR), 0: nearest texels
${XBR_GLSL}
vec4 actorSample(vec2 uv, vec4 rect) {
  vec4 t = texture(tAtlas, uv);
  vec2 p = uv * uAtlasSize;
  float delta = clamp(0.5 * fwidth(p.x + p.y), 0.02, 0.5);
  if (uSmooth > 0.5) {
    t = xbrSample(tAtlas, p, rect, delta);
    t.rgb /= max(t.a, 1e-4);
  }
  return t;
}
`;

const fragPrelude = (v: InflatedVariant) => /* glsl */ `
uniform sampler2D tAtlas;
uniform vec3 uRimColor;
uniform float uRim;
uniform vec3 uFloor;
uniform float uMask;    // 1: flat magenta (the harness's actor mask)
varying vec2 vAtlasUv;
varying vec4 vRect;
${fieldGlsl(v)}
${sampleGlsl(v)}
`;

const FRAG_COLOR = /* glsl */ `
vec4 actorTexel = actorSample(vAtlasUv, vRect);
if (actorTexel.a < 0.5) discard;
diffuseColor.rgb *= actorTexel.rgb;
`;

// per-pixel normal (smooth across the grid's facets), in view space
const FRAG_NORMAL = /* glsl */ `
vec2 actorSlope = shadeSlope(vAtlasUv, vRect);
float actorSec = sqrt(1.0 + dot(actorSlope, actorSlope)); // 1 / cos(tilt)
normal = normalize((viewMatrix * vec4(actorNormal(normalize(vFacing), actorSlope), 0.0)).xyz);
`;

// The rim: sky light reflected by the surface (× its colour), so dark outline pixels stay dark.
const FRAG_RIM = /* glsl */ `
totalEmissiveRadiance += diffuseColor.rgb * uRimColor * uRim * pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 3.0);
`;

// Point lights (the cave lantern, carried at the player's chest) reach an actor with a soft ceiling
// (irradiance E -> E / (1 + E / LAMP_CEILING)): a face next to the lamp is lit warm, not blown out.
const POINT_ATTENUATION = 'light.color *= getDistanceAttenuation( lightDistance, pointLight.distance, pointLight.decay );';
const LAMP_GLSL = `\nlight.color /= 1.0 + max(light.color.r, max(light.color.g, light.color.b)) / ${glslFloat(LAMP_CEILING)};`;

// The light floor (also the object models': objectModels.ts), after the lights: the diffuse light's luminance never
// drops below that of uFloor (LIGHT_FLOOR × the cards' light), so actors stay readable in the dark (a cave beyond the
// lantern, deep shade) and never turn black. The lift keeps the lit colour's hue, blending to the floor's own colour
// where almost no light arrives (its hue is noise). Uniform-driven: no program per scene.
export const LIGHT_FLOOR_GLSL = /* glsl */ `
{
  const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
  vec3 lit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
  vec3 floorLight = material.diffuseContribution * uFloor;
  float l = dot(lit, LUMA), lf = dot(floorLight, LUMA);
  if (l < lf) {
    float k = lf / max(l, 1e-5);
    reflectedLight.indirectDiffuse += mix(lit * k, floorLight, smoothstep(1.5, 4.0, k)) - lit;
  }
}
`;

// Mean-preserving relief shading, before the floor: Lambert on the unnormalised normal facing + slope, i.e. the
// tilted unit normal's direct light × 1 / cos(tilt), and the sky's tilted share likewise. The slope ∝ h·∇h =
// ∇(h²/2) sums to ~0 over a sprite's texels (antisymmetry: h = 0 outside the sprite, so the differences of h²
// telescope), so the sprite's mean light stays the flat card's: the centre brightens as much as the edges darken.
const FRAG_FLOOR = /* glsl */ `
reflectedLight.directDiffuse *= actorSec;
#if NUM_HEMI_LIGHTS > 0
  reflectedLight.indirectDiffuse += BRDF_Lambert(material.diffuseContribution) * (actorSec - 1.0)
    * 0.5 * (hemisphereLights[0].skyColor - hemisphereLights[0].groundColor) * dot(normal, hemisphereLights[0].direction);
#endif
reflectedLight.indirectDiffuse = max(reflectedLight.indirectDiffuse, vec3(0.0));
${LIGHT_FLOOR_GLSL}`;

// A soft shoulder on the actor's outgoing light (hue kept): above SHOULDER.knee it eases towards
// SHOULDER.max, below the bloom threshold (post.ts: 1.05) — a sun-facing white crown would glow. (Also the object
// models': objectModels.ts.)
export const FRAG_SHOULDER = /* glsl */ `
{
  float m = max(outgoingLight.r, max(outgoingLight.g, outgoingLight.b));
  const float K = ${glslFloat(SHOULDER.knee)}, R = ${glslFloat(SHOULDER.max - SHOULDER.knee)};
  if (m > K) outgoingLight *= (K + R * (1.0 - exp(-(m - K) / R))) / m;
}
`;

/** The harness's actor mask: every drawn actor pixel flat magenta (after the alpha test and depth test). */
export const MASK_GLSL = 'if (uMask > 0.5) gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0);';

const depthVert = (uniforms: boolean, v: InflatedVariant) => /* glsl */ `
#include <common>
${vertPrelude(uniforms, v)}
varying vec2 vUv;
void main() {
${VERT_CARD}
${vertPosition(v)}
  vUv = vAtlasUv;
  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  mvPosition.z -= ${glslFloat(SHADOW_PUSH)}; // away from the light, along its rays
  gl_Position = projectionMatrix * mvPosition;
}
`;

// The twin's alpha test: the actors' own sample (smoothed silhouette with uSmooth); otherwise billboards.ts's DEPTH_FRAG.
const depthFrag = (v: InflatedVariant) => /* glsl */ `
#include <common>
#include <packing>
uniform sampler2D tAtlas;
uniform vec2 uAtlasSize;
varying vec2 vUv;
varying vec4 vRect;
${sampleGlsl(v)}
void main() {
  if (actorSample(vUv, vRect).a < 0.5) discard;
  gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
}
`;

/** three's lights_pars_begin with the point lights' soft ceiling (LAMP_CEILING; also the object models'); throws if the
 *  attenuation line changed. */
export function lampCeiling(parsBegin: string): string {
  if (!parsBegin.includes(POINT_ATTENUATION)) throw new Error('inflatedActors: point-light attenuation not found in lights_pars_begin');
  return parsBegin.replace(POINT_ATTENUATION, POINT_ATTENUATION + LAMP_GLSL);
}

/** The actors' uniforms (shared by the main material and the depth twin; tXbr: a baked variant's only). */
interface ActorUniforms {
  tAtlas: { value: THREE.Texture }; tField: { value: THREE.Texture }; uRight: { value: THREE.Vector3 };
  uEye: { value: THREE.Vector3 }; uAtlasSize: { value: THREE.Vector2 }; uRimColor: { value: THREE.Color };
  uRim: { value: number }; uFloor: { value: THREE.Color }; uMask: { value: number }; uSmooth: { value: number };
  uInst: { value: Float32Array }; tXbr?: { value: THREE.Texture };
}

/** A 1×1 texture of no xBR decisions (a baked variant without its bake: every texel as it is). */
const noDecisions = () => {
  const t = new THREE.DataTexture(new Uint8Array(4), 1, 1);
  t.needsUpdate = true;
  return t;
};

export class InflatedActors {
  readonly mesh: THREE.Mesh;
  private geometry = new THREE.InstancedBufferGeometry();
  private quad: THREE.BufferGeometry;
  /** Whether the shaders read the instance data from the uInst uniform array (else from the instance attributes). */
  readonly instanceUniforms: boolean;
  /** Instance attributes: foot point, size (width, height, lift, 0) — the contact shadows' (BlobShadows), and the
   *  actors' own with uv on the attribute path. */
  private foot = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTORS * 3), 3);
  private size = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTORS * 4), 4);
  /** The atlas uv (u0, v0, u1, v1): the attribute path only. */
  private uv: THREE.InstancedBufferAttribute | null = null;
  private shadowGeometries: THREE.InstancedBufferGeometry[] = [];
  /** The most instances ever set (the uploaded part of the instance buffers). */
  private used = 0;
  private uniforms: ActorUniforms;
  /** The no-decisions texture a baked variant made for itself (no bake given), freed with the actors. */
  private ownDecisions: THREE.Texture | null = null;

  /**
   * `atlas`: the sprite atlas the actors sample; `field`: its inflation field (same layout, R = height in
   * sprite px); `rimColor`: the rim's colour (kept by reference: the sky's, updated by the owner);
   * `instanceUniforms`: read the instance data from the uniform array (default) or from instance attributes. The default
   * suits tests and devices known to fit: a renderer's caller (the overworld; Phase 3's battlers alike) passes
   * instanceUniformsFit(renderer.capabilities.maxVertexUniforms, …): false on a device with too few vertex uniform
   * vectors. `variant`: the scene's programs, field parameters and relief (the overworld's by default; BATTLE_VARIANT);
   * `xbrBake`: a variant with baked xBR decisions reads them here (XbrBake.texture; none: no decisions, so every texel
   * stands as it is — tests).
   */
  constructor(atlas: THREE.Texture, field: THREE.Texture, rimColor: { value: THREE.Color },
    atlasSize = new THREE.Vector2(SLOT * SLOT_COLS, SLOT * SLOT_ROWS), instanceUniforms = true,
    readonly variant: InflatedVariant = OVERWORLD_VARIANT, xbrBake: THREE.Texture | null = null) {
    this.instanceUniforms = instanceUniforms;
    const grid = new THREE.PlaneGeometry(1, 1, ACTOR_GRID.x, ACTOR_GRID.y);
    grid.translate(0, 0.5, 0); // x in [-0.5, 0.5], y in [0, 1]
    this.geometry.index = grid.index;
    this.geometry.setAttribute('position', grid.getAttribute('position'));
    // (unused by the shader, which builds its own normal: its presence enables the shadow normal bias)
    this.geometry.setAttribute('normal', grid.getAttribute('normal'));
    this.geometry.instanceCount = 0;
    if (!instanceUniforms) {
      this.uv = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ACTORS * 4), 4);
      this.geometry.setAttribute('aFoot', this.foot);
      this.geometry.setAttribute('aSize', this.size);
      this.geometry.setAttribute('aUv', this.uv);
    }
    for (const a of [this.foot, this.size, this.uv]) a?.setUsage(THREE.DynamicDrawUsage);
    this.quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);

    const u: ActorUniforms = this.uniforms = {
      tAtlas: { value: atlas }, tField: { value: field }, uRight: { value: new THREE.Vector3(1, 0, 0) },
      uEye: { value: new THREE.Vector3(0, 0, 1e5) }, uAtlasSize: { value: atlasSize.clone() }, uRimColor: rimColor,
      uRim: { value: RIM }, uFloor: { value: new THREE.Color(0, 0, 0) }, uMask: { value: 0 }, uSmooth: { value: 1 },
      uInst: { value: new Float32Array(MAX_ACTORS * INST_VEC4 * 4) },
    };
    // (the overworld's variant has no such uniform: its programs stay as they were)
    if (variant.xbrBaked) u.tXbr = { value: xbrBake ?? (this.ownDecisions = noDecisions()) };
    const material = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    // the sun may light the sheet from behind: its depth twin draws both faces
    material.shadowSide = THREE.DoubleSide;
    material.onBeforeCompile = (s) => {
      Object.assign(s.uniforms, u);
      let v = vertPrelude(instanceUniforms, variant) + s.vertexShader;
      v = patchChunk(v, 'beginnormal_vertex', VERT_CARD + VERT_NORMAL);
      v = patchChunk(v, 'begin_vertex', vertPosition(variant));
      s.vertexShader = v;
      let f = fragPrelude(variant) + s.fragmentShader;
      f = afterChunk(f, 'map_fragment', FRAG_COLOR);
      f = afterChunk(f, 'normal_fragment_maps', FRAG_NORMAL);
      f = afterChunk(f, 'emissivemap_fragment', FRAG_RIM);
      f = patchChunk(f, 'lights_pars_begin', lampCeiling(THREE.ShaderChunk.lights_pars_begin));
      f = afterChunk(f, 'lights_fragment_end', FRAG_FLOOR);
      f = patchChunk(f, 'opaque_fragment', FRAG_SHOULDER + '#include <opaque_fragment>');
      f = afterChunk(f, 'dithering_fragment', MASK_GLSL);
      s.fragmentShader = f;
    };
    material.customProgramCacheKey = () => programKey(false, instanceUniforms, variant.tag);

    const depth = new THREE.ShaderMaterial({
      vertexShader: depthVert(instanceUniforms, variant),
      fragmentShader: depthFrag(variant),
      uniforms: { tAtlas: u.tAtlas, tField: u.tField, uRight: u.uRight, uEye: u.uEye, uAtlasSize: u.uAtlasSize, uSmooth: u.uSmooth, uInst: u.uInst,
        ...(u.tXbr ? { tXbr: u.tXbr } : {}) },
      side: THREE.DoubleSide,
    });
    depth.customProgramCacheKey = () => programKey(true, instanceUniforms, variant.tag);
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.name = 'inflatedActors';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.customDepthMaterial = depth;
    this.mesh.renderOrder = ACTOR_RENDER_ORDER;
  }

  /** Actors drawn (instances). */
  get count(): number {
    return this.geometry.instanceCount;
  }

  /** The actors' instance data in the uniform array (uInst: per actor INST_VEC4 vec4s: foot, size, uv; see vertPrelude).
   *  Filled on the uniform path only. */
  get instances(): Float32Array {
    return this.uniforms.uInst.value;
  }

  /**
   * This frame's actors, in the cards' placement (`flat` and `tint` are ignored). `cameraRight`: the
   * camera's right vector on XZ (unit); `eye`: the camera's position (world), which the relief rises
   * towards (default: far away horizontally, ahead of `cameraRight`).
   */
  set(list: readonly BillboardSpec[], cameraRight: THREE.Vector3, eye?: THREE.Vector3): void {
    const n = Math.min(MAX_ACTORS, list.length);
    const inst = this.instanceUniforms ? this.uniforms.uInst.value : null;
    const foot = this.foot.array as Float32Array, size = this.size.array as Float32Array;
    const uv = this.uv ? this.uv.array as Float32Array : null;
    let dFoot = 0, dSize = 0, dUv = 0;
    for (let i = 0; i < n; i++) {
      const s = list[i], k = i * INST_VEC4 * 4;
      if (inst) {
        inst[k] = s.footX; inst[k + 1] = s.footY; inst[k + 2] = s.footZ; inst[k + 3] = 0;
        inst[k + 4] = s.width; inst[k + 5] = s.height; inst[k + 6] = s.lift; inst[k + 7] = 0;
        inst[k + 8] = s.slot.u0; inst[k + 9] = s.slot.v0; inst[k + 10] = s.slot.u1; inst[k + 11] = s.slot.v1;
      }
      dFoot |= put(foot, i * 3, s.footX) | put(foot, i * 3 + 1, s.footY) | put(foot, i * 3 + 2, s.footZ);
      dSize |= put(size, i * 4, s.width) | put(size, i * 4 + 1, s.height) | put(size, i * 4 + 2, s.lift) | put(size, i * 4 + 3, 0);
      if (uv) dUv |= put(uv, i * 4, s.slot.u0) | put(uv, i * 4 + 1, s.slot.v0) | put(uv, i * 4 + 2, s.slot.u1) | put(uv, i * 4 + 3, s.slot.v1);
    }
    // The instance attributes upload only when they changed (instanceUpload.ts), up to the most instances ever set: the
    // GPU copy mirrors the arrays there, whatever the instance count did in between.
    this.used = Math.max(this.used, n);
    if (dFoot) markRange(this.foot, this.used);
    if (dSize) markRange(this.size, this.used);
    if (dUv && this.uv) markRange(this.uv, this.used);
    this.geometry.instanceCount = n;
    for (const g of this.shadowGeometries) g.instanceCount = n;
    this.uniforms.uRight.value.copy(cameraRight);
    if (eye) this.uniforms.uEye.value.copy(eye);
    else this.uniforms.uEye.value.set(-cameraRight.z, 0, cameraRight.x).multiplyScalar(1e5);
  }

  /** Draws the actors flat magenta (the harness's visible-actor mask) or normally. */
  setMask(on: boolean): void {
    this.uniforms.uMask.value = on ? 1 : 0;
  }

  /** The light flat sprite cards would get here (charLight): the actors' diffuse light stays ≥ LIGHT_FLOOR × it. */
  setLightFloor(cardLight: THREE.Color): void {
    this.uniforms.uFloor.value.copy(cardLight).multiplyScalar(LIGHT_FLOOR);
  }

  /** HD sprite edges (xBR at the continuous texel position, the default) or the nearest texels (Pixel);
   *  the cast shadow's silhouette follows. */
  setSmoothing(on: boolean): void {
    this.uniforms.uSmooth.value = on ? 1 : 0;
  }

  /** A 4-vertex quad geometry with the actors' aFoot / aSize instance attributes (BlobShadows; every such geometry
   *  shares them), drawing as many instances as the actors. */
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

  /** Frees the geometries (the shadows' too) and materials; the atlas, the field and the rim colour are the owner's. */
  dispose(): void {
    for (const g of [this.geometry, this.quad, ...this.shadowGeometries]) g.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
    this.ownDecisions?.dispose();
  }
}
