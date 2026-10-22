import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { pickFadeActors } from '../src/render/kit/materials';
import { createKitUniforms, FADE_CORE, kitMaterial, MAX_FADE_ACTORS, setKitFocus, setKitFocusExtra } from '../src/render/kit/materials';
import { CAMERA_PRESETS } from '../src/render/overworld/overworldView';
import { ActorLayer, type ActorFrame } from '../src/render/actors/actorLayer';
import { SpriteKind, type SpriteClassifier } from '../src/game/spriteKinds';
import type { GameState, SpriteSnap } from '../src/game/state';
import { blankSprite } from '../src/render/previewActors';

describe('pickFadeActors', () => {
  const player = new THREE.Vector3(10, 0, 10);
  it('keeps the nearest NPCs within the radius, not the player', () => {
    const feet = [{ x: 10, y: 0, z: 10 }, { x: 13, y: 0, z: 10 }, { x: 10, y: 0, z: 11 }, { x: 20, y: 0, z: 10 },
      { x: 11, y: 0, z: 12 }, { x: 8, y: 0, z: 8 }];
    expect(pickFadeActors(feet, player)).toEqual([{ x: 10, y: 0, z: 11 }, { x: 11, y: 0, z: 12 }, { x: 8, y: 0, z: 8 }]);
  });
  it('returns nothing when nobody is near', () => {
    expect(pickFadeActors([{ x: 30, y: 0, z: 30 }], player)).toEqual([]);
  });

  // ---- beyond the brief ----

  it('measures in XZ (a ledge or stairs between them does not count), at most `max` within `radius`', () => {
    expect(pickFadeActors([{ x: 10, y: 3, z: 13.5 }], player)).toEqual([{ x: 10, y: 3, z: 13.5 }]);
    expect(pickFadeActors([{ x: 14, y: 0, z: 10 }, { x: 14.01, y: 0, z: 10 }], player)).toEqual([{ x: 14, y: 0, z: 10 }]);
    const ring = [1, 2, 3].map((d) => ({ x: 10 + d, y: 0, z: 10 }));
    expect(pickFadeActors(ring, player, 2)).toEqual(ring.slice(0, 2));
    expect(pickFadeActors(ring, player, 3, 1.5)).toEqual(ring.slice(0, 1));
    // the player itself (closer than 0.01), but a character a step beside it counts
    expect(pickFadeActors([{ x: 10.005, y: 0, z: 10 }, { x: 10.5, y: 0, z: 10 }], player)).toEqual([{ x: 10.5, y: 0, z: 10 }]);
  });
});

describe('setKitFocusExtra', () => {
  // as OverworldView places the Classic camera: looking at the target + 0.9 up, from the preset's pitch and distance
  const p = CAMERA_PRESETS[0];
  const camera = new THREE.PerspectiveCamera(p.fov, 1.6, 0.1, 500);
  const look = new THREE.Vector3(10, 0.9, 10);
  camera.position.copy(look).add(new THREE.Vector3(0, Math.sin(p.pitch), Math.cos(p.pitch)).multiplyScalar(p.distance));
  camera.lookAt(look);
  camera.updateMatrixWorld();

  it("gives each NPC the player's circle at its feet (same projection as setKitFocus); unused slots radius 0", () => {
    const u = createKitUniforms();
    const npcs = [{ x: 11, y: 0, z: 8 }, { x: 8.5, y: 1, z: 12 }];
    setKitFocusExtra(u, npcs, camera, 1280, 800);
    expect(u.uFocusExtra.value).toHaveLength(MAX_FADE_ACTORS);
    npcs.forEach((n, k) => {
      const ref = createKitUniforms();
      setKitFocus(ref, new THREE.Vector3(n.x, n.y, n.z), camera, 1280, 800);
      const e = u.uFocusExtra.value[k];
      expect([e.x, e.y, e.z, e.w]).toEqual([ref.uFocusPx.value.x, ref.uFocusPx.value.y, ref.uFocusDepth.value, ref.uFadeRadius.value]);
      expect(e.w).toBeGreaterThan(0);
    });
    expect(u.uFocusExtra.value[2].w).toBe(0);
  });
  it('an empty list turns every NPC circle off (Retro, no player, nobody near)', () => {
    const u = createKitUniforms();
    expect(u.uFocusExtra.value.every((e) => e.w === 0)).toBe(true);
    setKitFocusExtra(u, [{ x: 11, y: 0, z: 8 }, { x: 9, y: 0, z: 8 }, { x: 10, y: 0, z: 7 }], camera, 1280, 800);
    expect(u.uFocusExtra.value.every((e) => e.w > 0)).toBe(true);
    setKitFocusExtra(u, [], camera, 1280, 800);
    expect(u.uFocusExtra.value.every((e) => e.w === 0)).toBe(true);
  });
});

