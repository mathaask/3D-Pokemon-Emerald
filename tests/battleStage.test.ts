import { describe, it, expect } from 'vitest';
import { STAGE, PX, REF_PITCH } from '../src/render/battle/stage';

describe('the battle stage (reference projection)', () => {
  it('puts the player platform at the origin and the enemy one 1/sin(pitch) per screen unit behind', () => {
    expect(STAGE.player.length()).toBeCloseTo(0, 6);
    expect(STAGE.enemy.x).toBeCloseTo((176 - 64) / PX, 6);
    expect(STAGE.enemy.y).toBeCloseTo(0, 6);
    expect(STAGE.enemy.z).toBeCloseTo(-((117 - 64) / PX) / Math.sin(REF_PITCH), 4);   // −4.072
    expect(STAGE.centre.x).toBeCloseTo(STAGE.enemy.x / 2, 6);
  });
  it('un-projects a screen point at a depth onto its reference ray', () => {
    const p = STAGE.at(120, 80, STAGE.playerDepth);
    expect(STAGE.depthOf(p)).toBeCloseTo(STAGE.playerDepth, 6);
    expect(STAGE.groundHit(64, 117).length()).toBeCloseTo(0, 6);
  });
});
