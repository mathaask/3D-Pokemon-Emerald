// The water arenas: the sea (water), the pond, the cave pond's and Kyogre's water (their walls: Task 9), and the sea floor
// (underwater). The water is the kit's stylised water (kit/water.ts: shallow-deep tint, moving normals, sun glints, shore
// foam and sea-rock collars over a field of cells) with the battle sky's soft clouds reflected in it — the battle camera
// never frames the sky (D1): the water shows it. Deep water is opaque and drawn first (renderOrder −1: the seabed and the
// pond's basin under it are rejected by the depth test, never shaded); only a pond's shallow rim blends, sandy towards
// its shore. Over the sea: rocks with foam collars and two low palm islets; on the pond: small lily pads (its reeds:
// flora.ts); the sea floor: kelp forests swaying in the current, boulders, light shafts falling through the blue haze
// (its caustics are the ground's: look.caustics).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { noise2, rng } from '../../kit/geom';
import { applyKitMaterial, kitMaterial, type KitMaterialOptions } from '../../kit/materials';
import { mix, scale, toLinear, type RGB } from '../../kit/palette';
import { waterMaterial } from '../../kit/water';
import { SOIL_MATERIAL } from '../../kit/soil';
import { CLIFF_MATERIAL } from '../../kit/cliffs';
import { GRASS_MATERIAL } from '../../kit/grass';
import { treeGeometry, treeCrownDetail } from '../../kit/trees';
import { KIT_NOISE_GLSL } from '../../kit/noise.glsl';
import { CLOUD_GLSL } from '../clouds.glsl';
import type { ArenaKind } from '../arenaKind';
import type { ArenaContext, ArenaPart, CatalogueEntry } from '../modernArena';
import { PLATFORM_FOOTPRINT, WATER_Y, type Stage } from '../stage';
import { CAVE_POND, POND, POND_BANK, groundHeight, moonlitAsGround, pondShore } from './ground';
import { addPad } from './platforms';
import { boulderGeometry, rockCluster } from './rocks';
import { arenaClear, arenaTreeMaterial, PALM } from './flora';
import { SCENERY_SEED, behindBattler, frameTop, scatter, stageKeepOut, type Ellipse } from './scatter';
import { polarIndex, ringBands } from './mesh';

export interface WaterField { data: Uint8Array; w: number; h: number; min: [number, number] }

/** The water field's size (cells of 1 unit, around the stage centre). */
const FIELD = 96;

/** The pond kinds' ellipse (null: open water). */
const pondOf = (kind: ArenaKind) => (kind === 'pond' ? POND : kind === 'cavePond' ? CAVE_POND : null);

/** The kit water shader's cells (1 unit, cell = (x, z − WATER_Y)): r = shore distance / 15 × 255 (sea kinds: 15
 *  everywhere; the cave pond: BFS from land, a cell is water when its centre lies inside the CAVE_POND ellipse; the pond:
 *  analytic, 0.5 + the distance into the water from its waterline, ground.ts pondShore), a = 255 on a sea
 *  rock's cell (the cell whose corner is the rock's integer (x, z): the shader's foam collar). 96 × 96 cells, min =
 *  [floor(centre.x) − 48, floor(centre.z − WATER_Y) − 48] (integer-aligned: the shader's rock lookup assumes it).
 *  (The shader centres a rock's collar 0.15 south of its corner, +z: a rock at corner (x, z) stands at world
 *  (x, z + 0.15 + WATER_Y). A corner outside the field is left out.) */
export function waterField(kind: ArenaKind, stage: Stage, rocks: readonly { x: number; z: number }[]): WaterField {
  const w = FIELD, h = FIELD;
  const min: [number, number] = [Math.floor(stage.centre.x) - w / 2, Math.floor(stage.centre.z - WATER_Y) - h / 2];
  const data = new Uint8Array(w * h * 4);
  const pond = pondOf(kind);
  if (!pond) {
    for (let i = 0; i < w * h; i++) data[i * 4] = 255;
  } else if (kind === 'pond') {
    // the pond's: analytic — 0.5 on its waterline (ground.ts pondShore: the shader's sheet runs out there as its bank
    // rises over the water), a cell more per unit into it (the land cells' polygonal shore gone)
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const sd = Math.min(15, Math.max(0, 0.5 - pondShore(min[0] + i + 0.5, min[1] + j + 0.5 + WATER_Y, stage)));
        data[(j * w + i) * 4] = Math.round((sd / 15) * 255);
      }
    }
  } else {
    // a local 4-neighbour flood from the land cells, capped at 15 (as kit/water.ts shoreDistance on a map)
    const dist = new Uint8Array(w * h).fill(255);
    const queue = new Int32Array(w * h);
    let head = 0, tail = 0;
    const cx = stage.centre.x, cz = stage.centre.z + pond.dz;
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        // the cell's centre on the water: world x, and z = its cell-space y + WATER_Y
        const x = min[0] + i + 0.5, z = min[1] + j + 0.5 + WATER_Y;
        if (Math.hypot((x - cx) / pond.rx, (z - cz) / pond.rz) > 1) { dist[j * w + i] = 0; queue[tail++] = j * w + i; }
      }
    }
    while (head < tail) {
      const c = queue[head++];
      const col = c % w, row = (c - col) / w, d = Math.min(15, dist[c] + 1);
      if (col + 1 < w && dist[c + 1] === 255) { dist[c + 1] = d; queue[tail++] = c + 1; }
      if (col > 0 && dist[c - 1] === 255) { dist[c - 1] = d; queue[tail++] = c - 1; }
      if (row + 1 < h && dist[c + w] === 255) { dist[c + w] = d; queue[tail++] = c + w; }
      if (row > 0 && dist[c - w] === 255) { dist[c - w] = d; queue[tail++] = c - w; }
    }
    for (let i = 0; i < w * h; i++) data[i * 4] = Math.round(((dist[i] === 255 ? 15 : dist[i]) / 15) * 255);
  }
  for (const r of rocks) {
    const i = r.x - min[0], j = r.z - min[1];
    if (Number.isInteger(i) && Number.isInteger(j) && i >= 0 && i < w && j >= 0 && j < h) data[(j * w + i) * 4 + 3] = 255;
  }
  return { data, w, h, min };
}

// The arena's water over the kit's. The kit's water is drawn for the overworld's camera, looking down at the sea; the
// battle camera looks at it from 5–28° above, where the kit's fresnel over its full wave tilt turned the whole sea into
// streaks of milky sky. The arena keeps the kit's field, foam, rock collars, waves (normals) and glints, and re-balances
// its colour and reflection for that view (WATER_LOOK): its deep water a clearer, lighter blue with lighter shoals
// in it (the open sea's shallow-deep tint), a pond's shallows sandy towards its shore; the sky's reflection — its
// gradient, deeper overhead, and its soft clouds — strong only towards the frame's top, where the camera looks along the
// water (a sharper fresnel, off a calmer normal); `mirror` the strength of the reflection and the glints both (1 on open
// water, CAVE_WATER.mirror in caves: a cave's ceiling reflects little); the waves calming with distance (far ripples
// alias into streaks at a grazing view).
//
// The clouds along the view ray reflected off the level water are evaluated per vertex (the sky's own clouds: CLOUD_GLSL
// along skyCloudUv, as BattleSky draws them; three noise lookups per vertex, none per pixel), into vArenaCloud — faded
// where the reflected ray runs along the horizon, as the sky fades them —, and the shoals (one noise lookup) into
// vArenaShoal.

