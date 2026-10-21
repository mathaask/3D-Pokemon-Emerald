// Object models (Modern): instanced meshes per kind (Poké Ball, boulder, cracked rock, Cut tree, truck) drawn
// where the objects' sprites stand, rebuilt every frame from the list ActorLayer hands over (a model never
// outlives its sprite). Each kind is tinted from the sprite of its first instance (uTintA / uTintB, linear) by
// the geometry's tint codes (models.ts): the rocks from the sprite's tones (body, a highlight tone their up-facing
// surfaces blend to, the crevice tone of their cracks), the others from its colours; the Cut tree keeps the kit
// trees' convention (crown × the material colour, trunk = uTrunk). Every model is lit like the world but never
// below the floor the inflated actors get (LIGHT_FLOOR × the cards' light). Materials are kit materials made once
// and never released (not part of a world build). Instance matrices upload only when they change.

import * as THREE from 'three';
import { applyKitMaterial, kitMaterial, type KitUniforms } from '../kit/materials';
import { luma, lush, soften, toLinear, type RGB } from '../kit/palette';
import { TRUNK_FRAG, TRUNK_HEAD } from '../kit/trees';
import { put, markRange } from '../instanceUpload';
import type { ObjectModelKind } from './objectMap';
import type { SpriteColors, SpriteTones } from './spriteColors';
import { LIGHT_FLOOR, MASK_GLSL } from './inflatedActors';
import { boulderGeo, crackedRockGeo, cutTreeGeo, pokeBallGeo, truckGeo, truckLogoGeo } from './models';

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
   *  button, the truck its cab and the cracked rock its cracks on the side the sprite shows them (0: never). */
  spin: number;
  /** Turns half way round when the sprite is mirrored. */
  mirror?: boolean;
  /** The kit trees' material convention (crown × material colour = tint A, trunk = uTrunk). */
  tree?: boolean;
  parts: PartSpec[];
}

/** Fallback tints (sRGB). */
const DEFAULT = {
  ball: [0.86, 0.16, 0.16] as RGB, boulder: [0.55, 0.5, 0.45] as RGB, rock: [0.6, 0.55, 0.5] as RGB,
  leaves: [0.3, 0.6, 0.3] as RGB, truck: [0.92, 0.92, 0.9] as RGB, truckTrim: [0.2, 0.35, 0.8] as RGB,
  truckLogo: [0.62, 0.68, 0.8] as RGB,
};
/** Bark of the Cut tree (sRGB). */
const TRUNK: RGB = [0.42, 0.3, 0.2];
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
  boulder: { roughness: 0.65, spin: Math.PI, parts: [{ geometry: () => boulderGeo(87), tints: (c, t) => rockTints(c, t, DEFAULT.boulder) }] },
  crackedRock: { roughness: 0.8, spin: 0.5, parts: [{ geometry: () => crackedRockGeo(86), tints: (c, t) => rockTints(c, t, DEFAULT.rock) }] },
  // the crown in the sprite's lime highlight (its outline green left out): the cuttable tree reads apart from the
  // kit's trees and bushes, as the GBA's bright cap does
  cutTree: { roughness: 0.85, spin: Math.PI, tree: true, parts: [{ geometry: () => cutTreeGeo(82), tints: (c, t) => {
    const a = t.highlight ? lumaWithin(soften(t.highlight), MIN_LUMA.leaves) : c.green ? lumaWithin(lush(c.green), MIN_LUMA.leaves) : DEFAULT.leaves;
    return { a, b: a };
  } }] },
  // the cargo box in the sprite's navy side (its crevice tone), roof and trim in its blue, the logo in its grey-blue
  truck: { roughness: 0.6, spin: 0, mirror: true, parts: [
    { geometry: truckGeo, tints: (c, t) => ({ a: t.crevice ?? c.main ?? DEFAULT.truck, b: c.accent ?? DEFAULT.truckTrim }) },
    { suffix: 'logo', geometry: truckLogoGeo, castShadow: false, tints: (c, t) => { const a = t.highlight ?? c.main ?? DEFAULT.truckLogo; return { a, b: a }; } },
  ] },
};

const NO_COLORS: SpriteColors = { main: null, accent: null, green: null };
const NO_TONES: SpriteTones = { body: null, highlight: null, crevice: null };

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
    tintA = mix(uTintA, uTintH, uHighlight * smoothstep(0.25, 0.9, up));
  }
  #endif
  diffuseColor.rgb *= vColor.a > 0.75 ? vec3(1.0) : (vColor.a > 0.25 ? tintA : uTintB);
  diffuseColor.a = 1.0;
}
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

/** Replaces `#include <chunk>` with itself + `code`; throws if three renamed it. */
function after(src: string, chunk: string, code: string): string {
  const include = `#include <${chunk}>`;
  if (!src.includes(include)) throw new Error(`objectModels: three shader chunk <${chunk}> not found`);
  return src.replace(include, include + '\n' + code);
}

