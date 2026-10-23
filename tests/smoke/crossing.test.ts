// Real map loads against the renderer's sync rule (needs the ROM and out/r101.state, out/s22.state), in manual mode's
// fixed RTC: the emulator runs frame by frame and a model of Renderer.render syncs after each — the scene it presents
// (syncFromEmulator) and the world builds (OverworldView.sync: map key or grid changed) — once synced every frame (the
// renderer before the hitch fix), once through the SyncGate with mapLoadInProgress (the renderer now).
//   npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/crossing.test.ts

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Gba } from '../../src/gba/gba';
import { GameState } from '../../src/game/state';
import { mapLoadInProgress } from '../../src/game/mapLoad';
import { keyMask } from '../../src/input/keyNames';
import { SyncGate } from '../../src/render/syncGate';

const root = path.resolve(import.meta.dirname, '../..');
const key = (s: GameState) => `${s.mapGroup}.${s.mapNum}.${s.header?.layout}.${s.backupWidth}x${s.backupHeight}`;

/** The renderer's view of the game: the scene it presents and what its world was last built from. */
class Model {
  readonly state: GameState;
  presented: 'overworld' | 'battle' | 'screen2d' = 'screen2d';
  builtKey = '';
  builtGrid: Uint16Array | null = null;
  builds: { frame: number; key: string; grid: Uint16Array }[] = [];
  deferred: number[] = [];
  private probe: GameState;

  constructor(private gba: Gba, private gate: SyncGate | null) {
    this.state = new GameState(gba.bus);
    this.probe = new GameState(gba.bus);
  }

  /** Whether a sync with `s` (presenting the overworld) would rebuild the world. */
  private pending(s: GameState): boolean {
    if (!s.layout || (s.scene !== 'overworld' && s.scene !== 'transition' && s.scene !== 'battleTransition')) return false;
    const g = s.readBackupGrid();
    return key(s) !== this.builtKey || !this.builtGrid || g.length !== this.builtGrid.length || g.some((v, i) => v !== this.builtGrid![i]);
  }

  render(frame: number): void {
    if (this.gate?.defer(() => (this.presented === 'overworld' ? mapLoadInProgress(this.gba.cpu, this.state.mem) : null),
      () => { this.probe.update(); return this.pending(this.probe); }, this.gba.frameCount)) {
      this.deferred.push(frame);
      return;
    }
    const s = this.state;
    s.update();
    // (Renderer.syncFromEmulator)
    const scene = s.scene === 'battleTransition' ? 'overworld'
      : s.scene === 'transition' ? (this.presented === 'battle' ? 'screen2d' : this.presented) : s.scene;
    this.presented = scene;
    if (scene !== 'overworld' || !this.pending(s)) return;
    this.builtKey = key(s);
    this.builtGrid = s.readBackupGrid();
    this.builds.push({ frame, key: this.builtKey, grid: this.builtGrid });
  }
}

/** Runs `steps` ([keys, frames]) from a save state; the models synced every frame and through the gate. */
function play(state: string, steps: [string, number][]): { old: Model; now: Model; gate: SyncGate } {
  const rom = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba'))!;
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))), { now: () => new Date('2026-01-01T10:00:00') });
  gba.loadState(new Uint8Array(fs.readFileSync(path.join(root, state))));
  const gate = new SyncGate();
  const old = new Model(gba, null), now = new Model(gba, gate);
  let frame = 0;
  for (const [keys, n] of steps) {
    for (let i = 0; i < n; i++) {
      gba.keys = keyMask(keys);
      gba.runFrame();
      frame++;
      old.render(frame);
      now.render(frame);
    }
  }
  return { old, now, gate };
}

describe('map loads: one world build, from the finished map', () => {
  it('Route 101 → Littleroot (connection): the frame ending inside CameraMove is deferred, the world built once', () => {
    const { old, now, gate } = play('out/r101.state', [['', 30], ['DOWN', 300]]);
    expect(old.builtKey.startsWith('0.9.'), `ends in Littleroot (${old.builtKey})`).toBe(true);
    // before: the initial build, then two for the crossing — the first with the new map's key over the old map's grid
    expect(old.builds.map((b) => b.frame)).toEqual([1, 119, 120]);
    const [first, half, full] = old.builds;
    expect(half.key).toBe(full.key);
    expect(half.grid).toEqual(first.grid);
    expect(full.grid).not.toEqual(first.grid);
    // after: that frame deferred once, one crossing build of the finished map
    expect(now.deferred).toEqual([119]);
    expect(gate.deferred).toBe(1);
    expect(now.builds.map((b) => b.frame)).toEqual([1, 120]);
    expect(now.builds[1].key).toBe(full.key);
    expect(now.builds[1].grid).toEqual(full.grid);
  });

  it('Littleroot → a house (door warp): the faded-out loading frames are deferred, the house built once', () => {
    const { old, now } = play('out/s22.state', [['RIGHT', 40], ['UP', 120], ['', 150]]);
    // before: the house's header and tilesets over the town's grid (screen black), then the house
    expect(old.builds.map((b) => b.frame)).toEqual([1, 122, 131]);
    expect(old.builds[1].key.split('.').slice(0, 2)).toEqual(old.builds[2].key.split('.').slice(0, 2));
    expect(old.builds[1].grid).toEqual(old.builds[0].grid);
    // after: the warp's loading frames (the 'transition' scene, ≤ 3) wait; the house is built once
    expect(now.deferred).toEqual([122, 123, 124]);
    expect(now.builds.map((b) => b.frame)).toEqual([1, 131]);
    expect(now.builds[1].grid).toEqual(old.builds[2].grid);
  });
});