/** The arena water's look over the kit's: its deep colour (× the tint, linear; the kit's: (0.28, 0.6, 0.55)), the shoals
 *  (patches of `shoal` of the way back to the shallow colour, about 1 / `shoalFreq` units across); a pond's shallows
 *  see-through from `shallow[0]` opacity at its shoreline to opaque `shallow[1]` cells out (the kit's: 0.5 to 2), the
 *  reflection there × `clear` at the shoreline, and turned `sandMix` of the way to `sand` (sRGB) at the shoreline, fading
 *  out over `sandBand` cells — the battle camera looks along the water, through the shallows onto the bank beyond: their
 *  sandy shelf shows in their colour; the reflection: the sky (uSky) × `horizon` at the horizon to × `zenith` overhead, by
 *  `base` + `fresnel` × (1 − cos)^`power` (the kit's: 0.06 + 1.1 × (1 − cos)³), and its clouds — the sky light turned
 *  `white` of the way to its grey, × `cloud` — by `cloudBase` + `cloudFresnel` × the same (they stand out from the sky's
 *  reflection, under the bloom's threshold), off the waves' tilt × `calm`; the waves calm by `far` (share) from `fade`
 *  units away. */
export const WATER_LOOK = {
  deep: [0.42, 0.8, 0.8] as RGB, shoal: 0.4, shoalFreq: 0.07,
  shallow: [0.75, 2.6] as const, clear: 0.3, sand: [0.84, 0.74, 0.5] as RGB, sandBand: [0.5, 2.4] as const, sandMix: 0.8,
  horizon: 1.2, zenith: [0.5, 0.75, 1.3] as RGB, white: 0.6, cloud: 1.6, cloudBase: 0.06, cloudFresnel: 0.9,
  base: 0.03, fresnel: 0.75, power: 5, calm: 0.5, fade: [15, 45] as const, far: 0.6,
};
const f2 = (v: number) => v.toFixed(2);
const v3 = (c: RGB) => `vec3(${c.map(f2).join(', ')})`;

const WATER_VERT_HEAD = /* glsl */ `
uniform float uClouds;
varying float vArenaCloud;
varying float vArenaShoal;
${KIT_NOISE_GLSL}
${CLOUD_GLSL}
`;
const WATER_VERT_WORLD = /* glsl */ `
{
  vec3 rv = normalize(kitWorldPos.xyz - cameraPosition);
  rv.y = -rv.y;
  vArenaCloud = uClouds > 0.0 ? uClouds * arenaClouds(skyCloudUv(rv, uTime) * 1.6) * smoothstep(0.0, 0.12, rv.y) : 0.0;
  vArenaShoal = smoothstep(0.5, 0.8, kitNoise2(kitWorldPos.xz * ${f2(WATER_LOOK.shoalFreq)} + 7.3));
}
`;

const WATER_HEAD = /* glsl */ `
uniform float uMirror;
float arenaShore;
varying float vArenaCloud;
varying float vArenaShoal;
`;
/** The kit's FRAG_COLOR (kit/water.ts) samples its field into a local once: the arena keeps that sample (arenaShore, its
 *  shore distance) rather than fetching the field a second time. */
const KIT_FIELD_FETCH = '  vec4 wd = texture(tWater, (cell - uGridMin) / uGridSize);';
const KEEP_FIELD = `${KIT_FIELD_FETCH}\n  arenaShore = wd.r * 15.0;`;
// The arena's colour (after the kit's: its foam kept), and a pond's sheet faded out past its water's edge (the field's
// shoreline: 0.5 cells), its foam with it.
const WATER_COLOR = /* glsl */ `
{
  float sd = arenaShore;
  vec3 tint = kitSrgbToLinear(uTint);
  float deep = smoothstep(0.8, 4.5, sd) * (1.0 - ${f2(WATER_LOOK.shoal)} * vArenaShoal);
  vec3 col = mix(mix(tint, vec3(0.0, 0.55, 0.62), 0.6), tint * ${v3(WATER_LOOK.deep)}, deep);
  // (a pond's shallow edge: the water over its sandy shelf)
  col = mix(col, ${v3(toLinear(WATER_LOOK.sand))}, (1.0 - smoothstep(${f2(WATER_LOOK.sandBand[0])}, ${f2(WATER_LOOK.sandBand[1])}, sd)) * ${f2(WATER_LOOK.sandMix)});
  diffuseColor.rgb = mix(col, vec3(0.92, 0.96, 1.0), kitFoam);
  diffuseColor.a = max(mix(${f2(WATER_LOOK.shallow[0])}, 1.0, smoothstep(0.5, ${f2(WATER_LOOK.shallow[1])}, sd)), kitFoam) * smoothstep(0.36, 0.5, sd);
}
`;
const WATER_NORMAL = /* glsl */ `
normal = normalize(mix(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz),
  smoothstep(${f2(WATER_LOOK.fade[0])}, ${f2(WATER_LOOK.fade[1])}, length(vViewPosition)) * ${f2(WATER_LOOK.far)}));
`;
// The reflection (in place of the kit's): the sky's gradient with its clouds, by fresnel off the calmer normal; the kit's
// glints on the waves; both by `mirror`, none on foam. Night water: uSky is dark — a faint sheen.
const WATER_EMISSIVE = /* glsl */ `
{
  vec3 vW = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  vec3 nC = normalize(vec3(nW.x * ${f2(WATER_LOOK.calm)}, nW.y, nW.z * ${f2(WATER_LOOK.calm)}));
  vec3 rW = reflect(-vW, nC);
  float fres = pow(1.0 - clamp(dot(nC, vW), 0.0, 1.0), ${f2(WATER_LOOK.power)});
  vec3 sky = uSky * mix(vec3(${f2(WATER_LOOK.horizon)}), ${v3(WATER_LOOK.zenith)}, sqrt(clamp(rW.y, 0.0, 1.0)));
  vec3 cloud = mix(uSky, vec3(dot(uSky, vec3(0.2126, 0.7152, 0.0722))), ${f2(WATER_LOOK.white)}) * ${f2(WATER_LOOK.cloud)};
  // (the kit's glint, kit/water.ts FRAG_EMISSIVE's hW / glint lines, verbatim)
  vec3 hW = normalize(vec3(0.0, 1.0, 0.0) + 0.16 * normalize(vec3(vW.x, 0.0, vW.z) + 1e-5));
  float glint = pow(max(dot(nW, hW), 0.0), 2500.0);
  vec3 refl = mix(sky * (${f2(WATER_LOOK.base)} + ${f2(WATER_LOOK.fresnel)} * fres), cloud * (${f2(WATER_LOOK.cloudBase)} + ${f2(WATER_LOOK.cloudFresnel)} * fres), vArenaCloud);
  // (clear shallows: the sandy basin shows through, the reflection fades with the water's opacity there)
  refl *= mix(${f2(WATER_LOOK.clear)}, 1.0, smoothstep(${f2(WATER_LOOK.shallow[0])}, 1.0, diffuseColor.a));
  // (the glints too by the mirror's strength: a cave's water shows few)
  totalEmissiveRadiance += (refl + uSky * glint * 0.8) * uMirror * (1.0 - kitFoam);
}
`;

