// Water: a glossy surface per water cell at its level, tinted from the ROM water colour and
// darkening with distance from shore; animated foam along shores, layered moving normals,
// fresnel sky reflection, a sandy seabed visible in the shallows, streaks on waterfalls.
// Sea rocks (which the analysis lays flat as water) become small boulders with a foam collar.

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { K, WATER_BEHAVIORS, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, CLAIM_WATER_UNDER, type Claims } from '../overworld/claims';
import { attrBehavior } from '../../game/rom/tileset';
import { classifyGroundColor, countPixels, dominantColor, luma, toLinear, type RGB } from './palette';
import { hashCell } from './geom';
import { kitMaterial, type KitMaterialOptions } from './materials';
import { isSecretBaseSpot, type Family, type KitContext, type SemanticContext } from './semantics';

const isWaterColor = (c: RGB) => classifyGroundColor(c) === 'water';

export interface WaterCell { i: number; level: number; fall: boolean }
export interface WaterPlacement {
  cells: WaterCell[];
  dist: Uint8Array;
  tint: RGB;
  /** Sea rocks, packed (x, y, level): centred on grid corner (x, y). */
  rocks: number[];
  /** sRGB stone colour of the rocks. */
  rockTint: RGB;
}

/** Bottom row of the General tileset's 2x2 sea rock (left, right; plain and edge variants). */
const ROCK_BL = new Set([0x158, 0x16c]);
const ROCK_BR = new Set([0x159, 0x16d]);

/** Multi-source BFS from land: 0 on land, 1 for water touching land, … capped at 15. `wet` cells
 *  count as water whatever their kind (blocks standing in the water). */
export function shoreDistance(a: MapAnalysis, wet?: Uint8Array): Uint8Array {
  const W = a.GW, H = a.GH;
  const dist = new Uint8Array(a.N).fill(255);
  const queue = new Int32Array(a.N);
  let head = 0, tail = 0;
  for (let i = 0; i < a.N; i++) if (a.kind[i] !== K.Water && !wet?.[i]) { dist[i] = 0; queue[tail++] = i; }
  while (head < tail) {
    const c = queue[head++];
    const col = c % W, row = (c - col) / W;
    const d = Math.min(15, dist[c] + 1);
    // 4-neighbours in grid-index space (i = row * W + col)
    if (col + 1 < W && dist[c + 1] === 255) { dist[c + 1] = d; queue[tail++] = c + 1; }
    if (col > 0 && dist[c - 1] === 255) { dist[c - 1] = d; queue[tail++] = c - 1; }
    if (row + 1 < H && dist[c + W] === 255) { dist[c + W] = d; queue[tail++] = c + W; }
    if (row > 0 && dist[c - W] === 255) { dist[c - W] = d; queue[tail++] = c - W; }
  }
  for (let i = 0; i < a.N; i++) if (dist[i] === 255) dist[i] = 15; // all-water maps
  return dist;
}

const FRAG_HEAD = /* glsl */ `
uniform sampler2D tWater;
uniform vec2 uGridMin;
uniform vec2 uGridSize;
uniform vec3 uTint;
`;

