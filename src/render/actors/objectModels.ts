// Object models (Modern): instanced meshes per kind (Poké Ball, boulder, cracked rock, Cut tree, truck, berry
// plants) drawn where the objects' sprites stand, rebuilt every frame from the list ActorLayer hands over (a model
// never outlives its sprite). Each kind is tinted from the sprite of its first instance (uTintA / uTintB, linear) by
// the geometry's tint codes (models.ts), from the sprite's tones and colours: the rocks' body, the highlight tone
// their up-facing surfaces blend to and the crevice tone of their cracks; the Cut tree's lime highlight and dark
// base band; the truck's navy (crevice), blue (accent) and grey-blue (main); the ball's red (accent). The Cut tree
// keeps the kit trees' convention (crown × the material colour, band and stump = uTrunk). The boulder varies by
// object: a full turn and a mirror image (a second, rewound mesh: an instance's negative scale would turn it
// inside out). A berry plant has its growth stage's body, and at stages 4 and 5 its flowers or berries instanced
// at the body's anchors; each plant is coloured from its own sprite (instance colours: its leaves, its accent).
// Every model is lit like the world but never below the floor the inflated actors get (LIGHT_FLOOR × the cards'
// light). Materials are kit materials made once and never released (not part of a world build). Instance matrices
// (and colours) upload only when they change.

import * as THREE from 'three';
import { applyKitMaterial, kitMaterial, type KitMaterial, type KitUniforms } from '../kit/materials';
import { luma, lush, soften, toLinear, type RGB } from '../kit/palette';
import { TRUNK_FRAG, TRUNK_HEAD } from '../kit/trees';
import { put, markRange } from '../instanceUpload';
import type { ObjectModelKind } from './objectMap';
import type { SpriteColors, SpriteTones } from './spriteColors';
import { FRAG_SHOULDER, LIGHT_FLOOR, MASK_GLSL, lampCeiling } from './inflatedActors';
import {
  berryFlowerGeo, berryFruitGeo, berryPlantGeo, boulderGeo, crackedRockGeo, cutTreeGeo, mirroredGeo, pokeBallGeo, truckGeo, truckLogoGeo,
  type BerryStage,
} from './models';

/** Instances per kind: gObjectEvents has 16 slots. */
export const MAX_PER_KIND = 16;

export interface ModelInstance {
  kind: ObjectModelKind;
  stage: number;
  /** World position of the model's foot (base centre). */
  x: number; y: number; z: number;
  colors: SpriteColors;
  /** The sprite's tones (absent: the rocks take theirs from the colours or the defaults). */
  tones?: SpriteTones;
  /** Turn about the vertical (rad, 0..2π) of the kinds that vary by object (rocks, trees); stable per object. */
  yaw?: number;
  /** The sprite is drawn mirrored (hflip): a kind that `mirrors` turns half way round (the truck's cab to +X). */
  mirror?: boolean;
  /** Drawn as its mirror image, for the kinds that vary so (`flips`); stable per object. */
  flip?: boolean;
}

/** Tints (sRGB): A, B, and the highlight tone up-facing tint-A surfaces blend to (none: no blend). */
interface Tints { a: RGB; b: RGB; h?: RGB }

interface PartSpec {
  /** Mesh name: the kind's (the first part) or kind + ':' + this. */
  suffix?: string;
  geometry: () => THREE.BufferGeometry;
  tints: (c: SpriteColors, t: SpriteTones) => Tints;
  /** Casts a sun shadow (default true; a flat decal does not). */
  castShadow?: boolean;
}

interface KindSpec {
  roughness: number;
  /** How far the instance's yaw turns it (rad either way): rocks and trees vary by object; the ball keeps its
   *  button, the truck its cab, the cracked rock its cracks, the boulder and the Cut tree their long side
   *  (wider than deep: squat on screen) on the side the sprite shows them (0: never). */
  spin: number;
  /** Turns half way round when the sprite is mirrored. */
  mirror?: boolean;
  /** Varies by a mirror image per object (ModelInstance.flip): a second group of meshes, its geometry rewound. */
  flips?: boolean;
  /** The kit trees' material convention (crown × material colour = tint A, trunk = uTrunk). */
  tree?: boolean;
  parts: PartSpec[];
}