/** waterMaterial(...) — its field, foam, rock collars and waves kept — with the battle's water over it (WATER_LOOK): its
 *  colour re-done after the kit's (the kit's own field sample reused: KIT_FIELD_FETCH), and its reflection replaced by the
 *  arena's (fragEmissive: the sky's gradient and the battle sky's clouds seen along the reflected ray, × fresnel × uSky ×
 *  (1 − foam), the kit's glints; all × `mirror`). The clouds are evaluated per vertex: CLOUD_GLSL in the vertex prelude
 *  (vertHead), skyCloudUv as the sky, into the varying vArenaCloud — none per pixel; `clouds` their strength (the look's:
 *  0 in caves). No swell (the lily pads and ripple rings lie 0.01–0.03 over the water). hookKey 'arenaWater'.
 *  Transparent as the kit's (a pond's shallow rim); opaqueWater makes the deep sheet. Throws if the kit's FRAG_COLOR no
 *  longer samples its field as KIT_FIELD_FETCH says (the part fails: today's arena; the drift guard's test fails). */
export function arenaWaterMaterial(tex: THREE.Texture, min: THREE.Vector2, size: THREE.Vector2, tint: RGB, clouds = 1,
  mirror = 1): KitMaterialOptions {
  const k = waterMaterial(tex, min, size, new THREE.Vector3(...tint));
  return {
    ...k,
    uniforms: { ...k.uniforms, uClouds: { value: clouds }, uMirror: { value: mirror } },
    fragHead: (k.fragHead ?? '') + WATER_HEAD,
    fragColor: keepField(k.fragColor ?? '') + WATER_COLOR,
    fragNormal: (k.fragNormal ?? '') + WATER_NORMAL,
    fragEmissive: WATER_EMISSIVE,
    vertTransform: undefined,
    vertHead: WATER_VERT_HEAD,
    vertWorld: WATER_VERT_WORLD,
    hookKey: 'arenaWater',
  };
}

/** The kit's FRAG_COLOR with its field sample kept in arenaShore (KIT_FIELD_FETCH). */
function keepField(kit: string): string {
  if (!kit.includes(KIT_FIELD_FETCH)) throw new Error('arena water: kit/water.ts FRAG_COLOR no longer samples its field as KIT_FIELD_FETCH');
  return kit.replace(KIT_FIELD_FETCH, KEEP_FIELD);
}

/** The deep water's material: arenaWaterMaterial's, opaque and writing depth (drawn first: what lies under it is never
 *  shaded). */
export const opaqueWater = (o: KitMaterialOptions): KitMaterialOptions => ({ ...o, transparent: false, depthWrite: true });

/** Drawn first of all (opaque: before the scenery at 0, the battlers at 2, the tops and the ground; transparent: before
 *  the ripple rings and the effects). */
export const WATER_RENDER_ORDER = -1;

/** The sea's sheet: a disc of this radius, `rings` rings of `segments` (ring k at r · (k / rings)^pow: densest near the
 *  stage, where the reflected clouds change fastest across the screen). A pond's: its ellipse + `out`, opaque up to
 *  `core` inside its shore (there the field's shore distance is ≥ WATER_LOOK.shallow[1] cells: alpha 1), its rim
 *  transparent. */
const SEA_SHEET = { r: 60, rings: 40, segments: 96, pow: 1.35 };
const POND_SHEET = { out: 1, core: 3.5, coreRings: 16, rimRings: 4, segments: 96 };

/** An indexed sheet at WATER_Y facing up: the rings `ring(k)` (k = 0..rings: radii (rx, rz) around (cx, cz)) of
 *  `segments` vertices, closed with a centre vertex when ring 0 is a point (rx = rz = 0). position + normal. */
function sheet(cx: number, cz: number, rings: number, segments: number, ring: (k: number) => [number, number]): THREE.BufferGeometry {
  const pos: number[] = [];
  const [rx0, rz0] = ring(0);
  const fan = rx0 === 0 && rz0 === 0;
  if (fan) pos.push(cx, WATER_Y, cz);
  const first = fan ? 1 : 0;
  for (let k = first; k <= rings; k++) {
    const [rx, rz] = ring(k);
    for (let s = 0; s < segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos.push(cx + Math.cos(a) * rx, WATER_Y, cz + Math.sin(a) * rz);
    }
  }
  // (facing up, as the ground's disc: its centre and rings 1..rings, or rings 0..rings)
  const idx = fan ? polarIndex(rings, segments) : ringBands(rings + 1, segments);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The water sheets of a kind: the deep (opaque) one and a pond's shallow rim (transparent; null on open water). */
export function waterSheets(kind: ArenaKind, stage: Stage): { deep: THREE.BufferGeometry; rim: THREE.BufferGeometry | null } {
  const pond = pondOf(kind);
  const S = SEA_SHEET, P = POND_SHEET;
  if (!pond) {
    const deep = sheet(stage.centre.x, stage.centre.z, S.rings, S.segments, (k) => {
      const r = S.r * Math.pow(k / S.rings, S.pow);
      return [r, r];
    });
    return { deep, rim: null };
  }
  const cx = stage.centre.x, cz = stage.centre.z + pond.dz;
  // (the pond's water ends POND_BANK.waterline inside its ellipse: its core as far inside the water as the cave pond's)
  const core = P.core + (kind === 'pond' ? POND_BANK.waterline : 0);
  const crx = pond.rx - core, crz = pond.rz - core;
  // (the core's last ring and the rim's first: the same vertices)
  const deep = sheet(cx, cz, P.coreRings, P.segments, (k) => {
    const t = Math.pow(k / P.coreRings, 1.2);
    return [crx * t, crz * t];
  });
  const rim = sheet(cx, cz, P.rimRings, P.segments, (k) => {
    const t = k / P.rimRings;
    return [crx + (pond.rx + P.out - crx) * t, crz + (pond.rz + P.out - crz) * t];
  });
  return { deep, rim };
}

/** One small lily pad (platforms.ts addPad: notch, raised rim, veins, an edge band down to the water, an underside) of
 *  `radius`, its notch turned by `seed`; `color` sRGB. Floating: the water level is y = 0 (its top ≈ 0.03 over it). */
export function lilyPadGeometry(seed: number, radius: number, color: RGB): THREE.BufferGeometry {
  const r = rng(seed * 2971 + 0x11d);
  const out = { pos: [] as number[], col: [] as number[] };
  addPad(out, 0, 0, radius, radius * (0.92 + 0.08 * r()), r() * Math.PI * 2, toLinear(color), 3, 28);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(out.col, 3));
  g.translate(0, -WATER_Y, 0);
  g.computeVertexNormals();
  return g;
}

