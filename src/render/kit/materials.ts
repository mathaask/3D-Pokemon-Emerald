// Stylised material factory: MeshStandardMaterial with injected wind sway, actor bending,
// occlusion fade (between the camera and the player, and the nearest NPCs), night glow and procedural surface patterns.

import * as THREE from 'three';
import { KIT_NOISE_GLSL } from './noise.glsl';

export const MAX_ACTORS = 8;
/** NPCs the occlusion fade also clears (besides the player): the nearest ones, those you talk to. */
export const MAX_FADE_ACTORS = 3;
/** How near the player (XZ, world units = cells) an NPC must stand for the occlusion fade to clear it. */
export const FADE_ACTOR_RADIUS = 4;

/** Shared, per-frame uniforms (owned by OverworldView; referenced by every kit material). */
export interface KitUniforms {
  uTime: { value: number };
  uNight: { value: number };
  /** Wind direction × strength (world XZ). */
  uWind: { value: THREE.Vector2 };
  /** Player position in pixels of the render target the scene is drawn into. */
  uFocusPx: { value: THREE.Vector2 };
  /** Player distance along the view axis. */
  uFocusDepth: { value: number };
  /** Occlusion-fade radius in pixels (0 disables). */
  uFadeRadius: { value: number };
  /** The occlusion fade's NPC circles (MAX_FADE_ACTORS, filled in order): (px.x, px.y, depth, radius) as the
   *  player's uFocusPx / uFocusDepth / uFadeRadius; radius 0 = unused (the rest are unused too). */
  uFocusExtra: { value: THREE.Vector4[] };
  /** Feet of characters that bend grass (unused slots far away). */
  uActors: { value: THREE.Vector3[] };
  /** Sky colour (linear) for water reflections. */
  uSky: { value: THREE.Color };
}

export function createKitUniforms(): KitUniforms {
  return {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uWind: { value: new THREE.Vector2(0.8, 0.35) },
    uFocusPx: { value: new THREE.Vector2(-1e4, -1e4) },
    uFocusDepth: { value: 0 },
    uFadeRadius: { value: 0 },
    uFocusExtra: { value: Array.from({ length: MAX_FADE_ACTORS }, () => new THREE.Vector4(-1e4, -1e4, 0, 0)) },
    uActors: { value: Array.from({ length: MAX_ACTORS }, () => new THREE.Vector3(1e4, 0, 1e4)) },
    uSky: { value: new THREE.Color(0.75, 0.88, 1.0) },
  };
}

/** Height of a character sprite (32 px) in world units: the fade's radius follows its projected size. */
const SPRITE_H = 2;
/** Fade radius per pixel of the character's projected height: 0.11 x the target height at the
 *  Classic camera's default zoom (the radius tuned there), and the same share of the sprite when
 *  the camera zooms in (or the battle zoom pushes it in) or out. */
export const FADE_PER_SPRITE_PX = 0.69;
/** Share of the fade radius that is fully faded (the rest is the soft edge). Centred on the sprite's
 *  middle, the core (0.85 x 0.69 = 0.59 of its projected height) holds all of it, feet to head top:
 *  whatever stands in front, the character is never hidden. */
export const FADE_CORE = 0.85;
/** Warm light of lit windows at night (GLSL, linear RGB): house windows (KIT_GLOW), special facades'
 *  panes and the legacy walls' glass. */
export const WARM_GLOW_GLSL = 'vec3(1.0, 0.72, 0.38)';
const _chest = new THREE.Vector3(), _feet = new THREE.Vector3(), _head = new THREE.Vector3(), _circle = new THREE.Vector4();

type Foot = { x: number; y: number; z: number };

/**
 * The occlusion-fade circle of a character standing at `feet` (world space), seen by `camera` in a
 * `w`×`h`-pixel render target, into `out`: (centre px x, centre px y, depth, radius px). The camera's
 * matrices must be current.
 */
