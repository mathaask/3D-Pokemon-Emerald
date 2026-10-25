// The outdoor arenas' flora: a treeline round the back and sides of the stage (the kit's round and bushy trees; palms on
// sand), grass clumps around the platforms (the kit's blades: dense and tall in long grass, patchy on the plain, dry
// tufts on sand, a shore band round the pond) and flowers as small colour accents on grass and plain. Everything tall
// keeps to the tall rule (scatter.ts: behind and beside the stage, out of the camera's way); grass keeps off the
// platforms and the strip in front of the player's, and to the ground the camera frames. The kit's own shapes and
// materials, instanced in the arena palette's colours.

import * as THREE from 'three';
import { hashCell, noise2, rng } from '../../kit/geom';
import { applyKitMaterial, kitMaterial } from '../../kit/materials';
import { mix, toLinear, type RGB } from '../../kit/palette';
import { TREE_STYLES, TREE_VARIANTS, treeCrownDetail, treeGeometry, treeMaterial, type TreeStyle } from '../../kit/trees';
import { BLADES, GRASS_MATERIAL, LONG_SCALE, clump } from '../../kit/grass';
import { flowerGeometry, flowerMaterial } from '../../kit/flowers';
import type { Quality } from '../../post';
import type { ArenaKind } from '../arenaKind';
import type { ArenaPart, CatalogueEntry } from '../modernArena';
import { PLATFORM_FOOTPRINT, type Stage } from '../stage';
import { groundHeight, POND, WORN_RING } from './ground';
import { battleCamera, scatter, sightCap, stageKeepOut, insideEllipse, type Ellipse } from './scatter';
import { duneMounds, duneSurface, onDune } from './dunes';

export interface ArenaTree { style: TreeStyle; variant: number; x: number; z: number; scale: number; yaw: number; shade: number }
export interface ArenaClump { x: number; z: number; scale: number; yaw: number; shade: number }

/** A kind's trees: how many, the annulus, their spacing and size, the style of each (u uniform in 0..1) and any extra
 *  rule for where they stand. */
interface TreeRule {
  count: number; r: [number, number]; gap: number; scale: [number, number];
  style(u: number): TreeStyle;
  accept?(x: number, z: number, stage: Stage, seed: number): boolean;
}
const TREES: Partial<Record<ArenaKind, TreeRule>> = {
  grass: { count: 80, r: [11, 32], gap: 2.4, scale: [1.25, 1.7], style: (u) => (u < 0.6 ? 'round' : 'bushy') },
  longGrass: { count: 100, r: [10, 30], gap: 2.2, scale: [1.25, 1.7], style: (u) => (u < 0.6 ? 'bushy' : 'round') },
  // (the plain's trees stand in groves — a broad noise field — so their crowns still close into canopies)
  plain: { count: 50, r: [13, 34], gap: 3, scale: [1.3, 1.8], style: () => 'round', accept: (x, z) => noise2(x * 0.09, z * 0.09, 0x9e0) > -0.15 },
  // (palms stand in the hollows between the dunes, not up on them: out of the camera's view there)
  sand: { count: 8, r: [12, 26], gap: 4, scale: [0.95, 1.2], style: () => 'palm',
    accept: (x, z, s, seed) => Math.abs(x - s.centre.x) >= 9 && !onDune(duneMounds(seed, s), x, z, 1.1) },
  pond: { count: 60, r: [17, 34], gap: 2.4, scale: [1.25, 1.7], style: (u) => (u < 0.5 ? 'round' : 'bushy') },
};

/** Per-kind seed salts: each kind's scenery is its own (the same seed gives a grass and a long-grass arena other trees). */
const SALT: Record<string, number> = { grass: 0x9a55, longGrass: 0x10a9, plain: 0x91a1, sand: 0x5a4d, pond: 0x90d };
const salt = (kind: ArenaKind) => SALT[kind] ?? 0x7ee;

