import { describe, it, expect } from 'vitest';
import { groundCells, groundHeight, POND, GROUND_GRID } from '../src/render/battle/parts/ground';
import { arenaPalette } from '../src/render/battle/palette';
import { STAGE, GROUND_Y, WATER_Y } from '../src/render/battle/stage';
import { GroundMat } from '../src/render/kit/terrain';

const matAt = (g: ReturnType<typeof groundCells>, x: number, z: number) =>
  g.data[((Math.floor(z - g.min[1])) * g.w + Math.floor(x - g.min[0])) * 4 + 3] >> 4;
describe('arena ground', () => {
  it('paints the field, the worn ring and the platform tops', () => {
    const p = arenaPalette('grass', null), g = groundCells('grass', p, STAGE);
    expect(g.w).toBe(GROUND_GRID);
    expect(matAt(g, STAGE.centre.x + 25, STAGE.centre.z - 20)).toBe(GroundMat.Grass);
    expect(matAt(g, STAGE.player.x, STAGE.player.z)).toBe(p.platformMat);
    expect(matAt(g, STAGE.player.x + 2.1 * 1.4, STAGE.player.z)).toBe(p.pathMat);
  });
  it('keeps the stage flat, rolls outdoor fields, lays indoor floors level', () => {
    for (const [dx, dz] of [[0, 0], [5, -3], [-6, 2]]) expect(groundHeight('grass', STAGE.centre.x + dx, STAGE.centre.z + dz, STAGE)).toBe(GROUND_Y);
    const far = [...Array(40)].map((_, i) => groundHeight('grass', STAGE.centre.x + 30 * Math.cos(i), STAGE.centre.z + 30 * Math.sin(i), STAGE));
    expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(0.3);
    expect(groundHeight('gym', STAGE.centre.x + 30, STAGE.centre.z - 20, STAGE)).toBe(GROUND_Y);
  });
  it('digs the pond under the water', () => {
    expect(groundHeight('pond', STAGE.centre.x, STAGE.centre.z + POND.dz - 6, STAGE)).toBeLessThan(WATER_Y - 0.3);
  });
});