/** Fallback tints (sRGB). */
const DEFAULT = {
  ball: [0.86, 0.16, 0.16] as RGB, boulder: [0.55, 0.5, 0.45] as RGB, rock: [0.6, 0.55, 0.5] as RGB,
  leaves: [0.3, 0.6, 0.3] as RGB, truck: [0.26, 0.26, 0.48] as RGB, truckTrim: [0.2, 0.35, 0.8] as RGB,
  truckLogo: [0.62, 0.68, 0.8] as RGB,
};
/** Safety floors (sRGB luma) of the rock body and Cut-tree crown tints, hue kept: the sprites' tones are well above
 *  them (rock body (123, 115, 66) 0.45; the Cut tree's lime (115, 189, 0) 0.58), an odd palette is not. */
export const MIN_LUMA = { rock: 0.36, leaves: 0.4 };
/** Most sRGB luma of the rock tones (a pale palette's lit tops stay under the bloom). */
const ROCK_MAX_LUMA = 0.75;

/** `c` scaled to a luma within [min, max] (hue kept). */
function lumaWithin(c: RGB, min: number, max = 1): RGB {
  const l = luma(c);
  if (l <= 0 || (l >= min && l <= max)) return c;
  const k = (l < min ? min : max) / l;
  return c.map((v) => Math.min(1, v * k)) as RGB;
}
const scaled = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];

/** A rock's tints: A = the sprite's body tone, its tops blending to the highlight tone, B = the crevice tone (cracks). */
function rockTints(c: SpriteColors, t: SpriteTones, fallback: RGB): Tints {
  const body = t.body ?? (c.main ? soften(c.main) : null);
  const a = body ? lumaWithin(body, MIN_LUMA.rock, ROCK_MAX_LUMA) : fallback;
  return {
    a,
    h: t.highlight ? lumaWithin(t.highlight, 0, ROCK_MAX_LUMA) : scaled(a, 1.3),
    b: t.crevice ?? scaled(a, 0.45),
  };
}

const SPECS: Partial<Record<ObjectModelKind, KindSpec>> = {
  pokeball: { roughness: 0.35, spin: 0, parts: [{ geometry: pokeBallGeo, tints: (c) => { const a = c.accent ?? DEFAULT.ball; return { a, b: a }; } }] },
  boulder: { roughness: 0.65, spin: Math.PI, flips: true, parts: [{ geometry: () => boulderGeo(87), tints: (c, t) => rockTints(c, t, DEFAULT.boulder) }] },
  crackedRock: { roughness: 0.8, spin: 0.5, parts: [{ geometry: () => crackedRockGeo(86), tints: (c, t) => rockTints(c, t, DEFAULT.rock) }] },
  // the crown in the sprite's lime highlight (its outline green left out): the cuttable tree reads apart from the
  // kit's trees and bushes, as the GBA's bright cap does
  cutTree: { roughness: 0.85, spin: 0.3, tree: true, parts: [{ geometry: () => cutTreeGeo(82), tints: (c, t) => {
    const a = t.highlight ? lumaWithin(soften(t.highlight), MIN_LUMA.leaves) : c.green ? lumaWithin(lush(c.green), MIN_LUMA.leaves) : DEFAULT.leaves;
    // B (uTrunk): the cap's dark under-rim and stump, in the sprite's dark band tone (its dark green base)
    return { a, b: t.dark ?? t.crevice ?? scaled(a, 0.3) };
  } }] },
  // the cargo box in the sprite's navy side (its crevice tone), roof and trim in its blue (accent), the logo in its
  // grey-blue (main: the swoosh's colour; the highlight tone also takes in the white cab)
  truck: { roughness: 0.6, spin: 0, mirror: true, parts: [
    { geometry: truckGeo, tints: (c, t) => ({ a: t.crevice ?? c.main ?? DEFAULT.truck, b: c.accent ?? DEFAULT.truckTrim }) },
    { suffix: 'logo', geometry: truckLogoGeo, castShadow: false, tints: (c) => { const a = c.main ?? DEFAULT.truckLogo; return { a, b: a }; } },
  ] },
};

