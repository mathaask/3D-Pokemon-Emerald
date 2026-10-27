import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BATTLE_CAMERA, STAGE } from '../src/render/battle/stage';
import { FRAME_ASPECT, battleCamera, frameProjector } from '../src/render/battle/parts/scatter';
import { BATTLER_BOX, battleFrameCamera, battlerBoxes, frameRect, rectsOverlap } from '../src/render/battle/parts/frame';

describe('the battle frame (parts/frame.ts)', () => {
  it('builds the battle camera at its 24° field of view where battleCamera stands, looking at the stage', () => {
    for (const view of [0, -0.9, 0.9, { yaw: 0.45, ease: 0, zoom: 1 }, { yaw: -0.3, ease: 1, zoom: BATTLE_CAMERA.zoom[0] }]) {
      const { yaw, ease, zoom } = typeof view === 'number' ? { yaw: view, ease: 1, zoom: 1 } : view;
      const cam = battleFrameCamera(STAGE, view, FRAME_ASPECT.widest);
      expect(cam.fov).toBe(BATTLE_CAMERA.fov);
      expect(cam.aspect).toBe(FRAME_ASPECT.widest);
      const look = new THREE.Vector3(), at = battleCamera(STAGE, yaw, new THREE.Vector3(), look, ease, zoom);
      expect(cam.position.equals(at), JSON.stringify(view)).toBe(true);
      // (looking at the point battleCamera aims at: it projects to the frame's middle; its matrices are current)
      const v = look.clone().project(cam);
      expect(Math.abs(v.x) + Math.abs(v.y), JSON.stringify(view)).toBeLessThan(1e-9);
    }
    // (the default window is the shown one, 16:10)
    expect(battleFrameCamera(STAGE, 0).aspect).toBe(FRAME_ASPECT.shown);
  });

  it('projects as the frame projector does (scatter.ts frameProjector)', () => {
    const project = frameProjector(STAGE, 0.04), cam = battleFrameCamera(STAGE, 0.04), a = new THREE.Vector3(), b = new THREE.Vector3();
    for (const p of [[STAGE.player.x, 0, STAGE.player.z], [STAGE.enemy.x, 2, STAGE.enemy.z], [STAGE.centre.x + 8, -0.3, STAGE.centre.z - 12]]) {
      project(p[0], p[1], p[2], a);
      b.set(p[0], p[1], p[2]).project(cam);
      expect(a.distanceTo(b)).toBeLessThan(1e-12);
    }
  });

  it("boxes the battlers: BATTLER_BOX on each platform, player's then enemy's, as the camera at the yaw projects it", () => {
    for (const yaw of [-BATTLE_CAMERA.sway, 0, BATTLE_CAMERA.sway]) {
      const boxes = battlerBoxes(STAGE, yaw), cam = battleFrameCamera(STAGE, yaw), v = new THREE.Vector3();
      expect(boxes.length).toBe(2);
      [STAGE.player, STAGE.enemy].forEach((p, i) => {
        const B = BATTLER_BOX, r = boxes[i];
        // every corner inside the rectangle, and each of its edges reached by one
        const corners: [number, number, number][] = [];
        for (const dx of [-B.half, B.half]) for (const dz of [-B.depth, B.depth]) for (const y of [0, B.height]) corners.push([p.x + dx, y, p.z + dz]);
        const reached = [false, false, false, false];
        for (const c of corners) {
          v.set(...c).project(cam);
          expect(v.x >= r[0] && v.x <= r[2] && v.y >= r[1] && v.y <= r[3]).toBe(true);
          reached[0] ||= v.x === r[0]; reached[1] ||= v.y === r[1]; reached[2] ||= v.x === r[2]; reached[3] ||= v.y === r[3];
        }
        expect(reached).toEqual([true, true, true, true]);
        expect(r).toEqual(frameRect(cam, corners));
      });
      // (the player's stands lower left in the frame, the enemy's upper right; apart)
      const [pl, en] = boxes;
      expect(pl[0]).toBeLessThan(en[0]);
      expect(pl[1]).toBeLessThan(en[1]);
      expect(rectsOverlap(pl, en)).toBe(false);
    }
    // (an aspect of its own: a wider window, the same boxes narrower in NDC)
    expect(battlerBoxes(STAGE, 0, FRAME_ASPECT.widest)[0][2] - battlerBoxes(STAGE, 0, FRAME_ASPECT.widest)[0][0])
      .toBeLessThan(battlerBoxes(STAGE, 0)[0][2] - battlerBoxes(STAGE, 0)[0][0]);
  });

  it('overlaps rectangles that share area, not those that only touch', () => {
    expect(rectsOverlap([0, 0, 1, 1], [0.5, 0.5, 2, 2])).toBe(true);
    expect(rectsOverlap([0, 0, 1, 1], [1, 0, 2, 1])).toBe(false);
    expect(rectsOverlap([0, 0, 1, 1], [0.2, 1.5, 0.8, 2])).toBe(false);
  });
});
