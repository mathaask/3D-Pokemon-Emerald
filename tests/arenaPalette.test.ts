import { describe, it, expect } from 'vitest';
import { arenaPalette } from '../src/render/battle/palette';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';
import { GroundMat } from '../src/render/kit/terrain';
import { luma, saturation } from '../src/render/kit/palette';

describe('arenaPalette', () => {
  it('takes the grass from the platform, leaves lush but never neon', () => {
    const p = arenaPalette('grass', defaultArenaColors('grass'));
    expect(p.groundMat).toBe(GroundMat.Grass);
    expect(saturation(p.leaf)).toBeLessThanOrEqual(0.42 + 1e-6);
    expect(luma(p.ground)).toBeGreaterThan(0.25); expect(luma(p.ground)).toBeLessThan(0.7);
    expect(luma(arenaPalette('longGrass', null).ground)).toBeLessThan(luma(arenaPalette('grass', null).ground));
  });
  it('gives each kind its ground material', () => {
    const mat = (k: Parameters<typeof arenaPalette>[0]) => arenaPalette(k, null).groundMat;
    expect([mat('sand'), mat('cave'), mat('mountain'), mat('building'), mat('gym'), mat('water')])
      .toEqual([GroundMat.Sand, GroundMat.Rock, GroundMat.Gravel, GroundMat.Deck, GroundMat.Paving, GroundMat.Sand]);
  });
  it('uses the defaults without colours and stays in gamut for every kind', () => {
    expect(arenaPalette('grass', null)).toEqual(arenaPalette('grass', defaultArenaColors('grass')));
    for (const k of ARENA_KINDS) for (const v of Object.values(arenaPalette(k, null))) {
      if (Array.isArray(v)) for (const x of v) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1); }
    }
  });
});
