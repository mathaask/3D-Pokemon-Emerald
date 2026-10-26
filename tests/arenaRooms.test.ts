import { describe, it, expect } from 'vitest';
import { roomShell, courtLines, pillarGeometry, HALLS } from '../src/render/battle/parts/rooms';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { arenaPalette } from '../src/render/battle/palette';
import { BATTLE_CAMERA, STAGE, GROUND_Y } from '../src/render/battle/stage';
import * as THREE from 'three';
import { HALL_PART, PANEL, SEATS, SHELF, SHELL, bannerGeometry, hallColors, hallLayout, seatTiers, wallFrame, type HallKind } from '../src/render/battle/parts/rooms';
import { COURT_BOUNDS, FLOOR_COURT, FLOOR_STYLE, hallFloorMaterial } from '../src/render/battle/parts/floor';
import { frameProjector } from '../src/render/battle/parts/scatter';
import { ModernArena } from '../src/render/battle/modernArena';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { ARENA_KINDS } from '../src/render/battle/arenaKind';
import { PLATFORM_FOOTPRINT } from '../src/render/battle/stage';
import { BUILDING_BODY, BUILDING_GLASS } from '../src/render/kit/buildings';
import { PROP_GLOW } from '../src/render/kit/props';
import { SOIL_MATERIAL } from '../src/render/kit/soil';
import { createKitUniforms, kitMaterial, kitMaterialKind, type KitMaterialOptions } from '../src/render/kit/materials';
import { luma } from '../src/render/kit/palette';
import { STADIUM_THEME, crystalGeometry, arenaRimGeometry } from '../src/render/battle/parts/stadium';
import { brokenEdgeGeometry, cloudSeaGeometry } from '../src/render/battle/parts/skyPillar';
import { MAGMA_LAVA, RIM, STADIUM_KINDS, STADIUM_PART, spikePlacements, stadiumItems, stadiumLava, type StadiumKind } from '../src/render/battle/parts/stadium';
import { EDGE, SKY_PILLAR_PART, stumpPlacements } from '../src/render/battle/parts/skyPillar';
import { LAVA_GLOW, LAVA_MATERIAL, ROCK_PART, TIP_SHOWN, clusterSpires, lavaGeometry, lavaMaterial, lavaPools, poolRadius, type LavaPool } from '../src/render/battle/parts/rock';
import { SCENERY_SEED, battleCamera, frameTop, sightCap } from '../src/render/battle/parts/scatter';
import { arenaClear } from '../src/render/battle/parts/flora';
import { ARENA_PARTS } from '../src/render/battle/modernArena';
import { GROUND_RADIUS, GROUND_RENDER_ORDER } from '../src/render/battle/parts/ground';
import { WATER_RENDER_ORDER, arenaWaterMaterial, opaqueWater } from '../src/render/battle/parts/water';
import { CLIFF_MATERIAL } from '../src/render/kit/cliffs';
import { PROP_BODY } from '../src/render/kit/props';
import { arenaLook } from '../src/render/battle/look';
import { toLinear } from '../src/render/kit/palette';

describe('indoor halls', () => {
  const ko = stageKeepOut(STAGE);
  it('closes the back and sides at the hall\'s size, never on the camera\'s side', () => {
    const s = HALLS.gym, g = roomShell(s, STAGE, arenaPalette('gym', null));
    g.computeBoundingBox();
    const b = g.boundingBox!;
    expect(b.min.z).toBeCloseTo(STAGE.centre.z + s.back - 0.4, 1);
    expect(b.max.y).toBeCloseTo(GROUND_Y + s.height, 1);
    expect(b.max.x - b.min.x).toBeCloseTo(2 * s.halfWidth + 0.8, 1);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 1) expect(ko.tallOk(p.getX(i), p.getZ(i))).toBe(true);
  });
  it('paints court lines flat on the floor and stands pillars at their height', () => {
    const g = courtLines(STAGE, [0.95, 0.95, 0.9]), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      expect(p.getY(i)).toBeGreaterThanOrEqual(GROUND_Y); expect(p.getY(i)).toBeLessThanOrEqual(GROUND_Y + 0.01);
    }
    const pl = pillarGeometry(0.5, 9, [0.8, 0.8, 0.8]); pl.computeBoundingBox();
    expect(pl.boundingBox!.max.y).toBeCloseTo(9, 1);
  });
});

const HALL_KINDS: HallKind[] = ['building', 'gym', 'leader', 'frontier'];

/** A kit material's uniform as its build set it (the pooled material's slot: compile it on a stub to read them). */
function kitUniformOf(mesh: THREE.Mesh, name: string): unknown {
  const m = mesh.material as THREE.MeshStandardMaterial;
  const s = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '', fragmentShader: '' };
  m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return s.uniforms[name].value;
}
const meshesUnder = (o: THREE.Object3D) => {
  const out: THREE.Mesh[] = [];
  o.traverse((m) => { if ((m as THREE.Mesh).isMesh) out.push(m as THREE.Mesh); });
  return out;
};
/** The pool kind of a kit material made from `o` (another uniforms' pool: the kind does not depend on it). */
const kindOf = (o: KitMaterialOptions) => kitMaterialKind(kitMaterial(createKitUniforms(), o).material);