const NO_COLORS: SpriteColors = { main: null, accent: null, green: null };
const NO_TONES: SpriteTones = { body: null, highlight: null, crevice: null, dark: null };

/** Berry plants: the most flowers or berries one carries (berryPlantGeo: 5–7); the geometry seed of every plant
 *  (shared anchors: each plant's own turn keeps them from looking alike); how far that turn goes (rad either way:
 *  a sprout's seed leaves keep their V across the default view, open east and west). */
const BERRY = { anchors: 7, seed: 0, spin: 0.5 };
/** Fallback colours (sRGB) of the berries and the petals (the leaves': DEFAULT.leaves). */
export const BERRY_DEFAULT = { fruit: [0.85, 0.2, 0.25] as RGB, petals: [0.95, 0.55, 0.75] as RGB };
/** Safety floors (sRGB luma), hue kept: the berries' and petals' colours (the sprites' fruit and flower colours sit
 *  well above them: Pecha (222, 148, 115) 0.64, Cheri (206, 99, 74) 0.47; a dark accent, an outline, does not), and
 *  the leaves' (the picker's green is a mean taking in the dark outline green: (60, 115, 0) → lush 0.27; a fresh
 *  leaf green, as the sprites' lime (115, 189, 0) 0.58, also reads at night). */
export const BERRY_MIN_LUMA = { leaves: 0.5, fruit: 0.3, petals: 0.45 };
/** A berry plant's colours (linear): leaves and stems, berries, petals. */
export interface BerryColors { leaves: RGB; fruit: RGB; petals: RGB }

/** The colours of a berry plant from its sprite: leaves = its green (lush, lifted to BERRY_MIN_LUMA.leaves),
 *  berries and petals = its accent (the fruit's or the flower's colour, lifted to their floors), each to its
 *  default where the sprite has none. */
export function berryColors(c: SpriteColors): BerryColors {
  return {
    leaves: toLinear(c.green ? lumaWithin(lush(c.green), BERRY_MIN_LUMA.leaves) : DEFAULT.leaves),
    fruit: toLinear(c.accent ? lumaWithin(c.accent, BERRY_MIN_LUMA.fruit) : BERRY_DEFAULT.fruit),
    petals: toLinear(c.accent ? lumaWithin(c.accent, BERRY_MIN_LUMA.petals) : BERRY_DEFAULT.petals),
  };
}

// Tint codes (models.ts): colour alpha 1 = the vertex colour as it is, 0.5 = × tint A, 0 = × tint B. Tint A blends
// towards uTintH on up-facing surfaces (uHighlight: 0 off, 1 on): the view-space normal against the view-space up.
const TINT_HEAD = /* glsl */ `
uniform vec3 uTintA;
uniform vec3 uTintB;
uniform vec3 uTintH;
uniform float uHighlight;
uniform float uMask;
uniform vec3 uFloor;
`;
const TINT_FRAG = /* glsl */ `
#ifdef USE_COLOR_ALPHA
{
  vec3 tintA = uTintA;
  #ifndef FLAT_SHADED
  if (uHighlight > 0.0) {
    float up = dot(normalize(vNormal), normalize(viewMatrix[1].xyz));
    tintA = mix(uTintA, uTintH, uHighlight * smoothstep(0.1, 0.7, up));
  }
  #endif
  diffuseColor.rgb *= vColor.a > 0.75 ? vec3(1.0) : (vColor.a > 0.25 ? tintA : uTintB);
  diffuseColor.a = 1.0;
}
#endif
`;
// Three's <color_vertex>, except that an instance colour (the berry plants' per-plant leaves, berries, petals)
// multiplies the tinted parts only (colour alpha < 0.75): fixed colours (the soil, the flowers' yellow heart)
// keep their own. Without instance colours it is three's: the other models compile as before.
const COLOR_VERTEX = /* glsl */ `
#if defined( USE_INSTANCING_COLOR ) && defined( USE_COLOR_ALPHA )
  vColor = color;
  if (color.a < 0.75) vColor.rgb *= instanceColor.rgb;
#else
  #include <color_vertex>
#endif
`;
// (the Cut tree: the trees' hooks, plus the harness mask and the light floor)
const TREE_HEAD = TRUNK_HEAD + 'uniform float uMask;\nuniform vec3 uFloor;\n';
/** Gentle sway of the Cut tree (the bushy trees' at its size). */
const TREE_WIND = { amp: 0.03, height: 1.15 };

