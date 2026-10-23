// Berry soil (Modern): the soft soil cells berry trees grow in (MB_BERRY_TREE_SOIL) become low, tilled soil beds
// on the ground, so the 3D berry plants (actors/models.ts) stand in them. They are blocked cells, which the legacy
// reconstruction draws as props: an upright cutout card on the cell's centre line, or a soil wall along its south
// edge where the art fills the cell (Route 104) — either hid the lower half of a plant standing there. Here the
// terrain draws the ground around them (the cell's ground, grass) and each cell gets a bed: a rounded square of
// turned earth (the soil tile's own colour as earth: palette.ts earthTone; moonlit at night: NIGHT_SOIL, through the
// material's colour, set per frame from uNight: no shader hook, no program of its own), domed,
// its top ridged by furrows. The plants stand on its top (the cell's surface height).
// Retro keeps the legacy soil (the kit only runs in Modern).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { MB } from '../../game/behaviors';
import { K } from '../overworld/analyze';
import { CLAIM_OBJECT, type Claims } from '../overworld/claims';
import { hashCell, noise3 } from './geom';
import { kitMaterial, type KitMaterialOptions } from './materials';
import { earthTone, nightSoilScale, toLinear, type RGB } from './palette';
import { cellLook, type CellLook } from './terrain';
import type { Family, KitContext, SemanticContext } from './semantics';

/** A bed: half its width (a rounded square; the cell is 1 wide), the height of its top, its furrows' count and
 *  depth, where its slope starts (share of the half width). */
export const BED = { half: 0.44, top: 0.05, furrows: 4, furrow: 0.012, shoulder: 0.72 };

/** A soil cell: grid index, cell, ground height, the colour of its earth (linear). */
export interface SoilCell { i: number; x: number; y: number; h: number; color: RGB }

/**
 * One cell's bed, centred on (cx, h, cz): an indexed polar grid out to a rounded-square outline (superellipse),
 * flat-domed to BED.top and sloping to the ground past BED.shoulder, furrows running east-west over its top;
 * vertex colours (linear RGB): `soil`, darker down its slope and in the furrows, mottled.
 */
function bedGeo(cx: number, h: number, cz: number, seed: number, soil: RGB): THREE.BufferGeometry {
  const RINGS = 7, SEGS = 36;
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const o = (seed % 997) * 0.37;
  const vertex = (rho: number, a: number) => {
    const c = Math.cos(a), s = Math.sin(a);
    // superellipse |x|^4 + |z|^4 = 1: a square with round corners
    const edge = BED.half / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25);
    const x = c * edge * rho, z = s * edge * rho;
    const slope = THREE.MathUtils.smoothstep(rho, BED.shoulder, 1);
    const ridge = Math.cos(((z / (2 * BED.half)) * BED.furrows + 0.5) * Math.PI * 2);
    const y = BED.top * (1 - slope) * (1 + 0.15 * noise3(x * 5 + o, z * 5, o)) + BED.furrow * ridge * (1 - slope);
    pos.push(cx + x, h + y, cz + z);
    const k = THREE.MathUtils.lerp(0.62, 1, 1 - slope) * (0.9 + 0.12 * ridge) * (1 + 0.14 * noise3(x * 13 + o, z * 13, 3.1));
    col.push(soil[0] * k, soil[1] * k, soil[2] * k);
  };
  vertex(0, 0);
  for (let r = 1; r <= RINGS; r++) for (let j = 0; j < SEGS; j++) vertex(r / RINGS, (j / SEGS) * Math.PI * 2);
  const vi = (r: number, j: number) => (r === 0 ? 0 : 1 + (r - 1) * SEGS + (j % SEGS));
  for (let j = 0; j < SEGS; j++) idx.push(0, vi(1, j + 1), vi(1, j));
  for (let r = 1; r < RINGS; r++) {
    for (let j = 0; j < SEGS; j++) idx.push(vi(r, j), vi(r, j + 1), vi(r + 1, j + 1), vi(r, j), vi(r + 1, j + 1), vi(r + 1, j));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The beds' material: its only definition (the program catalogue, kit/catalogue.ts, precompiles it). */
export const SOIL_MATERIAL: KitMaterialOptions = { vertexColors: true, roughness: 0.95 };

export const soilFamily: Family<SoilCell[]> = {
  name: 'berrySoil',

  extract({ a }: SemanticContext, claims: Claims): SoilCell[] {
    if (a.opts.indoor || a.opts.underground || a.opts.underwater) return [];
    const cells: SoilCell[] = [];
    const looks = new Map<number, CellLook>(), earth = new Map<number, RGB>();
    for (let i = 0; i < a.N; i++) {
      if (a.beh[i] !== MB.BERRY_TREE_SOIL || a.kind[i] !== K.Block || claims.has(i, CLAIM_OBJECT)) continue;
      // the object is ours (a blocked cell: the legacy art draws no top-layer card of its own); the terrain draws
      // the ground under it as the cells around (the soil's own art would paint the bed's surroundings
      // soil-coloured); a plant stands on the bed's top
      claims.claim(i, CLAIM_OBJECT);
      if (a.groundOf[i] >= 0) claims.groundMt[i] = a.groundOf[i];
      const h = a.groundH[i];
      claims.surfaceY[i] = h + BED.top;
      // (the soil tile's colour, as the terrain reads a tile's, turned to earth)
      let color = earth.get(a.mt[i]);
      if (!color) earth.set(a.mt[i], (color = toLinear(earthTone(cellLook(a, a.mt[i], looks).tint))));
      cells.push({ i, x: a.cellX(i), y: a.cellY(i), h, color });
    }
    return cells;
  },

  build(cells: SoilCell[], _ctx: SemanticContext, kit: KitContext): THREE.Object3D | null {
    if (!cells.length) return null;
    // a mesh per earth colour (in practice one: every berry soil tile shares the same art), so each mesh's vertex
    // colours are all its soil × k and its material colour moonlights it exactly (bedMesh)
    const byColor = new Map<string, SoilCell[]>();
    for (const c of cells) {
      const key = c.color.join();
      (byColor.get(key) ?? byColor.set(key, []).get(key)!).push(c);
    }
    const meshes = [...byColor.values()].map((group) => bedMesh(group, kit));
    if (meshes.length === 1) return meshes[0];
    const g = new THREE.Group();
    g.add(...meshes);
    return g;
  },
};

/** The beds of `cells` (one earth colour), merged; moonlit at night by their material colour (nightSoilScale of their
 *  soil, set from the kit's uNight before each draw), exactly as NIGHT_SOIL_GLSL turns soil × k. */
function bedMesh(cells: SoilCell[], kit: KitContext): THREE.Mesh {
  const beds = cells.map((c) => bedGeo(c.x + 0.5, c.h, c.y + 0.5 + c.h, hashCell(c.x, c.y, 0x5011), c.color));
  const g = mergeGeometries(beds)!;
  for (const b of beds) b.dispose();
  g.computeBoundingSphere();
  const material = kitMaterial(kit.uniforms, SOIL_MATERIAL).material;
  const mesh = new THREE.Mesh(g, material);
  mesh.receiveShadow = true;
  const soil = cells[0].color, night = kit.uniforms.uNight, scale: RGB = [1, 1, 1];
  mesh.onBeforeRender = () => {
    nightSoilScale(soil, night.value, scale);
    material.color.setRGB(scale[0], scale[1], scale[2]);
  };
  return mesh;
}
