import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { BattleView, TODAY_LIGHT, TODAY_LIGHTS, type BattleViewState } from '../src/render/battle/battleView';
import { BattleArena } from '../src/render/battle/arena';
import { GROUND_Y, PLATFORM_FOOTPRINT, STAGE } from '../src/render/battle/stage';
import type { SpriteAtlas } from '../src/render/spriteAtlas';

/** A Retro BattleView on a stub atlas and a blank bus (today's arena draws: its speckle textures on a stub canvas). */
function retroView(): BattleView {
  const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {}, fillRect: () => {} };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
  const atlas = { slots: new Map(), slotRects: new THREE.InstancedBufferAttribute(new Float32Array(4), 4), slotCount: 0,
    target: new THREE.WebGLRenderTarget(1024, 512) } as unknown as SpriteAtlas;
  const v = new BattleView(atlas);
  v.setWorldStyle('retro');
  return v;
}
const bus = { io16: new Uint16Array(0x200), ewram16: new Uint16Array(0x20000), vram16: new Uint16Array(0xc000), vram: new Uint8Array(0x18000),
  pram16: new Uint16Array(0x200) };
const state = (battleEnvironment: number, hours: number) => ({ mem: { bus }, sprites: [], battleEnvironment, battleType: 0, trainerClass: 0,
  mapBattleScene: 0, mapType: 0, hours, minutes: 0, animActive: false, target: 0, battlerCopies: [] }) as unknown as BattleViewState;

afterEach(() => { vi.unstubAllGlobals(); });

describe("today's battle light (the Retro look): one table", () => {
  it('lights the Retro battle by TODAY_LIGHTS — by day, at night, in a room — under today\'s hemisphere colours and fog range', () => {
    // (environment 9 PLAIN at noon and at 03:00, 8 BUILDING at 03:00: a room has no night)
    for (const [env, hours, light] of [[9, 12, 'day'], [9, 3, 'night'], [8, 3, 'room']] as const) {
      const v = retroView(), x = v as unknown as { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight };
      v.update(state(env, hours), 0.016, { yaw: 0, pitch: 0, zoom: 0 }, []);
      const t = TODAY_LIGHTS[light];
      expect(x.sun.intensity, light).toBe(t.sunI);
      expect(x.sun.color.getHex(), light).toBe(t.sunColor);
      expect(x.hemi.intensity, light).toBe(t.hemiI);
      expect([x.hemi.color.getHex(), x.hemi.groundColor.getHex()]).toEqual([0xcfe8ff, 0x55603a]);
      const fog = v.scene.fog as THREE.Fog;
      expect([fog.near, fog.far]).toEqual([40, 120]);
    }
  });

  it("TODAY_LIGHT (the Modern battlers' exposure target) is the luminance of the light the Retro battle gives its cards", () => {
    for (const [env, hours, light] of [[9, 12, 'day'], [9, 3, 'night'], [8, 3, 'room'], [7, 21, 'room']] as const) {
      const v = retroView();
      v.update(state(env, hours), 0.016, { yaw: 0, pitch: 0, zoom: 0 }, []);
      const c = (v as unknown as { charLight: THREE.Color }).charLight;
      expect(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b, `${light} (environment ${env})`).toBeCloseTo(TODAY_LIGHT[light], 12);
    }
    // (today's values: the table moved them, it did not change them)
    expect(TODAY_LIGHTS).toEqual({ day: { sunI: 2.4, sunColor: 0xfff3e0, hemiI: 1.15 }, night: { sunI: 0.6, sunColor: 0x9fb3ff, hemiI: 0.7 },
      room: { sunI: 1.6, sunColor: 0xfff3e0, hemiI: 1.6 } });
  });
});

describe("today's arena against the stage's copies of it (GROUND_Y, PLATFORM_FOOTPRINT)", () => {
  it('stands at GROUND_Y, and its platforms have the footprints the Modern arena keeps clear', () => {
    const arena = new BattleArena();
    expect(arena.group.position.y).toBe(GROUND_Y);
    arena.setPlatforms(STAGE.player, STAGE.enemy);
    const platforms = arena.group.children.filter((o): o is THREE.Mesh => (o as THREE.Mesh).geometry instanceof THREE.CylinderGeometry);
    expect(platforms).toHaveLength(2);
    for (const [mesh, centre, fp] of [[platforms[0], STAGE.player, PLATFORM_FOOTPRINT.player], [platforms[1], STAGE.enemy, PLATFORM_FOOTPRINT.enemy]] as const) {
      const r = (mesh.geometry as THREE.CylinderGeometry).parameters.radiusTop;
      expect([mesh.position.x, mesh.position.z]).toEqual([centre.x, centre.z]);
      expect(r).toBe(fp.rx);
      expect(r * mesh.scale.z).toBe(fp.rz);
    }
  });
});
