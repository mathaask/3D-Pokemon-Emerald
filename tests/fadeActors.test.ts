import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  pickFadeActors, createKitUniforms, FADE_CORE, FADE_FRONT_MARGIN, FADE_SIDE_PAD, fadeActorRamp, kitMaterial,
  MAX_FADE_ACTORS, setKitFocus, setKitFocusExtra,
} from '../src/render/kit/materials';
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
    expect(pickFadeActors(ring, player, { max: 2 })).toEqual(ring.slice(0, 2));
    expect(pickFadeActors(ring, player, { max: 3, radius: 1.5 })).toEqual(ring.slice(0, 1));
    // the player itself (closer than 0.01), but a character a step beside it counts
    expect(pickFadeActors([{ x: 10.005, y: 0, z: 10 }, { x: 10.5, y: 0, z: 10 }], player)).toEqual([{ x: 10.5, y: 0, z: 10 }]);
  });
  it('fills a reused list (no allocation per frame), nearest first, equal distances in input order', () => {
    const out: { x: number; y: number; z: number }[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }];
    const a = { x: 12, y: 0, z: 10 }, b = { x: 8, y: 0, z: 10 }, c = { x: 10, y: 0, z: 13 }, d = { x: 10, y: 0, z: 11 };
    expect(pickFadeActors([c, a, b, d], player, { max: 3, radius: 4, out })).toBe(out);
    expect(out).toEqual([d, a, b]);
    expect(out[1]).toBe(a);
    // the same as sorting every candidate by distance (stable) and keeping the first `max`
    const many = Array.from({ length: 20 }, (_, i) => ({ x: 10 + ((i * 7) % 5) - 2, y: 0, z: 10 + ((i * 3) % 4) - 2 }));
    const d2 = (p: { x: number; z: number }) => (p.x - 10) ** 2 + (p.z - 10) ** 2;
    const ref = many.filter((p) => d2(p) >= 1e-4 && d2(p) <= 9).sort((p, q) => d2(p) - d2(q)).slice(0, 5);
    expect(pickFadeActors(many, player, { max: 5, radius: 3, out })).toEqual(ref);
    expect(out.every((p, i) => p === ref[i])).toBe(true);
    // nobody in reach: the shared empty list, `out` untouched (its length never drops to 0)
    const none = pickFadeActors([{ x: 30, y: 0, z: 30 }], player, { out });
    expect(none).toEqual([]);
    expect(none).not.toBe(out);
    expect(out).toHaveLength(5);
    expect(pickFadeActors([a], player, { out })).toBe(out);
    expect(out).toEqual([a]);
  });
});

describe('fadeActorRamp', () => {
  it('is full up to 3 cells and weakens smoothly to 0 at 4 (no NPC fade pops in or out)', () => {
    expect([0, 1, 2.5, 3].map(fadeActorRamp)).toEqual([1, 1, 1, 1]);
    expect(fadeActorRamp(3.5)).toBeCloseTo(0.5);
    expect(fadeActorRamp(3.25)).toBeCloseTo(1 - 0.15625);
    expect([4, 4.5].map(fadeActorRamp)).toEqual([0, 0]);
  });
});

