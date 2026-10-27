// The Modern battle's sky dome (D1: the battle camera never frames it; it shows where a wider view reaches past the arena,
// and the arena water reflects its colour, Task 8): a gradient from the look's fog colour at the horizon to a deeper
// zenith, soft clouds (the arena's CLOUD_GLSL: the very clouds whose shadows drift over the outdoor ground) lit on the
// sun's side and dimmed at night, stars at night; a flat gradient in caves, rooms and under the sea. It draws after the
// opaque arena at the far plane (xyww), depth-tested and never writing depth, without fog: its hidden pixels — all of
// them in a battle frame — are never shaded. Today's sky (overworld/sky.ts) stays the Retro battle's and the fallback's.

import * as THREE from 'three';
import { KIT_NOISE_GLSL } from '../kit/noise.glsl';
import { CLOUD_GLSL } from './clouds.glsl';
import type { ArenaLook } from './look';
import type { ArenaSetting } from './arenaKind';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uClouds;
uniform float uNight;
uniform float uTime;
varying vec3 vDir;
${KIT_NOISE_GLSL}
${CLOUD_GLSL}
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.5));
  if (uClouds > 0.0) {
    // soft clouds: white, lit on the sun's side and shaded underneath away from it, grey-blue at night
    float c = arenaClouds(skyCloudUv(d, uTime) * 1.6) * smoothstep(0.0, 0.18, h);
    float lit = 0.5 + 0.5 * dot(normalize(d.xz + vec2(1e-4)), normalize(uSunDir.xz + vec2(1e-4)));
    vec3 cloud = mix(mix(uHorizon, vec3(1.0), 0.75), uSunColor, 0.15 * lit) * (0.82 + 0.25 * lit);
    cloud = mix(cloud, uZenith * 1.6 + 0.04, uNight * 0.8);
    col = mix(col, cloud, c * 0.85);
    // stars at night, between the clouds
    vec2 sp = floor(d.xz / max(0.05, d.y + 0.2) * 220.0);
    col += vec3(step(0.9975, kitHash12(sp)) * uNight * smoothstep(0.05, 0.4, h) * (1.0 - c));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/** The settings under an open sky: clouds (and stars at night). */
const OPEN: ReadonlySet<ArenaSetting> = new Set<ArenaSetting>(['outdoor', 'water', 'sky']);
/** A deep blue the zenith leans to by day (the overworld sky's). */
const DEEP = new THREE.Color(0.2, 0.45, 0.95);
const _c = new THREE.Color();

export class BattleSky {
  readonly mesh: THREE.Mesh;   // SphereGeometry(300) BackSide, renderOrder 10 (after the opaque arena), depthTest on at the
                               // far plane (gl_Position = xyww), depthWrite off, fog off: hidden pixels are never shaded
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color(0.35, 0.6, 1.0) },
        uHorizon: { value: new THREE.Color(0.8, 0.9, 1.0) },
        uSunDir: { value: new THREE.Vector3(0, 1, 1).normalize() },
        uSunColor: { value: new THREE.Color(1, 1, 1) },
        uClouds: { value: 1 },
        uNight: { value: 0 },
        uTime: { value: 0 },
      },
      side: THREE.BackSide,
      depthTest: true,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), this.material);
    this.mesh.name = 'battleSky';
    this.mesh.renderOrder = 10;
    this.mesh.frustumCulled = false;
  }

  /** Gradient from look.fog (horizon) to a deeper look.sky (zenith); soft clouds (CLOUD_GLSL along skyCloudUv) for the
   *  outdoor, water and sky settings, lit by the sun side, dimmed at night; stars at night; flat colour for the others.
   *  `time`: the view's clock (s; the clouds drift with it, as their shadows on the ground). */
  setLook(look: ArenaLook, setting: ArenaSetting, time: number): void {
    const u = this.material.uniforms;
    const open = OPEN.has(setting);
    const sky = look.sky;
    const lum = sky.r * 0.3 + sky.g * 0.59 + sky.b * 0.11;
    (u.uZenith.value as THREE.Color).copy(sky).multiplyScalar(0.75).lerp(_c.copy(DEEP), open ? 0.35 * Math.min(1, lum) : 0);
    (u.uHorizon.value as THREE.Color).copy(look.fog);
    (u.uSunColor.value as THREE.Color).copy(look.sunColor);
    u.uClouds.value = open ? 1 : 0;
    u.uNight.value = open ? look.night : 0;
    u.uTime.value = time;
  }

  /** The sun's direction (towards it; world space): the clouds' lit side. */
  setSun(dir: THREE.Vector3): void {
    (this.material.uniforms.uSunDir.value as THREE.Vector3).copy(dir).normalize();
  }
}