describe('indoor halls: shells, furniture, floors, the part', () => {
  const ko = stageKeepOut(STAGE);
  const cx = STAGE.centre.x, cz = STAGE.centre.z;

  it("closes every hall at its size; nothing of it over 1 unit stands off the tall rule or on the camera's side", () => {
    const u = createKitUniforms();
    for (const kind of HALL_KINDS) {
      const s = HALLS[kind], g = roomShell(s, STAGE, arenaPalette(kind, null));
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.z, kind).toBeCloseTo(cz + s.back - 0.4, 3);
      expect(b.max.z, kind).toBeLessThanOrEqual(cz + 3.9 + 1e-4);
      expect(b.max.y, kind).toBeCloseTo(GROUND_Y + s.height, 3);
      expect(b.min.x, kind).toBeCloseTo(cx - s.halfWidth - 0.4, 3);
      expect(b.max.x, kind).toBeCloseTo(cx + s.halfWidth + 0.4, 3);
      // the whole part: shell, pillars, banners, windows, shelves, seats, panels
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      for (const m of meshesUnder(arena.group.getObjectByName('hall')!)) {
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          // (standing things: the court's flat paint runs on towards the camera)
          if (p.getY(i) > GROUND_Y + 0.05 && p.getZ(i) > cz + 4) throw new Error(`${kind} ${m.name}: z ${p.getZ(i)} on the camera's side`);
          if (p.getY(i) > 1 && !ko.tallOk(p.getX(i), p.getZ(i))) throw new Error(`${kind} ${m.name}: (${p.getX(i)}, ${p.getY(i)}, ${p.getZ(i)}) off the tall rule`);
        }
      }
      arena.dispose();
    }
  });

  it('builds the halls as HALLS counts them: their furniture, its draws and their materials', () => {
    expect(HALL_PART.kinds).toEqual(HALL_KINDS);
    for (const kind of HALL_KINDS) {
      const h = HALLS[kind], l = hallLayout(kind);
      expect([l.pillars.length, l.windows.length, l.banners.length, l.lights.length], kind).toEqual([h.pillars, h.windows, h.banners, h.lights]);
    }
    expect(HALLS.building.seats || HALLS.gym.seats || HALLS.leader.seats).toBe(false);
    expect(HALLS.frontier.seats).toBe(true);
    const u = createKitUniforms();
    const want: Record<HallKind, string[]> = { building: ['hallRoom', 'hallWindows'], gym: ['hallRoom', 'courtLines'],
      leader: ['hallRoom', 'courtLines'], frontier: ['hallRoom', 'hallLights'] };
    const mat: Record<string, [KitMaterialOptions, boolean]> = { hallRoom: [BUILDING_BODY, true], hallWindows: [BUILDING_GLASS, true],
      hallLights: [PROP_GLOW, false], courtLines: [SOIL_MATERIAL, false] };
    for (const kind of HALL_KINDS) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const meshes = meshesUnder(arena.group.getObjectByName('hall')!);
      expect(meshes.map((m) => m.name), kind).toEqual(want[kind]);
      for (const m of meshes) {
        const [options, cast] = mat[m.name];
        expect(kitMaterialKind(m.material as THREE.Material), `${kind} ${m.name}`).toBe(kindOf(options));
        expect(m.castShadow, `${kind} ${m.name}`).toBe(cast);
        expect(m.receiveShadow || m.name === 'hallLights', `${kind} ${m.name}`).toBe(true);
        // (exactly the catalogue's attribute set: position, normal, color(3), Float32; no uv)
        expect(Object.keys(m.geometry.attributes).sort(), `${kind} ${m.name}`).toEqual(['color', 'normal', 'position']);
        for (const a of Object.values(m.geometry.attributes)) expect(a.itemSize === 3 && a.array instanceof Float32Array).toBe(true);
        expect(m.geometry.index, `${kind} ${m.name}`).toBeNull();
      }
      arena.dispose();
    }
  });

  it("stands the bookcases' backs in front of the wall's relief (no trim showing through them)", () => {
    // the shell's relief under the crown: the back wall's furthest offset into the room is SHELL.relief (its strips run
    // corner to corner: measured by distance from the wall, not along it)
    const s = HALLS.building, g = roomShell(s, STAGE, arenaPalette('building', null)), p = g.getAttribute('position');
    const back = cz + s.back;
    let relief = 0;
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < GROUND_Y + s.height - SHELL.crown && p.getZ(i) - back < 0.3) relief = Math.max(relief, p.getZ(i) - back);
    }
    expect(relief).toBeCloseTo(SHELL.relief, 5);
    expect(SHELF.back).toBeGreaterThanOrEqual(SHELL.relief + 0.01);
    // In each bookcase of the built room (hallRoom): (a) its back panel's four corners stand at d = SHELF.back; (b) every
    // vertex inside its interior (between its side boards, over its plinth, under its top board) that is not the wall's
    // own (roomShell's vertices: the trim and panels behind it) stands at d ≥ SHELF.back — the books, the shelves and the
    // back panel; at the old offsets (back panel 0.035, shelves 0.04, books 0.06) both fail.
    const arena = new ModernArena(createKitUniforms());
    expect(arena.build('building', defaultArenaColors('building'), 'medium')).toBe(true);
    const q = (arena.group.getObjectByName('hallRoom') as THREE.Mesh).geometry.getAttribute('position');
    const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
    const wall = new Set<string>();
    for (let i = 0; i < p.count; i++) wall.add(key(p.getX(i), p.getY(i), p.getZ(i)));
    const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
    for (const sh of hallLayout('building').shelves) {
      const xi0 = cx + sh.s - SHELF.width / 2 + SHELF.board, xi1 = cx + sh.s + SHELF.width / 2 - SHELF.board;
      const yi0 = GROUND_Y + SHELF.plinth, yi1 = GROUND_Y + SHELF.height - SHELF.board;
      // (a) the back panel's corners
      const corners = [[xi0, yi0], [xi1, yi0], [xi1, yi1], [xi0, yi1]].map(([cxr, cyr]) => {
        for (let i = 0; i < q.count; i++) {
          if (near(q.getX(i), cxr) && near(q.getY(i), cyr) && near(q.getZ(i) - back, SHELF.back)) return true;
        }
        return false;
      });
      expect(corners, `bookcase at s ${sh.s}: back panel corners at d ${SHELF.back}`).toEqual([true, true, true, true]);
      // (b) the nearest non-wall vertex inside it
      let nearest = Infinity, inside = 0;
      for (let i = 0; i < q.count; i++) {
        const x = q.getX(i), y = q.getY(i), z = q.getZ(i);
        if (!(x > xi0 + 1e-4 && x < xi1 - 1e-4 && y > yi0 + 1e-4 && y < yi1 - 1e-4) || wall.has(key(x, y, z))) continue;
        inside++;
        nearest = Math.min(nearest, z - back);
      }
      expect(inside, `bookcase at s ${sh.s}: books inside`).toBeGreaterThan(100);
      expect(nearest, `bookcase at s ${sh.s}: nearest thing inside, off the wall`).toBeGreaterThanOrEqual(SHELF.back - 1e-4);
    }
    arena.dispose();
  });

  it('keeps windows, bookcases, banners and light panels out from behind the battlers in the idle frame', () => {
    // the battlers as the lava keeps off them (rock.ts): a 2 × 2 box on each platform, projected by the idle camera
    const project = frameProjector(STAGE, 0), v = new THREE.Vector3();
    const rect = (pts: [number, number, number][]) => {
      const r = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y, z] of pts) {
        project(x, y, z, v);
        r[0] = Math.min(r[0], v.x); r[1] = Math.min(r[1], v.y); r[2] = Math.max(r[2], v.x); r[3] = Math.max(r[3], v.y);
      }
      return r;
    };
    const boxes = [STAGE.player, STAGE.enemy].map((p) => rect([-1, 1].flatMap((dx) => [-0.3, 0.3].flatMap((dz) =>
      [0, 2].map((y) => [p.x + dx, y, p.z + dz] as [number, number, number])))));
    const overlaps = (r: number[]) => boxes.some((b) => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]);
    let framed = 0;
    for (const kind of HALL_KINDS) {
      const h = HALLS[kind], l = hallLayout(kind), F = wallFrame('back', h, STAGE);
      const items = [...l.windows.map((w) => ({ ...w, half: 1.35 })), ...l.shelves.map((s) => ({ ...s, half: 1.25 })),
        ...l.banners.map((b) => ({ ...b, half: 0.75 }))];
      for (const it of items.filter((i) => i.wall === 'back')) {
        const r = rect([F.at(it.s - it.half, 0.4, 0), F.at(it.s + it.half, 0.4, 0), F.at(it.s - it.half, 1.6, 0), F.at(it.s + it.half, 1.6, 0)]);
        if (r[2] > -1 && r[0] < 1) framed++;
        expect(overlaps(r), `${kind} back wall s ${it.s}`).toBe(false);
      }
      for (const a of l.lights) {
        const rb = SEATS.r0 - SEATS.wall;
        const at = (b: number, y: number): [number, number, number] => [cx + Math.sin(b) * rb, GROUND_Y + y, cz - Math.cos(b) * rb];
        const half = PANEL.width / 2 / rb;
        const r = rect([at(a - half, PANEL.y0), at(a + half, PANEL.y0), at(a - half, PANEL.y1), at(a + half, PANEL.y1)]);
        if (r[2] > -1 && r[0] < 1) framed++;
        expect(overlaps(r), `${kind} light ${a}`).toBe(false);
      }
    }
    // (and the idle frame shows some of them: windows and bookcases, the gyms' middle banners, light panels)
    expect(framed).toBeGreaterThanOrEqual(10);
  });

  it('paints the court off the platforms: rings round each, the lines and the ball circle between them', () => {
    const g = courtLines(STAGE, [1, 1, 1]), p = g.getAttribute('position');
    const fp = [[STAGE.player, PLATFORM_FOOTPRINT.player], [STAGE.enemy, PLATFORM_FOOTPRINT.enemy]] as const;
    let ring = 0;
    for (let i = 0; i < p.count; i++) {
      const e = Math.min(...fp.map(([c, f]) => Math.hypot((p.getX(i) - c.x) / f.rx, (p.getZ(i) - c.z) / f.rz)));
      // (outside the slabs' plinths: × 1.1)
      if (!(e > 1.12)) throw new Error(`court line vertex ${i} at e ${e} on a platform`);
      if (e <= 1.25 + 1e-6) ring++;
      expect(Math.abs(p.getX(i) - cx)).toBeLessThanOrEqual(COURT_BOUNDS.x + 0.06);
      expect(p.getZ(i)).toBeGreaterThanOrEqual(cz + COURT_BOUNDS.z[0] - 0.06);
      expect(p.getZ(i)).toBeLessThanOrEqual(cz + COURT_BOUNDS.z[1] + 1e-4);
      expect(p.getY(i)).toBeCloseTo(GROUND_Y + 0.005, 6);
    }
    expect(ring).toBeGreaterThan(0);
    const n = g.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(n.getY(i)).toBeCloseTo(1, 6);
  });

  it('stands pillars on their plinth and banners from their tip to their rod; the seat tiers rise behind the barrier, inside the Frontier', () => {
    const pl = pillarGeometry(0.5, 9, [0.8, 0.8, 0.8]);
    pl.computeBoundingBox();
    expect(pl.boundingBox!.min.y).toBeCloseTo(0, 6);
    const bb = pl.boundingBox!;
    expect(Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z)).toBeLessThanOrEqual(0.75 + 1e-6);
    const n = pl.getAttribute('normal');
    for (let i = 0; i < n.count; i++) expect(Math.hypot(n.getX(i), n.getY(i), n.getZ(i))).toBeCloseTo(1, 5);
    const b = bannerGeometry(1.5, 7, [0.7, 0.6, 0.4], [1, 1, 1]);
    b.computeBoundingBox();
    expect(b.boundingBox!.min.y).toBeCloseTo(0, 6);
    expect(b.boundingBox!.max.y).toBeCloseTo(7.05, 6);
    expect(b.boundingBox!.max.x - b.boundingBox!.min.x).toBeCloseTo(1.5 + 0.28, 6);
    const t = seatTiers(STAGE, 5, [0.4, 0.5, 0.55]), tp = t.getAttribute('position');
    let top = -Infinity;
    for (let i = 0; i < tp.count; i++) {
      const r = Math.hypot(tp.getX(i) - cx, tp.getZ(i) - cz);
      expect(r).toBeGreaterThanOrEqual(SEATS.r0 - SEATS.wall - 1e-4);
      expect(r).toBeLessThanOrEqual(SEATS.r0 + 5 * SEATS.depth + 1e-4);
      expect(tp.getZ(i)).toBeGreaterThan(cz + HALLS.frontier.back);
      top = Math.max(top, tp.getY(i));
    }
    // (the last row's seat backs over its tread)
    expect(top).toBeCloseTo(GROUND_Y + SEATS.h0 + 4 * SEATS.rise + 0.52, 3);
  });

  it("floors the halls with the hall floor (boards, tiles; the gyms' courts) and tops their platforms as stages; other kinds keep the terrain", () => {
    expect(FLOOR_STYLE).toMatchObject({ building: 'boards', gym: 'tiles', leader: 'tiles', frontier: 'tiles' });
    const floorKind = kindOf(hallFloorMaterial('tiles', [1, 1, 1]));
    const u = createKitUniforms();
    const courts: Record<string, number> = {};
    for (const kind of ARENA_KINDS) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const ground = arena.group.getObjectByName('ground') as THREE.Mesh;
      const tops = arena.group.getObjectByName('platformTops') as THREE.Mesh | undefined;
      const hall = FLOOR_STYLE[kind];
      expect(kitMaterialKind(ground.material as THREE.Material) === floorKind, kind).toBe(!!hall);
      if (tops) expect(kitMaterialKind(tops.material as THREE.Material) === floorKind, kind).toBe(!!hall);
      if (hall) {
        expect((kitUniformOf(ground, 'uFloor') as THREE.Vector4).x, kind).toBe(hall === 'boards' ? 0 : 1);
        expect((kitUniformOf(tops!, 'uFloor') as THREE.Vector4).x, kind).toBe(2);
        const court = kitUniformOf(ground, 'uFloorCourt') as THREE.Vector4;
        expect(court.x < court.z, kind).toBe(FLOOR_COURT[kind] !== undefined);
        if (court.x < court.z) {
          expect([court.x, court.y, court.z, court.w].map((x) => +x.toFixed(4)), kind)
            .toEqual([cx - COURT_BOUNDS.x, cz + COURT_BOUNDS.z[0], cx + COURT_BOUNDS.x, cz + COURT_BOUNDS.z[1]].map((x) => +x.toFixed(4)));
          const c = kitUniformOf(ground, 'uFloorCourtColor') as THREE.Color;
          courts[kind] = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
        }
      }
      arena.dispose();
    }
    // (the Leader's court deeper than a gym's)
    expect(courts.leader).toBeLessThan(courts.gym);
    // every line antialiased by its pixel footprint; one program for every style
    expect(hallFloorMaterial('boards', [1, 1, 1]).fragColor).toContain('fwidth');
    expect(hallFloorMaterial('boards', [1, 1, 1]).hookKey).toBe('hallFloor');
    expect(kindOf(hallFloorMaterial('boards', [1, 0, 0]))).toBe(kindOf(hallFloorMaterial('stage', [0, 1, 0], { stage: STAGE, color: [1, 1, 1] })));
  });

  it("lights the Frontier's panels softly by day for their own draw only; the Leader's walls are darker than the gym's", () => {
    const arena = new ModernArena(createKitUniforms());
    expect(arena.build('frontier', defaultArenaColors('frontier'), 'medium')).toBe(true);
    const lights = arena.group.getObjectByName('hallLights') as THREE.Mesh;
    const m = lights.material as THREE.MeshStandardMaterial;
    expect(m.emissive.getHex()).toBe(0);
    const call = (f: unknown) => (f as (...a: unknown[]) => void)(null, null, null, null, m, null);
    call(lights.onBeforeRender);
    const e = m.emissive.toArray() as number[];
    expect(Math.max(...e)).toBeGreaterThan(0.2);
    expect(Math.max(...e)).toBeLessThanOrEqual(0.6);
    call(lights.onAfterRender);
    expect(m.emissive.getHex()).toBe(0);
    arena.dispose();
    const gym = hallColors('gym', arenaPalette('gym', null)), leader = hallColors('leader', arenaPalette('leader', null));
    expect(luma(leader.shell.wainscot)).toBeLessThan(luma(gym.shell.wainscot) - 0.08);
    expect(luma(leader.shell.base)).toBeLessThan(luma(gym.shell.base));
    expect(luma(gym.shell.base)).toBeLessThan(luma(gym.shell.wainscot));
  });
});

