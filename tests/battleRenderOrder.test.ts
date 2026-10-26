// The battle's opaque draw order (parts/ground.ts lists it), as three sorts it: group order (the render order of an
// object's nearest Group ancestor: WebGLRenderer.projectObject), then render order, then material id.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ModernArena } from '../src/render/battle/modernArena';
import { BattleActors } from '../src/render/battle/battleActors';
import { BattleSky } from '../src/render/battle/sky';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { createKitUniforms } from '../src/render/kit/materials';
import { ACTOR_RENDER_ORDER } from '../src/render/overworld/billboards';
import { GROUND_RENDER_ORDER, TOPS_RENDER_ORDER } from '../src/render/battle/parts/ground';
import { WATER_RENDER_ORDER } from '../src/render/battle/parts/water';
import { CLOUD_RENDER_ORDER } from '../src/render/battle/parts/skyPillar';
import type { ArenaKind } from '../src/render/battle/arenaKind';

/** three's opaque sort key of a mesh: [group order, render order, material id]. */
function drawKey(m: THREE.Mesh): [number, number, number] {
  let group = 0;
  for (let o: THREE.Object3D | null = m.parent; o; o = o.parent) {
    if ((o as THREE.Group).isGroup) { group = o.renderOrder; break; }
  }
  return [group, m.renderOrder, (m.material as THREE.Material & { id: number }).id];
}
const before = (a: THREE.Mesh, b: THREE.Mesh) => {
  const x = drawKey(a), y = drawKey(b);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

describe("the battle's draw order", () => {
  it('draws deep water first, then the scenery, the battlers, the platform tops, the ground, the clouds and the sky — whatever their material ids', () => {
    const u = createKitUniforms();
    const atlas = { slots: new Map(), target: { texture: new THREE.Texture() } };
    for (const kind of ['grass', 'sand', 'mountain', 'cave', 'gym', 'underwater', 'water', 'pond', 'aqua', 'rayquaza'] as ArenaKind[]) {
      const scene = new THREE.Scene();
      const arena = new ModernArena(u), actors = new BattleActors(atlas, { field: { texture: new THREE.Texture() } }), sky = new BattleSky();
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      scene.add(arena.group, actors.group, sky.mesh);
      const meshes: THREE.Mesh[] = [];
      scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
      const named = (name: string) => meshes.find((m) => m.name === name);
      // (the water kinds' platforms are lily pads and rocks: no terrain tops)
      const want = ['battleInflated', 'battleCards', 'ground', ...(kind === 'water' || kind === 'pond' ? [] : ['platformTops'])];
      for (const n of want) expect(named(n), `${kind} ${n}`).toBeDefined();
      const battlers = named('battleInflated')!, cards = named('battleCards')!, tops = named('platformTops'), ground = named('ground')!;
      expect([battlers.renderOrder, cards.renderOrder], kind).toEqual([ACTOR_RENDER_ORDER, ACTOR_RENDER_ORDER]);
      if (tops) expect(tops.renderOrder, kind).toBe(TOPS_RENDER_ORDER);
      expect(ground.renderOrder, kind).toBe(GROUND_RENDER_ORDER);
      // (every battle mesh's nearest Group draws at 0: the render orders decide)
      for (const m of meshes) expect(drawKey(m)[0], `${kind} ${m.name}`).toBe(0);
      const order = (...list: (THREE.Mesh | undefined)[]) => {
        const l = list.filter((m): m is THREE.Mesh => !!m);
        expect([...l].sort(before).map((m) => m.name), kind).toEqual(l.map((m) => m.name));
      };
      order(named('waterSheet'), battlers, tops, ground, named('cloudSea'), sky.mesh);
      order(cards, tops, ground);
      // the scenery (render order 0) before the battlers
      for (const m of meshes) {
        if (m.renderOrder === 0) expect(before(m, battlers), `${kind} ${m.name}`).toBeLessThan(0);
      }
      arena.dispose();
    }
    expect(WATER_RENDER_ORDER).toBeLessThan(0);
    expect(ACTOR_RENDER_ORDER).toBeLessThan(TOPS_RENDER_ORDER);
    expect(TOPS_RENDER_ORDER).toBeLessThan(GROUND_RENDER_ORDER);
    expect(CLOUD_RENDER_ORDER).toBeGreaterThan(GROUND_RENDER_ORDER);
    expect(CLOUD_RENDER_ORDER).toBeLessThan(10);
  });
});