// The inflated actors' light floor (inflatedActors.ts FRAG_FLOOR, without their relief terms): the diffuse light's
// luminance never drops below that of uFloor (LIGHT_FLOOR × the cards' light), keeping the lit colour's hue and
// blending to the floor's own where almost no light arrives. Uniform-driven: no program per scene.
const FLOOR_GLSL = /* glsl */ `
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

/** Replaces `#include <chunk>` with `code`; throws if three renamed it. */
function include(src: string, chunk: string, code: string): string {
  const line = `#include <${chunk}>`;
  if (!src.includes(line)) throw new Error(`objectModels: three shader chunk <${chunk}> not found`);
  return src.replace(line, code);
}
/** Replaces `#include <chunk>` with itself + `code`. */
const after = (src: string, chunk: string, code: string) => include(src, chunk, `#include <${chunk}>\n${code}`);

interface Part {
  spec: PartSpec;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  tintA: THREE.Color;
  tintB: THREE.Color;
  tintH: THREE.Color;
}

/** Meshes drawn together (a kind's parts), or the same mirrored. */
interface Group {
  parts: Part[];
  /** This frame's instances; the most ever set (the uploaded part of instanceMatrix); matrices changed. */
  n: number;
  used: number;
  dirty: boolean;
}

/** One berry mesh: this frame's instances; the most ever set (the uploaded part of its instance buffers);
 *  matrices / colours changed. */
interface Batch { mesh: THREE.InstancedMesh; n: number; used: number; dirty: boolean; colorDirty: boolean }

interface BerryMeshes {
  /** Stage s's bodies at [s − 1]. */
  bodies: Batch[];
  flower: Batch;
  fruit: Batch;
  /** The flowers' (stage 4) and berries' (stage 5) placements on a plant (plant space). */
  anchors: Record<4 | 5, THREE.Matrix4[]>;
  /** Plants this frame. */
  plants: number;
}
const _plant = new THREE.Matrix4(), _anchor = new THREE.Matrix4();

interface Kind {
  spec: KindSpec;
  /** [0]: the kind's meshes; [1]: their mirror images (`flips`). */
  groups: Group[];
  /** The colours the tints were last derived from (SpriteColorCache hands out one object per key). */
  colors: SpriteColors | null;
  /** This frame's instances, all groups. */
  n: number;
}

/**
 * Compiles every material under `root` for the scene's lights and a render target (as PostFX draws the scene:
 * no tone mapping, linear output), then draws one frame: `frame` (the owner's PostFX frame: its passes, GTAO's
 * override materials at High quality and the scene's shadow pass) or, without one, the scene into a 1×1 target
 * (its shadow pass compiles the shadow-depth programs compileAsync skips). The caller makes what must compile
 * visible first and may hide it again as soon as this returns; the promise resolves when the programs are ready.
 */
export function precompileScene(renderer: THREE.WebGLRenderer, root: THREE.Object3D, scene: THREE.Scene, camera: THREE.Camera,
  frame?: () => void): Promise<unknown> {
  const target = new THREE.WebGLRenderTarget(1, 1);
  const prev = renderer.getRenderTarget();
  let ready: Promise<unknown>;
  try {
    renderer.setRenderTarget(target);
    ready = renderer.compileAsync(root, camera, scene);
    if (!frame) renderer.render(scene, camera);
  } finally {
    renderer.setRenderTarget(prev);
    target.dispose();
  }
  frame?.();
  return ready;
}