describe('stadiums and the Sky Pillar', () => {
  it('themes every stadium kind', () => {
    expect(Object.keys(STADIUM_THEME).sort()).toEqual(['aqua', 'champion', 'drake', 'glacia', 'magma', 'phoebe', 'sidney']);
  });
  it('rings the stage with a low rim outside both platforms', () => {
    const g = arenaRimGeometry(STAGE, [0.8, 0.8, 0.8]), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) expect(Math.hypot(p.getX(i) - STAGE.centre.x, p.getZ(i) - STAGE.centre.z)).toBeGreaterThanOrEqual(6.0 - 1e-6);
    g.computeBoundingBox(); expect(g.boundingBox!.max.y).toBeLessThanOrEqual(GROUND_Y + 0.26);
  });
  it('drops the Sky Pillar\'s floor at its broken edge into a sea of clouds', () => {
    const e = brokenEdgeGeometry(1, STAGE, [0.7, 0.7, 0.75]); e.computeBoundingBox();
    expect(e.boundingBox!.min.y).toBeLessThanOrEqual(GROUND_Y - 2.5);
    const c = cloudSeaGeometry(1, STAGE); c.computeBoundingBox();
    expect(c.boundingBox!.max.y).toBeLessThan(GROUND_Y - 2);
    const x = crystalGeometry(1, 3, [0.7, 0.85, 1]); x.computeBoundingBox();
    expect(x.boundingBox!.max.y).toBeCloseTo(3, 0);
  });
});

