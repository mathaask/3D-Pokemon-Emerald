import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  groundCells, groundHeight, POND, GROUND_GRID, WORN_RING, arenaGroundMaterial, wornRing, GROUND_RENDER_ORDER, TOPS_RENDER_ORDER,
  GROUND_NIGHT, groundNightScale, moonlitAsGround,
} from '../src/render/battle/parts/ground';
import type { RGB } from '../src/render/kit/palette';
import { arenaPalette } from '../src/render/battle/palette';
import { STAGE, GROUND_Y, WATER_Y, PLATFORM_FOOTPRINT } from '../src/render/battle/stage';
import { GroundMat } from '../src/render/kit/terrain';
import { ModernArena } from '../src/render/battle/modernArena';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { createKitUniforms } from '../src/render/kit/materials';
import type { ArenaKind } from '../src/render/battle/arenaKind';

const matAt = (g: ReturnType<typeof groundCells>, x: number, z: number) =>
  g.data[((Math.floor(z - g.min[1])) * g.w + Math.floor(x - g.min[0])) * 4 + 3] >> 4;
describe('arena ground', () => {
  it('paints the field, the worn ring and the platform tops', () => {
    const p = arenaPalette('grass', null), g = groundCells('grass', p, STAGE);
    expect(g.w).toBe(GROUND_GRID);
    expect(matAt(g, STAGE.centre.x + 25, STAGE.centre.z - 20)).toBe(GroundMat.Grass);
    // (fix rounds 1–2: the platform tops paint themselves over cells of their own and the worn ring is the ground
    // shader's — 'the worn ring' below —: the field's cells run on under both; platform cells here showed past the slabs'
    // plinths and behind the sand mounds)
    expect(matAt(g, STAGE.player.x, STAGE.player.z)).toBe(p.groundMat);
    expect(matAt(g, STAGE.player.x + 2.1 * 1.4, STAGE.player.z)).toBe(p.groundMat);
  });
  it('keeps the stage flat, rolls outdoor fields, lays indoor floors level', () => {
    for (const [dx, dz] of [[0, 0], [5, -3], [-6, 2]]) expect(groundHeight('grass', STAGE.centre.x + dx, STAGE.centre.z + dz, STAGE)).toBe(GROUND_Y);
    const far = [...Array(40)].map((_, i) => groundHeight('grass', STAGE.centre.x + 30 * Math.cos(i), STAGE.centre.z + 30 * Math.sin(i), STAGE));
    expect(Math.max(...far) - Math.min(...far)).toBeGreaterThan(0.3);
    expect(groundHeight('gym', STAGE.centre.x + 30, STAGE.centre.z - 20, STAGE)).toBe(GROUND_Y);
  });
  it('digs the pond under the water', () => {
    expect(groundHeight('pond', STAGE.centre.x, STAGE.centre.z + POND.dz - 6, STAGE)).toBeLessThan(WATER_Y - 0.3);
  });
});

describe('the ground\'s draw order', () => {
  it('draws the platform tops after the battlers and before the ground, whatever their material ids (Task 7b)', () => {
    // (three sorts opaque objects by renderOrder, then material id: at one renderOrder the ground — built first, the lower
    // pooled id — drew first and was shaded under both tops)
    const u = createKitUniforms();
    for (const kind of ['grass', 'sand', 'mountain', 'cave', 'gym', 'underwater'] as ArenaKind[]) {
      const a = new ModernArena(u);
      expect(a.build(kind, defaultArenaColors(kind), 'medium'), kind).toBe(true);
      const ground = a.group.getObjectByName('ground') as THREE.Mesh, tops = a.group.getObjectByName('platformTops') as THREE.Mesh;
      expect(ground.renderOrder, kind).toBe(GROUND_RENDER_ORDER);
      expect(tops.renderOrder, kind).toBe(TOPS_RENDER_ORDER);
      const id = (m: THREE.Mesh) => (m.material as THREE.Material & { id: number }).id;
      const painter = (x: THREE.Mesh, y: THREE.Mesh) => x.renderOrder - y.renderOrder || id(x) - id(y);
      expect([ground, tops].sort(painter).map((m) => m.name), kind).toEqual(['platformTops', 'ground']);
      a.dispose();
    }
    // after the battlers (renderOrder 2: their pixels skip the tops' terrain shading), before the ground
    expect(TOPS_RENDER_ORDER).toBeGreaterThan(2);
    expect(TOPS_RENDER_ORDER).toBeLessThan(GROUND_RENDER_ORDER);
  });
});

