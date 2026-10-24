// Ground: one continuous surface over walkable cells and under every claimed object, shaded by
// a procedural material per cell and tinted with the cell's own ROM colour. Material borders
// are noise-warped so the GBA's grid-aligned paths read as organic shapes. Banks between
// heights are the same surface, drawn steep (soil).

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { attrBehavior, attrLayerType, LayerType } from '../../game/rom/tileset';
import { DOOR_BEHAVIORS, K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_BANKS, CLAIM_DECOR, CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../overworld/claims';
import type { TileInfo } from '../overworld/tileInfo';
import { bgr555ToSrgb, classifyGroundColor, countPixels, dominantColor, luma, scale, wetGround, type GroundClass, type RGB } from './palette';
import { bladeColor, GRASS_BEHAVIORS } from './grass';
import { isPetal } from './flowers';
import { kitMaterial, type KitMaterialOptions } from './materials';
import { isSecretBaseSpot, type Family, type SemanticContext, type KitContext } from './semantics';
import { SECONDARY_KEEP_LEGACY } from './tables/secondary';

export const enum GroundMat { Grass = 0, Path = 1, Sand = 2, Paving = 3, Dirt = 4, Gravel = 5, Rock = 6, Deck = 7, Dark = 8 }

/** Walkable ground in water colours is wet: shallows, puddles, hot springs (tinted by `wetGround`). */
const CLASS_MAT: Record<GroundClass, GroundMat> = {
  grass: GroundMat.Grass, path: GroundMat.Path, sand: GroundMat.Sand, paving: GroundMat.Paving,
  dirt: GroundMat.Dirt, gravel: GroundMat.Gravel, rock: GroundMat.Rock, water: GroundMat.Sand, dark: GroundMat.Dark,
};

/** Ground material from the behaviour first, then the tile's dominant colour. */
export function groundMaterial(beh: number, c: RGB): GroundMat {
  switch (beh) {
    case MB.SAND: case MB.DEEP_SAND: case MB.FOOTPRINTS: case MB.SHALLOW_WATER: return GroundMat.Sand;
    case MB.ASHGRASS: return GroundMat.Gravel;
    case MB.MOUNTAIN_TOP: case MB.CAVE: return GroundMat.Rock;
    case MB.TALL_GRASS: case MB.LONG_GRASS: case MB.LONG_GRASS_SOUTH_EDGE: case MB.SHORT_GRASS: return GroundMat.Grass;
    case MB.PUDDLE: return GroundMat.Dirt;
  }
  if (beh >= MB.BRIDGE_OVER_OCEAN && beh <= MB.BIKE_BRIDGE_OVER_BARRIER) return GroundMat.Deck;
  return CLASS_MAT[classifyGroundColor(c)];
}

export interface CellLook { mat: GroundMat; tint: RGB }

/** Outlines and shadows are never the ground's own colour. */
const lit = (c: RGB) => luma(c) >= 0.33;
const isWater = (c: RGB) => classifyGroundColor(c) === 'water';
/** Nor is water, on land: terrain cells are walkable, so water in their tiles is the sea beside a
 *  shore tile, or a backdrop that an overhang's or a covered top layer's art hides. A Dive map's
 *  seabed is drawn in water colours, though: there they are the ground's own. */
const isGround = (c: RGB) => lit(c) && !isWater(c);
/** A layer shows ground when a quarter of it is ground-coloured: a grass fringe on a puddle tile
 *  or a rock tip in the sea does not make the cell dry land. */
const MIN_GROUND_PX = 64;
const groundColor = (px: Uint16Array, m: number, accept: (c: RGB) => boolean) =>
  countPixels(px, [m], accept) >= MIN_GROUND_PX ? dominantColor(px, [m], accept) : null;
const anyColor = (px: Uint16Array, m: number) => dominantColor(px, [m], lit) ?? dominantColor(px, [m]);

/** A COVERED tile's top layer is the floor the player sees where it paints at least half of the tile. */
export const TOP_FLOOR_PX = 128;
/** Pixels of metatile `m` that its top layer paints over the bottom layer in another colour. */
function topFloorPixels(info: TileInfo, m: number): number {
  let n = 0;
  for (let p = m * 256, end = p + 256; p < end; p++) {
    const v = info.both[p];
    if (!(v & 0x8000) && v !== info.bottom[p]) n++;
  }
  return n;
}
const isLedge = (beh: number) => beh >= MB.JUMP_EAST && beh <= MB.JUMP_SOUTHWEST;

/** Material + dominant (sRGB) colour of the floor a metatile shows (the terrain's look), cached per metatile. */
export function cellLook(a: MapAnalysis, m: number, cache: Map<number, CellLook>): CellLook {
  return look(a, m, cache, true);
}

/**
 * Material + dominant (sRGB) colour of a metatile's ground layer, ignoring floor art a COVERED top
 * layer paints over it (cellLook takes that): what the cliffs' rules ask about a tile (is a rock tile
 * rock under its rim art; the ground a ledge stands in). Cached per metatile (its own cache).
 */
export function groundLayerLook(a: MapAnalysis, m: number, cache: Map<number, CellLook>): CellLook {
  return look(a, m, cache, false);
}

function look(a: MapAnalysis, m: number, cache: Map<number, CellLook>, topFloor: boolean): CellLook {
  let e = cache.get(m);
  if (!e) {
    const { bottom, both, attributes } = a.info;
    const land = !a.opts.underwater;
    const ground = land ? isGround : lit;
    const covered = attrLayerType(attributes[m]) === LayerType.COVERED;
    // The bottom layer is the ground (a NORMAL cell's top layer is an overhang drawn above it). A
    // COVERED cell draws its top layer on the floor too: where that paints most of the tile (Ever
    // Grande's brick path, rock tops, logs and boardwalks laid over grass or rock) it is the floor
    // the player sees. (Not a ledge: the cliffs draw its lip, the ground is the bottom layer's.)
    const floor = topFloor && land && covered && !isLedge(attrBehavior(attributes[m])) && topFloorPixels(a.info, m) >= TOP_FLOOR_PX ? both : bottom;
    let c = groundColor(floor, m, ground) ?? anyColor(floor, m) ?? anyColor(both, m) ?? [0.45, 0.7, 0.5];
    // Where the ground is water on land, a COVERED cell's top layer may hold it.
    if (land && isWater(c) && covered) c = groundColor(both, m, ground) ?? c;
    const mat = groundMaterial(attrBehavior(attributes[m]), c);
    // Bridges and walkways draw their planks on the top layer (over water or canopy).
    let tint = mat === GroundMat.Deck ? dominantColor(both, [m], ground) ?? dominantColor(both, [m], lit) ?? c : c;
    // Still water all over on land (puddles, hot springs, the sea behind an overhang): wet ground.
    if (land && isWater(tint)) tint = wetGround(tint);
    // Under tall grass the ground is the grass's own colour (the blades' roots), not the bare
    // ground the GBA shows between its drawn blades: a patch reads as one dense mass.
    if (GRASS_BEHAVIORS.has(attrBehavior(attributes[m]))) tint = bladeColor(both, m);
    e = { mat, tint };
    cache.set(m, e);
  }
  return e;
}

/** Pixels of decoration (decorationPixels) that make a walkable cell's ground art decoration the
 *  terrain leaves to the legacy art: a tenth of the tile (a flower bed's petals cover 10-25 % of it,
 *  its leaves and the grass between them are colours a terrain paints too). */
export const DECOR_MIN_PX = 24;
/** A decoration blob spans 3x3 pixels or more and has at most DECOR_EDGE of them on the tile's
 *  border; its colours are farther than DECOR_FAR (sRGB) from the tint. */
const DECOR_EDGE = 4, DECOR_FAR = 0.3;
/** Per BGR555 colour: 0 not yet known, 1 no decoration colour, 2 a vivid one (petal-like, not water). */
const VIVID = new Uint8Array(32768);

/**
 * Pixels of decoration in metatile `m`'s ground art (its bottom layer, where the top layer leaves it
 * visible) that a terrain tinted `tint` cannot paint: vivid colours (a petal's: not green, lit,
 * saturated or near white; not water) far from the tint, in compact blobs set inside the tile:
 * flower heads, an emblem's gems. Not a ground's speckles (single pixels), stripes (stair edges,
 * kerbs: a pixel high), another ground reaching into the cell (it runs along the tile's border),
 * nor art the top layer covers.
 */
export function decorationPixels(info: TileInfo, m: number, tint: RGB): number {
  const o = m * 256;
  const dec = new Uint8Array(256);
  for (let p = 0; p < 256; p++) {
    const v = info.bottom[o + p];
    if (v & 0x8000 || info.both[o + p] !== v) continue;
    let k = VIVID[v];
    if (!k) {
      const c = bgr555ToSrgb(v);
      VIVID[v] = k = isPetal(c) && !isWater(c) ? 2 : 1;
    }
    if (k === 2 && Math.hypot((v & 31) / 31 - tint[0], ((v >> 5) & 31) / 31 - tint[1], ((v >> 10) & 31) / 31 - tint[2]) > DECOR_FAR) dec[p] = 1;
  }
  const stack: number[] = [];
  let total = 0;
  for (let s = 0; s < 256; s++) {
    if (dec[s] !== 1) continue;
    dec[s] = 2;
    stack.push(s);
    let size = 0, edge = 0, x0 = 15, x1 = 0, y0 = 15, y1 = 0;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p & 15, y = p >> 4;
      size++;
      if (x === 0 || y === 0 || x === 15 || y === 15) edge++;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      if (x < 15 && dec[p + 1] === 1) { dec[p + 1] = 2; stack.push(p + 1); }
      if (x > 0 && dec[p - 1] === 1) { dec[p - 1] = 2; stack.push(p - 1); }
      if (y < 15 && dec[p + 16] === 1) { dec[p + 16] = 2; stack.push(p + 16); }
      if (y > 0 && dec[p - 16] === 1) { dec[p - 16] = 2; stack.push(p - 16); }
    }
    if (x1 - x0 >= 2 && y1 - y0 >= 2 && edge <= DECOR_EDGE) total += size;
  }
  return total;
}