describe('setKitFocusExtra', () => {
  // as OverworldView places the camera: looking at the target + 0.9 up, from a preset's pitch (+ the user's offset),
  // distance and zoom, turned by `yaw` about the target
  const cameraFor = (preset = 0, pitchOffset = 0, yaw = 0, zoom = 1) => {
    const p = CAMERA_PRESETS[preset];
    const pitch = p.pitch + pitchOffset;
    const cam = new THREE.PerspectiveCamera(p.fov, 1.6, 0.1, 500);
    const look = new THREE.Vector3(10, 0.9, 10);
    cam.position.copy(look).add(new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(p.distance * zoom));
    cam.lookAt(look);
    cam.updateMatrixWorld();
    return cam;
  };
  const camera = cameraFor();
  const circleOf = (n: { x: number; y: number; z: number }, cam = camera) => {
    const ref = createKitUniforms();
    setKitFocus(ref, new THREE.Vector3(n.x, n.y, n.z), cam, 1280, 800);
    return [ref.uFocusPx.value.x, ref.uFocusPx.value.y, ref.uFocusDepth.value, ref.uFadeRadius.value];
  };
  /** Target px of a world point. */
  const px = (v: THREE.Vector3, cam: THREE.Camera) => {
    const q = v.clone().project(cam);
    return new THREE.Vector2((q.x * 0.5 + 0.5) * 1280, (q.y * 0.5 + 0.5) * 800);
  };

  it("gives each NPC the player's circle at its feet (same projection as setKitFocus; its core widened to hold the card), its foot along the camera's back direction and full strength; unused slots radius 0", () => {
    const u = createKitUniforms();
    const npcs = [{ x: 11, y: 0, z: 8 }, { x: 8.5, y: 1, z: 12, halfWidth: 1 }];
    setKitFocusExtra(u, npcs, camera, 1280, 800);
    expect(u.uFocusExtra.value).toHaveLength(MAX_FADE_ACTORS);
    npcs.forEach((n, k) => {
      const e = u.uFocusExtra.value[k];
      expect([e.x, e.y, e.z]).toEqual(circleOf(n).slice(0, 3));
      // (max(0.69 × its projected height, the card's half-diagonal / FADE_CORE): wider for the 32-px wide sprite)
      expect(e.w).toBeGreaterThanOrEqual(circleOf(n)[3]);
      expect(e.w).toBeGreaterThan(0);
      const f = u.uFocusExtraFoot.value[k];
      expect(f.x).toBe(n.z); // (the back direction at yaw 0: +Z, exactly)
      expect(f.w).toBe(1);
    });
    expect(u.uFocusExtraFoot.value[1].y).toBeGreaterThan(1.9 * u.uFocusExtraFoot.value[0].y); // a 32-px wide sprite
    expect(u.uFocusExtra.value[2].w).toBe(0);
    // the rectangle holding what both can clear: each circle cut to its sprite's leaning band (pad and soft edge)
    const [a, b] = u.uFocusExtra.value;
    const side = (k: number) => {
      const e = u.uFocusExtra.value[k], f = u.uFocusExtraFoot.value[k];
      return Math.min(e.w, f.y + (FADE_SIDE_PAD + 1 - FADE_CORE + Math.abs(f.z)) * e.w);
    };
    expect(side(0)).toBeLessThan(a.w);
    expect(u.uFocusExtraBox.value.toArray()).toEqual([Math.min(a.x - side(0), b.x - side(1)), Math.min(a.y - a.w, b.y - b.w),
      Math.max(a.x + side(0), b.x + side(1)), Math.max(a.y + a.w, b.y + b.w)]);
  });
  it("measures each foot along the camera's horizontal back direction (uCamBack): in front of the NPC from any yaw", () => {
    const u = createKitUniforms();
    const yaw = 0.9;
    u.uCamBack.value.set(Math.sin(yaw), Math.cos(yaw));
    const n = { x: 11, y: 0, z: 8 };
    setKitFocusExtra(u, [n], cameraFor(0, 0, yaw), 1280, 800);
    expect(u.uFocusExtraFoot.value[0].x).toBeCloseTo(n.x * Math.sin(yaw) + n.z * Math.cos(yaw), 12);
  });
  it('spans the whole sprite card in its leaning band and the core of its circle, from every camera (preset, pitch offset, yaw, zoom) and screen position', () => {
    for (const preset of [0, 1, 2, 3]) {
      for (const pitchOffset of [-0.5, 0, 0.3, 0.5]) {
        for (const yaw of [0, 0.9, Math.PI]) {
          for (const zoom of [0.45, 1, 2.5]) {
            const cam = cameraFor(preset, pitchOffset, yaw, zoom);
            for (const [dx, dz, halfWidth] of [[0, 0, 0.5], [3, 0, 0.5], [-2, -2, 0.5], [2, 3, 0.5], [-3, 1, 1]]) {
              const n = { x: 10 + dx, y: 0, z: 10 + dz, halfWidth };
              const u = createKitUniforms();
              setKitFocusExtra(u, [n], cam, 1280, 800);
              const e = u.uFocusExtra.value[0], f = u.uFocusExtraFoot.value[0];
              if (e.w >= 400) continue; // (capped: a character filling the screen)
              const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
              // the card's corners and edge midpoints: feet, middle and head, each at ± its half-width
              for (const up of [0, 1, 2]) {
                for (const s of [-1, 1]) {
                  const q = px(new THREE.Vector3(n.x, n.y + up, n.z).addScaledVector(right, s * halfWidth), cam);
                  const dpx = q.x - e.x, dpy = q.y - e.y;
                  const where = `preset ${preset} pitch ${pitchOffset} yaw ${yaw} zoom ${zoom} npc (${dx}, ${dz}) up ${up} side ${s}`;
                  expect(Math.abs(dpx - f.z * dpy), where).toBeLessThanOrEqual(f.y * (1 + 1e-9) + 1e-6);
                  // fully faded there, not in the circle's soft edge: the core (FADE_CORE of the radius) holds the card
                  expect(Math.hypot(dpx, dpy), where).toBeLessThanOrEqual(FADE_CORE * e.w * (1 + 1e-9) + 1e-6);
                }
              }
            }
          }
        }
      }
    }
  });
  it('an empty list turns every NPC circle off (Retro, no player, nobody near), their rectangle empty', () => {
    const u = createKitUniforms();
    const empty = () => u.uFocusExtraBox.value.x > u.uFocusExtraBox.value.z && u.uFocusExtraBox.value.y > u.uFocusExtraBox.value.w;
    expect(u.uFocusExtra.value.every((e) => e.w === 0)).toBe(true);
    expect(empty()).toBe(true);
    setKitFocusExtra(u, [{ x: 11, y: 0, z: 8 }, { x: 9, y: 0, z: 8 }, { x: 10, y: 0, z: 7 }], camera, 1280, 800);
    expect(u.uFocusExtra.value.every((e) => e.w > 0)).toBe(true);
    expect(empty()).toBe(false);
    setKitFocusExtra(u, [], camera, 1280, 800);
    expect(u.uFocusExtra.value.every((e) => e.w === 0)).toBe(true);
    expect(empty()).toBe(true);
  });
  it("ramps each NPC's strength (not its window) by its distance from the player, leaving out one ramped to 0", () => {
    const u = createKitUniforms();
    const player = new THREE.Vector3(10, 0, 10);
    const near = { x: 12, y: 0, z: 10 }, edge = { x: 10, y: 0, z: 13.5 }, out = { x: 14, y: 0, z: 10 };
    setKitFocusExtra(u, [near, out, edge], camera, 1280, 800, player);
    const [a, b, c] = u.uFocusExtra.value;
    // full circles: the window keeps the sprite's size (as without a player: no ramp)
    const unramped = createKitUniforms();
    setKitFocusExtra(unramped, [near, edge], camera, 1280, 800);
    expect(a.toArray()).toEqual(unramped.uFocusExtra.value[0].toArray());
    expect(b.toArray()).toEqual(unramped.uFocusExtra.value[1].toArray());
    const [fa, fb] = u.uFocusExtraFoot.value;
    expect(fa.w).toBe(1); // 2 cells: full strength
    expect(fb.w).toBeCloseTo(0.5); // 3.5 cells: half
    expect([fa.x, fb.x]).toEqual([near.z, edge.z]);
    expect(c.w).toBe(0); // the one at 4 cells is left out (the slots stay filled in order)
  });
});

