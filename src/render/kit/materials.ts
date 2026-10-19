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
  /** Player position in drawing-buffer pixels. */
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
  /** Bend away from actors (grass); needs `wind`. */
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
  /** Required with hooks: distinguishes the compiled program. */
  hookKey?: string;
}

export interface KitMaterial {
  material: THREE.MeshStandardMaterial;
  /** Matching shadow-depth material for deforming (wind) materials, else null. */
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
    vec3 wp = (modelMatrix * mvPosition).xyz;
    for (int k = 0; k < ${MAX_ACTORS}; k++) {
      vec3 d = wp - uActors[k];
      float push = (1.0 - smoothstep(0.2, 0.8, length(d.xz))) * (1.0 - step(1.6, abs(d.y)));
      mvPosition.xz += normalize(d.xz + vec2(1e-4)) * push * flex * 0.32;
      mvPosition.y -= push * flex * 0.14;
    }
  }
  #endif
}
#endif
vKitWorld = (modelMatrix * mvPosition).xyz;
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;
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

function patchKit(s: THREE.WebGLProgramParametersWithUniforms, u: KitUniforms, local: Local, o: KitMaterialOptions, full: boolean): void {
  Object.assign(s.uniforms, {
    uTime: u.uTime, uWind: u.uWind, uActors: u.uActors, uNight: u.uNight, uSky: u.uSky,
    uFocusPx: u.uFocusPx, uFocusDepth: u.uFocusDepth, uFadeRadius: u.uFadeRadius, ...local, ...(o.uniforms ?? {}),
  });
  s.vertexShader = VERT_PRELUDE + s.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n' + (o.vertTransform ?? ''))
    .replace('#include <project_vertex>', PROJECT_VERTEX);
  if (!full) return;
  s.fragmentShader = FRAG_PRELUDE + (o.fragHead ?? '') + s.fragmentShader
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
  const key = 'kit:' + Object.keys(defines).sort().join(',') + ':' + (o.hookKey ?? '');
  material.onBeforeCompile = (s) => patchKit(s, u, local, o, true);
  material.customProgramCacheKey = () => key;
  let depth: THREE.MeshDepthMaterial | null = null;
  if (o.wind) {
    depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    depth.defines = o.bend ? { KIT_WIND: '', KIT_BEND: '' } : { KIT_WIND: '' };
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
