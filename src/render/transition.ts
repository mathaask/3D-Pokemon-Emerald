// Battle-entry effect drawn over the 3D overworld: two white flashes, then a rotating
// spiral wipe to black (an homage to the GBA swirl transitions).

import * as THREE from 'three';

const FRAG = /* glsl */ `
  uniform float uProgress;  // 0..1
  uniform float uAspect;
  varying vec2 vUv;
  void main() {
    vec2 p = (vUv - 0.5) * vec2(uAspect, 1.0);
    float r = length(p);
    float a = atan(p.y, p.x);
    // flashes during the first 30%
    float flash = 0.0;
    if (uProgress < 0.3) {
      float f = uProgress / 0.3 * 2.0;
      flash = pow(max(0.0, sin(f * 3.14159)), 2.0) * 0.85;
    }
    // spiral wipe after 30%
    float w = clamp((uProgress - 0.3) / 0.7, 0.0, 1.0);
    float bands = 6.0;
    float spiral = fract((a / 6.28318) * bands + r * 1.6 - w * 2.0);
    float cover = smoothstep(spiral - 0.02, spiral + 0.02, w * 1.1) * step(0.001, w);
    cover = max(cover, smoothstep(0.8, 1.0, w));
    vec3 col = mix(vec3(1.0), vec3(0.0), cover);
    float alpha = max(flash, cover);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(col, alpha);
  }
`;

export class BattleTransitionFx {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  private start = -1;
  progress = 0;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: FRAG,
      uniforms: { uProgress: { value: 0 }, uAspect: { value: 1.5 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** Advances while `active`; returns the current progress (0 when inactive). */
  update(active: boolean, now: number, aspect: number): number {
    if (!active) {
      this.start = -1;
      this.progress = 0;
      return 0;
    }
    if (this.start < 0) this.start = now;
    this.progress = Math.min(1, (now - this.start) / 1700);
    this.material.uniforms.uProgress.value = this.progress;
    this.material.uniforms.uAspect.value = aspect;
    return this.progress;
  }

  /** Compiles the effect's program (Renderer.finishPrecompile): drawn once on the current target (the canvas, as at a
   *  battle's start) at its first frame's progress, which draws nothing visible; the effect's state is left as it was. */
  precompile(r: THREE.WebGLRenderer): void {
    const u = this.material.uniforms.uProgress;
    const was = u.value;
    u.value = 0;
    const auto = r.autoClear;
    r.autoClear = false;
    try {
      r.render(this.scene, this.camera);
    } finally {
      r.autoClear = auto;
      u.value = was;
    }
  }

  render(r: THREE.WebGLRenderer): void {
    if (this.progress <= 0) return;
    const auto = r.autoClear;
    r.autoClear = false;
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }
}
