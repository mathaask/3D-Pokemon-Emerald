// Stylised material factory: MeshStandardMaterial with injected wind sway, actor bending,
// occlusion fade (between the camera and the player, and the nearest NPCs), night glow and procedural surface patterns.

import * as THREE from 'three';
import { KIT_NOISE_GLSL } from './noise.glsl';

export const MAX_ACTORS = 8;
/** NPCs the occlusion fade also clears (besides the player): the nearest ones, those you talk to. */
export const MAX_FADE_ACTORS = 3;
/** How near the player (XZ, world units = cells) an NPC must stand for the occlusion fade to clear it. */
export const FADE_ACTOR_RADIUS = 4;
/** Within this distance of the player an NPC's fade has its full strength; it weakens to 0 at FADE_ACTOR_RADIUS
 *  (smoothstep), so an NPC's window never pops in or out as it crosses the reach. */
export const FADE_ACTOR_FULL = 3;
/** An NPC's circle only clears what stands in front of it in the world: beyond its foot by this much along the
 *  camera's horizontal back direction (uCamBack), i.e. past the near edge of the NPC's own cell. Occluders less than
 *  half a cell in front stay by design; crowns of the rows behind it or beside it, nearer the pitched camera along its
 *  view axis only because they rise high, stay whole. */
export const FADE_FRONT_MARGIN = 0.5;
/** An NPC's circle only clears the band of the screen its sprite card spans (its projected half-width, leaning with
 *  the card's projected vertical): the half-width plus this share of the circle's radius, then the circle's soft edge
 *  (1 - FADE_CORE of the radius). Crowns beside an NPC stay whole. */
export const FADE_SIDE_PAD = 0.02;

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
  /** Pixel rectangle (x0, y0, x1, y1) holding every used uFocusExtra circle (none: empty): the fragments outside it
   *  (most of them) skip the NPC circles with one test. */
  uFocusExtraBox: { value: THREE.Vector4 };
  /** Per used uFocusExtra circle, its NPC: (foot · uCamBack, sprite half-width in px, lean = px x per px y of the
   *  card's projected vertical, strength 0..1). Only what lies in front of the foot (see FADE_FRONT_MARGIN) and over the
   *  sprite's band of the screen (see FADE_SIDE_PAD) fades, by the strength (fadeActorRamp). */
  uFocusExtraFoot: { value: THREE.Vector4[] };
  /** The camera's horizontal back direction (world XZ, unit; (sin yaw, cos yaw)): "in front" for the NPC circles. */
  uCamBack: { value: THREE.Vector2 };
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
    uFocusExtraBox: { value: new THREE.Vector4(1, 1, 0, 0) },
    uFocusExtraFoot: { value: Array.from({ length: MAX_FADE_ACTORS }, () => new THREE.Vector4()) },
    uCamBack: { value: new THREE.Vector2(0, 1) },
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
 *  middle, the core (0.85 x 0.69 = 0.59 of its projected height) holds all of it, feet to head top: the kit
 *  geometry that fades (trees, roofs, props) dithers out over the whole sprite where it stands more than 0.6
 *  nearer the camera than the character's chest. */
export const FADE_CORE = 0.85;
/** Warm light of lit windows at night (GLSL, linear RGB): house windows (KIT_GLOW), special facades'
 *  panes and the legacy walls' glass. */
export const WARM_GLOW_GLSL = 'vec3(1.0, 0.72, 0.38)';
const _chest = new THREE.Vector3(), _feet = new THREE.Vector3(), _head = new THREE.Vector3(), _circle = new THREE.Vector4();
const _right = new THREE.Vector3(), _edge = new THREE.Vector3(), _band = new THREE.Vector2();
// (reused by pickFadeActors / setKitActors: distances, the nearest feet)
const _pickD: number[] = [], _nearD: number[] = [], _near: { x: number; y: number; z: number }[] = [];

type Foot = { x: number; y: number; z: number };
/** An NPC's foot for the occlusion fade, with its sprite's half-width in world units (default: a 16-px sprite's, 0.5). */
export type FadeFoot = Foot & { halfWidth?: number };

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

/** Half the px distance between the projections of `at` ± `right` × `half` (both at one screen height: no roll). */
function halfSpan(at: THREE.Vector3, right: THREE.Vector3, half: number, camera: THREE.Camera, w: number): number {
  const a = _edge.copy(at).addScaledVector(right, half).project(camera).x;
  const b = _edge.copy(at).addScaledVector(right, -half).project(camera).x;
  return Math.abs(a - b) * 0.25 * w;
}

/**
 * The screen band of a character's sprite card standing at `feet` (world space; the card faces the camera: it spans
 * the camera's right, `halfWidth` world units each way, and SPRITE_H up): into `out`, (its half-width in px — the
 * larger of its feet's and its head's, nearer the camera — and its lean: px x per px y of its projected vertical).
 */
