import { describe, it, expect } from 'vitest';
import { treePlacements, grassPlacements, flowerPlacements } from '../src/render/battle/parts/flora';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { STAGE } from '../src/render/battle/stage';

describe('arena flora', () => {
  const ko = stageKeepOut(STAGE);
  it('rings grass arenas with trees, all on the tall rule', () => {
    const t = treePlacements('grass', STAGE, 1);
    expect(t.length).toBeGreaterThanOrEqual(50);
    expect(t.every((x) => ko.tallOk(x.x, x.z))).toBe(true);
    expect(new Set(t.map((x) => x.style))).toEqual(new Set(['round', 'bushy']));
    expect(treePlacements('grass', STAGE, 1)).toEqual(t);
  });
  it('gives sand a few palms and long grass the densest, tallest grass', () => {
    const palms = treePlacements('sand', STAGE, 1);
    expect(palms.length).toBeLessThanOrEqual(10);
    expect(palms.every((x) => x.style === 'palm')).toBe(true);
    const g = grassPlacements('grass', STAGE, 1, 'medium'), lg = grassPlacements('longGrass', STAGE, 1, 'medium');
    expect(lg.length).toBeGreaterThan(g.length);
    const mean = (l: readonly { scale: number }[]) => l.reduce((s, c) => s + c.scale, 0) / l.length;
    expect(mean(lg)).toBeGreaterThan(1.2 * mean(g));
    expect(grassPlacements('grass', STAGE, 1, 'low').length).toBeLessThan(g.length);
  });
  it("makes a kind's placements once: a rebuild (the battle's sampled colours) and every later battle of the kind reuse them", () => {
    for (const kind of ['grass', 'longGrass', 'plain', 'pond', 'sand'] as const) {
      expect(treePlacements(kind, STAGE, 1), kind).toBe(treePlacements(kind, STAGE, 1));
      expect(grassPlacements(kind, STAGE, 1, 'medium'), kind).toBe(grassPlacements(kind, STAGE, 1, 'medium'));
      expect(flowerPlacements(kind, STAGE, 1), kind).toBe(flowerPlacements(kind, STAGE, 1));
    }
    // (per quality and seed their own)
    expect(grassPlacements('grass', STAGE, 1, 'low')).not.toBe(grassPlacements('grass', STAGE, 1, 'medium'));
    expect(treePlacements('grass', STAGE, 2)).not.toBe(treePlacements('grass', STAGE, 1));
  });
  it('keeps grass off the platforms and flowers to grass and plain', () => {
    for (const c of grassPlacements('longGrass', STAGE, 2, 'high'))
      for (const e of ko.ellipses) expect(((c.x - e.x) / (e.rx / 1.25 * 1.15)) ** 2 + ((c.z - e.z) / (e.rz / 1.25 * 1.15)) ** 2).toBeGreaterThanOrEqual(1);
    expect(flowerPlacements('sand', STAGE, 1)).toHaveLength(0);
    expect(flowerPlacements('plain', STAGE, 1).length).toBeGreaterThan(50);
  });
});
