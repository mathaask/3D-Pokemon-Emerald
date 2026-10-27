// Furniture kit I — home (Phase 4 Task 9): the generators wired into the furniture family's soups.
import { describe, it, expect } from 'vitest';
import { HOME_GENERATORS } from '../src/render/kit/interior/furnitureHome';
import { FURNITURE_SPEC, isLow } from '../src/render/kit/interior/furniture';
import { piece, newOut, boxOf, run, hashOut, tris } from './helpers/furniture';

const KINDS = ['bed', 'table', 'chair', 'tv', 'bookshelf', 'plant', 'fridge', 'sink', 'cabinet', 'crate', 'trashCan', 'vase'] as const;

describe('home furniture generators', () => {
  it.each(KINDS)('%s stays inside its footprint at its height, in the right soups', (kind) => {
    const out = newOut(), p = piece(kind);
    HOME_GENERATORS[kind]!(p, out, 'medium');
    const b = boxOf(out), f = p.foot;
    expect(b.min.x).toBeGreaterThanOrEqual(f.x0 - 1e-3); expect(b.max.x).toBeLessThanOrEqual(f.x1 + 1e-3);
    expect(b.min.z).toBeGreaterThanOrEqual(f.z0 - 1e-3); expect(b.max.z).toBeLessThanOrEqual(f.z1 + 1e-3);
    expect(b.max.y).toBeCloseTo(FURNITURE_SPEC[kind].height, 1);
    if (isLow(kind)) expect(out.tall.empty && out.glass.empty && out.glow.empty).toBe(true);
    else expect(out.low.empty && out.glassLow.empty && out.glowLow.empty).toBe(true);
  });
  it('turns a chair to face its table', () => {
    const east = boxOf(run(HOME_GENERATORS, 'chair', 'medium', { facing: 'E' }));
    const west = boxOf(run(HOME_GENERATORS, 'chair', 'medium', { facing: 'W' }));
    expect(east.equals(west)).toBe(false);
  });
  it('is deterministic and scales with quality', () => {
    expect(hashOut(run(HOME_GENERATORS, 'plant', 'medium'))).toBe(hashOut(run(HOME_GENERATORS, 'plant', 'medium')));
    expect(tris(run(HOME_GENERATORS, 'plant', 'low'))).toBeLessThan(tris(run(HOME_GENERATORS, 'plant', 'high')));
  });
  it('puts the TV screen in the low glow soup (it never fades)', () => {
    const out = run(HOME_GENERATORS, 'tv');
    expect(out.glowLow.empty).toBe(false); expect(out.low.empty).toBe(false);
  });
  it('stands a plant at its pot cell\'s height: its walkable leaves cell (capped low) never lowers it', () => {
    const p = piece('plant');
    const out = run(HOME_GENERATORS, 'plant', 'medium', { cellFeet: p.cellFeet.map((c, k) => (k < 2 ? { ...c, height: 0.45 } : c)) });
    expect(boxOf(out).max.y).toBeCloseTo(FURNITURE_SPEC.plant.height, 2);
  });
  it('keeps a bed whose head cell is walkable as low as a seat', () => {
    const p = piece('bed');
    const out = run(HOME_GENERATORS, 'bed', 'medium', { cellFeet: p.cellFeet.map((c, k) => (k < 2 ? { ...c, height: 0.45 } : c)) });
    expect(boxOf(out).max.y).toBeLessThanOrEqual(0.45 + 1e-6);
  });
});