// tWater, sampled bilinearly between cell centres so every field is seamless: r = shore distance
// / 15 (0.5 at the shoreline itself), g = waterfall, b = splash pool below a waterfall; a (fetched
// per texel) = a sea rock centred on the cell's north-west corner.
// Most water is open sea: the shore foam's noise, the rocks' four fetches, the waterfall streaks and
// the pools' fbm each run only where they can show (coherent branches; the same result).
const FRAG_COLOR = /* glsl */ `
float kitFoam = 0.0;
{
  vec2 cell = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y);       // un-project to grid space
  vec4 wd = texture(tWater, (cell - uGridMin) / uGridSize);
  float dist = wd.r * 15.0;
  float deep = smoothstep(0.8, 4.5, dist);
  vec3 tint = kitSrgbToLinear(uTint);
  vec3 shallow = mix(tint, vec3(0.0, 0.55, 0.62), 0.6);            // light turquoise near shore
  vec3 col = mix(shallow, tint * vec3(0.28, 0.6, 0.55), deep);      // deeper, darker offshore
  float edge = dist - 0.5;                                          // cells from the shoreline
  // a sea rock on one of the cell's corners: their four texels, in one bilinear fetch at their middle
  bool rockNear = texture(tWater, (floor(cell) + 1.0 - uGridMin) / uGridSize).a > 0.1;
  // (the foam lines reach < 0.65 cells from the shoreline: w + 0.05 < 0.21, the laps 0.6 + 0.045)
  if (edge < 0.7 || rockNear || wd.b > 0.0) {
    float n1 = kitNoise2(cell * 2.3 + vec2(uTime * 0.25, -uTime * 0.18));
    float n2 = kitNoise2(cell * 6.1 - vec2(uTime * 0.4, uTime * 0.3));
    if (edge < 0.7) {
      // Foam: a frayed line hugging the shore, and broken lines lapping in towards it.
      float w = 0.04 + 0.1 * n1 + 0.02 * sin(uTime * 1.3 + cell.x * 0.8 + cell.y * 0.6);
      float line = (1.0 - smoothstep(w, w + 0.05, edge)) * smoothstep(0.2, 0.5, n2 + 0.3 * n1);
      float ph = fract(uTime * 0.2 + n1 * 0.45);
      float lap = (1.0 - smoothstep(0.015, 0.045, abs(edge - mix(0.6, w + 0.05, ph)))) * smoothstep(0.4, 0.65, n2) * (1.0 - ph);
      kitFoam = max(line * 0.95, lap * 0.7);
    }
    if (rockNear) {
      // Sea rocks: a foam collar where the rock meets the water and small rings spreading from it.
      float rd = 9.0;
      for (int k = 0; k < 4; k++) {
        vec2 c = floor(cell) + vec2(float(k & 1), float(k >> 1));
        ivec2 t = clamp(ivec2(c - uGridMin), ivec2(0), ivec2(uGridSize) - 1);
        if (texelFetch(tWater, t, 0).a > 0.5) rd = min(rd, length(cell - c - vec2(0.0, 0.15)));
      }
      float rph = fract(uTime * 0.3 + n1 * 0.35);
      float collar = 1.0 - smoothstep(0.4 + 0.08 * n1, 0.47 + 0.1 * n1, rd);
      float ring = (1.0 - smoothstep(0.015, 0.05, abs(rd - 0.45 - 0.4 * rph))) * smoothstep(0.35, 0.6, n2) * (1.0 - rph);
      kitFoam = max(kitFoam, max(collar * 0.9, ring * 0.7));
    }
    if (wd.b > 0.0) {
      // the churning pool below a waterfall
      float churn = smoothstep(0.5, 0.7, kitFbm2(cell * 2.6 + vec2(0.3 * n1, -uTime * 1.1)));
      kitFoam = max(kitFoam, wd.b * churn * 0.75);
    }
  }
  if (wd.g > 0.0) {
    // Waterfalls: paler water streaming south in bright streaks.
    float s1 = kitNoise2(vec2(cell.x * 9.0, cell.y * 0.7 - uTime * 2.8));
    float s2 = kitNoise2(vec2(cell.x * 17.0 + 3.1, cell.y * 1.3 - uTime * 4.1));
    float streak = smoothstep(0.45, 0.75, s1 * 0.65 + s2 * 0.35);
    col = mix(col, vec3(0.3, 0.6, 0.85), wd.g * 0.5);
    kitFoam = max(kitFoam, wd.g * (0.2 + 0.75 * streak));
  }
  diffuseColor.rgb = mix(col, vec3(0.92, 0.96, 1.0), kitFoam);
  // See-through only in the shallows: opaque before the seabed (dist <= 2 cells) ends.
  diffuseColor.a = max(mix(0.5, 1.0, smoothstep(0.5, 2.0, dist)), kitFoam);
}
`;

const FRAG_NORMAL = /* glsl */ `
{
  vec2 q = mat2(0.8, -0.6, 0.6, 0.8) * vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y) * 2.2;
  vec2 o1 = vec2(uTime * 0.25, uTime * 0.18), o2 = vec2(-uTime * 0.2, uTime * 0.31);
  float e = 0.06;
  float h0 = kitNoise2(q + o1) + 0.5 * kitNoise2(q * 2.3 + o2);
  float hx = kitNoise2(q + vec2(e, 0.0) + o1) + 0.5 * kitNoise2((q + vec2(e, 0.0)) * 2.3 + o2);
  float hz = kitNoise2(q + vec2(0.0, e) + o1) + 0.5 * kitNoise2((q + vec2(0.0, e)) * 2.3 + o2);
  vec3 nW = normalize(vec3(-(hx - h0) / e * 0.12, 1.0, -(hz - h0) / e * 0.12));
  normal = normalize((viewMatrix * vec4(nW, 0.0)).xyz);
}
`;

