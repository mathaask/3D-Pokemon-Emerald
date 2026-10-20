import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { SpriteField } from '../src/render/actors/spriteField';

describe('SpriteField', () => {
  it('matches the atlas size and draws from the atlas slot attribute itself', () => {
    const f = new SpriteField();
    const slots = new THREE.InstancedBufferAttribute(new Float32Array(128 * 4), 4);
    const calls: unknown[] = [];
    // (extend this fake with any other renderer method the implementation calls; keep the assertions)
    const fake = { getRenderTarget: () => null, setRenderTarget: () => {}, setClearColor: () => {}, getClearColor: (c: THREE.Color) => c,
      getClearAlpha: () => 1, clear: () => {}, render: (scene: THREE.Scene) => calls.push(scene) } as unknown as THREE.WebGLRenderer;
    f.update(fake, new THREE.Texture(), slots, 3);
    expect((f.texture.image as { width: number }).width).toBe(1024);
    expect(calls).toHaveLength(4);
    const mesh = (calls[0] as THREE.Scene).children[0] as THREE.Mesh;
    const g = mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.getAttribute('aSlotSize')).toBe(slots);
    expect(g.instanceCount).toBe(3);
  });

  it("frees the caller's slot attribute only when asked (the atlas keeps drawing with its own)", () => {
    for (const release of [false, true]) {
      const f = new SpriteField();
      const slots = new THREE.InstancedBufferAttribute(new Float32Array(128 * 4), 4);
      let scene: THREE.Scene | null = null;
      const fake = { getRenderTarget: () => null, setRenderTarget: () => {}, setClearColor: () => {}, getClearColor: (c: THREE.Color) => c,
        getClearAlpha: () => 1, clear: () => {}, render: (s: THREE.Scene) => { scene ??= s; } } as unknown as THREE.WebGLRenderer;
      f.update(fake, new THREE.Texture(), slots, 1);
      const g = ((scene as unknown as THREE.Scene).children[0] as THREE.Mesh).geometry;
      // three frees the GL buffers of the attributes a geometry holds when it is disposed
      let atDispose: unknown = 'not disposed';
      g.addEventListener('dispose', () => { atDispose = g.getAttribute('aSlotSize'); });
      f.dispose(release);
      expect(atDispose).toBe(release ? slots : undefined);
    }
  });
});