/** Walkable cells that depict a structure (doorway, ladder, Fortree treehouse walkway, Acro Bike
 *  rail), not ground: they keep their legacy pixel art. */
const isStructure = (beh: number) =>
  beh === MB.NON_ANIMATED_DOOR || beh === MB.LADDER || beh === MB.NO_RUNNING || DOOR_BEHAVIORS.has(beh) ||
  (beh >= MB.ISOLATED_VERTICAL_RAIL && beh <= MB.HORIZONTAL_RAIL);

/** Triangle corner orders of a quad a-b-c-d (as MeshBuilder.quad: flipped when (b-a)x(d-a) opposes the normal). */
const UNFLIPPED = [0, 1, 2, 0, 2, 3];
const FLIPPED = [0, 2, 1, 0, 3, 2];

export interface TerrainCell { i: number; h: number; mat: GroundMat; tint: RGB }
export interface TerrainPlacement { cells: TerrainCell[] }

const FRAG_HEAD = /* glsl */ `
uniform sampler2D tCells;
uniform vec2 uGridMin;
uniform vec2 uGridSize;
vec3 kitGround(int mat, vec3 tint, vec2 p) {
  float n1 = kitFbm2(p * 1.3);
  float n2 = kitNoise2(p * 9.0);
  vec3 c = tint;
  if (mat == 0) {                 // grass: two tones in broad soft patches, fine blade speckle
    float tone = smoothstep(0.4, 0.62, kitFbm2(p * 0.45 + 5.3));
    c *= mix(vec3(0.86, 0.9, 0.94), vec3(1.14, 1.1, 0.78), tone);
    c *= 0.92 + 0.16 * n1;
    c = mix(c, c * vec3(1.1, 1.16, 0.92), smoothstep(0.6, 0.9, n2) * 0.6);
    c *= 0.93 + 0.07 * kitNoise2(p * 31.0);
  } else if (mat == 1) {          // path: the tile's lightness in warm earth, a few pebbles
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(c, vec3(1.0, 0.78, 0.5) * (l / 0.806), 0.75);
    c *= 0.92 + 0.14 * n1;
    vec2 v = kitVoronoi(p * 6.0);
    c *= 1.0 + smoothstep(0.1, 0.2, v.x) * (0.08 * step(0.87, v.y) - 0.08 * step(v.y, 0.09));
  } else if (mat == 2) {          // sand: ripples
    c *= 0.95 + 0.05 * sin((p.x * 0.6 + p.y + n1 * 1.5) * 9.0) + 0.06 * (n1 - 0.5);
  } else if (mat == 3) {          // paving: stones and grout
    vec2 v = kitVoronoi(p * 3.0);
    c *= (0.9 + 0.14 * v.y) * mix(0.62, 1.0, smoothstep(0.02, 0.07, v.x));
  } else if (mat == 4) {          // dirt
    c *= 0.82 + 0.3 * n1;
  } else if (mat == 5) {          // gravel / ash: greyed, fine grit
    c = mix(c, vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))) * vec3(1.06, 1.0, 0.9), 0.35);
    vec2 v = kitVoronoi(p * 7.0);
    c *= (0.86 + 0.2 * n1) * (0.93 + 0.14 * v.y) * mix(0.86, 1.0, smoothstep(0.02, 0.1, v.x));
  } else if (mat == 6) {          // rock floor: cracks
    vec2 v = kitVoronoi(p * 2.0);
    c *= (0.85 + 0.2 * n1) * mix(0.7, 1.0, smoothstep(0.01, 0.05, v.x));
  } else if (mat == 7) {          // deck: planks along X
    float fr = fract(p.y * 4.0);
    c *= (0.85 + 0.15 * kitNoise2(vec2(p.x * 1.5, floor(p.y * 4.0) * 7.0)));
    c *= mix(0.6, 1.0, smoothstep(0.0, 0.08, fr) * smoothstep(1.0, 0.92, fr));
  }
  return c;
}
`;

