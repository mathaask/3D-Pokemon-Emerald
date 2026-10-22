import { describe, it, expect } from 'vitest';
import { frameGuard } from '../src/render/frameGuard';

describe('frameGuard', () => {
  it('runs per-frame code, reports each distinct exception once and lets the loop go on', () => {
    const reported: unknown[] = [];
    const guarded = frameGuard((e) => reported.push(e));
    let ran = 0;
    expect(guarded(() => { ran++; })).toBe(true);
    const boom = new Error('boom');
    expect(guarded(() => { throw boom; })).toBe(false);
    expect(guarded(() => { throw new Error('boom'); })).toBe(false);   // same failure every frame: reported once
    const again = new Error('again');
    expect(guarded(() => { throw again; })).toBe(false);               // a different, later failure is reported too
    expect(guarded(() => { ran++; })).toBe(true);
    expect(ran).toBe(2);
    expect(reported).toEqual([boom, again]);
  });

  it('stops reporting after a few distinct failures', () => {
    const reported: unknown[] = [];
    const guarded = frameGuard((e) => reported.push(e));
    for (let i = 0; i < 20; i++) guarded(() => { throw new Error(`e${i}`); });
    expect(reported).toHaveLength(8);
  });
});