// Beyond the brief's tests: the stadiums' parts, walls, props and colours against the frame and the rules; the Sky
// Pillar's edge, clouds and stumps against the frame.
/** The intro sweep's frames (battleCamera at ease 0 and 0.5 from a persisted yaw of 0 or ±0.9: its start stands 0.5
 *  further round, 1.5× as far, where the tall rule — the settled camera's — does not reach): whether a thing `half` wide
 *  and `height` tall at (x, z) shows in one of them nearer the camera than the nearer platform (in front of the stage). */
function inFrontOfIntro(x: number, z: number, half: number, height: number): boolean {
  const v = new THREE.Vector3();
  return [0, 0.5].some((ease) => [-0.9, 0, 0.9].some((yaw) => {
    const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(24, 16 / 9, 0.1, 400);
    cam.position.copy(battleCamera(STAGE, yaw, new THREE.Vector3(), look, ease));
    cam.lookAt(look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
    const d = Math.hypot(x - cam.position.x, z - cam.position.z);
    const near = Math.min(...[STAGE.player, STAGE.enemy].map((p) => Math.hypot(p.x - cam.position.x, p.z - cam.position.z)));
    if (d >= near) return false;
    // (its box's projection over the frame: the rectangle round its corners when all stand in front of the camera; else
    // any point of its edges, at nine heights, in front of the camera and inside the frame)
    const r = [Infinity, Infinity, -Infinity, -Infinity];
    let inFront = true, shows = false;
    for (const dx of [-half, 0, half]) for (const dz of [-half, 0, half]) for (let k = 0; k <= 8; k++) {
      v.set(x + dx, GROUND_Y + (height * k) / 8, z + dz).project(cam);
      if (v.z >= 1 || v.z <= -1) { inFront = false; continue; }
      if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1) shows = true;
      r[0] = Math.min(r[0], v.x); r[1] = Math.min(r[1], v.y); r[2] = Math.max(r[2], v.x); r[3] = Math.max(r[3], v.y);
    }
    return shows || (inFront && r[0] < 1 && r[2] > -1 && r[1] < 1 && r[3] > -1);
  }));
}