// Sky reflection (brighter towards the horizon, by fresnel) plus glints on the wave facets that
// tilt slightly towards the camera (a sky highlight, so it shows from every camera angle); both
// scale with the sky light, so night water keeps only a faint sheen.
const FRAG_EMISSIVE = /* glsl */ `
{
  vec3 vW = inverseTransformDirection(normalize(vViewPosition), viewMatrix);
  vec3 nW = inverseTransformDirection(normal, viewMatrix);
  vec3 rW = reflect(-vW, nW);
  float fres = pow(1.0 - clamp(dot(nW, vW), 0.0, 1.0), 3.0);
  float hor = 1.0 - clamp(rW.y, 0.0, 1.0);
  vec3 sky = uSky * (0.4 + 1.2 * hor * hor);
  vec3 hW = normalize(vec3(0.0, 1.0, 0.0) + 0.16 * normalize(vec3(vW.x, 0.0, vW.z) + 1e-5));
  float glint = pow(max(dot(nW, hW), 0.0), 2500.0);
  totalEmissiveRadiance += (sky * (0.06 + 1.1 * fres) + uSky * glint * 0.8) * (1.0 - kitFoam);
}
`;

const VERT_SWELL = /* glsl */ `
{
  vec3 wq = (modelMatrix * vec4(transformed, 1.0)).xyz;
  transformed.y += sin(wq.x * 1.3 + uTime * 1.6) * 0.025 + cos(wq.z * 1.1 + uTime * 1.2) * 0.025;
}
`;

// Light caustics drifting over the seabed.
const BED_COLOR = /* glsl */ `
{
  vec2 p = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y) * 1.7;
  float c1 = kitVoronoi(p + vec2(uTime * 0.12, uTime * 0.07)).x;
  float c2 = kitVoronoi(p * 1.3 - vec2(uTime * 0.09, -uTime * 0.11) + 3.1).x;
  float caus = (1.0 - smoothstep(0.0, 0.1, c1)) * 0.6 + (1.0 - smoothstep(0.0, 0.08, c2)) * 0.4;
  diffuseColor.rgb *= 0.92 + 0.3 * caus;
}
`;

const BED_DEPTH = 0.25;
/** Seabed quads overlap their neighbours a little so no sliver of the base plane shows at shores. */
const BED_PAD = 0.12;
/** Rock size (half extents) and its offset south of the 2x2 block centre (matches the art). */
const ROCK_R = 0.42, ROCK_H = 0.4, ROCK_DZ = 0.15;
/** Fallback sRGB colours of the water and its rocks. */
const WATER_TINT: RGB = [0.32, 0.42, 0.84];
const ROCK_TINT: RGB = [0.6, 0.6, 0.62];

/** Writes an upward-facing quad [x0,x1] x [z0,z1] at height h as two CCW triangles. */
function upQuad(pos: Float32Array, o: number, x0: number, x1: number, z0: number, z1: number, h: number): number {
  pos[o] = x0; pos[o + 1] = h; pos[o + 2] = z0;
  pos[o + 3] = x1; pos[o + 4] = h; pos[o + 5] = z1;
  pos[o + 6] = x1; pos[o + 7] = h; pos[o + 8] = z0;
  pos[o + 9] = x0; pos[o + 10] = h; pos[o + 11] = z0;
  pos[o + 12] = x0; pos[o + 13] = h; pos[o + 14] = z1;
  pos[o + 15] = x1; pos[o + 16] = h; pos[o + 17] = z1;
  return o + 18;
}

/** Geometry of upward quads; `bounds` is a sphere known to contain them (saves a pass over the vertices). */
function upGeometry(pos: Float32Array, bounds: THREE.Sphere): THREE.BufferGeometry {
  const nor = new Float32Array(pos.length);
  for (let k = 1; k < nor.length; k += 3) nor[k] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.boundingSphere = bounds;
  return g;
}

