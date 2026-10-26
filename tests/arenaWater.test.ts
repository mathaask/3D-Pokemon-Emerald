import { describe, it, expect } from 'vitest';
import { waterField, lilyPadGeometry, kelpGeometry } from '../src/render/battle/parts/water';
import { POND } from '../src/render/battle/parts/ground';
import { STAGE, WATER_Y } from '../src/render/battle/stage';
import * as THREE from 'three';
import {
  WATER_LOOK, WATER_RENDER_ORDER, arenaWaterMaterial, isletPlacements, kelpPlacements, padPlacements, shaftGeometry,
  waterRocks, waterSheets,
} from '../src/render/battle/parts/water';
import { CAVE_POND, GROUND_RENDER_ORDER, TOPS_RENDER_ORDER, groundHeight } from '../src/render/battle/parts/ground';
import { CLUMP_TOP, REED, arenaClear, grassPlacements } from '../src/render/battle/parts/flora';
import { frameTop, insideEllipse, sightCap, stageKeepOut } from '../src/render/battle/parts/scatter';
import { ModernArena } from '../src/render/battle/modernArena';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { createKitUniforms } from '../src/render/kit/materials';
import { PLATFORM_FOOTPRINT } from '../src/render/battle/stage';
import type { ArenaKind } from '../src/render/battle/arenaKind';

const at = (f: ReturnType<typeof waterField>, x: number, z: number, ch: number) =>
  f.data[((Math.floor(z - WATER_Y - f.min[1])) * f.w + Math.floor(x - f.min[0])) * 4 + ch];
describe('arena water', () => {
  it('is deep everywhere on the sea and flags its rocks', () => {
    const rock = { x: Math.round(STAGE.centre.x + 5), z: Math.round(STAGE.centre.z - 20) };
    const f = waterField('water', STAGE, [rock]);
    expect(at(f, STAGE.centre.x, STAGE.centre.z, 0)).toBe(255);
    expect(at(f, STAGE.centre.x + 20, STAGE.centre.z - 30, 0)).toBe(255);
    expect(at(f, rock.x + 0.5, rock.z + 0.5, 3)).toBe(255);
  });
  it('measures the pond\'s shore distance from its banks', () => {
    const f = waterField('pond', STAGE, []);
    const cz = STAGE.centre.z + POND.dz;
    expect(at(f, STAGE.centre.x, cz, 0)).toBeGreaterThanOrEqual(Math.round((5 / 15) * 255));
    expect(at(f, STAGE.centre.x + POND.rx - 0.5, cz, 0)).toBe(Math.round((1 / 15) * 255));
    expect(at(f, STAGE.centre.x + POND.rx + 3, cz, 0)).toBe(0);
  });
  it('builds pads that float and kelp that stands tall', () => {
    const pad = lilyPadGeometry(1, 0.6, [0.4, 0.7, 0.3]); pad.computeBoundingBox();
    expect(pad.boundingBox!.max.y).toBeLessThan(0.08);
    const kelp = kelpGeometry(1, [0.3, 0.45, 0.2]); kelp.computeBoundingBox();
    expect(kelp.boundingBox!.min.y).toBeCloseTo(0, 2); expect(kelp.boundingBox!.max.y).toBeGreaterThan(2.4);
  });
});

