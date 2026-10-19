// 3D weather driven by the game's current weather (gWeather.currWeather): rain, thunder,
// downpour, volcanic ash, sandstorm, snow, underwater bubbles. Particles are animated entirely
// in the vertex shader inside a box that follows the camera target.

import * as THREE from 'three';

export const WEATHER = {
  NONE: 0, SUNNY_CLOUDS: 1, SUNNY: 2, RAIN: 3, SNOW: 4, RAIN_THUNDERSTORM: 5, FOG_HORIZONTAL: 6,
  VOLCANIC_ASH: 7, SANDSTORM: 8, FOG_DIAGONAL: 9, UNDERWATER: 10, SHADE: 11, DROUGHT: 12, DOWNPOUR: 13,
  UNDERWATER_BUBBLES: 14, ABNORMAL: 15,
} as const;

interface Profile {
  count: number;
  velocity: THREE.Vector3;
  size: number;
  stretch: number;      // elongation along velocity (rain streaks)
  color: THREE.Color;
  alpha: number;
  wobble: number;
  box: THREE.Vector3;
}

const PROFILES: Record<string, Profile> = {
  rain: { count: 3200, velocity: new THREE.Vector3(1.2, -22, 2.5), size: 0.018, stretch: 0.03, color: new THREE.Color(0.75, 0.85, 1.0), alpha: 0.55, wobble: 0, box: new THREE.Vector3(44, 22, 40) },
  downpour: { count: 6000, velocity: new THREE.Vector3(2.5, -30, 4), size: 0.02, stretch: 0.028, color: new THREE.Color(0.7, 0.8, 0.95), alpha: 0.6, wobble: 0, box: new THREE.Vector3(44, 22, 40) },
  ash: { count: 1800, velocity: new THREE.Vector3(0.6, -1.4, 0.3), size: 0.09, stretch: 0, color: new THREE.Color(0.55, 0.55, 0.55), alpha: 0.85, wobble: 0.6, box: new THREE.Vector3(40, 16, 36) },
  snow: { count: 1800, velocity: new THREE.Vector3(0.3, -1.6, 0.2), size: 0.08, stretch: 0, color: new THREE.Color(1, 1, 1), alpha: 0.9, wobble: 0.8, box: new THREE.Vector3(40, 16, 36) },
  sand: { count: 5000, velocity: new THREE.Vector3(14, -0.6, 2), size: 0.02, stretch: 0.012, color: new THREE.Color(0.86, 0.68, 0.42), alpha: 0.55, wobble: 1.5, box: new THREE.Vector3(44, 8, 40) },
  bubbles: { count: 500, velocity: new THREE.Vector3(0, 1.8, 0), size: 0.1, stretch: 0, color: new THREE.Color(0.8, 0.95, 1), alpha: 0.5, wobble: 0.5, box: new THREE.Vector3(30, 12, 30) },
};

const VERT = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec3 aSeed;       // 0..1 random position in the box
  attribute float aPhase;
  uniform float uTime;
  uniform vec3 uOrigin;       // box centre (follows the camera target)
  uniform vec3 uBox;
  uniform vec3 uVelocity;
  uniform float uSize;
  uniform float uStretch;
  uniform float uWobble;
  uniform vec3 uCamRight;
  varying vec2 vLocal;
  varying float vNear;
  void main() {
    vec3 p = aSeed * uBox + uVelocity * (uTime + aPhase * 10.0);
    p.x += sin(uTime * 1.3 + aPhase * 40.0) * uWobble;
    p.z += cos(uTime * 1.1 + aPhase * 30.0) * uWobble;
    // wrap into a box centred on the origin
    p = mod(p - uOrigin + uBox * 0.5, uBox) - uBox * 0.5 + uOrigin;
    vec3 dir = normalize(uVelocity);
    vec3 side = normalize(cross(dir, normalize(cameraPosition - p)));
    vec3 along = dir * (uSize + length(uVelocity) * uStretch);
    vec3 world;
    if (uStretch > 0.0) world = p + side * position.x * uSize + along * position.y;
    else world = p + uCamRight * position.x * uSize * 2.0 + vec3(0.0, 1.0, 0.0) * position.y * uSize * 2.0;
    vLocal = position.xy * 2.0;
    // fade particles that pass right in front of the camera
    vNear = smoothstep(3.0, 9.0, distance(p, cameraPosition));
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const FRAG = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform vec3 uColor;
  uniform float uAlpha;
  uniform float uRound;
  varying vec2 vLocal;
  varying float vNear;
  void main() {
    float a = uAlpha * vNear;
    if (uRound > 0.5) {
      float d = length(vLocal);
      if (d > 1.0) discard;
      a *= smoothstep(1.0, 0.4, d);
    }
    gl_FragColor = vec4(uColor, a);
    #include <fog_fragment>
  }
`;

export class Weather {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private material: THREE.ShaderMaterial | null = null;
  private current = '';
  private time = 0;
  /** 0..1 lightning flash intensity (read by the lighting code). */
  flash = 0;
  private nextBolt = 4;

  private build(kind: string): void {
    if (this.mesh) {
      this.group.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.material?.dispose();
      this.mesh = null;
      this.material = null;
    }
    this.current = kind;
    const p = PROFILES[kind];
    if (!p) return;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    const seeds = new Float32Array(p.count * 3);
    const phases = new Float32Array(p.count);
    for (let i = 0; i < p.count; i++) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
      phases[i] = Math.random();
    }
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    g.instanceCount = p.count;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 },
        uOrigin: { value: new THREE.Vector3() },
        uBox: { value: p.box.clone() },
        uVelocity: { value: p.velocity.clone() },
        uSize: { value: p.size },
        uStretch: { value: p.stretch },
        uWobble: { value: p.wobble },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uColor: { value: p.color.clone() },
        uAlpha: { value: p.alpha },
        uRound: { value: p.stretch > 0 ? 0 : 1 },
      }]),
      transparent: true,
      depthWrite: false,
      fog: true,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.group.add(this.mesh);
  }

  static kindFor(weather: number, indoor: boolean): string {
    if (indoor) return '';
    switch (weather) {
      case WEATHER.RAIN: case WEATHER.RAIN_THUNDERSTORM: return 'rain';
      case WEATHER.DOWNPOUR: return 'downpour';
      case WEATHER.VOLCANIC_ASH: return 'ash';
      case WEATHER.SNOW: return 'snow';
      case WEATHER.SANDSTORM: return 'sand';
      case WEATHER.UNDERWATER_BUBBLES: return 'bubbles';
      default: return '';
    }
  }

  update(weather: number, indoor: boolean, dt: number, target: THREE.Vector3, camRight: THREE.Vector3): void {
    const kind = Weather.kindFor(weather, indoor);
    if (kind !== this.current) this.build(kind);
    this.time += dt;
    if (this.material) {
      const u = this.material.uniforms;
      u.uTime.value = this.time;
      u.uOrigin.value.copy(target).add(new THREE.Vector3(0, 6, 0));
      u.uCamRight.value.copy(camRight);
    }
    // Lightning for thunderstorms and downpours.
    const stormy = !indoor && (weather === WEATHER.RAIN_THUNDERSTORM || weather === WEATHER.DOWNPOUR);
    this.flash = Math.max(0, this.flash - dt * 3.5);
    if (stormy) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.flash = 1;
        this.nextBolt = 5 + Math.random() * 10;
        if (Math.random() < 0.4) setTimeout(() => { this.flash = 0.8; }, 180);
      }
    }
  }
}
