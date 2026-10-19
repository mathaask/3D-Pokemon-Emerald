// World materials: lit pixel-art surfaces, alpha-tested cut-outs, glossy animated water, and
// night-time window glow on building walls (shader injection into MeshStandardMaterial).

import * as THREE from 'three';

export interface WorldUniforms {
  uNight: { value: number };
  uTime: { value: number };
}

function injectGlow(shader: THREE.WebGLProgramParametersWithUniforms, u: WorldUniforms): void {
  shader.uniforms.uNight = u.uNight;
  shader.vertexShader = 'attribute float aGlow;\nvarying float vGlow;\n' + shader.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
  shader.fragmentShader = 'uniform float uNight;\nvarying float vGlow;\n' + shader.fragmentShader
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      if (vGlow > 0.5 && uNight > 0.01) {
        // Window glass in the GBA palettes is blue/cyan: light it warmly after dark.
        vec3 c = diffuseColor.rgb;
        // saturated blue only (pale blue-grey wall paint must not glow)
        float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
        float glass = step(max(c.r, c.g), c.b) * smoothstep(0.22, 0.4, sat) * smoothstep(0.05, 0.2, c.b);
        totalEmissiveRadiance += vec3(1.0, 0.72, 0.38) * glass * uNight * 1.6;
      }`);
}

function injectWater(shader: THREE.WebGLProgramParametersWithUniforms, u: WorldUniforms): void {
  shader.uniforms.uTime = u.uTime;
  shader.vertexShader = 'uniform float uTime;\n' + shader.vertexShader
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec4 wp = modelMatrix * vec4(transformed, 1.0);
      transformed.y += sin(wp.x * 1.3 + uTime * 1.6) * 0.025 + cos(wp.z * 1.1 + uTime * 1.2) * 0.025;`)
    .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      {
        vec4 wq = modelMatrix * vec4(position, 1.0);
        objectNormal = normalize(vec3(-cos(wq.x * 1.3 + uTime * 1.6) * 0.033, 1.0, sin(wq.z * 1.1 + uTime * 1.2) * 0.028));
      }`);
}

export function createWorldMaterials(atlas: THREE.Texture, u: WorldUniforms) {
  const opaque = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.92, metalness: 0 });
  opaque.onBeforeCompile = (s) => injectGlow(s, u);
  opaque.customProgramCacheKey = () => 'world-opaque';
  const cutout = new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: 0.9, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide,
  });
  const water = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.45, metalness: 0 });
  water.onBeforeCompile = (s) => injectWater(s, u);
  water.customProgramCacheKey = () => 'world-water';
  return { opaque, cutout, water };
}