function spriteBand(feet: Foot, halfWidth: number, camera: THREE.Camera, w: number, h: number, out: THREE.Vector2): THREE.Vector2 {
  const right = _right.setFromMatrixColumn(camera.matrixWorld, 0);
  const f = _feet.set(feet.x, feet.y, feet.z), t = _head.set(feet.x, feet.y + SPRITE_H, feet.z);
  const half = Math.max(halfSpan(f, right, halfWidth, camera, w), halfSpan(t, right, halfWidth, camera, w));
  f.project(camera);
  t.project(camera);
  const dy = (t.y - f.y) * h;
  return out.set(half, Math.abs(dy) > 1e-9 ? ((t.x - f.x) * w) / dy : 0);
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

/** pickFadeActors's options: at most `max` feet (MAX_FADE_ACTORS) within `radius` (FADE_ACTOR_RADIUS); `out`: a list to
 *  fill and return (reused across frames, see pickFadeActors). */
export interface FadePickOptions<T> { max?: number; radius?: number; out?: T[] }

/** No NPC to clear (pickFadeActors with `out`, nothing in reach). */
const NO_PICKS: readonly never[] = Object.freeze([]);

/**
 * Nearest `max` feet within `radius` (XZ, world units) of the player, excluding the player itself (a foot
 * closer than 0.01): the NPCs the occlusion fade also clears, nearest first (the feet's own objects).
 * With `out`, the picks are written into it and it is returned truncated to them; with none in reach the shared empty
 * list is returned and `out` keeps its storage (V8 drops an array's backing store when its length is set to 0): no
 * allocation per frame once `out` grew.
 */
export function pickFadeActors<T extends Foot>(feet: readonly T[], player: THREE.Vector3,
  { max = MAX_FADE_ACTORS, radius = FADE_ACTOR_RADIUS, out }: FadePickOptions<T> = {}): readonly T[] {
  const list = out ?? [];
  let n = 0;
  for (let i = 0; i < feet.length; i++) {
    const p = feet[i];
    const d = (p.x - player.x) ** 2 + (p.z - player.z) ** 2;
    if (d >= 0.01 ** 2 && d <= radius * radius) n = insertNearest(list, _pickD, n, max, p, d);
  }
  if (n === 0) return out ? NO_PICKS : list;
  if (list.length !== n) list.length = n; // (n ≥ 1: truncated in place)
  return list;
}

/** Inserts `p` at squared distance `d` into the first `n` entries of `out`, kept ascending by `ds` (their distances) and at
 *  most `max` long; after the equal distances already there (as a stable sort of the input order). Returns the new
 *  count. Entries past it are stale (never read); the arrays' lengths only grow, so nothing allocates once they grew. */
function insertNearest<T>(out: T[], ds: number[], n: number, max: number, p: T, d: number): number {
  let k = n;
  if (k >= max) {
    if (!(d < ds[max - 1])) return n;
    k = max - 1; // (drops the farthest)
  } else n++;
  for (; k > 0 && d < ds[k - 1]; k--) {
    out[k] = out[k - 1];
    ds[k] = ds[k - 1];
  }
  out[k] = p;
  ds[k] = d;
  return n;
}

/** Strength of an NPC's fade at XZ distance `d` from the player: 1 up to FADE_ACTOR_FULL, 0 from FADE_ACTOR_RADIUS. */
export function fadeActorRamp(d: number): number {
  return 1 - THREE.MathUtils.smoothstep(d, FADE_ACTOR_FULL, FADE_ACTOR_RADIUS);
}

/**
 * Aims the occlusion fade's NPC circles at `feet` (the first MAX_FADE_ACTORS; world space), with the same
 * projection as setKitFocus: one (px.x, px.y, depth, radius) per NPC, filled in order; unused slots radius 0
 * (empty: off). Per NPC, uFocusExtraFoot gets its foot along the camera's back direction (uCamBack, set first), its
 * sprite band (spriteBand: half-width px, lean) and its strength: with `player`, fadeActorRamp of the NPC's XZ distance
 * (one ramped to 0 is left out), else 1. The rectangle holding what the circles can clear (each cut to its sprite's
 * band) goes into uFocusExtraBox (none: an empty one).
 */
export function setKitFocusExtra(u: KitUniforms, feet: readonly FadeFoot[], camera: THREE.Camera, w: number, h: number,
  player?: THREE.Vector3): void {
  const slots = u.uFocusExtra.value, foot = u.uFocusExtraFoot.value, back = u.uCamBack.value;
  const box = u.uFocusExtraBox.value.set(Infinity, Infinity, -Infinity, -Infinity);
  let n = 0;
  for (let i = 0; i < feet.length && n < slots.length; i++) {
    const p = feet[i];
    const ramp = player ? fadeActorRamp(Math.hypot(p.x - player.x, p.z - player.z)) : 1;
    if (ramp <= 0) continue;
    const c = fadeCircle(p, camera, w, h, slots[n]);
    const band = spriteBand(p, p.halfWidth ?? 0.5, camera, w, h, _band);
    foot[n++].set(p.x * back.x + p.z * back.y, band.x, band.y, ramp);
    // the band's reach across the circle (it leans by |lean| px per px of height)
    const side = Math.min(c.w, band.x + (FADE_SIDE_PAD + 1 - FADE_CORE + Math.abs(band.y)) * c.w);
    box.set(Math.min(box.x, c.x - side), Math.min(box.y, c.y - c.w), Math.max(box.z, c.x + side), Math.max(box.w, c.y + c.w));
  }
  for (let k = n; k < slots.length; k++) slots[k].w = 0;
  if (n === 0) box.set(1, 1, 0, 0);
}

/**
 * Feet (world space) of the characters that bend the grass: the MAX_ACTORS nearest `target` (the
 * camera's focus) fill the slots, unused slots go far away.
 */
export function setKitActors(u: KitUniforms, feet: readonly Foot[], target: THREE.Vector3): void {
  const slots = u.uActors.value, near = _near;
  let n = 0;
  for (let i = 0; i < feet.length; i++) {
    const p = feet[i];
    n = insertNearest(near, _nearD, n, slots.length, p, (p.x - target.x) ** 2 + (p.y - target.y) ** 2 + (p.z - target.z) ** 2);
  }
  for (let k = 0; k < slots.length; k++) {
    if (k < n) slots[k].set(near[k].x, near[k].y, near[k].z);
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
uniform vec4 uFocusExtraBox;
uniform vec4 uFocusExtraFoot[${MAX_FADE_ACTORS}];
uniform vec2 uCamBack;
uniform float uGlow;
varying vec3 vKitWorld;
${KIT_NOISE_GLSL}
`;

// The player's circle (Phase 1, unchanged), then the nearby NPCs' (same core / edge / Bayer rule: a fragment goes where
// any circle dithers it out). An NPC circle clears only what covers the NPC: fragments in front of it in the world
// (beyond its foot along the camera's horizontal back direction, uCamBack: FADE_FRONT_MARGIN; high crowns behind it
// pass the view-axis test) and over its sprite card's band of the screen (half-width + FADE_SIDE_PAD, leaning with the
// card's projected vertical, then the same soft edge; crowns beside it stay whole), by its strength (the ramp over the
// last cell of reach). Most fragments lie outside the NPC circles' rectangle (an empty one: Retro, nobody near) and skip
// them with one test; inside it, the slots fill in order (an empty one ends them) and a fragment outside a circle pays
// a squared distance only.
const FADE = /* glsl */ `
#ifdef KIT_FADE
{
  float kf = 0.0;
  if (uFadeRadius > 0.0 && vViewPosition.z < uFocusDepth - 0.6) {
    kf = 1.0 - smoothstep(uFadeRadius * ${FADE_CORE.toFixed(2)}, uFadeRadius, length(gl_FragCoord.xy - uFocusPx));
  }
  if (all(greaterThan(gl_FragCoord.xy, uFocusExtraBox.xy)) && all(lessThan(gl_FragCoord.xy, uFocusExtraBox.zw))) {
    for (int k = 0; k < ${MAX_FADE_ACTORS}; k++) {
      vec4 e = uFocusExtra[k];
      if (e.w <= 0.0) break;
      vec2 dp = gl_FragCoord.xy - e.xy;
      float d2 = dot(dp, dp);
      vec4 f = uFocusExtraFoot[k];
      if (d2 < e.w * e.w && vViewPosition.z < e.z - 0.6 && dot(vKitWorld.xz, uCamBack) > f.x + ${FADE_FRONT_MARGIN.toFixed(2)}) {
        float side = f.y + e.w * ${FADE_SIDE_PAD.toFixed(2)};
        kf = max(kf, f.w * (1.0 - smoothstep(e.w * ${FADE_CORE.toFixed(2)}, e.w, sqrt(d2)))
          * (1.0 - smoothstep(side, side + e.w * ${(1 - FADE_CORE).toFixed(2)}, abs(dp.x - f.z * dp.y))));
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
    uFocusPx: u.uFocusPx, uFocusDepth: u.uFocusDepth, uFadeRadius: u.uFadeRadius, uFocusExtra: u.uFocusExtra,
    uFocusExtraBox: u.uFocusExtraBox, uFocusExtraFoot: u.uFocusExtraFoot,
    uCamBack: u.uCamBack, ...local, ...slots,
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