function fadeCircle(feet: Foot, camera: THREE.Camera, w: number, h: number, out: THREE.Vector4): THREE.Vector4 {
  // the character as projected: feet and the top of its sprite (NDC)
  const f = _feet.set(feet.x, feet.y, feet.z).project(camera), t = _head.set(feet.x, feet.y + SPRITE_H, feet.z).project(camera);
  // the circle centres on the sprite's middle on screen; what is nearer the camera than its chest fades
  out.x = ((f.x + t.x) * 0.25 + 0.5) * w;
  out.y = ((f.y + t.y) * 0.25 + 0.5) * h;
  out.z = -_chest.set(feet.x, feet.y + 0.7, feet.z).applyMatrix4(camera.matrixWorldInverse).z;
  // its projected height, in target pixels
  const spritePx = Math.hypot((t.x - f.x) * 0.5 * w, (t.y - f.y) * 0.5 * h);
  out.w = Math.min(FADE_PER_SPRITE_PX * spritePx, 0.5 * h);
  return out;
}

/**
 * Aims the occlusion fade at a character standing at `feet` (world space), seen by `camera`
 * in a `w`×`h`-pixel render target; `null` disables the fade. The camera's matrices must be current.
 */
export function setKitFocus(u: KitUniforms, feet: THREE.Vector3 | null, camera: THREE.Camera, w: number, h: number): void {
  if (!feet) {
    u.uFadeRadius.value = 0;
    return;
  }
  const c = fadeCircle(feet, camera, w, h, _circle);
  u.uFocusPx.value.set(c.x, c.y);
  u.uFocusDepth.value = c.z;
  u.uFadeRadius.value = c.w;
}

/**
 * Nearest `max` feet within `radius` (XZ, world units) of the player, excluding the player itself (a foot
 * closer than 0.01): the NPCs the occlusion fade also clears, nearest first (the feet's own objects).
 */
export function pickFadeActors(feet: readonly Foot[], player: THREE.Vector3, max = MAX_FADE_ACTORS,
  radius = FADE_ACTOR_RADIUS): Foot[] {
  const d2 = (p: Foot) => (p.x - player.x) ** 2 + (p.z - player.z) ** 2;
  return feet.filter((p) => { const d = d2(p); return d >= 0.01 ** 2 && d <= radius * radius; })
    .sort((p, q) => d2(p) - d2(q))
    .slice(0, max);
}

/**
 * Aims the occlusion fade's NPC circles at `feet` (the first MAX_FADE_ACTORS; world space), with the same
 * projection as setKitFocus: one (px.x, px.y, depth, radius) per NPC; unused slots radius 0 (empty: off).
 */
export function setKitFocusExtra(u: KitUniforms, feet: readonly Foot[], camera: THREE.Camera, w: number, h: number): void {
  const slots = u.uFocusExtra.value;
  for (let k = 0; k < slots.length; k++) {
    if (k < feet.length) fadeCircle(feet[k], camera, w, h, slots[k]);
    else slots[k].w = 0;
  }
}

/**
 * Feet (world space) of the characters that bend the grass: the MAX_ACTORS nearest `target` (the
 * camera's focus) fill the slots, unused slots go far away.
 */
export function setKitActors(u: KitUniforms, feet: readonly Foot[], target: THREE.Vector3): void {
  const d2 = (p: Foot) => (p.x - target.x) ** 2 + (p.y - target.y) ** 2 + (p.z - target.z) ** 2;
  const near = [...feet].sort((p, q) => d2(p) - d2(q));
  const slots = u.uActors.value;
  for (let k = 0; k < slots.length; k++) {
    if (k < near.length) slots[k].set(near[k].x, near[k].y, near[k].z);
    else slots[k].set(1e4, 0, 1e4);
  }
}

export type KitPattern = 'none' | 'roofTiles' | 'planks' | 'stone';