describe('groundNightScale (GROUND_COLOR\'s moonlit earth as a colour factor)', () => {
  const warmOf = (c: RGB) => THREE.MathUtils.smoothstep(c[0] - c[2], 0, 0.08) * (1 - THREE.MathUtils.smoothstep(c[1] - c[0], 0, 0.08));
  it('is 1 by day and on cool colours; at night turns warm earth towards its lifted luminance', () => {
    const earth: RGB = [0.5, 0.35, 0.2], leaf: RGB = [0.2, 0.5, 0.15], out: RGB = [0, 0, 0];
    expect(groundNightScale(earth, 0, out)).toEqual([1, 1, 1]);
    expect(groundNightScale(leaf, 1, out)).toEqual([1, 1, 1]);
    const l = (0.2126 * earth[0] + 0.7152 * earth[1] + 0.0722 * earth[2]) * GROUND_NIGHT.lift;
    for (const night of [0.4, 1]) {
      const t = night * GROUND_NIGHT.mix * warmOf(earth);
      const k = groundNightScale(earth, night, out);
      for (let i = 0; i < 3; i++) expect(k[i]).toBeCloseTo((earth[i] + (l - earth[i]) * t) / earth[i], 12);
    }
    expect(groundNightScale([0.5, 0, 0.1], 1, out)[1]).toBe(1);   // (a channel at 0 keeps 1)
  });
  it('moonlitAsGround hooks warm colours only and follows uNight through the material colour', () => {
    const night = { value: 0 };
    const mat = new THREE.MeshStandardMaterial(), mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    const plain = mesh.onBeforeRender;
    moonlitAsGround(mesh, mat, [0.2, 0.5, 0.15], night);
    expect(mesh.onBeforeRender).toBe(plain);
    const earth: RGB = [0.5, 0.35, 0.2];
    moonlitAsGround(mesh, mat, earth, night);
    const draw = () => mesh.onBeforeRender(undefined as never, undefined as never, undefined as never, undefined as never, mat, undefined as never);
    for (const v of [0, 0.7, 1]) {
      night.value = v;
      draw();
      const k = groundNightScale(earth, v, [0, 0, 0]);
      expect([mat.color.r, mat.color.g, mat.color.b].map((c, i) => c - k[i]).every((d) => Math.abs(d) < 1e-6)).toBe(true);
    }
  });
});

/** Evaluates a plain arithmetic GLSL expression of our own shader in JS (scalars, mix, smoothstep: the subset the worn
 *  ring's lines use; anything else is refused before it runs) — as tests/inflatedActors.test.ts's glslEval. */
