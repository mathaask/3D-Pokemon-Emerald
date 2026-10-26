import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rockWallGeometry, stalagmiteGeometry, lavaGeometry } from '../src/render/battle/parts/rock';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { STAGE, GROUND_Y, WATER_Y } from '../src/render/battle/stage';
import {
  BEHIND_REACH, BOULDER_TOP, LAVA_MATERIAL, ROCK_PART, ROCK_RULES, SMALL_FRONT, TALL_SIZE, TIP_SHOWN, WALL_SEED, boulderPlacements,
  clusterSpires, lavaPools, poolRadius, stalagmitePlacements, wallRadius, type LavaPool,
} from '../src/render/battle/parts/rock';
import { SCENERY_SEED, frameProjector, frameTop, sightCap } from '../src/render/battle/parts/scatter';
import { arenaClear } from '../src/render/battle/parts/flora';
import { CAVE_POND, groundHeight } from '../src/render/battle/parts/ground';
import { ModernArena } from '../src/render/battle/modernArena';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { arenaPalette } from '../src/render/battle/palette';
import { arenaLook, CAVE_LIGHT } from '../src/render/battle/look';
import { ARENA_KINDS, ARENA_SETTING } from '../src/render/battle/arenaKind';
import { createKitUniforms } from '../src/render/kit/materials';
import { luma, toLinear } from '../src/render/kit/palette';
import type { ArenaKind } from '../src/render/battle/arenaKind';

/** A kit material's uniform as its build set it (the pooled material's slot: kitMaterial copies the options' value in). */
function kitUniformOf(mesh: THREE.Mesh, name: string): THREE.Color {
  const m = mesh.material as THREE.MeshStandardMaterial;
  // (onBeforeCompile hands the slots to the program: compile it on a stub to read them)
  const s = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
  m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return s.uniforms[name].value as THREE.Color;
}

describe('rock arenas', () => {
  const ko = stageKeepOut(STAGE);
  it('stands a wall band on the ground, facing the stage, tall enough to fill the top band', () => {
    const g = rockWallGeometry(1, STAGE, { r: 20, arc: 1.7, height: [8, 12] }, [0.5, 0.45, 0.4]);
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeLessThanOrEqual(GROUND_Y);
    expect(g.boundingBox!.max.y).toBeGreaterThanOrEqual(7);
    const p = g.getAttribute('position'), n = g.getAttribute('normal');
    let facing = 0, ok = 0;
    for (let i = 0; i < p.count; i++) {
      if ((STAGE.centre.x - p.getX(i)) * n.getX(i) + (STAGE.centre.z - p.getZ(i)) * n.getZ(i) > 0) facing++;
      if (p.getY(i) < 1 || ko.tallOk(p.getX(i), p.getZ(i))) ok++;
    }
    expect(facing / p.count).toBeGreaterThan(0.7);
    expect(ok).toBe(p.count);
  });
  it('builds stalagmites of the asked height and lava pools that stay off the platforms', () => {
    const s = stalagmiteGeometry(2, 3, [0.4, 0.35, 0.3]); s.computeBoundingBox();
    expect(s.boundingBox!.max.y).toBeCloseTo(3, 0);
    const l = lavaGeometry(3, STAGE), p = l.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeCloseTo(GROUND_Y + 0.02, 5);
      for (const e of ko.ellipses) expect(((p.getX(i) - e.x) / e.rx) ** 2 + ((p.getZ(i) - e.z) / e.rz) ** 2).toBeGreaterThanOrEqual(1);
    }
    expect(l).toBeInstanceOf(THREE.BufferGeometry);
  });
});