interface Part {
  spec: PartSpec;
  mesh: THREE.InstancedMesh;
  material: THREE.MeshStandardMaterial;
  tintA: THREE.Color;
  tintB: THREE.Color;
  tintH: THREE.Color;
}

interface Kind {
  spec: KindSpec;
  parts: Part[];
  /** The colours the tints were last derived from (SpriteColorCache hands out one object per key). */
  colors: SpriteColors | null;
  /** This frame's instances; the most ever set (the uploaded part of instanceMatrix); matrices changed. */
  n: number;
  used: number;
  dirty: boolean;
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

  constructor(kit: KitUniforms) {
    this.group.name = 'objectModels';
    for (const [name, spec] of Object.entries(SPECS) as [ObjectModelKind, KindSpec][]) {
      const parts = spec.parts.map((p) => this.part(kit, name, spec, p));
      const k: Kind = { spec, parts, colors: null, n: 0, used: 0, dirty: false };
      this.tint(k, NO_COLORS, NO_TONES);
      this.kinds.set(name, k);
    }
  }

  private part(kit: KitUniforms, name: ObjectModelKind, spec: KindSpec, p: PartSpec): Part {
    const tintA = new THREE.Color(), tintB = new THREE.Color(), tintH = new THREE.Color();
    const km = spec.tree
      ? kitMaterial(kit, {
        vertexColors: true, roughness: spec.roughness, wind: TREE_WIND.amp, windHeight: TREE_WIND.height, fade: true,
        uniforms: { uTrunk: { value: new THREE.Color(...toLinear(TRUNK)) } }, fragHead: TREE_HEAD, fragColor: TRUNK_FRAG, hookKey: 'cutTree',
      })
      : kitMaterial(kit, {
        vertexColors: true, roughness: spec.roughness,
        uniforms: { uTintA: { value: tintA }, uTintB: { value: tintB }, uTintH: { value: tintH },
          uHighlight: { value: p.tints(NO_COLORS, NO_TONES).h ? 1 : 0 } },
        fragHead: TINT_HEAD, fragColor: TINT_FRAG, hookKey: 'objectModel',
      });
    // the light floor after the lights, the harness's actor mask (flat magenta) after everything else
    const material = km.material, base = material.onBeforeCompile;
    material.onBeforeCompile = (s, r) => {
      base.call(material, s, r);
      s.uniforms.uMask = this.mask;
      s.uniforms.uFloor = this.floor;
      s.fragmentShader = after(after(s.fragmentShader, 'lights_fragment_end', FLOOR_GLSL), 'dithering_fragment', MASK_GLSL);
    };
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

  /** Whether a kind has meshes (berry plants: Task 9). */
  supports(kind: ObjectModelKind): boolean {
    return this.kinds.has(kind);
  }

  /** Instances drawn (last set). */
  get count(): number {
    let n = 0;
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
    for (const k of this.kinds.values()) k.n = 0;
    for (const inst of list) {
      const k = this.kinds.get(inst.kind);
      if (!k || k.n >= MAX_PER_KIND) continue;
      if (k.n === 0) this.tint(k, inst.colors, inst.tones ?? NO_TONES);
      // (yaw in 0..2π → −spin..spin; a mirrored sprite turns a mirroring kind half way round)
      const yaw = ((inst.yaw ?? Math.PI) / Math.PI - 1) * k.spec.spin + (k.spec.mirror && inst.mirror ? Math.PI : 0);
      this.place(k, k.n++, inst.x, inst.y, inst.z, yaw);
    }
    for (const k of this.kinds.values()) {
      for (const p of k.parts) {
        p.mesh.count = k.n;
        p.mesh.visible = k.n > 0;
        if (k.dirty) markRange(p.mesh.instanceMatrix, k.used);
      }
      k.dirty = false;
    }
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
    const meshes = [...this.kinds.values()].flatMap((k) => k.parts.map((p) => p.mesh));
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

  /** Instance i of kind k at (x, y, z), turned by `yaw` about the vertical; flags a changed matrix. */
  private place(k: Kind, i: number, x: number, y: number, z: number, yaw: number): void {
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

  private tint(k: Kind, colors: SpriteColors, tones: SpriteTones): void {
    if (colors === k.colors) return;
    k.colors = colors;
    for (const p of k.parts) {
      const t = p.spec.tints(colors, tones);
      p.tintA.setRGB(...toLinear(t.a));
      p.tintB.setRGB(...toLinear(t.b));
      p.tintH.setRGB(...toLinear(t.h ?? t.a));
      if (k.spec.tree) p.material.color.copy(p.tintA);
    }
  }
}