/** grass: 80 (60 % round, 40 % bushy), r 11–32, gap 2.4, scale 1.8–2.4; longGrass: 100 (60 % bushy), r 10–30, gap 2.2;
 *  plain: 50 round, r 13–34, gap 3; sand: 8 palms, r 12–26, |x − centre.x| ≥ 9; pond: 60 round/bushy beyond its shore
 *  (r ≥ 17); all on the tall rule. */
export function treePlacements(kind: ArenaKind, stage: Stage, seed: number): ArenaTree[] {
  const rule = TREES[kind];
  if (!rule) return [];
  const ko = stageKeepOut(stage);
  const s = seed * 7919 + salt(kind);
  const pts = scatter(s, {
    centre: stage.centre, r0: rule.r[0], r1: rule.r[1], count: rule.count, minGap: rule.gap,
    accept: (x, z) => ko.tallOk(x, z) && (!rule.accept || rule.accept(x, z, stage, seed)),
  });
  const r = rng(s ^ 0x5eed);
  return pts.map(({ x, z }) => {
    const style = rule.style(r());
    const variant = style === 'round' || style === 'bushy' ? Math.floor(r() * TREE_VARIANTS) % TREE_VARIANTS : 0;
    return { style, variant, x, z, scale: rule.scale[0] + (rule.scale[1] - rule.scale[0]) * r(), yaw: r() * Math.PI * 2,
      shade: 0.92 + 0.26 * r() };
  });
}

/** A kind's grass: clumps, annulus, spacing, size; long grass is taller near the stage (LONG_SCALE × 1.0–1.25 within
 *  r < 9, × 0.85–1.0 beyond). */
interface GrassRule { count: number; r: [number, number]; gap: number; scale(r: number, u: number): number }
const GRASS: Partial<Record<ArenaKind, GrassRule>> = {
  grass: { count: 900, r: [2.3, 15], gap: 0.45, scale: (_r, u) => 0.85 + 0.25 * u },
  longGrass: { count: 1500, r: [2, 16], gap: 0.4, scale: (r, u) => LONG_SCALE * (r < 9 ? 1.0 + 0.25 * u : 0.85 + 0.15 * u) },
  plain: { count: 260, r: [5, 16], gap: 0.45, scale: (_r, u) => 0.85 + 0.25 * u },
  sand: { count: 60, r: [3, 16], gap: 1.1, scale: (_r, u) => 0.45 + 0.3 * u },
  pond: { count: 300, r: [9, 24], gap: 0.5, scale: (_r, u) => 0.85 + 0.25 * u },
};
/** The plain's grass grows in 6–10 patches of these radii. */
const PATCH = { min: 6, max: 10, r: [1.6, 2.8] as const };
/** The pond's shore band (elliptical radius of its POND ellipse). */
const SHORE: [number, number] = [1.05, 1.5];
/** Grass keeps this far off the platforms (× their footprint) and leaves this strip clear in front of the player's. */
const CLEAR = { footprint: 1.15, strip: 1.2 };
/** The ground the camera frames ends this far in front of the stage centre (its frame's bottom edge, the intro sweep's
 *  included): no grass beyond. */
const FRAMED_FRONT = 7.5;
/** Low quality draws this share of the clumps. */
const LOW_SHARE = 0.6;

/** Whether (x, z) is clear for low scenery (grass, flowers, small rocks): off the platforms × 1.15 and the 1.2-unit strip in
 *  front of the player's platform, on the ground the camera frames (FRAMED_FRONT). */
export function arenaClear(stage: Stage): (x: number, z: number) => boolean {
  const fp = PLATFORM_FOOTPRINT, k = CLEAR.footprint;
  const ellipses: Ellipse[] = [
    { x: stage.player.x, z: stage.player.z, rx: fp.player.rx * k, rz: fp.player.rz * k },
    { x: stage.enemy.x, z: stage.enemy.z, rx: fp.enemy.rx * k, rz: fp.enemy.rz * k },
  ];
  const p = stage.player, w = fp.player.rx * k, front = fp.player.rz * k + CLEAR.strip;
  return (x, z) => !ellipses.some((e) => insideEllipse(e, x, z)) && !(Math.abs(x - p.x) < w && z > p.z && z - p.z < front)
    && z <= stage.centre.z + FRAMED_FRONT;
}

