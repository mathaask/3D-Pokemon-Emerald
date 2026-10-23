import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { battleRoute, battleCardSpec, isBattler, BattleActors } from '../src/render/battle/battleActors';
import { STAGE, REF_PITCH } from '../src/render/battle/stage';
import { blankSprite } from '../src/render/previewActors';
import { SYM } from '../src/game/symbols';

const slot = { u0: 0, v0: 0.125, u1: 0.0625, v1: 0 };
const battler = (index: number, screenX: number, screenY: number) => blankSprite({ index, template: SYM.gMultiuseSpriteTemplate,
  width: 64, height: 64, affine: true, coordOffset: false, screenX, screenY });
const effect = (index: number, screenX: number) => blankSprite({ index, template: 0x08590000, width: 32, height: 32, coordOffset: false, screenX, screenY: 40 });

describe('battleCardSpec (today\'s placement)', () => {
  it('stands a battler on its side\'s depth plane, stretched by 1/cos(pitch)', () => {
    const s = battleCardSpec(battler(0, 40, 53), slot, STAGE);
    const centre = STAGE.at(72, 85, STAGE.playerDepth);
    const h = 2 / Math.cos(REF_PITCH);
    expect(s).toMatchObject({ width: 2, lift: 0, flat: false });
    expect(s.height).toBeCloseTo(h, 6);
    expect(s.footX).toBeCloseTo(centre.x, 6); expect(s.footY).toBeCloseTo(centre.y - h / 2, 6); expect(s.footZ).toBeCloseTo(centre.z, 6);
  });
  it('interpolates an effect\'s depth between the platforms and wraps screen x like the GBA', () => {
    const mid = (STAGE.playerDepth + STAGE.enemyDepth) / 2;
    expect(battleCardSpec(effect(1, 108), slot, STAGE).footZ).toBeCloseTo(STAGE.at(124, 56, mid).z, 6);
    expect(battleCardSpec(effect(1, 500), slot, STAGE).footX).toBeCloseTo(STAGE.at(-12 + 16, 56, STAGE.playerDepth).x, 6);
  });
});

describe('battleRoute', () => {
  it('Task 4: Retro and Modern both draw every visible non-HUD sprite as a card until Task 5 routes it', () => {
    expect(isBattler(battler(0, 40, 53))).toBe(true);
    const shadow = blankSprite({ index: 2, template: SYM.gSpriteTemplate_EnemyShadow, width: 32, height: 8, coordOffset: false, screenX: 160, screenY: 65 });
    for (const style of ['retro', 'modern'] as const) {
      expect(battleRoute(battler(0, 40, 53), style, true)).toBe('card');
      expect(battleRoute({ ...battler(0, 40, 53), objMode: 2 }, style, true)).toBe('card');   // an OBJ-window clone: today's card
      expect(battleRoute(shadow, style, true)).toBe('card');
      expect(battleRoute(effect(1, 108), style, true)).toBe('card');
      expect(battleRoute(blankSprite({ invisible: true }), style, true)).toBe('skip');
    }
    expect(battleRoute(blankSprite({ template: 0x0832c140 }), 'modern', true)).toBe('hud');   // a healthbox
  });
});

describe('BattleActors', () => {
  it('draws today\'s cards in sprite order and hands HUD sprites back', () => {
    const atlas = { slots: new Map([[0, slot], [1, slot], [2, slot]]), target: { texture: new THREE.Texture() } };
    const a = new BattleActors(atlas);
    const hud: ReturnType<typeof blankSprite>[] = [];
    const hb = blankSprite({ index: 2, template: 0x0832c140 });
    a.update([battler(0, 40, 53), effect(1, 108), hb], 'retro', new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 3, 11), new THREE.Color(1, 1, 1), hud);
    expect(a.counts()).toEqual({ cards: 2, inflated: 0, decals: 0 });
    expect(hud).toEqual([hb]);
  });
});
