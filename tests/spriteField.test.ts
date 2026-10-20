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
});