// Beyond the brief's tests: the draw order and opacity of the water sheets, the clouds per vertex, the placements' rules.
describe('arena water: sheets, order, placements', () => {
  const ko = stageKeepOut(STAGE);

  it('draws the deep water first and opaque (the seabed under it never shaded), only a pond\'s shallow rim blending', () => {
    const u = createKitUniforms();
    for (const kind of ['water', 'kyogre', 'pond', 'cavePond', 'underwater'] as ArenaKind[]) {
      const a = new ModernArena(u);
      expect(a.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const deep = a.group.getObjectByName('water') as THREE.Mesh | undefined;
      const rim = a.group.getObjectByName('waterShallows') as THREE.Mesh | undefined;
      if (kind === 'underwater') {
        // (the part's group is named 'water' too: the sheet is a mesh)
        expect(deep?.isMesh ?? false, kind).toBe(false);
        expect(a.group.getObjectByName('lightShafts'), kind).toBeDefined();
        expect(a.group.getObjectByName('kelp:0'), kind).toBeDefined();
      } else {
        const sheet = a.group.getObjectByName('water')!.getObjectByName('waterSheet') as THREE.Mesh;
        const m = sheet.material as THREE.Material;
        expect([m.transparent, m.depthWrite, sheet.renderOrder, sheet.receiveShadow], kind).toEqual([false, true, WATER_RENDER_ORDER, true]);
        expect(rim !== undefined, kind).toBe(kind === 'pond' || kind === 'cavePond');
        if (rim) expect([(rim.material as THREE.Material).transparent, (rim.material as THREE.Material).depthWrite], kind).toEqual([true, false]);
      }
      a.dispose();
    }
    // before the scenery (0), the battlers (2), the platform tops and the ground
    expect(WATER_RENDER_ORDER).toBeLessThan(0);
    expect(WATER_RENDER_ORDER).toBeLessThan(Math.min(TOPS_RENDER_ORDER, GROUND_RENDER_ORDER));
  });

  it('closes a pond\'s sheet without a seam, its opaque core where the shallows are already opaque', () => {
    for (const kind of ['pond', 'cavePond'] as const) {
      const { deep, rim } = waterSheets(kind, STAGE);
      const key = (p: THREE.BufferAttribute, i: number) => `${p.getX(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
      const dp = deep.getAttribute('position') as THREE.BufferAttribute, rp = rim!.getAttribute('position') as THREE.BufferAttribute;
      const deepSet = new Set(Array.from({ length: dp.count }, (_, i) => key(dp, i)));
      // (the rim's inner ring: its first 96 vertices)
      for (let i = 0; i < 96; i++) expect(deepSet.has(key(rp, i)), `${kind} rim vertex ${i}`).toBe(true);
      // every core vertex lies on water at least WATER_LOOK.shallow[1] cells from the shore (its cell's value)
      const f = waterField(kind, STAGE, []);
      for (let i = 0; i < dp.count; i++) {
        expect(at(f, dp.getX(i), dp.getZ(i), 0), `${kind} core vertex ${i}`).toBeGreaterThanOrEqual(Math.round((Math.ceil(WATER_LOOK.shallow[1]) / 15) * 255));
        expect(dp.getY(i)).toBeCloseTo(WATER_Y, 6);
      }
    }
  });

  it('reflects the clouds per vertex: no cloud noise per pixel; their strength and the mirror\'s are the build\'s', () => {
    const o = arenaWaterMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1), [0.3, 0.5, 0.8]);
    expect(o.vertWorld).toContain('arenaClouds(');
    for (const h of [o.fragHead, o.fragColor, o.fragNormal, o.fragEmissive]) expect(h ?? '').not.toContain('arenaClouds(');
    expect(o.fragEmissive).toContain('vArenaCloud');
    // the glints too by the mirror's strength (a cave's water shows few), and the kit's own field sample reused: one fetch
    expect(o.fragEmissive).toContain('(refl + uSky * glint * 0.8) * uMirror');
    // (the field at the fragment's cell: the kit's sample only; its other fetch is the rock lookup at the cell's corner)
    expect(o.fragColor!.split('texture(tWater, (cell - uGridMin) / uGridSize)').length - 1).toBe(1);
    expect(o.fragColor!.split('texture(tWater,').length - 1).toBe(2);
    expect(o.fragColor).toContain('arenaShore = wd.r * 15.0;');
    expect(o.hookKey).toBe('arenaWater');
    expect(o.vertTransform).toBeUndefined();
    expect([o.uniforms!.uClouds.value, o.uniforms!.uMirror.value]).toEqual([1, 1]);
    const cave = arenaWaterMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1), [0, 0, 0], 0, 0.3);
    expect([cave.uniforms!.uClouds.value, cave.uniforms!.uMirror.value]).toEqual([0, 0.3]);
  });

  it('stands the rocks in the water and the islets on the tall rule, each with its foam collar in the field', () => {
    for (const kind of ['water', 'kyogre', 'cavePond'] as const) {
      const rocks = waterRocks(kind, STAGE, 1);
      // (as many as each rule asks: water 6–9, kyogre 3–5, cavePond 3–4)
      const [lo, hi] = { water: [6, 9], kyogre: [3, 5], cavePond: [3, 4] }[kind];
      expect(rocks.length, kind).toBeGreaterThanOrEqual(lo);
      expect(rocks.length, kind).toBeLessThanOrEqual(hi);
      const f = waterField(kind, STAGE, rocks.flatMap((k) => k.corners));
      for (const k of rocks) {
        expect(ko.tallOk(k.x, k.z), `${kind} rock`).toBe(true);
        for (const c of k.corners) expect(at(f, c.x + 0.5, c.z + WATER_Y + 0.5, 3), `${kind} collar`).toBe(255);
        if (kind === 'cavePond') {
          expect(Math.hypot((k.x - STAGE.centre.x) / CAVE_POND.rx, (k.z - STAGE.centre.z - CAVE_POND.dz) / CAVE_POND.rz)).toBeLessThan(0.9);
        }
      }
    }
    expect(waterRocks('water', STAGE, 1).length).toBeGreaterThanOrEqual(6);
    expect(waterRocks('pond', STAGE, 1)).toEqual([]);
    const islets = isletPlacements(STAGE, 1), top = frameTop(STAGE);
    expect(islets).toHaveLength(2);
    for (const i of islets) {
      expect(ko.tallOk(i.x, i.z)).toBe(true);
      expect(i.palms.length).toBeGreaterThanOrEqual(1);
      // each palm's crown (its fronds 2.0 × scale × the squat 0.68 over its foot) shows 0.4 under the frame's top edge
      for (const p of i.palms) expect(p.y - p.sink + 2.0 * p.scale * 0.68 + 0.4).toBeLessThanOrEqual(top(p.x, p.z) + 1e-9);
    }
  });

  it('floats the pond\'s pads on its open water, off the platforms\' own pads and the camera\'s strip', () => {
    const pads = padPlacements(STAGE, 1), clear = arenaClear(STAGE), fp = PLATFORM_FOOTPRINT;
    expect(pads.length).toBeGreaterThanOrEqual(8);
    expect(pads.length).toBeLessThanOrEqual(14);
    for (const p of pads) {
      expect(clear(p.x, p.z)).toBe(true);
      expect(Math.hypot((p.x - STAGE.centre.x) / POND.rx, (p.z - STAGE.centre.z - POND.dz) / POND.rz)).toBeLessThan(0.8);
      for (const [c, f] of [[STAGE.player, fp.player], [STAGE.enemy, fp.enemy]] as const) {
        expect(insideEllipse({ x: c.x, z: c.z, rx: f.rx * 1.7, rz: f.rz * 1.7 }, p.x, p.z)).toBe(false);
      }
    }
  });

  it('keeps the reeds, the kelp and the light shafts out of the camera\'s way', () => {
    const cap = sightCap(STAGE);
    const reeds = grassPlacements('pond', STAGE, 1, 'high');
    expect(reeds.length).toBeGreaterThan(100);
    // (a reed at its full height: REED.tall × its clump's)
    for (const c of reeds) expect(groundHeight('pond', c.x, c.z, STAGE) + CLUMP_TOP * c.scale * REED.tall).toBeLessThanOrEqual(cap(c.x, c.z) + 1e-9);
    const kelp = kelpPlacements(STAGE, 1);
    expect(kelp.length).toBeGreaterThanOrEqual(30);
    // (every stalk on the tall rule and out from behind a battler up to 9 units back)
    const behind = (x: number, z: number) => [STAGE.player, STAGE.enemy].some((p) => z < p.z && z > p.z - 9 && Math.abs(x - p.x) < 3.5);
    for (const k of kelp) expect(ko.tallOk(k.x, k.z) && !behind(k.x, k.z), `kelp (${k.x.toFixed(1)}, ${k.z.toFixed(1)})`).toBe(true);
    const p = shaftGeometry(STAGE, 1)!.getAttribute('position');
    expect(p.count).toBeGreaterThan(0);
    // (each shaft's foot: its first vertex of 10)
    for (let i = 0; i < p.count; i += 10) expect(ko.tallOk(p.getX(i), p.getZ(i)), `shaft ${i / 10}`).toBe(true);
  });
});