// Beyond the brief's tests: every kind's band, its stalagmites, boulders and lava on the placement rules; the part's draws,
// materials and night hook; the caves' colours.
describe('rock arenas: bands, placements, the part', () => {
  const ko = stageKeepOut(STAGE), clear = arenaClear(STAGE), cap = sightCap(STAGE), top = frameTop(STAGE);
  const KINDS: ArenaKind[] = ['mountain', 'cave', 'cavePond', 'groudon', 'kyogre'];
  /** The arenas' seed and a few more: the rules hold whatever the seed. */
  const SEEDS = [SCENERY_SEED, 2, 3];
  const behind = (x: number, z: number, reach: number) =>
    [STAGE.player, STAGE.enemy].some((p) => z < p.z && z > p.z - reach && Math.abs(x - p.x) < 3.5);

  it("stands every kind's band on the tall rule, facing the stage, under 20 k vertices, closing the frame's top band", () => {
    for (const kind of KINDS) {
      const band = ROCK_RULES[kind]!.band;
      const g = rockWallGeometry(WALL_SEED, STAGE, band, [0.5, 0.45, 0.4], (x, z) => groundHeight(kind === 'mountain' ? kind : 'cave', x, z, STAGE));
      const p = g.getAttribute('position'), n = g.getAttribute('normal');
      expect(p.count, kind).toBeLessThanOrEqual(20000);
      let facing = 0;
      for (let i = 0; i < p.count; i++) {
        if ((STAGE.centre.x - p.getX(i)) * n.getX(i) + (STAGE.centre.z - p.getZ(i)) * n.getZ(i) > 0) facing++;
        if (p.getY(i) >= 1) expect(ko.tallOk(p.getX(i), p.getZ(i)), `${kind} vertex ${i}`).toBe(true);
      }
      expect(facing / p.count, kind).toBeGreaterThan(0.7);
      // (straight behind the stage it rises over the frame's top edge: the top band shows rock, not the ground beyond)
      const z = STAGE.centre.z - wallRadius(WALL_SEED, band, 0) + 0.5;
      let tallest = -Infinity;
      for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i) - STAGE.centre.x) < 1 && p.getZ(i) < z) tallest = Math.max(tallest, p.getY(i));
      expect(tallest, kind).toBeGreaterThan(top(STAGE.centre.x, z) + 3);
    }
  });

  it('places stalagmites on the rules: tall ones on the tall rule, their tips under the frame top, none behind a battler', () => {
    for (const seed of SEEDS) for (const kind of KINDS) {
      const spires = stalagmitePlacements(kind, STAGE, seed), rule = ROCK_RULES[kind]!.spires;
      if (!rule) { expect(spires, kind).toEqual([]); continue; }
      const tall = spires.filter((s) => s.height > 1);
      if (seed === SCENERY_SEED) expect(tall.length, kind).toBeGreaterThanOrEqual(kind === 'cavePond' ? 6 : 10);
      for (const s of spires) {
        const ground = groundHeight(kind, s.x, s.z, STAGE);
        expect(s.height, kind).toBeLessThanOrEqual(rule.height[1]);
        if (s.height > 1) {
          expect(ground + s.height, `${kind} tip`).toBeLessThanOrEqual(top(s.x, s.z) - TIP_SHOWN + 1e-9);
          for (const c of clusterSpires(s.seeds, s.height)) {
            if (c.height > 1) expect(ko.tallOk(s.x + c.dx, s.z + c.dz), `${kind} tall`).toBe(true);
            expect(behind(s.x + c.dx, s.z + c.dz, BEHIND_REACH), `${kind} behind`).toBe(false);
          }
        } else {
          expect(clear(s.x, s.z) && s.z <= STAGE.centre.z + SMALL_FRONT, `${kind} small`).toBe(true);
          expect(ground + s.height, `${kind} small cap`).toBeLessThanOrEqual(cap(s.x, s.z) + 1e-9);
        }
        if (kind === 'cavePond') {
          expect(Math.hypot((s.x - STAGE.centre.x) / CAVE_POND.rx, (s.z - STAGE.centre.z - CAVE_POND.dz) / CAVE_POND.rz), 'on the bank').toBeGreaterThan(1);
        }
      }
    }
  });

  it("places Groudon's lava against the frame: two pools in the idle frame (over the text box), every pool in one", () => {
    const frames = [0, -0.9, 0.9].map((y) => frameProjector(STAGE, y)), v = new THREE.Vector3();
    for (const seed of SEEDS) {
      const pools = lavaPools(STAGE, seed);
      expect(pools.length, `seed ${seed}`).toBeGreaterThanOrEqual(3); expect(pools.length).toBeLessThanOrEqual(5);
      // (the pools' own geometry: its outline off the platforms (the brief's test) and the strip in front of the player's)
      const p = lavaGeometry(seed, STAGE, pools).getAttribute('position');
      for (let i = 0; i < p.count; i++) expect(clear(p.getX(i), p.getZ(i)), 'pool off the strip').toBe(true);
      // (its middle: the centre and half its radius out — the rim may run past the frame's edge)
      const shows = (pool: LavaPool, f: (typeof frames)[number]) => Array.from({ length: 25 }, (_, q) => {
        const a = (q / 24) * Math.PI * 2, d = q === 24 ? 0 : poolRadius(pool, a) * 0.5;
        return f(pool.x + Math.cos(a) * d, GROUND_Y, pool.z + Math.sin(a) * d, v);
      }).every((n) => n.z < 1 && Math.abs(n.x) <= 0.9 && n.y <= 0.85 && n.y >= -0.35);
      expect(pools.filter((pool) => shows(pool, frames[0])).length, `seed ${seed} idle`).toBeGreaterThanOrEqual(2);
      for (const pool of pools) expect(frames.some((f) => shows(pool, f)), `seed ${seed} framed`).toBe(true);
      for (const pool of pools) expect(Math.hypot(pool.x - STAGE.centre.x, pool.z - STAGE.centre.z)).toBeGreaterThanOrEqual(4.5 * 0.75 - 1e-9);
    }
  });

  it('keeps boulders, scree and the talus on the rules and off the lava', () => {
    for (const seed of SEEDS) for (const kind of KINDS) {
      const pools = kind === 'groudon' ? lavaPools(STAGE, seed) : [];
      const rocks = boulderPlacements(kind, STAGE, seed, pools);
      expect(rocks.length, kind).toBeGreaterThan(5);
      for (const b of rocks) {
        if (b.size >= TALL_SIZE) expect(ko.tallOk(b.x, b.z), `${kind} tall boulder`).toBe(true);
        // (scree: everything but the talus — under the sight lines, off the platforms)
        if (!b.talus) {
          expect(groundHeight(kind, b.x, b.z, STAGE) + b.size * BOULDER_TOP <= cap(b.x, b.z) || b.size >= TALL_SIZE, `${kind} scree cap`).toBe(true);
        }
        for (const p of pools) expect(Math.hypot(p.x - b.x, p.z - b.z), 'off the lava').toBeGreaterThan(p.r * 1.28);
      }
      for (const s of stalagmitePlacements(kind, STAGE, seed, pools)) for (const p of pools) expect(Math.hypot(p.x - s.x, p.z - s.z)).toBeGreaterThan(p.r * 1.28);
    }
  });

  it("piles the talus against the band's foot: out on its buttresses, back in its alcoves — never buried in a face nor standing off one", () => {
    // (each stone's gap to the band's face along its angle, just over the ground: the band's mesh raycast from the stage
    // centre, less the stone's distance and its half width (0.45 of its size). The talus lies 0.25 off the foot, spread
    // up to 1.4 out in its heaps; the face's own relief (strata ≤ 0.24, displacement ± 0.35) on top. Before it followed
    // the buttresses and alcoves (1.3 out, 0.9 back), stones stood buried 1.2–1.4 deep in the buttresses)
    const cx = STAGE.centre.x, cz = STAGE.centre.z, ray = new THREE.Raycaster();
    for (const kind of KINDS) {
      const band = ROCK_RULES[kind]!.band;
      const ground = kind === 'mountain' ? (x: number, z: number) => groundHeight(kind, x, z, STAGE) : () => GROUND_Y;
      const wall = new THREE.Mesh(rockWallGeometry(WALL_SEED, STAGE, band, [0.5, 0.5, 0.5], ground), new THREE.MeshBasicMaterial());
      const talus = boulderPlacements(kind, STAGE, SCENERY_SEED).filter((b) => b.talus);
      expect(talus.length, kind).toBeGreaterThan(10);
      for (const b of talus) {
        const d = Math.hypot(b.x - cx, b.z - cz);
        ray.set(new THREE.Vector3(cx, ground(b.x, b.z) + 0.15, cz), new THREE.Vector3((b.x - cx) / d, 0, (b.z - cz) / d));
        const hit = ray.intersectObject(wall)[0];
        expect(hit, `${kind} talus at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}): the band behind it`).toBeDefined();
        const gap = hit!.distance - (d + 0.45 * b.size);
        expect(gap, `${kind} talus at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) buried`).toBeGreaterThan(-0.5);
        expect(gap, `${kind} talus at (${b.x.toFixed(1)}, ${b.z.toFixed(1)}) standing off`).toBeLessThan(2.3);
      }
    }
  });

  it("builds one rock draw per kind (cliff material, casting) and Groudon's lava (emissive, in the background's accent)", () => {
    const u = createKitUniforms();
    expect(ROCK_PART.kinds).toEqual(KINDS);
    for (const kind of KINDS) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const part = arena.group.getObjectByName('rock')!;
      const meshes: THREE.Mesh[] = [];
      part.traverse((m) => { if ((m as THREE.Mesh).isMesh) meshes.push(m as THREE.Mesh); });
      expect(meshes.map((m) => m.name), kind).toEqual(kind === 'groudon' ? ['rockWalls', 'lava'] : ['rockWalls']);
      const rock = meshes[0];
      expect(rock.castShadow && rock.receiveShadow, kind).toBe(true);
      expect((rock.material as THREE.MeshStandardMaterial).flatShading, kind).toBe(true);
      // (the mountain's stone moonlit at night as its field; the caves keep their own light)
      expect(rock.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender, kind).toBe(kind === 'mountain');
      if (kind === 'groudon') {
        const lava = meshes[1];
        expect(lava.castShadow).toBe(false);
        const accent = toLinear(arenaPalette('groudon', defaultArenaColors('groudon')).accent);
        expect(kitUniformOf(lava, 'uLava').toArray().map((v) => +v.toFixed(5))).toEqual(accent.map((v) => +v.toFixed(5)));
      }
      arena.dispose();
    }
    expect(LAVA_MATERIAL.hookKey).toBe('lava');
    expect(LAVA_MATERIAL.fragEmissive).toContain('totalEmissiveRadiance');
    expect(LAVA_MATERIAL.fragColor).toContain('kitFbm2');
    expect(LAVA_MATERIAL.fragColor).toContain('uTime');
  });

  it("paints the caves in their rock: the cave a warm tan (no olive), Groudon's red-brown, Kyogre's blue-grey", () => {
    const p = (k: ArenaKind) => arenaPalette(k, defaultArenaColors(k));
    const cave = p('cave');
    for (const c of [cave.ground, cave.rock]) {
      // (warm: red over green over blue, the red clearly over the green — a tan whose red and green match reads olive)
      expect(c[0] - c[1], 'tan').toBeGreaterThan(0.06); expect(c[1] - c[2]).toBeGreaterThan(0.08);
    }
    expect(luma(cave.ground)).toBeGreaterThan(0.55);
    const groudon = p('groudon').rock, kyogre = p('kyogre').rock;
    expect(groudon[0]).toBeGreaterThan(groudon[1] * 1.5);
    expect(kyogre[2]).toBeGreaterThan(kyogre[0]);
    // (their light: the cave and the cave pond lit warm and bright enough that the tonemapper keeps the tan's blue)
    const look = arenaLook('cave', cave, 12);
    expect(look.sunI * look.sunColor.b + look.hemiI * look.sky.b).toBeGreaterThan(2.5);
    // (every cave kind has a light of its own: the per-frame look never falls back silently)
    for (const k of ARENA_KINDS) if (ARENA_SETTING[k] === 'cave') expect(CAVE_LIGHT[k], k).toBeDefined();
    // (the mountain's cliff paler than its gravel, as the GBA's mountain is pale)
    expect(luma(p('mountain').rock)).toBeGreaterThan(luma(p('mountain').ground) + 0.06);
  });

  it("darkens Kyogre's band and rubble at the waterline (wet rock: no grey lumps on the water)", () => {
    const arena = new ModernArena(createKitUniforms());
    expect(arena.build('kyogre', defaultArenaColors('kyogre'), 'medium')).toBe(true);
    const g = (arena.group.getObjectByName('rockWalls') as THREE.Mesh).geometry;
    const p = g.getAttribute('position'), c = g.getAttribute('color');
    const mean = (y0: number, y1: number) => {
      let s = 0, n = 0;
      for (let i = 0; i < p.count; i++) if (p.getY(i) >= y0 && p.getY(i) < y1) { s += c.getX(i) + c.getY(i) + c.getZ(i); n++; }
      return s / n;
    };
    expect(mean(WATER_Y - 0.1, WATER_Y + 0.04)).toBeLessThan(mean(WATER_Y + 0.6, WATER_Y + 1.2) * 0.7);
    arena.dispose();
  });
});