export class ObjectModels {
  readonly group = new THREE.Group();
  private kinds = new Map<ObjectModelKind, Kind>();
  private mask = { value: 0 };
  /** The light floor (LIGHT_FLOOR × the cards' light; setLightFloor). */
  private floor = { value: new THREE.Color(0, 0, 0) };
  /**
   * The shadow-depth material of the models without a kit depth twin (the Cut tree sways: it has one). Three's own
   * is shared by every caster and only re-picks its program when the instancing flag flips, so instanced models
   * drawn among the world's non-instanced casters made it compile new variants for those (a world mesh with a
   * map) the first time a model appeared after a live Retro→Modern switch. Back faces, as three draws them.
   */
  private depth = new THREE.MeshDepthMaterial({ side: THREE.BackSide });
  /** The berry bodies' shadow-depth material: their instance colours make three pick another depth program, so
   *  they get one of their own (sharing `depth` would re-pick its program between them and the other models). */
  private berryDepth = new THREE.MeshDepthMaterial({ side: THREE.BackSide });
  /** The berry plants' meshes. */
  private berry: BerryMeshes;
  /** Each sprite's berry colours (SpriteColorCache hands out one colours object per key). */
  private berryColorCache = new WeakMap<SpriteColors, BerryColors>();

  constructor(kit: KitUniforms) {
    this.group.name = 'objectModels';
    for (const [name, spec] of Object.entries(SPECS) as [ObjectModelKind, KindSpec][]) {
      const parts = spec.parts.map((p) => this.part(kit, name, spec, p));
      const groups: Group[] = [{ parts, n: 0, used: 0, dirty: false }];
      if (spec.flips) groups.push({ parts: parts.map((p) => this.mirrorPart(p)), n: 0, used: 0, dirty: false });
      const k: Kind = { spec, groups, colors: null, n: 0 };
      this.tint(k, NO_COLORS, NO_TONES);
      this.kinds.set(name, k);
    }
    this.berry = this.berryMeshes(kit);
  }

  /**
   * The berry plants: a body mesh per growth stage (berry1…berry5), the flowers and the berries (berryFlower,
   * berryFruit: up to BERRY.anchors per plant, at its anchors). Every plant has its own colours (instance colours:
   * its leaves on the body, its accent on the flowers and berries); the materials' tints stay white. Leaves and
   * petals share a matte material, the berries a glossy one (one program: the tint hooks with instance colours).
   * The flowers and berries cast no shadow (too small to read in the shadow map; two draws saved).
   */
  private berryMeshes(kit: KitUniforms): BerryMeshes {
    const white = () => ({ a: new THREE.Color(1, 1, 1), b: new THREE.Color(1, 1, 1), h: new THREE.Color(1, 1, 1) });
    const matte = this.material(kit, 0.8, false, white(), 0).material;
    const glossy = this.material(kit, 0.32, false, white(), 0).material;
    const batch = (name: string, g: THREE.BufferGeometry, material: THREE.Material, capacity: number, castShadow: boolean): Batch => {
      const mesh = new THREE.InstancedMesh(g, material, capacity);
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.customDepthMaterial = this.berryDepth;
      mesh.name = name;
      mesh.count = 0;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = castShadow;
      mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(mesh);
      return { mesh, n: 0, used: 0, dirty: false, colorDirty: false };
    };
    const stages: BerryStage[] = [1, 2, 3, 4, 5];
    const up = new THREE.Vector3(0, 1, 0), q = new THREE.Quaternion(), twist = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
    // flowers face out of the crown (their +Y along its normal), each turned its own way; berries hang upright,
    // leaning a little out with the crown
    const anchors = (stage: 4 | 5) => {
      const p = berryPlantGeo(stage, BERRY.seed);
      return p.anchors.map((a, j) => {
        q.setFromUnitVectors(up, p.normals[j]);
        if (stage === 5) q.slerp(twist.identity(), 0.7);
        q.multiply(twist.setFromAxisAngle(up, j * 2.4));
        return new THREE.Matrix4().compose(a, q, one);
      });
    };
    return {
      bodies: stages.map((s) => batch(`berry${s}`, berryPlantGeo(s, BERRY.seed).body, matte, MAX_PER_KIND, true)),
      flower: batch('berryFlower', berryFlowerGeo(), matte, MAX_PER_KIND * BERRY.anchors, false),
      fruit: batch('berryFruit', berryFruitGeo(), glossy, MAX_PER_KIND * BERRY.anchors, false),
      anchors: { 4: anchors(4), 5: anchors(5) },
      plants: 0,
    };
  }

