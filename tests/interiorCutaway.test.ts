// The interior cutaway (Phase 4 Task 6, D5): a wall whose outer side faces the camera vanishes.
import { describe, it, expect } from 'vitest';
import { wallVisible, INNER_NORMAL, CUTAWAY_DOT } from '../src/render/kit/interior/cutaway';

const back = (yaw: number) => ({ x: Math.sin(yaw), y: Math.cos(yaw) });
const shown = (yaw: number) => (['N', 'E', 'S', 'W'] as const).filter((d) => wallVisible(d, back(yaw)));

describe('interior cutaway', () => {
  it('hides the walls the camera sees from outside', () => {
    expect(shown(0)).toEqual(['N', 'E', 'W']);
    expect(shown(Math.PI / 2)).toEqual(['N', 'S', 'W']);
    expect(shown((3 * Math.PI) / 4)).toEqual(['S', 'W']);
    expect(shown(Math.PI)).toEqual(['E', 'S', 'W']);
  });
  it('points every inner normal into the room, with the threshold as given', () => {
    expect(INNER_NORMAL).toEqual({ N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] });
    expect(CUTAWAY_DOT).toBe(-0.25);
    // (exactly at the threshold the wall stays)
    expect(wallVisible('N', { x: Math.sqrt(1 - 0.25 ** 2), y: -0.25 })).toBe(true);
  });
});
