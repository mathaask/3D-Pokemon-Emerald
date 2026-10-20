// Post-processing chain for the 3D views: ambient occlusion, bloom, tilt-shift depth of
// field (the "HD-2D" miniature look), colour grading + vignette, then tone mapping.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { WorldStyle } from './overworld/world';

export type Quality = 'low' | 'medium' | 'high';

export interface TiltShift {
  /** Screen-space y of the sharp band (0 bottom, 1 top). */
  focus: number;
  /** Half-height of the sharp band. */
  band: number;
  /** Largest blur radius, in pixels. */
  strength: number;
}

/** The miniature blur per world style: Modern's models read better with a gentler, wider-focused blur. */
export function tiltShiftFor(style: WorldStyle): TiltShift {
  return style === 'modern' ? { focus: 0.52, band: 0.3, strength: 1.2 } : { focus: 0.52, band: 0.22, strength: 2.2 };
}

const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uFocus: { value: 0.52 },   // screen-space y of the sharp band (0 bottom, 1 top)
    uBand: { value: 0.22 },    // half-height of the sharp band
    uStrength: { value: 2.2 }, // max blur radius in pixels
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform vec2 uDirection;
    uniform float uFocus, uBand, uStrength;
    varying vec2 vUv;
    void main() {
      float d = max(0.0, abs(vUv.y - uFocus) - uBand);
      float r = clamp(d * 4.0, 0.0, 1.0) * uStrength;
      if (r < 0.05) { gl_FragColor = texture2D(tDiffuse, vUv); return; }
      vec2 step = uDirection / uResolution * r;
      vec4 c = texture2D(tDiffuse, vUv) * 0.227027;
      c += texture2D(tDiffuse, vUv + step * 1.3846) * 0.3162162;
      c += texture2D(tDiffuse, vUv - step * 1.3846) * 0.3162162;
      c += texture2D(tDiffuse, vUv + step * 3.2308) * 0.0702703;
      c += texture2D(tDiffuse, vUv - step * 3.2308) * 0.0702703;
      gl_FragColor = c;
    }
  `,
};

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uVignette: { value: 0.32 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.05 },
    uTint: { value: new THREE.Vector3(1, 1, 1) },
    uFade: { value: new THREE.Vector4(0, 0, 0, 0) },
  },
  vertexShader: TiltShiftShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uVignette, uSaturation, uContrast;
    uniform vec3 uTint;
    uniform vec4 uFade;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.18) * uContrast + 0.18;
      vec2 p = vUv - 0.5;
      float v = 1.0 - dot(p, p) * uVignette * 2.2;
      col *= clamp(v, 0.0, 1.0);
      col = mix(max(col, 0.0), uFade.rgb, uFade.a);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

export class PostFX {
  readonly composer: EffectComposer;
  private renderPass: RenderPass;
  private ao: GTAOPass | null = null;
  private bloom: UnrealBloomPass;
  private tiltH: ShaderPass;
  private tiltV: ShaderPass;
  readonly grade: ShaderPass;
  enabled = true;
  quality: Quality;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: Quality) {
    this.quality = quality;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, {
      type: THREE.HalfFloatType,
      samples: quality === 'low' ? 0 : 4,
    });
    this.composer = new EffectComposer(renderer, target);
    // Every size given to the composer is in drawing-buffer pixels, which already include the
    // renderer's pixel ratio: it must not scale them again (4x the pixels at a ratio of 2).
    this.composer.setPixelRatio(1);
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);
    if (quality === 'high') {
      this.ao = new GTAOPass(scene, camera, size.x, size.y);
      this.ao.blendIntensity = 0.75;
      this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
      this.composer.addPass(this.ao);
    }
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.22, 0.5, 1.05);
    this.composer.addPass(this.bloom);
    this.tiltH = new ShaderPass(TiltShiftShader);
    this.tiltV = new ShaderPass(TiltShiftShader);
    this.tiltV.uniforms.uDirection.value = new THREE.Vector2(0, 1);
    if (quality !== 'low') {
      this.composer.addPass(this.tiltH);
      this.composer.addPass(this.tiltV);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setCamera(scene: THREE.Scene, camera: THREE.Camera): void {
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    if (this.ao) {
      this.ao.scene = scene;
      this.ao.camera = camera;
    }
  }

  /** Resizes every pass to `w`×`h` drawing-buffer pixels (renderer.getDrawingBufferSize). */
  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    for (const p of [this.tiltH, this.tiltV]) p.uniforms.uResolution.value.set(w, h);
  }

  /** Size in pixels of the render target the scene is drawn into (= the drawing buffer). */
  sceneTargetSize(out = new THREE.Vector2()): THREE.Vector2 {
    const rt = this.composer.renderTarget1;
    return out.set(rt.width, rt.height);
  }

  setTiltShift(focus: number, band: number, strength: number): void {
    for (const p of [this.tiltH, this.tiltV]) {
      p.uniforms.uFocus.value = focus;
      p.uniforms.uBand.value = band;
      p.uniforms.uStrength.value = strength;
    }
  }

  setEnabled(tiltShift: boolean, bloom: boolean): void {
    this.tiltH.enabled = tiltShift;
    this.tiltV.enabled = tiltShift;
    this.bloom.enabled = bloom;
  }

  setBloom(strength: number, threshold: number): void {
    this.bloom.strength = strength;
    this.bloom.threshold = threshold;
  }

  setFade(color: THREE.Color, amount: number): void {
    this.grade.uniforms.uFade.value.set(color.r, color.g, color.b, amount);
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