  /**
   * A model material: a kit material (the kit trees' for `tree`: crown × material colour, band = uTrunk = tint B)
   * or one applying the tint codes, plus the inflated actors' lamp ceiling (a model next to the Flash lantern is
   * not blown out) and soft shoulder (no glow), the light floor after the lights and the harness's actor mask
   * (flat magenta) after everything else — no uniform or define of their own: no extra program. An instance
   * colour (berry plants) tints only the tinted parts (COLOR_VERTEX).
   */
  private material(kit: KitUniforms, roughness: number, tree: boolean, t: { a: THREE.Color; b: THREE.Color; h: THREE.Color },
    highlight: number): KitMaterial {
    const km = tree
      ? kitMaterial(kit, {
        vertexColors: true, roughness, wind: TREE_WIND.amp, windHeight: TREE_WIND.height, fade: true,
        uniforms: { uTrunk: { value: t.b } }, fragHead: TREE_HEAD, fragColor: TRUNK_FRAG, hookKey: 'cutTree',
      })
      : kitMaterial(kit, {
        vertexColors: true, roughness,
        uniforms: { uTintA: { value: t.a }, uTintB: { value: t.b }, uTintH: { value: t.h }, uHighlight: { value: highlight } },
        fragHead: TINT_HEAD, fragColor: TINT_FRAG, hookKey: 'objectModel',
      });
    const material = km.material, base = material.onBeforeCompile;
    material.onBeforeCompile = (s, r) => {
      base.call(material, s, r);
      s.uniforms.uMask = this.mask;
      s.uniforms.uFloor = this.floor;
      s.vertexShader = include(s.vertexShader, 'color_vertex', COLOR_VERTEX);
      let fs = include(s.fragmentShader, 'lights_pars_begin', lampCeiling(THREE.ShaderChunk.lights_pars_begin));
      fs = include(fs, 'opaque_fragment', FRAG_SHOULDER + '#include <opaque_fragment>');
      s.fragmentShader = after(after(fs, 'lights_fragment_end', FLOOR_GLSL), 'dithering_fragment', MASK_GLSL);
    };
    return km;
  }

  private part(kit: KitUniforms, name: ObjectModelKind, spec: KindSpec, p: PartSpec): Part {
    const tintA = new THREE.Color(), tintB = new THREE.Color(), tintH = new THREE.Color();
    const km = this.material(kit, spec.roughness, spec.tree ?? false, { a: tintA, b: tintB, h: tintH },
      p.tints(NO_COLORS, NO_TONES).h ? 1 : 0);
    const material = km.material;
    const mesh = new THREE.InstancedMesh(p.geometry(), material, MAX_PER_KIND);
    applyKitMaterial(mesh, km);
    if (!km.depth) mesh.customDepthMaterial = this.depth;
    mesh.name = p.suffix ? `${name}:${p.suffix}` : name;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = p.castShadow ?? true;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.tints = { a: tintA, b: tintB, h: tintH };
    this.group.add(mesh);
    return { spec: p, mesh, material, tintA, tintB, tintH };
  }

  /** The mirror image of a part: its geometry rewound (models.ts mirroredGeo), the same material and tints. */
  private mirrorPart(p: Part): Part {
    const src = p.mesh;
    const mesh = new THREE.InstancedMesh(mirroredGeo(src.geometry), p.material, MAX_PER_KIND);
    mesh.customDepthMaterial = src.customDepthMaterial;
    mesh.name = `${src.name}:mirror`;
    mesh.count = 0;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.castShadow = src.castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.userData.tints = src.userData.tints;
    this.group.add(mesh);
    return { ...p, mesh };
  }

