// Ground: one continuous surface over walkable cells and under every claimed object, shaded by
// a procedural material per cell and tinted with the cell's own ROM colour. Material borders
// are noise-warped so the GBA's grid-aligned paths read as organic shapes. Banks between
// heights are the same surface, drawn steep (soil).

import * as THREE from 'three';
import { MB } from '../../game/behaviors';
import { DOOR_BEHAVIORS, K, type MapAnalysis } from '../overworld/analyze';
import { CLAIM_OBJECT, CLAIM_SURFACE, type Claims } from '../overworld/claims';
import { classifyGroundColor, dominantColor, luma, scale, type GroundClass, type RGB } from './palette';
import { kitMaterial } from './materials';
import type { Family, SemanticContext, KitContext } from './semantics';

export const enum GroundMat { Grass = 0, Path = 1, Sand = 2, Paving = 3, Dirt = 4, Gravel = 5, Rock = 6, Deck = 7, Dark = 8 }

const CLASS_MAT: Record<GroundClass, GroundMat> = {
  grass: GroundMat.Grass, path: GroundMat.Path, sand: GroundMat.Sand, paving: GroundMat.Paving,
  dirt: GroundMat.Dirt, gravel: GroundMat.Gravel, rock: GroundMat.Rock, water: GroundMat.Paving, dark: GroundMat.Dark,
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
const groundColor = (px: Uint16Array, m: number) => dominantColor(px, [m], lit) ?? dominantColor(px, [m]);

/** Material + dominant (sRGB) colour of a metatile's ground layer, cached per metatile. */
export function cellLook(a: MapAnalysis, m: number, cache: Map<number, CellLook>): CellLook {
  let e = cache.get(m);
  if (!e) {
    const c = groundColor(a.info.bottom, m) ?? groundColor(a.info.both, m) ?? [0.45, 0.7, 0.5];
    const mat = groundMaterial(a.info.attributes[m] & 0xff, c);
    // Bridges and walkways draw their planks on the top layer (over water or canopy).
    const tint = mat === GroundMat.Deck ? dominantColor(a.info.both, [m], lit) ?? c : c;
    e = { mat, tint };
    cache.set(m, e);
  }
  return e;
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

const FRAG_COLOR = /* glsl */ `
{
  vec2 cell = vec2(vKitWorld.x, vKitWorld.z - vKitWorld.y);       // un-project to grid space
  // Organic borders: a broad warp bends the grid's straight edges, a finer one frays them.
  vec2 warp = (vec2(kitFbm2(cell * 0.7), kitFbm2(cell * 0.7 + 17.3)) - 0.5) * 1.5
            + (vec2(kitNoise2(cell * 3.3), kitNoise2(cell * 3.3 + 9.1)) - 0.5) * 0.24;
  vec2 g = cell + warp - uGridMin;
  ivec2 ic = clamp(ivec2(floor(g)), ivec2(0), ivec2(uGridSize) - 1);
  int mat = int(texelFetch(tCells, ic, 0).a * 255.0 + 0.5) >> 4;
  // Tint blends only in a narrow band at cell borders: soft edges that still hold their shape.
  vec2 t = g - 0.5;
  vec3 tint = kitSrgbToLinear(texture(tCells, (floor(t) + 0.5 + smoothstep(0.3, 0.7, fract(t))) / uGridSize).rgb);
  vec3 col = kitGround(mat, tint, cell);
  // Banks (45° S slopes, vertical E faces: |n.y| <= 0.71) are all soil; tops (n.y = 1) none.
  vec3 nW = inverseTransformDirection(vNormal, viewMatrix);
  float steep = 1.0 - smoothstep(0.75, 0.95, abs(nW.y));
  // A bank's soil is that of the cell owning it, the higher side: bank normals point at the lower
  // cell, so step half a cell against them (unwarped, so it holds steady along the bank).
  vec2 own = cell - nW.xz / max(length(nW.xz), 1e-4) * 0.5;
  vec4 od = texelFetch(tCells, clamp(ivec2(floor(own - uGridMin)), ivec2(0), ivec2(uGridSize) - 1), 0);
  int omat = int(od.a * 255.0 + 0.5) >> 4;
  vec3 otint = kitSrgbToLinear(od.rgb);
  // Earthy soil under soft ground, a darker edge of the same stone/planks under hard ground.
  vec3 earth = (omat == 3 || omat == 6 || omat == 7) ? otint * 0.68 : mix(otint * 0.75, vec3(0.32, 0.19, 0.1), 0.75);
  vec3 soil = earth * (0.85 + 0.3 * kitFbm2(vec2(vKitWorld.x + vKitWorld.z, vKitWorld.y) * 3.0));
  diffuseColor.rgb *= mix(col, soil, steep);
}
`;

export const terrainFamily: Family<TerrainPlacement> = {
  name: 'terrain',

  extract({ a }: SemanticContext, claims: Claims): TerrainPlacement {
    const cells: TerrainCell[] = [];
    const cache = new Map<number, CellLook>();
    for (let i = 0; i < a.N; i++) {
      if (claims.has(i, CLAIM_SURFACE)) continue;
      const k = a.kind[i];
      const walk = k === K.Floor || k === K.Stairs || k === K.Ledge;
      const under = claims.has(i, CLAIM_OBJECT);
      if (!walk && !under) continue;
      if (!under && isStructure(a.beh[i])) continue;
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
      claims.claim(i, CLAIM_SURFACE);
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

    const km = kitMaterial(kit.uniforms, {
      roughness: 0.95,
      uniforms: {
        tCells: { value: tex },
        uGridMin: { value: new THREE.Vector2(a.minX, a.minY) },
        uGridSize: { value: new THREE.Vector2(a.GW, a.GH) },
      },
      fragHead: FRAG_HEAD,
      fragColor: FRAG_COLOR,
      hookKey: 'terrain',
    });
    const mesh = new THREE.Mesh(geo, km.material);
    mesh.receiveShadow = true;
    mesh.castShadow = true; // terraces shade the ground below them, as the legacy floors did
    return mesh;
  },
};
