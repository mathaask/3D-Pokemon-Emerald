// Screen-space overlay: the GBA text/menu layer (from the PPU overlay pass) and
// screen-space sprites (cursors, healthboxes, icons) drawn over the 3D views.

import * as THREE from 'three';
import type { SpriteAtlas } from './spriteAtlas';
import type { SpriteSnap } from '../game/state';

const OVERLAY_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Sharp-bilinear sampling keeps the 240x160 text crisp at any scale.
const OVERLAY_FRAG = /* glsl */ `
  uniform sampler2D tOverlay;
  uniform float uScale;
  uniform float uOpacity;
  varying vec2 vUv;
  const vec2 SRC = vec2(240.0, 160.0);
  void main() {
    vec2 texel = vec2(vUv.x, 1.0 - vUv.y) * SRC;
    vec2 base = floor(texel - 0.5) + 0.5;
    vec2 f = texel - base;
    float region = 0.5 - 0.5 / uScale;
    vec2 g = clamp((f - region) / (1.0 - 2.0 * region), 0.0, 1.0);
    vec4 c = texture2D(tOverlay, (base + g) / SRC);
    if (c.a < 0.01) discard;
    gl_FragColor = vec4(c.rgb, c.a * uOpacity);
  }
`;

const SPRITE_VERT = /* glsl */ `
  attribute vec4 aRect;  // x, y (GBA px, top-left), w, h
  attribute vec4 aUv;
  varying vec2 vUv;
  void main() {
    vec2 p = aRect.xy + vec2(position.x, position.y) * aRect.zw;
    vUv = vec2(mix(aUv.x, aUv.z, position.x), mix(aUv.y, aUv.w, position.y));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p.x, -p.y, 0.0, 1.0);
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D tAtlas;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tAtlas, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb, 1.0);
    #include <colorspace_fragment>
  }
`;

const MAX_SPRITES = 128;

export class Hud {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(0, 1, 0, -1, -10, 10);
  readonly overlayTexture: THREE.DataTexture;
  private root = new THREE.Group();
  private overlayMaterial: THREE.ShaderMaterial;
  private spriteGeo: THREE.InstancedBufferGeometry;
  private rect: THREE.InstancedBufferAttribute;
  private uv: THREE.InstancedBufferAttribute;
  /** Rectangle of the GBA screen inside the viewport (CSS-independent pixels). */
  readonly fit = { x: 0, y: 0, w: 240, h: 160, scale: 1 };

  constructor(overlay: Uint32Array, atlas: SpriteAtlas) {
    this.overlayTexture = new THREE.DataTexture(
      new Uint8Array(overlay.buffer, overlay.byteOffset, overlay.byteLength), 240, 160, THREE.RGBAFormat,
    );
    this.overlayTexture.colorSpace = THREE.NoColorSpace;
    this.overlayTexture.magFilter = THREE.LinearFilter;
    this.overlayTexture.minFilter = THREE.LinearFilter;
    this.overlayTexture.flipY = false;
    this.overlayMaterial = new THREE.ShaderMaterial({
      vertexShader: OVERLAY_VERT,
      fragmentShader: OVERLAY_FRAG,
      uniforms: { tOverlay: { value: this.overlayTexture }, uScale: { value: 1 }, uOpacity: { value: 1 } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(240, 160), this.overlayMaterial);
    plane.position.set(120, -80, 0);
    plane.renderOrder = 1;
    this.root.add(plane);

    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0.5, 0.5, 0);
    this.spriteGeo = new THREE.InstancedBufferGeometry();
    this.spriteGeo.index = quad.index;
    this.spriteGeo.setAttribute('position', quad.getAttribute('position'));
    this.rect = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPRITES * 4), 4);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(MAX_SPRITES * 4), 4);
    this.rect.setUsage(THREE.DynamicDrawUsage);
    this.uv.setUsage(THREE.DynamicDrawUsage);
    this.spriteGeo.setAttribute('aRect', this.rect);
    this.spriteGeo.setAttribute('aUv', this.uv);
    this.spriteGeo.instanceCount = 0;
    const spriteMesh = new THREE.Mesh(this.spriteGeo, new THREE.ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      uniforms: { tAtlas: { value: atlas.target.texture } },
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    }));
    spriteMesh.frustumCulled = false;
    spriteMesh.renderOrder = 2;
    this.root.add(spriteMesh);
    this.scene.add(this.root);
  }

  resize(width: number, height: number): void {
    const scale = Math.min(width / 240, height / 160);
    const w = 240 * scale;
    const h = 160 * scale;
    this.fit.x = (width - w) / 2;
    this.fit.y = (height - h) / 2;
    this.fit.w = w;
    this.fit.h = h;
    this.fit.scale = scale;
    this.camera.left = 0;
    this.camera.right = width;
    this.camera.top = 0;
    this.camera.bottom = -height;
    this.camera.updateProjectionMatrix();
    this.root.position.set(this.fit.x, -this.fit.y, 0);
    this.root.scale.set(scale, scale, 1);
    this.overlayMaterial.uniforms.uScale.value = scale;
  }

  setOpacity(v: number): void {
    this.overlayMaterial.uniforms.uOpacity.value = v;
  }

  updateOverlay(): void {
    this.overlayTexture.needsUpdate = true;
  }

  /** Screen-space sprites to draw on top of the overlay (GBA coordinates). */
  setSprites(sprites: readonly SpriteSnap[], atlas: SpriteAtlas): void {
    let n = 0;
    for (const s of sprites) {
      const slot = atlas.slots.get(s.index);
      if (!slot || n >= MAX_SPRITES) continue;
      let x = s.screenX;
      let y = s.screenY;
      if (s.doubleSize) { x += s.width / 2; y += s.height / 2; }
      x = ((x % 512) + 512) % 512;
      if (x >= 240) x -= 512;
      y = ((y % 256) + 256) % 256;
      if (y >= 160) y -= 256;
      this.rect.setXYZW(n, x, y, s.width, s.height);
      this.uv.setXYZW(n, slot.u0, slot.v0, slot.u1, slot.v1);
      n++;
    }
    this.spriteGeo.instanceCount = n;
    this.rect.needsUpdate = true;
    this.uv.needsUpdate = true;
  }

  render(r: THREE.WebGLRenderer): void {
    const auto = r.autoClear;
    r.autoClear = false;
    r.render(this.scene, this.camera);
    r.autoClear = auto;
  }
}