describe('kit occlusion fade shader', () => {
  const shaderOf = () => {
    const u = createKitUniforms();
    const shader = { uniforms: {} as Record<string, unknown>, vertexShader: '', fragmentShader: '#include <clipping_planes_fragment>' };
    kitMaterial(u, { fade: true }).material.onBeforeCompile(shader as never, undefined as never);
    return { u, shader };
  };
  it("tests the player's circle as in Phase 1, then (inside their rectangle) every NPC circle up to the first unused one", () => {
    const { u, shader } = shaderOf();
    expect(shader.fragmentShader).toContain(`uniform vec4 uFocusExtra[${MAX_FADE_ACTORS}];`);
    expect(shader.fragmentShader).toContain(`uniform vec4 uFocusExtraFoot[${MAX_FADE_ACTORS}];`);
    expect(shader.fragmentShader).toContain('uniform vec2 uCamBack;');
    // the player's test, unchanged
    expect(shader.fragmentShader).toContain('if (uFadeRadius > 0.0 && vViewPosition.z < uFocusDepth - 0.6) {');
    expect(shader.fragmentShader).toContain(
      `1.0 - smoothstep(uFadeRadius * ${FADE_CORE.toFixed(2)}, uFadeRadius, length(gl_FragCoord.xy - uFocusPx));`);
    expect(shader.fragmentShader).toContain('if (kf > 0.0 && kitBayer4(gl_FragCoord.xy) < kf * 0.9) discard;');
    expect(shader.fragmentShader).toContain('all(greaterThan(gl_FragCoord.xy, uFocusExtraBox.xy)) && all(lessThan(gl_FragCoord.xy, uFocusExtraBox.zw))');
    expect(shader.fragmentShader).toContain('if (e.w <= 0.0) break;');
    expect(shader.fragmentShader).toContain(`smoothstep(e.w * ${FADE_CORE.toFixed(2)}, e.w, sqrt(d2))`);
    // one object per uniform for every program (set once per frame, survives rebuilds through the material pool)
    expect(shader.uniforms.uFocusExtra).toBe(u.uFocusExtra);
    expect(shader.uniforms.uFocusExtraBox).toBe(u.uFocusExtraBox);
    expect(shader.uniforms.uFocusExtraFoot).toBe(u.uFocusExtraFoot);
    expect(shader.uniforms.uCamBack).toBe(u.uCamBack);
  });
  it('an NPC circle fades only what covers the NPC (in front of it along the camera, over its leaning sprite band), by its strength', () => {
    const { shader } = shaderOf();
    expect(FADE_FRONT_MARGIN).toBeGreaterThan(0);
    expect(shader.fragmentShader).toContain(
      `if (d2 < e.w * e.w && vViewPosition.z < e.z - 0.6 && dot(vKitWorld.xz, uCamBack) > f.x + ${FADE_FRONT_MARGIN.toFixed(2)})`);
    expect(shader.fragmentShader).toContain(`float side = f.y + e.w * ${FADE_SIDE_PAD.toFixed(2)};`);
    expect(shader.fragmentShader).toContain(`kf = max(kf, f.w * (1.0 - smoothstep(e.w * ${FADE_CORE.toFixed(2)}, e.w, sqrt(d2)))`);
    expect(shader.fragmentShader).toContain(
      `* (1.0 - smoothstep(side, side + e.w * ${(1 - FADE_CORE).toFixed(2)}, abs(dp.x - f.z * dp.y))));`);
  });
  it("the camera's back direction defaults to +Z (yaw 0)", () => {
    expect(createKitUniforms().uCamBack.value.toArray()).toEqual([0, 1]);
  });
});

