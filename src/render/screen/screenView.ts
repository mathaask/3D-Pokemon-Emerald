// Presents the raw GBA framebuffer (title, intro, menus…): aspect-fit with "sharp bilinear"
// upscaling so pixels stay crisp at any size, over an ambilight-style backdrop made from a
// heavily blurred, enlarged copy of the frame.

import * as THREE from 'three';

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tScreen;
  uniform sampler2D tBlur;
  uniform vec2 uViewport;     // drawing-buffer size in pixels
  uniform vec2 uScreenRect;   // size of the fitted GBA image in pixels
  uniform float uOpacity;
  uniform float uTime;
  varying vec2 vUv;
  const vec2 SRC = vec2(240.0, 160.0);

  vec3 sharp(vec2 uv) {
    // Sharp-bilinear: nearest inside texels, a 1-output-pixel blend at texel edges.
    vec2 texel = uv * SRC;
    vec2 scale = uScreenRect / SRC;
    vec2 base = floor(texel - 0.5) + 0.5;
    vec2 f = texel - base;
    vec2 region = 0.5 - 0.5 / scale;
    vec2 g = clamp((f - region) / (1.0 - 2.0 * region), 0.0, 1.0);
    return texture2D(tScreen, (base + g) / SRC).rgb;
  }

  void main() {
    vec2 px = vUv * uViewport;
    vec2 origin = (uViewport - uScreenRect) * 0.5;
    vec2 uv = (px - origin) / uScreenRect;
    // Ambilight backdrop: the blurred frame, enlarged around the screen, darkened and vignetted.
    vec2 buv = (uv - 0.5) * 0.62 + 0.5;
    vec3 amb = texture2D(tBlur, vec2(buv.x, 1.0 - buv.y)).rgb;
    float d = length((vUv - 0.5) * vec2(uViewport.x / uViewport.y, 1.0));
    vec3 back = amb * (0.55 - 0.35 * d) + vec3(0.01, 0.015, 0.02);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
      // soft drop shadow around the screen
      vec2 q = abs(uv - 0.5) - 0.5;
      float edge = length(max(q * uScreenRect, 0.0));
      back *= mix(0.45, 1.0, smoothstep(0.0, 40.0, edge));
      gl_FragColor = vec4(back, 1.0);
      return;
    }
    vec3 c = sharp(vec2(uv.x, 1.0 - uv.y));
    gl_FragColor = vec4(mix(back, c, uOpacity), 1.0);
  }
`;

// Separable blur used to build the ambilight texture (runs at 60x40).
const BLUR_FRAG = /* glsl */ `
  uniform sampler2D tInput;
  uniform vec2 uDir;
  varying vec2 vUv;
  void main() {
    vec3 c = vec3(0.0);
    float w = 0.0;
    for (int i = -6; i <= 6; i++) {
      float k = exp(-float(i * i) / 18.0);
      c += texture2D(tInput, vUv + uDir * float(i)).rgb * k;
      w += k;
    }
    gl_FragColor = vec4(c / w, 1.0);
  }
`;

export class ScreenView {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  readonly texture: THREE.DataTexture;
  private material: THREE.ShaderMaterial;
  private blurA = new THREE.WebGLRenderTarget(60, 40, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  private blurB = new THREE.WebGLRenderTarget(60, 40, { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter });
  private blurScene = new THREE.Scene();
  private blurMat: THREE.ShaderMaterial;
  private dirty = true;
  private frame = 0;

  constructor(framebuffer: Uint32Array) {
    this.texture = new THREE.DataTexture(
      new Uint8Array(framebuffer.buffer, framebuffer.byteOffset, framebuffer.byteLength),
      240, 160, THREE.RGBAFormat,
    );
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    // Raw sRGB bytes in, raw sRGB out: no colour-space conversion on this path.
    this.texture.flipY = false;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tScreen: { value: this.texture },
        tBlur: { value: this.blurB.texture },
        uViewport: { value: new THREE.Vector2(1, 1) },
        uScreenRect: { value: new THREE.Vector2(240, 160) },
        uOpacity: { value: 1 },
        uTime: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.blurMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: BLUR_FRAG,
      uniforms: { tInput: { value: this.texture }, uDir: { value: new THREE.Vector2(1 / 60, 0) } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat));
  }

  /** Marks the framebuffer texture for re-upload. */
  update(): void {
    this.texture.needsUpdate = true;
    this.dirty = true;
  }

  resize(width: number, height: number): void {
    // Leave a margin so the ambilight frames the screen.
    const scale = Math.min(width / 240, height / 160) * 0.94;
    this.material.uniforms.uViewport.value.set(width, height);
    this.material.uniforms.uScreenRect.value.set(Math.floor(240 * scale), Math.floor(160 * scale));
  }

  render(r: THREE.WebGLRenderer): void {
    // Refresh the blurred backdrop every few frames (it changes slowly anyway).
    if (this.dirty && this.frame++ % 3 === 0) {
      const prev = r.getRenderTarget();
      this.blurMat.uniforms.tInput.value = this.texture;
      this.blurMat.uniforms.uDir.value.set(1 / 60, 0);
      r.setRenderTarget(this.blurA);
      r.render(this.blurScene, this.camera);
      this.blurMat.uniforms.tInput.value = this.blurA.texture;
      this.blurMat.uniforms.uDir.value.set(0, 1 / 40);
      r.setRenderTarget(this.blurB);
      r.render(this.blurScene, this.camera);
      r.setRenderTarget(prev);
      this.dirty = false;
    }
    this.material.uniforms.uTime.value = performance.now() / 1000;
    r.render(this.scene, this.camera);
  }
}
