import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { catalogueTriangle, programSignature } from '../src/render/kit/catalogue';

const shader = (frag: string, defines: Record<string, string> = {}) => new THREE.Mesh(catalogueTriangle({ position: 3 }),
  new THREE.ShaderMaterial({ vertexShader: 'void main() { gl_Position = vec4(position, 1.0); }', fragmentShader: frag, defines }));

describe('programSignature', () => {
  it('tells ShaderMaterials apart by their shaders and defines, and is the same for the same ones', () => {
    const red = 'void main() { gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0); }';
    const blue = 'void main() { gl_FragColor = vec4(0.0, 0.0, 1.0, 1.0); }';
    expect(programSignature(shader(red))).toBe(programSignature(shader(red)));
    expect(programSignature(shader(red))).not.toBe(programSignature(shader(blue)));
    expect(programSignature(shader(red, { A: '' }))).not.toBe(programSignature(shader(red)));
  });
  it('joins a material array\'s signatures in order', () => {
    const a = new THREE.MeshStandardMaterial(), b = new THREE.MeshStandardMaterial({ map: new THREE.Texture() });
    const one = (m: THREE.Material) => programSignature(new THREE.Mesh(catalogueTriangle({ position: 3 }), m)).split(' ; ')[0];
    const arr = programSignature(new THREE.Mesh(catalogueTriangle({ position: 3 }), [a, b, a])).split(' ; ')[0];
    expect(arr).toBe([one(a), one(b), one(a)].join(' + '));
  });
});