  /** Whether a kind has meshes. */
  supports(kind: ObjectModelKind): boolean {
    return kind === 'berry' || this.kinds.has(kind);
  }

  /** Objects drawn (last set; a berry plant counts once, its flowers or berries with it). */
  get count(): number {
    let n = this.berry.plants;
    for (const k of this.kinds.values()) n += k.n;
    return n;
  }

  /** The light flat sprite cards would get here (charLight): the models' diffuse light stays ≥ LIGHT_FLOOR × it,
   *  as the inflated actors' does. */
  setLightFloor(cardLight: THREE.Color): void {
    this.floor.value.copy(cardLight).multiplyScalar(LIGHT_FLOOR);
  }

  /** Resets every mesh's count, then places the instances (≤ MAX_PER_KIND each); a kind's tints follow its
   *  first instance's colours and tones (the defaults where one is missing). */
  set(list: readonly ModelInstance[]): void {
    for (const k of this.kinds.values()) {
      k.n = 0;
      for (const g of k.groups) g.n = 0;
    }
    const b = this.berry;
    b.plants = 0;
    for (const m of this.berryBatches()) m.n = 0;
    for (const inst of list) {
      if (inst.kind === 'berry') {
        this.placeBerry(inst);
        continue;
      }
      const k = this.kinds.get(inst.kind);
      if (!k || k.n >= MAX_PER_KIND) continue;
      if (k.n === 0) this.tint(k, inst.colors, inst.tones ?? NO_TONES);
      // (yaw in 0..2π → −spin..spin; a mirrored sprite turns a mirroring kind half way round)
      const yaw = ((inst.yaw ?? Math.PI) / Math.PI - 1) * k.spec.spin + (k.spec.mirror && inst.mirror ? Math.PI : 0);
      const g = k.groups[inst.flip && k.groups.length > 1 ? 1 : 0];
      this.place(g, g.n++, inst.x, inst.y, inst.z, yaw);
      k.n++;
    }
    for (const k of this.kinds.values()) {
      for (const g of k.groups) {
        for (const p of g.parts) {
          p.mesh.count = g.n;
          p.mesh.visible = g.n > 0;
          if (g.dirty) markRange(p.mesh.instanceMatrix, g.used);
        }
        g.dirty = false;
      }
    }
    for (const m of this.berryBatches()) {
      m.mesh.count = m.n;
      m.mesh.visible = m.n > 0;
      if (m.dirty) markRange(m.mesh.instanceMatrix, m.used);
      if (m.colorDirty) markRange(m.mesh.instanceColor!, m.used);
      m.dirty = m.colorDirty = false;
    }
  }

  private berryBatches(): Batch[] {
    return [...this.berry.bodies, this.berry.flower, this.berry.fruit];
  }

  /**
   * A berry plant: its stage's body at (x, y, z) turned by its yaw (a full turn, stable per object), in its leaves'
   * colour; at stage 4 its flowers, at stage 5 its berries, at its anchors (the plant's placement × the anchor's),
   * in its accent.
   */
  private placeBerry(inst: ModelInstance): void {
    const b = this.berry;
    const stage = Math.min(5, Math.max(1, Math.round(inst.stage))) as BerryStage;
    const body = b.bodies[stage - 1];
    if (body.n >= MAX_PER_KIND) return;
    let col = this.berryColorCache.get(inst.colors);
    if (!col) this.berryColorCache.set(inst.colors, (col = berryColors(inst.colors)));
    // (yaw in 0..2π → −spin..spin)
    const yaw = ((inst.yaw ?? Math.PI) / Math.PI - 1) * BERRY.spin, c = Math.cos(yaw), s = Math.sin(yaw);
    const e = body.mesh.instanceMatrix.array as Float32Array, o = body.n * 16;
    // (column-major; the other elements keep the identity the mesh was made with)
    if (put(e, o, c) | put(e, o + 2, -s) | put(e, o + 8, s) | put(e, o + 10, c) | put(e, o + 12, inst.x) | put(e, o + 13, inst.y)
      | put(e, o + 14, inst.z)) body.dirty = true;
    this.colorAt(body, body.n, col.leaves);
    if (++body.n > body.used) { body.used = body.n; body.dirty = body.colorDirty = true; }
    b.plants++;
    if (stage < 4) return;
    const batch = stage === 4 ? b.flower : b.fruit, tint = stage === 4 ? col.petals : col.fruit;
    _plant.makeRotationY(yaw).setPosition(inst.x, inst.y, inst.z);
    for (const local of b.anchors[stage as 4 | 5]) {
      if (batch.n >= batch.mesh.instanceMatrix.count) break;
      const m = _anchor.multiplyMatrices(_plant, local).elements, a = batch.mesh.instanceMatrix.array as Float32Array, ao = batch.n * 16;
      let d = 0;
      for (let k = 0; k < 16; k++) d |= put(a, ao + k, m[k]);
      if (d) batch.dirty = true;
      this.colorAt(batch, batch.n, tint);
      if (++batch.n > batch.used) { batch.used = batch.n; batch.dirty = batch.colorDirty = true; }
    }
  }