function glslEval(expr: string, env: Record<string, number>): number {
  const names = new Set([...Object.keys(env), 'mix', 'smoothstep']);
  const ids = expr.match(/[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
  if (!/^[A-Za-z_0-9.+\-*/(), \n]+$/.test(expr) || ids.some((id) => !names.has(id))) {
    throw new Error(`not a plain arithmetic GLSL expression: ${expr}`);
  }
  const mix = (a: number, b: number, t: number) => a + (b - a) * t;
  const smoothstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  return new Function(...Object.keys(env), 'mix', 'smoothstep', `return ${expr};`)(...Object.values(env), mix, smoothstep) as number;
}

describe('the worn ring (the ground shader)', () => {
  const opts = arenaGroundMaterial(new THREE.Texture(), new THREE.Vector2(), new THREE.Vector2(1, 1), 1, 0, wornRing(arenaPalette('grass', null)));
  const head = opts.fragHead!, color = opts.fragColor!;
  // the shader's own constants: the stage's two platforms as it measures them (x, z, rx, rz)
  const platforms = [...head.matchAll(/vec4\(([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\)/g)].map((m) => m.slice(1, 5).map(Number));
  // its `re`: the elliptical distance from the nearer of them (the line checked below)
  const re = (x: number, z: number) => Math.min(...platforms.map(([px, pz, rx, rz]) => Math.hypot((x - px) / rx, (z - pz) / rz)));
  const line = (name: string) => new RegExp(`float ${name} = ([^;]*);`).exec(color)![1];
  const worn = (x: number, z: number, fray: number, wear: number, uNight = 0) =>
    glslEval(line('worn'), { re: re(x, z), outer: glslEval(line('outer'), { fray }), wear, uRing: 1, uNight });

  it('measures from the stage\'s own platforms', () => {
    expect(platforms).toHaveLength(2);
    for (const [c, f] of [[STAGE.player, PLATFORM_FOOTPRINT.player], [STAGE.enemy, PLATFORM_FOOTPRINT.enemy]] as const) {
      expect(head).toContain(`vec4(${c.x.toFixed(4)}, ${c.z.toFixed(4)}, ${f.rx.toFixed(4)}, ${f.rz.toFixed(4)})`);
    }
    expect(color).toContain('float re = min(length((rp - ARENA_PLATFORMS[0].xy) / ARENA_PLATFORMS[0].zw), length((rp - ARENA_PLATFORMS[1].xy) / ARENA_PLATFORMS[1].zw));');
  });
  it('wears a band from just outside each platform to a frayed edge, fainter at night (the shader\'s lines, evaluated)', () => {
    const P = STAGE.player, E = STAGE.enemy, fp = PLATFORM_FOOTPRINT.player, fe = PLATFORM_FOOTPRINT.enemy;
    for (const fray of [0, 0.5, 1]) for (const wear of [0, 1]) {
      // e ≈ 1.15 east of the player and in front of the enemy: worn whatever the noise
      expect(worn(P.x + 1.15 * fp.rx, P.z, fray, wear)).toBeGreaterThan(0.65);
      expect(worn(E.x, E.z + 1.15 * fe.rz, fray, wear)).toBeGreaterThan(0.65);
      // under the platform and well past the frayed edge: none
      expect(worn(P.x + 0.9 * fp.rx, P.z, fray, wear)).toBe(0);
      expect(worn(P.x + (WORN_RING.outer[1] + 0.05) * fp.rx, P.z, fray, wear)).toBe(0);
      // at night it fades 40 % into the field
      expect(worn(P.x + 1.15 * fp.rx, P.z, fray, wear, 1)).toBeCloseTo(0.6 * worn(P.x + 1.15 * fp.rx, P.z, fray, wear), 9);
    }
  });
  it('lies on the outdoor kinds\' field only, in the path\'s browner tint', () => {
    const uRing = (kind: ArenaKind) => {
      const a = new ModernArena(createKitUniforms());
      a.build(kind, defaultArenaColors(kind), 'medium');
      const m = (a.group.getObjectByName('ground') as THREE.Mesh).material as THREE.Material;
      const s = { uniforms: {}, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
      m.onBeforeCompile(s as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
      const v = (s.uniforms as Record<string, { value: number }>).uRing.value;
      a.dispose();
      return v;
    };
    expect(uRing('grass')).toBe(1); expect(uRing('sand')).toBe(1); expect(uRing('gym')).toBe(0); expect(uRing('cave')).toBe(0);
    const w = wornRing(arenaPalette('grass', null));
    expect(w.strength).toBe(1);
    expect(w.tint[0]).toBeGreaterThan(w.tint[1]); expect(w.tint[1]).toBeLessThan(1);   // green field → brown earth
  });
});
