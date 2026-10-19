// Gradient sky dome with drifting clouds and stars at night.

import * as THREE from 'three';

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
  uniform float uNight;
  uniform float uTime;
  uniform float uIndoor;
  varying vec3 vDir;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec3 d = normalize(vDir);
    float h = clamp(d.y, -0.2, 1.0);
    vec3 col = mix(uHorizon, uZenith, pow(max(h, 0.0), 0.55));
    if (uIndoor < 0.5) {
      // clouds
      vec2 uv = d.xz / max(0.12, d.y + 0.15) * 0.9 + vec2(uTime * 0.004, uTime * 0.002);
      float c = smoothstep(0.52, 0.8, fbm(uv * 1.4));
      vec3 cloudCol = mix(vec3(1.0), uHorizon, 0.35) * (1.0 - uNight * 0.75);
      col = mix(col, cloudCol, c * 0.55 * smoothstep(0.0, 0.25, h));
      // stars
      vec2 sp = floor(d.xz / max(0.05, d.y + 0.2) * 220.0);
      float star = step(0.9975, hash(sp)) * uNight * smoothstep(0.05, 0.4, h);
      col += vec3(star);
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }
`;

export class Sky {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        uZenith: { value: new THREE.Color(0.35, 0.6, 1.0) },
        uHorizon: { value: new THREE.Color(0.8, 0.9, 1.0) },
        uNight: { value: 0 },
        uTime: { value: 0 },
        uIndoor: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.material);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
  }

  setColors(sky: THREE.Color, fog: THREE.Color, indoor: boolean): void {
    const u = this.material.uniforms;
    const lum = sky.r * 0.3 + sky.g * 0.59 + sky.b * 0.11;
    u.uZenith.value.copy(sky).multiplyScalar(0.75).lerp(new THREE.Color(0.2, 0.45, 0.95), 0.35 * lum);
    u.uHorizon.value.copy(fog);
    u.uNight.value = THREE.MathUtils.clamp((0.5 - lum) * 3, 0, 1);
    u.uIndoor.value = indoor ? 1 : 0;
    u.uTime.value = performance.now() / 1000;
  }
}
