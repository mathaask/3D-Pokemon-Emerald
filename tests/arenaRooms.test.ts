import { describe, it, expect } from 'vitest';
import { roomShell, courtLines, pillarGeometry, HALLS } from '../src/render/battle/parts/rooms';
import { stageKeepOut } from '../src/render/battle/parts/scatter';
import { arenaPalette } from '../src/render/battle/palette';
import { STAGE, GROUND_Y } from '../src/render/battle/stage';
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
