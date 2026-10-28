// A digest of everything a World draws (Phase 4b Task 3: "a patched world equals the rebuilt world"). FNV-1a over every
// mesh under `w.group` in traversal order: its name, visibility, transform, render order, shadow flags, its materials'
// program keys (customProgramCacheKey), colours and kit uniform values (kitMaterialSlots: numbers, vectors, colours,
// textures by their data — F8: a build's uniform values live in the pool's private slots), every geometry attribute's
// bytes (index, draw range and instance count included), the instance attributes of an InstancedMesh, and the data of
// every texture in `mesh.userData.stateTexture` (F8: the puzzle state lives there). The base plane's colour (from
// `dominantFloor`) is its material's colour. Two worlds built from the same grid on the same atlas, materials and
// uniforms digest alike; a world whose patch missed a UV, a texel or a uniform does not.

import * as THREE from 'three';
import type { World } from '../../../src/render/overworld/world';
import { kitMaterialSlots } from '../../../src/render/kit/materials';

class Fnv {
  h = 0x811c9dc5;
  byte(b: number): void {
    this.h ^= b & 0xff;
    this.h = Math.imul(this.h, 0x01000193) >>> 0;
  }
  bytes(v: ArrayBufferView): void {
    const u = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    this.num(u.length);
    for (let i = 0; i < u.length; i++) this.byte(u[i]);
  }
  str(s: string): void {
    this.num(s.length);
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); this.byte(c); this.byte(c >> 8); }
  }
  num(n: number): void {
    this.bytes0(new Float64Array([n]));
  }
  private bytes0(v: Float64Array): void {
    const u = new Uint8Array(v.buffer);
    for (let i = 0; i < u.length; i++) this.byte(u[i]);
  }
}

function texture(f: Fnv, t: THREE.Texture | null | undefined): void {
  if (!t) { f.str('no texture'); return; }
  const img = t.image as { data?: ArrayBufferView; width?: number; height?: number } | null;
  f.str(t.type + ':' + t.format);
  if (img?.data && ArrayBuffer.isView(img.data)) {
    f.num(img.width ?? 0); f.num(img.height ?? 0);
    f.bytes(img.data);
  } else {
    // (a render target's or an image's texture: the same object in both worlds — the atlas — by its size)
    f.str('image');
    f.num(img?.width ?? 0); f.num(img?.height ?? 0);
  }
}

function value(f: Fnv, v: unknown): void {
  if (v === null || v === undefined) f.str(String(v));
  else if (typeof v === 'number' || typeof v === 'boolean') f.num(Number(v));
  else if (typeof v === 'string') f.str(v);
  else if ((v as THREE.Texture).isTexture) texture(f, v as THREE.Texture);
  else if ((v as THREE.Color).isColor) { const c = v as THREE.Color; f.num(c.r); f.num(c.g); f.num(c.b); }
  else if ((v as THREE.Vector2).isVector2 || (v as THREE.Vector3).isVector3 || (v as THREE.Vector4).isVector4) {
    for (const k of (v as THREE.Vector4).toArray()) f.num(k);
  } else if (v instanceof THREE.Matrix4 || v instanceof THREE.Matrix3) {
    for (const k of (v as THREE.Matrix4).elements) f.num(k);
  } else if (ArrayBuffer.isView(v)) f.bytes(v);
  else if (Array.isArray(v)) { f.num(v.length); for (const x of v) value(f, x); }
  else f.str(`[${typeof v}]`);
}

function material(f: Fnv, m: THREE.Material): void {
  f.str(m.type);
  f.str(m.customProgramCacheKey());
  f.num(m.side); f.num(m.transparent ? 1 : 0); f.num(m.depthWrite ? 1 : 0); f.num(m.blending); f.num(m.alphaTest);
  const s = m as THREE.MeshStandardMaterial;
  if (s.color) value(f, s.color);
  if (s.emissive) value(f, s.emissive);
  if (typeof s.roughness === 'number') { f.num(s.roughness); f.num(s.metalness); }
  if ('map' in s) texture(f, s.map);
  const slots = kitMaterialSlots(m);
  if (slots) for (const k of Object.keys(slots).sort()) { f.str(k); value(f, slots[k].value); }
}

function attribute(f: Fnv, name: string, a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): void {
  f.str(name);
  if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) {
    const ia = a as THREE.InterleavedBufferAttribute;
    f.num(ia.offset); f.num(ia.itemSize);
    f.bytes(ia.data.array as unknown as ArrayBufferView);
  } else {
    const b = a as THREE.BufferAttribute;
    f.num(b.itemSize); f.num(b.normalized ? 1 : 0);
    f.bytes(b.array as unknown as ArrayBufferView);
  }
}

/** The world's digest (hex): see the file header. */
export function worldDigest(w: World): string {
  const f = new Fnv();
  w.group.updateMatrixWorld(true);
  w.group.traverse((o) => {
    const m = o as THREE.Mesh;
    f.str(o.type); f.str(o.name); f.num(o.visible ? 1 : 0); f.num(o.renderOrder);
    f.num(o.castShadow ? 1 : 0); f.num(o.receiveShadow ? 1 : 0); f.num(o.frustumCulled ? 1 : 0);
    for (const k of o.matrixWorld.elements) f.num(k);
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) material(f, mat);
    if (m.customDepthMaterial) { f.str('depth'); material(f, m.customDepthMaterial); }
    const g = m.geometry;
    f.str(g.type);
    if (g.index) attribute(f, 'index', g.index);
    for (const name of Object.keys(g.attributes).sort()) attribute(f, name, g.attributes[name]);
    f.num(g.drawRange.start); f.num(g.drawRange.count);
    for (const grp of g.groups) { f.num(grp.start); f.num(grp.count); f.num(grp.materialIndex ?? 0); }
    if ((g as THREE.InstancedBufferGeometry).isInstancedBufferGeometry) f.num((g as THREE.InstancedBufferGeometry).instanceCount);
    const im = o as THREE.InstancedMesh;
    if (im.isInstancedMesh) {
      f.num(im.count);
      attribute(f, 'instanceMatrix', im.instanceMatrix);
      if (im.instanceColor) attribute(f, 'instanceColor', im.instanceColor);
    }
    const state = m.userData.stateTexture as THREE.Texture | THREE.Texture[] | undefined;
    if (state) for (const t of Array.isArray(state) ? state : [state]) { f.str('state'); texture(f, t); }
  });
  return f.h.toString(16).padStart(8, '0');
}
