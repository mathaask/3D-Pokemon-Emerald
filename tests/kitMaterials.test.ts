import { describe, it, expect } from 'vitest';
import { kitMaterial, createKitUniforms } from '../src/render/kit/materials';

describe('kitMaterial', () => {
  const u = createKitUniforms();
  it('wind adds a matching depth material', () => {
    const k = kitMaterial(u, { wind: 0.1, windHeight: 2 });
    expect(k.material.defines).toHaveProperty('KIT_WIND');
    expect(k.depth).not.toBeNull();
  });
  it('rigid materials need no custom depth', () => {
    expect(kitMaterial(u, { fade: true }).depth).toBeNull();
  });
  it('features map to defines and distinct program keys', () => {
    const a = kitMaterial(u, { fade: true, pattern: 'roofTiles' }).material;
    const b = kitMaterial(u, { fade: true }).material;
    expect(a.defines).toHaveProperty('KIT_FADE');
    expect(a.defines).toHaveProperty('KIT_PATTERN_ROOF');
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
  });
});
