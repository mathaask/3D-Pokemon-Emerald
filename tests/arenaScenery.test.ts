// Task 7's scenery beyond the brief's tests: the dunes, the horizon's hills, the boulders and rocks, and the sight cap
// that keeps grass and flowers from hiding a platform top.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { STAGE, GROUND_Y } from '../src/render/battle/stage';
import { battleCamera, sightCap, stageKeepOut } from '../src/render/battle/parts/scatter';
import { duneGeometry, duneMounds } from '../src/render/battle/parts/dunes';
import { ridgeGeometry } from '../src/render/battle/parts/horizon';
import { boulderGeometry, rockPlacements } from '../src/render/battle/parts/rocks';
import { arenaClear, CLUMP_TOP, flowerPlacements, grassPlacements, treePlacements, TREE_CAST_R } from '../src/render/battle/parts/flora';
import { groundHeight, CLOUD_SHADOW } from '../src/render/battle/parts/ground';
import { ModernArena } from '../src/render/battle/modernArena';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { createKitUniforms } from '../src/render/kit/materials';

describe('arena scenery', () => {
  const ko = stageKeepOut(STAGE);

  it('raises the dunes behind and beside the stage: every part taller than 1 unit on the tall rule', () => {
    expect(duneMounds(1, STAGE).length).toBeGreaterThanOrEqual(10);
    const g = duneGeometry(1, STAGE, [0.85, 0.75, 0.5]);
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position']);
    const p = g.getAttribute('position');
    let tall = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      if (p.getY(i) - groundHeight('sand', x, z, STAGE) <= 1) continue;
      tall++;
      expect(ko.tallOk(x, z), `dune vertex (${x.toFixed(1)}, ${z.toFixed(1)})`).toBe(true);
    }
    expect(tall).toBeGreaterThan(100);
  });

  it('rings the back and sides with hills in their height range, their front slopes facing the stage', () => {
    const arc = THREE.MathUtils.degToRad(100);
    const g = ridgeGeometry(1, STAGE, { r: 34, height: [2, 5], arc, color: [0.3, 0.5, 0.3] });
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    let top = -Infinity, facing = 0, front = 0;
    for (let i = 0; i < p.count; i++) {
      const dx = p.getX(i) - STAGE.centre.x, dz = p.getZ(i) - STAGE.centre.z, r = Math.hypot(dx, dz);
      // (straight behind is −z)
      expect(Math.abs(Math.atan2(dx, -dz))).toBeLessThanOrEqual(arc + 1e-6);
      top = Math.max(top, p.getY(i) - GROUND_Y);
      if (r < 33 && p.getY(i) > GROUND_Y + 0.5) {
        front++;
        if (-(n.getX(i) * dx + n.getZ(i) * dz) > 0) facing++;
      }
    }
    expect(top).toBeGreaterThan(2);
    expect(top).toBeLessThanOrEqual(5 + 1e-6);
    expect(facing / front).toBeGreaterThan(0.95);
  });

  it('sets a boulder flat on the ground, lighter on top', () => {
    const b = boulderGeometry(5, 1.2, [0.5, 0.5, 0.5]);
    b.computeBoundingBox();
    expect(b.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(b.boundingBox!.max.y).toBeGreaterThan(0.5);
    expect(b.boundingBox!.max.y).toBeLessThan(1.6);
    const p = b.getAttribute('position'), c = b.getAttribute('color');
    let lo = 0, nlo = 0, hi = 0, nhi = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0.7) { hi += c.getX(i); nhi++; } else if (p.getY(i) > 0.05 && p.getY(i) < 0.3) { lo += c.getX(i); nlo++; }
    }
    expect(hi / nhi).toBeGreaterThan(lo / nlo);
  });

  it('places the rocks: tall ones on the tall rule, small ones clear of the platforms; the brief\'s counts', () => {
    const clear = arenaClear(STAGE);
    for (const [kind, count] of [['grass', 4], ['longGrass', 3], ['plain', 5], ['sand', 9]] as const) {
      const rocks = rockPlacements(kind, STAGE, 1);
      expect(rocks.length, kind).toBe(count);
      for (const r of rocks) expect(r.size >= 1.1 ? ko.tallOk(r.x, r.z) : clear(r.x, r.z), `${kind} rock ${r.size}`).toBe(true);
    }
  });

  it('keeps grass and flowers under the camera\'s sight lines to the platform tops', () => {
    const cap = sightCap(STAGE);
    for (const kind of ['grass', 'longGrass', 'plain', 'sand', 'pond'] as const) {
      for (const c of grassPlacements(kind, STAGE, 1, 'high')) {
        expect(groundHeight(kind, c.x, c.z, STAGE) + CLUMP_TOP * c.scale).toBeLessThanOrEqual(cap(c.x, c.z) + 1e-9);
      }
    }
    for (const f of flowerPlacements('grass', STAGE, 1)) expect(cap(f.x, f.z)).toBeGreaterThan(groundHeight('grass', f.x, f.z, STAGE));
    // in front of the enemy's platform the line is low; behind the stage nothing is in the way
    expect(cap(STAGE.enemy.x, STAGE.enemy.z + 2)).toBeLessThan(0.5);
    expect(cap(STAGE.centre.x, STAGE.centre.z - 12)).toBe(Infinity);
    // (the camera the cap sees from: BattleView's, ≈ 11 units in front of the stage and 3.6 up)
    const cam = battleCamera(STAGE, 0);
    expect(cam.z - STAGE.centre.z).toBeGreaterThan(10);
    expect(cam.y).toBeGreaterThan(3);
  });

  it('gives the plain its trees in groves and pond trees beyond the shore', () => {
    expect(treePlacements('plain', STAGE, 1).length).toBeGreaterThan(25);
    for (const t of treePlacements('pond', STAGE, 1)) expect(Math.hypot(t.x - STAGE.centre.x, t.z - STAGE.centre.z)).toBeGreaterThanOrEqual(17);
    expect(treePlacements('mountain', STAGE, 1)).toEqual([]);
  });

  it('builds the outdoor kinds with their scenery: near trees and rocks cast, far trees, grass and hills do not', () => {
    const u = createKitUniforms();
    for (const kind of ['grass', 'sand'] as const) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium')).toBe(true);
      const part = (name: string) => arena.group.children.find((c) => c.name === name)!;
      const meshes = (o: THREE.Object3D) => { const l: THREE.Mesh[] = []; o.traverse((m) => { if ((m as THREE.Mesh).isMesh) l.push(m as THREE.Mesh); }); return l; };
      const flora = meshes(part('flora'));
      const trees = flora.filter((m) => m.name.startsWith('trees:'));
      // (the near trees cast — every instance of a casting mesh within TREE_CAST_R of the stage centre — the far ones not)
      expect(trees.some((m) => m.castShadow)).toBe(true);
      for (const m of trees as THREE.InstancedMesh[]) {
        const at = new THREE.Matrix4(), p = new THREE.Vector3();
        for (let i = 0; i < m.count; i++) {
          m.getMatrixAt(i, at);
          p.setFromMatrixPosition(at);
          expect(Math.hypot(p.x - STAGE.centre.x, p.z - STAGE.centre.z) <= TREE_CAST_R, m.name).toBe(m.castShadow);
        }
      }
      expect(flora.filter((m) => m.name.startsWith('grass:')).every((m) => !m.castShadow)).toBe(true);
      expect(meshes(part('horizon')).every((m) => !m.castShadow && !m.receiveShadow)).toBe(true);
      expect(meshes(part('rocks')).every((m) => m.castShadow && m.receiveShadow)).toBe(true);
      expect(!!arena.group.children.find((c) => c.name === 'dunes')).toBe(kind === 'sand');
      arena.dispose();
    }
    expect(CLOUD_SHADOW).toBeLessThanOrEqual(0.15);
  });
});
