// The world's program catalogue: one tiny mesh per shader-program variant the overworld world draws with (the kit
// families' materials, the legacy pixel geometry, the tree cards, the ground plane), so OverworldView.precompile can
// compile them all at boot instead of on the first frame that shows each (a map's first visit stalled up to 558 ms).

import * as THREE from 'three';
import { applyKitMaterial, kitMaterial, kitMaterialKind, releaseKitMaterial, type KitMaterialOptions, type KitUniforms } from './materials';
import { BUILDING_BODY, BUILDING_GLASS, BUILDING_ROOF, emblemMaterial, facadeMaterial, signMaterial } from './buildings';
import { PROP_BODY, PROP_GLOW } from './props';
import { TREE_STYLES, treeMaterial } from './trees';
import { CLIFF_MATERIAL } from './cliffs';
import { GRASS_MATERIAL } from './grass';
import { flowerMaterial } from './flowers';
import { SEABED_MATERIAL, WATER_ROCK_MATERIAL, waterMaterial } from './water';
import { SOIL_MATERIAL } from './soil';
import { terrainMaterial } from './terrain';
import { groundMaterial, type WorldMaterials } from '../overworld/world';
import { TreeCardMaterials, TreeCards } from '../overworld/treeCards';

/** A mesh's attributes as three's program key and ANGLE's input layouts see them: names, item sizes, array types,
 *  normalisation, per-instance. */
function attributeSignature(g: THREE.BufferGeometry): string {
  return Object.keys(g.attributes).sort().map((n) => {
    const a = g.attributes[n] as THREE.BufferAttribute;
    const perInstance = (a as THREE.InstancedBufferAttribute).isInstancedBufferAttribute;
    return `${n}:${a.itemSize}:${a.array.constructor.name}${a.normalized ? ':n' : ''}${perInstance ? ':i' : ''}`;
  }).join(',');
}

/** A non-kit material's program-affecting state. */
function materialSignature(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return [m.type, m.customProgramCacheKey(), s.vertexColors ? 1 : 0, m.side, m.transparent ? 1 : 0, s.flatShading ? 1 : 0,
    s.map ? 1 : 0, m.alphaTest > 0 ? 1 : 0].join('|');
}

/**
 * What three compiles a mesh's programs from, besides the scene (lights, fog, render target: fixed in the overworld):
 * its material's program kind (a kit material's pool kind, else its type, program cache key and options), the object
 * (plain mesh, instanced mesh with or without per-instance colours, instanced geometry), whether it casts a shadow and
 * with which depth material, and its geometry's attributes. Two meshes with the same signature draw with the same
 * programs, the shadow-depth ones included. A mesh drawing with a material array (one material per geometry group) has
 * its materials' signatures in order, joined by ' + '.
 */
export function programSignature(mesh: THREE.Mesh): string {
  // (a material array — today's battle arena platforms: [side, top, side] — gives its materials' signatures in order,
  // joined; a single material's is exactly as it was)
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const material = mats.map((m) => kitMaterialKind(m) ?? materialSignature(m)).join(' + ');
  const im = mesh as THREE.InstancedMesh;
  const object = im.isInstancedMesh ? (im.instanceColor ? 'instanced+colors' : 'instanced')
    : (mesh.geometry as THREE.InstancedBufferGeometry).isInstancedBufferGeometry ? 'instancedGeometry' : 'mesh';
  const depth = mesh.customDepthMaterial;
  const shadow = mesh.castShadow ? `cast:${depth ? kitMaterialKind(depth) ?? materialSignature(depth) : 'default'}` : 'nocast';
  return [material, object, shadow, attributeSignature(mesh.geometry)].join(' ; ');
}

/** The meshes under `root` (the catalogue's, a built world's). */
export function meshesOf(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); });
  return out;
}

/** What the catalogue draws with besides the kit families' own materials. */
export interface CatalogueSources {
  /** The catalogue's own KitUniforms: its kit materials pool there, never handed to a build (a build taking them
   *  would draw with other material ids, in another order: painterSortStable draws opaque objects by material id). */
  uniforms: KitUniforms;
  /** The view's legacy pixel-geometry materials (World draws with these very objects). */
  legacy: WorldMaterials;
  /** The metatile atlas texture the legacy tree cards sample. */
  atlas: THREE.Texture;
}

export interface WorldCatalogue {
  /** One mesh per program variant (frustumCulled off: drawn in the precompile frame wherever the camera looks). */
  root: THREE.Group;
  /** Frees the meshes' geometries, instance buffers and placeholder textures and detaches the root; the materials stay
   *  (the kit ones in the catalogue's pool), so their programs live for the session. */
  dispose(): void;
}

/** A small triangle carrying `attrs` (name → item size; Float32 as every family's geometry): a catalogue mesh's
 *  geometry (the world's, the battle's). */
