// Task 7's scenery beyond the brief's tests: the dunes, the horizon's hills, the boulders and rocks, and the sight cap
// that keeps grass and flowers from hiding a platform top.
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { STAGE, GROUND_Y } from '../src/render/battle/stage';
import { battleCamera, frameTop, sightCap, stageKeepOut, SCENERY_SEED } from '../src/render/battle/parts/scatter';
import { duneGeometry, duneMounds, onDune } from '../src/render/battle/parts/dunes';
import { treeGeometry } from '../src/render/kit/trees';
import { ridgeGeometry } from '../src/render/battle/parts/horizon';
import { boulderGeometry, rockPlacements } from '../src/render/battle/parts/rocks';
import { arenaClear, CLUMP_TOP, flowerPlacements, grassPlacements, treePlacements, TREE_CAST_R, type ArenaTree } from '../src/render/battle/parts/flora';
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

  it("keeps the grass under the sight lines of the intro sweep's cameras too (1.5× as far: flatter lines to the player)", () => {
    // (an oracle: the sight line from each camera of the sweep's first frame and its midpoint, at the user's yaws, over the
    // horizontal ray to the near edge of each platform top)
    const tops = [{ p: STAGE.player, rx: 2.1, rz: 2.1 * 0.62 }, { p: STAGE.enemy, rx: 1.9, rz: 1.9 * 0.62 }];
    const cams = [0, 0.5].flatMap((e) => [-0.9, -0.45, 0, 0.45, 0.9].map((y) => battleCamera(STAGE, y, new THREE.Vector3(), new THREE.Vector3(), e)));
    const line = (x: number, z: number) => {
      let cap = Infinity;
      for (const c of cams) for (const t of tops) {
        const ux = x - c.x, uz = z - c.z, dq = Math.hypot(ux, uz);
        const dx = (c.x - t.p.x) / t.rx, dz = (c.z - t.p.z) / t.rz, vx = ux / dq / t.rx, vz = uz / dq / t.rz;
        const A = vx * vx + vz * vz, B = 2 * (dx * vx + dz * vz), C = dx * dx + dz * dz - 1, disc = B * B - 4 * A * C;
        if (disc < 0) continue;
        const near = (-B - Math.sqrt(disc)) / (2 * A);
        if (near > dq) cap = Math.min(cap, c.y * (1 - dq / near));
      }
      return cap;
    };
    let capped = 0;
    for (const g of grassPlacements('longGrass', STAGE, SCENERY_SEED, 'medium')) {
      const l = line(g.x, g.z);
      if (l < Infinity) capped++;
      expect(groundHeight('longGrass', g.x, g.z, STAGE) + CLUMP_TOP * g.scale).toBeLessThanOrEqual(l + 1e-6);
    }
    expect(capped).toBeGreaterThan(20);
  });

  it("shows every framed tree's crown under the frame's top edge (no lollipops, no sticks); the groves' trunks short", () => {
    // (each kit shape's crown low edge: its crown vertices' 10th percentile, at scale 1)
    const low = new Map<string, number>();
    const lowOf = (t: ArenaTree) => {
      const id = t.style + t.variant;
      if (!low.has(id)) {
        const g = treeGeometry(t.style, t.variant, 1), p = g.getAttribute('position'), c = g.getAttribute('color');
        const ys: number[] = [];
        for (let i = 0; i < p.count; i++) if (c.getW(i) >= 0.5) ys.push(p.getY(i));
        ys.sort((a, b) => a - b);
        low.set(id, ys[Math.floor(0.1 * (ys.length - 1))]);
      }
      return low.get(id)!;
    };
    const top = frameTop(STAGE);
    for (const kind of ['grass', 'longGrass', 'plain', 'pond', 'sand'] as const) {
      for (const t of treePlacements(kind, STAGE, SCENERY_SEED)) {
        const ky = t.style === 'palm' ? 0.68 : 1;
        // (its foot sinks 0.15 × scale, and `sink` more)
        const foot = groundHeight(kind, t.x, t.z, STAGE) - 0.15 * t.scale - (t.sink ?? 0);
        const crownLow = foot + lowOf(t) * t.scale * ky;
        const at = top(t.x, t.z);
        if (at < Infinity) expect(crownLow + 0.3, `${kind} ${t.style} at (${t.x.toFixed(1)}, ${t.z.toFixed(1)})`).toBeLessThanOrEqual(at);
        // the plain's and the pond's groves: little bare trunk under the crown
        if (kind === 'plain' || kind === 'pond') expect(crownLow - groundHeight(kind, t.x, t.z, STAGE)).toBeLessThanOrEqual(0.25 * t.scale + 1e-6);
      }
    }
  });

  it('agrees on one scenery seed: the palms stand off the dunes the sand arena builds', () => {
    const mounds = duneMounds(SCENERY_SEED, STAGE);
    const palms = treePlacements('sand', STAGE, SCENERY_SEED);
    expect(palms.length).toBeGreaterThan(0);
    for (const p of palms) expect(onDune(mounds, p.x, p.z)).toBe(false);
  });

  it("moonlights the bare kinds' hills, the dunes, dry tufts and warm rocks (the mountain's cliff) at night; leafy hills and green grass as they are", () => {
    const u = createKitUniforms();
    const dummy = [null, null, null, null, null, null] as unknown as Parameters<THREE.Object3D['onBeforeRender']>;
    const night = (kind: 'sand' | 'mountain' | 'grass') => {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium')).toBe(true);
      const hooked = (name: string) => {
        const out: THREE.Mesh[] = [];
        arena.group.children.find((c) => c.name === name)?.traverse((m) => { if ((m as THREE.Mesh).isMesh) out.push(m as THREE.Mesh); });
        return out.filter((m) => m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender);
      };
      const res = { hills: hooked('horizon'), dunes: hooked('dunes'), grass: hooked('flora').filter((m) => m.name.startsWith('grass:')),
        rock: hooked('rock') };
      // (at full night the hooked materials' colour moves off white towards the lifted neutral)
      u.uNight.value = 1;
      for (const m of [...res.hills, ...res.dunes, ...res.grass, ...res.rock]) {
        m.onBeforeRender(...dummy);
        const c = (m.material as THREE.MeshStandardMaterial).color;
        expect(c.r !== 1 || c.g !== 1 || c.b !== 1, `${kind} ${m.name}`).toBe(true);
      }
      u.uNight.value = 0;
      arena.dispose();
      return res;
    };
    const sand = night('sand'), mountain = night('mountain'), grass = night('grass');
    expect(sand.hills.length).toBe(1);
    expect(sand.dunes.length).toBe(1);
    expect(sand.grass.length).toBeGreaterThan(0);
    // (Task 9: the mountain has no hills — its cliff band stands in front of them —, its cliff is moonlit instead)
    expect(mountain.hills.length).toBe(0);
    expect(mountain.rock.length).toBe(1);
    expect(grass.hills.length).toBe(0);
    expect(grass.grass.length).toBe(0);
  });

  it('keeps at Low quality only the trees the settled camera frames at yaw 0', () => {
    const u = createKitUniforms(), idle = frameTop(STAGE, [0]);
    const arena = new ModernArena(u);
    expect(arena.build('grass', defaultArenaColors('grass'), 'low')).toBe(true);
    const at = new THREE.Matrix4(), p = new THREE.Vector3();
    let n = 0;
    arena.group.traverse((m) => {
      if (!(m as THREE.InstancedMesh).isInstancedMesh || !m.name.startsWith('trees:')) return;
      const im = m as THREE.InstancedMesh;
      for (let i = 0; i < im.count; i++) {
        im.getMatrixAt(i, at);
        p.setFromMatrixPosition(at);
        expect(idle(p.x, p.z)).toBeLessThan(Infinity);
        n++;
      }
    });
    expect(n).toBeGreaterThan(10);
    expect(n).toBeLessThan(treePlacements('grass', STAGE, SCENERY_SEED).length);
    arena.dispose();
  });
});