/** Faceted, lumpy boulders (one icosphere each), wet and darker towards the waterline. */
function rockGeometry(rocks: number[], tint: RGB): THREE.BufferGeometry {
  const u = unitIcosphere();
  const count = rocks.length / 3;
  const pos = new Float32Array(count * u.length);
  const nor = new Float32Array(count * u.length);
  const col = new Float32Array(count * u.length);
  const base = toLinear(tint);
  let o = 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let r = 0; r < rocks.length; r += 3) {
    const cx = rocks[r], cy = rocks[r + 1], h = rocks[r + 2];
    const seed = hashCell(cx, cy, 0x5ea);
    const yaw = (seed % 628) / 100;
    const s1 = (seed & 1023) / 163, s2 = ((seed >>> 10) & 1023) / 163, s3 = ((seed >>> 20) & 1023) / 163;
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const cz = cy + h + ROCK_DZ;
    x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, h); y1 = Math.max(y1, h); z0 = Math.min(z0, cz); z1 = Math.max(z1, cz);
    for (let v = 0; v < u.length; v += 3) {
      const ux = u[v], uy = u[v + 1], uz = u[v + 2];
      // lumpy, a function of the corner position: shared corners move together, facets stay closed
      const k = 1 + 0.13 * Math.sin(3.1 * ux + s1) * Math.sin(2.7 * uz + s2) + 0.09 * Math.sin(2.3 * uy + 3.7 * ux + s3);
      const lx = ux * k * ROCK_R, lz = uz * k * ROCK_R;
      const ly = uy * k * ROCK_H;
      pos[o] = cx + lx * cs - lz * sn;
      pos[o + 1] = h - 0.05 + ly;
      pos[o + 2] = cz + lx * sn + lz * cs;
      const shade = 0.6 + 0.5 * Math.min(1, Math.max(0, (ly + 0.12) / (ROCK_H + 0.12)));
      col[o] = base[0] * shade; col[o + 1] = base[1] * shade; col[o + 2] = base[2] * shade;
      o += 3;
      if (v % 9 === 6) faceNormal(pos, nor, o - 9); // a triangle is complete: flat, faceted stone
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const c = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  g.boundingSphere = new THREE.Sphere(c, Math.hypot(x1 - x0, y1 - y0, z1 - z0) / 2 + 1);
  return g;
}

let icosphere: Float32Array | null = null;
/** Positions of a unit icosphere (detail 1, non-indexed), built once. */
function unitIcosphere(): Float32Array {
  if (!icosphere) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    icosphere = (g.getAttribute('position').array as Float32Array).slice();
    g.dispose();
  }
  return icosphere;
}

/** Writes the normal of triangle (o, o+3, o+6) to its three vertices. */
function faceNormal(pos: Float32Array, nor: Float32Array, o: number): void {
  const ax = pos[o + 3] - pos[o], ay = pos[o + 4] - pos[o + 1], az = pos[o + 5] - pos[o + 2];
  const bx = pos[o + 6] - pos[o], by = pos[o + 7] - pos[o + 1], bz = pos[o + 8] - pos[o + 2];
  let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l; ny /= l; nz /= l;
  for (let k = 0; k < 9; k += 3) { nor[o + k] = nx; nor[o + k + 1] = ny; nor[o + k + 2] = nz; }
}

// The water family's materials: their only definitions (the program catalogue, kit/catalogue.ts, precompiles each).
/** The water sheet (`tex`: its cells, over the grid from `gridMin`, `gridSize` cells; `tint`: the water's colour). One
 *  non-overlapping sheet drawn after every opaque object (seabed, rocks, legacy cells test against it as usual), so it
 *  need not write depth; if it did, the swell (up to +0.05) would hide blob shadows and decals lying just above the
 *  water level. */
export function waterMaterial(tex: THREE.Texture, gridMin: THREE.Vector2, gridSize: THREE.Vector2, tint: THREE.Vector3): KitMaterialOptions {
  return {
    roughness: 0.12,
    transparent: true,
    depthWrite: false,
    uniforms: { tWater: { value: tex }, uGridMin: { value: gridMin }, uGridSize: { value: gridSize }, uTint: { value: tint } },
    fragHead: FRAG_HEAD,
    fragColor: FRAG_COLOR,
    fragNormal: FRAG_NORMAL,
    fragEmissive: FRAG_EMISSIVE,
    vertTransform: VERT_SWELL,
    hookKey: 'water',
  };
}
export const SEABED_MATERIAL: KitMaterialOptions = {
  color: new THREE.Color().setRGB(0.74, 0.66, 0.47, THREE.SRGBColorSpace),
  roughness: 1,
  fragColor: BED_COLOR,
  hookKey: 'seabed',
};
export const WATER_ROCK_MATERIAL: KitMaterialOptions = { vertexColors: true, roughness: 0.75 };