/** The terrain's border warp (GLSL: sets `vec2 warp` from `cell`, grid space): the overworld's. */
export const TERRAIN_WARP = /* glsl */ `  // Organic borders: a broad warp bends the grid's straight edges, a finer one frays them. (A grid of one cell — the
  // battle platform tops' — has no borders: every lookup clamps to its one texel, so the warp would change no pixel.)
  vec2 warp = vec2(0.0);
  if (uGridSize.x * uGridSize.y > 1.0) {
    warp = (vec2(kitFbm2(cell * 0.7), kitFbm2(cell * 0.7 + 17.3)) - 0.5) * 1.5
         + (vec2(kitNoise2(cell * 3.3), kitNoise2(cell * 3.3 + 9.1)) - 0.5) * 0.24;
  }
`;

/** The terrain's colour hook with a border warp of the caller's (the battle ground's is cheaper: arenaGroundMaterial). */
export function terrainFragColor(warp: string): string {
  return FRAG_COLOR_HEAD + warp + FRAG_COLOR_REST;
}

const FRAG_COLOR_HEAD = /* glsl */ `
{
  vec2 cell = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y);       // un-project to grid space
`;

const FRAG_COLOR_REST = /* glsl */ `  vec2 g = cell + warp - uGridMin;
  ivec2 ic = clamp(ivec2(floor(g)), ivec2(0), ivec2(uGridSize) - 1);
  int mat = int(texelFetch(tCells, ic, 0).a * 255.0 + 0.5) >> 4;
  // Tint blends only in a narrow band at cell borders: soft edges that still hold their shape.
  vec2 t = g - 0.5;
  vec3 tint = kitSrgbToLinear(texture(tCells, (floor(t) + 0.5 + smoothstep(0.3, 0.7, fract(t))) / uGridSize).rgb);
  vec3 col = kitGround(mat, tint, cell);
  // Banks (45° S slopes, vertical E faces: |n.y| <= 0.71) are all soil; tops (n.y = 1) none.
  vec3 nW = inverseTransformDirection(vNormal, viewMatrix);
  float steep = 1.0 - smoothstep(0.75, 0.95, abs(nW.y));
  // (the soil only where there is a bank: elsewhere steep is 0 and mix(col, soil, 0.0) is col — the same pixels, without
  // the soil's cell fetch and fbm on every flat fragment)
  vec3 ground = col;
  if (steep > 0.0) {
    // A bank's soil is that of the cell owning it, the higher side: bank normals point at the lower
    // cell, so step half a cell against them (unwarped, so it holds steady along the bank).
    vec2 own = cell - nW.xz / max(length(nW.xz), 1e-4) * 0.5;
    vec4 od = texelFetch(tCells, clamp(ivec2(floor(own - uGridMin)), ivec2(0), ivec2(uGridSize) - 1), 0);
    int omat = int(od.a * 255.0 + 0.5) >> 4;
    vec3 otint = kitSrgbToLinear(od.rgb);
    // Earthy soil under soft ground, a darker edge of the same stone/planks under hard ground.
    vec3 earth = (omat == 3 || omat == 6 || omat == 7) ? otint * 0.68 : mix(otint * 0.75, vec3(0.32, 0.19, 0.1), 0.75);
    vec3 soil = earth * (0.85 + 0.3 * kitFbm2(vec2(vKitWorld.x + vKitWorld.z, vKitWorld.y) * 3.0));
    ground = mix(col, soil, steep);
  }
  diffuseColor.rgb *= ground;
}
`;

