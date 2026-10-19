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
  it('different GLSL hooks get different program keys without a hookKey', () => {
    const a = kitMaterial(u, { fade: true, fragColor: 'diffuseColor.rgb *= 0.5;' }).material;
    const b = kitMaterial(u, { fade: true, fragColor: 'diffuseColor.rgb *= 0.7;' }).material;
    const a2 = kitMaterial(u, { fade: true, fragColor: 'diffuseColor.rgb *= 0.5;' }).material;
    expect(a.customProgramCacheKey()).not.toBe(b.customProgramCacheKey());
    expect(a.customProgramCacheKey()).toBe(a2.customProgramCacheKey());
  });
  it('vertTransform alone adds a depth material', () => {
    const k = kitMaterial(u, { vertTransform: 'transformed.y += 0.1;' });
    expect(k.depth).not.toBeNull();
    expect(k.depth!.defines).not.toHaveProperty('KIT_WIND');
  });
});