  /** Instance i's colour (linear RGB); flags a change. */
  private colorAt(m: Batch, i: number, c: RGB): void {
    const a = m.mesh.instanceColor!.array as Float32Array;
    if (put(a, i * 3, c[0]) | put(a, i * 3 + 1, c[1]) | put(a, i * 3 + 2, c[2])) m.colorDirty = true;
  }

  /** Draws the models flat magenta (the harness's visible-actor mask) or normally. */
  setMask(on: boolean): void {
    this.mask.value = on ? 1 : 0;
  }

  /**
   * Compiles the models' programs, their shadow-depth ones included (precompileScene; `frame`: the owner's PostFX
   * frame), every mesh shown with one instance meanwhile (restored before this returns). `root` (default: the
   * models) is what compileAsync walks; whatever else the caller made visible compiles in the same frame.
   */
  precompile(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, root: THREE.Object3D = this.group,
    frame?: () => void): Promise<void> {
    const meshes = [...this.kinds.values()].flatMap((k) => k.groups.flatMap((g) => g.parts.map((p) => p.mesh)))
      .concat(this.berryBatches().map((m) => m.mesh));
    const saved = meshes.map((m) => [m.visible, m.count] as const);
    const groupVisible = this.group.visible;
    this.group.visible = true;
    for (const m of meshes) {
      m.visible = true;
      m.count = 1;
    }
    try {
      return precompileScene(renderer, root, scene, camera, frame).then(() => undefined);
    } finally {
      meshes.forEach((m, i) => { [m.visible, m.count] = saved[i]; });
      this.group.visible = groupVisible;
    }
  }

  /** Instance i of group g at (x, y, z), turned by `yaw` about the vertical; flags a changed matrix. */
  private place(k: Group, i: number, x: number, y: number, z: number, yaw: number): void {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    // (column-major; the other elements keep the identity the meshes were made with; the parts move together)
    for (const p of k.parts) {
      const e = p.mesh.instanceMatrix.array as Float32Array, o = i * 16;
      const d = put(e, o, c) | put(e, o + 2, -s) | put(e, o + 8, s) | put(e, o + 10, c)
        | put(e, o + 12, x) | put(e, o + 13, y) | put(e, o + 14, z);
      if (d) k.dirty = true;
    }
    if (i + 1 > k.used) { k.used = i + 1; k.dirty = true; }
  }

  /** A kind's tints from its first instance's sprite. Keyed by the colours object alone: SpriteColorCache hands out
   *  colours and tones from one entry (one object pair per key), so the same colours mean the same tones. */
  private tint(k: Kind, colors: SpriteColors, tones: SpriteTones): void {
    if (colors === k.colors) return;
    k.colors = colors;
    for (const p of k.groups[0].parts) {
      const t = p.spec.tints(colors, tones);
      p.tintA.setRGB(...toLinear(t.a));
      p.tintB.setRGB(...toLinear(t.b));
      p.tintH.setRGB(...toLinear(t.h ?? t.a));
      if (k.spec.tree) p.material.color.copy(p.tintA);
    }
  }
}