const FRAG_COLOR = terrainFragColor(TERRAIN_WARP);

/** The terrain's material (`tex`: its cells' looks, over the grid from `gridMin`, `gridSize` cells): its only definition
 *  (the program catalogue, kit/catalogue.ts, precompiles it). */
export function terrainMaterial(tex: THREE.Texture, gridMin: THREE.Vector2, gridSize: THREE.Vector2): KitMaterialOptions {
  return {
    roughness: 0.95,
    uniforms: { tCells: { value: tex }, uGridMin: { value: gridMin }, uGridSize: { value: gridSize } },
    fragHead: FRAG_HEAD,
    fragColor: FRAG_COLOR,
    hookKey: 'terrain',
  };
}

export const terrainFamily: Family<TerrainPlacement> = {
  name: 'terrain',

  extract({ a }: SemanticContext, claims: Claims): TerrainPlacement {
    const cells: TerrainCell[] = [];
    const cache = new Map<number, CellLook>();
    const decor = new Map<number, boolean>();
    const decorated = (m: number) => {
      let d = decor.get(m);
      if (d === undefined) {
        d = decorationPixels(a.info, m, cellLook(a, m, cache).tint) >= DECOR_MIN_PX;
        decor.set(m, d);
      }
      return d;
    };
    // Landmarks laid in the floor (the Battle Frontier emblems) keep their legacy art.
    const keep = SECONDARY_KEEP_LEGACY.get(a.opts.secondaryTileset ?? 0);
    for (let i = 0; i < a.N; i++) {
      if (claims.has(i, CLAIM_SURFACE)) continue;
      const k = a.kind[i];
      const walk = k === K.Floor || k === K.Stairs || k === K.Ledge;
      const under = claims.has(i, CLAIM_OBJECT);
      if (!walk && !under) continue;
      if (!under && (isStructure(a.beh[i]) || isSecretBaseSpot(a, i) || (a.mt[i] >= 512 && keep?.has(a.mt[i])))) continue;
      // Ground art that is decoration no family models (a flower bed, an emblem): the terrain cannot
      // paint it, so the cell keeps its legacy pixel art. (Not ledges: the cliffs draw their lips.)
      if (!under && k !== K.Ledge && !claims.has(i, CLAIM_DECOR) && decorated(a.mt[i])) continue;
      let h: number;
      let m: number;
      let shade = 1;
      if (!under) {
        h = a.height[i];
        m = a.mt[i];
      } else {
        h = !Number.isNaN(claims.groundY[i]) ? claims.groundY[i] : walk ? a.height[i] : a.groundH[i];
        m = claims.groundMt[i] >= 0 ? claims.groundMt[i] : a.groundOf[i] >= 0 ? a.groundOf[i] : a.mt[i];
        if (k === K.Tree) shade = 0.72; // canopy shade
      }
      if (Number.isNaN(h)) h = 0;
      const look = cellLook(a, m, cache);
      cells.push({ i, h, mat: look.mat, tint: shade === 1 ? look.tint : scale(look.tint, shade) });
      claims.claim(i, CLAIM_SURFACE | CLAIM_BANKS);
    }
    return { cells };
  },

  build(p: TerrainPlacement, { a }: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!p.cells.length) return null;
    // Grid index i = row * W + col (see analyze.ts idx); loops below use that layout directly.
    const W = a.GW, H = a.GH;
    // Per-cell data: rgb = sRGB tint, a = material << 4. Uncovered texels are dilated from
    // their neighbours so bilinear tint blending never pulls in black.
    const data = new Uint8Array(W * H * 4);
    const has = new Uint8Array(a.N);
    const surfH = new Float32Array(a.N).fill(NaN);
    for (const c of p.cells) {
      const o = c.i * 4;
      data[o] = c.tint[0] * 255;
      data[o + 1] = c.tint[1] * 255;
      data[o + 2] = c.tint[2] * 255;
      data[o + 3] = (c.mat << 4) | 8;
      has[c.i] = 1;
      surfH[c.i] = c.h;
    }
    const next = new Uint8Array(a.N);
    for (let pass = 0; pass < 3; pass++) {
      next.set(has);
      for (let i = 0; i < a.N; i++) {
        if (has[i]) continue;
        const col = i % W, row = (i - col) / W;
        // first covered neighbour in the order +x, -x, +y, -y
        const j = col + 1 < W && has[i + 1] ? i + 1 : col > 0 && has[i - 1] ? i - 1
          : row + 1 < H && has[i + W] ? i + W : row > 0 && has[i - W] ? i - W : -1;
        if (j < 0) continue;
        for (let k = 0; k < 4; k++) data[i * 4 + k] = data[j * 4 + k];
        next[i] = 1;
      }
      has.set(next);
    }
    const tex = new THREE.DataTexture(data, a.GW, a.GH, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.flipY = false;
    tex.needsUpdate = true;
    kit.disposables.push(tex);

    // Water cells count as surfaces for banks (the shore slope belongs to the land).
    for (let i = 0; i < a.N; i++) if (a.kind[i] === K.Water && Number.isNaN(surfH[i])) surfH[i] = a.height[i];
    const covered = new Uint8Array(a.N);
    for (const c of p.cells) covered[c.i] = 1;

    // Banks: same geometry as the legacy connectors, for every S/E pair touching the terrain.
    // Packed as (x, y, hi, lo, kind) with kind 0/1 = S bank falling south/north, 2/3 = E bank
    // falling east/west.
    const banks: number[] = [];
    for (let i = 0; i < a.N; i++) {
      const h = surfH[i];
      if (Number.isNaN(h)) continue;
      const col = i % W, row = (i - col) / W;
      const x = col + a.minX, y = row + a.minY;
      for (let e = 0; e < 2; e++) {
        if (e === 0 ? row + 1 >= H : col + 1 >= W) continue;
        const j = e === 0 ? i + W : i + 1;
        const h2 = surfH[j];
        if (!(covered[i] || covered[j]) || Number.isNaN(h2) || Math.abs(h - h2) <= 0.01) continue;
        banks.push(x, y, Math.max(h, h2), Math.min(h, h2), e * 2 + (h > h2 ? 0 : 1));
      }
    }

    // Non-indexed triangles: position + normal only (the material uses no vertex colours or UVs).
    const quads = p.cells.length + banks.length / 5;
    const pos = new Float32Array(quads * 18);
    const nor = new Float32Array(quads * 18);
    const q = new Float64Array(12); // corners a, b, c, d (a = TL, b = TR, c = BR, d = BL)
    let o = 0;
    /** Emits quad q as two triangles wound to face normal n (`flip` per its corner order). */
    const emit = (flip: boolean, nx: number, ny: number, nz: number) => {
      for (const k of flip ? FLIPPED : UNFLIPPED) {
        pos[o] = q[k * 3]; pos[o + 1] = q[k * 3 + 1]; pos[o + 2] = q[k * 3 + 2];
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        o += 3;
      }
    };
    const corners = (ax: number, ay: number, az: number, bx: number, by: number, bz: number,
      cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) => {
      q[0] = ax; q[1] = ay; q[2] = az; q[3] = bx; q[4] = by; q[5] = bz;
      q[6] = cx; q[7] = cy; q[8] = cz; q[9] = dx; q[10] = dy; q[11] = dz;
    };
    for (const c of p.cells) {
      const x = a.cellX(c.i), y = a.cellY(c.i), h = c.h;
      corners(x, h, y + h, x + 1, h, y + h, x + 1, h, y + 1 + h, x, h, y + 1 + h);
      emit(true, 0, 1, 0);
    }
    for (let b = 0; b < banks.length; b += 5) {
      const x = banks[b], y = banks[b + 1], hi = banks[b + 2], lo = banks[b + 3], kind = banks[b + 4];
      if (kind < 2) {
        corners(x, hi, y + 1 + hi, x + 1, hi, y + 1 + hi, x + 1, lo, y + 1 + lo, x, lo, y + 1 + lo);
        if (kind === 0) emit(true, 0, 0, 1);
        else emit(false, 0, 0.7, -0.7);
      } else {
        const px = x + 1;
        corners(px, hi, y + hi, px, hi, y + 1 + hi, px, lo, y + 1 + lo, px, lo, y + lo);
        emit(kind === 3, kind === 2 ? 1 : -1, 0, 0);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.computeBoundingSphere();

    const km = kitMaterial(kit.uniforms, terrainMaterial(tex, new THREE.Vector2(a.minX, a.minY), new THREE.Vector2(a.GW, a.GH)));
    const mesh = new THREE.Mesh(geo, km.material);
    mesh.receiveShadow = true;
    mesh.castShadow = true; // terraces shade the ground below them, as the legacy floors did
    return mesh;
  },
};
