import { describe, it, expect } from 'vitest';
import { parseSettings } from '../src/ui/settings';
import { parseSpriteFilter } from '../src/render/actors/actorLayer';

describe('saved settings', () => {
  it('defaults when nothing is saved, or the save is not JSON', () => {
    for (const raw of [null, '', '{', 'null']) expect(parseSettings(raw).worldStyle, String(raw)).toBe('modern');
    expect(parseSettings(null)).toEqual({ view: 'auto', worldStyle: 'modern', quality: 'medium', tiltShift: true, bloom: true, volume: 0.8, camera: 0,
      spriteFilter: 'smooth' });
  });

  it('sprite edges default to HD smooth and reject unknown values', () => {
    expect(parseSettings(null).spriteFilter).toBe('smooth');
    expect(parseSettings('{"spriteFilter":"pixel"}').spriteFilter).toBe('pixel');
    expect(parseSettings('{"spriteFilter":"blurry"}').spriteFilter).toBe('smooth');
    // (the one parser of the setting, the URL override and the preview's &spriteFilter=)
    expect(['smooth', 'pixel', 'blurry', null, 1].map(parseSpriteFilter)).toEqual(['smooth', 'pixel', null, null, null]);
  });

  it('keeps the saved choices', () => {
    const s = parseSettings(JSON.stringify({ worldStyle: 'retro', volume: 0.3, camera: 2 }));
    expect([s.worldStyle, s.volume, s.camera, s.quality]).toEqual(['retro', 0.3, 2, 'medium']);
  });

  it('an unknown world style is Modern (it would turn the kit off but keep Modern shadows and blur)', () => {
    for (const worldStyle of ['', 'Retro', 'pixel', 3, null, {}]) {
      expect(parseSettings(JSON.stringify({ worldStyle })).worldStyle, JSON.stringify(worldStyle)).toBe('modern');
    }
  });
});
