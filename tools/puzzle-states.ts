// Phase 4b puzzle fixtures (D12): save states standing in the gyms, the League and the Trick House, made with the warp
// fixture (tools/lib/warp.ts: a door warp redirected through sWarpDestination — a TEST TOOL, the app never writes game
// memory). No save state of the project stands in any of these rooms.
//
//   npx tsx tools/puzzle-states.ts [--only a,b] [--no-save]
//
// For each recipe: from out/s22.state, warp to the recipe's cell, save out/pz_<name>.state (gitignored), then probe it
// and print: the map, the player's cell, "free" (120 idle frames: still on the overworld, the player not moved by a script;
// then the recipe's direction held 24 frames moves the player — a trainer who saw the player would have locked the
// controls) and the directions that move the player, and the recipe's walk (the harness's live walk: a 30-frame settle,
// then its steps) frame by frame: every frame whose backup grid differs from the frame before (cells map-local:
// x, y, old → new raw u16) and every map change. The walk's frames tune the harness's puzzle walks (tools/regress-live.ts).
//
// The cells were found by this probe (Phase 4b Task 1) against the ROM's grids and the decomp's object events (trainers'
// sight lines): see each recipe's comment.

import fs from 'node:fs';
import path from 'node:path';
import { Gba } from '../src/gba/gba';
import { GameState } from '../src/game/state';
import { keyMask } from '../src/input/keyNames';
import { warpInto, type WarpTarget } from './lib/warp';

/** MAP_OFFSET: backup-map cells are map cells + 7. */
const MAP_OFFSET = 7;

interface Recipe {
  name: string; to: WarpTarget;
  /** Frames after the fade-in before the save (warpInto's settle; default 60). */
  settle?: number;
  /** The direction the probe holds (and the walk starts with). */
  dir: string;
  /** The harness walk after its 30-frame settle: [keys, frames][]. */
  walk: [string, number][];
  /** A script, not the player, moves first (the E4 walk-in): not expected free. */
  scripted?: boolean;
}

const RECIPES: Recipe[] = [
  // Sootopolis Gym 1F (15.0, 17×26): on the stairs (8,20) south of the first thin-ice field (ice 0x20D at 7-9 × 17-19);
  // no trainer on 1F (Juan at 8,2, the guide at 7,24). The walk: three steps north over the ice
  { name: 'sootopolis', to: { group: 15, num: 0, x: 8, y: 20 }, dir: 'UP', walk: [['UP', 48], ['', 60]] },
  // Mauville Gym (10.0, 10×21): one cell south of switch 1 (0,15; raised 0x205), out of every trainer's sight (Girl at
  // 1,16 faces up — 1,15 and 1,14; the Man at 1,13 faces down — 1,14 and 1,15; the rest north of row 11). The walk:
  // onto the switch
  { name: 'mauville', to: { group: 10, num: 0, x: 0, y: 16 }, dir: 'UP', walk: [['UP', 16], ['', 90]] },
  // Mossdeep Gym (14.0, 26×36): one cell east of the green floor switch (15,34; 0x264), no trainer near (all west of x 13
  // or north of row 26). The walk: onto the switch (the statues on the green arrows move: no metatile changes)
  { name: 'mossdeep', to: { group: 14, num: 0, x: 16, y: 34 }, dir: 'LEFT', walk: [['LEFT', 16], ['', 90]] },
  // Sidney's room (16.0, 13×14): on the entrance (6,13), right at the fade-in (settle 0): the on-frame script
  // (VAR_ELITE_4_STATE 0) then walks the player in and closes the door behind (the walk: idle)
  { name: 'e4', to: { group: 16, num: 0, x: 6, y: 13 }, settle: 0, dir: 'UP', walk: [['', 150]], scripted: true },
  // Trick House puzzle 3 (29.5, 15×22): one cell east of button 1 (4,14; 0x258), out of sight (the Picnicker at 4,4 faces
  // right, the Camper at 7,19 down, the Hiker at 10,10 down). The walk: onto the button (the red/blue doors swap)
  { name: 'th3', to: { group: 29, num: 5, x: 5, y: 14 }, dir: 'LEFT', walk: [['LEFT', 16], ['', 90]] },
  // Lavaridge Gym 1F (4.1, 17×19): one cell east of the hole at 10,18 (0x212, a warp to B1F), by the entrance; the buried
  // trainers sit west of x 6 (sight 1). The walk: into the hole → B1F (4.2)
  { name: 'lavaridge', to: { group: 4, num: 1, x: 11, y: 18 }, dir: 'LEFT', walk: [['LEFT', 16], ['', 150]] },
];

