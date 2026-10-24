import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { groundCells, groundHeight, POND, GROUND_GRID, WORN_RING, arenaGroundMaterial, wornRing } from '../src/render/battle/parts/ground';
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
