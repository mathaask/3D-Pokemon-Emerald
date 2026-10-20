import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { InflatedActors, ACTOR_GRID, LAMP_CEILING } from '../src/render/actors/inflatedActors';

const spec = (x: number) => ({ footX: x, footY: 0, footZ: 3, width: 1, height: 2, lift: 0, flat: false,
  slot: { u0: 0, v0: 32 / 512, u1: 16 / 1024, v1: 0 } });
const make = () => new InflatedActors(new THREE.Texture(), new THREE.Texture(), { value: new THREE.Color() });

describe('InflatedActors', () => {
  it('draws one instanced 16x32 grid per actor', () => {
    const a = make();
    a.set([spec(1), spec(2)], new THREE.Vector3(1, 0, 0));
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    expect(g.instanceCount).toBe(2);
    expect(g.getAttribute('position').count).toBe((ACTOR_GRID.x + 1) * (ACTOR_GRID.y + 1));
    expect(g.getAttribute('aFoot').getX(1)).toBe(2);
  });
  it('shares its instance buffers with a 4-vertex contact-shadow geometry', () => {
    const a = make();
    const s = a.geometryForShadows();
    a.set([spec(1)], new THREE.Vector3(1, 0, 0));
    expect(s.instanceCount).toBe(1);
    expect(s.getAttribute('aFoot')).toBe((a.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute('aFoot'));
    expect(s.getAttribute('position').count).toBe(4);
  });
  it('re-uploads only the instance attributes that changed, over every instance ever set', () => {
    const a = make();
    const g = a.mesh.geometry as THREE.InstancedBufferGeometry;
    const attr = (k: string) => g.getAttribute(k) as THREE.InstancedBufferAttribute;
    const right = new THREE.Vector3(1, 0, 0);
    a.set([spec(1), spec(2)], right);
    const v = () => ['aFoot', 'aSize', 'aUv'].map((k) => attr(k).version);
    const first = v();
    a.set([spec(1), spec(2)], right); // a still scene: nothing to upload
    expect(v()).toEqual(first);
    a.set([spec(1)], right);          // fewer actors, same data
    expect(v()).toEqual(first);
    a.set([spec(1.5)], right);        // one moved: its feet only, over both instances ever set
    expect(v()).toEqual([first[0] + 1, first[1], first[2]]);
    expect(attr('aFoot').updateRanges).toEqual([{ start: 0, count: 6 }]);
  });
  it('casts and receives shadows through a depth twin', () => {
    const a = make();
    expect(a.mesh.castShadow && a.mesh.receiveShadow).toBe(true);
    expect(a.mesh.customDepthMaterial).toBeInstanceOf(THREE.ShaderMaterial);
  });
  it('patches the standard shader chunks it relies on (catches three chunk renames)', () => {
    const s = { vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader,
      uniforms: {} } as unknown as THREE.WebGLProgramParametersWithUniforms;
    (make().mesh.material as THREE.MeshStandardMaterial).onBeforeCompile(s, null as unknown as THREE.WebGLRenderer);
    expect(s.vertexShader).toContain('tField');
    expect(s.vertexShader).not.toContain('#include <begin_vertex>');
    expect(s.vertexShader).not.toContain('#include <beginnormal_vertex>');
    expect(s.fragmentShader).toContain('discard');
    expect(s.fragmentShader).toContain('uRim');
    // the light floor and the point lights' soft ceiling (lights_pars_begin inlined and patched)
    expect(s.fragmentShader).toContain('uFloor');
    expect(s.fragmentShader).not.toContain('#include <lights_pars_begin>');
    expect(s.fragmentShader).toContain(`/ ${LAMP_CEILING.toFixed(2)};`);
  });
});
