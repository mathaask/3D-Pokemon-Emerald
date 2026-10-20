// Stylised material factory: MeshStandardMaterial with injected wind sway, actor bending,
// camera-to-player occlusion fade, night glow and procedural surface patterns.

import * as THREE from 'three';
import { KIT_NOISE_GLSL } from './noise.glsl';

export const MAX_ACTORS = 8;

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
const _chest = new THREE.Vector3(), _feet = new THREE.Vector3(), _head = new THREE.Vector3();

/**
 * Aims the occlusion fade at a character standing at `feet` (world space), seen by `camera`
 * in a `w`×`h`-pixel render target; `null` disables the fade. The camera's matrices must be current.
 */
export function setKitFocus(u: KitUniforms, feet: THREE.Vector3 | null, camera: THREE.Camera, w: number, h: number): void {
  if (!feet) {
    u.uFadeRadius.value = 0;
    return;
  }
  const ndc = _chest.set(feet.x, feet.y + 0.7, feet.z).project(camera);
  u.uFocusPx.value.set((ndc.x * 0.5 + 0.5) * w, (ndc.y * 0.5 + 0.5) * h);
  u.uFocusDepth.value = -_chest.set(feet.x, feet.y + 0.7, feet.z).applyMatrix4(camera.matrixWorldInverse).z;
  // the character's projected height: feet to the top of its sprite, in target pixels
  const f = _feet.copy(feet).project(camera), t = _head.set(feet.x, feet.y + SPRITE_H, feet.z).project(camera);
  const spritePx = Math.hypot((t.x - f.x) * 0.5 * w, (t.y - f.y) * 0.5 * h);
  u.uFadeRadius.value = Math.min(FADE_PER_SPRITE_PX * spritePx, 0.5 * h);
}

/**
 * Feet (world space) of the characters that bend the grass: the MAX_ACTORS nearest `target` (the
 * camera's focus) fill the slots, unused slots go far away.
 */
export function setKitActors(u: KitUniforms, feet: readonly { x: number; y: number; z: number }[], target: THREE.Vector3): void {
  const d2 = (p: { x: number; y: number; z: number }) => (p.x - target.x) ** 2 + (p.y - target.y) ** 2 + (p.z - target.z) ** 2;
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
  /** Extra uniforms used by the GLSL hooks below. */
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
uniform float uGlow;
varying vec3 vKitWorld;
${KIT_NOISE_GLSL}
`;

const FADE = /* glsl */ `
#ifdef KIT_FADE
if (uFadeRadius > 0.0 && vViewPosition.z < uFocusDepth - 0.6) {
  float kf = 1.0 - smoothstep(uFadeRadius * 0.55, uFadeRadius, length(gl_FragCoord.xy - uFocusPx));
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
totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * uNight * uGlow;
#endif
`;

type Local = Record<'uWindAmp' | 'uWindHeight' | 'uGlow', { value: number }>;

/** FNV-1a 32-bit hash, base 36 (compact program-cache-key component). */
function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

function patchKit(s: THREE.WebGLProgramParametersWithUniforms, u: KitUniforms, local: Local, o: KitMaterialOptions, full: boolean): void {
  Object.assign(s.uniforms, {
    uTime: u.uTime, uWind: u.uWind, uActors: u.uActors, uNight: u.uNight, uSky: u.uSky,
    uFocusPx: u.uFocusPx, uFocusDepth: u.uFocusDepth, uFadeRadius: u.uFadeRadius, ...local, ...(o.uniforms ?? {}),
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

export function kitMaterial(u: KitUniforms, o: KitMaterialOptions = {}): KitMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: o.color ?? 0xffffff,
    vertexColors: o.vertexColors ?? false,
    roughness: o.roughness ?? 0.9,
    metalness: o.metalness ?? 0,
    side: o.side ?? THREE.FrontSide,
    map: o.map ?? null,
    transparent: o.transparent ?? false,
    flatShading: o.flatShading ?? false,
  });
  const defines: Record<string, string> = {};
  if (o.wind) defines.KIT_WIND = '';
  if (o.wind && o.bend) defines.KIT_BEND = '';
  if (o.fade) defines.KIT_FADE = '';
  if (o.glow) defines.KIT_GLOW = '';
  if (o.pattern === 'roofTiles') defines.KIT_PATTERN_ROOF = '';
  else if (o.pattern === 'planks') defines.KIT_PATTERN_PLANKS = '';
  else if (o.pattern === 'stone') defines.KIT_PATTERN_STONE = '';
  material.defines = defines;
  const local: Local = {
    uWindAmp: { value: o.wind ?? 0 },
    uWindHeight: { value: o.windHeight ?? 1 },
    uGlow: { value: o.glow ?? 0 },
  };
  // three's program cache key omits onBeforeCompile output, so the hook source must be part of it.
  const hooks = [o.fragHead, o.fragColor, o.fragNormal, o.fragEmissive, o.vertTransform].map((h) => h ?? '').join('|');
  const key = 'kit:' + Object.keys(defines).sort().join(',') + ':' + (o.hookKey ?? '') + ':' + hashString(hooks);
  material.onBeforeCompile = (s) => patchKit(s, u, local, o, true);
  material.customProgramCacheKey = () => key;
  let depth: THREE.MeshDepthMaterial | null = null;
  if (o.wind || o.vertTransform) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    // Wind only: KIT_BEND parts the blades as the camera sees them (cameraPosition), which in the
    // shadow pass is the light's camera; the shadow is cast by the unbent blades.
    const depthDefines: Record<string, string> = {};
    if (defines.KIT_WIND !== undefined) depthDefines.KIT_WIND = '';
    depth.defines = depthDefines;
    depth.onBeforeCompile = (s) => patchKit(s, u, local, o, false);
    depth.customProgramCacheKey = () => key + ':depth';
  }
  return { material, depth };
}

/** Assigns a kit material (and its shadow-depth twin) to a mesh. */
export function applyKitMaterial(mesh: THREE.Mesh, k: KitMaterial): void {
  mesh.material = k.material;
  if (k.depth) mesh.customDepthMaterial = k.depth;
}