export const waterFamily: Family<WaterPlacement> = {
  name: 'water',

  extract({ a }: SemanticContext, claims: Claims): WaterPlacement {
    const W = a.GW;
    const cells: WaterCell[] = [];
    const rocks: number[] = [];
    // A Dive map is all underwater: its "water" cells are the seabed, so it has no surface to draw
    // (they keep their legacy art).
    if (a.opts.underwater) return { cells, dist: new Uint8Array(0), tint: WATER_TINT, rocks, rockTint: ROCK_TINT };
    // Sea rocks: found by their bottom-left metatile, centred on its north-east corner; their four
    // cells become water under the boulder. A rock is taken only if all four cells can be claimed
    // (water, no overhang, unclaimed); otherwise its cells follow the rules below like any other.
    const claimable = (j: number) => a.kind[j] === K.Water && !a.hasTop(j) && !claims.has(j, CLAIM_SURFACE) && !isSecretBaseSpot(a, j);
    const rockCell = new Uint8Array(a.N);
    for (let i = W; i < a.N - 1; i++) {
      const m = a.mt[i];
      if (!a.isGeneralId(m) || !ROCK_BL.has(m) || (i + 1) % W === 0 || !ROCK_BR.has(a.mt[i + 1])) continue;
      if (!claimable(i) || !claimable(i + 1) || !claimable(i - W) || !claimable(i + 1 - W)) continue;
      rocks.push(a.cellX(i) + 1, a.cellY(i), a.height[i]);
      rockCell[i] = rockCell[i + 1] = rockCell[i - W] = rockCell[i + 1 - W] = 1;
    }
    const counts = new Uint32Array(1024); // cells per metatile id
    for (let i = 0; i < a.N; i++) {
      // Overhangs drawn over water (bridge decks, roof eaves, canopy edges) keep their legacy art,
      // and so do objects the analysis laid flat on the water (boats, buoys, bank edges: blocked,
      // not water by behaviour, with top-layer art) unless they are a sea rock.
      // (nor a secret-base spot: it keeps its legacy art)
      if (a.kind[i] !== K.Water || a.hasTop(i) || claims.has(i, CLAIM_SURFACE) || isSecretBaseSpot(a, i)) continue;
      const m = a.mt[i];
      if (!rockCell[i] && a.info.topCover[m] > 0 && !WATER_BEHAVIORS.has(a.beh[i])) continue;
      cells.push({ i, level: a.height[i], fall: a.beh[i] === MB.WATERFALL });
      counts[m]++;
      claims.claim(i, CLAIM_SURFACE);
    }
    // The art left to the legacy emitter on the water (overhangs, boats, bank edges, rocks and other
    // blocks standing in it): the water runs on under it, and the legacy draws it without its own
    // pixel water (CLAIM_WATER_UNDER). A block stands in the water when the ground behind it (the
    // analysis' groundOf, the floor the legacy laid under it) is water, and no family modelled it:
    // water by behaviour, or drawn mostly in water colours (a boat's or sea rock's tile the analysis
    // laid flat as water).
    const waterTiles = new Map<number, boolean>();
    const waterGround = (g: number) => {
      let w = waterTiles.get(g);
      if (w === undefined) {
        w = WATER_BEHAVIORS.has(attrBehavior(a.info.attributes[g])) || countPixels(a.info.both, [g], isWaterColor) >= 128;
        waterTiles.set(g, w);
      }
      return w;
    };
    const wet = new Uint8Array(a.N);
    for (let i = 0; i < a.N; i++) {
      if (claims.has(i, CLAIM_SURFACE) || isSecretBaseSpot(a, i)) continue;
      const k = a.kind[i], g = a.groundOf[i];
      const block = k === K.Block && !claims.has(i, CLAIM_OBJECT) && g >= 0 && waterGround(g);
      if (k !== K.Water && !block) continue;
      cells.push({ i, level: k === K.Water ? a.height[i] : a.groundH[i], fall: false });
      claims.claim(i, CLAIM_WATER_UNDER);
      if (block) wet[i] = 1;
    }
    let common = -1, best = 0;
    for (let m = 0; m < counts.length; m++) if (counts[m] > best) { best = counts[m]; common = m; }
    const tint = (common >= 0 ? dominantColor(a.info.bottom, [common]) : null) ?? WATER_TINT;
    let rockTint = ROCK_TINT;
    if (rocks.length) {
      const stone = (c: RGB) => c[2] < c[0] + 0.15 && luma(c) >= 0.45; // the lit stone, not water or shade
      rockTint = dominantColor(a.info.both, [...ROCK_BL, ...ROCK_BR], stone) ?? rockTint;
    }
    return { cells, dist: cells.length ? shoreDistance(a, wet) : new Uint8Array(0), tint, rocks, rockTint };
  },

  build(p: WaterPlacement, { a }: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p.cells.length) return null;
    const W = a.GW;
    const data = new Uint8Array(a.N * 4);
    for (let i = 0; i < a.N; i++) data[i * 4] = Math.round((p.dist[i] / 15) * 255);
    let beds = 0;
    for (const c of p.cells) {
      if (p.dist[c.i] <= 2) beds++;
      if (!c.fall) continue;
      data[c.i * 4 + 1] = 255;
      // splash pool: the two water cells below (south of) the fall
      for (let k = 1, j = c.i + W; k <= 2 && j < a.N; k++, j += W) {
        if (a.kind[j] === K.Water) data[j * 4 + 2] = Math.max(data[j * 4 + 2], k === 1 ? 255 : 150);
      }
    }
    for (let r = 0; r < p.rocks.length; r += 3) data[a.idx(p.rocks[r], p.rocks[r + 1]) * 4 + 3] = 255;
    const tex = new THREE.DataTexture(data, a.GW, a.GH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    kit.disposables.push(tex);

    // Surface at the water level; seabed below the shallows, un-projected at its own height so it
    // sits under its cell from the default camera.
    const surf = new Float32Array(p.cells.length * 18);
    const bed = new Float32Array(beds * 18);
    let o = 0, ob = 0, lo = Infinity, hi = -Infinity;
    for (const c of p.cells) {
      const x = a.cellX(c.i), y = a.cellY(c.i), h = c.level;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
      o = upQuad(surf, o, x, x + 1, y + h, y + 1 + h, h);
      if (p.dist[c.i] <= 2) {
        const b = h - BED_DEPTH;
        ob = upQuad(bed, ob, x - BED_PAD, x + 1 + BED_PAD, y + b - BED_PAD, y + 1 + b + BED_PAD, b);
      }
    }
    const mid = (lo + hi) / 2 - BED_DEPTH / 2;
    const bounds = new THREE.Sphere(new THREE.Vector3((a.minX + a.maxX) / 2, mid, (a.minY + a.maxY) / 2 + mid),
      Math.hypot(a.GW, a.GH + hi - lo, hi - lo) / 2 + 1);
    const group = new THREE.Group();
    const km = kitMaterial(kit.uniforms, waterMaterial(tex, new THREE.Vector2(a.minX, a.minY), new THREE.Vector2(a.GW, a.GH),
      new THREE.Vector3(...p.tint)));
    const water = new THREE.Mesh(upGeometry(surf, bounds), km.material);
    water.receiveShadow = true;
    // First among transparent objects: blob shadows, weather and effects draw over the water.
    water.renderOrder = -1;
    group.add(water);
    if (beds) {
      const bm = kitMaterial(kit.uniforms, SEABED_MATERIAL);
      const bedMesh = new THREE.Mesh(upGeometry(bed, bounds.clone()), bm.material);
      bedMesh.receiveShadow = true;
      group.add(bedMesh);
    }
    if (p.rocks.length) {
      const rm = kitMaterial(kit.uniforms, WATER_ROCK_MATERIAL);
      const rockMesh = new THREE.Mesh(rockGeometry(p.rocks, p.rockTint), rm.material);
      rockMesh.castShadow = true;
      rockMesh.receiveShadow = true;
      group.add(rockMesh);
    }
    return group;
  },
};
