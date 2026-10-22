import { describe, it, expect } from 'vitest';
import { frameGuard } from '../src/render/frameGuard';

describe('frameGuard', () => {
  it('runs per-frame code, reports its first exception once and lets the loop go on', () => {
    const reported: unknown[] = [];
    const guarded = frameGuard((e) => reported.push(e));
    let ran = 0;
    expect(guarded(() => { ran++; })).toBe(true);
    const boom = new Error('boom');
    expect(guarded(() => { throw boom; })).toBe(false);
    expect(guarded(() => { throw new Error('again'); })).toBe(false);
    expect(guarded(() => { ran++; })).toBe(true);
    expect(ran).toBe(2);
    expect(reported).toEqual([boom]);
  });
});