describe('kit occlusion fade shader', () => {
  it("tests the player's circle, then every NPC circle (skipped when the first is unused), through the shared uniform", () => {
    const u = createKitUniforms();
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '#include <clipping_planes_fragment>' };
    kitMaterial(u, { fade: true }).material.onBeforeCompile(shader as never, undefined as never);
    expect(shader.fragmentShader).toContain(`uniform vec4 uFocusExtra[${MAX_FADE_ACTORS}];`);
    expect(shader.fragmentShader).toContain('if (uFadeRadius > 0.0 && vViewPosition.z < uFocusDepth - 0.6)');
    expect(shader.fragmentShader).toContain('if (uFocusExtra[0].w > 0.0)');
    expect(shader.fragmentShader).toContain(`smoothstep(e.w * ${FADE_CORE.toFixed(2)}, e.w, length(gl_FragCoord.xy - e.xy))`);
    // one object for every program (set once per frame, survives rebuilds through the material pool)
    expect(shader.uniforms.uFocusExtra).toBe(u.uFocusExtra);
  });
});

describe('ActorLayer.inflatedFeet', () => {
  const slot = { u0: 0, v0: 0.0625, u1: 0.015625, v1: 0 };
  const kinds = [SpriteKind.Upright, SpriteKind.Upright, SpriteKind.Grass, SpriteKind.Flat, SpriteKind.Upright];
  const classifier = { kind: (s: SpriteSnap) => kinds[s.index] } as unknown as SpriteClassifier;
  const atlas = { slots: new Map(kinds.map((_, i) => [i, slot])), target: { texture: new THREE.Texture() } };
  // player and an NPC (inflated), the NPC's grass overlay, a flat decal, an item ball (a model)
  const state = {
    frame: 1,
    sprites: [{ worldX: 40, worldY: 64 }, { worldX: 72, worldY: 64 }, { worldX: 72, worldY: 64 }, { worldX: 40, worldY: 80 },
      { worldX: 56, worldY: 48 }].map((p, index) => blankSprite({ index, ...p })),
    objects: [{ index: 0, spriteId: 4, graphicsId: 59, invisible: false }],
  } as unknown as GameState;
  const frame = (style: 'modern' | 'retro'): ActorFrame => ({
    style, classifier, heightAt: () => 0, hasGrassBlades: () => false,
    cameraRight: new THREE.Vector3(1, 0, 0), charLight: new THREE.Color(1, 1, 1),
  });
  const newLayer = () => new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });

  it('holds the inflated actors only: no grass overlay, flat decal or model (all of which bend the grass)', () => {
    const layer = newLayer();
    const bend = layer.update(state, frame('modern'));
    expect(bend).toHaveLength(4); // player, NPC, overlay, item ball
    expect(layer.inflatedFeet).toEqual([{ x: 2.5, y: 0, z: 3.5 }, { x: 4.5, y: 0, z: 3.5 }]);
  });
  it('is empty in Retro and while inflation is off (every character a card)', () => {
    const layer = newLayer();
    layer.update(state, frame('modern'));
    layer.update(state, frame('retro'));
    expect(layer.inflatedFeet).toEqual([]);
    layer.inflation = false;
    layer.update(state, frame('modern'));
    expect(layer.inflatedFeet).toEqual([]);
  });
});