describe('ActorLayer.inflatedFeet', () => {
  const slot = { u0: 0, v0: 0.0625, u1: 0.015625, v1: 0 };
  const kinds = [SpriteKind.Upright, SpriteKind.Upright, SpriteKind.Grass, SpriteKind.Flat, SpriteKind.Upright, SpriteKind.Upright];
  const classifier = { kind: (s: SpriteSnap) => kinds[s.index] } as unknown as SpriteClassifier;
  const atlas = { slots: new Map(kinds.map((_, i) => [i, slot])), target: { texture: new THREE.Texture() } };
  // player and an NPC (inflated object events), the NPC's grass overlay, a flat decal, an item ball (a model), and an
  // upright field-effect sprite (no object event: inflated, but no NPC)
  const state = {
    frame: 1,
    sprites: [{ worldX: 40, worldY: 64 }, { worldX: 72, worldY: 64 }, { worldX: 72, worldY: 64 }, { worldX: 40, worldY: 80 },
      { worldX: 56, worldY: 48 }, { worldX: 24, worldY: 64 }].map((p, index) => blankSprite({ index, ...p })),
    objects: [
      { index: 0, spriteId: 0, graphicsId: 0, invisible: false }, { index: 1, spriteId: 1, graphicsId: 9, invisible: false },
      { index: 2, spriteId: 4, graphicsId: 59, invisible: false },
    ],
  } as unknown as GameState;
  const frame = (style: 'modern' | 'retro'): ActorFrame => ({
    style, classifier, heightAt: () => 0, hasGrassBlades: () => false,
    cameraRight: new THREE.Vector3(1, 0, 0), charLight: new THREE.Color(1, 1, 1),
  });
  const newLayer = () => new ActorLayer(atlas, { field: { texture: new THREE.Texture() }, kit: createKitUniforms() });

  it('holds the inflated object events only: no grass overlay, flat decal, model or field-effect sprite', () => {
    const layer = newLayer();
    const bend = layer.update(state, frame('modern'));
    expect(bend).toHaveLength(5); // player, NPC, overlay, item ball, field effect
    expect(layer.counts()).toMatchObject({ inflated: 3, models: 1 });
    expect(layer.inflatedFeet).toEqual([{ x: 2.5, y: 0, z: 3.5, halfWidth: 0.5 }, { x: 4.5, y: 0, z: 3.5, halfWidth: 0.5 }]);
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