export interface KitMaterialOptions {
  color?: THREE.ColorRepresentation;
  vertexColors?: boolean;
  roughness?: number;
  metalness?: number;
  side?: THREE.Side;
  map?: THREE.Texture | null;
  transparent?: boolean;
  /** Writes depth (default true; false for a transparent surface drawn over what lies under it). */
  depthWrite?: boolean;
  flatShading?: boolean;
  /** Sway amplitude in world units at full flex (0 = rigid). */
  wind?: number;
  /** Height above the instance origin at which flex reaches 1. */
  windHeight?: number;
  /** Part around actors, leaning in front of their legs as the camera sees them (grass, flowers); needs `wind`. */
  bend?: boolean;
  /** Dither out when between the camera and the player. */
  fade?: boolean;
  /** Warm emissive glow at night (window glass, lamps); value = strength. */
  glow?: number;
  pattern?: KitPattern;
  /** Extra uniforms used by the GLSL hooks below. Their values are read when the material is handed
   *  out: later changes to these objects do not reach it (the material keeps its own, see the pool). */
  uniforms?: Record<string, { value: unknown }>;
  /** GLSL declarations appended to the fragment prelude (after the noise helpers). */
  fragHead?: string;
  /** GLSL after <color_fragment>: may change diffuseColor (vKitWorld = world position). */
  fragColor?: string;
  /** GLSL after <normal_fragment_maps>: may change `normal` (view space). */
  fragNormal?: string;
  /** GLSL after <emissivemap_fragment>: may add to totalEmissiveRadiance. */
  fragEmissive?: string;
  /** GLSL after <begin_vertex>: may change `transformed` (object space). */
  vertTransform?: string;
  /** Optional label in the program cache key (the hook source is hashed into it anyway). */
  hookKey?: string;
}

export interface KitMaterial {
  material: THREE.MeshStandardMaterial;
  /** Matching shadow-depth material for deforming (wind / vertTransform) materials, else null. */
  depth: THREE.MeshDepthMaterial | null;
}

const VERT_PRELUDE = /* glsl */ `
uniform float uTime;
uniform vec2 uWind;
uniform float uWindAmp;
uniform float uWindHeight;
uniform vec3 uActors[${MAX_ACTORS}];
varying vec3 vKitWorld;
`;

const PROJECT_VERTEX = /* glsl */ `
vec4 mvPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  mvPosition = instanceMatrix * mvPosition;
#endif
#ifdef KIT_WIND
{
  vec3 kOrigin = vec3(0.0);
  #ifdef USE_INSTANCING
    kOrigin = instanceMatrix[3].xyz;
  #endif
  float flex = clamp((mvPosition.y - kOrigin.y) / uWindHeight, 0.0, 1.0);
  flex *= flex;
  vec3 wo = (modelMatrix * vec4(kOrigin, 1.0)).xyz;
  float ph = uTime * 1.6 + wo.x * 0.37 + wo.z * 0.29;
  float gust = sin(ph) * 0.6 + sin(ph * 2.3 + 1.7) * 0.25 + 0.4;
  mvPosition.xz += uWind * gust * flex * uWindAmp;
  #ifdef KIT_BEND
  {
    // Blades part around a character's feet: beside and behind it (as the camera sees it) they
    // lean away; in front of it they lean in against the legs (never past them), so they hide the
    // legs as the GBA's grass overlay sprite did.
    vec3 wp = (modelMatrix * mvPosition).xyz;
    vec2 view = normalize(wp.xz - cameraPosition.xz + vec2(1e-4));
    vec2 across = vec2(-view.y, view.x);
    float pivot = sqrt(flex); // pressed blades turn about their roots
    for (int k = 0; k < ${MAX_ACTORS}; k++) {
      vec3 d = wp - uActors[k];
      vec2 away = normalize(d.xz + vec2(1e-4));
      float front = max(0.0, -dot(away, view));
      float depth = max(0.0, -dot(d.xz, view)); // how far in front of the character
      float near = (1.0 - step(1.6, abs(d.y))) * pivot;
      float part = (1.0 - smoothstep(0.15, 0.75, length(d.xz))) * (1.0 - front) * near;
      float lean = (1.0 - smoothstep(0.25, 0.6, abs(dot(d.xz, across)))) * (1.0 - smoothstep(0.6, 1.4, depth)) * front * near;
      mvPosition.xz += away * (0.3 * part) + view * (min(depth * 0.9, 0.45) * lean);
      mvPosition.y -= part * 0.1;
    }
  }
  #endif
}
#endif
vec4 kitWorldPos = modelMatrix * mvPosition;
vKitWorld = kitWorldPos.xyz;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
`;

