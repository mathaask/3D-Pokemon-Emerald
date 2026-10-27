// World materials: lit pixel-art surfaces, alpha-tested cut-outs, glossy animated water, and
// night-time window glow on building walls (shader injection into MeshStandardMaterial); their HD twins (xBR-smoothed
// pixels) for the cells an in-scope Modern interior's kit leaves legacy.

import * as THREE from 'three';
import { WARM_GLOW_GLSL } from '../kit/materials';
import { XBR_GLSL } from '../actors/xbr.glsl';
import { afterChunk, glslFloat } from '../actors/glsl';
import { CELL } from './metatileAtlas';

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
        totalEmissiveRadiance += ${WARM_GLOW_GLSL} * glass * uNight * 1.6;
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

/**
 * HD pixels (Phase 4: the cells an in-scope interior's kit leaves legacy): after `<map_fragment>`, the atlas colour is
 * xBR-smoothed at the fragment's continuous texel position inside its metatile's 24×24 atlas cell (the padding
 * replicates the edge texels, so a metatile's border reads as running on: no blend across it, no seam), blended over
 * about one screen pixel as the inflated actors' HD edges. Only where the texel footprint is under one screen pixel
 * (magnified: the pixel staircases show); minified, the plain mipmapped lookup stands. The derivatives stay outside
 * the branch (uniform control flow). Transparent texels are black: a blend with them comes out premultiplied.
 */
function injectHd(shader: THREE.WebGLProgramParametersWithUniforms): void {
  shader.fragmentShader = XBR_GLSL + afterChunk(shader.fragmentShader, 'map_fragment', `#ifdef USE_MAP
  {
    vec2 hdP = vMapUv * vec2(textureSize(map, 0));
    vec2 hdW = fwidth(hdP);
    float hdDelta = clamp(0.5 * fwidth(hdP.x + hdP.y), 0.02, 0.5);
    if (max(hdW.x, hdW.y) < 1.0) {
      vec2 hdCell = floor(hdP / ${glslFloat(CELL)}) * ${glslFloat(CELL)};
      vec4 hd = xbrSample(map, hdP, vec4(hdCell, hdCell + ${glslFloat(CELL)}), hdDelta);
      hd.rgb /= max(hd.a, 1e-4);
      diffuseColor = vec4(diffuse, opacity) * hd;
    }
  }
#endif`);
}

export interface WorldMaterialOptions {
  /** HD pixels (injectHd): the legacy quads of the cells an in-scope Modern interior's kit leaves. Program keys
   *  `world-opaque-hd`, `world-cutout-hd` (without: today's materials and keys). */
  hd?: boolean;
}

export function createWorldMaterials(atlas: THREE.Texture, u: WorldUniforms, opts: WorldMaterialOptions = {}) {
  const hd = opts.hd ?? false;
  const opaque = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.92, metalness: 0 });
  opaque.onBeforeCompile = (s) => { injectGlow(s, u); if (hd) injectHd(s); };
  opaque.customProgramCacheKey = () => (hd ? 'world-opaque-hd' : 'world-opaque');
  const cutout = new THREE.MeshStandardMaterial({
    map: atlas, vertexColors: true, roughness: 0.9, metalness: 0, alphaTest: 0.5, side: THREE.DoubleSide,
  });
  if (hd) {
    cutout.onBeforeCompile = injectHd;
    cutout.customProgramCacheKey = () => 'world-cutout-hd';
  }
  const water = new THREE.MeshStandardMaterial({ map: atlas, vertexColors: true, roughness: 0.45, metalness: 0 });
  water.onBeforeCompile = (s) => injectWater(s, u);
  water.customProgramCacheKey = () => 'world-water';
  return { opaque, cutout, water };
}

/** The HD twins of the legacy opaque and cut-out materials (createWorldMaterials with `hd`; the water stays today's):
 *  World draws the legacy quads with them where the interior kit ran (WorldMaterials.hd). */
export function createHdWorldMaterials(atlas: THREE.Texture, u: WorldUniforms): { opaque: THREE.MeshStandardMaterial; cutout: THREE.MeshStandardMaterial } {
  const m = createWorldMaterials(atlas, u, { hd: true });
  m.water.dispose();
  return { opaque: m.opaque, cutout: m.cutout };
}