describe('stadium rooms: the part, walls, props, colours', () => {
  const ko = stageKeepOut(STAGE), top0 = frameTop(STAGE, [0]), cap = sightCap(STAGE), clear = arenaClear(STAGE);
  const cx = STAGE.centre.x, cz = STAGE.centre.z;
  const KINDS = STADIUM_KINDS;
  const water = opaqueWater(arenaWaterMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1), [0, 0, 0]));
  const MATERIAL: Record<string, [KitMaterialOptions, boolean, string[]]> = {
    stadiumRoom: [BUILDING_BODY, true, ['color', 'normal', 'position']],
    stadiumRock: [CLIFF_MATERIAL, true, ['color', 'normal', 'position']],
    candleStands: [PROP_BODY, true, ['color', 'normal', 'position']],
    candleFlames: [PROP_GLOW, false, ['color', 'normal', 'position']],
    lava: [MAGMA_LAVA, false, ['normal', 'position']],
    fountainWater: [water, false, ['normal', 'position']],
  };
  const WANT: Record<StadiumKind, string[]> = {
    magma: ['stadiumRoom', 'stadiumRock', 'lava'], aqua: ['stadiumRoom', 'fountainWater'], sidney: ['stadiumRoom', 'stadiumRock'],
    phoebe: ['stadiumRoom', 'candleStands', 'candleFlames'], glacia: ['stadiumRoom', 'stadiumRock'], drake: ['stadiumRoom', 'stadiumRock'],
    champion: ['stadiumRoom', 'fountainWater'],
  };

  it('builds the seven stadium kinds, the Sky Pillar its own; every kind has one scenery owner at most', () => {
    expect([...KINDS].sort()).toEqual(Object.keys(STADIUM_THEME).sort());
    expect(STADIUM_PART.kinds).toEqual(KINDS);
    expect(SKY_PILLAR_PART.kinds).toEqual(['rayquaza']);
    const owners = [HALL_PART, ROCK_PART, STADIUM_PART, SKY_PILLAR_PART];
    for (const p of owners) expect(ARENA_PARTS, p.name).toContain(p);
    for (const kind of ARENA_KINDS) {
      const mine = owners.filter((p) => p.kinds === 'all' || p.kinds.includes(kind));
      expect(mine.length, kind).toBeLessThanOrEqual(1);
    }
  });

  it('builds each stadium by its theme: its draws, their materials, shadows and attributes', () => {
    const u = createKitUniforms();
    for (const kind of KINDS) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const meshes = meshesUnder(arena.group.getObjectByName('stadium')!);
      expect(meshes.map((m) => m.name).sort(), kind).toEqual([...WANT[kind]].sort());
      for (const m of meshes) {
        const [options, cast, attrs] = MATERIAL[m.name];
        expect(kitMaterialKind(m.material as THREE.Material), `${kind} ${m.name}`).toBe(kindOf(options));
        expect(m.castShadow, `${kind} ${m.name}`).toBe(cast);
        expect(Object.keys(m.geometry.attributes).sort(), `${kind} ${m.name}`).toEqual(attrs);
        for (const a of Object.values(m.geometry.attributes)) expect(a.itemSize === 3 && a.array instanceof Float32Array, `${kind} ${m.name}`).toBe(true);
      }
      // (the deep water drawn first, as the arena water)
      const w = meshes.find((m) => m.name === 'fountainWater');
      if (w) expect(w.renderOrder).toBe(WATER_RENDER_ORDER);
      arena.dispose();
    }
  });

  it("closes the frame's top band with its walls; nothing over 1 unit off the tall rule, nothing standing on the camera's side", () => {
    const u = createKitUniforms();
    for (const kind of KINDS) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const meshes = meshesUnder(arena.group.getObjectByName('stadium')!);
      for (const m of meshes) {
        const p = m.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
          if (y > GROUND_Y + 0.3 && z > cz + 4) throw new Error(`${kind} ${m.name}: (${x}, ${y}, ${z}) on the camera's side`);
          if (y > 1 && !ko.tallOk(x, z)) throw new Error(`${kind} ${m.name}: (${x}, ${y}, ${z}) off the tall rule`);
        }
      }
      // the frame's top row, idle and swung, meets the room's walls (or the rock's; a tall crystal or pillar before them)
      // 9–29 units off the stage centre: never the floor beyond them
      const walls = meshes.filter((m) => m.name === 'stadiumRoom' || m.name === 'stadiumRock');
      for (const yaw of [0, -0.9, 0.9]) {
        const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(24, 1.6, 0.1, 400);
        cam.position.copy(battleCamera(STAGE, yaw, new THREE.Vector3(), look));
        cam.lookAt(look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        const ray = new THREE.Raycaster();
        for (let nx = -0.95; nx <= 0.96; nx += 0.19) {
          ray.setFromCamera(new THREE.Vector2(nx, 0.97), cam);
          const hit = ray.intersectObjects(walls)[0];
          expect(hit, `${kind} yaw ${yaw}: the top row at ${nx.toFixed(2)} meets a wall`).toBeDefined();
          const r = Math.hypot(hit!.point.x - cx, hit!.point.z - cz);
          expect(r, `${kind} yaw ${yaw}: at ${nx.toFixed(2)}`).toBeGreaterThan(9);
          expect(r, `${kind} yaw ${yaw}: at ${nx.toFixed(2)}`).toBeLessThan(29);
        }
      }
      arena.dispose();
    }
  });

  it('stands the props in the idle frame, never over a battler there, and the tall ones never before the stage in the intro', () => {
    const project = frameProjector(STAGE, 0), v = new THREE.Vector3();
    const rect = (pts: [number, number, number][]) => {
      const r = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y, z] of pts) {
        project(x, y, z, v);
        r[0] = Math.min(r[0], v.x); r[1] = Math.min(r[1], v.y); r[2] = Math.max(r[2], v.x); r[3] = Math.max(r[3], v.y);
      }
      return r;
    };
    const boxes = [STAGE.player, STAGE.enemy].map((p) => rect([-1, 1].flatMap((dx) => [-0.3, 0.3].flatMap((dz) =>
      [0, 2].map((y) => [p.x + dx, y, p.z + dz] as [number, number, number])))));
    const overlaps = (r: number[]) => boxes.some((b) => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]);
    const framed = (r: number[]) => r[2] > -1 && r[0] < 1 && r[3] > -1 && r[1] < 1;
    for (const kind of KINDS) {
      const items = stadiumItems(kind, STAGE);
      const props = STADIUM_THEME[kind].props.filter((p) => ['pillars', 'fountains', 'candles', 'crystals'].includes(p));
      // (Phoebe's and the Champion's pillars stand against their walls: the props stand free)
      if (kind === 'drake' || kind === 'aqua' || kind === 'champion' || kind === 'phoebe' || kind === 'glacia') expect(items.length, kind).toBeGreaterThan(0);
      if (!props.length) expect(items, kind).toEqual([]);
      let shown = 0;
      for (const it of items) {
        const h = Math.min(it.height, top0(it.x, it.z) - GROUND_Y);
        const r = rect([[it.x - it.half, GROUND_Y, it.z], [it.x + it.half, GROUND_Y, it.z], [it.x - it.half, GROUND_Y + h, it.z], [it.x + it.half, GROUND_Y + h, it.z]]);
        expect(overlaps(r), `${kind} ${it.kind} at (${it.x.toFixed(2)}, ${it.z.toFixed(2)})`).toBe(false);
        if (framed(r)) shown++;
        if (it.height > 1) expect(ko.tallOk(it.x, it.z), `${kind} ${it.kind} tall`).toBe(true);
        else expect(clear(it.x, it.z) && GROUND_Y + it.height <= cap(it.x, it.z) + 1e-9, `${kind} ${it.kind} small`).toBe(true);
        // (off the rim: they stand outside it)
        expect(Math.hypot(it.x - cx, it.z - cz) - it.half, `${kind} ${it.kind} off the rim`).toBeGreaterThanOrEqual(RIM.outer);
        // (a tall one never in front of the stage in the intro sweep's first frames: a small one keeps under the sight lines)
        if (it.height > 1) expect(inFrontOfIntro(it.x, it.z, it.half, it.height), `${kind} ${it.kind} at (${it.x.toFixed(2)}, ${it.z.toFixed(2)}): intro`).toBe(false);
      }
      if (items.length) expect(shown, `${kind}: props in the idle frame`).toBeGreaterThanOrEqual(2);
    }
  });

  it("shows the fountains' water over their basins' lips in the idle frame (Aqua's, the Champion's)", () => {
    // (the frame at 1280 × 800: down the basin's middle, the rows whose first hit is the basin's water — its lower disc —
    // at the best of three columns; every fountain whose basin stands in the frame. With the water 0.12 under the lip's
    // crest, Aqua's showed 11 rows; brim-full, 16–17)
    const u = createKitUniforms();
    for (const kind of ['aqua', 'champion'] as StadiumKind[]) {
      const arena = new ModernArena(u);
      expect(arena.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const meshes = meshesUnder(arena.group.getObjectByName('stadium')!), water = meshes.find((m) => m.name === 'fountainWater')!;
      const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(24, 1.6, 0.1, 400);
      cam.position.copy(battleCamera(STAGE, 0, new THREE.Vector3(), look));
      cam.lookAt(look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const ray = new THREE.Raycaster(), c = new THREE.Vector3();
      const rows: number[] = [];
      for (const it of stadiumItems(kind, STAGE).filter((i) => i.kind === 'fountain')) {
        c.set(it.x, GROUND_Y + 0.5, it.z).project(cam);
        if (c.z >= 1 || Math.abs(c.x) > 0.9 || Math.abs(c.y) > 0.9) continue;
        let best = 0;
        for (const dx of [-0.35, 0, 0.35]) {
          c.set(it.x + dx, GROUND_Y + 0.5, it.z).project(cam);
          let n = 0;
          for (let py = -40; py <= 40; py++) {
            ray.setFromCamera(new THREE.Vector2(c.x, c.y + (py * 2) / 800), cam);
            const hit = ray.intersectObjects(meshes)[0];
            if (hit && hit.object === water && hit.point.y < GROUND_Y + 0.8) n++;
          }
          best = Math.max(best, n);
        }
        rows.push(best);
      }
      expect(rows.length, `${kind}: fountains in the idle frame`).toBeGreaterThanOrEqual(1);
      for (const n of rows) expect(n, `${kind}: rows of water`).toBeGreaterThanOrEqual(14);
      arena.dispose();
    }
  });

  it("stands Drake's pillars clear of both battlers' sprites through the idle sway, the back one in the frame", () => {
    // (the idle camera sways its yaw ± BATTLE_CAMERA.sway (0.04): at yaw −0.04, 0 and +0.04, 1280 × 800, each pillar's foot
    // (its plinth's square) to the frame's top against the battlers' 64 × 64 sprites where the GBA draws them —
    // sBattlerCoords (72, 80) and (176, 40): GBA 40–104 × 48–112 and 144–208 × 8–72 — at their depths: every pillar the
    // frame shows at least 24 px from both (the inflated silhouette reaches ≈ 17 px past the box's top in the shots); the
    // back pillar (the first) at least half in the frame at every sway. At −0.42 rad its plinth stood on a back sprite's
    // crest; at −0.53 it cleared it at yaw 0 only — swayed to +0.031 its corner went behind the crest again)
    const pillars = stadiumItems('drake', STAGE).filter((i) => i.kind === 'pillar');
    expect(pillars.length).toBe(6);
    const rect = (pts: number[][]) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])),
      Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
    for (const sway of [-BATTLE_CAMERA.sway, 0, BATTLE_CAMERA.sway]) {
      const project = frameProjector(STAGE, sway), v = new THREE.Vector3(), px = (x: number, y: number, z: number) => {
        project(x, y, z, v);
        return [(v.x + 1) * 640, (1 - v.y) * 400];
      };
      const sprite = (gx: number, gy: number, depth: number) => rect([[gx, gy], [gx + 64, gy], [gx, gy + 64], [gx + 64, gy + 64]].map(([sx, sy]) => {
        const w = STAGE.at(sx, sy, depth);
        return px(w.x, w.y, w.z);
      }));
      const sprites = [sprite(40, 48, STAGE.playerDepth), sprite(144, 8, STAGE.enemyDepth)];
      pillars.forEach((it, i) => {
        const h = Math.min(it.height, top0(it.x, it.z) - GROUND_Y);
        const r = rect([-it.half, it.half].flatMap((dx) => [-it.half, it.half].flatMap((dz) => [0, h].map((y) => px(it.x + dx, GROUND_Y + y, it.z + dz)))));
        const shown = Math.max(0, Math.min(1280, r[2]) - Math.max(0, r[0])) / (r[2] - r[0]);
        if (i === 0) expect(shown, `the back pillar at sway ${sway}: in the frame`).toBeGreaterThanOrEqual(0.5);
        if (shown === 0 || r[3] < 0 || r[1] > 800) return;
        for (const s of sprites) {
          const gap = Math.max(s[0] - r[2], r[0] - s[2], s[1] - r[3], r[1] - s[3]);
          expect(gap, `pillar at (${it.x.toFixed(2)}, ${it.z.toFixed(2)}), sway ${sway}`).toBeGreaterThanOrEqual(24);
        }
      });
    }
  });

  it("stands Sidney's and Drake's spikes on the rules: tall ones on the tall rule with their tips in the frame, small ones under the sight lines", () => {
    for (const kind of ['sidney', 'drake'] as StadiumKind[]) {
      const spikes = spikePlacements(kind, STAGE, SCENERY_SEED);
      expect(spikes.filter((s) => s.height > 1).length, kind).toBeGreaterThanOrEqual(kind === 'sidney' ? 10 : 5);
      for (const s of spikes) {
        expect(Math.hypot(s.x - cx, s.z - cz), `${kind} off the rim`).toBeGreaterThan(RIM.outer + 0.3);
        if (s.height > 1) {
          expect(GROUND_Y + s.height, `${kind} tip`).toBeLessThanOrEqual(frameTop(STAGE)(s.x, s.z) - TIP_SHOWN + 1e-9);
          for (const c of clusterSpires(s.seeds, s.height)) if (c.height > 1) expect(ko.tallOk(s.x + c.dx, s.z + c.dz), `${kind} tall`).toBe(true);
        } else {
          expect(clear(s.x, s.z), `${kind} small`).toBe(true);
          expect(GROUND_Y + s.height, `${kind} small cap`).toBeLessThanOrEqual(cap(s.x, s.z) + 1e-9);
        }
      }
    }
    expect(spikePlacements('glacia', STAGE, SCENERY_SEED)).toEqual([]);
  });

  it("pools Magma's lava outside the rim, off the platforms, two of them in the idle frame", () => {
    const project = frameProjector(STAGE, 0), v = new THREE.Vector3();
    for (const seed of [SCENERY_SEED, 2, 3]) {
      const pools = stadiumLava(STAGE, seed);
      expect(pools.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      const p = lavaGeometry(seed, STAGE, pools).getAttribute('position');
      for (let i = 0; i < p.count; i++) {
        expect(clear(p.getX(i), p.getZ(i)), 'off the strip').toBe(true);
        // (its outline and bank outside the rim)
        expect(Math.hypot(p.getX(i) - cx, p.getZ(i) - cz), 'outside the rim').toBeGreaterThan(RIM.outer + 0.3);
      }
      const shows = (pool: LavaPool) => Array.from({ length: 25 }, (_, q) => {
        const a = (q / 24) * Math.PI * 2, d = q === 24 ? 0 : poolRadius(pool, a) * 0.5;
        return project(pool.x + Math.cos(a) * d, GROUND_Y, pool.z + Math.sin(a) * d, v).clone();
      }).every((n) => n.z < 1 && Math.abs(n.x) <= 0.9 && n.y <= 0.85 && n.y >= -0.35);
      // (the arena's seed: two between and beside the battlers; any seed: one at least — the rest show as the camera swings)
      expect(pools.filter(shows).length, `seed ${seed} idle`).toBeGreaterThanOrEqual(seed === SCENERY_SEED ? 2 : 1);
    }
    // (the default ring is Groudon's, unchanged)
    expect(lavaPools(STAGE, SCENERY_SEED)).toEqual(lavaPools(STAGE, SCENERY_SEED, {}));
    // (Magma's lava is Groudon's flowing lava with its glow dimmed under the bloom's threshold: its own program)
    expect(MAGMA_LAVA.fragColor).toBe(LAVA_MATERIAL.fragColor);
    expect(MAGMA_LAVA.fragEmissive).not.toBe(LAVA_MATERIAL.fragEmissive);
    expect(MAGMA_LAVA.fragEmissive).toMatch(/lavaHeat \* 0\.\d+ \* pulse/);
    expect(kindOf(MAGMA_LAVA)).not.toBe(kindOf(LAVA_MATERIAL));
  });

  it("makes Groudon's and Magma's lava with one factory, the glow its parameter (no surgery on rock.ts' shader text)", () => {
    // (Groudon's: the factory at LAVA_GLOW, the shader text it always had; Magma's: the same at LAVA_GLOW × 0.55)
    expect(lavaMaterial(LAVA_GLOW, 'lava')).toEqual(LAVA_MATERIAL);
    expect(LAVA_MATERIAL.fragEmissive).toContain(`lavaHeat * ${LAVA_GLOW} * pulse`);
    expect(MAGMA_LAVA).toEqual(lavaMaterial(0.935, 'lavaDim'));
    expect(MAGMA_LAVA.fragEmissive).toContain('lavaHeat * 0.935 * pulse');
    // (a whole glow is still a GLSL float)
    expect(lavaMaterial(2, 'x').fragEmissive).toContain('lavaHeat * 2.0 * pulse');
  });

  it("lights Phoebe's candle flames for their own draw only, on a material no other mesh draws with", () => {
    const arena = new ModernArena(createKitUniforms());
    expect(arena.build('phoebe', defaultArenaColors('phoebe'), 'medium')).toBe(true);
    const flames = arena.group.getObjectByName('candleFlames') as THREE.Mesh;
    const m = flames.material as THREE.MeshStandardMaterial;
    expect(meshesUnder(arena.group).filter((x) => x.material === m)).toEqual([flames]);
    expect(m.emissive.getHex()).toBe(0);
    const call = (f: unknown) => (f as (...a: unknown[]) => void)(null, null, null, null, m, null);
    call(flames.onBeforeRender);
    const e = m.emissive.toArray() as number[];
    // (bright, warm candlelight; under the bloom's threshold: a bloom in the frame cost ≈ 1.2 ms on the dev iGPU)
    expect(Math.max(...e)).toBeGreaterThan(0.3);
    expect(Math.max(...e)).toBeLessThanOrEqual(0.6);
    expect(e[0]).toBeGreaterThan(e[2]);
    call(flames.onAfterRender);
    expect(m.emissive.getHex()).toBe(0);
    arena.dispose();
  });

  it('floors the stadiums with the hall tiles and paints each in its GBA colours (the fog is its walls\')', () => {
    for (const kind of KINDS) expect(FLOOR_STYLE[kind], kind).toBe('tiles');
    const p = (k: StadiumKind) => arenaPalette(k, defaultArenaColors(k));
    const hue = (c: [number, number, number]) => c;
    // Magma's volcanic rock dark and warm; Aqua's metal blue; Sidney's dark; Phoebe's deep purple; Glacia's pale ice;
    // Drake's warm stone; the Champion's pale marble
    const magma = p('magma').wall, aqua = p('aqua').wall, sidney = p('sidney').wall, phoebe = hue(p('phoebe').wall);
    const glacia = p('glacia').wall, drake = p('drake').wall, champion = p('champion').wall;
    expect(luma(magma)).toBeLessThan(0.3); expect(magma[0]).toBeGreaterThan(magma[2]);
    expect(aqua[2]).toBeGreaterThan(aqua[0] + 0.15);
    expect(luma(sidney)).toBeLessThan(0.25);
    expect(luma(phoebe)).toBeLessThan(0.3); expect(phoebe[2]).toBeGreaterThan(phoebe[1]); expect(phoebe[0]).toBeGreaterThan(phoebe[1]);
    expect(luma(glacia)).toBeGreaterThan(0.6); expect(glacia[2]).toBeGreaterThanOrEqual(glacia[0]);
    expect(drake[0]).toBeGreaterThan(drake[2] + 0.08);
    expect(luma(champion)).toBeGreaterThan(0.65);
    for (const kind of KINDS) {
      const look = arenaLook(kind, p(kind), 12), w = toLinear(p(kind).wall);
      expect([look.fog.r, look.fog.g, look.fog.b].map((x, i) => x - w[i] * 0.6).every((d) => Math.abs(d) < 1e-6), kind).toBe(true);
    }
  });
});

