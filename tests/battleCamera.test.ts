import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { BattleView, type BattleViewState } from '../src/render/battle/battleView';
import type { SpriteAtlas } from '../src/render/spriteAtlas';
import { BATTLE_CAMERA, STAGE } from '../src/render/battle/stage';
import { battleCamera } from '../src/render/battle/parts/scatter';

/** A BattleView on a stub atlas (no sprites) and a blank bus: its camera is what this test reads. */
function view(): BattleView {
  const atlas = { slots: new Map(), slotRects: new THREE.InstancedBufferAttribute(new Float32Array(4), 4), slotCount: 0,
    target: new THREE.WebGLRenderTarget(1024, 512) } as unknown as SpriteAtlas;
  return new BattleView(atlas);
}
const bus = { io16: new Uint16Array(0x200), ewram16: new Uint16Array(0x20000), vram16: new Uint16Array(0xc000), vram: new Uint8Array(0x18000),
  pram16: new Uint16Array(0x200) };
const state = { mem: { bus }, sprites: [], battleEnvironment: 0, battleType: 0, trainerClass: 0, mapBattleScene: 0, mapType: 0, hours: 12,
  minutes: 0, animActive: false, target: 0, battlerCopies: [] } as unknown as BattleViewState;

describe("the arena's battle camera (scatter.ts battleCamera) against BattleView's", () => {
  it('stands where BattleView puts its camera: settled at any yaw and zoom, and through the intro sweep', () => {
    const v = view(), got = new THREE.Vector3(), look = new THREE.Vector3();
    // the intro's first frame (no time yet: ease 0, no sway) at the user's yaw 0
    v.update(state, 0, { yaw: 0, pitch: 0, zoom: 0 }, []);
    expect(v.camera.position.distanceTo(battleCamera(STAGE, 0, got, look, 0))).toBeLessThan(1e-9);
    // half a second in (ease 1 − (1 − t)³, t = 0.5 / 2.2; the sway sin(0.5 · 0.25) · 0.04 is added to the yaw)
    v.update(state, 0.5, { yaw: 0, pitch: 0, zoom: 0 }, []);
    const t = 0.5 / BATTLE_CAMERA.intro.seconds, ease = 1 - (1 - t) ** 3, sway = Math.sin(0.5 * 0.25) * BATTLE_CAMERA.sway;
    expect(v.camera.position.distanceTo(battleCamera(STAGE, sway, got, look, ease))).toBeLessThan(1e-9);
    // settled (the sweep done), swung to the user's limit, zoomed in and out to theirs
    let time = 0.5;
    const settle = (dt: number, input: { yaw: number; zoom: number }) => {
      v.update(state, dt, { ...input, pitch: 0 }, []);
      time += dt;
      return Math.sin(time * 0.25) * BATTLE_CAMERA.sway;
    };
    let s = settle(3, { yaw: 5, zoom: 0 });
    expect(v.yaw).toBe(BATTLE_CAMERA.yaw);
    expect(v.camera.position.distanceTo(battleCamera(STAGE, BATTLE_CAMERA.yaw + s, got, look))).toBeLessThan(1e-9);
    s = settle(0.1, { yaw: -10, zoom: -20 });
    expect(v.zoom).toBe(BATTLE_CAMERA.zoom[0]);
    expect(v.camera.position.distanceTo(battleCamera(STAGE, -BATTLE_CAMERA.yaw + s, got, look, 1, BATTLE_CAMERA.zoom[0]))).toBeLessThan(1e-9);
    s = settle(0.1, { yaw: 0, zoom: 40 });
    expect(v.zoom).toBe(BATTLE_CAMERA.zoom[1]);
    expect(v.camera.position.distanceTo(battleCamera(STAGE, -BATTLE_CAMERA.yaw + s, got, look, 1, BATTLE_CAMERA.zoom[1]))).toBeLessThan(1e-9);
    // the point it looks at (no move playing: no focus)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(v.camera.quaternion);
    expect(dir.distanceTo(look.clone().sub(v.camera.position).normalize())).toBeLessThan(1e-9);
    expect(v.camera.fov).toBe(BATTLE_CAMERA.fov);
  });
});
