// Builds the 3D world geometry for the current map from the live metatile grid.
//
// Coordinates: X = east (grid x), Z = south (grid y), Y = up; 1 unit = 1 metatile.
// The GBA's oblique view draws a point at ground row y and height h on screen row
// y - h, so anything raised by h is placed at Z = y + h ("un-projection"). From the
// default 45° camera the result lines up with the original pixel art.

import * as THREE from 'three';
import type { MetatileAtlas } from './metatileAtlas';
import { classify, type CellModel, type ClassifyOptions } from './classify';
import { TreeCards, type TreeRow } from './treeCards';

export interface GridData {
  width: number;
  height: number;
  /** Raw u16 grid: metatile id (bits 0-9), collision (10-11), elevation (12-15). */
  cells: Uint16Array;
  /** Metatile ids used outside the grid (map border, 2x2 pattern). */
  border: number[];
  borderW: number;
  borderH: number;
  /** Border pattern phase: the game indexes the 2x2 border with (x + phase) & 1 (backup map: 1). */
  borderPhase: number;
}

export interface WorldMaterials {
  opaque: THREE.Material;
  cutout: THREE.Material;
  water: THREE.Material;
}

interface QuadBatch {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  glow: number[];
  indices: number[];
}

function newBatch(): QuadBatch {
  return { positions: [], normals: [], uvs: [], colors: [], glow: [], indices: [] };
}

const UV = new Float32Array(4);

/** Average sRGB colour (0..1) of a metatile's composite pixels. */
function averageColor(info: { both: Uint16Array }, m: number): [number, number, number] {
  let r = 0, g = 0, b = 0, n = 0;
  for (let p = 0; p < 256; p++) {
    const c = info.both[m * 256 + p];
    if (c & 0x8000) continue;
    r += c & 31; g += (c >> 5) & 31; b += (c >> 10) & 31; n++;
  }
  return n ? [r / n / 31, g / n / 31, b / n / 31] : [0.3, 0.5, 0.3];
}

export class World {
  readonly group = new THREE.Group();
  model: CellModel | null = null;
  private meshes: THREE.Mesh[] = [];
  treeCards: TreeCards | null = null;
  /** Extra ring of border cells rendered around the grid. */
  readonly margin = 14;

  private base = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5a9a6a, roughness: 1 }),
  );

  constructor(private atlas: MetatileAtlas, private materials: WorldMaterials) {
    this.base.receiveShadow = true;
    this.group.add(this.base);
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose();
      this.group.remove(m);
    }
    this.meshes = [];
    if (this.treeCards) {
      this.group.remove(this.treeCards.mesh);
      this.treeCards.dispose();
      this.treeCards = null;
    }
  }

  build(grid: GridData, opts: Omit<ClassifyOptions, 'margin'>): void {
    this.dispose();
    const model = classify(grid, { ...opts, margin: this.margin });
    this.atlas.setGroundRefs(model.groundRefs);
    this.model = model;
    const opaque = newBatch();
    const cutout = newBatch();
    const water = newBatch();

    for (const q of model.quads) {
      const batch = q.water ? water : q.cutout ? cutout : opaque;
      this.atlas.uv(q.metatile, q.variant, UV);
      // Sub-rectangle of the metatile texture (for faces spanning partial rows).
      const u0 = UV[0] + (UV[2] - UV[0]) * q.tu0;
      const u1 = UV[0] + (UV[2] - UV[0]) * q.tu1;
      const v0 = UV[1] + (UV[3] - UV[1]) * q.tv0;
      const v1 = UV[1] + (UV[3] - UV[1]) * q.tv1;
      const base = batch.positions.length / 3;
      // Corners: a = top-left of texture, b = top-right, c = bottom-right, d = bottom-left.
      batch.positions.push(...q.a, ...q.b, ...q.c, ...q.d);
      for (let k = 0; k < 4; k++) batch.normals.push(q.normal[0], q.normal[1], q.normal[2]);
      batch.uvs.push(u0, v0, u1, v0, u1, v1, u0, v1);
      for (let k = 0; k < 4; k++) batch.colors.push(q.shade, q.shade, q.shade);
      const g = q.glow ? 1 : 0;
      batch.glow.push(g, g, g, g);
      batch.indices.push(base, base + 3, base + 1, base + 1, base + 3, base + 2);
    }

    const rows: TreeRow[] = model.trees.map((t) => {
      this.atlas.uv(t.metatile, t.variant, UV);
      return { px: t.px, py: t.py, pz: t.pz, y0: t.y0, u0: UV[0], v0: UV[1], u1: UV[2], v1: UV[3] };
    });
    if (rows.length) {
      this.treeCards = new TreeCards(this.atlas.target.texture, rows);
      this.group.add(this.treeCards.mesh);
    }

    // Base ground plane: anything the reconstruction leaves uncovered reads as ground, not sky.
    this.base.scale.set(model.maxX - model.minX + 40, 1, model.maxY - model.minY + 40);
    this.base.position.set((model.minX + model.maxX) / 2, -0.6, (model.minY + model.maxY) / 2); // below water (-0.3)
    const baseMat = this.base.material as THREE.MeshStandardMaterial;
    if (opts.indoor || model.dominantFloor < 0) baseMat.color.setRGB(0.01, 0.01, 0.012);
    else {
      const c = averageColor(opts.info, model.dominantFloor);
      baseMat.color.setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    }

    this.addMesh(opaque, this.materials.opaque, true);
    this.addMesh(cutout, this.materials.cutout, true);
    this.addMesh(water, this.materials.water, false);
  }

  private addMesh(b: QuadBatch, material: THREE.Material, castShadow: boolean): void {
    if (b.indices.length === 0) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.normals, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uvs, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(b.colors, 3));
    g.setAttribute('aGlow', new THREE.Float32BufferAttribute(b.glow, 1));
    g.setIndex(b.indices);
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, material);
    mesh.receiveShadow = true;
    mesh.castShadow = castShadow;
    this.group.add(mesh);
    this.meshes.push(mesh);
  }

  /** Ground height (world Y) at grid cell (x, y); used to place sprites. */
  heightAt(x: number, y: number): number {
    return this.model ? this.model.heightAt(x, y) : 0;
  }
}