describe('the Sky Pillar: its broken edge, the cloud sea, the stumps', () => {
  const ko = stageKeepOut(STAGE);
  const cx = STAGE.centre.x, cz = STAGE.centre.z;

  it("lays the broken edge over the floor's rim: a jagged lip from inside r 14 to beyond it, over the floor where they meet", () => {
    const g = brokenEdgeGeometry(SCENERY_SEED, STAGE, [0.8, 0.8, 0.82]), p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const r = Math.hypot(p.getX(i) - cx, p.getZ(i) - cz);
      expect(r).toBeGreaterThanOrEqual(EDGE.inner[0] - 1e-4); expect(r).toBeLessThanOrEqual(EDGE.outer[1] + 1e-4);
      expect(p.getY(i)).toBeLessThanOrEqual(GROUND_Y + EDGE.lift[1] + EDGE.heave[1] + 1e-6);
    }
    // straight down onto r 14 at 360 angles: the lip covers the floor's round rim (its cracks may let a few through)
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    const ray = new THREE.Raycaster();
    let covered = 0;
    for (let k = 0; k < 360; k++) {
      const a = (k / 360) * Math.PI * 2;
      ray.set(new THREE.Vector3(cx + Math.cos(a) * GROUND_RADIUS.rayquaza!, 5, cz + Math.sin(a) * GROUND_RADIUS.rayquaza!), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      if (hit && hit.point.y >= GROUND_Y + 0.005) covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(335);
  });

  it('shows the sea of clouds over the edge in the idle frame and swung', () => {
    const clouds = new THREE.Mesh(cloudSeaGeometry(SCENERY_SEED, STAGE), new THREE.MeshBasicMaterial());
    const edge = new THREE.Mesh(brokenEdgeGeometry(SCENERY_SEED, STAGE, [0.8, 0.8, 0.82]), new THREE.MeshBasicMaterial());
    const floorAt = (o: THREE.Vector3, d: THREE.Vector3) => {
      // (the ray meets the floor's plane inside the disc: the floor hides what lies beyond)
      const t = (GROUND_Y - o.y) / d.y;
      return t > 0 && Math.hypot(o.x + d.x * t - cx, o.z + d.z * t - cz) <= GROUND_RADIUS.rayquaza!;
    };
    for (const yaw of [0, -0.9, 0.9]) {
      const look = new THREE.Vector3(), cam = new THREE.PerspectiveCamera(24, 1.6, 0.1, 400);
      cam.position.copy(battleCamera(STAGE, yaw, new THREE.Vector3(), look));
      cam.lookAt(look); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
      const ray = new THREE.Raycaster();
      let rays = 0, hits = 0;
      for (let nx = -0.85; nx <= 0.86; nx += 0.34) {
        for (let ny = 0.98; ny > 0; ny -= 0.04) {
          ray.setFromCamera(new THREE.Vector2(nx, ny), cam);
          // (the band over the edge, up to 0.85: over it the fog has the far clouds)
          if (floorAt(ray.ray.origin, ray.ray.direction) || ray.intersectObject(edge).length) break;
          if (ny > 0.85) continue;
          rays++;
          if (ray.intersectObject(clouds).length) hits++;
        }
      }
      expect(rays, `yaw ${yaw}: a band over the edge`).toBeGreaterThan(20);
      expect(hits / rays, `yaw ${yaw}: clouds in it`).toBeGreaterThan(0.6);
    }
  });

  it('stands broken pillar stumps on the floor inside the edge, on the tall rule, off the battlers in the idle frame and the intro', () => {
    const project = frameProjector(STAGE, 0), v = new THREE.Vector3(), top0 = frameTop(STAGE, [0]);
    const rect = (pts: [number, number, number][]) => {
      const r = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y, z] of pts) {
        project(x, y, z, v);
        r[0] = Math.min(r[0], v.x); r[1] = Math.min(r[1], v.y); r[2] = Math.max(r[2], v.x); r[3] = Math.max(r[3], v.y);
      }
      return r;
    };
    const boxes = [STAGE.player, STAGE.enemy].map((p) => rect([-1, 1].flatMap((dx) => [-0.3, 0.3].flatMap((dz) =>
      [0, 2].map((y) => [p.x + dx, y, p.z + dz] as [number, number, number])))));
    const stumps = stumpPlacements(STAGE);
    expect(stumps.length).toBeGreaterThanOrEqual(5);
    let shown = 0;
    for (const s of stumps) {
      const half = s.radius * 1.5;
      expect(Math.hypot(s.x - cx, s.z - cz) + half, 'on the floor').toBeLessThanOrEqual(EDGE.inner[0]);
      if (s.height > 1) expect(ko.tallOk(s.x, s.z), 'tall').toBe(true);
      expect(inFrontOfIntro(s.x, s.z, half, s.height), `stump at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}): intro`).toBe(false);
      const h = Math.min(s.height, top0(s.x, s.z) - GROUND_Y);
      const r = rect([[s.x - half, GROUND_Y, s.z], [s.x + half, GROUND_Y, s.z], [s.x - half, GROUND_Y + h, s.z], [s.x + half, GROUND_Y + h, s.z]]);
      expect(boxes.some((b) => r[0] < b[2] && r[2] > b[0] && r[1] < b[3] && r[3] > b[1]), `stump at (${s.x.toFixed(1)}, ${s.z.toFixed(1)})`).toBe(false);
      if (r[2] > -1 && r[0] < 1 && r[3] > -1 && r[1] < 1) shown++;
    }
    expect(shown).toBeGreaterThanOrEqual(2);
  });

  it('builds the Sky Pillar: its stone (cliff, casting) and its clouds (soil, no shadow, after the floor)', () => {
    const arena = new ModernArena(createKitUniforms());
    expect(arena.build('rayquaza', defaultArenaColors('rayquaza'), 'medium')).toBe(true);
    const meshes = meshesUnder(arena.group.getObjectByName('skyPillar')!);
    expect(meshes.map((m) => m.name)).toEqual(['skyPillarStone', 'cloudSea']);
    const [stone, clouds] = meshes;
    expect(kitMaterialKind(stone.material as THREE.Material)).toBe(kindOf(CLIFF_MATERIAL));
    expect(stone.castShadow && stone.receiveShadow).toBe(true);
    expect(kitMaterialKind(clouds.material as THREE.Material)).toBe(kindOf(SOIL_MATERIAL));
    expect(clouds.castShadow).toBe(false);
    expect(clouds.renderOrder).toBeGreaterThan(GROUND_RENDER_ORDER);
    expect(clouds.renderOrder).toBeLessThan(10);
    for (const m of meshes) {
      expect(Object.keys(m.geometry.attributes).sort()).toEqual(['color', 'normal', 'position']);
      for (const a of Object.values(m.geometry.attributes)) expect(a.itemSize === 3 && a.array instanceof Float32Array).toBe(true);
    }
    arena.dispose();
  });
});
