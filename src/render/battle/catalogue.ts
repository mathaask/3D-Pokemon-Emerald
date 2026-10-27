// The battle's program catalogue: one tiny mesh per shader-program variant the battle arenas draw with — every Modern
// arena part's catalogue entries (kit materials) and today's arena (BattleArena, the Retro look and the fallback, for every
// battle environment) — so BattleView.precompile compiles them all at boot: entering a battle compiles nothing, in either
// style. The drift guard (tests/battleCatalogue.test.ts) holds it to exactly what the arenas build.

import * as THREE from 'three';
import { applyKitMaterial, kitMaterial, kitMaterialKind, releaseKitMaterial, type KitUniforms } from '../kit/materials';
import { catalogueTriangle, meshesOf, programSignature } from '../kit/catalogue';
import type { ArenaPart } from './modernArena';
import { BattleArena } from './arena';
import { STAGE } from './stage';

export interface BattleCatalogue {
  /** One mesh per program variant (frustumCulled off: drawn in the precompile frame wherever the camera looks). */
  root: THREE.Group;
  /** Frees the meshes' geometries, instance buffers, placeholder textures and today's arena's textures (never a kit
   *  material's map: it may be shared with the arenas' builds) and detaches the root; the materials stay (the kit ones in
   *  the catalogue's pool, today's arena's unreferenced), so their programs live for the session. */
  dispose(): void;
}

/** Today's arena's battle environments (GRASS … PLAIN: gBattleEnvironment 0..9). */
const ENVIRONMENTS = 10;

/** Today's arena (BattleArena) built for environments 0..9 at the stage's platforms: one detached mesh per program
 *  signature (the first one built; frustumCulled off). */
export function legacyArenaMeshes(): THREE.Mesh[] {
  const seen = new Set<string>();
  const out: THREE.Mesh[] = [];
  for (let env = 0; env < ENVIRONMENTS; env++) {
    const arena = new BattleArena();
    arena.setPlatforms(STAGE.player, STAGE.enemy);
    arena.setEnvironment(env);
    for (const mesh of meshesOf(arena.group)) {
      const sig = programSignature(mesh);
      if (seen.has(sig)) continue;
      seen.add(sig);
      mesh.removeFromParent();
      mesh.frustumCulled = false;
      out.push(mesh);
    }
    // (the rest was never drawn: nothing on the GPU to free)
  }
  return out;
}

/** three's shadow pass draws a material's front faces' shadow with the back faces and the other way round (WebGLShadowMap's
 *  shadowSide). */
const SHADOW_SIDE: Record<THREE.Side, THREE.Side> = { [THREE.FrontSide]: THREE.BackSide, [THREE.BackSide]: THREE.FrontSide,
  [THREE.DoubleSide]: THREE.DoubleSide };

/**
 * A stand-in for every shadow-casting mesh under `root` with its own shadow-depth material (customDepthMaterial: the cards'
 * alpha-tested twin, a kit material's wind twin): a mesh of the same kind on the same geometry drawing that material, set
 * as three's shadow pass sets it (side, map, alpha test). compileAsync compiles a scene's materials but not their shadow
 * twins, which otherwise compile in the first frame's shadow pass; with the stand-ins in the scene they compile with the
 * scene's lights in parallel too. (The stand-ins never draw: they are removed before any frame.)
 */
export function shadowDepthStandIns(root: THREE.Object3D): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    const depth = mesh.customDepthMaterial;
    if (!mesh.isMesh || !mesh.castShadow || !depth || Array.isArray(mesh.material)) return;
    // (as WebGLShadowMap's getDepthMaterial sets a custom depth material before each shadow pass draws it)
    const m = mesh.material as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
    const d = depth as THREE.Material & { map?: THREE.Texture | null; alphaMap?: THREE.Texture | null };
    d.side = m.shadowSide !== null ? m.shadowSide : SHADOW_SIDE[m.side];
    d.alphaMap = m.alphaMap;
    d.alphaTest = m.alphaToCoverage ? 0.5 : m.alphaTest;
    d.map = m.map;
    const im = mesh as THREE.InstancedMesh;
    let standIn: THREE.Mesh;
    if (im.isInstancedMesh) {
      const inst = new THREE.InstancedMesh(mesh.geometry, depth, 1);
      if (im.instanceColor) inst.setColorAt(0, new THREE.Color(1, 1, 1));
      standIn = inst;
    } else standIn = new THREE.Mesh(mesh.geometry, depth);
    standIn.frustumCulled = false;
    standIn.name = `${mesh.name || 'mesh'}:shadowDepth`;
    out.push(standIn);
  });
  return out;
}

/** One tiny mesh per program variant of the parts' catalogue entries (kit materials from `uniforms`' pool, deduped by
 *  programSignature) plus legacyArenaMeshes(). */
export function battleCatalogue(src: { uniforms: KitUniforms; parts: readonly ArenaPart[] }): BattleCatalogue {
  const root = new THREE.Group();
  root.name = 'battleCatalogue';
  const textures: THREE.Texture[] = [];
  const placeholder = () => {
    const t = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
    t.needsUpdate = true;
    textures.push(t);
    return t;
  };
  const seen = new Set<string>();
  // (kit materials back to the catalogue's pool; any other material is kept: its program lives for the session)
  const release = (mesh: THREE.Mesh) => {
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (kitMaterialKind(m) !== null) releaseKitMaterial(m);
    }
    if (mesh.customDepthMaterial && kitMaterialKind(mesh.customDepthMaterial) !== null) releaseKitMaterial(mesh.customDepthMaterial);
  };
  for (const part of src.parts) {
    for (const e of part.catalogue(placeholder)) {
      const km = kitMaterial(src.uniforms, e.material);
      const geometry = catalogueTriangle(e.attrs);
      const mesh = e.mesh === 'mesh' ? new THREE.Mesh(geometry, km.material) : new THREE.InstancedMesh(geometry, km.material, 1);
      applyKitMaterial(mesh, km);
      if (e.mesh === 'instancedColors') (mesh as THREE.InstancedMesh).setColorAt(0, new THREE.Color(1, 1, 1));
      mesh.castShadow = e.castShadow;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const sig = programSignature(mesh);
      // (variants sharing a program: one)
      if (seen.has(sig)) {
        geometry.dispose();
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
        release(mesh);
        continue;
      }
      seen.add(sig);
      root.add(mesh);
    }
  }
  // (today's arena draws with three's materials, never a kit one: no signature of it is a part's)
  for (const mesh of legacyArenaMeshes()) {
    const sig = programSignature(mesh);
    if (seen.has(sig)) continue;
    seen.add(sig);
    root.add(mesh);
  }

  return {
    root,
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>();
      for (const mesh of meshesOf(root)) {
        geometries.add(mesh.geometry);
        if ((mesh as THREE.InstancedMesh).isInstancedMesh) (mesh as THREE.InstancedMesh).dispose();
        // (today's arena's own textures; a kit material's map is the catalogue's placeholder, already listed — or a
        // texture shared with the arenas' builds, which must stay)
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          const map = (m as THREE.MeshStandardMaterial).map;
          if (map && kitMaterialKind(m) === null && !textures.includes(map)) textures.push(map);
        }
        release(mesh);
      }
      for (const g of geometries) g.dispose();
      for (const t of textures) t.dispose();
      root.clear();
      root.removeFromParent();
    },
  };
}
