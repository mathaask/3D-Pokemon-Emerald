import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { ModernArena, ARENA_PARTS } from '../src/render/battle/modernArena';
import { battleCatalogue } from '../src/render/battle/catalogue';
import { BattleArena } from '../src/render/battle/arena';
import { STAGE } from '../src/render/battle/stage';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { createKitUniforms } from '../src/render/kit/materials';
import { meshesOf, programSignature } from '../src/render/kit/catalogue';
import type { Quality } from '../src/render/post';

function stubCanvas(): void {
  const ctx = { createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }), putImageData: () => {} };
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) });
}

describe('battle program catalogue (drift guard)', () => {
  it('holds exactly the program variants every arena kind builds, at every quality, and today\'s arenas', () => {
    stubCanvas();
    const used = new Map<string, string>();
    const collect = (root: THREE.Object3D, at: string) => {
      for (const m of meshesOf(root)) { const s = programSignature(m); if (!used.has(s)) used.set(s, `${at}: ${m.name || m.parent?.name || '-'}`); }
    };
    const u = createKitUniforms();
    for (const quality of ['low', 'medium', 'high'] as Quality[]) for (const kind of ARENA_KINDS) {
      const arena = new ModernArena(u);
      if (!arena.covers(kind)) continue;
      expect(arena.build(kind, defaultArenaColors(kind), quality), `${kind} ${quality}`).toBe(true);
      collect(arena.group, `${kind} ${quality}`);
      arena.dispose();
    }
    for (let env = 0; env <= 9; env++) {
      const legacy = new BattleArena();
      legacy.setPlatforms(STAGE.player, STAGE.enemy);
      legacy.setEnvironment(env);
      collect(legacy.group, `today's arena, environment ${env}`);
    }
    const cat = battleCatalogue({ uniforms: createKitUniforms(), parts: ARENA_PARTS });
    const meshes = meshesOf(cat.root);
    const have = new Set(meshes.map(programSignature));
    cat.dispose();
    vi.unstubAllGlobals();
    expect([...used].filter(([s]) => !have.has(s)).map(([s, at]) => `${s}  (first on ${at})`), 'built, missing from the catalogue').toEqual([]);
    expect([...have].filter((s) => !used.has(s)), 'in the catalogue, built by no arena').toEqual([]);
    expect(meshes).toHaveLength(have.size);
    expect(meshes.every((m) => !m.frustumCulled)).toBe(true);
  });
});