function main(): void {
  const root = path.resolve(import.meta.dirname, '..');
  const argv = process.argv.slice(2);
  const onlyAt = argv.indexOf('--only');
  const only = onlyAt >= 0 ? argv[onlyAt + 1].split(',') : [];
  const save = !argv.includes('--no-save');
  for (const n of only) if (!RECIPES.some((r) => r.name === n)) throw new Error(`unknown recipe ${n}`);
  const rom = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba'));
  if (!rom) throw new Error('no ROM (*.gba) in the repository root');
  const start = path.join(root, 'out/s22.state');
  if (!fs.existsSync(start)) throw new Error('missing out/s22.state (Littleroot, the player free at 12,9)');
  // (the harness's manual mode reads a fixed RTC: 10:00)
  const gba = new Gba(new Uint8Array(fs.readFileSync(path.join(root, rom))), { now: () => new Date(2026, 9, 16, 10, 0, 0) });
  const state = new GameState(gba.bus);
  const s22 = new Uint8Array(fs.readFileSync(start));
  const cell = () => (state.player ? `${state.player.x - MAP_OFFSET},${state.player.y - MAP_OFFSET}` : '-');
  const run = (keys: string, n: number) => {
    gba.keys = keyMask(keys);
    for (let i = 0; i < n; i++) { gba.runFrame(); state.update(); }
  };
  let failed = 0;
  for (const r of RECIPES.filter((x) => !only.length || only.includes(x.name))) {
    gba.loadState(s22);
    state.update();
    const { frames } = warpInto(gba, state, r.to, r.settle ?? 60);
    const snap = gba.saveState();
    const file = path.join(root, `out/pz_${r.name}.state`);
    if (save) fs.writeFileSync(file, snap);
    const at = cell(), map = `${state.mapGroup}.${state.mapNum}`;
    // probe 1: 120 idle frames — still on the overworld, not moved by a script
    run('', 0);
    const scenes = new Set<string>();
    for (let i = 0; i < 120; i++) { run('', 1); scenes.add(state.scene); }
    const idleCell = cell();
    const idleOk = [...scenes].every((s) => s === 'overworld') && idleCell === at;
    const post = gba.saveState();
    // probe 2: each direction held 24 frames from there
    const moves: string[] = [];
    for (const d of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
      gba.loadState(post);
      state.update();
      run(d, 24);
      if (cell() !== idleCell) moves.push(d);
    }
    const free = idleOk && moves.includes(r.dir);
    if (!free && !r.scripted) failed++;
    console.log(`pz_${r.name}: ${map} cell ${at} (asked ${r.to.x},${r.to.y}) after ${frames} frames | idle 120: scenes ${[...scenes].join('/')}, `
      + `cell ${idleCell} | moves ${moves.join(' ') || 'none'} | ${free ? 'FREE' : r.scripted ? 'scripted (not free, as expected)' : 'NOT FREE'}`
      + (save ? ` → ${path.relative(root, file)}` : ''));
    // the walk as the harness makes it: 30 idle frames, then the steps; grid and map changes per frame
    gba.loadState(snap);
    state.update();
    // (a map change: the new map's grid lands a few frames after its id, under the load's screens — not a cell change)
    let f = 0, prev = state.readBackupGrid(), prevMap = map, prevW = state.backupWidth, loadingUntil = -1;
    const steps: [string, number][] = [['', 30], ...r.walk];
    for (const [keys, n] of steps) {
      for (let i = 0; i < n; i++) {
        run(keys, 1);
        f++;
        const m = `${state.mapGroup}.${state.mapNum}`;
        const g = state.readBackupGrid();
        if (m !== prevMap) {
          console.log(`  frame ${f}: map ${prevMap} → ${m} (scene ${state.scene}, cell ${cell()})`);
          loadingUntil = f + 15;
        } else if (g.length === prev.length && f > loadingUntil) {
          // every changed cell (map-local, old → new raw) and those made blocked or passable (collision 0 ↔ non-zero:
          // the analysis' Floor ↔ Block, a 'structure' refusal of the incremental update)
          const changed: string[] = [];
          let blocked = 0;
          for (let k = 0; k < g.length; k++) {
            if (g[k] !== prev[k]) {
              changed.push(`${(k % prevW) - MAP_OFFSET},${Math.floor(k / prevW) - MAP_OFFSET} ${prev[k].toString(16)}→${g[k].toString(16)}`);
              if (!(g[k] & 0xc00) !== !(prev[k] & 0xc00)) blocked++;
            }
          }
          if (changed.length) {
            console.log(`  frame ${f}: ${changed.length} cell(s), ${blocked} blocked ↔ passable (player ${cell()}): ${changed.join('; ')}`);
          }
        }
        prev = g; prevMap = m; prevW = state.backupWidth;
      }
    }
    console.log(`  walk end: frame ${f}, map ${prevMap}, cell ${cell()}, scene ${state.scene}`);
  }
  if (failed) {
    console.log(`${failed} recipe(s) not free`);
    process.exitCode = 1;
  }
}

main();