/** Kelp: 4 ribbons 2.5–5 tall from roots around y = 0, curving in a lazy S and twisting as they rise (now face-on, now
 *  edge-on), widest at mid height and tapering to the tip, their edges rippled; dark at the root, light at the tip
 *  (`color` sRGB, each ribbon its own shade); normals leaning up (lit like the grass blades, both faces: GRASS_MATERIAL).
 *  position, normal, color(3). */
export function kelpGeometry(seed: number, color: RGB): THREE.BufferGeometry {
  const r = rng(seed * 977 + 0x6e1b);
  const base = toLinear(color);
  const SEG = 16;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], idx: number[] = [];
  for (let b = 0; b < 4; b++) {
    const h = 2.5 + 2.5 * r(), yaw = r() * Math.PI * 2, twist = (r() - 0.5) * 2.6, w0 = 0.1 + 0.07 * r();
    const ox = (r() - 0.5) * 0.45, oz = (r() - 0.5) * 0.45;
    const lean = (r() - 0.5) * 1.1, leanAt = r() * Math.PI * 2, amp = 0.18 + 0.17 * r(), freq = 1.0 + 0.8 * r(), ph = r() * Math.PI * 2;
    const shade = 0.82 + 0.3 * r();
    const lx = Math.cos(leanAt), lz = Math.sin(leanAt);
    const v0 = pos.length / 3;
    for (let s = 0; s <= SEG; s++) {
      const t = s / SEG, y = h * t;
      // the ribbon's spine: a lean and an S-curve growing with height; its width across a direction turning with height
      const off = lean * t * t, wave = amp * Math.sin(freq * y + ph) * Math.min(1, t * 2);
      const a = yaw + twist * t, ax = Math.cos(a), az = Math.sin(a), fx = -az, fz = ax;
      const x = ox + lx * off + fx * wave, z = oz + lz * off + fz * wave;
      const w = w0 * (0.5 + 1.9 * t * (1 - t)) * (1 - 0.9 * Math.pow(t, 6)) * (1 + 0.2 * Math.sin(y * 6.5 + ph));
      const nl = Math.hypot(fx * 0.55, 1, fz * 0.55), nx = (fx * 0.55) / nl, ny = 1 / nl, nz = (fz * 0.55) / nl;
      const k = (0.45 + 0.7 * t) * shade;
      pos.push(x - ax * w, y, z - az * w, x + ax * w, y, z + az * w);
      for (let q = 0; q < 2; q++) { nor.push(nx, ny, nz); col.push(base[0] * k, base[1] * k, base[2] * k); }
    }
    for (let s = 0; s < SEG; s++) {
      const a = v0 + s * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------- placements

/** A rock standing in the water: its centre (world), width, seed, and the field corners its foam collar is drawn round
 *  (waterField's rocks). */
export interface WaterRock { x: number; z: number; size: number; seed: number; corners: { x: number; z: number }[] }

/** A kind's rocks in the water: how many, the annulus, their widths. (Up to SMALL_ROCK wide a rock stands on one field
 *  corner — the kit's collar, ≈ 0.45 round, is its waterline —; a wider one on a cell's middle, its four corners'
 *  collars round it.) */
const WATER_ROCKS: Partial<Record<ArenaKind, { count: [number, number]; r: [number, number]; size: [number, number] }>> = {
  water: { count: [6, 9], r: [9, 30], size: [0.8, 1.7] },
  kyogre: { count: [3, 5], r: [9, 26], size: [0.8, 1.6] },
  cavePond: { count: [3, 4], r: [9, 16], size: [0.7, 1.3] },
};
/** A cave pond's rocks stand inside this elliptical radius of its CAVE_POND ellipse (in its water, off its shore). */
const POND_ROCK_E = 0.9;
const SMALL_ROCK = 1.2;
/** A rock sinks this share of its width under the water (its widest part at the waterline). */
const ROCK_SINK = 0.25;

/** The field corners round a centre (cell-space x, z without the collar's 0.15) within `r` (at least the nearest). */
function cornersWithin(x: number, z: number, r: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let j = Math.floor(z - r); j <= Math.ceil(z + r); j++) {
    for (let i = Math.floor(x - r); i <= Math.ceil(x + r); i++) if (Math.hypot(i - x, j - z) <= r) out.push({ x: i, z: j });
  }
  return out.length ? out : [{ x: Math.round(x), z: Math.round(z) }];
}

/** Rocks in the water stand within this angle of straight behind the stage (the camera's view at any yaw). */
const BACK_ARC = 1.3;

/** water 6–9 rocks (r 9–30), kyogre 3–5 (r 9–26), cavePond 3–4 (r 9–16) inside POND_ROCK_E of its pond: within BACK_ARC of straight behind, on the tall
 *  rule, out from behind the battlers (scatter.ts BEHIND); each centred on a field corner (narrow) or a cell's middle (wide). */
export function waterRocks(kind: ArenaKind, stage: Stage, seed: number): WaterRock[] {
  const rule = WATER_ROCKS[kind];
  if (!rule) return [];
  const r = rng(seed * 6007 + 0x70c);
  const n = rule.count[0] + Math.floor(r() * (rule.count[1] - rule.count[0] + 1));
  const ko = stageKeepOut(stage), pond = pondOf(kind);
  const inPond = (x: number, z: number) => !pond || Math.hypot((x - stage.centre.x) / pond.rx, (z - stage.centre.z - pond.dz) / pond.rz) < POND_ROCK_E;
  const pts = scatter(seed * 6007 + 0x5ea, { centre: stage.centre, r0: rule.r[0], r1: rule.r[1], count: n, minGap: 3.5,
    accept: (x, z) => ko.tallOk(x, z) && !behindBattler(stage, x, z) && inPond(x, z)
      && Math.abs(Math.atan2(x - stage.centre.x, stage.centre.z - z)) <= BACK_ARC });
  return pts.map((p) => {
    const size = rule.size[0] + (rule.size[1] - rule.size[0]) * r(), rs = Math.floor(r() * 1e6);
    // (cell space: z − WATER_Y; the collar 0.15 south of a corner)
    const zc = p.z - WATER_Y - 0.15;
    if (size < SMALL_ROCK) {
      const cx = Math.round(p.x), cz = Math.round(zc);
      return { x: cx, z: cz + 0.15 + WATER_Y, size, seed: rs, corners: [{ x: cx, z: cz }] };
    }
    const cx = Math.floor(p.x) + 0.5, cz = Math.floor(zc) + 0.5;
    return { x: cx, z: cz + 0.15 + WATER_Y, size, seed: rs, corners: cornersWithin(cx, cz, 0.75) };
  });
}

/** A low islet: a smooth dome of sand with a grassy crown, its palms (their feet on the dome). */
export interface Islet { x: number; z: number; size: number; height: number; seed: number; corners: { x: number; z: number }[];
  palms: { x: number; y: number; z: number; scale: number; yaw: number; sink: number; shade: number }[] }

/** The sea's two islets (one each side of the stage's back): width and height (over the water), the annulus and the
 *  angles off straight behind; palms per islet and their scale. (The brief's r 26–36 lies where the camera's frame top is
 *  0.6 → 0 units over the water — only the islets' feet would show: tuned in to r 15–20, where it is ≈ 1.5–1.1, a little
 *  round to the sides: the frame's top corners at the idle yaw, its middle at yaw ±0.9.) */
const ISLET = { size: [4, 5.5] as const, height: [0.5, 0.65] as const, r: [15, 20] as const, angle: [0.35, 0.8] as const,
  palms: [2, 3] as const, scale: [0.62, 0.82] as const };
/** An islet's footprint is this much narrower front to back. */
const ISLET_DEPTH = 0.75;
/** A palm's crown starts this high over its foot at scale 1 (kit/trees.ts palmGeo: the fronds at the trunk's top, 2.0);
 *  its fronds' tips stand at least CROWN_CLEAR under the frame's top (the crown whole, clear of the edge: with only its
 *  foot 0.4 under it, the tips stood 21–28 px from the idle frame's top). */
const PALM_CROWN = 2.0, CROWN_CLEAR = 0.45;
/** A palm's fronds' tips over its foot at scale 1 (rising from the trunk's top to 2.26: arenaScenery.test.ts holds it to
 *  the kit's palm). */
export const PALM_TOP = 2.26;
/** Palms stand on an islet's near half (towards the camera: lower on the dome and in the frame), `e` of its radius out. */
const PALM_E = [0.2, 0.5] as const;

/** An islet's dome over the water at elliptical radius e (0 centre .. 1 its waterline; below the water beyond). */
const isletProfile = (height: number, e: number) => height * Math.pow(Math.max(0, 1 - e * e), 1.3) - 0.12 * Math.max(0, e - 0.9) * 10;

/** The sea's islets: one each side of straight behind the stage (r 15–20, 0.35–0.8 rad off), on the tall rule, out from
 *  behind the battlers (scatter.ts BEHIND); 2–3 palms on each, on its near half (PALM_E), sunk until their fronds' tips stand
 *  CROWN_CLEAR under the frame's top at every settled yaw (a palm that would have to sink its whole trunk is left out). */
export function isletPlacements(stage: Stage, seed: number): Islet[] {
  const r = rng(seed * 4513 + 0x15e7);
  const ko = stageKeepOut(stage), top = frameTop(stage);
  const out: Islet[] = [];
  for (const side of [-1, 1]) {
    const size = ISLET.size[0] + (ISLET.size[1] - ISLET.size[0]) * r(), height = ISLET.height[0] + (ISLET.height[1] - ISLET.height[0]) * r();
    let at: { x: number; z: number } | null = null;
    for (let t = 0; t < 40 && !at; t++) {
      const rad = ISLET.r[0] + (ISLET.r[1] - ISLET.r[0]) * r(), ang = side * (ISLET.angle[0] + (ISLET.angle[1] - ISLET.angle[0]) * r());
      const x = stage.centre.x + Math.sin(ang) * rad, z = stage.centre.z - Math.cos(ang) * rad;
      if (ko.tallOk(x, z) && !behindBattler(stage, x, z)) at = { x, z };
    }
    if (!at) continue;
    const cx = Math.floor(at.x) + 0.5, cz = Math.floor(at.z - WATER_Y - 0.15) + 0.5;
    const x = cx, z = cz + 0.15 + WATER_Y;
    const n = ISLET.palms[0] + Math.floor(r() * (ISLET.palms[1] - ISLET.palms[0] + 1));
    const palms: Islet['palms'] = [];
    for (let k = 0; k < n; k++) {
      // (over the near half, +z: palm k in its 1/n share of 0.1π–0.9π, from its start up to 0.4 of the share on — 0.1π–0.66π
      // with 2 palms, to 0.74π with 3: they lean to +x)
      const a = Math.PI * (0.1 + 0.8 * ((k + r() * 0.4) / n)), e = PALM_E[0] + (PALM_E[1] - PALM_E[0]) * r();
      const px = x + Math.cos(a) * e * size / 2, pz = z + Math.sin(a) * e * (size / 2) * ISLET_DEPTH;
      const y = WATER_Y + isletProfile(height, e) - 0.05;
      const scale = ISLET.scale[0] + (ISLET.scale[1] - ISLET.scale[0]) * r(), yaw = r() * Math.PI * 2, shade = 0.9 + 0.2 * r();
      const sink = Math.max(0, y + PALM_TOP * scale * PALM.squat + CROWN_CLEAR - top(px, pz));
      if (sink > PALM_CROWN * scale * PALM.squat) continue;
      palms.push({ x: px, y, z: pz, scale, yaw, sink, shade });
    }
    // (its foam collar: the field corners well inside its waterline)
    out.push({ x, z, size, height, seed: Math.floor(r() * 1e6), palms, corners: cornersWithin(cx, cz, size * 0.32) });
  }
  return out;
}

/** An islet's dome (`size` wide, ISLET_DEPTH as deep, `height` over the water at y = 0; its rim a little under it): a
 *  smooth, gently lumpy mound, wet sand at the waterline, dry sand, a grassy crown (`sand`, `grass` sRGB). position,
 *  normal (smooth), color(3) (linear). */
function isletGeometry(seed: number, size: number, height: number, sand: RGB, grass: RGB): THREE.BufferGeometry {
  const RINGS = 8, SEG = 48;
  const pos: number[] = [], col: number[] = [];
  const s = toLinear(sand), g = toLinear(grass), o = (seed % 997) * 0.37;
  const put = (e: number, a: number) => {
    const wob = 1 + 0.14 * noise2(Math.cos(a) * 1.6 + o, Math.sin(a) * 1.6, 0x15e7);
    const x = Math.cos(a) * e * wob * size / 2, z = Math.sin(a) * e * wob * (size / 2) * ISLET_DEPTH;
    const y = isletProfile(height, e) * (1 + 0.12 * noise2(x * 1.3 + o, z * 1.3, 0x6a5));
    pos.push(x, y, z);
    // wet sand at the waterline, dry sand, then the grass crown (a soft, noisy edge)
    const t = y / height, n = 0.08 * noise2(x * 2.1 - o, z * 2.1, 0x9a5);
    const grassK = THREE.MathUtils.smoothstep(t + n, 0.42, 0.6), wet = 1 - THREE.MathUtils.smoothstep(t, 0.02, 0.15);
    const k = 1 - 0.22 * wet;
    for (let i = 0; i < 3; i++) col.push((s[i] + (g[i] - s[i]) * grassK) * k);
  };
  put(0, 0);
  for (let k = 1; k <= RINGS + 1; k++) {
    // (one ring past the waterline: the rim under the water)
    const e = k <= RINGS ? k / RINGS : 1.15;
    for (let q = 0; q < SEG; q++) put(e, (q / SEG) * Math.PI * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // (its centre and RINGS + 1 rings, the last under the water: facing up)
  geo.setIndex(polarIndex(RINGS + 1, SEG));
  geo.computeVertexNormals();
  return geo;
}

/** The pond's small lily pads: 8–14, r 4–13 from the stage centre, on its open water (inside 0.8 of its ellipse), off the
 *  platforms' own pads (× 1.7 footprint), the strip in front of the player's and the ground beyond the frame's bottom;
 *  radius 0.35–0.7. */
export function padPlacements(stage: Stage, seed: number): { x: number; z: number; r: number; seed: number }[] {
  const r = rng(seed * 3001 + 0x9ad);
  const n = 8 + Math.floor(r() * 7);
  const clear = arenaClear(stage), fp = PLATFORM_FOOTPRINT;
  const own: Ellipse[] = [
    { x: stage.player.x, z: stage.player.z, rx: fp.player.rx * 1.7, rz: fp.player.rz * 1.7 },
    { x: stage.enemy.x, z: stage.enemy.z, rx: fp.enemy.rx * 1.7, rz: fp.enemy.rz * 1.7 },
  ];
  const pts = scatter(seed * 3001 + 0x11d, { centre: stage.centre, r0: 4, r1: 13, count: n, minGap: 1.8, keepOut: own,
    accept: (x, z) => clear(x, z) && Math.hypot((x - stage.centre.x) / POND.rx, (z - stage.centre.z - POND.dz) / POND.rz) < 0.8 });
  return pts.map((p) => ({ ...p, r: 0.35 + 0.35 * r(), seed: Math.floor(r() * 1e6) }));
}

/** Points fanned round the stage at angles (radians off straight behind it, + towards +x), each at the first radius in
 *  r0..r1 (seeded tries) that `accept` takes; an angle with none is left out. */
function fanned(stage: Stage, r: () => number, angles: readonly number[], r0: number, r1: number,
  accept: (x: number, z: number) => boolean): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (const a of angles) {
    for (let t = 0; t < 12; t++) {
      const rad = r0 + (r1 - r0) * r(), x = stage.centre.x + Math.sin(a) * rad, z = stage.centre.z - Math.cos(a) * rad;
      if (accept(x, z)) { out.push({ x, z }); break; }
    }
  }
  return out;
}

/** The kelp keeps out of the ground behind a battler this far back (behindBattler; further back, it rises over a battler's
 *  head). */
export const KELP_BEHIND = 9;
/** The sea floor's kelp forests: two in the frame's back band (0.15–0.5 rad off straight behind, r 15–21) and one each
 *  side (0.8–1.2 rad off, r 11–16: in view as the camera swings), on the tall rule and out from behind the battlers (9
 *  units: beyond, they rise over a battler's head); 30–50 kelp round them (within 3 units of one, r 6–24, each on the
 *  tall rule — the camera's sight lines and the stage stay clear — and out from behind the battlers), scale 0.75–1.15. */
export function kelpPlacements(stage: Stage, seed: number): { x: number; z: number; scale: number; yaw: number; shade: number; variant: number }[] {
  const r = rng(seed * 811 + 0x6e1b);
  const ko = stageKeepOut(stage);
  const ok = (x: number, z: number) => ko.tallOk(x, z) && !behindBattler(stage, x, z, { reach: KELP_BEHIND });
  const back = (u: number) => 0.15 + 0.35 * u, side = (u: number) => 0.8 + 0.4 * u;
  const forests = [...fanned(stage, r, [-back(r()), back(r())], 15, 21, ok), ...fanned(stage, r, [-side(r()), side(r())], 11, 16, ok)];
  const n = 30 + Math.floor(r() * 21);
  const out: ReturnType<typeof kelpPlacements> = [];
  if (!forests.length) return out;
  for (let i = 0; i < n; i++) {
    for (let t = 0; t < 30; t++) {
      const f = forests[i % forests.length], a = r() * Math.PI * 2, d = 3 * Math.sqrt(r());
      const x = f.x + Math.cos(a) * d, z = f.z + Math.sin(a) * d, rc = Math.hypot(x - stage.centre.x, z - stage.centre.z);
      // (each stalk on the rules, not only its forest's centre: a stalk 3 units out may stand behind a battler)
      if (rc < 6 || rc > 24 || !ok(x, z) || out.some((k) => (k.x - x) ** 2 + (k.z - z) ** 2 < 0.36)) continue;
      out.push({ x, z, scale: 0.75 + 0.4 * r(), yaw: r() * Math.PI * 2, shade: 0.85 + 0.3 * r(), variant: Math.floor(r() * KELP_VARIANTS) });
      break;
    }
  }
  return out;
}
/** Kelp shapes (one instanced draw each). */
const KELP_VARIANTS = 3;
/** The kelp sways in the current: GRASS_MATERIAL's program, its sway this strong over this height (the blades': 0.08 over
 *  0.6). */
const KELP_SWAY = { wind: 0.3, windHeight: 3.5 };

/** The sea floor's 8 boulders (r 7–24): wide ones (≥ 1.1) on the tall rule, small ones off the platforms and the strip in
 *  front of the player's; out from behind the battlers. */
function seaFloorRocks(stage: Stage, seed: number): { x: number; z: number; size: number; seeds: number[] }[] {
  const r = rng(seed * 4099 + 0x5eaf);
  const sizes = Array.from({ length: 8 }, () => 0.8 + 1.3 * r());
  const ko = stageKeepOut(stage), clear = arenaClear(stage);
  const big = sizes.filter((s) => s >= 1.1), small = sizes.filter((s) => s < 1.1);
  const at = (count: number, salt: number, accept: (x: number, z: number) => boolean) =>
    scatter(seed * 4099 + salt, { centre: stage.centre, r0: 7, r1: 24, count, minGap: 3, accept: (x, z) => accept(x, z) && !behindBattler(stage, x, z, { reach: Infinity }) });
  const pts = [...at(big.length, 0xb16, ko.tallOk).map((p, i) => ({ ...p, size: big[i] })),
    ...at(small.length, 0x5a1, clear).map((p, i) => ({ ...p, size: small[i] }))];
  return pts.map((p) => ({ ...p, seeds: Array.from({ length: 1 + Math.floor(r() * 3) }, () => Math.floor(r() * 1e6)) }));
}

// ------------------------------------------------------------------------------------------------- light shafts

// Light shafts under the sea: soft columns of light falling through the water, their light the emissive uShaft blended
// over the scene by a profile from their vertex colours (r: across, 0..1; g: the height over the sea floor / 10; b: a
// phase): brightest low down — the battle camera sees no more than ≈ 2 units over the floor behind the stage —, fading
// out upwards, flickering as the waves above pass; fogged into the blue haze with distance.
const SHAFT_HEAD = /* glsl */ `
uniform vec3 uShaft;
uniform float uShaftAlpha;
`;
const SHAFT_COLOR = /* glsl */ `
{
  float u = abs(vColor.r * 2.0 - 1.0), h = vColor.g * 10.0;
  float across = (1.0 - u * u) * (1.0 - u * u);
  float flicker = 0.65 + 0.35 * sin(uTime * 0.8 + vColor.b * 6.2832 + h * 0.4);
  diffuseColor = vec4(0.0, 0.0, 0.0, uShaftAlpha * across * smoothstep(0.0, 0.6, h) * (1.0 - smoothstep(2.5, 9.0, h)) * flicker);
}
`;
const SHAFT_EMISSIVE = /* glsl */ `
totalEmissiveRadiance += uShaft;
`;
/** The shafts' material (`light` linear, `alpha` their strength). */
function shaftMaterial(light: THREE.Color, alpha: number): KitMaterialOptions {
  return { vertexColors: true, transparent: true, depthWrite: false, color: 0x000000, roughness: 1,
    uniforms: { uShaft: { value: light }, uShaftAlpha: { value: alpha } },
    fragHead: SHAFT_HEAD, fragColor: SHAFT_COLOR, fragEmissive: SHAFT_EMISSIVE, hookKey: 'arenaShaft' };
}
/** Light shafts: `back` fanned across the frame's back band (±`arc` rad off straight behind, r 11–19) and one each side
 *  (`side` rad off: in view as the camera swings), on the tall rule (behind a battler too: light, drawn after it, never
 *  over it), 1.6–3.2 wide, from the sea floor 9 units up, slanting with the light; facing the camera (+z). */
const SHAFTS = { back: 5, arc: 0.5, side: [0.85, 1.2] as const, r: [11, 19] as const, width: [1.6, 3.2] as const, height: 9, slant: -0.35,
  light: [0.85, 0.97, 1.0] as RGB, alpha: 0.5 };

export function shaftGeometry(stage: Stage, seed: number): THREE.BufferGeometry | null {
  const r = rng(seed * 733 + 0x5af7);
  const ko = stageKeepOut(stage);
  const angles = [...Array.from({ length: SHAFTS.back }, (_, i) => -SHAFTS.arc + (2 * SHAFTS.arc * (i + 0.2 + 0.6 * r())) / SHAFTS.back),
    ...[-1, 1].map((k) => k * (SHAFTS.side[0] + (SHAFTS.side[1] - SHAFTS.side[0]) * r()))];
  const pts = fanned(stage, r, angles, SHAFTS.r[0], SHAFTS.r[1], ko.tallOk);
  if (!pts.length) return null;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const ROWS = 4;
  for (const p of pts) {
    const w = SHAFTS.width[0] + (SHAFTS.width[1] - SHAFTS.width[0]) * r(), phase = r();
    const y0 = groundHeight('underwater', p.x, p.z, stage) - 0.1, y1 = y0 + SHAFTS.height;
    const v0 = pos.length / 3;
    for (let k = 0; k <= ROWS; k++) {
      const t = k / ROWS, y = y0 + (y1 - y0) * t, x = p.x + SHAFTS.slant * (y - y0), half = (w / 2) * (1.25 - 0.45 * t);
      pos.push(x - half, y, p.z, x + half, y, p.z);
      col.push(0, (y - y0) / 10, phase, 1, (y - y0) / 10, phase);
    }
    for (let k = 0; k < ROWS; k++) {
      const a = v0 + k * 2;
      idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 2 ? 1 : 0)), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------- the part

/** Cave water (cave pond, Kyogre's): the palette's water colour this dark, reflecting this share of the open sky's
 *  light (no sky over it: a dark ceiling). */
const CAVE_WATER = { dark: 0.62, mirror: 0.3 };
/** The kelp: the palette's blade colour turned this far to a kelp olive (the sea floor's blades are the background's
 *  pale blue-green: in the blue haze, dark teal stalks). */
const KELP_TINT: { olive: RGB; mix: number } = { olive: [0.6, 0.64, 0.26], mix: 0.75 };
/** The islets: a warm beach sand, a tropical green crown and palms (the water kinds' palette greens are the GBA water's
 *  blue). */
const ISLET_SAND: RGB = [0.88, 0.8, 0.58], ISLET_GREEN: RGB = [0.38, 0.64, 0.3];

const PN = { position: 3, normal: 3 }, PNC = { position: 3, normal: 3, color: 3 }, PNC4 = { position: 3, normal: 3, color: 4 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

/** The water: sheets, field texture, rocks, islets, pads. */
function buildWater(ctx: ArenaContext, group: THREE.Group): void {
  const { kind, stage, palette } = ctx;
  const rocks = waterRocks(kind, stage, SCENERY_SEED);
  const islets = kind === 'water' ? isletPlacements(stage, SCENERY_SEED) : [];
  const field = waterField(kind, stage, [...rocks.flatMap((k) => k.corners), ...islets.flatMap((k) => k.corners)]);
  const tex = new THREE.DataTexture(field.data, field.w, field.h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  ctx.disposables.push(tex);
  const cave = kind === 'kyogre' || kind === 'cavePond';
  const options = arenaWaterMaterial(tex, new THREE.Vector2(field.min[0], field.min[1]), new THREE.Vector2(field.w, field.h),
    cave ? scale(palette.water, CAVE_WATER.dark) : palette.water, ctx.look.clouds, cave ? CAVE_WATER.mirror : 1);
  const sheets = waterSheets(kind, stage);
  const deep = new THREE.Mesh(sheets.deep, kitMaterial(ctx.uniforms, opaqueWater(options)).material);
  deep.name = 'waterSheet';
  deep.renderOrder = WATER_RENDER_ORDER;
  deep.receiveShadow = true;
  group.add(deep);
  if (sheets.rim) {
    const rim = new THREE.Mesh(sheets.rim, kitMaterial(ctx.uniforms, options).material);
    rim.name = 'waterShallows';
    rim.renderOrder = WATER_RENDER_ORDER;
    rim.receiveShadow = true;
    group.add(rim);
  }

  // rocks and islets: one draw (the cliff material, faceted), casting
  const parts: THREE.BufferGeometry[] = [];
  for (const k of rocks) {
    parts.push(boulderGeometry(k.seed, k.size, palette.rock).translate(k.x, WATER_Y - ROCK_SINK * k.size, k.z));
  }
  for (const k of islets) {
    // a few stones round its shore
    const rr = rng(k.seed);
    for (let s = 0; s < 3; s++) {
      const a = rr() * Math.PI * 2, d = k.size * (0.44 + 0.06 * rr());
      parts.push(boulderGeometry(k.seed + s + 1, 0.6 + 0.5 * rr(), palette.rock)
        .translate(k.x + Math.cos(a) * d, WATER_Y - 0.15, k.z + Math.sin(a) * d * ISLET_DEPTH));
    }
  }
  if (parts.length) {
    const g = mergeGeometries(parts)!;
    for (const x of parts) x.dispose();
    g.computeBoundingSphere();
    const material = kitMaterial(ctx.uniforms, CLIFF_MATERIAL).material;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'waterRocks';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // (warm stone moonlit at night as the arenas' rocks: rocks.ts)
    moonlitAsGround(mesh, material, toLinear(palette.rock), ctx.uniforms.uNight);
    group.add(mesh);
  }
  if (islets.length) {
    const domes = islets.map((k) => isletGeometry(k.seed, k.size, k.height, ISLET_SAND, ISLET_GREEN).translate(k.x, WATER_Y, k.z));
    const g = mergeGeometries(domes)!;
    for (const x of domes) x.dispose();
    g.computeBoundingSphere();
    const material = kitMaterial(ctx.uniforms, SOIL_MATERIAL).material;
    const mesh = new THREE.Mesh(g, material);
    mesh.name = 'islets';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    // (their sand moonlit at night as the arenas' warm ground: its grass crown turns with it, a little bluer)
    moonlitAsGround(mesh, material, toLinear(ISLET_SAND), ctx.uniforms.uNight);
    group.add(mesh);
  }
  const palms = islets.flatMap((k) => k.palms);
  if (palms.length) {
    const km = kitMaterial(ctx.uniforms, arenaTreeMaterial('palm', new THREE.Color(...toLinear(palette.trunk))));
    const mesh = new THREE.InstancedMesh(treeGeometry('palm', 0, treeCrownDetail('palm', ctx.quality)), km.material, palms.length);
    applyKitMaterial(mesh, km);
    const leaf = toLinear(ISLET_GREEN);
    palms.forEach((p, i) => {
      _q.setFromAxisAngle(_up, p.yaw);
      _m.compose(_p.set(p.x, p.y - p.sink, p.z), _q, _s.set(p.scale * PALM.wide, p.scale * PALM.squat, p.scale * PALM.wide));
      mesh.setMatrixAt(i, _m);
      mesh.setColorAt(i, _c.setRGB(leaf[0] * p.shade, leaf[1] * p.shade, leaf[2] * p.shade));
    });
    mesh.name = 'isletPalms';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }

  // the pond's small lily pads: one draw (the soil material, the platforms' pads' colour)
  if (kind === 'pond') {
    const pads = padPlacements(stage, SCENERY_SEED).map((p) =>
      lilyPadGeometry(p.seed, p.r, scale(palette.platformTop, 0.88 + 0.2 * ((p.seed % 97) / 97))).translate(p.x, WATER_Y, p.z));
    if (pads.length) {
      const g = mergeGeometries(pads)!;
      for (const x of pads) x.dispose();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, kitMaterial(ctx.uniforms, SOIL_MATERIAL).material);
      mesh.name = 'lilyPads';
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
}

/** The sea floor: kelp, boulders, light shafts. */
function buildSeaFloor(ctx: ArenaContext, group: THREE.Group): void {
  const { stage, palette } = ctx;
  const kelp = kelpPlacements(stage, SCENERY_SEED);
  if (kelp.length) {
    const km = kitMaterial(ctx.uniforms, { ...GRASS_MATERIAL, ...KELP_SWAY });
    for (let v = 0; v < KELP_VARIANTS; v++) {
      const mine = kelp.filter((k) => k.variant === v);
      if (!mine.length) continue;
      const mesh = new THREE.InstancedMesh(kelpGeometry(v + 1, mix(palette.blade, KELP_TINT.olive, KELP_TINT.mix)), km.material, mine.length);
      applyKitMaterial(mesh, km);
      mine.forEach((k, i) => {
        _q.setFromAxisAngle(_up, k.yaw);
        _m.compose(_p.set(k.x, groundHeight('underwater', k.x, k.z, stage) - 0.05, k.z), _q, _s.setScalar(k.scale));
        mesh.setMatrixAt(i, _m);
        mesh.setColorAt(i, _c.setRGB(k.shade, k.shade, k.shade));
      });
      mesh.name = `kelp:${v}`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
  }
  const rocks = seaFloorRocks(stage, SCENERY_SEED);
  if (rocks.length) {
    const stone = mix(palette.rock, [0.56, 0.56, 0.52], 0.5);
    const parts = rocks.map((k) => rockCluster(k.seeds, k.size, stone, palette.blade)
      .translate(k.x, groundHeight('underwater', k.x, k.z, stage) - 0.06 * k.size, k.z));
    const g = mergeGeometries(parts)!;
    for (const x of parts) x.dispose();
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, kitMaterial(ctx.uniforms, CLIFF_MATERIAL).material);
    mesh.name = 'seaFloorRocks';
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  const shafts = shaftGeometry(stage, SCENERY_SEED);
  if (shafts) {
    const mesh = new THREE.Mesh(shafts, kitMaterial(ctx.uniforms, shaftMaterial(new THREE.Color(...toLinear(SHAFTS.light)), SHAFTS.alpha)).material);
    mesh.name = 'lightShafts';
    group.add(mesh);
  }
}

export const WATER_PART: ArenaPart = {
  name: 'water',
  kinds: ['water', 'pond', 'cavePond', 'kyogre', 'underwater'],
  catalogue(ph): readonly CatalogueEntry[] {
    const water = arenaWaterMaterial(ph(), new THREE.Vector2(), new THREE.Vector2(1, 1), [0, 0, 0]);
    return [
      // (the deep water, opaque; a pond's shallow rim, transparent)
      { material: opaqueWater(water), mesh: 'mesh', attrs: PN, castShadow: false },
      { material: water, mesh: 'mesh', attrs: PN, castShadow: false },
      // (the pond's small lily pads; the sea's islets)
      { material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: false },
      { material: SOIL_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: GRASS_MATERIAL, mesh: 'instancedColors', attrs: PNC, castShadow: false },
      { material: CLIFF_MATERIAL, mesh: 'mesh', attrs: PNC, castShadow: true },
      { material: arenaTreeMaterial('palm', new THREE.Color()), mesh: 'instancedColors', attrs: PNC4, castShadow: true },
      { material: shaftMaterial(new THREE.Color(), 0), mesh: 'mesh', attrs: PNC, castShadow: false },
    ];
  },
  build(ctx) {
    const group = new THREE.Group();
    if (ctx.kind === 'underwater') buildSeaFloor(ctx, group);
    else buildWater(ctx, group);
    return group;
  },
};

