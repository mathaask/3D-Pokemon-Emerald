import { describe, it, expect } from 'vitest';
import { keyMask } from '../src/input/keyNames';
import { KEY } from '../src/gba/constants';

describe('keyMask', () => {
  it('maps key names joined by +', () => {
    expect(keyMask('LEFT')).toBe(KEY.LEFT);
    expect(keyMask('A+UP')).toBe(KEY.A | KEY.UP);
    expect(keyMask('')).toBe(0);
  });
  it('is case-insensitive and rejects unknown names', () => {
    expect(keyMask('down+b')).toBe(KEY.DOWN | KEY.B);
    expect(() => keyMask('JUMP')).toThrow(/JUMP/);
  });
});