/** grass 900 (r 2.3–15, scale 0.85–1.1), longGrass 1500 (r 2–16; scale LONG_SCALE × 1.0–1.25 within r < 9, × 0.85–1.0
 *  beyond), plain 260 in 6–10 patches (r 5–16), sand 60 dry tufts, pond 300 on its shore band; outside the platforms ×
 *  1.15 and the 1.2-unit strip in front of the player platform; × 0.6 at low quality. */
export function grassPlacements(kind: ArenaKind, stage: Stage, seed: number, quality: Quality): ArenaClump[] {
  const rule = GRASS[kind];
  if (!rule) return [];
  const s = seed * 7919 + salt(kind) + 0x6a55;
  const r = rng(s ^ 0xc1a);
  const clear = arenaClear(stage);
  const cx = stage.centre.x, cz = stage.centre.z;
  let accept = clear;
  if (kind === 'plain') {
    // the patches: centres in the annulus, off the platforms
    const n = PATCH.min + Math.floor(r() * (PATCH.max - PATCH.min + 1));
    const patches = scatter(s ^ 0x9a7c, { centre: stage.centre, r0: rule.r[0], r1: rule.r[1], count: n, minGap: 3.5, accept: clear })
      .map((p) => ({ ...p, r: PATCH.r[0] + (PATCH.r[1] - PATCH.r[0]) * r() }));
    accept = (x, z) => clear(x, z) && patches.some((p) => (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r);
  } else if (kind === 'pond') {
    accept = (x, z) => {
      const e = Math.hypot((x - cx) / POND.rx, (z - cz - POND.dz) / POND.rz);
      return clear(x, z) && e >= SHORE[0] && e <= SHORE[1];
    };
  }
  const count = Math.round(rule.count * (quality === 'low' ? LOW_SHARE : 1));
  const worn = wornOf(stage);
  const pts = scatter(s, { centre: stage.centre, r0: rule.r[0], r1: rule.r[1], count, minGap: rule.gap,
    accept: (x, z) => accept(x, z) && (!worn(x, z) || noise2(x * 3.1, z * 3.1, 0x3a7) > WORN_GRASS) });
  const cap = sightCap(stage);
  const out: ArenaClump[] = [];
  for (const { x, z } of pts) {
    // broad lighter and darker patches across the field (and taller and shorter ones), each clump its own shade; no
    // taller than the camera's sight lines to the platform tops allow
    const broad = noise2(x * 0.3, z * 0.3, 7), tall = 1 + 0.12 * noise2(x * 0.21, z * 0.21, 0x7a1);
    const fit = (cap(x, z) - groundHeight(kind, x, z, stage)) / CLUMP_TOP;
    const scale = Math.min(rule.scale(Math.hypot(x - cx, z - cz), r()) * tall, fit);
    const yaw = r() * Math.PI * 2, shade = (0.9 + 0.1 * broad) * (0.82 + 0.18 * r());
    if (scale >= MIN_CLUMP) out.push({ x, z, scale, yaw, shade });
  }
  return out;
}

/** A clump's top over its root, at scale 1 (the kit's blades: 0.48–0.7, leaning). */
export const CLUMP_TOP = 0.72;
/** A clump the sight cap shrinks below this scale is left out. */
const MIN_CLUMP = 0.4;
/** On the platforms' worn ring (parts/ground.ts WORN_RING, its inner part) only this share of the ground grows grass
 *  (noise2 above this): bare earth with a few tufts. */
const WORN_GRASS = 0.45;
/** Whether (x, z) lies on the inner, fully worn part of the platforms' worn ring. */
function wornOf(stage: Stage): (x: number, z: number) => boolean {
  const fp = PLATFORM_FOOTPRINT, e = WORN_RING.outer[0];
  const rings: Ellipse[] = [
    { x: stage.player.x, z: stage.player.z, rx: fp.player.rx * e, rz: fp.player.rz * e },
    { x: stage.enemy.x, z: stage.enemy.z, rx: fp.enemy.rx * e, rz: fp.enemy.rz * e },
  ];
  return (x, z) => rings.some((r) => insideEllipse(r, x, z));
}

/** grass / plain: 120 flowers, r 3–14, in loose drifts (a noise field), off the platforms; none elsewhere. */
export function flowerPlacements(kind: ArenaKind, stage: Stage, seed: number): ArenaClump[] {
  if (kind !== 'grass' && kind !== 'plain') return [];
  const s = seed * 7919 + salt(kind) + 0xf10;
  const clear = arenaClear(stage), worn = wornOf(stage), cap = sightCap(stage);
  const size = FLOWER_SCALE[kind];
  const pts = scatter(s, { centre: stage.centre, r0: 3, r1: 14, count: 120, minGap: 0.45,
    accept: (x, z) => clear(x, z) && !worn(x, z) && noise2(x * 0.22, z * 0.22, 0xf1) > -0.25
      && cap(x, z) - groundHeight(kind, x, z, stage) >= FLOWER_TOP * size * 1.15 });
  const r = rng(s ^ 0x77);
  // (their heads, tipped towards +z, face the camera's side, a little turned: as the overworld's)
  return pts.map(({ x, z }) => ({ x, z, scale: size * (0.85 + 0.3 * r()), yaw: (r() - 0.5) * 1.2, shade: r() }));
}
/** The kit's flower (0.3 tall: a cell's) at the battle's size: on grass a little over the blades, smaller on the plain's
 *  open lawn. */
const FLOWER_SCALE: Record<'grass' | 'plain', number> = { grass: 1.45, plain: 1.15 };
/** A flower's top over its root, at scale 1. */
const FLOWER_TOP = 0.36;

/** Petal colours: the background's accent and three soft ones (sRGB). */
const WHITE: RGB = [0.97, 0.96, 0.92], SOFT_YELLOW: RGB = [0.98, 0.88, 0.42], SOFT_PINK: RGB = [0.96, 0.66, 0.74];
/** In place of a green accent. */
const SOFT_LILAC: RGB = [0.78, 0.7, 0.96];
/** The flowers' centres (sRGB). */
const FLOWER_CENTRE: RGB = [0.98, 0.78, 0.3];
/** The grass's distance bands from the camera (the clumps sorted near to far: each band up to this share of them), one
 *  clump shape (the kit's variant) each; the far band draws half the blades, its clumps a little wider (on screen they
 *  are a few pixels across). */
const CLUMP_BANDS = [{ until: 0.4, blades: 1, spread: 1 }, { until: 0.7, blades: 1, spread: 1 }, { until: 1, blades: 0.5, spread: 1.15 }];

/** `list` sorted by distance from `camera` (x, z), nearest first. */
function byCameraDistance<T extends { x: number; z: number }>(list: T[], camera: THREE.Vector3): T[] {
  const d = (p: T) => (p.x - camera.x) ** 2 + (p.z - camera.z) ** 2;
  return list.map((p) => ({ p, d: d(p) })).sort((a, b) => a.d - b.d).map((e) => e.p);
}
/** Trees and clumps sink this far into the rolling ground (no root floats over a slope). */
const SINK = { tree: 0.15, clump: 0.03 };
/** Palms are drawn squat and wide: the battle camera sees no higher than ≈ 2 units at their distance, where the kit
 *  palm's crown is — shorter trunks bring the crowns into view, wider ones make chunky palms with full fronds. */
const PALM = { squat: 0.68, wide: 1.45 };
/** The desert's dry tufts: the blade colour this far towards straw. */
const DRY: { straw: RGB; mix: number } = { straw: [0.78, 0.7, 0.44], mix: 0.45 };

const PNC = { position: 3, normal: 3, color: 3 }, PNC4 = { position: 3, normal: 3, color: 4 };
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

/** Trees this near the stage centre cast shadows: the sun's shadow camera (BattleView: ±14 units around the stage, seen
 *  along the sun) covers the ground to ≈ 19 units behind it; a tree further out casts no shadow the battle shows (0 px
 *  against every tree casting, grass / long grass / plain / pond / doubles, yaw ±0.9, dusk and night). */
export const TREE_CAST_R = 26;

/** The flora's seed (one arena per kind: always the same). */
const FLORA_SEED = 1;

export const FLORA_PART: ArenaPart = {
  name: 'flora',
  kinds: ['grass', 'longGrass', 'plain', 'sand', 'pond'],
  catalogue(): readonly CatalogueEntry[] {
    return [
      // (the near trees cast, the far ones not: TREE_CAST_R; the palms stand within it, r ≤ 26 on sand: they all cast)
      ...TREE_STYLES.flatMap((style): CatalogueEntry[] => (style === 'palm' ? [true] : [true, false]).map((castShadow) =>
        ({ material: treeMaterial(style, new THREE.Color()), mesh: 'instancedColors', attrs: PNC4, castShadow }))),
      { material: GRASS_MATERIAL, mesh: 'instancedColors', attrs: PNC, castShadow: false },
      { material: flowerMaterial(new THREE.Color(), new THREE.Color()), mesh: 'instancedColors', attrs: PNC4, castShadow: false },
    ];
  },
  build(ctx) {
    const { kind, stage, palette } = ctx;
    const group = new THREE.Group();
    // (on sand, over the dunes where they rise)
    const dunes = kind === 'sand' ? duneMounds(FLORA_SEED, stage) : null;
    const ground = (x: number, z: number) => {
      const y = groundHeight(kind, x, z, stage);
      return dunes ? Math.max(y, duneSurface(dunes, stage, x, z)) : y;
    };

    // (the camera at yaw 0: what is drawn nearest it first)
    const camera = battleCamera(stage, 0);

    // trees, one draw per (style, variant), one material per style, nearest first
    const trees = byCameraDistance(treePlacements(kind, stage, FLORA_SEED), camera);
    const leaf = toLinear(palette.leaf), trunk = toLinear(palette.trunk);
    // (only the trees near enough for their shadows to reach the ground the shadow map covers cast: the rest would only
    // add their shadow-pass draws)
    const casts = (t: ArenaTree) => Math.hypot(t.x - stage.centre.x, t.z - stage.centre.z) <= TREE_CAST_R;
    const byShape = new Map<string, ArenaTree[]>();
    for (const t of trees) {
      const id = `${t.style}:${t.variant}:${casts(t) ? 1 : 0}`;
      const list = byShape.get(id);
      if (list) list.push(t); else byShape.set(id, [t]);
    }
    const mats = new Map<TreeStyle, ReturnType<typeof kitMaterial>>();
    for (const list of byShape.values()) {
      const { style, variant } = list[0];
      let km = mats.get(style);
      if (!km) mats.set(style, (km = kitMaterial(ctx.uniforms, treeMaterial(style, new THREE.Color(...trunk)))));
      const mesh = new THREE.InstancedMesh(treeGeometry(style, variant, treeCrownDetail(style, ctx.quality)), km.material, list.length);
      applyKitMaterial(mesh, km);
      list.forEach((t, i) => {
        // (each tree's own jitter, from where it stands: however the trees are grouped)
        const jitter = rng(hashCell(Math.round(t.x * 64), Math.round(t.z * 64), 0x7ee5));
        _q.setFromAxisAngle(_up, t.yaw);
        const k = t.scale, palm = style === 'palm', ky = palm ? PALM.squat : 1, kxz = palm ? PALM.wide : 1;
        _m.compose(_p.set(t.x, ground(t.x, t.z) - SINK.tree * k, t.z), _q,
          _s.set(k * kxz * (0.94 + 0.12 * jitter()), k * ky * (0.92 + 0.16 * jitter()), k * kxz * (0.94 + 0.12 * jitter())));
        mesh.setMatrixAt(i, _m);
        // (as the tree family: the leaf colour × the tree's shade, a little warmer or cooler)
        const w = (jitter() - 0.5) * 0.08;
        mesh.setColorAt(i, _c.setRGB(leaf[0] * t.shade * (1 + w), leaf[1] * t.shade, leaf[2] * t.shade * (1 - w)));
      });
      const cast = casts(list[0]);
      mesh.name = `trees:${style}:${variant}${cast ? '' : ':far'}`;
      mesh.castShadow = cast;
      mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    }

    // grass clumps: nearest the camera first (its blades hide the ones behind them before they are shaded), in distance
    // bands of one clump shape each — one draw per band, three sorts them near to far — the farthest with fewer blades
    const clumps = byCameraDistance(grassPlacements(kind, stage, FLORA_SEED, ctx.quality), camera);
    if (clumps.length) {
      const km = kitMaterial(ctx.uniforms, GRASS_MATERIAL);
      const blade = toLinear(kind === 'sand' ? mix(palette.blade, DRY.straw, DRY.mix) : palette.blade);
      let from = 0;
      for (let v = 0; v < CLUMP_BANDS.length; v++) {
        const band = CLUMP_BANDS[v], to = v === CLUMP_BANDS.length - 1 ? clumps.length : Math.round(clumps.length * band.until);
        const mine = clumps.slice(from, to);
        from = to;
        if (!mine.length) continue;
        const blades = Math.max(BLADES.low, Math.round(BLADES[ctx.quality] * band.blades));
        const inst = new THREE.InstancedMesh(clump(blades, v), km.material, mine.length);
        applyKitMaterial(inst, km);
        mine.forEach((c, i) => {
          _q.setFromAxisAngle(_up, c.yaw);
          _m.compose(_p.set(c.x, ground(c.x, c.z) - SINK.clump, c.z), _q, _s.set(c.scale * band.spread, c.scale, c.scale * band.spread));
          inst.setMatrixAt(i, _m);
          inst.setColorAt(i, _c.setRGB(blade[0] * c.shade, blade[1] * c.shade, blade[2] * c.shade));
        });
        inst.name = `grass:${v}`;
        inst.castShadow = false;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        group.add(inst);
      }
    }

    // flowers: one draw, petals per instance
    const flowers = flowerPlacements(kind, stage, FLORA_SEED);
    if (flowers.length) {
      const centre = toLinear(FLOWER_CENTRE), stem = toLinear(palette.blade);
      const km = kitMaterial(ctx.uniforms, flowerMaterial(new THREE.Color(...centre), new THREE.Color(...stem)));
      const inst = new THREE.InstancedMesh(flowerGeometry(), km.material, flowers.length);
      applyKitMaterial(inst, km);
      // (the background's accent where it is a flower's colour: grass backgrounds' are pale greens, read as leaves)
      const accent = palette.accent[1] >= palette.accent[0] && palette.accent[1] >= palette.accent[2] ? SOFT_LILAC : palette.accent;
      const petals = [accent, WHITE, SOFT_YELLOW, SOFT_PINK].map(toLinear);
      flowers.forEach((f, i) => {
        _q.setFromAxisAngle(_up, f.yaw);
        _m.compose(_p.set(f.x, ground(f.x, f.z) - SINK.clump, f.z), _q, _s.setScalar(f.scale));
        inst.setMatrixAt(i, _m);
        const p = petals[Math.min(petals.length - 1, Math.floor(f.shade * petals.length))], v = 0.92 + 0.16 * ((f.shade * 7.3) % 1);
        inst.setColorAt(i, _c.setRGB(p[0] * v, p[1] * v, p[2] * v));
      });
      inst.name = 'flowers';
      inst.castShadow = false;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    return group;
  },
};
