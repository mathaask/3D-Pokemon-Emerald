// Camera-facing (cylindrical billboard) cards for trees, built on MeshStandardMaterial so
// they receive real lighting and shadows. One instance per 1x1 row of a tree; all rows of
// a tree share a pivot so they turn together.

import * as THREE from 'three';

export interface TreeRow {
  /** Pivot: horizontal centre of the trunk, ground height, depth plane. */
  px: number; py: number; pz: number;
  /** Bottom of this row above the pivot (world units). */
  y0: number;
  /** Atlas UV rect: u0, v0 (top), u1, v1 (bottom). */
  u0: number; v0: number; u1: number; v1: number;
}

const VERTEX_DECL = /* glsl */ `
  attribute vec3 aPivot;
  attribute float aRowY;
  attribute vec4 aUvRect;
  uniform vec3 uRight;
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms, right: { value: THREE.Vector3 }): void {
  shader.uniforms.uRight = right;
  shader.vertexShader = VERTEX_DECL + shader.vertexShader
    .replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = vec2(mix(aUvRect.x, aUvRect.z, position.x + 0.5), mix(aUvRect.w, aUvRect.y, position.y));
      #endif`)
    .replace('#include <beginnormal_vertex>', `vec3 objectNormal = normalize(vec3(-uRight.z, 0.35, uRight.x));
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3(1.0, 0.0, 0.0);
      #endif`)
    .replace('#include <begin_vertex>', `vec3 transformed = aPivot + uRight * position.x + vec3(0.0, aRowY + position.y, 0.0);`);
}

export class TreeCards {
  readonly mesh: THREE.Mesh;
  private right = { value: new THREE.Vector3(1, 0, 0) };

  constructor(atlas: THREE.Texture, rows: TreeRow[]) {
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    g.setAttribute('normal', quad.getAttribute('normal'));
    g.setAttribute('uv', quad.getAttribute('uv'));
    const pivot = new Float32Array(rows.length * 3);
    const rowY = new Float32Array(rows.length);
    const uv = new Float32Array(rows.length * 4);
    rows.forEach((r, i) => {
      pivot.set([r.px, r.py, r.pz], i * 3);
      rowY[i] = r.y0;
      uv.set([r.u0, r.v0, r.u1, r.v1], i * 4);
    });
    g.setAttribute('aPivot', new THREE.InstancedBufferAttribute(pivot, 3));
    g.setAttribute('aRowY', new THREE.InstancedBufferAttribute(rowY, 1));
    g.setAttribute('aUvRect', new THREE.InstancedBufferAttribute(uv, 4));
    g.instanceCount = rows.length;

    const material = new THREE.MeshStandardMaterial({
      map: atlas, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.95, metalness: 0,
    });
    material.onBeforeCompile = (s) => patch(s, this.right);
    material.customProgramCacheKey = () => 'treecards';
    const depth = new THREE.MeshDepthMaterial({ map: atlas, alphaTest: 0.5, depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
    depth.onBeforeCompile = (s) => patch(s, this.right);
    depth.customProgramCacheKey = () => 'treecards-depth';

    this.mesh = new THREE.Mesh(g, material);
    this.mesh.customDepthMaterial = depth;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
  }

  setCameraRight(v: THREE.Vector3): void {
    this.right.value.copy(v);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.customDepthMaterial?.dispose();
  }
}