// Replaces <worldpos_vertex> (same guard) so shadow coordinates and env lookups use the swayed position.
const WORLDPOS_VERTEX = /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
vec4 worldPosition = kitWorldPos;
#endif
`;

const FRAG_PRELUDE = /* glsl */ `
uniform float uTime;
uniform float uNight;
uniform vec3 uSky;
uniform vec2 uFocusPx;
uniform float uFocusDepth;
uniform float uFadeRadius;
uniform vec4 uFocusExtra[${MAX_FADE_ACTORS}];
uniform float uGlow;
varying vec3 vKitWorld;
${KIT_NOISE_GLSL}
`;

// The player's circle, then the nearby NPCs' (same core / edge / Bayer rule: a fragment goes where any circle
// dithers it out). The NPC slots fill in order, so an empty first slot skips them all (Retro, nobody near).
const FADE = /* glsl */ `
#ifdef KIT_FADE
{
  float kf = 0.0;
  if (uFadeRadius > 0.0 && vViewPosition.z < uFocusDepth - 0.6) {
    kf = 1.0 - smoothstep(uFadeRadius * ${FADE_CORE.toFixed(2)}, uFadeRadius, length(gl_FragCoord.xy - uFocusPx));
  }
  if (uFocusExtra[0].w > 0.0) {
    for (int k = 0; k < ${MAX_FADE_ACTORS}; k++) {
      vec4 e = uFocusExtra[k];
      if (e.w > 0.0 && vViewPosition.z < e.z - 0.6) {
        kf = max(kf, 1.0 - smoothstep(e.w * ${FADE_CORE.toFixed(2)}, e.w, length(gl_FragCoord.xy - e.xy)));
      }
    }
  }
  if (kf > 0.0 && kitBayer4(gl_FragCoord.xy) < kf * 0.9) discard;
}
#endif
`;

const PATTERNS = /* glsl */ `
#if defined(KIT_PATTERN_ROOF)
{
  float row = vKitWorld.y * 5.0;
  float fr = fract(row);
  float seam = fract(vKitWorld.x * 3.0 + 0.5 * floor(row));
  float k = mix(0.72, 1.0, smoothstep(0.0, 0.14, fr));
  k *= mix(0.86, 1.0, smoothstep(0.0, 0.06, seam) * smoothstep(1.0, 0.94, seam));
  k *= 0.94 + 0.12 * kitHash12(vec2(floor(vKitWorld.x * 3.0 + 0.5 * floor(row)), floor(row)));
  diffuseColor.rgb *= k;
}
#elif defined(KIT_PATTERN_PLANKS)
{
  float fr = fract(vKitWorld.y * 4.0);
  diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.0, 0.1, fr)) * (0.9 + 0.1 * kitNoise2(vKitWorld.xz * vec2(8.0, 0.8)));
}
#elif defined(KIT_PATTERN_STONE)
{
  vec2 v = kitVoronoi(vKitWorld.xy * 3.0 + vKitWorld.zz * 0.7);
  diffuseColor.rgb *= mix(0.7, 1.0, smoothstep(0.02, 0.08, v.x)) * (0.92 + 0.12 * v.y);
}
#endif
`;

const GLOW = /* glsl */ `
#ifdef KIT_GLOW
totalEmissiveRadiance += ${WARM_GLOW_GLSL} * uNight * uGlow;
#endif
`;

type Local = Record<'uWindAmp' | 'uWindHeight' | 'uGlow', { value: number }>;

/** FNV-1a 32-bit hash, base 36 (compact program-cache-key component). */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

type Slots = Record<string, { value: unknown }>;
type Hooks = Pick<KitMaterialOptions, 'fragHead' | 'fragColor' | 'fragNormal' | 'fragEmissive' | 'vertTransform'>;

function patchKit(s: THREE.WebGLProgramParametersWithUniforms, u: KitUniforms, local: Local, slots: Slots,
  o: Hooks, full: boolean): void {
  Object.assign(s.uniforms, {
    uTime: u.uTime, uWind: u.uWind, uActors: u.uActors, uNight: u.uNight, uSky: u.uSky,
    uFocusPx: u.uFocusPx, uFocusDepth: u.uFocusDepth, uFadeRadius: u.uFadeRadius, uFocusExtra: u.uFocusExtra, ...local, ...slots,
  });
  s.vertexShader = VERT_PRELUDE + s.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (o.vertTransform ?? ''))
    .replace('#include <project_vertex>', PROJECT_VERTEX)
    .replace('#include <worldpos_vertex>', WORLDPOS_VERTEX);
  if (!full) return;
  s.fragmentShader = FRAG_PRELUDE + (o.fragHead ?? '') + '\n' + s.fragmentShader
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + FADE)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + PATTERNS + (o.fragColor ?? ''))
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + (o.fragNormal ?? ''))
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + GLOW + (o.fragEmissive ?? ''));
}

/**
 * A kit material and what a build sets on it. Kit materials are pooled for the session (per
 * KitUniforms, i.e. per view): three destroys a shader program as soon as the last material using it
 * is disposed, so a world rebuild that disposed its materials made the next build's identical ones
 * compile every kit program again on its first frame (+80-100 ms per map crossing). disposeKit
 * returns them here instead (releaseKitMaterial) and the next build takes them back, programs and
 * all. The pool holds at most as many materials of one kind as a build has used at once, and no GPU
 * resources but the programs (each build's textures are freed with it).
 */
interface Pooled {
  km: KitMaterial;
  local: Local;
  /** The material's own objects for the caller's `uniforms` (its programs were compiled with them). */
  slots: Slots;
  /** Creation order (as three's material ids). */
  seq: number;
  /** The free list of its kind (same program-affecting options), latest made first: handed out
   *  oldest first, so a rebuild of a map gets its materials in the order its first build made them
   *  (three draws opaque objects sorted by material id: the same order, no flicker where surfaces
   *  meet in one plane as Route 113's ash rebuilds the world each step). */
  free: Pooled[];
  inUse: boolean;
}

const POOLS = new WeakMap<KitUniforms, Map<string, Pooled[]>>();
const POOLED = new WeakMap<THREE.Material, Pooled>();
let made = 0;

/** The options that make a material compile differently (the rest is set per build). */
function poolKey(programKey: string, o: KitMaterialOptions): string {
  return [programKey, o.vertexColors ? 1 : 0, o.side ?? THREE.FrontSide, o.transparent ? 1 : 0, o.flatShading ? 1 : 0,
    o.map ? 1 : 0, Object.keys(o.uniforms ?? {}).sort().join(',')].join('|');
}

/** Sets what a build chooses freely on a (new or reused) material: colours, values, textures. */
function configure(p: Pooled, o: KitMaterialOptions): void {
  const m = p.km.material;
  m.color.set(o.color ?? 0xffffff);
  m.roughness = o.roughness ?? 0.9;
  m.metalness = o.metalness ?? 0;
  m.map = o.map ?? null;
  m.depthWrite = o.depthWrite ?? true;
  p.local.uWindAmp.value = o.wind ?? 0;
  p.local.uWindHeight.value = o.windHeight ?? 1;
  p.local.uGlow.value = o.glow ?? 0;
  for (const k in p.slots) p.slots[k].value = o.uniforms![k].value;
}

export function kitMaterial(u: KitUniforms, o: KitMaterialOptions = {}): KitMaterial {
  const defines: Record<string, string> = {};
  if (o.wind) defines.KIT_WIND = '';
  if (o.wind && o.bend) defines.KIT_BEND = '';
  if (o.fade) defines.KIT_FADE = '';
  if (o.glow) defines.KIT_GLOW = '';
  if (o.pattern === 'roofTiles') defines.KIT_PATTERN_ROOF = '';
  else if (o.pattern === 'planks') defines.KIT_PATTERN_PLANKS = '';
  else if (o.pattern === 'stone') defines.KIT_PATTERN_STONE = '';
  // three's program cache key omits onBeforeCompile output, so the hook source must be part of it.
  const hooks = [o.fragHead, o.fragColor, o.fragNormal, o.fragEmissive, o.vertTransform].map((h) => h ?? '').join('|');
  const key = 'kit:' + Object.keys(defines).sort().join(',') + ':' + (o.hookKey ?? '') + ':' + hashString(hooks);

  let pools = POOLS.get(u);
  if (!pools) POOLS.set(u, (pools = new Map()));
  const kind = poolKey(key, o);
  let free = pools.get(kind);
  if (!free) pools.set(kind, (free = []));
  const reused = free.pop();
  if (reused) {
    reused.inUse = true;
    configure(reused, o);
    return reused.km;
  }

  const material = new THREE.MeshStandardMaterial({
    vertexColors: o.vertexColors ?? false,
    side: o.side ?? THREE.FrontSide,
    transparent: o.transparent ?? false,
    flatShading: o.flatShading ?? false,
  });
  material.defines = defines;
  const local: Local = { uWindAmp: { value: 0 }, uWindHeight: { value: 1 }, uGlow: { value: 0 } };
  const slots: Slots = {};
  for (const k of Object.keys(o.uniforms ?? {})) slots[k] = { value: null };
  // (the hooks only: the options' textures are this build's, the material outlives it)
  const h: Hooks = { fragHead: o.fragHead, fragColor: o.fragColor, fragNormal: o.fragNormal, fragEmissive: o.fragEmissive, vertTransform: o.vertTransform };
  material.onBeforeCompile = (s) => patchKit(s, u, local, slots, h, true);
  material.customProgramCacheKey = () => key;
  let depth: THREE.MeshDepthMaterial | null = null;
  if (o.wind || o.vertTransform) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    // Wind only: KIT_BEND parts the blades as the camera sees them (cameraPosition), which in the
    // shadow pass is the light's camera; the shadow is cast by the unbent blades.
    const depthDefines: Record<string, string> = {};
    if (defines.KIT_WIND !== undefined) depthDefines.KIT_WIND = '';
    depth.defines = depthDefines;
    depth.onBeforeCompile = (s) => patchKit(s, u, local, slots, h, false);
    depth.customProgramCacheKey = () => key + ':depth';
  }
  const p: Pooled = { km: { material, depth }, local, slots, seq: made++, free, inUse: true };
  configure(p, o);
  POOLED.set(material, p);
  if (depth) POOLED.set(depth, p);
  return p.km;
}

/**
 * Done with a material of a world being disposed: a kit material (or its depth twin) goes back to
 * the session pool for the next build, without its build's textures (released twice: once); any
 * other material is disposed.
 */
export function releaseKitMaterial(m: THREE.Material): void {
  const p = POOLED.get(m);
  if (!p) {
    m.dispose();
    return;
  }
  if (!p.inUse) return;
  p.inUse = false;
  p.km.material.map = null;
  for (const k in p.slots) if ((p.slots[k].value as THREE.Texture | null)?.isTexture) p.slots[k].value = null;
  let at = p.free.length;
  while (at > 0 && p.free[at - 1].seq < p.seq) at--;
  p.free.splice(at, 0, p);
}

/** Assigns a kit material (and its shadow-depth twin) to a mesh. */
export function applyKitMaterial(mesh: THREE.Mesh, k: KitMaterial): void {
  mesh.material = k.material;
  if (k.depth) mesh.customDepthMaterial = k.depth;
}
