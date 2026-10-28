// Phase 4 Task 2's guard: the battle rooms' geometry and the hall floor's shader text, pinned (FNV-1a hashes) before
// their code moved into the kit (kit/soup.ts, kit/glow.ts, kit/interior/wallParts.ts, kit/interior/floorGlsl.ts). The
// JSON is recorded once against the code before the move (UPDATE_PINS=1) and never regenerated in Phase 4: any change
// to a battle room's vertices or to the floor's GLSL fails here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { HALLS, HALL_PART, pillarGeometry, roomShell, type HallKind } from '../src/render/battle/parts/rooms';
import { STADIUM_PART } from '../src/render/battle/parts/stadium';
import { SKY_PILLAR_PART } from '../src/render/battle/parts/skyPillar';
import { FLOOR_COURT, FLOOR_STYLE, courtColor, hallFloorMaterial, type FloorStyle } from '../src/render/battle/parts/floor';
import { ModernArena } from '../src/render/battle/modernArena';
import { defaultArenaColors } from '../src/render/battle/bgSample';
import { arenaPalette } from '../src/render/battle/palette';
import { STAGE } from '../src/render/battle/stage';
import type { ArenaKind } from '../src/render/battle/arenaKind';
import { createKitUniforms } from '../src/render/kit/materials';

const FILE = path.join(import.meta.dirname, 'battle-pins.json');

/** FNV-1a (32 bit) over byte arrays, continued from `h`. */
function fnv(bytes: Uint8Array, h = 0x811c9dc5): number {
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const bytesOf = (a: ArrayLike<number> & { buffer: ArrayBufferLike; byteOffset: number; byteLength: number }) =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
const hex = (h: number) => h.toString(16).padStart(8, '0');

/** A geometry's hash: position, normal, color (as Float32), then the index if any; an attribute's name and size lead it. */
function geometryHash(g: THREE.BufferGeometry): string {
  let h = 0x811c9dc5;
  for (const name of ['position', 'normal', 'color']) {
    const a = g.getAttribute(name) as THREE.BufferAttribute | undefined;
    h = fnv(new TextEncoder().encode(`${name}:${a ? a.itemSize : 0}:${a ? a.count : 0}`), h);
    if (a) h = fnv(bytesOf(new Float32Array(a.array as ArrayLike<number>)), h);
  }
  const idx = g.getIndex();
  if (idx) h = fnv(bytesOf(new Uint32Array(idx.array as ArrayLike<number>)), h);
  return hex(h);
}
/** A mesh's hash: its geometry's, plus its instances' matrices and colours if instanced. */
function meshHash(m: THREE.Mesh): string {
  let h = parseInt(geometryHash(m.geometry), 16);
  const im = m as unknown as THREE.InstancedMesh;
  if (im.isInstancedMesh) {
    h = fnv(bytesOf(new Float32Array(im.instanceMatrix.array as ArrayLike<number>)), h);
    if (im.instanceColor) h = fnv(bytesOf(new Float32Array(im.instanceColor.array as ArrayLike<number>)), h);
  }
  return hex(h);
}
const textHash = (s: string) => hex(fnv(new TextEncoder().encode(s)));

function computePins(): Record<string, string> {
  const out: Record<string, string> = {};
  const palette = (k: ArenaKind) => arenaPalette(k, defaultArenaColors(k));
  // the room shells of the four halls
  for (const k of Object.keys(HALLS) as HallKind[]) out[`roomShell:${k}`] = geometryHash(roomShell(HALLS[k], STAGE, palette(k)));
  // every mesh the room parts build, kind by kind (as ModernArena builds them)
  for (const part of [HALL_PART, STADIUM_PART, SKY_PILLAR_PART]) {
    const kinds = part.kinds as readonly ArenaKind[];
    for (const kind of kinds) {
      const arena = new ModernArena(createKitUniforms());
      if (!arena.build(kind, defaultArenaColors(kind), 'medium')) throw new Error(`${part.name} ${kind}: build failed`);
      const obj = arena.group.getObjectByName(part.name);
      if (!obj) throw new Error(`${part.name} ${kind}: no object`);
      let i = 0;
      obj.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        out[`${part.name}:${kind}:${i++}:${m.name || '-'}`] = meshHash(m);
      });
    }
  }
  out['pillarGeometry'] = geometryHash(pillarGeometry(0.5, 9, [0.8, 0.8, 0.8]));
  // the hall floor's shader text: per style on STAGE, and per FLOOR_STYLE kind as the ground part makes it
  for (const style of ['boards', 'tiles', 'stage'] as FloorStyle[]) {
    const o = hallFloorMaterial(style, [0.5, 0.5, 0.5]);
    out[`floorStyle:${style}`] = textHash(`${o.fragHead}\n----\n${o.fragColor}`);
  }
  for (const [kind, style] of Object.entries(FLOOR_STYLE) as [ArenaKind, Exclude<FloorStyle, 'stage'>][]) {
    const p = palette(kind), shade = FLOOR_COURT[kind];
    const court = shade ? { stage: STAGE, color: courtColor(p, shade) } : null;
    const o = hallFloorMaterial(style, p.ground, court, STAGE);
    out[`floor:${kind}`] = textHash(`${o.fragHead}\n----\n${o.fragColor}`);
  }
  return out;
}

describe('battle pins', () => {
  it('battle room geometry and floor shaders are unchanged', () => {
    const got = computePins();
    if (process.env.UPDATE_PINS) fs.writeFileSync(FILE, JSON.stringify(got, null, 2) + '\n');
    expect(got).toEqual(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  });
});