export function catalogueTriangle(attrs: Record<string, number>): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const [name, size] of Object.entries(attrs)) {
    const a = new Float32Array(3 * size).fill(name === 'color' ? 1 : 0);
    if (name === 'position') a.set([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0]);
    if (name === 'normal') a.set([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    g.setAttribute(name, new THREE.Float32BufferAttribute(a, size));
  }
  return g;
}

// The attribute sets the families build (kit/geom.ts MeshBuilder: + uv; QuadWriter and the instanced shapes: colours,
// four-component where the alpha carries a part mask), and World.addMesh's legacy batches.
const PNU = { position: 3, normal: 3, uv: 2 };
const PN = { position: 3, normal: 3 };
const PNC = { position: 3, normal: 3, color: 3 };
const PNC4 = { position: 3, normal: 3, color: 4 };
const PNCU = { position: 3, normal: 3, color: 3, uv: 2 };
const LEGACY = { position: 3, normal: 3, uv: 2, color: 3, aGlow: 1 };

/**
 * The catalogue: one tiny mesh per program variant the world draws (a kit family's material kind on its mesh type,
 * attributes and shadow casting; the legacy materials; the tree cards; the ground plane), made from the families' own
 * material definitions. The drift guard (tests/smoke/catalogue.test.ts) holds it to exactly what every map draws.
 */
export function worldCatalogue(src: CatalogueSources): WorldCatalogue {
  const root = new THREE.Group();
  root.name = 'worldCatalogue';
  const textures: THREE.Texture[] = [];
  const placeholder = () => {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    textures.push(t);
    return t;
  };
  const seen = new Set<string>();
  const add = (mesh: THREE.Mesh, castShadow: boolean) => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    const sig = programSignature(mesh);
    // (variants sharing a program, e.g. the tree styles but the palm: one)
    if (seen.has(sig)) {
      mesh.geometry.dispose();
      if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
      // (back to the catalogue's pool; any other material is someone else's: releaseKitMaterial would dispose it)
      if (kitMaterialKind(mesh.material as THREE.Material) !== null) releaseKitMaterial(mesh.material as THREE.Material);
      return;
    }
    seen.add(sig);
    root.add(mesh);
  };
  const kit = (o: KitMaterialOptions, attrs: Record<string, number>, castShadow: boolean) => {
    add(new THREE.Mesh(catalogueTriangle(attrs), kitMaterial(src.uniforms, o).material), castShadow);
  };
  // (InstancedMesh with per-instance colours, setColorAt; the kit's depth twin for the shadow pass)
  const instanced = (o: KitMaterialOptions, attrs: Record<string, number>, castShadow: boolean) => {
    const km = kitMaterial(src.uniforms, o);
    const mesh = new THREE.InstancedMesh(catalogueTriangle(attrs), km.material, 1);
    applyKitMaterial(mesh, km);
    mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    add(mesh, castShadow);
  };
  const v2 = () => new THREE.Vector2(0, 0);

  // buildings
  kit(BUILDING_BODY, PNCU, true);
  kit(BUILDING_ROOF, PNCU, true);
  kit(BUILDING_GLASS, PNCU, true);
  kit(signMaterial(placeholder()), PNU, false);
  kit(emblemMaterial(placeholder()), PNU, false);
  kit(facadeMaterial(placeholder(), placeholder()), PNU, false);
  kit(facadeMaterial(placeholder(), null), PNU, false);
  // props
  kit(PROP_BODY, PNC, true);
  kit(PROP_GLOW, PNC, false);
  // trees (palms double-sided), grass, flowers
  for (const style of TREE_STYLES) instanced(treeMaterial(style, new THREE.Color()), PNC4, true);
  instanced(GRASS_MATERIAL, PNC, false);
  instanced(flowerMaterial(new THREE.Color(), new THREE.Color()), PNC4, false);
  // cliffs, water (sheet, seabed, rocks), berry soil, terrain
  kit(CLIFF_MATERIAL, PNC, true);
  kit(waterMaterial(placeholder(), v2(), v2(), new THREE.Vector3()), PN, false);
  kit(SEABED_MATERIAL, PN, false);
  kit(WATER_ROCK_MATERIAL, PNC, true);
  kit(SOIL_MATERIAL, PNC, false);
  kit(terrainMaterial(placeholder(), v2(), v2()), PN, true);

  // the legacy pixel geometry (World.addMesh: the water casts no shadow), its tree cards, the ground plane under all
  add(new THREE.Mesh(catalogueTriangle(LEGACY), src.legacy.opaque), true);
  add(new THREE.Mesh(catalogueTriangle(LEGACY), src.legacy.cutout), true);
  add(new THREE.Mesh(catalogueTriangle(LEGACY), src.legacy.water), false);
  const cardMats = new TreeCardMaterials(src.atlas);
  const cards = new TreeCards(cardMats, [{ px: 0, py: 0, pz: 0, y0: 0, u0: 0, v0: 0, u1: 1, v1: 1 }]);
  add(cards.mesh, true);
  add(new THREE.Mesh(catalogueTriangle(PNU), groundMaterial()), false);

  return {
    root,
    dispose() {
      for (const mesh of meshesOf(root)) {
        mesh.geometry.dispose();
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
        // (kit materials back to the catalogue's pool; the legacy ones are the view's, the others kept: programs live)
        if (kitMaterialKind(mesh.material as THREE.Material) !== null) releaseKitMaterial(mesh.material as THREE.Material);
      }
      for (const t of textures) t.dispose();
      root.clear();
      root.removeFromParent();
      void cardMats;
    },
  };
}
