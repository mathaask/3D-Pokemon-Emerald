// Live visual regression: loads save states in manual mode (?manual=1: no frame loop, fixed RTC,
// fixed 1/60 s timestep), steps them frame by frame with scripted keys (emu.step) and screenshots
// each scene in both world styles. Same inputs give the same frames, so runs diff pixel for pixel.
//
//   npm run regress:live -- --label <name> [--styles modern,retro] [--only a,b] [--dpr 1]
//     [--query k=v&…] [--compare <label> [--expect-same]] [--gpu] [--selftest] [--static] [--battles] [--interiors]
//     [--review [--review-before <label>]]
//     [--ab [--ab-method frame|block] [--ab-rounds n] [--ab-settle n] [--ab-timed n] [--ab-feature actors|npcfade|battle|battlers|interior] [--ab-aa]]
//
// Output: out/regress-live/<label>/<entry>_<style>.png, _sheet_<style>.png (4 columns), _crops.png
// (per entry 320×400 centre crops, Modern | Retro: the camera centres on the player) and stats.json
// ({ [entry_style]: { calls, triangles, programs, stepMsMax | buildMs, gpuMs?, gpuP90?, cpuMs?, diff?,
// selftest?, selftestMid?, crossing?, sceneChange? } }; stepMsMax = the largest renderer.render CPU ms of the entry's frames
// after its first, cold one; static entries report the preview's cold world build ms instead (a battle preview: its ROM
// decode and setup); `crossing`: the map-crossing
// entries' walk, gated — see crossingMargin; `sceneChange`: a battle entry's or exit's walk — see SCENE_CHANGE_MS).
// Live battle entries also save the GBA's own frame after their steps (emu.gbaPng(): the PPU's composite, 2× nearest) as
// gba_<entry>.png, one per entry (the emulation is the same in both styles); static battle entries (STATIC_BATTLE) save the
// GBA's picture of their scratch hardware (preview.referencePng(): BG3 + the battler sprites) as ref_<entry>.png.
// --static adds the static preview entries (the map previews with object events from ROM templates, STATIC and the interior
// previews STATIC_INTERIOR, and the battle previews, STATIC_BATTLE); --battles the battle entries (isBattleEntry: live
// battle*, static b_*), --interiors the interior entries (isInteriorEntry: static i_*, the live ones in INTERIOR_LIVE):
// alone (either or both) they run only those, with --static every entry;
// --only names entries of either kind. --query is appended to every page URL. --compare diffs every PNG against out/regress-live/<label>/
// (a pixel differs when a channel differs by > 8; diff = { pct (2 decimals), bbox (null: identical),
// pixels (-1: sizes differ) }; a battle entry's gba_<entry>.png / ref_<entry>.png too, reported with the diffs, not in
// stats; a missing reference fails the run as a shot's does). The diffs are reported, not gated, unless --expect-same: then a
// control (isSameControl: every Retro shot, the non-interior Modern entries, OUT_OF_SCOPE_INTERIOR, door_exit, Phase 4's
// interior entries PHASE4_INTERIOR, the GBA pictures) that differs from its reference by even one pixel fails the run.
// --review writes _review_battle.png: one row per battle entry of the run, columns GBA (gba_ / ref_<entry>.png) | before
// (out/regress-live/<--review-before>/<entry>_modern.png; blank without the flag) | Modern | Retro (this run's shots);
// and _review_interior.png: one row per interior entry of the run, columns GBA map (out/atlas/<group>_<num>_<Name>.png,
// the offline render tools/map-atlas.ts writes, of the entry's map: interiorMap; blank if missing) | before | Modern | Retro.
// --gpu times 60 more frames on the GPU after the screenshot (timer
// queries, medians). stats.json is merged per label, so partial --only runs add or replace entries
// (a failed entry's shot and stats are removed); the sheets are rebuilt from every PNG in the folder.
// --selftest runs the inflation-field self-test (emu/preview.selfTest(): the presented view's GPU field — the overworld's
// or, in a battle, the battlers' — vs its CPU reference on the current atlas, the bleed fixture, the GPU ms of one
// update) on the entries marked `selftest`, in Modern (Retro computes no field), after their steps; it goes into stats
// and the field's slots into _field_<entry>.png (grey = height / max, blue tint = transparent in the atlas). An entry's
// `selftestAfter: n` adds a self-test point right after step n (`selftestMid`, _field_<entry>_mid.png; an n naming no
// step fails the entry; an entry without one leaves no older _mid dump behind).
// Gated: slots > 0, maxErr and fixtureMaxErr ≤ max(0.02, 0.003·inflateMax) px with the field's own inflateMax (the
// result's: selfTestTol — half-float rounding grows with the field's height). The same call checks the HD sprite-edge
// shader (XBR_GLSL) against its CPU reference on a fixture: xbr.maxErr ≤ 2/255 (XBR_TOL), and its baked path (XbrBake +
// xbrSampleBaked, the battlers') likewise: xbr.bakedMaxErr ≤ 2/255 — and byte for byte the live shader's inside the
// fixture's rectangle: xbr.bakedVsLive = 0 (XBR_BAKED_VS_LIVE).
// --ab (live entries, Modern) measures what the Phase 2 actors (inflated characters, object models) cost over the
// same build with them off (every sprite a card, the pre-Task-5 path; the inflation field's passes run in both): after
// the steps it snapshots the emulator (both modes emulate the same frames), then, by --ab-method:
//   frame (default): --ab-rounds ABBA quads (default 64; on off off on, then off on on off) of short halves: each half
//     switches the mode, renders --ab-settle untimed frames (default 4) and times the next --ab-timed frames (default 4,
//     back to back; their median); the snapshot is restored between quads once FRAME_AB_WINDOW (60) frames ran since the
//     last restore, the quads after successive restores starting with "on" and "off" in turn; per quad
//     (on₁ + on₂ − off₁ − off₂) / 2.
//     A quad spans well under a second, so the iGPU's clock state (it drifts by several ms within seconds on the
//     Intel/ANGLE machine) cancels. A/A runs (--ab-aa) at 64 quads, every live entry (Phase 2 final
//     wave): Δgpu idle −0.26 … +0.22, walking −0.16 … +0.11 ms, Δcpu −0.11 … +0.11 ms. (Settle 1 / timed 1, the
//     pure frame interleave, under-reads costs that build up over consecutive frames: r101 walking +0.2 … +0.5 vs +0.8 …
//     +1.2 at settle 4 before Task 12's fix.)
//   block: --ab-rounds rounds (default 8) of on/off pairs in alternating order, each block restoring the snapshot,
//     5 settle frames and gpuFrames(60); per round on − off. Steadier per block, but A/A runs at 16 rounds read
//     +0.15 … +0.80 ms (Phase 2 Task 12): it cannot resolve the +1.0 / +0.3 ms budgets.
// Two variants: idle, and walking (entries with a `walk` key held throughout; `moved` = the least px the player walked
// in any timed block / restore window, so one that did not walk shows). Reported per entry: medians of on, off and of
// the paired deltas (on − off), GPU and CPU ms, into stats (`ab`) and a table flagging the cell over +1.0 ms GPU /
// +0.5 ms CPU (the Phase 2 budgets; reported, not gated). --ab-aa runs both arms on (A/A: the method's noise floor).
// --ab-feature npcfade switches the NPC occlusion fade instead (Task 11: the player's circle only as the baseline;
// flagged over +0.3 ms GPU), on the live entries and, idle only, the static ones with a stand-in player (&focus; the
// preview's same frames, no snapshot). --ab-feature battle switches the battle's world style (Phase 3: the Modern battle
// over the Retro one, flagged over +3.0 ms GPU / +0.5 ms CPU) on the live battle entries and the static battle previews
// (run it with --only <battle entries>: elsewhere both arms draw the same frames). --ab-feature battlers switches the
// Modern battle's inflated battlers (with their field passes, the flat enemy shadow, the skipped OBJ-window masks) against
// today's cards (Phase 3 Task 5, flagged over Phase 2's actor budget +1.0 ms GPU / +0.5 ms CPU), likewise on the battle
// entries. --ab-feature interior switches Phase 4's interior kit on in-scope rooms (shell, floor, furniture, the HD legacy
// cells and the clock-following light) against today's interior (flagged over +2.0 ms GPU — the Phase 4 ruling; the plan proposed +1.5 / +0.5 ms CPU): every switch
// rebuilds the world (the half's settle frames absorb it); run it with --only <indoor live entries, in-scope i_* entries>
// (the previews of out-of-scope maps and the rooftop draw the same frames in both arms and are skipped).
// Actor luminance (every run with both styles): after each screenshot the actors (both views' on the live page:
// emu.renderer.setActorMask; the preview's) are drawn flat magenta
// once more without advancing time (_mask_<entry>_<style>.png); at the end, per entry, the Modern / Retro
// ratio of the shots' mean luma over the pixels where an actor is visible in both masks (occluders and the
// Modern occlusion dither excluded) goes into stats (`actorLum` on the Modern key) and a table. A mask that is not the
// shot's frame (more than MASK_MISMATCH_MAX of the pixels away from the actors differ: the transition's zoom moved on)
// flags the entry's luminance UNRELIABLE (`maskMismatch`, `unreliable`; left out of the summary). Gated (Phase 4 Task 13)
// on the in-scope day interior entries (dayActorGated: --interiors entries ending indoors, not OUT_OF_SCOPE_INTERIOR, not a
// night / dusk twin) with a reliable measure: each within DAY_ACTOR_BAND, their median ≥ DAY_ACTOR_MEDIAN_MIN (a failure
// fails the run; an entry without a measure is listed, not gated — but a run whose in-scope day interiors give none
// fails: never a vacuous pass).
// Night twins (every run with Modern; NIGHT_TWINS, Phase 4's D8): a night interior preview's Modern shot against its day
// twin's — night / day mean luma of the room (non-actor pixels) and of the actors (`nightLum` on the night entry's Modern
// key, and a table); gated on the in-scope pairs: room 0.45-0.8 at night, 0.7-0.95 at dusk, actors 0.9-1.15, and both measurable (no actor measure, or
// a twin without its Modern shot in this run, fails; a failure fails the run). Selecting either twin runs both.
// A step may switch something first (its third element, evaluated in the page); an entry with `sameAs` must end
// exactly as that entry (0 px against its shot in this run's folder, else it fails; --compare diffs it against that
// entry's reference) and, with `samePrograms`, with as many shader programs (a switch that compiled one fails it):
// lr_truck_switch toggles the world style and the sprite edges mid-steps, battle_switch likewise in a battle,
// vigoroth_switch in an in-scope interior (its rebuild in the other tile-animation phase) and vigoroth_v the
// classic 2D view (V) and back there.
// Puzzles (Phase 4b): a static entry's `edits` (EditSpec: the decomp's setmetatile lists or explicit cells, applied
// through preview.setCells after a 30-frame settle, each step's frames drained and timed) and a live entry's `puzzle` (a
// walk over a gym mechanic, recorded as a crossing's: every frame drained) record what each runtime cell change costs
// (`puzzle` in stats: per change its frame ms, rebuild ms, first frame ms, patch ms) and, where their PuzzleGate says
// 'gate' for the style, gate it (see PuzzleGate). The o_* entries (outdoor cell changes: Fortree's bridges, Route 113's
// ash, Pacifidlog's logs) run with --static only and only record. Fixtures: tools/puzzle-states.ts (out/pz_*.state).
// Exits non-zero when an entry fails, the page logs an error, --compare lacks a reference shot, or a
// self-test misses parity.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import puppeteer, { type Page } from 'puppeteer-core';
import { RomReader } from '../src/game/rom/reader';
import { loadMap } from '../src/game/rom/maps';
import { editRaw, metatileId, scriptEdits, type DecompEdit } from './lib/decompEdits';

/** Refusals of the incremental update by reason (Task 3's PatchRefusal names: 'structure', 'claimedNotLive', …) → count. */
type RefusalCounts = Partial<Record<string, number>>;
/**
 * A puzzle walk's or edit entry's gate (Phase 4b). 'record': report only (today's rebuild ms and first frame per change).
 * 'gate' (preflight F3): after the settle, programs constant; the grid changes exactly `changes` (a walk's pinned
 * [cells, collision] per change, recorded at p4b-base: a drifting walk — one crack of three, an unrelated change — fails;
 * none pinned: ≥ 1, the edit entries, whose every step must take exactly one); the refusals (stats().refusals, by reason:
 * Task 3) exactly as `expect` lists them for the style (none listed: none) — a change the incremental path refuses
 * rebuilds the world, so the world builds equal the refusals and patches + refusals == gridChanges; every refused change's
 * frame ≤ its build + crossingMargin(build) (a crossing's budget); every patched one within its budget (path 'live' ≤
 * PATCH_BUDGET_MS.live = 1.0 ms, 'legacy' ≤ 12 ms: stats().lastPatchMs after the change) and its frame ≤ the walk's median
 * frame + PATCH_FRAME_MARGIN_MS (+ 4 / + 16 ms). An unexpected refusal or build fails. Per style: `retro` / `modern` (a
 * style in 'record' records). `expect`: the refusals the style's run must make — a change that turns a floor cell into a
 * blocked one or back (collision zero ↔ non-zero: `collision` in the record) changes the analysis' `kind` and is
 * refused 'structure' by the legacy path (Mauville's barriers, the Trick House doors, the E4 entrance: their art really
 * changes from floor to standing face), recorded per change at p4b-base.
 */
interface PuzzleGate {
  retro: 'record' | 'gate'; modern: 'record' | 'gate'; path: 'live' | 'legacy';
  expect?: { retro?: RefusalCounts; modern?: RefusalCounts };
  /** A live walk's grid changes, each [cells, collision] (`collision`: cells made blocked or passable), as p4b-base
   *  recorded them; [] = none (Mossdeep's arrows never change, D5 ruling). */
  changes?: readonly (readonly [cells: number, collision: number])[];
}
/** Record only: the o_* outdoor entries (Retro patched, Modern refused 'outdoorKit': record-only until Task 15 rules). */
const RECORD: PuzzleGate = { retro: 'record', modern: 'record', path: 'legacy' };
/** Gated in both styles on the legacy path (Task 3: the gyms and Trick House rooms are out of scope until Task 7, legacy
 *  in both styles), with `n` 'structure' refusals expected in both (the changes with collision changes, p4b-base: F3; the
 *  C join revises Modern's) and, for a live walk, its pinned `changes`. */
const gateStructure = (n: number, changes?: PuzzleGate['changes']): PuzzleGate => ({ retro: 'gate', modern: 'gate', path: 'legacy',
  ...(n ? { expect: { retro: { structure: n }, modern: { structure: n } } } : {}), ...(changes ? { changes } : {}) });
/** gateStructure(0): visual-only changes — every one patched, 0 builds (thin ice, Petalburg's doors, the Sootopolis stairs,
 *  the Lilycove painting). */
const GATE = gateStructure(0);
const PATCH_BUDGET_MS = { live: 1.0, legacy: 12 } as const;
const PATCH_FRAME_MARGIN_MS = { live: 4, legacy: 16 } as const;

/**
 * A static entry's cell edits (one step of them): `script` = a map's setmetatile list from the decomp (scriptEdits: the
 * map's decomp name, and the script label, else every setmetatile of the map), `cells` = explicit [x, y, METATILE_* label
 * (`label+n` for an id n further: a door frame's bottom half), blocked] (the edits C code makes: thin ice, the sliding
 * doors, the outdoor tasks). Map-local cells; each becomes the grid u16 editRaw makes from the cell's value before it.
 * `after`: frames rendered after the step (default 30; the next step or the shot follows).
 */
interface EditSpec { script?: [mapName: string, label?: string]; cells?: [x: number, y: number, metatileLabel: string, blocked: boolean][]; after?: number }
/** EditSpec cells: one label on cells `xs` of row `y`. */
const cellRow = (xs: number[], y: number, label: string, blocked = false): [number, number, string, boolean][] =>
  xs.map((x) => [x, y, label, blocked]);

interface LiveEntry {
  /** `steps`: keys held for n frames each; a step's third element is evaluated in the page before its frames (a
   *  mid-steps switch). */
  name: string; state: string; steps: [string, number, string?][]; query?: string; eval?: string;
  /** --selftest: self-test after the steps; `selftestAfter`: also right after step n (mid-walk; out of range fails the
   *  entry). */
  selftest?: boolean; selftestAfter?: number;
  /** --ab walking variant: the direction held (one that walks ≥ 3 cells from the steps' end); none: idle only. */
  walk?: string;
  /** The entry must look exactly like this one (0 px against its shot of the same style in this run's folder: run it
   *  first) and --compare diffs it against that entry's reference. */
  sameAs?: string;
  /** With `sameAs`: the entry must also end with as many shader programs as that entry in this run (the same state and
   *  frames: a mid-steps switch that compiled a program shows as more). */
  samePrograms?: boolean;
  /** A map-crossing walk: its steps after the first (an idle settle of ≥ 30 frames) cross this many map connections.
   *  See CROSSING below: what it records and gates. */
  crossings?: number;
  /** A walk between scenes (battle entry or exit), run as a crossing's walk: 'record' its frames and programs, or also
   *  'gate' them. See SCENE_CHANGE_MS below. */
  sceneChange?: 'record' | 'gate';
  /** A puzzle walk (Phase 4b): its steps after the first (an idle settle of ≥ 30 frames) change cells of the map; every
   *  frame drained and recorded as a crossing's, the changes reported per frame (PuzzleStats) and gated by the gate. */
  puzzle?: PuzzleGate;
}

/**
 * Crossing entries (`crossings`) render their frames one by one with the GPU drained after each (a 1-pixel readPixels,
 * untimed): manual stepping otherwise queues GPU frames and a later frame's CPU time absorbs the backlog (100-500 ms
 * stalls with no work of its own on the dev iGPU). Recorded per walk (the steps after the settle), into stats
 * (`crossing`): every frame's renderer CPU ms (max, its frame, median, the slowest five), the world builds and the
 * shader programs after the settle and at the end (stats().builds / .programs), the last build's ms (.lastBuildMs).
 * Gated (a failure is reported and fails the run, the shot stays): no program compiles during the walk, exactly one
 * build per crossing, and no frame slower than the crossing's build plus crossingMargin(build).
 */
/** How much slower than its build the crossing's frame may be (ms). The build frame also draws the new world for the
 *  first time (its geometry and textures uploaded, the metatile and sprite atlases redrawn) and that part grows with the
 *  world, as the build does: on the dev iGPU it measured 6-24 ms over builds of 20-82 ms (hitch fix). 40 ms, or half the
 *  build when larger, stays clear of that spread and of the iGPU's jitter; a first-use compile (40-600 ms) still shows,
 *  and the programs and builds gates catch a compile or a second build on their own. */
const crossingMargin = (buildMs: number) => Math.max(40, 0.5 * buildMs);

/**
 * Scene-change entries (`sceneChange`: a battle's entry from the overworld, or its exit back to it) walk exactly as the
 * crossing entries do (the first step an idle settle of ≥ 30 frames, every frame drained) and record the same
 * CrossingStats, into stats (`sceneChange`). 'record' gates nothing (today's cost, reported); 'gate' fails the run (the
 * shot stays) when a program compiles from the entry's eval on — the settle included: an entry's eval finishes the boot
 * precompile (PRECOMPILED), and battle_enter's settle already draws the wild battle transition (frames 1-86 of its state;
 * its effect's programs are the renderer's screen precompile's), so the programs count from right after the eval (from the
 * settle's end for an entry without one) — or a frame of the walk takes longer than SCENE_CHANGE_MS (spec §10's rebuild
 * budget) — except the frame that makes the session's first world build (`firstBuildAt`): a save state that starts in a
 * battle builds the overworld for the first time on its way back, which play, having walked into the battle, does not.
 * (The frame times and that exemption still count from the settle's end: its first frame is the page's first.)
 */
const SCENE_CHANGE_MS = 150;

/** `steps` n times over (a scripted key pattern). */
const repeat = (n: number, steps: [string, number][]): [string, number][] => Array.from({ length: n }, () => steps).flat();

/** A step's switch: the world style to the other one (Modern ↔ Retro; the world rebuilds on the next sync). */
const TOGGLE_STYLE = "emu.renderer.setWorldStyle(emu.renderer.overworld.worldStyle === 'modern' ? 'retro' : 'modern')";

/** An entry's eval: the boot precompile finished (both views' parallel compiles, then Renderer.finishPrecompile: their
 *  frames and the screen programs), as play's loader does before the start gesture. */
const PRECOMPILED = 'emu.renderer.precompiled().then(() => emu.renderer.finishPrecompile())';

// Frame counts are tuned so each scene matches its comment (emu.step frames at 1/60 s; a walk
// takes 16 frames per cell). r101: standing still, the youngster stays off-screen left, so the
// player walks 3 cells towards him. transition: the battle flash peaks at 8 frames and is gone by
// 15; at 40 the spiral wipe starts over the zoomed overworld, its actors still visible.
// r101_grass's mid-walk self-test (after DOWN 18) lands on a frame whose sync changed the atlas's alpha
// (the player is still walking), as does its final one: a field one sync behind the atlas fails there.
// `walk` directions were probed (70 frames held from the steps' end); birch, lr_truck and vigoroth are
// cutscenes that hold the player (no `walk`; their NPCs move), truck_inside has 2-3 free cells.
const LIVE: LiveEntry[] = [
  { name: 'r101', state: 'out/r101.state', steps: [['LEFT', 48], ['', 30]], walk: 'LEFT' },  // Route 101: player, youngster, boy
  { name: 'r101_grass', state: 'out/r101.state', steps: [['LEFT', 108], ['DOWN', 18], ['', 30]], selftest: true, selftestAfter: 1, walk: 'UP' }, // standing in tall grass
  { name: 'r101_tree', state: 'out/r101.state', steps: [['LEFT', 66], ['DOWN', 42], ['', 30]], walk: 'LEFT' }, // against the treeline (fade)
  { name: 'r101_low', state: 'out/r101.state', query: 'camera=3', steps: [['', 30]], walk: 'LEFT' }, // Low preset: volume visible
  { name: 'r101_yaw', state: 'out/r101.state', eval: 'emu.renderer.overworld.yaw = 0.9', steps: [['', 30]], walk: 'LEFT' },
  { name: 'birch', state: 'out/s27.state', steps: [['', 30]], selftest: true },               // Birch, bag, Zigzagoon (a Pokémon)
  { name: 'lr_truck', state: 'out/lr_out.state', steps: [['', 30]], selftest: true },         // Littleroot: Mom, truck (gfx 94)
  // lr_truck with the world style switched to the other one and back (Modern → Retro → Modern in the Modern run) and the
  // sprite edges HD → Pixel → HD, mid-steps, the truck model and Mom in view: no page error, the same 30 frames end
  // exactly as lr_truck (0 px)
  { name: 'lr_truck_switch', state: 'out/lr_out.state', sameAs: 'lr_truck', steps: [['', 6], ['', 6, TOGGLE_STYLE],
    ['', 6, TOGGLE_STYLE], ['', 6, "emu.renderer.setSpriteFilter('pixel')"], ['', 6, "emu.renderer.setSpriteFilter('smooth')"]] },
  { name: 'lr_walk', state: 'out/s22.state', steps: [['', 30]], walk: 'LEFT' },              // Littleroot free walk
  { name: 'item_indoor', state: 'out/s16.state', steps: [['', 30]], walk: 'RIGHT' },         // indoor item ball (gfx 59)
  { name: 'truck_inside', state: 'out/truck.state', steps: [['', 30]], walk: 'RIGHT' },      // moving boxes (gfx 113)
  { name: 'vigoroth', state: 'out/littleroot.state', steps: [['', 30]] },                     // indoor, Vigoroths (Pokémon)
  // (Phase 4 Task 13) vigoroth with the world style switched to the other one and back mid-steps, in an in-scope room
  // (the interior kit built, dropped and rebuilt): no page error, the same 30 frames end as vigoroth with as many programs
  // (nothing compiled: the interior's programs are in the boot catalogue). The way back builds in the other tile-animation
  // phase than vigoroth's first build (frame 21; the Building tileset's TV, on in this room, swaps its tiles every 8
  // frames: the metatile atlas redraws at frames 2, 10, 18, 26): the kit samples its colours from the tilesets' static
  // tiles (ClassifyOptions.colorInfo; FW-A found the furniture re-tinted up to 17/255 by a rebuild in the other phase
  // while it read live VRAM, FW-B fixed it), so it must end exactly as vigoroth, 0 px
  { name: 'vigoroth_switch', state: 'out/littleroot.state', sameAs: 'vigoroth', samePrograms: true, steps: [['', 10],
    ['', 10, TOGGLE_STYLE], ['', 10, TOGGLE_STYLE]] },
  // vigoroth through the classic 2D view (V) and back: the 3D room comes back exactly as it was (0 px)
  { name: 'vigoroth_v', state: 'out/littleroot.state', sameAs: 'vigoroth', steps: [['', 10],
    ['', 10, "emu.renderer.mode = 'classic'"], ['', 10, "emu.renderer.mode = 'auto'"]] },
  // Battles (Phase 3; frames counted from the state's load, probed with GameState: scene, animActive, sprites). The
  // first battle (Route 101, environment 9 PLAIN): Torchic vs Zigzagoon at the move menu; its intro (s28: from frame
  // 59 Zigzagoon slides in from the left, from 69 the player's back picture from the right, under the intro's palette
  // darkening; they pass each other at 144 — the 3D view puts a battler centred left of GBA x 120 at the player's depth,
  // so before that each stands at the other side's depth — and stop at 164). battle_intro at 155: both on screen, each on
  // its own side, sliding.
  { name: 'battle', state: 'out/battle1.state', steps: [['', 30]], selftest: true },          // PLAIN: Torchic vs Zigzagoon, move menu
  // battle with the world style switched to the other one and back (Modern → Retro → Modern in the Modern run, Retro →
  // Modern → Retro in the Retro run: a Retro session's first Modern battle frames) and the sprite edges HD → Pixel → HD,
  // mid-steps: no page error, the same 30 frames end exactly as battle (0 px) with as many programs (the switch compiled
  // nothing: the Modern battlers' programs and field passes are precompiled)
  { name: 'battle_switch', state: 'out/battle1.state', sameAs: 'battle', samePrograms: true, steps: [['', 6], ['', 6, TOGGLE_STYLE],
    ['', 6, TOGGLE_STYLE], ['', 6, "emu.renderer.setSpriteFilter('pixel')"], ['', 6, "emu.renderer.setSpriteFilter('smooth')"]] },
  { name: 'battle_intro', state: 'out/s28.state', steps: [['', 155]] },                      // intro: both battlers sliding in
  { name: 'battle_grass', state: 'out/fuzz.state', steps: [['', 30]] },                      // GRASS (environment 0): wild Wurmple
  // Scratch at frame 80: the claw effect sprite (frames 67-86, semi-transparent OBJ, its 4th of 5 claw frames) on Zigzagoon,
  // whose sprite monbg hides meanwhile (it is drawn on a BG layer: the 2D overlay); animActive 61-91; Torchic does not move
  { name: 'battle_move', state: 'out/battle1.state', steps: [['', 20], ['A', 2], ['', 58]] },
  // Zigzagoon's Tackle (the A presses of battle_exit up to it; animActive 691-730): its sprite lunges 16 px towards Torchic
  // (gHorizontalLungeSpriteTemplate: x 144 → 128 over 697-700, held to 702, back by 706) while monbg moves Torchic onto a BG
  // layer (695-715: the 2D overlay draws it). At 702 the lunge is at its peak in both the 3D view (gSprites) and the GBA's
  // frame (its OAM shows a frame or two later). The hit splat comes after the lunge: in gSprites 705-714, on the GBA's
  // screen 707-715 (battle_hit)
  { name: 'battle_lunge', state: 'out/battle1.state', steps: [['', 30], ...repeat(16, [['A', 2], ['', 38]]), ['A', 2], ['', 30]] },
  // the same Tackle at 708: the hit splat (gBasicHitSplatSpriteTemplate, semi-transparent, affine 0.69) on Torchic, an
  // effect card at the player's depth; Zigzagoon back in place
  { name: 'battle_hit', state: 'out/battle1.state', steps: [['', 30], ...repeat(16, [['A', 2], ['', 38]]), ['A', 2], ['', 36]] },
  // the wild battle transition on Route 101 (frames 1-86) → screen2d 87-93 → a GRASS battle (wild Wurmple) from 94: at 360
  // the battlers have slid in (171-274), the HUD is up (275), Wurmple's entry wobble is over (341). Gated (Phase 3 Task 4):
  // no program compiles on the way and no frame takes > 150 ms. The eval finishes the boot precompile first, as play's
  // loader does (in manual mode nothing waits for it: the gate measures play, not boot)
  { name: 'battle_enter', state: 'out/wild_transition.state', eval: PRECOMPILED, steps: [['', 30], ['', 330]], sceneChange: 'gate' },
  // the first battle played to its end (Scratch until Zigzagoon faints), the battle fades out (1262-1293), transition from
  // 1299, Route 101 from 1308 (faded in at 1324; Birch walks up, 1333-1348): 63 overworld frames at the shot (the 30th A
  // press, frames 1191-1192, is the last one the battle needs; a press after 1308 would run Birch's dialogue on to the
  // warp into his lab, 1706). Gated as battle_enter (frame 1308, the session's first world build, has no frame gate).
  // Its self-test (Modern) checks the overworld's field back on Route 101: nothing of the battle's field leaks into it
  { name: 'battle_exit', state: 'out/battle1.state', eval: PRECOMPILED, steps: [['', 30], ...repeat(30, [['A', 2], ['', 38]]), ['', 140]],
    sceneChange: 'gate', selftest: true },
  { name: 'transition', state: 'out/wild_transition.state', steps: [['', 40]] },             // gated 0.00 % in Retro only
  // Map crossings (hitch fix): Route 101 → Littleroot after 30 idle frames (that crossing's frame ends inside the game's
  // map load, CameraMove: the new map's header over the old map's grid — built twice before the fix), and Route 101 →
  // Oldale Town (its water: a 558 ms first visit before the boot-time program catalogue; 38 idle frames: the RNG then
  // meets no wild Pokémon in the grass on the way). (Added in the hitch fix: their p2-base Retro and Modern references
  // were captured at 963d9db, before it, with --label p2-base --only cross_lr,cross_oldale)
  { name: 'cross_lr', state: 'out/r101.state', steps: [['', 30], ['DOWN', 300]], crossings: 1 },
  { name: 'cross_oldale', state: 'out/r101.state', steps: [['', 38], ['LEFT', 72], ['UP', 64], ['RIGHT', 176], ['UP', 64], ['LEFT', 16],
    ['UP', 32], ['LEFT', 32], ['UP', 32], ['LEFT', 64], ['UP', 120]], crossings: 1 },
  // Door walks (Phase 4; crossing-gated: no compile, one build per map load, frame ≤ build + crossingMargin; frames from
  // the state's load, probed with GameState: map, player cell, gPaletteFade). (Added in Phase 4 Task 1: their p4-base
  // references are that task's capture.)
  // door_enter: Littleroot (s22, player 12,9) two cells east, then up into May's house door (14,8, reached at 92; UP
  // released at 102): fade-out 129-151, MaysHouse_1F (1.2) loads at 152 (screen2d 155-161), fade-in 162-183, the player
  // on the mat (2,8) from 184; the shot at 222, 38 frames after the fade-in
  { name: 'door_enter', state: 'out/s22.state', steps: [['', 30], ['RIGHT', 32], ['UP', 40], ['', 120]], crossings: 1 },
  // door_exit: May's house 1F (s21, an indoor free-walk state: player 2,3) down onto the exit mat (2,8, reached at 96),
  // DOWN held on it to frame 112: fade-out 111-133, Littleroot (0.9) loads at 134 (screen2d 137-142), fade-in 142-164,
  // the player steps out of the door (14,8 → 14,9) from 166; the shot at 212, 47 frames after the fade-in
  { name: 'door_exit', state: 'out/s21.state', steps: [['', 30], ['DOWN', 82], ['', 100]], crossings: 1 },
  // Puzzle walks (Phase 4b Task 1; the fixtures are tools/puzzle-states.ts's out/pz_*.state, probed free; frames from the
  // state's load, the grid changes found by that probe, which runs these same steps). Each change comes after the 30-frame
  // settle and the shot ≥ 30 frames after the last one. (Their p4b-base references are that task's capture.)
  // pz_ice: Sootopolis Gym 1F (15.0) from the stairs (8,20) three steps north over thin ice: each ice cell cracks
  // (0x20D → 0x20E) as the player steps off it, at 45 (8,19), 61 (8,18), 77 (8,17); the shot at 138
  { name: 'pz_ice', state: 'out/pz_sootopolis.state', steps: [['', 30], ['UP', 48], ['', 60]], puzzle: gateStructure(0, [[1, 0], [1, 0], [1, 0]]) },
  // pz_switch: Mauville Gym (10.0) from 0,16 onto switch 1 (0,15): at 57 the switch is pressed and every barrier toggles
  // (27 cells in one frame: MauvilleGymPressSwitch + MauvilleGymSetDefaultBarriers); the shot at 136
  { name: 'pz_switch', state: 'out/pz_mauville.state', steps: [['', 30], ['UP', 16], ['', 90]], puzzle: gateStructure(1, [[27, 14]]) },
  // pz_arrows: Mossdeep Gym (14.0) from 16,34 onto the green floor switch (15,34): the rotating tile puzzle moves and turns
  // the statues on the green arrows — objects, not cells: no grid change (Emerald's arrows never change; the arrow edits in
  // its scripts.inc are Ruby/Sapphire leftovers that never run); the shot at 136
  { name: 'pz_arrows', state: 'out/pz_mossdeep.state', steps: [['', 30], ['LEFT', 16], ['', 90]], puzzle: gateStructure(0, []) },
  // pz_e4_door: Sidney's room (16.0) from the entrance (6,13) at the fade-in: the on-frame script walks the player in (to
  // 6,7) and at 99 closes the door behind (5-7,12 → EntryDoor_ClosedTop, 5-7,13 → ClosedBottom, blocked); the shot at 180
  { name: 'pz_e4_door', state: 'out/pz_e4.state', steps: [['', 30], ['', 150]], puzzle: gateStructure(1, [[6, 6]]) },
  // pz_th3: Trick House puzzle 3 (29.5) from 5,14 onto button 1 (4,14): at 57 the button presses and the blue doors close
  // (26 cells), at 58 the red ones open (49 cells); the shot at 136
  { name: 'pz_th3', state: 'out/pz_th3.state', steps: [['', 30], ['LEFT', 16], ['', 90]], puzzle: gateStructure(2, [[26, 12], [49, 25]]) },
  // gym_hole: Lavaridge Gym 1F (4.1) from 11,18 west into the hole at 10,18 → B1F (4.2) at 126 (crossing-gated: one build,
  // no compile); the shot at 196, 70 frames after the load
  { name: 'gym_hole', state: 'out/pz_lavaridge.state', steps: [['', 30], ['LEFT', 16], ['', 150]], crossings: 1 },
];

/**
 * The live entries --interiors runs, each with the map its review row shows (the GBA map column: the map the entry ends
 * on). The probe of every out/*.state (Phase 4 Task 1, 30 frames from the load; "free" = a held direction moves the
 * player) found indoors: littleroot / s2 / s3 / s8 (Brendan's house 1F, 1.0: cutscenes; s9 walks left / right only),
 * s4 (Brendan's 2F, 1.1: free), s5 / s7 (1.1: held), s11-s15 (May's 1F, 1.2: held), s21 (1.2: free), s16-s18 / s20
 * (May's 2F, 1.3: free; s19 held), after_battle / s31-s34 (Birch's lab, 1.4: held), truck (InsideOfTruck, 25.40: free).
 * Outdoors: lr_out, s1, s10, s22-s25, s35 (Littleroot), r101, s26, s27, wild_transition (Route 101); in a battle or 2D
 * screen: battle1, fuzz, s28, intro, intro2, pre_battle, s6, s30.
 */
const INTERIOR_LIVE: Record<string, string> = {
  vigoroth: '1.0', vigoroth_switch: '1.0', vigoroth_v: '1.0', item_indoor: '1.3', truck_inside: '25.40', door_enter: '1.2',
  door_exit: '0.9',
  // Phase 4b's puzzle walks (gym_hole ends on Lavaridge Gym B1F)
  pz_ice: '15.0', pz_switch: '10.0', pz_arrows: '14.0', pz_e4_door: '16.0', pz_th3: '29.5', gym_hole: '4.2',
};

/**
 * Static preview scenes, run with --static (or named by --only): the map preview with the map's
 * object events from their ROM templates (`/?autostart=1&manual=1&actors=1&<q>&style=…`), 60 frames
 * at 1/60 s, hour 11 unless q sets one (the preview's default). The camera looks at the first
 * template with graphics id G (focusGfx) or at template N (focusObj); one naming no template fails
 * the entry. littleroot_npcs looks at the fat man (12,13): Birch, the twin, the boy and a truck are
 * in frame too (Mom's cell is inside her house). Berry trees show stage localId % 5: Route 104's
 * framed patch holds stages 0-2 (r104_berries / r104_night); r123_berries frames Route 123's
 * two rows of six (templates 0-3, 9-16), all five stages.
 */
interface StaticEntry {
  name: string; q: string; selftest?: boolean;
  /** Runtime cell edits (Phase 4b): 30 frames, then each step's setCells and its `after` frames (drained, timed), then the
   *  shot (instead of 60 frames). A step that changes no cell fails the entry. */
  edits?: EditSpec | EditSpec[];
  /** The edits' gate (PuzzleGate; an entry with edits records without one). */
  puzzle?: PuzzleGate;
}
const STATIC: StaticEntry[] = [
  { name: 'littleroot_npcs', q: 'map=0.9&focusGfx=17', selftest: true }, { name: 'rustboro_npcs', q: 'map=0.3' },
  { name: 'r104_berries', q: 'map=0.19&focusGfx=60' }, { name: 'r104_night', q: 'map=0.19&focusGfx=60&hour=21' },
  { name: 'r123_berries', q: 'map=0.38&focusObj=3' },
  { name: 'r116_cut', q: 'map=0.31&focusGfx=82' }, { name: 'r114_rocks', q: 'map=0.29&focusGfx=86' },
  { name: 'fiery_boulders', q: 'map=24.14&focusGfx=87' }, { name: 'r119_items', q: 'map=0.34&focusGfx=59' },
  { name: 'granite_flash', q: 'map=24.7&flash=2&focusObj=0' },
  // Granite Cave B2F (Flash): a breakable rock one cell north of the lantern, where Rock Smash puts the player (model lamp ceiling)
  // (added in Phase 2 Task 8: its p2-base Retro reference was captured then, in fix round 3, with --label p2-base --only
  // granite_rocks --styles retro; Retro renders unchanged through Phase 2, 0.00 % on every older entry)
  { name: 'granite_rocks', q: 'map=24.9&flash=2&x=5.5&y=15.5' },
  { name: 'woods_shade', q: 'map=24.11&focusObj=3&hour=17.5' }, // Petalburg Woods: a Bug Catcher in tree shade (shadows on actors)
  // Route 104: Mr. Briney's boat (gfx 88), a single 32×32 sprite that the subsprite composition leaves as it is
  // (added in Phase 2 Task 10: its p2-base Retro and Modern references were captured at 1c6fe5a, before the composition,
  // with --label p2-base --only r104_boat)
  { name: 'r104_boat', q: 'map=0.19&focusGfx=88' },
  // Route 103: a stand-in player on the sand path (&focus=1 at the camera target, cell 53,12) and, 3 cells east, the
  // NPC of template 11 (gfx 25, cell 56,13) behind a tree crown: the NPC occlusion fade clears it (Task 11; no Petalburg
  // Woods NPC stands behind a crown). (Added in Phase 2 Task 11: its p2-base Retro and Modern references were captured
  // at 9cd7896, before the NPC fade, with --label p2-base --only r103_npc)
  { name: 'r103_npc', q: 'map=0.18&x=53.5&y=12.5&focus=1' },
  // Petalburg Woods, dense canopy: a stand-in player (&focus=1, cell 32,34) and, 2 cells west, the NPC of template 10
  // (gfx 13, cell 30,34), not hidden, below a wall of crowns: the NPC fade must leave those crowns whole (no holes
  // without a purpose). (Added in Phase 2 Task 11 fix round 1: its p2-base Retro and Modern references were captured
  // at 9cd7896, before the NPC fade, with --label p2-base --only woods_npc)
  { name: 'woods_npc', q: 'map=24.11&x=32.5&y=34.5&focus=1' },
  // woods_npc with the camera turned half way round (&yaw=π, from the north): the crown wall now stands between the
  // camera and the NPC, which the NPC fade clears ("in front" follows the camera's yaw). (Added in Phase 2 Task 11 fix
  // round 2: its p2-base Retro and Modern references were captured at 9cd7896, before the NPC fade, with --label p2-base
  // --only woods_npc_yaw)
  { name: 'woods_npc_yaw', q: 'map=24.11&x=32.5&y=34.5&focus=1&yaw=3.1416' },
  // Outdoor runtime cell changes (Phase 4b Task 1: measured, never gated — making outdoor families live is not in 4b; run
  // with --static only). Fortree City (0.4): four bridge planks over the trees lowered as the player walks them
  // (field_tasks.c: BridgeOverTrees_Raised 0x256 → _Lowered); Route 113 (0.28): four ash grass cells shaken bare
  // (AshGrass 0x20A → NormalGrass); Pacifidlog (0.15): a horizontal log pair's sunk frame (FloatingLogs → SubmergedLogs)
  { name: 'o_fortree_bridge', q: 'map=0.4&x=16.5&y=14.5', puzzle: RECORD,
    edits: { cells: cellRow([15, 16, 17, 18], 14, 'METATILE_Fortree_BridgeOverTrees_Lowered') } },
  { name: 'o_ash', q: 'map=0.28&x=45.5&y=3.5', puzzle: RECORD,
    edits: { cells: cellRow([44, 45, 46, 47], 3, 'METATILE_Fallarbor_NormalGrass') } },
  { name: 'o_pacifidlog', q: 'map=0.15&x=5&y=17.5', puzzle: RECORD,
    edits: { cells: [[4, 17, 'METATILE_Pacifidlog_SubmergedLogs_HorizontalLeft', false], [5, 17, 'METATILE_Pacifidlog_SubmergedLogs_HorizontalRight', false]] } },
];

/**
 * Static interior previews (Phase 4), run with --static or --interiors (or named by --only): as STATIC (60 frames, hour
 * 11 unless q sets one; the harness adds actors=1 to every map preview, so q's own is documentation). Every in-scope
 * kind (house, Pokémon Center, Mart, lab, flat, department store, league, institute, trick house, gate), orbit angles,
 * the Low preset, night (D8: Modern in-scope interiors follow the clock — each night entry has a day twin with the same
 * camera: i_pc_night ↔ i_pc_1f, i_house_night ↔ i_house_1f, i_lab_night ↔ i_lab, i_mart_night ↔ i_mart, i_gym_night ↔
 * i_gym; dusk, Task 12: i_pc_dusk ↔ i_pc_1f, i_house_dusk ↔ i_house_1f), a stand-in player at the nurse's counter, the
 * furniture family's failure hook and out-of-scope controls (i_gym, i_gym_night, i_secret, and i_dept_roof since Task 12
 * ruled the rooftop out of scope: Modern 0.00 % for ever).
 * (Added in Phase 4 Task 1: their p4-base references are that task's capture; the dusk entries' are copies of their day
 * twins' — at p4-base the hour changed no room: every i_*_night shot equals its day twin's, 0 px, both styles.)
 */
const STATIC_INTERIOR: StaticEntry[] = [
  { name: 'i_house_1f', q: 'map=1.0&actors=1' },            // Brendan's house 1F: kitchen, table + chairs on a rug, stairs
  { name: 'i_house_2f', q: 'map=1.1&actors=1' },            // Brendan's room: bed, PC, stairs down
  { name: 'i_may_1f', q: 'map=1.2&actors=1' },
  { name: 'i_lab', q: 'map=1.4&actors=1' },                 // Birch's lab: bookcases, desks, plants, machine
  { name: 'i_oldale_house', q: 'map=2.0&actors=1' },        // GenericBuilding house
  { name: 'i_pc_1f', q: 'map=2.2&actors=1' },               // Pokémon Center 1F: nurse, counter, healing machine, PC
  { name: 'i_pc_2f', q: 'map=2.3&actors=1' },
  { name: 'i_mart', q: 'map=2.4&actors=1' },                // Mart: shelves, counter, clerk
  { name: 'i_flat', q: 'map=11.13&actors=1' },              // Rustboro Flat2 1F
  { name: 'i_fortree_house', q: 'map=12.0&actors=1' },      // 8×6
  { name: 'i_sootopolis_house', q: 'map=15.5&actors=1' },   // 8×7
  { name: 'i_dept_1f', q: 'map=13.16&actors=1' },
  { name: 'i_dept_roof', q: 'map=13.21&actors=1' },        // out of scope (Task 12: OUT_OF_SCOPE_MAPS): a control
  { name: 'i_league', q: 'map=16.10&actors=1' }, { name: 'i_weather', q: 'map=32.0&actors=1' },
  { name: 'i_trickhouse', q: 'map=29.2' },                  // corridor maze 15×24
  { name: 'i_gate', q: 'map=29.11&actors=1' },              // cycling road gate (Shop)
  { name: 'i_pc_yaw', q: 'map=2.2&actors=1&yaw=1.5708' },   // camera from the east (cutaway)
  { name: 'i_house_back', q: 'map=1.0&yaw=3.1416' },        // camera from the north: back wall cut, front wall shown
  { name: 'i_house_low', q: 'map=1.0&preset=3' },           // Low preset
  { name: 'i_pc_night', q: 'map=2.2&actors=1&hour=21' },    // windows / shafts at night
  { name: 'i_house_night', q: 'map=1.0&actors=1&hour=21' }, // D8: the house's lamp-lit night
  { name: 'i_lab_night', q: 'map=1.4&actors=1&hour=21' },
  { name: 'i_mart_night', q: 'map=2.4&actors=1&hour=21' },
  // dusk (Task 12): nightFactor(19) ≈ 0.47, mid-blend — the inflated actors' light floor rises with the night, the room
  // dims first: their likeliest dip
  { name: 'i_pc_dusk', q: 'map=2.2&actors=1&hour=19' },
  { name: 'i_house_dusk', q: 'map=1.0&actors=1&hour=19' },
  // a stand-in player (&focus=1) at the counter: the nurse's template (local id 1, gfx 58) stands at 7,2, the counter
  // between, the stand-in two rows south at 7,4 (cell centre)
  { name: 'i_pc_nurse', q: 'map=2.2&actors=1&x=7.5&y=4.5&focus=1' },
  // the furniture family made to fail (&kitFail): its cells legacy, the shell and the floor modelled, one warning
  { name: 'i_house_fail', q: 'map=1.0&kitFail=furniture' },
  { name: 'i_gym', q: 'map=8.1' },                           // out of scope: Modern 0.00 % for ever
  { name: 'i_gym_night', q: 'map=8.1&hour=21' },             // out of scope: today's fixed indoor light at night too
  { name: 'i_secret', q: 'map=25.0' },                       // out of scope (SECRET_BASE): SecretBase_RedCave1
  // Phase 4b (Task 1; their p4b-base references are that task's capture, before any 4b code: today's legacy rooms). The
  // gyms (the camera on the map centre unless set), with orbit views of the tiered gyms (real raised platforms: the tiers
  // must read from the side too) and the puzzle family's failure hook
  { name: 'i_g_petalburg_entry', q: 'map=8.1&actors=1&x=4.5&y=105' }, // Petalburg: the entrance room (Wally, the guide)
  { name: 'i_g_rustboro', q: 'map=11.3&actors=1' },
  { name: 'i_g_rustboro_yaw', q: 'map=11.3&actors=1&yaw=-0.9' },     // tiers from the south-west
  { name: 'i_g_dewford', q: 'map=3.3&actors=1' },
  { name: 'i_g_dewford_dark', q: 'map=3.3&actors=1&flash=4' },       // the gym's darkness (flashLevel 4: D10)
  { name: 'i_g_mauville', q: 'map=10.0&actors=1' },                  // barriers, switches
  { name: 'i_g_lavaridge', q: 'map=4.1&actors=1' },                  // geyser holes, ledges
  { name: 'i_g_lavaridge_yaw', q: 'map=4.1&actors=1&yaw=0.9' },
  { name: 'i_g_lavaridge_b1f', q: 'map=4.2&actors=1' },
  { name: 'i_g_fortree', q: 'map=12.1&actors=1' },                   // rotating gates, ledges
  { name: 'i_g_fortree_yaw', q: 'map=12.1&actors=1&yaw=-0.9' },
  { name: 'i_g_mossdeep', q: 'map=14.0&actors=1' },                  // arrow tiles, warp pads, statues
  { name: 'i_g_mossdeep_yaw', q: 'map=14.0&actors=1&yaw=1.5708' },
  { name: 'i_g_sootopolis', q: 'map=15.0&actors=1' },                // thin ice tiers, hidden stairs
  { name: 'i_g_sootopolis_yaw', q: 'map=15.0&actors=1&yaw=0.9' },    // the ice tiers from the south-east
  { name: 'i_g_sootopolis_low', q: 'map=15.0&actors=1&preset=3' },   // the tiers at the Low preset
  { name: 'i_g_sootopolis_b1f', q: 'map=15.1&actors=1' },
  { name: 'i_g_mauville_fail', q: 'map=10.0&actors=1&kitFail=puzzle' }, // the puzzle family made to fail (today: no such family)
  // the League: the Elite Four's rooms, the halls between them, the Hall of Fame
  { name: 'i_e4_sidney', q: 'map=16.0&actors=1' }, { name: 'i_e4_phoebe', q: 'map=16.1&actors=1' },
  { name: 'i_e4_glacia', q: 'map=16.2&actors=1' }, { name: 'i_e4_drake', q: 'map=16.3&actors=1' },
  { name: 'i_e4_champion', q: 'map=16.4&actors=1' }, { name: 'i_e4_hall', q: 'map=16.5&actors=1' },
  { name: 'i_e4_hall5', q: 'map=16.9&actors=1' },
  { name: 'i_e4_back', q: 'map=16.0&actors=1&yaw=3.1416' },          // Sidney's room from the north
  { name: 'i_hof', q: 'map=16.11&actors=1' },
  { name: 'i_hof_yaw', q: 'map=16.11&actors=1&yaw=0.9' },            // the dais's tiers from the side
  // the town special rooms
  { name: 'i_s_fanclub', q: 'map=9.6&actors=1' }, { name: 'i_s_ocean_1f', q: 'map=9.7&actors=1' },
  { name: 'i_s_ocean_2f', q: 'map=9.8&actors=1' }, { name: 'i_s_bikeshop', q: 'map=10.1&actors=1' },
  { name: 'i_s_corner', q: 'map=10.3&actors=1' }, { name: 'i_s_devon_1f', q: 'map=11.0&actors=1' },
  { name: 'i_s_devon_3f', q: 'map=11.2&actors=1' }, { name: 'i_s_school', q: 'map=11.4&actors=1' },
  { name: 'i_s_lily_1f', q: 'map=13.2&actors=1' }, { name: 'i_s_lily_2f', q: 'map=13.3&actors=1' },
  { name: 'i_s_corner_mossdeep', q: 'map=14.11&actors=1' }, { name: 'i_s_mystery', q: 'map=15.13&actors=1' },
  { name: 'i_s_mystery_b1f', q: 'map=15.14&actors=1' }, { name: 'i_s_flowers', q: 'map=17.1&actors=1' },
  { name: 'i_s_daycare', q: 'map=22.0&actors=1' }, { name: 'i_s_seashore', q: 'map=28.0&actors=1' },
  // the Trick House's eight puzzle rooms (29.3-29.10)
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ name: `i_th${n}`, q: `map=29.${n + 2}&actors=1` })),
  // night / dusk twins of the new rooms (NIGHT_TWINS; Dewford's dark night: room band exempt, D10)
  { name: 'i_g_mauville_night', q: 'map=10.0&actors=1&hour=21' }, { name: 'i_e4_drake_night', q: 'map=16.3&actors=1&hour=21' },
  { name: 'i_s_ocean_night', q: 'map=9.7&actors=1&hour=21' }, { name: 'i_th3_night', q: 'map=29.5&actors=1&hour=21' },
  { name: 'i_g_sootopolis_dusk', q: 'map=15.0&actors=1&hour=19' }, { name: 'i_e4_champion_dusk', q: 'map=16.4&actors=1&hour=19' },
  { name: 'i_g_dewford_night_dark', q: 'map=3.3&actors=1&flash=4&hour=21' },
  // controls for Phase 4c (out of scope in 4b: Modern 0.00 % against p4b-base): the Battle Tower lobby, the contest lobby,
  // Mt Pyre 1F (never in 4b or 4c: a dungeon), the Trade Center (never: link only)
  { name: 'i_frontier', q: 'map=26.5&actors=1' }, { name: 'i_contest', q: 'map=13.4&actors=1' },
  { name: 'i_mtpyre', q: 'map=24.15&actors=1' }, { name: 'i_link', q: 'map=25.25&actors=1' },
  // Puzzle edit entries (Phase 4b Task 1: the decomp's edits through preview.setCells, recorded). i_pz_th3: Trick House 3's
  // button 1 pressed and the doors swapped (blue closed, red open: 75 cells, as pz_th3's two frames)
  { name: 'i_pz_th3', q: 'map=29.5&actors=1', puzzle: gateStructure(1), edits: {
    script: ['Route110_TrickHousePuzzle3', 'Route110_TrickHousePuzzle3_EventScript_SetDoorsState1'],
    cells: [[4, 14, 'METATILE_TrickHousePuzzle_Button_Pressed', false]] } },
  // i_pz_petalburg: room 5's two doors (1,52 and 7,52; two rows each, blocked) through the slide frames 1-4 two frames
  // apart (field_specials.c PetalburgGymSetDoorMetatiles; frame 0, 0x218, is the closed door the map holds), the last
  // frame shot
  { name: 'i_pz_petalburg', q: 'map=8.1&actors=1&x=4.5&y=54', puzzle: GATE, edits: [1, 2, 3, 4].map((f) => ({
    cells: [1, 7].flatMap((x): [number, number, string, boolean][] => [[x, 52, `METATILE_PetalburgGym_SlidingDoor_Frame${f}`, true],
      [x, 53, `METATILE_PetalburgGym_SlidingDoor_Frame${f}+8`, true]]),
    after: f < 4 ? 2 : 30 })) },
  // i_pz_sootopolis: the first ice field cracked under three steps (7,19 8,19 8,18 → Ice_Cracked) and one cell broken
  // (9,18 → Ice_Broken), then the first hidden stairs (8,15-16: OpenFirstStairs)
  { name: 'i_pz_sootopolis', q: 'map=15.0&actors=1&x=8.5&y=17.5', puzzle: GATE, edits: [
    { cells: [[7, 19, 'METATILE_SootopolisGym_Ice_Cracked', false], [8, 19, 'METATILE_SootopolisGym_Ice_Cracked', false],
      [8, 18, 'METATILE_SootopolisGym_Ice_Cracked', false], [9, 18, 'METATILE_SootopolisGym_Ice_Broken', false]] },
    { script: ['SootopolisCity_Gym_1F', 'SootopolisCity_Gym_1F_EventScript_OpenFirstStairs'] }] },
  // i_pz_mauville: the barriers' alternate state (SetAltBarriers) with switch 1 (0,15) pressed — as pz_switch's 27 cells
  { name: 'i_pz_mauville', q: 'map=10.0&actors=1', puzzle: gateStructure(1), edits: {
    script: ['MauvilleCity_Gym', 'MauvilleCity_Gym_EventScript_SetAltBarriers'],
    cells: [[0, 15, 'METATILE_MauvilleGym_PressedSwitch', false]] } },
  // i_pz_e4: Sidney's entrance closed behind the player (the cells pz_e4_door's probe saw: the shared door script is not in
  // the decomp copy, data/scripts/ is missing)
  { name: 'i_pz_e4', q: 'map=16.0&actors=1', puzzle: gateStructure(1), edits: {
    cells: [5, 6, 7].flatMap((x): [number, number, string, boolean][] => [[x, 12, 'METATILE_EliteFour_EntryDoor_ClosedTop', true],
      [x, 13, 'METATILE_EliteFour_EntryDoor_ClosedBottom', true]]) } },
  // i_pz_lily: Lilycove Museum 2F's cool painting hung (10-11,6; the legacy / decor path)
  { name: 'i_pz_lily', q: 'map=13.3&actors=1', puzzle: GATE, edits: {
    script: ['LilycoveCity_LilycoveMuseum_2F', 'LilycoveCity_LilycoveMuseum_2F_EventScript_SetCoolPainting'] } },
];

/** The interior entries Phases 4 and 4b leave alone in both styles (out of scope: Modern 0.00 % against p4-base / p4b-base
 *  for ever): the secret base, the rooftop, the truck, and Phase 4c's controls (the Frontier, the contest lobby; Mt Pyre and
 *  the link rooms never). (Phase 4b: Petalburg's gym, i_gym and i_gym_night, came into scope.) */
const OUT_OF_SCOPE_INTERIOR = new Set(['i_secret', 'i_dept_roof', 'truck_inside', 'i_frontier', 'i_contest', 'i_mtpyre', 'i_link']);

/** Phase 4's interior entries (their rooms are done: Modern 0.00 % against p4b-base, --expect-same's controls): its i_*
 *  previews but the Petalburg gym's (i_gym, i_gym_night: Phase 4b's), and its live indoor entries. */
const PHASE4_INTERIOR = new Set(['i_house_1f', 'i_house_2f', 'i_may_1f', 'i_lab', 'i_oldale_house', 'i_pc_1f', 'i_pc_2f', 'i_mart',
  'i_flat', 'i_fortree_house', 'i_sootopolis_house', 'i_dept_1f', 'i_dept_roof', 'i_league', 'i_weather', 'i_trickhouse', 'i_gate',
  'i_pc_yaw', 'i_house_back', 'i_house_low', 'i_pc_night', 'i_house_night', 'i_lab_night', 'i_mart_night', 'i_pc_dusk',
  'i_house_dusk', 'i_pc_nurse', 'i_house_fail', 'i_secret', 'vigoroth', 'vigoroth_switch', 'vigoroth_v', 'item_indoor',
  'truck_inside', 'door_enter', 'door_exit']);

/** The 45 maps Phase 4b models (plan D1): an interior entry on one of them (interiorMap) is a Phase 4b entry. */
const PHASE4B_MAPS = new Set(['3.3', '4.1', '4.2', '8.1', '10.0', '11.3', '12.1', '14.0', '15.0', '15.1',
  '16.0', '16.1', '16.2', '16.3', '16.4', '16.5', '16.6', '16.7', '16.8', '16.9', '16.11',
  '9.6', '9.7', '9.8', '10.1', '10.3', '11.0', '11.2', '11.4', '13.2', '13.3', '14.11', '15.13', '15.14', '17.1', '22.0', '28.0',
  '29.3', '29.4', '29.5', '29.6', '29.7', '29.8', '29.9', '29.10']);
/** Whether the look gates (D8's night twins, the day actor luminance) judge the Phase 4b entries. Off until Task 7 switches
 *  the 4b scope on: until then those rooms render as today (the legacy room under today's fixed indoor light: roomLuma ≈
 *  1.0) and are measured, not gated; Task 7 sets it true. */
const PHASE4B_LOOK_GATES = false;
/** A Phase 4b entry whose look gates wait for PHASE4B_LOOK_GATES. */
const lookPending = (e: Entry): boolean => !PHASE4B_LOOK_GATES && PHASE4B_MAPS.has(interiorMap(e) ?? '');
/** The same for an entry named `name` (the night gate's twins). */
const lookPendingName = (name: string): boolean => {
  const e = ALL_ENTRIES.find((x) => x.name === name);
  return !!e && lookPending(e);
};

/**
 * D8's night twins: night entry → its day entry (the same map and camera at hour 11). After a run with Modern, each pair
 * with both Modern shots and masks in the folder gets `nightLum` (on the night entry's Modern key, and a table): roomLuma
 * = night / day mean sRGB luma (Rec. 709) of the pixels no actor covers in either mask (with a 1-px margin), actorLum =
 * night / day mean luma of the actor pixels visible in both masks (as actorLum; null under ACTOR_LUM_MIN_PX). Gated on the
 * in-scope pairs (not OUT_OF_SCOPE_INTERIOR): roomLuma within roomBand (NIGHT_ROOM_BAND / DUSK_ROOM_BAND — D8: the room
 * follows the clock and stays readable at night), actorLum within NIGHT_ACTOR_BAND (the actors lit as by day); an unmeasured actorLum, or a twin without its Modern shot in this run,
 * fails (never a vacuous pass). With Modern, selecting either twin runs both (main's selection). Today's fixed indoor light reads ≈ 1.0 (p4-base). Every live entry
 * is day: each save state's in-game clock reads 10:00 under manual mode's fixed RTC (nightFactor 0; probed in Phase 4
 * Task 1).
 */
const NIGHT_TWINS: Record<string, string> = {
  i_pc_night: 'i_pc_1f', i_house_night: 'i_house_1f', i_lab_night: 'i_lab', i_mart_night: 'i_mart', i_gym_night: 'i_gym',
  i_pc_dusk: 'i_pc_1f', i_house_dusk: 'i_house_1f',   // dusk, hour 19 (Task 12): the same gate
  // Phase 4b's rooms (night hour 21, dusk 19); i_g_dewford_night_dark: the dark gym at night, its room band exempt
  // (NIGHT_ROOM_EXEMPT: its light is the flash rule, D10), its actors gated
  i_g_mauville_night: 'i_g_mauville', i_e4_drake_night: 'i_e4_drake', i_s_ocean_night: 'i_s_ocean_1f', i_th3_night: 'i_th3',
  i_g_sootopolis_dusk: 'i_g_sootopolis', i_e4_champion_dusk: 'i_e4_champion', i_g_dewford_night_dark: 'i_g_dewford_dark',
};
/** Night twins whose room luma is reported, not gated: Dewford's darkness keeps its own light (D10). */
const NIGHT_ROOM_EXEMPT = new Set(['i_g_dewford_night_dark']);
/** Whether a night twin's pair is gated: in scope, and not a Phase 4b pair whose look gates wait (lookPending). */
const nightGated = (night: string): boolean => !OUT_OF_SCOPE_INTERIOR.has(night) && !lookPendingName(night);
/** The room's night / day luma an in-scope pair must read, two-sided (a room that stopped following the clock reads
 *  1.000 and fails, as one gone too dark does): night (hour 21, nightFactor 1) 0.45-0.8, dusk (the `_dusk` twins, hour
 *  19, nightFactor ≈ 0.47) 0.7-0.95. Measured at 7f5e0b9: night 0.607-0.629, dusk 0.829-0.841 — each bound keeps ≥ 0.1
 *  of margin for look tuning (floors, lamps), while D8 switched off (1.000), a night room left at its dusk light, or a
 *  dusk room already at night's, fail. */
const NIGHT_ROOM_BAND: [number, number] = [0.45, 0.8];
const DUSK_ROOM_BAND: [number, number] = [0.7, 0.95];
const roomBand = (night: string): [number, number] => (night.endsWith('_dusk') ? DUSK_ROOM_BAND : NIGHT_ROOM_BAND);
const NIGHT_ACTOR_BAND: [number, number] = [0.9, 1.15];

/**
 * Static battle scenes, run with --static or --battles (or named by --only): the battle preview (src/render/battlePreview.ts,
 * `/?battle=<kind>&manual=1&<q>&style=…`) lays the arena kind's BG3 picture and the battlers' ROM pictures into scratch
 * hardware as the game does and drives the live battle view: one entry per arena kind (no save state reaches most of
 * them), plus night, a double battle and a floating enemy (Zubat: the shadow sprite). 150 frames at 1/60 s (the battle
 * camera's 2.2 s intro sweep has ended), hour 11 unless q sets one; ref_<entry>.png is the GBA's own picture of it.
 */
const BATTLE_FRAMES = 150;
const STATIC_BATTLE: StaticEntry[] = [   // species: internal ids (include/constants/species.h)
  { name: 'b_grass', q: 'battle=grass&player=280&enemy=288', selftest: true }, // Torchic vs Zigzagoon
  // b_grass with the Modern arena's ground part made to throw: the battle falls back to today's arena (warned once). Until
  // Task 6 it equals b_grass in both styles (checked when its p3-base reference was captured, Task 4); from then on Modern
  // b_grass draws the Modern arena and this one today's, so it has its own reference, not a sameAs
  { name: 'b_grass_fail', q: 'battle=grass&player=280&enemy=288&arenaFail=ground' },
  { name: 'b_grass_night', q: 'battle=grass&player=280&enemy=288&hour=21' },
  { name: 'b_double', q: 'battle=grass&double=1&player=280&player2=277&enemy=288&enemy2=286' },
  { name: 'b_longgrass', q: 'battle=longGrass&player=277&enemy=286' },  // Treecko vs Poochyena
  { name: 'b_plain', q: 'battle=plain&player=280&enemy=288' },
  { name: 'b_sand', q: 'battle=sand&player=283&enemy=332' },            // Mudkip vs Trapinch
  // (Task 7 fix round: the desert at night — dunes, hills, tufts and rocks moonlit as the sand field; its p3-base reference
  // was captured from the base code, Task 4's 1e30bd6, which renders p3-base exactly)
  { name: 'b_sand_night', q: 'battle=sand&player=283&enemy=332&hour=21' },
  { name: 'b_water', q: 'battle=water&player=283&enemy=72' },           // vs Tentacool
  { name: 'b_water_night', q: 'battle=water&player=283&enemy=309&hour=21' }, // vs Wingull
  { name: 'b_pond', q: 'battle=pond&player=277&enemy=311' },            // vs Surskit
  { name: 'b_underwater', q: 'battle=underwater&player=283&enemy=330' }, // vs Carvanha
  { name: 'b_mountain', q: 'battle=mountain&player=280&enemy=74' },     // vs Geodude
  { name: 'b_cave', q: 'battle=cave&player=280&enemy=41' },             // vs Zubat (floating: shadow sprite)
  { name: 'b_cavepond', q: 'battle=cavePond&player=283&enemy=129' },    // vs Magikarp
  { name: 'b_building', q: 'battle=building&player=277&enemy=337' },    // vs Electrike
  { name: 'b_gym', q: 'battle=gym&player=281&enemy=74' },
  { name: 'b_leader', q: 'battle=leader&player=281&enemy=320' },        // vs Nosepass
  { name: 'b_frontier', q: 'battle=frontier&player=400&enemy=397' },    // Metagross vs Salamence
  { name: 'b_magma', q: 'battle=magma&player=284&enemy=340' },          // vs Camerupt
  { name: 'b_aqua', q: 'battle=aqua&player=281&enemy=331' },            // vs Sharpedo
  { name: 'b_sidney', q: 'battle=sidney&player=281&enemy=287' },        // vs Mightyena
  { name: 'b_phoebe', q: 'battle=phoebe&player=281&enemy=361' },        // vs Duskull
  { name: 'b_glacia', q: 'battle=glacia&player=281&enemy=341' },        // vs Spheal
  { name: 'b_drake', q: 'battle=drake&player=281&enemy=397' },          // vs Salamence
  { name: 'b_champion', q: 'battle=champion&player=281&enemy=329' },    // vs Milotic
  { name: 'b_groudon', q: 'battle=groudon&player=284&enemy=405' },
  { name: 'b_kyogre', q: 'battle=kyogre&player=284&enemy=404' },
  { name: 'b_rayquaza', q: 'battle=rayquaza&player=284&enemy=406' },
  // (Phase 3 final review: the Sky Pillar at night — its fog's pull to the backdrop fades with the daylight, 3619ce4; its
  // p3-base reference was captured from the base code, Task 4's 1e30bd6, which renders p3-base exactly)
  { name: 'b_rayquaza_night', q: 'battle=rayquaza&player=284&enemy=406&hour=21' },
];

type Entry = (LiveEntry & { kind: 'live' }) | (StaticEntry & { kind: 'static' });

/** Every entry, live then static (map previews, interiors, battles). */
const ALL_ENTRIES: Entry[] = [...LIVE.map((e) => ({ ...e, kind: 'live' as const })),
  ...[...STATIC, ...STATIC_INTERIOR, ...STATIC_BATTLE].map((e) => ({ ...e, kind: 'static' as const }))];

/** A static battle entry (STATIC_BATTLE: the battle preview) rather than a map preview. */
const isStaticBattle = (e: Entry): boolean => e.kind === 'static' && e.q.startsWith('battle=');

/** The entries --battles runs: the live ones named battle* and the static battle previews. */
const isBattleEntry = (e: Entry): boolean => (e.kind === 'live' && e.name.startsWith('battle')) || isStaticBattle(e);

/** The entries --interiors runs: the static interior previews (i_*) and the live ones in INTERIOR_LIVE. */
const isInteriorEntry = (e: Entry): boolean => (e.kind === 'static' && e.name.startsWith('i_')) || (e.kind === 'live' && e.name in INTERIOR_LIVE);

/** --expect-same's controls (Phases 4, 4b): the shots the interior work must leave pixel-identical — every Retro shot, every
 *  Modern entry that is no interior entry (outdoors, battles, the Phase 2 / 3 entries, the o_* outdoor edits), the
 *  out-of-scope interiors (OUT_OF_SCOPE_INTERIOR), door_exit (it ends outdoors, 47 frames after the fade-in) and, since
 *  Phase 4b, Phase 4's interior entries (PHASE4_INTERIOR): only the 45 new maps' Modern entries change. */
const isSameControl = (e: Entry, style: string): boolean => style === 'retro' || !isInteriorEntry(e) || OUT_OF_SCOPE_INTERIOR.has(e.name)
  || e.name === 'door_exit' || PHASE4_INTERIOR.has(e.name);

/** An interior entry's map, "group.num" (the interior review's GBA map column): a preview's map=, a live entry's
 *  INTERIOR_LIVE map; null for others. */
const interiorMap = (e: Entry): string | null => (e.kind === 'live' ? INTERIOR_LIVE[e.name] ?? null
  : /(?:^|&)map=(\d+\.\d+)/.exec(e.q)?.[1] ?? null);

/** The day actor-luminance gate's entries (Phase 4): interior entries ending indoors (map group 0 is the towns and routes:
 *  door_exit ends outside), in scope (not OUT_OF_SCOPE_INTERIOR), not a night / dusk twin (NIGHT_TWINS gates those), and
 *  not a Phase 4b entry while its look gates wait (lookPending: measured, not gated). */
const dayActorGated = (e: Entry): boolean => isInteriorEntry(e) && !OUT_OF_SCOPE_INTERIOR.has(e.name) && !(e.name in NIGHT_TWINS)
  && !(interiorMap(e)?.startsWith('0.') ?? true) && !lookPending(e);
/** In-scope day interiors' actors against Retro: each within the band, their median at least this (Phase 4: the inflated
 *  actors lit as in Retro, the room's light round them). */
const DAY_ACTOR_BAND: [number, number] = [0.9, 1.15];
const DAY_ACTOR_MEDIAN_MIN = 0.95;

/** The GBA's own picture of a battle entry (the review's GBA column): live gba_<entry>, static ref_<entry> (no .png). */
const gbaName = (e: Entry): string => `${e.kind === 'live' ? 'gba' : 'ref'}_${e.name}`;

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];
const VIEW_W = 1280;
const VIEW_H = 800;
const CROP_W = 320;
const CROP_H = 400;

/** Inflation-field self-test parity tolerance (sprite px: half-float rounding grows with the height) of a field whose
 *  highest point is `max` px (the self-test result's inflateMax: the overworld's or the battlers' field), and the field
 *  update's GPU target (ms, reported). */
const selfTestTol = (max: number) => Math.max(0.02, 0.003 * max);
/** xBR self-test parity tolerance (RGBA 0..1: the RGBA8 target's rounding plus float differences). */
const XBR_TOL = 2 / 255;
/** The baked xBR path (the battlers' HD edges) against the live shader, RGBA8 bytes: the same decisions, the same
 *  blend — identical. */
const XBR_BAKED_VS_LIVE = 0;
const FIELD_GPU_MS = 0.3;
/** --ab-feature: what the A/B switches off for its baseline, on the live page (emu) and, where it can, the static
 *  preview (idle only: nothing walks there), and its budgets over that baseline (GPU frame, renderer CPU; ms), flagged
 *  in the table: the Phase 2 actors +1.0 / +0.5, the NPC occlusion fade (Task 11) +0.3 / +0.5, the Modern battle (Phase 3)
 *  +3.0 / +0.5. `previewWhen`: the static entries where the switch changes anything (the NPC fade needs a
 *  stand-in player, &focus; the battle style a battle preview; elsewhere both arms would be the same frames). */
interface AbFeature {
  what: string; gpuMs: number; cpuMs: number; live: (on: boolean) => string; preview?: (on: boolean) => string;
  previewWhen?: (e: Entry) => boolean;
}
const AB_FEATURES: Record<string, AbFeature> = {
  actors: {
    what: 'Phase 2 actors (inflated + models) on vs off (all cards)', gpuMs: 1.0, cpuMs: 0.5,
    live: (on) => `emu.renderer.overworld.setActorInflation(${on})`,
  },
  npcfade: {
    what: "NPC occlusion fade on vs off (the player's circle only)", gpuMs: 0.3, cpuMs: 0.5,
    live: (on) => `emu.renderer.overworld.setNpcFade(${on})`, preview: (on) => `preview.setNpcFade(${on})`,
    previewWhen: (e) => e.kind === 'static' && /(^|&)focus=/.test(e.q),
  },
  // (Phase 3: the battle's world style alone — the live page's PostFX keeps its style's tilt-shift; the preview's
  // setStyle switches both, as Renderer.setWorldStyle does)
  battle: {
    what: 'Modern vs Retro battle (BattleView world style)', gpuMs: 3.0, cpuMs: 0.5,
    live: (on) => `emu.renderer.battle.setWorldStyle('${on ? 'modern' : 'retro'}')`,
    preview: (on) => `preview.setStyle('${on ? 'modern' : 'retro'}')`,
    previewWhen: (e) => e.kind === 'static' && e.q.startsWith('battle='),
  },
  // (Phase 3 Task 5: the Modern battle's inflated battlers and their field passes against today's cards, same arena)
  battlers: {
    what: 'Modern battlers inflated (+ their field passes) vs cards', gpuMs: 1.0, cpuMs: 0.5,
    live: (on) => `emu.renderer.battle.inflation = ${on}`,
    preview: (on) => `preview.setInflation(${on})`,
    previewWhen: (e) => e.kind === 'static' && e.q.startsWith('battle='),
  },
  // (Phase 4 Task 13: the interior kit on in-scope rooms against today's interior, light included — off, the world builds
  // no kit there, so `interiorKitRan` is false: no night blend, uOutdoorNight 0. Each switch rebuilds the world: the
  // half's settle frames absorb it. The in-scope interior previews only, by entry (a new i_* entry is in unless it joins
  // OUT_OF_SCOPE_INTERIOR): the rooftop and the out-of-scope controls draw the same frames in both arms)
  interior: {
    what: 'Phase 4 interior kit (shell, floor, furniture, HD legacy, light) vs today\'s interior', gpuMs: 2.0, cpuMs: 0.5,
    live: (on) => `emu.renderer.overworld.setInteriorKit(${on})`,
    preview: (on) => `preview.setInteriorKit(${on})`,
    previewWhen: (e) => isInteriorEntry(e) && !OUT_OF_SCOPE_INTERIOR.has(e.name),
  },
};

interface SelfTest { slots: number; maxErr: number; fixtureMaxErr: number; gpuMs: number; inflateMax: number;
  xbr: { maxErr: number; bakedMaxErr: number; bakedVsLive: number } }
interface Diff { pct: number; bbox: { x: number; y: number; w: number; h: number } | null; pixels: number }
/** Actor luminance of an entry's Modern shot relative to its Retro shot, over the visible actor pixels. `maskMismatch`:
 *  the share of the frame, away from the actors, where a mask re-render differs from its shot (the worse style);
 *  `unreliable` above MASK_MISMATCH_MAX (the mask is not the shot's frame: the masked pixels may not be the actors'). */
interface ActorLum { ratio: number; modern: number; retro: number; pixels: number; maskMismatch: number; unreliable?: true }
/** Fewer visible actor pixels than this: no luminance (battle, an actor hidden in one style). */
const ACTOR_LUM_MIN_PX = 200;
/** The mask re-render guard: pixels within this distance of a mask's magenta are not compared with the shot
 *  (antialiasing, tilt-shift blur); a mismatch above this share of the frame flags the entry's luminance unreliable.
 *  Same-frame masks stay under 0.5 % (the bloom halo of bright actors, e.g. rocks by the Flash lantern, reaches past the
 *  guard: granite_rocks 0.44 %); a frame that moved on differs almost everywhere (the transition's zoom: 42 %). */
const MASK_GUARD_PX = 4;
const MASK_MISMATCH_MAX = 0.02;
/** One --ab variant: medians of on, off and of the per-round paired deltas (ms); `moved` = the least px the
 *  player walked in any timed block (walking). */
interface AbVariant { gpuOn: number; gpuOff: number; dGpu: number; cpuOn: number; cpuOff: number; dCpu: number; moved?: number }
/** --ab-method: `block` = rounds of 60-frame blocks per mode (abVariant), `frame` = ABBA quads of short halves
 *  (abVariantFrames, the default: it resolves the deltas better, see the header). */
type AbMethod = 'block' | 'frame';
interface EntryStats {
  calls: number; triangles: number; programs: number; stepMsMax?: number; buildMs?: number;
  gpuMs?: number; gpuP90?: number; cpuMs?: number;
  diff?: Diff; selftest?: SelfTest; selftestMid?: SelfTest;
  /** `rounds`: blocks per mode (block) or ABBA quads (frame, `half`: its settle / timed frames per half); `aa`: an A/A
   *  run (both arms on: the noise floor). */
  ab?: { method: AbMethod; rounds: number; half?: AbHalf; idle: AbVariant; walk?: AbVariant; aa?: boolean };
  /** On the Modern key: Modern / Retro actor luminance (both styles in the run). */
  actorLum?: ActorLum;
  /** On a night twin's Modern key: its luma against its day twin (NIGHT_TWINS). */
  nightLum?: NightLum;
  /** Crossing entries: the walk's frames (CROSSING). */
  crossing?: CrossingStats;
  /** Scene-change entries: the walk's frames (SCENE_CHANGE_MS). */
  sceneChange?: CrossingStats;
  /** Puzzle walks and edit entries: their runtime cell changes (PuzzleStats). */
  puzzle?: PuzzleStats;
}

/**
 * One runtime cell change of a puzzle entry: `at` = a walk's frame from the state's load, or a static entry's step (from
 * 1); `frameMs` = the renderer CPU ms of the frame that took it (drained; a static step: setCells plus its first frame);
 * the world builds and patches it made (patches null: no patch counter yet — Task 3 adds it); `buildMs` = the rebuild's ms
 * (lastBuildMs, when it built); `firstFrameMs` (static) = the first frame after setCells, drained; `patchMs` = lastPatchMs
 * when it patched; `cells` = the cells it changed and `collision` those it made blocked or passable (collision bits zero ↔
 * non-zero: analyze's Floor ↔ Block, the 'structure' refusals to expect: PuzzleGate); `result` (static) = setCells' path.
 */
interface PuzzleChange {
  at: number; frameMs: number; builds: number; patches: number | null; buildMs: number | null; firstFrameMs?: number;
  patchMs: number | null; cells?: number; collision?: number; result?: string;
}
/** A puzzle entry's record: its gate (path, this style's mode), the frames after the settle (drained), the median of those
 *  that took no change, the grid changes, builds, patches and programs after the settle → at the end, and the changes;
 *  `broken`: the gate's failures ('gate' mode). */
interface PuzzleStats {
  path: 'live' | 'legacy'; mode: 'record' | 'gate'; frames: number; settle: number; medianMs: number;
  gridChanges: [number | null, number | null]; builds: [number | null, number | null]; patches: [number | null, number | null];
  programs: [number, number]; changes: PuzzleChange[]; broken?: string[];
  /** The refusals after the settle, by reason (null: no refusal counter — before Task 3); `expect`: the gate's for the style. */
  refusals: RefusalCounts | null; expect: RefusalCounts;
}

/** A crossing or scene-change entry's walk (the steps after the settle): frame CPU ms with the GPU drained (`maxAt` and
 *  `slowest`, [frame, ms] × 5, count frames of the walk: frame f of the walk is frame `settle` + f from the state's load),
 *  the session's world builds after the settle → at the end (null: the page exposes no build counter), its programs from
 *  `programsFrom` → at the end (a crossing's and an entry's without an eval: after the settle; a scene change's with one:
 *  right after its eval, see SCENE_CHANGE_MS), the last world build's ms, and the walk frame that made the session's
 *  first world build (null: one was made before the walk, or none). */
interface CrossingStats {
  frames: number; maxMs: number; maxAt: number; medianMs: number; slowest: [number, number][];
  builds: [number | null, number | null]; programs: [number, number]; programsFrom: 'eval' | 'settle'; lastBuildMs: number | null;
  settle: number; firstBuildAt: number | null;
}

/** The renderer's (or the preview's) stats() fields a walk reads; gridChanges, patches and lastPatchMs: the puzzle
 *  entries' (patches and lastPatchMs from Phase 4b Task 3 on). */
interface WalkPoint {
  programs: number; builds?: number; lastBuildMs?: number; gridChanges?: number; patches?: number; lastPatchMs?: number;
  refusals?: RefusalCounts;
}

/** The walk an entry makes (crossings, sceneChange, puzzle), or null. */
const walkOf = (e: LiveEntry): 'crossing' | 'sceneChange' | 'puzzle' | null => (e.crossings ? 'crossing' : e.sceneChange ? 'sceneChange'
  : e.puzzle ? 'puzzle' : null);

/** A puzzle entry's PuzzleStats from its changes and the frames that took none (`quiet`), the stats after the settle and
 *  at the end, judged by `gate` for `style` (see PuzzleGate). */
function puzzleStats(gate: PuzzleGate, style: string, settle: number, frames: number, quiet: number[], changes: PuzzleChange[],
  settled: WalkPoint, end: WalkPoint): PuzzleStats {
  const n = (v: number | undefined) => v ?? null;
  // (the refusals after the settle, by reason: the end's counts less the settle's)
  let refusals: RefusalCounts | null = null;
  if (end.refusals) {
    refusals = {};
    for (const [r, c] of Object.entries(end.refusals)) {
      const k = (c ?? 0) - (settled.refusals?.[r] ?? 0);
      if (k) refusals[r] = k;
    }
  }
  const expect = (style === 'retro' ? gate.expect?.retro : gate.expect?.modern) ?? {};
  const p: PuzzleStats = {
    path: gate.path, mode: style === 'retro' ? gate.retro : gate.modern, frames, settle,
    medianMs: quiet.length ? round(median(quiet), 2) : 0, gridChanges: [n(settled.gridChanges), n(end.gridChanges)],
    builds: [n(settled.builds), n(end.builds)], patches: [n(settled.patches), n(end.patches)],
    programs: [settled.programs, end.programs], changes, refusals, expect,
  };
  if (p.mode === 'gate') {
    const broken: string[] = [];
    const d = (a: [number | null, number | null]) => (a[0] !== null && a[1] !== null ? a[1] - a[0] : null);
    const grid = d(p.gridChanges), builds = d(p.builds), patches = d(p.patches);
    if (refusals === null) broken.push('no refusal counter (stats().refusals)');
    const got = refusals ?? {};
    for (const r of new Set([...Object.keys(expect), ...Object.keys(got)])) {
      if ((got[r] ?? 0) !== (expect[r] ?? 0)) broken.push(`refusals '${r}' ${got[r] ?? 0}, expected ${expect[r] ?? 0}`);
    }
    const refused = Object.values(got).reduce((a: number, b) => a + (b ?? 0), 0);
    if (builds !== refused) broken.push(`${builds ?? '?'} world build(s) after the settle for ${refused} refusal(s)`);
    if (p.programs[1] !== p.programs[0]) broken.push(`programs ${p.programs[0]} → ${p.programs[1]}`);
    if (gate.changes) {
      // (a walk's pinned changes: their count, and each one's cells and collision as p4b-base recorded them)
      if (grid !== gate.changes.length) broken.push(`${grid ?? '?'} grid changes (${gate.changes.length} pinned)`);
      gate.changes.forEach(([cells, collision], k) => {
        const c = changes[k];
        if (c && (c.cells !== cells || c.collision !== collision)) {
          broken.push(`change ${k + 1} @${c.at}: ${c.cells ?? '?'} cells / ${c.collision ?? '?'} collision, pinned ${cells} / ${collision}`);
        }
      });
    } else if (grid === null || grid < 1) broken.push(`${grid ?? '?'} grid changes (≥ 1 needed)`);
    if (patches === null || grid === null || patches + refused !== grid) {
      broken.push(`patches ${patches ?? '? (no patch counter)'} + refusals ${refused} ≠ grid changes ${grid ?? '?'}`);
    }
    const budget = PATCH_BUDGET_MS[gate.path], margin = PATCH_FRAME_MARGIN_MS[gate.path];
    for (const c of changes) {
      if (c.builds > 0) {
        // a refused change: rebuilt within a crossing's frame budget
        const limit = c.buildMs !== null ? round(c.buildMs + crossingMargin(c.buildMs), 2) : null;
        if (limit === null || !(c.frameMs <= limit)) broken.push(`@${c.at}: rebuilt, frame ${c.frameMs} ms > ${limit ?? '?'} ms (build + margin)`);
        continue;
      }
      if (c.patchMs === null || !(c.patchMs <= budget)) broken.push(`@${c.at}: patch ${c.patchMs ?? '-'} ms > ${budget} ms`);
      if (!(c.frameMs <= p.medianMs + margin)) broken.push(`@${c.at}: frame ${c.frameMs} ms > median ${p.medianMs} + ${margin} ms`);
    }
    if (broken.length) p.broken = broken;
  }
  return p;
}

/** A puzzle entry's report line. */
function puzzleLine(p: PuzzleStats): string {
  const d = (a: [number | null, number | null]) => (a[0] !== null && a[1] !== null ? String(a[1] - a[0]) : '?');
  const ch = p.changes.map((c) => `@${c.at}${c.cells !== undefined ? ` (${c.cells} cells, ${c.collision ?? '?'} collision)` : ''}: frame ${c.frameMs} ms`
    + (c.buildMs !== null ? `, build ${c.buildMs} ms` : '') + (c.firstFrameMs !== undefined ? `, first frame ${c.firstFrameMs} ms` : '')
    + (c.patchMs !== null ? `, patch ${c.patchMs} ms` : '')).join('; ');
  const refusals = (r: RefusalCounts | null) => (r === null ? '?' : Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || '0');
  return ` | puzzle (${p.path}, ${p.mode}): ${d(p.gridChanges)} grid change(s), builds ${d(p.builds)}, patches ${d(p.patches)}, refusals`
    + ` ${refusals(p.refusals)} (expected ${refusals(p.expect)}), programs`
    + ` ${p.programs.join(' → ')}, median frame ${p.medianMs} ms over ${p.frames} frames${ch ? `; ${ch}` : ''}`
    + (p.mode === 'gate' ? (p.broken ? ` PUZZLE GATES FAILED: ${p.broken.join('; ')}` : ' (gated: passed)') : ' (recorded)');
}

/** A walk's CrossingStats from its frames' ms and the session's builds after each, the settle's length and the renderer's
 *  stats after the settle and at the end; `evaluated`: its stats right after the entry's eval (a scene change's programs
 *  count from there; none: from the settle). */
function walkStats(walk: number[], walkBuilds: (number | undefined)[], settle: number, settled: WalkPoint, end: WalkPoint,
  evaluated?: WalkPoint): CrossingStats {
  const order = walk.map((t, i) => [i + 1, round(t, 2)] as [number, number]).sort((a, b) => b[1] - a[1]);
  const first = settled.builds === 0 ? walkBuilds.findIndex((b) => (b ?? 0) > 0) : -1;
  return {
    frames: walk.length, maxMs: order[0][1], maxAt: order[0][0], medianMs: round(median(walk), 2), slowest: order.slice(0, 5),
    builds: [settled.builds ?? null, end.builds ?? null], programs: [(evaluated ?? settled).programs, end.programs],
    programsFrom: evaluated ? 'eval' : 'settle', lastBuildMs: end.lastBuildMs ?? null, settle, firstBuildAt: first >= 0 ? first + 1 : null,
  };
}

/** A walk's report line and the gates it broke (none: passed, or a scene change that only records). */
function walkReport(e: LiveEntry, c: CrossingStats): { line: string; broken: string[] } {
  const broken: string[] = [];
  if (e.crossings) {
    const [b0, b1] = c.builds;
    const builds = b0 !== null && b1 !== null ? b1 - b0 : null;
    const limit = c.lastBuildMs !== null ? round(c.lastBuildMs + crossingMargin(c.lastBuildMs), 2) : null;
    if (c.programs[1] !== c.programs[0]) broken.push(`programs ${c.programs[0]} → ${c.programs[1]}`);
    if (builds !== e.crossings) broken.push(`${builds ?? 'no build counter:'} builds for ${e.crossings} crossing(s)`);
    if (limit === null || c.maxMs > limit) broken.push(`max frame ${c.maxMs} ms > ${limit ?? '?'} ms (build ${c.lastBuildMs ?? '?'} + margin)`);
    const line = ` | walk ${c.frames} frames after a ${c.settle}-frame settle: max ${c.maxMs} ms (walk frame ${c.maxAt}, build`
      + ` ${c.lastBuildMs === null ? '?' : round(c.lastBuildMs, 1)} ms), median ${c.medianMs}, builds ${builds ?? '?'}, programs`
      + ` ${c.programs.join(' → ')}${broken.length ? ` CROSSING GATES FAILED: ${broken.join('; ')}` : ''}`;
    return { line, broken };
  }
  // (frames from the state's load, as the entries' comments count them)
  const at = (f: number) => c.settle + f;
  if (e.sceneChange === 'gate') {
    if (c.programs[1] !== c.programs[0]) broken.push(`programs ${c.programs[0]} → ${c.programs[1]}`);
    // (the slowest frame but the session's first world build's: `slowest` holds five)
    const [f, ms] = c.slowest.find(([w]) => w !== c.firstBuildAt) ?? [0, 0];
    if (ms > SCENE_CHANGE_MS) broken.push(`frame ${at(f)}: ${ms} ms > ${SCENE_CHANGE_MS} ms`);
  }
  const line = ` | scene change, frames ${at(1)}-${at(c.frames)}: max ${c.maxMs} ms @${at(c.maxAt)}, median ${c.medianMs},`
    + ` slowest ${c.slowest.map(([f, ms]) => `${ms}@${at(f)}`).join(' ')}, programs ${c.programs.join(' → ')}${c.programsFrom === 'eval' ? ' (from the eval)' : ''}, builds`
    + ` ${c.builds.map((b) => b ?? '?').join(' → ')}${c.firstBuildAt !== null ? ` (the session's first @${at(c.firstBuildAt)}${e.sceneChange === 'gate' ? ': no frame gate' : ''})` : ''}`
    + (e.sceneChange === 'gate' ? (broken.length ? ` SCENE-CHANGE GATES FAILED: ${broken.join('; ')}` : ' (gated: passed)') : ' (recorded)');
  return { line, broken };
}

/** Steps `frames` frames holding `keys`, draining the GPU after each (untimed): the frames' renderer CPU ms, the
 *  session's world builds after each (stats().builds) and the renderer's stats after each (`points`: the puzzle walks'); with
 *  `diff`, the emulated grid's [cells, collision] changes against the frame before (window.__pzGrid, set at the settle). */
const drainedStep = (keys: string, frames: number, diff = false) => `(() => {
  const gl = emu.renderer.webgl.getContext(), px = new Uint8Array(4), ms = [], builds = [], points = [], diffs = [];
  for (let i = 0; i < ${frames}; i++) {
    ms.push(emu.step(${JSON.stringify(keys)}, 1)[0]);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    const s = emu.renderer.stats();
    builds.push(s.builds);
    points.push(s);
    ${diff ? `// (the emulated grid against the frame before: cells changed, those blocked that were not or back)
    const g = emu.renderer.state.readBackupGrid(), prev = window.__pzGrid;
    let cells = 0, collision = 0;
    if (prev && prev.length === g.length) {
      for (let k = 0; k < g.length; k++) if (g[k] !== prev[k]) { cells++; if (!(g[k] & 0xc00) !== !(prev[k] & 0xc00)) collision++; }
    }
    window.__pzGrid = g;
    diffs.push([cells, collision]);` : ''}
  }
  return { ms, builds, points, diffs };
})()`;

/** Frames a static puzzle entry renders before its first edit. */
const EDIT_SETTLE = 30;

/** A static puzzle entry's frames in the preview (one call): EDIT_SETTLE frames, then per step its setCells (timed) and its
 *  `after` frames, every frame timed (renderer CPU ms) and then drained (a 1-pixel readPixels, untimed); the preview's stats after the settle, around each
 *  setCells and at the end; `quiet`: the frames that took no change. */
const staticPuzzleScript = (steps: { edits: [number, number, number][]; after: number }[]) => `(() => {
  const gl = preview.webgl.getContext(), px = new Uint8Array(4);
  // (renderer CPU ms, as a live walk times emu.step: the drain after the frame is untimed — Task 1 review, Important 1)
  const one = () => { const t = performance.now(); preview.frames(1); const ms = performance.now() - t; gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); return ms; };
  const quiet = [], out = [];
  for (let i = 0; i < ${EDIT_SETTLE}; i++) one();
  const settled = preview.stats();
  for (const [edits, after] of ${JSON.stringify(steps.map((x) => [x.edits, x.after]))}) {
    const before = preview.stats();
    const t0 = performance.now();
    const result = preview.setCells(edits);
    const setMs = performance.now() - t0;
    const first = one();
    out.push({ result, setMs, first, before, after: preview.stats() });
    for (let i = 1; i < after; i++) quiet.push(one());
  }
  return { settled, out, quiet, end: preview.stats() };
})()`;
/** What staticPuzzleScript returns. */
interface StaticPuzzleRun {
  settled: WalkPoint; quiet: number[]; end: WalkPoint;
  out: { result: string; setMs: number; first: number; before: WalkPoint; after: WalkPoint }[];
}

/** The ROM's map grids (the edit entries' cells before their edits), loaded on first use. */
let romReader: RomReader | null = null;
function mapGrid(root: string, key: string): { width: number; height: number; cells: Uint16Array } {
  if (!romReader) {
    const rom = fs.readdirSync(root).find((f) => f.toLowerCase().endsWith('.gba'));
    if (!rom) throw new Error('no ROM (*.gba) in the repository root: the edit entries read their maps from it');
    romReader = new RomReader(new Uint8Array(fs.readFileSync(path.join(root, rom))));
  }
  const [g, n] = key.split('.').map(Number);
  const l = loadMap(romReader, g, n).layout;
  return { width: l.width, height: l.height, cells: l.grid.slice() };
}

/** A static entry's edit steps resolved to setCells lists ([x, y, raw]: editRaw on the cell's value before the step, the
 *  steps applied in order) and the cells each changes; a step that changes no cell, or a cell outside the map, throws. */
function resolveEdits(root: string, e: StaticEntry): { edits: [number, number, number][]; after: number; cells: number; collision: number }[] {
  const key = /(?:^|&)map=(\d+\.\d+)/.exec(e.q)?.[1];
  if (!key) throw new Error('an edit entry needs map=');
  const grid = mapGrid(root, key);
  const steps = Array.isArray(e.edits) ? e.edits : [e.edits!];
  return steps.map((spec, k) => {
    const list: DecompEdit[] = [...(spec.script ? scriptEdits(spec.script[0], spec.script[1]) : []),
      ...(spec.cells ?? []).map(([x, y, label, blocked]) => ({ x, y, metatile: metatileId(label), blocked, label }))];
    const edits: [number, number, number][] = [];
    const before = new Map<number, number>();
    for (const c of list) {
      if (c.x < 0 || c.y < 0 || c.x >= grid.width || c.y >= grid.height) throw new Error(`edit step ${k + 1}: ${c.x},${c.y} is outside the map`);
      const i = c.y * grid.width + c.x;
      if (!before.has(i)) before.set(i, grid.cells[i]);
      grid.cells[i] = editRaw(grid.cells[i], c);
      edits.push([c.x, c.y, grid.cells[i]]);
    }
    // (the step's changed cells and those blocked that were not or back — analyze's Floor / Block — against the grid before)
    let cells = 0, collision = 0;
    for (const [i, old] of before) {
      if (grid.cells[i] !== old) cells++;
      if (!(grid.cells[i] & 0xc00) !== !(old & 0xc00)) collision++;
    }
    if (!cells) throw new Error(`edit step ${k + 1} changes no cell (${list.length} edits): it would measure nothing`);
    return { edits, after: spec.after ?? 30, cells, collision };
  });
}

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : def;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

/** Pixel size of a PNG file (IHDR). */
function pngSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

// Diff of two PNGs (data URLs) in the page: a pixel differs when any channel differs by > 8.
// (a string: tsx would wrap the functions of a function argument in a helper the page lacks)
const DIFF_FN = `(async function (a, b) {
  function load(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('cannot decode image')); };
      i.src = src;
    });
  }
  var ia = await load(a), ib = await load(b);
  var w = ia.naturalWidth, h = ia.naturalHeight;
  if (ib.naturalWidth !== w || ib.naturalHeight !== h) {
    return { pct: 100, bbox: { x: 0, y: 0, w: Math.max(w, ib.naturalWidth), h: Math.max(h, ib.naturalHeight) }, pixels: -1 };
  }
  function pixels(img) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  }
  var pa = pixels(ia), pb = pixels(ib);
  var n = 0, x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var k = (y * w + x) * 4;
      if (Math.abs(pa[k] - pb[k]) > 8 || Math.abs(pa[k + 1] - pb[k + 1]) > 8 ||
          Math.abs(pa[k + 2] - pb[k + 2]) > 8 || Math.abs(pa[k + 3] - pb[k + 3]) > 8) {
        n++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { pct: Math.round((n / (w * h)) * 10000) / 100, bbox: n ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null, pixels: n };
})`;

// Actor luminance of an entry: the mean sRGB luma (Rec. 709) of its Modern and Retro shots over the pixels
// where an actor is visible in both (each style's actor-mask shot: magenta, eroded by 1 px; occluders and
// the occlusion dither excluded). A string for the page, as DIFF_FN.
const LUM_FN = `(async function (shotM, shotR, maskM, maskR) {
  function load(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('cannot decode image')); };
      i.src = src;
    });
  }
  var imgs = await Promise.all([load(shotM), load(shotR), load(maskM), load(maskR)]);
  var w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
  function pixels(img) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  }
  var pm = pixels(imgs[0]), pr = pixels(imgs[1]), mm = pixels(imgs[2]), mr = pixels(imgs[3]);
  function magenta(d, x, y) { var k = (y * w + x) * 4; return d[k] > 200 && d[k + 1] < 90 && d[k + 2] > 200; }
  // the mask is the shot's frame drawn again: away from the actors (no magenta within R px: antialiasing and blur
  // spread it) its pixels must equal the shot's; the count of those that differ (> 8 in a channel)
  function mismatch(shot, mask) {
    var R = ${MASK_GUARD_PX}, near = new Uint8Array(w * h), n = 0, x, y, d, m;
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        for (m = 0, d = -R; d <= R && !m; d++) if (x + d >= 0 && x + d < w && magenta(mask, x + d, y)) m = 1;
        near[y * w + x] = m;
      }
    }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        for (m = 0, d = -R; d <= R && !m; d++) if (y + d >= 0 && y + d < h && near[(y + d) * w + x]) m = 1;
        if (m) continue;
        var k = (y * w + x) * 4;
        if (Math.abs(shot[k] - mask[k]) > 8 || Math.abs(shot[k + 1] - mask[k + 1]) > 8 || Math.abs(shot[k + 2] - mask[k + 2]) > 8) n++;
      }
    }
    return n;
  }
  function both(x, y) { return magenta(mm, x, y) && magenta(mr, x, y); }
  var n = 0, sm = 0, sr = 0;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      if (!(both(x, y) && both(x - 1, y) && both(x + 1, y) && both(x, y - 1) && both(x, y + 1))) continue;
      var k = (y * w + x) * 4;
      sm += 0.2126 * pm[k] + 0.7152 * pm[k + 1] + 0.0722 * pm[k + 2];
      sr += 0.2126 * pr[k] + 0.7152 * pr[k + 1] + 0.0722 * pr[k + 2];
      n++;
    }
  }
  return { pixels: n, modern: n ? sm / n : 0, retro: n ? sr / n : 0, mismatch: Math.max(mismatch(pm, mm), mismatch(pr, mr)) / (w * h) };
})`;

// A night twin's luma against its day twin (NIGHT_TWINS): the mean sRGB luma (Rec. 709) of both Modern shots over the
// room's pixels (no actor's magenta within 1 px in either mask) and over the actor pixels visible in both masks (eroded by
// 1 px, as LUM_FN). A string for the page, as DIFF_FN.
const NIGHT_FN = `(async function (shotN, shotD, maskN, maskD) {
  function load(src) {
    return new Promise(function (res, rej) {
      var i = new Image();
      i.onload = function () { res(i); };
      i.onerror = function () { rej(new Error('cannot decode image')); };
      i.src = src;
    });
  }
  var imgs = await Promise.all([load(shotN), load(shotD), load(maskN), load(maskD)]);
  var w = imgs[0].naturalWidth, h = imgs[0].naturalHeight;
  function pixels(img) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    var g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    return g.getImageData(0, 0, w, h).data;
  }
  var pn = pixels(imgs[0]), pd = pixels(imgs[1]), mn = pixels(imgs[2]), md = pixels(imgs[3]);
  function magenta(d, x, y) { var k = (y * w + x) * 4; return d[k] > 200 && d[k + 1] < 90 && d[k + 2] > 200; }
  function any(x, y) { return magenta(mn, x, y) || magenta(md, x, y); }
  function both(x, y) { return magenta(mn, x, y) && magenta(md, x, y); }
  function luma(d, k) { return 0.2126 * d[k] + 0.7152 * d[k + 1] + 0.0722 * d[k + 2]; }
  var rn = 0, rN = 0, rD = 0, an = 0, aN = 0, aD = 0;
  for (var y = 1; y < h - 1; y++) {
    for (var x = 1; x < w - 1; x++) {
      var k = (y * w + x) * 4;
      if (!(any(x, y) || any(x - 1, y) || any(x + 1, y) || any(x, y - 1) || any(x, y + 1))) {
        rN += luma(pn, k); rD += luma(pd, k); rn++;
      } else if (both(x, y) && both(x - 1, y) && both(x + 1, y) && both(x, y - 1) && both(x, y + 1)) {
        aN += luma(pn, k); aD += luma(pd, k); an++;
      }
    }
  }
  return { roomPx: rn, roomNight: rn ? rN / rn : 0, roomDay: rn ? rD / rn : 0, actorPx: an, actorNight: an ? aN / an : 0, actorDay: an ? aD / an : 0 };
})`;

/** A night twin's Modern luma against its day twin's (NIGHT_TWINS): ratios night / day (actorLum null under
 *  ACTOR_LUM_MIN_PX visible actor pixels), the means behind them, and the in-scope gate's verdict (null: not gated). */
interface NightLum {
  day: string; roomLuma: number; actorLum: number | null; room: [number, number]; actor: [number, number] | null;
  actorPx: number; gated: boolean; broken?: string[];
}

async function nightLum(page: Page, night: string, day: string, files: [string, string, string, string]): Promise<NightLum> {
  const url = (f: string) => JSON.stringify(`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`);
  await page.setContent('<html><body></body></html>');
  const r = await page.evaluate(`${NIGHT_FN}(${files.map(url).join(', ')})`) as
    { roomPx: number; roomNight: number; roomDay: number; actorPx: number; actorNight: number; actorDay: number };
  const actorOk = r.actorPx >= ACTOR_LUM_MIN_PX && r.actorDay > 0;
  const n: NightLum = {
    day, roomLuma: r.roomDay > 0 ? round(r.roomNight / r.roomDay, 3) : 0, actorLum: actorOk ? round(r.actorNight / r.actorDay, 3) : null,
    room: [round(r.roomNight, 1), round(r.roomDay, 1)], actor: actorOk ? [round(r.actorNight, 1), round(r.actorDay, 1)] : null,
    actorPx: r.actorPx, gated: nightGated(night),
  };
  if (n.gated) {
    const broken: string[] = [];
    const [lo, hi] = roomBand(night);
    // (Dewford's dark gym: its light is the flash rule, D10 — the room's luma is reported only)
    if (!NIGHT_ROOM_EXEMPT.has(night) && !(n.roomLuma >= lo && n.roomLuma <= hi)) broken.push(`roomLuma ${n.roomLuma} outside ${lo}-${hi}`);
    // (no actor measure is a failure, not a pass: D8's actor rule cannot be judged on an entry whose actors vanished)
    if (n.actorLum === null) broken.push(`actorLum unmeasured (${n.actorPx} actor px visible in both masks < ${ACTOR_LUM_MIN_PX})`);
    else if (!(n.actorLum >= NIGHT_ACTOR_BAND[0] && n.actorLum <= NIGHT_ACTOR_BAND[1])) {
      broken.push(`actorLum ${n.actorLum} outside ${NIGHT_ACTOR_BAND.join('-')}`);
    }
    if (broken.length) n.broken = broken;
  }
  return n;
}

async function actorLum(page: Page, files: [string, string, string, string]): Promise<ActorLum | null> {
  const url = (f: string) => JSON.stringify(`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`);
  await page.setContent('<html><body></body></html>');
  const r = await page.evaluate(`${LUM_FN}(${files.map(url).join(', ')})`) as
    { pixels: number; modern: number; retro: number; mismatch: number };
  if (r.pixels < ACTOR_LUM_MIN_PX || r.retro <= 0) return null;
  const lum: ActorLum = { ratio: round(r.modern / r.retro, 3), modern: round(r.modern, 1), retro: round(r.retro, 1), pixels: r.pixels,
    maskMismatch: round(r.mismatch, 5) };
  if (r.mismatch > MASK_MISMATCH_MAX) lum.unreliable = true;
  return lum;
}

async function diffPng(page: Page, file: string, ref: string): Promise<Diff> {
  const url = (f: string) => JSON.stringify(`data:image/png;base64,${fs.readFileSync(f).toString('base64')}`);
  await page.setContent('<html><body></body></html>');
  return await page.evaluate(`${DIFF_FN}(${url(file)}, ${url(ref)})`) as Diff;
}

/** Renders an HTML page of the run folder's images (relative URLs) and screenshots it whole. */
async function shootHtml(page: Page, dir: string, html: string, out: string, width: number, scale: number): Promise<void> {
  const file = path.join(dir, '_page.html');
  fs.writeFileSync(file, html);
  try {
    await page.setViewport({ width, height: 400, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
    await page.screenshot({ path: out as `${string}.png`, fullPage: true });
  } finally {
    fs.rmSync(file, { force: true });
  }
  console.log(`sheet ${out}`);
}

const CAPTION = 'figcaption{position:absolute;left:4px;top:2px;color:#ff0;font:bold 14px sans-serif;text-shadow:0 0 3px #000}';

/** Contact sheets (4 thumbnails per row, one per style) and the centre-crop sheet, from every PNG in `dir`. */
async function buildSheets(page: Page, dir: string): Promise<void> {
  const order = [...LIVE, ...STATIC, ...STATIC_INTERIOR, ...STATIC_BATTLE].map((e) => e.name);
  const shots = new Map<string, Set<string>>();
  for (const f of fs.readdirSync(dir)) {
    const m = /^([^_].*)_(modern|retro)\.png$/.exec(f);
    if (m) (shots.get(m[1]) ?? shots.set(m[1], new Set()).get(m[1])!).add(m[2]);
  }
  const rank = (n: string) => { const i = order.indexOf(n); return i < 0 ? order.length : i; };
  const names = [...shots.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  for (const style of ['modern', 'retro']) {
    const list = names.filter((n) => shots.get(n)!.has(style));
    if (!list.length) continue;
    const cells = list.map((n) => `<figure><img src="${n}_${style}.png"><figcaption>${n}</figcaption></figure>`).join('');
    await shootHtml(page, dir, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,400px)}
      figure{margin:0;position:relative}img{width:400px;height:250px;display:block}${CAPTION}</style>${cells}`,
    path.join(dir, `_sheet_${style}.png`), 1600, 1);
  }
  // centre crops at the screenshots' own resolution (a --dpr 2 run keeps its detail)
  let scale = 1;
  const cells: string[] = [];
  for (const n of names) {
    for (const style of ['modern', 'retro']) {
      const f = `${n}_${style}.png`;
      if (!shots.get(n)!.has(style)) {
        cells.push(`<figure><div></div><figcaption>${n} ${style} (missing)</figcaption></figure>`);
        continue;
      }
      const { w, h } = pngSize(path.join(dir, f));
      const s = w / VIEW_W;
      scale = Math.max(scale, s);
      cells.push(`<figure><div style="background:url('${f}') center/${w / s}px ${h / s}px no-repeat"></div><figcaption>${n} ${style}</figcaption></figure>`);
    }
  }
  if (!cells.length) return;
  await shootHtml(page, dir, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,${CROP_W}px)}
    figure{margin:0;position:relative;border:0}div{width:${CROP_W}px;height:${CROP_H}px;background-color:#333}${CAPTION}</style>${cells.join('')}`,
  path.join(dir, '_crops.png'), CROP_W * 4, scale);
}

/** Review sheet cells: 480×300, every picture letterboxed into it. */
const REVIEW_W = 480;
const REVIEW_H = 300;

/**
 * --review: _review_battle.png in `dir`, one row per battle entry of the run (`entries`, in run order): the GBA's picture
 * (gba_ / ref_<entry>.png in this folder) | before (<entry>_modern.png in `beforeDir`; blank without one) | Modern | Retro
 * (this run's shots). Each cell names its entry and column; a header row labels the columns. A missing picture is a
 * blank cell marked "(missing)". And _review_interior.png likewise, one row per interior entry of the run, its first
 * column the GBA map: the offline atlas render of the entry's map (interiorMap; out/atlas from tools/map-atlas.ts, a
 * blank cell when it is missing). Neither sheet is written without its rows.
 */
async function buildReview(page: Page, dir: string, entries: Entry[], beforeDir: string, beforeLabel: string): Promise<void> {
  await reviewSheet(page, dir, entries.filter(isBattleEntry), { label: 'GBA', file: (e) => path.join(dir, `${gbaName(e)}.png`) },
    beforeDir, beforeLabel, '_review_battle.png');
  // (the interior sheet's first column: the offline atlas render of the entry's map, out/atlas/<group>_<num>_<Name>.png)
  const atlasDir = path.resolve(dir, '../../atlas');
  const atlas = fs.existsSync(atlasDir) ? fs.readdirSync(atlasDir) : [];
  const atlasFile = (e: Entry): string | null => {
    const m = interiorMap(e);
    const f = m && atlas.find((n) => n.startsWith(`${m.replace('.', '_')}_`) && n.endsWith('.png'));
    return f ? path.join(atlasDir, f) : null;
  };
  await reviewSheet(page, dir, entries.filter(isInteriorEntry), { label: 'GBA map', file: atlasFile }, beforeDir, beforeLabel,
    '_review_interior.png');
}

/** One review sheet (see buildReview): `rows`' entries, the `first` column (the GBA's picture, scaled nearest) | before |
 *  Modern | Retro, into `out` in `dir`; none written without rows. */
async function reviewSheet(page: Page, dir: string, rows: Entry[], first: { label: string; file: (e: Entry) => string | null },
  beforeDir: string, beforeLabel: string, out: string): Promise<void> {
  if (!rows.length) return;
  // (the GBA's pictures scale nearest, the 3D shots smoothly)
  const columns: { label: string; file: (e: Entry) => string | null; pixelated?: true }[] = [
    { ...first, pixelated: true },
    // (an entry with `sameAs` ends as that entry: its before is that entry's)
    { label: beforeLabel ? `before (${beforeLabel})` : 'before',
      file: (e) => (beforeDir ? path.join(beforeDir, `${(e.kind === 'live' && e.sameAs) || e.name}_modern.png`) : null) },
    { label: 'Modern', file: (e) => path.join(dir, `${e.name}_modern.png`) },
    { label: 'Retro', file: (e) => path.join(dir, `${e.name}_retro.png`) },
  ];
  const head = columns.map((c) => `<div class="h">${c.label}</div>`).join('');
  const cells = rows.flatMap((e) => columns.map((c) => {
    const f = c.file(e);
    const caption = `<figcaption>${e.name} · ${c.label}${f && !fs.existsSync(f) ? ' (missing)' : ''}</figcaption>`;
    // (absolute file URLs: the before column lives in another run's folder)
    return f && fs.existsSync(f) ? `<figure><img${c.pixelated ? ' class="px"' : ''} src="${pathToFileURL(f).href}">${caption}</figure>`
      : `<figure>${caption}</figure>`;
  }));
  await shootHtml(page, dir, `<style>body{margin:0;background:#222;display:grid;grid-template-columns:repeat(4,${REVIEW_W}px)}
    .h{height:28px;color:#fff;font:bold 18px sans-serif;line-height:28px;text-align:center;background:#000}
    figure{margin:0;position:relative;width:${REVIEW_W}px;height:${REVIEW_H}px;background:#111;outline:1px solid #333}
    img{width:${REVIEW_W}px;height:${REVIEW_H}px;display:block;object-fit:contain}.px{image-rendering:pixelated}${CAPTION}</style>
    ${head}${cells.join('')}`, path.join(dir, out), REVIEW_W * 4, 1);
}

/**
 * One self-test point: `api`.selfTest() and the field dump (_field_<dump>.png). ok: some slots were
 * compared and both parity errors are finite and within selfTestTol of the field's inflateMax (NaN arrives as null; a
 * result without a finite inflateMax fails), the xBR shader's within XBR_TOL, and its baked path byte-equal to it
 * (XBR_BAKED_VS_LIVE).
 */
async function selfTestPoint(page: Page, api: string, outDir: string, dump: string): Promise<{ result: SelfTest; ok: boolean; text: string }> {
  const result = await page.evaluate(`${api}.selfTest()`) as SelfTest;
  const png = await page.evaluate(`${api}.fieldDump()`) as string;
  fs.writeFileSync(path.join(outDir, `_field_${dump}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
  const tol = selfTestTol(result.inflateMax);
  const within = (v: number) => Number.isFinite(v) && v <= tol;
  const xbrOk = [result.xbr?.maxErr, result.xbr?.bakedMaxErr].every((v) => Number.isFinite(v) && v <= XBR_TOL)
    && Number.isFinite(result.xbr?.bakedVsLive) && result.xbr.bakedVsLive <= XBR_BAKED_VS_LIVE;
  const ok = result.slots > 0 && within(result.maxErr) && within(result.fixtureMaxErr) && xbrOk;
  let text = `selftest ${result.slots} slots maxErr ${result.maxErr} fixture ${result.fixtureMaxErr} (tol ${round(tol, 4)})`
    + ` gpu ${round(result.gpuMs, 3)} ms xbr maxErr ${result.xbr?.maxErr} baked ${result.xbr?.bakedMaxErr} baked vs live ${result.xbr?.bakedVsLive}`;
  if (!(result.gpuMs <= FIELD_GPU_MS)) text += ` (> ${FIELD_GPU_MS} ms target)`;
  return { result, ok, text };
}

/** The player's world position (px), or null (no player: battle, cutscene without one). */
const PLAYER_POS = `(() => { const st = emu.renderer.state; const p = st.player;
  const s = p && st.sprites.find((q) => q.index === p.spriteId); return s ? [s.worldX, s.worldY] : null; })()`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b), h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

/**
 * One --ab variant: `rounds` on/off pairs (order alternating per round) of `feature`, each block settling 5 frames
 * and timing gpuFrames(60). Live: each block restores the snapshot `window.__abSnap` first, `keys` held through it.
 * Static (the preview): the same frames, idle.
 */
async function abVariant(page: Page, rounds: number, keys: string, feature: AbFeature, live: boolean, aa = false): Promise<AbVariant> {
  type T = { gpuMs: number; cpuMs: number };
  const on: T[] = [], off: T[] = [];
  let moved = Infinity;
  const k = JSON.stringify(keys);
  for (let r = 0; r < rounds; r++) {
    for (const mode of r % 2 === 0 ? [true, false] : [false, true]) {
      if (!live) {
        await page.evaluate(`${feature.preview!(mode || aa)}; preview.frames(5)`);
        (mode ? on : off).push(await page.evaluate('preview.gpuFrames(60)') as T);
        continue;
      }
      await page.evaluate(`${feature.live(mode || aa)}; emu.gba.loadState(window.__abSnap)`);
      await page.evaluate(`emu.gpuFrames(5, ${k})`);
      const p0 = await page.evaluate(PLAYER_POS) as number[] | null;
      const g = await page.evaluate(`emu.gpuFrames(60, ${k})`) as T;
      const p1 = await page.evaluate(PLAYER_POS) as number[] | null;
      moved = Math.min(moved, p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0);
      (mode ? on : off).push(g);
    }
  }
  const v: AbVariant = {
    gpuOn: round(median(on.map((x) => x.gpuMs)), 3), gpuOff: round(median(off.map((x) => x.gpuMs)), 3),
    dGpu: round(median(on.map((x, i) => x.gpuMs - off[i].gpuMs)), 3),
    cpuOn: round(median(on.map((x) => x.cpuMs)), 3), cpuOff: round(median(off.map((x) => x.cpuMs)), 3),
    dCpu: round(median(on.map((x, i) => x.cpuMs - off[i].cpuMs)), 3),
  };
  if (keys) v.moved = round(moved, 1);
  return v;
}

/** The fewest frames emulated between snapshot restores in an interleaved --ab variant (live; settle frames included): a
 *  restore falls between quads, so a window runs up to one quad (4 × (settle + timed) frames) longer. With a larger
 *  --ab-settle / --ab-timed a walk can reach an obstacle within a window and stall (the `moved` column shows it). */
const FRAME_AB_WINDOW = 60;

/** One half of an interleaved --ab quad: untimed settle frames after the switch, then timed frames back to back. */
interface AbHalf { settle: number; timed: number }

/**
 * One interleaved --ab variant (`--ab-method frame`): `quads` ABBA quads (on off off on, then off on on off). Each half
 * switches the mode, emulates and renders `half.settle` untimed frames back to back (a switch re-uploads the instance
 * buffers the modes share, and the iGPU ramps its clock after the harness's idle waits: the settle frames take both),
 * then times `half.timed` frames back to back (gpuFrames: their median). Live: the snapshot `window.__abSnap` is
 * restored before a quad once FRAME_AB_WINDOW frames ran since the last restore, `keys` held throughout; the quads after
 * successive restores start with "on" and "off" in turn, so the half after a restore falls on each arm equally. Per quad the
 * delta is (on₁ + on₂ − off₁ − off₂) / 2: a quad spans well under a second, so the iGPU's clock and thermal drift
 * (several ms within seconds) cancel, and so do a linear trend and the half's place in the quad. Medians over the quads.
 * `aa`: both arms on (an A/A run: the method's noise floor).
 */
async function abVariantFrames(page: Page, quads: number, keys: string, feature: AbFeature, live: boolean, aa: boolean,
  half: AbHalf): Promise<AbVariant> {
  const k = JSON.stringify(keys);
  const on = live ? feature.live(true) : feature.preview!(true);
  const off = live ? feature.live(aa) : feature.preview!(aa);
  const script = `(async () => {
    const out = []; let moved = Infinity, frames = ${FRAME_AB_WINDOW}, p0 = null, w = -1, qw = 0;
    const pos = () => ${live ? PLAYER_POS : 'null'};
    for (let q = 0; q < ${quads}; q++) {
      // restores fall between quads; the quads after one start with "on" and "off" in turn (window w), so the half right
      // after a restore belongs to each arm equally often
      ${live ? `if (frames >= ${FRAME_AB_WINDOW}) {
        if (w >= 0) { const p1 = pos(); moved = Math.min(moved, p0 && p1 ? Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) : 0); }
        emu.gba.loadState(window.__abSnap); frames = 0; p0 = undefined; w++; qw = 0;
      }` : 'w = 0;'}
      for (const m of (qw++ + w) % 2 === 0 ? [1, 0, 0, 1] : [0, 1, 1, 0]) {
        if (m) { ${on}; } else { ${off}; }
        ${live ? `emu.step(${k}, ${half.settle})` : `preview.frames(${half.settle})`};
        ${live ? 'if (p0 === undefined) p0 = pos();' : ''}
        const g = await ${live ? `emu.gpuFrames(${half.timed}, ${k})` : `preview.gpuFrames(${half.timed})`};
        frames += ${half.settle + half.timed};
        out.push(m, g.gpuMs, g.cpuMs);
      }
    }
    return { out, moved };
  })()`;
  try {
    const r = await page.evaluate(script) as { out: number[]; moved: number | null };
    const on: number[][] = [[], []], off: number[][] = [[], []], dG: number[] = [], dC: number[] = [];
    for (let q = 0; q < quads; q++) {
      let g = 0, c = 0;
      for (let h = 0; h < 4; h++) {
        const [m, gpu, cpu] = r.out.slice((q * 4 + h) * 3, (q * 4 + h) * 3 + 3);
        (m ? on : off)[0].push(gpu);
        (m ? on : off)[1].push(cpu);
        g += m ? gpu : -gpu;
        c += m ? cpu : -cpu;
      }
      dG.push(g / 2);
      dC.push(c / 2);
    }
    const v: AbVariant = {
      gpuOn: round(median(on[0]), 3), gpuOff: round(median(off[0]), 3), dGpu: round(median(dG), 3),
      cpuOn: round(median(on[1]), 3), cpuOff: round(median(off[1]), 3), dCpu: round(median(dC), 3),
    };
    // (a window that never completed: no walking shown, Infinity → null over JSON)
    if (keys && live) v.moved = round(r.moved ?? 0, 1);
    return v;
  } finally {
    await page.evaluate(on);
  }
}

/** --ab on a live entry after its steps: idle and (with `walk`) walking variants; leaves the entry as found. */
async function abMeasure(page: Page, e: LiveEntry, rounds: number, feature: AbFeature, method: AbMethod, aa: boolean, half: AbHalf):
  Promise<NonNullable<EntryStats['ab']>> {
  await page.evaluate('window.__abSnap = emu.gba.saveState()');
  const run = (keys: string) => method === 'frame' ? abVariantFrames(page, rounds, keys, feature, true, aa, half)
    : abVariant(page, rounds, keys, feature, true, aa);
  try {
    const idle = await run('');
    const walk = e.walk ? await run(e.walk) : undefined;
    return { method, rounds, ...(method === 'frame' ? { half } : {}), idle, walk, ...(aa ? { aa } : {}) };
  } finally {
    await page.evaluate(`${feature.live(true)}; emu.gba.loadState(window.__abSnap)`);
  }
}

/** --ab on a static entry (a feature with a preview switch): idle only; leaves the feature on. */
async function abMeasureStatic(page: Page, rounds: number, feature: AbFeature, method: AbMethod, aa: boolean, half: AbHalf):
  Promise<NonNullable<EntryStats['ab']>> {
  try {
    const idle = method === 'frame' ? await abVariantFrames(page, rounds, '', feature, false, aa, half) : await abVariant(page, rounds, '', feature, false, aa);
    return { method, rounds, ...(method === 'frame' ? { half } : {}), idle, ...(aa ? { aa } : {}) };
  } finally {
    await page.evaluate(feature.preview!(true));
  }
}

const abText = (v: AbVariant) => `${v.dGpu >= 0 ? '+' : ''}${v.dGpu.toFixed(2)} gpu ${v.dCpu >= 0 ? '+' : ''}${v.dCpu.toFixed(3)} cpu`
  + (v.moved !== undefined ? ` (moved ${v.moved} px)` : '');

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, '..');
  const label = arg('label', '');
  if (!label) throw new Error('--label <name> is required');
  const styles = arg('styles', 'modern,retro').split(',').filter(Boolean);
  for (const s of styles) if (s !== 'modern' && s !== 'retro') throw new Error(`unknown style: ${s}`);
  const only = arg('only', '').split(',').filter(Boolean);
  const dpr = parseFloat(arg('dpr', '1'));
  const extra = arg('query', '');
  const compare = arg('compare', '');
  const gpu = flag('gpu');
  const expectSame = flag('expect-same');
  if (expectSame && !compare) throw new Error('--expect-same needs --compare <label>');
  const sameFailures: string[] = []; // --expect-same: controls that differ from the reference
  const selftest = flag('selftest');
  const ab = flag('ab');
  const abMethod = arg('ab-method', 'frame') as AbMethod;
  if (abMethod !== 'block' && abMethod !== 'frame') throw new Error(`unknown --ab-method ${abMethod} (block, frame)`);
  const abRounds = parseInt(arg('ab-rounds', abMethod === 'frame' ? '64' : '8'), 10);
  const abAa = flag('ab-aa');
  const abHalf: AbHalf = { settle: parseInt(arg('ab-settle', '4'), 10), timed: parseInt(arg('ab-timed', '4'), 10) };
  if (!(abHalf.settle >= 1 && abHalf.timed >= 1)) throw new Error('--ab-settle / --ab-timed must be positive integers');
  if (ab && !(abRounds >= 1)) throw new Error('--ab-rounds must be a positive integer');
  const abFeatureName = arg('ab-feature', 'actors');
  const abFeature = AB_FEATURES[abFeatureName];
  if (!abFeature) throw new Error(`unknown --ab-feature ${abFeatureName} (${Object.keys(AB_FEATURES).join(', ')})`);
  const abRows: string[] = [];
  const lumRows: { name: string; lum: ActorLum }[] = [];
  const dayActorFailures: string[] = []; // in-scope day interiors' actors outside DAY_ACTOR_BAND (or their median low)
  let dayGatedMeasured = 0;              // the in-scope day interiors with a reliable measure
  const nightRows: { name: string; n: NightLum }[] = [];
  const nightFailures: string[] = []; // in-scope night twins outside D8's bounds, or not measurable
  const shotThisRun = new Set<string>(); // the entry_style keys this run shot (and kept)
  const all = ALL_ENTRIES;
  for (const n of only) {
    if (!all.some((e) => e.name === n)) throw new Error(`unknown entry: ${n}`);
  }
  // (a misspelt name in the interior tables would drop an entry from --interiors or a pair from the night gate unseen;
  // the night twins are map previews: NIGHT_FN compares renderStill frames, with no mask-mismatch check as LUM_FN's)
  const known = (n: string, kind?: 'static') => all.some((e) => e.name === n && (!kind || e.kind === kind));
  for (const n of [...Object.keys(INTERIOR_LIVE), ...OUT_OF_SCOPE_INTERIOR, ...PHASE4_INTERIOR]) if (!known(n)) throw new Error(`unknown interior entry: ${n}`);
  for (const n of Object.entries(NIGHT_TWINS).flat()) if (!known(n, 'static')) throw new Error(`NIGHT_TWINS names no static entry: ${n}`);
  // --only picks entries of both kinds by name; otherwise --static picks every entry, --battles the battle entries,
  // --interiors the interior entries (both flags: either), and none of these every live entry. With Modern, a selected
  // night twin brings its twin (NIGHT_TWINS: the pair is measured within one run)
  const statics = flag('static'), battles = flag('battles'), interiors = flag('interiors');
  const picked = new Set((only.length ? all.filter((e) => only.includes(e.name))
    : all.filter((e) => statics || (battles || interiors ? (battles && isBattleEntry(e)) || (interiors && isInteriorEntry(e))
      : e.kind === 'live'))).map((e) => e.name));
  if (styles.includes('modern')) {
    for (const pair of Object.entries(NIGHT_TWINS)) if (pair.some((n) => picked.has(n))) pair.forEach((n) => picked.add(n));
  }
  const entries = all.filter((e) => picked.has(e.name));
  const outDir = path.join(root, 'out/regress-live', label);
  const refDir = compare ? path.join(root, 'out/regress-live', compare) : '';
  // (the same folder however spelled: ./p2, p2/, P2 on Windows' case-insensitive file system)
  const folder = (p: string) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
  if (refDir && folder(refDir) === folder(outDir)) {
    throw new Error('--compare must name another run than --label (it would diff a run against itself)');
  }
  if (refDir && !fs.existsSync(refDir)) throw new Error(`no reference run ${refDir}`);
  // --review: the battle review sheet; --review-before <label>: its "before" column (implies --review)
  const reviewBefore = arg('review-before', '');
  const review = flag('review') || !!reviewBefore;
  const beforeDir = reviewBefore ? path.join(root, 'out/regress-live', reviewBefore) : '';
  if (beforeDir && !fs.existsSync(beforeDir)) throw new Error(`no --review-before run ${beforeDir}`);
  fs.mkdirSync(outDir, { recursive: true });
  const statsFile = path.join(outDir, 'stats.json');
  const stats: Record<string, EntryStats> = fs.existsSync(statsFile) ? JSON.parse(fs.readFileSync(statsFile, 'utf8')) : {};

  // (no file watching, no HMR: the pages of one run all get the code as first served — agents working in the same checkout
  // save files mid-run, and a reload would destroy an entry's page under it)
  const server = await createServer({ root, server: { port: 5197, strictPort: false, watch: null, hmr: false }, logLevel: 'error' });
  await server.listen();
  const port = (server.httpServer!.address() as { port: number }).port;
  const browser = await puppeteer.launch({
    executablePath: CHROME.find((p) => fs.existsSync(p))!,
    headless: true,
    args: ['--ignore-gpu-blocklist', '--enable-gpu', '--use-angle=d3d11', '--autoplay-policy=no-user-gesture-required',
      '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows'],
    defaultViewport: { width: VIEW_W, height: VIEW_H, deviceScaleFactor: dpr },
  });
  const failures: string[] = [];
  const gbaDiffFailures: string[] = []; // GBA pictures whose diff against the reference failed (nothing is removed)
  const errored: string[] = []; // entries that logged page errors
  const missingRefs: string[] = [];
  const selftestFailures: string[] = [];
  const walkFailures: string[] = []; // crossing and scene-change gates
  const puzzleFailures: string[] = []; // puzzle gates (PuzzleGate 'gate')
  const editSteps = new Map<string, ReturnType<typeof resolveEdits>>(); // static edit entries' resolved steps (both styles)
  const gbaShots = new Set<string>(); // entries whose GBA picture (gba_ / ref_<entry>.png) this run wrote
  let pageErrors = 0;
  const diffs: string[] = [];
  try {
    // one tab only: a second one would hide this one (no rAF, no presented canvas frames)
    const page = await browser.newPage();
    let current = '';
    page.on('pageerror', (e) => { pageErrors++; console.log(`[${current} page error] ${(e as Error).message}`); });
    page.on('console', (m) => {
      if (m.location().url?.endsWith('/favicon.ico')) return;
      if (m.type() === 'error') pageErrors++;
      if (m.type() === 'error' || m.type() === 'warn') console.log(`[${current} page ${m.type()}] ${m.text()}`);
    });
    let gpuName = '';
    for (const e of entries) {
      for (const style of styles) {
        const key = `${e.name}_${style}`;
        current = key;
        const errorsBefore = pageErrors;
        try {
          // live entries drive the game page (window.emu), static ones the map or battle preview (window.preview)
          const api = e.kind === 'live' ? 'emu' : 'preview';
          let q: string;
          if (e.kind === 'live') {
            if (!fs.existsSync(path.join(root, e.state))) throw new Error(`missing save state ${e.state}`);
            q = ['manual=1', `state=/${e.state}`, `style=${style}`, e.query, extra].filter(Boolean).join('&');
          } else if (isStaticBattle(e)) {
            q = ['manual=1', e.q, `style=${style}`, extra].filter(Boolean).join('&');
          } else {
            q = ['autostart=1', 'manual=1', 'actors=1', e.q, `style=${style}`, extra].filter(Boolean).join('&');
          }
          // (the run's first pages wait for Vite's cold transform of the whole renderer: past puppeteer's default 30 s on
          // the dev machine at times, as the ready wait below allows)
          await page.goto(`http://localhost:${port}/?${q}`, { waitUntil: 'load', timeout: 120_000 });
          await page.waitForFunction(e.kind === 'live' ? '!!(window.emu && window.emu.step)' : '!!(window.preview && window.preview.frames)',
            { timeout: 120_000, polling: 100 });
          if (!gpuName) {
            gpuName = await page.evaluate(`(() => {
              const gl = ${e.kind === 'live' ? 'emu.renderer.webgl' : 'preview.webgl'}.getContext();
              const dbg = gl.getExtension('WEBGL_debug_renderer_info');
              return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
            })()`) as string;
            console.log(`GPU: ${gpuName}`);
          }
          let stepMsMax: number | undefined;
          // (crossing and scene-change entries: their walk's stats; puzzle walks and edit entries: their changes)
          let walked: CrossingStats | undefined;
          let puzzled: PuzzleStats | undefined;
          const selfTests = selftest && e.selftest === true && style === 'modern';
          let mid: { result: SelfTest; ok: boolean; text: string } | undefined;
          if (e.kind === 'live') {
            const after = e.selftestAfter;
            if (selfTests && after !== undefined && !(Number.isInteger(after) && after >= 0 && after < e.steps.length)) {
              throw new Error(`selftestAfter ${after} names no step (${e.steps.length} steps)`);
            }
            const walkKind = walkOf(e);
            if (e.crossings && e.sceneChange) throw new Error('an entry walks across maps (crossings) or between scenes (sceneChange), not both');
            if (walkKind && (e.steps.length < 2 || e.steps[0][1] < 30 || e.steps[0][0] !== '' || e.steps[0][2])) {
              throw new Error(`a ${walkKind} entry starts with an idle settle of ≥ 30 frames, then walks`);
            }
            if (e.eval) await page.evaluate(e.eval);
            // (a scene change's programs count from right after its eval: the settle's frames included, see SCENE_CHANGE_MS)
            const evaluated = e.sceneChange && e.eval ? await page.evaluate('emu.renderer.stats()') as WalkPoint : undefined;
            // the entry's first frame builds the world and compiles programs (seconds, varying with
            // Chrome's program cache): stepMsMax is the largest frame time after it
            stepMsMax = 0;
            // (a walk: the renderer's stats after the settle, and the walk's frames with the session's builds after each)
            let settled: WalkPoint | undefined;
            const walk: number[] = [], walkBuilds: (number | undefined)[] = [], walkPoints: WalkPoint[] = [];
            const walkDiffs: [number, number][] = [];
            for (const [n, [keys, frames, before]] of e.steps.entries()) {
              if (before) await page.evaluate(before);
              const { ms: times, builds, points, diffs } = walkKind
                ? await page.evaluate(drainedStep(keys, frames, walkKind === 'puzzle')) as
                  { ms: number[]; builds: (number | undefined)[]; points: WalkPoint[]; diffs: [number, number][] }
                : { ms: await page.evaluate(`emu.step(${JSON.stringify(keys)}, ${frames})`) as number[], builds: [], points: [], diffs: [] };
              for (const t of n === 0 ? times.slice(1) : times) stepMsMax = Math.max(stepMsMax, t);
              if (selfTests && e.selftestAfter === n) mid = await selfTestPoint(page, api, outDir, `${e.name}_mid`);
              if (walkKind && n === 0) {
                settled = await page.evaluate('emu.renderer.stats()') as WalkPoint;
                if (walkKind === 'puzzle') await page.evaluate('window.__pzGrid = emu.renderer.state.readBackupGrid()');
              }
              if (n > 0) {
                walk.push(...times);
                walkBuilds.push(...builds);
                walkPoints.push(...points);
                walkDiffs.push(...diffs);
              }
            }
            const endPoint = walkKind ? await page.evaluate('emu.renderer.stats()') as WalkPoint : undefined;
            if (walkKind === 'puzzle') {
              // each frame whose sync saw a grid change (gridChanges went up): its ms, the build or patch it made
              // (the emulated grid's changes since the last change taken: a deferred sync takes them later)
              const settle = e.steps[0][1], changes: PuzzleChange[] = [], quiet: number[] = [];
              let prev = settled!, cells = 0, collision = 0;
              walkPoints.forEach((p, i) => {
                cells += walkDiffs[i]?.[0] ?? 0;
                collision += walkDiffs[i]?.[1] ?? 0;
                const grid = (p.gridChanges ?? 0) - (prev.gridChanges ?? 0);
                if (grid > 0) {
                  const builds = (p.builds ?? 0) - (prev.builds ?? 0);
                  const patches = p.patches !== undefined ? p.patches - (prev.patches ?? 0) : null;
                  changes.push({ at: settle + i + 1, frameMs: round(walk[i], 2), builds, patches,
                    buildMs: builds > 0 && p.lastBuildMs !== undefined ? round(p.lastBuildMs, 2) : null,
                    patchMs: patches && p.lastPatchMs !== undefined ? round(p.lastPatchMs, 3) : null, cells, collision });
                  cells = collision = 0;
                } else quiet.push(walk[i]);
                prev = p;
              });
              puzzled = puzzleStats(e.puzzle!, style, settle, walk.length, quiet, changes, settled!, endPoint!);
            } else if (walkKind) {
              walked = walkStats(walk, walkBuilds, e.steps[0][1], settled!, endPoint!, evaluated);
            }
            // the GBA's own frame of a battle entry (the review's reference column)
            if (isBattleEntry(e)) {
              const png = await page.evaluate('emu.gbaPng()') as string;
              fs.writeFileSync(path.join(outDir, `${gbaName(e)}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
              gbaShots.add(e.name);
            }
          } else {
            // a focus naming no template would frame the map centre instead: never a baseline
            const focusError = await page.evaluate('preview.focusError') as string | null;
            if (focusError) throw new Error(`preview: ${focusError}`);
            if (e.edits) {
              // EDIT_SETTLE frames, then each step's setCells and frames, every frame drained and timed
              const steps = editSteps.get(e.name) ?? resolveEdits(root, e);
              editSteps.set(e.name, steps);
              const r = await page.evaluate(staticPuzzleScript(steps)) as StaticPuzzleRun;
              const changes: PuzzleChange[] = r.out.map((o, k) => {
                const builds = (o.after.builds ?? 0) - (o.before.builds ?? 0);
                const patches = o.after.patches !== undefined ? o.after.patches - (o.before.patches ?? 0) : null;
                const grid = (o.after.gridChanges ?? 0) - (o.before.gridChanges ?? 0);
                if (grid !== 1) throw new Error(`edit step ${k + 1}: setCells took ${grid} grid changes (1 expected)`);
                return { at: k + 1, frameMs: round(o.setMs + o.first, 2), builds, patches,
                  buildMs: builds > 0 && o.after.lastBuildMs !== undefined ? round(o.after.lastBuildMs, 2) : null,
                  firstFrameMs: round(o.first, 2), patchMs: patches && o.after.lastPatchMs !== undefined ? round(o.after.lastPatchMs, 3) : null,
                  cells: steps[k].cells, collision: steps[k].collision, result: o.result };
              });
              puzzled = puzzleStats(e.puzzle ?? RECORD, style, EDIT_SETTLE, r.quiet.length + r.out.length, r.quiet, changes, r.settled, r.end);
            } else {
              await page.evaluate(`preview.frames(${isStaticBattle(e) ? BATTLE_FRAMES : 60})`);
            }
            // the GBA's own picture of a battle preview's hardware (the review's reference column)
            if (isStaticBattle(e)) {
              const png = await page.evaluate('preview.referencePng()') as string;
              fs.writeFileSync(path.join(outDir, `${gbaName(e)}.png`), Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
              gbaShots.add(e.name);
            }
          }
          // the page chrome's CSS transitions (the loader fading out) run on the wall clock: end them
          await page.evaluate(`document.getAnimations().forEach((a) => { try { a.finish(); } catch { /* infinite */ } })`);
          const file = path.join(outDir, `${key}.png`);
          await page.screenshot({ path: file as `${string}.png` });
          const s = await page.evaluate(e.kind === 'live' ? 'emu.renderer.stats()' : 'preview.stats()') as
            { calls: number; triangles: number; programs: number; buildMs?: number };
          const entry: EntryStats = { ...s };
          if (stepMsMax !== undefined) entry.stepMsMax = round(stepMsMax, 2);
          let walkLine = '';
          if (walked && e.kind === 'live') {
            if (e.crossings) entry.crossing = walked;
            else entry.sceneChange = walked;
            const r = walkReport(e, walked);
            walkLine = r.line;
            if (r.broken.length) walkFailures.push(`${key} (${r.broken.join('; ')})`);
          }
          if (puzzled) {
            entry.puzzle = puzzled;
            walkLine += puzzleLine(puzzled);
            if (puzzled.broken) puzzleFailures.push(`${key} (${puzzled.broken.join('; ')})`);
          }
          // the actor mask of this frame: drawn again without advancing time, actors flat magenta
          // (live: both views' actors — a battle entry's battlers too)
          const [maskOn, maskOff] = e.kind === 'live'
            ? ['emu.renderer.setActorMask(true); emu.renderer.setFixedTimestep(0); emu.renderer.render(0)',
              'emu.renderer.setActorMask(false); emu.renderer.render(0); emu.renderer.setFixedTimestep(1 / 60)']
            : ['preview.setActorMask(true); preview.renderStill()', 'preview.setActorMask(false); preview.renderStill()'];
          await page.evaluate(maskOn);
          await page.screenshot({ path: path.join(outDir, `_mask_${key}.png`) as `${string}.png` });
          await page.evaluate(maskOff);
          // (the self-test checks the screenshot's frame, after the steps; GPU timing then renders 60 more frames)
          let selfLine = '';
          if (mid) {
            entry.selftestMid = mid.result;
            if (!mid.ok) selftestFailures.push(`${key} (after step ${e.kind === 'live' ? e.selftestAfter : '?'})`);
            selfLine += ` | mid-walk ${mid.text}`;
          }
          if (selfTests) {
            const t = await selfTestPoint(page, api, outDir, e.name);
            entry.selftest = t.result;
            if (!t.ok) selftestFailures.push(key);
            selfLine += ` | ${t.text}`;
            // (an entry without a mid point now: no older run's mid-walk dump may stand for it)
            if (!mid) fs.rmSync(path.join(outDir, `_field_${e.name}_mid.png`), { force: true });
          }
          if (gpu) {
            const g = await page.evaluate(`${api}.gpuFrames(60)`) as { gpuMs: number; gpuP90: number; cpuMs: number };
            entry.gpuMs = round(g.gpuMs, 3);
            entry.gpuP90 = round(g.gpuP90, 3);
            entry.cpuMs = round(g.cpuMs, 3);
          }
          // (an entry that equals another one: measured there)
          if (ab && style === 'modern' && !(e.kind === 'live' && e.sameAs) && (e.kind === 'live' || (abFeature.preview && (abFeature.previewWhen?.(e) ?? true)))) {
            const r = entry.ab = e.kind === 'live' ? await abMeasure(page, e, abRounds, abFeature, abMethod, abAa, abHalf)
              : await abMeasureStatic(page, abRounds, abFeature, abMethod, abAa, abHalf);
            const cell = (v?: AbVariant) => (v ? `${v.dGpu >= 0 ? '+' : ''}${v.dGpu.toFixed(2)}${v.dGpu > abFeature.gpuMs ? ' OVER' : ''} | `
              + `${v.dCpu >= 0 ? '+' : ''}${v.dCpu.toFixed(3)}${v.dCpu > abFeature.cpuMs ? ' OVER' : ''}` : '- | -');
            abRows.push(`| ${e.name} | ${r.idle.gpuOn.toFixed(2)} / ${r.idle.gpuOff.toFixed(2)} | ${cell(r.idle)} | `
              + `${r.walk ? `${r.walk.gpuOn.toFixed(2)} / ${r.walk.gpuOff.toFixed(2)}` : '-'} | ${cell(r.walk)} | ${r.walk?.moved ?? '-'} |`);
          }
          let line = `shot ${key.padEnd(24)} calls ${String(s.calls).padStart(4)} tris ${String(s.triangles).padStart(8)} programs ${s.programs}`;
          line += stepMsMax !== undefined ? ` stepMax ${entry.stepMsMax} ms` : ` build ${s.buildMs} ms`;
          if (gpu) line += ` | gpu ${entry.gpuMs} p90 ${entry.gpuP90} cpu ${entry.cpuMs} ms`;
          if (entry.ab) line += ` | ab idle ${abText(entry.ab.idle)}${entry.ab.walk ? `, walk ${abText(entry.ab.walk)}` : ''}`;
          line += selfLine + walkLine;
          // (diffs load the images into the page: after everything else of the entry)
          const sameAs = e.kind === 'live' ? e.sameAs : undefined;
          if (sameAs) {
            const plain = path.join(outDir, `${sameAs}_${style}.png`);
            if (!fs.existsSync(plain)) throw new Error(`no ${sameAs}_${style}.png in this run's folder to equal (run ${sameAs} first)`);
            const d = await diffPng(page, file, plain);
            const b = d.bbox ? `${d.bbox.x},${d.bbox.y} ${d.bbox.w}x${d.bbox.h}` : '-';
            // (pixels -1: the sizes differ — never the same)
            if (d.pixels !== 0) throw new Error(`differs from ${sameAs}_${style}: ${d.pixels} px (${d.pct.toFixed(2)} %), bbox ${b}`);
            line += ` | = ${sameAs} (0 px)`;
            if (e.kind === 'live' && e.samePrograms) {
              const want = stats[`${sameAs}_${style}`]?.programs;
              if (want === undefined) throw new Error(`no ${sameAs}_${style} stats in this run to compare programs with (run ${sameAs} first)`);
              if (s.programs !== want) throw new Error(`ends with ${s.programs} programs, ${sameAs}_${style} with ${want}: the switches compiled ${s.programs - want}`);
              line += `, programs ${s.programs} = ${sameAs}'s`;
            }
          }
          if (refDir) {
            const ref = path.join(refDir, `${sameAs ?? e.name}_${style}.png`);
            if (fs.existsSync(ref)) {
              const d = await diffPng(page, file, ref);
              entry.diff = d;
              const b = d.bbox ? `${d.bbox.x},${d.bbox.y} ${d.bbox.w}x${d.bbox.h}` : '-';
              diffs.push(`diff ${key.padEnd(24)} ${d.pct.toFixed(2).padStart(6)} %  ${String(d.pixels).padStart(8)} px  bbox ${b}`);
              line += ` | diff ${d.pct.toFixed(2)} % (${d.pixels} px)`;
              if (expectSame && isSameControl(e, style) && d.pixels !== 0) sameFailures.push(`${key} (${d.pixels} px, bbox ${b})`);
            } else {
              missingRefs.push(key);
              diffs.push(`diff ${key.padEnd(24)} no reference in ${compare}`);
            }
          }
          stats[key] = entry;
          shotThisRun.add(key);
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
          console.log(line);
        } catch (err) {
          failures.push(key);
          console.log(`[${key}] FAILED: ${(err as Error).message}`);
          // no stale shot or stats of an earlier run of this label may stand in for the failed entry
          fs.rmSync(path.join(outDir, `${key}.png`), { force: true });
          fs.rmSync(path.join(outDir, `_mask_${key}.png`), { force: true });
          if (style === 'modern') {
            for (const d of [e.name, `${e.name}_mid`]) fs.rmSync(path.join(outDir, `_field_${d}.png`), { force: true });
          }
          // (a GBA picture this run wrote after the entry's steps stays: it does not depend on the style)
          if (!gbaShots.has(e.name)) fs.rmSync(path.join(outDir, `${gbaName(e)}.png`), { force: true });
          delete stats[key];
          fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
        }
        if (pageErrors > errorsBefore) errored.push(key);
      }
      // --compare: the entry's GBA picture (one per battle entry) against the reference run's too (the review's GBA column);
      // an entry with `sameAs` emulates that entry's frames: against its reference
      if (refDir && gbaShots.has(e.name)) {
        const name = gbaName(e);
        const ref = path.join(refDir, `${e.kind === 'live' && e.sameAs ? gbaName({ ...e, name: e.sameAs }) : name}.png`);
        current = name;
        const errorsBefore = pageErrors;
        if (fs.existsSync(ref)) {
          try {
            const d = await diffPng(page, path.join(outDir, `${name}.png`), ref);
            const b = d.bbox ? `${d.bbox.x},${d.bbox.y} ${d.bbox.w}x${d.bbox.h}` : '-';
            diffs.push(`diff ${name.padEnd(24)} ${d.pct.toFixed(2).padStart(6)} %  ${String(d.pixels).padStart(8)} px  bbox ${b}`);
            console.log(`gba  ${name.padEnd(24)} diff ${d.pct.toFixed(2)} % (${d.pixels} px)`);
            // (the GBA's own picture does not depend on the renderer: always a control)
            if (expectSame && d.pixels !== 0) sameFailures.push(`${name} (${d.pixels} px, bbox ${b})`);
          } catch (err) {
            gbaDiffFailures.push(name);
            console.log(`[${name}] FAILED: ${(err as Error).message}`);
          }
        } else {
          missingRefs.push(name);
          diffs.push(`diff ${name.padEnd(24)} no reference in ${compare}`);
        }
        if (pageErrors > errorsBefore) errored.push(name);
      }
    }
    if (styles.includes('modern') && styles.includes('retro')) {
      current = 'luminance';
      for (const e of entries) {
        const st = stats[`${e.name}_modern`];
        const files = [`${e.name}_modern.png`, `${e.name}_retro.png`, `_mask_${e.name}_modern.png`, `_mask_${e.name}_retro.png`]
          .map((f) => path.join(outDir, f)) as [string, string, string, string];
        if (!st || !stats[`${e.name}_retro`] || !files.every((f) => fs.existsSync(f))) continue;
        const lum = await actorLum(page, files);
        if (lum) st.actorLum = lum;
        else delete st.actorLum;
        if (lum) lumRows.push({ name: e.name, lum });
      }
      fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    }
    // D8's night twins: every pair of the run (the selection added each selected entry's twin), measured from both Modern
    // shots of this run only (no older run's shot may stand in for one). A gated pair that cannot be measured (an entry of
    // it failed) fails the gate; an out-of-scope one is skipped
    if (styles.includes('modern')) {
      current = 'night twins';
      for (const [night, day] of Object.entries(NIGHT_TWINS)) {
        if (!entries.some((e) => e.name === night || e.name === day)) continue;
        const st = stats[`${night}_modern`];
        const files = [`${night}_modern.png`, `${day}_modern.png`, `_mask_${night}_modern.png`, `_mask_${day}_modern.png`]
          .map((f) => path.join(outDir, f)) as [string, string, string, string];
        if (!shotThisRun.has(`${night}_modern`) || !shotThisRun.has(`${day}_modern`) || !files.every((f) => fs.existsSync(f))) {
          if (st) delete st.nightLum;
          if (nightGated(night)) nightFailures.push(`${night} (no Modern shot of it and of ${day} in this run to compare)`);
          continue;
        }
        const n = st.nightLum = await nightLum(page, night, day, files);
        nightRows.push({ name: night, n });
        if (n.broken) nightFailures.push(`${night} (${n.broken.join('; ')})`);
      }
      fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2));
    }
    current = 'sheets';
    await buildSheets(page, outDir);
    if (review) await buildReview(page, outDir, entries, beforeDir, reviewBefore);
  } finally {
    await browser.close();
    await server.close();
  }
  if (diffs.length) console.log(`\ncompare ${label} vs ${compare}:\n${diffs.join('\n')}`);
  if (lumRows.length) {
    console.log('\nactor luminance, Modern / Retro (mean sRGB luma over the actor pixels visible in both styles):');
    console.log(`| entry | ratio | modern | retro | px | mask mismatch (UNRELIABLE > ${(MASK_MISMATCH_MAX * 100).toFixed(1)} %) |`);
    console.log('|---|---|---|---|---|---|');
    for (const { name, lum } of lumRows) {
      console.log(`| ${name} | ${lum.ratio.toFixed(3)} | ${lum.modern} | ${lum.retro} | ${lum.pixels} | `
        + `${(lum.maskMismatch * 100).toFixed(3)} %${lum.unreliable ? ' UNRELIABLE' : ''} |`);
    }
    // (summary over the reliable entries: an unreliable mask does not show the shot's actors)
    const ok = lumRows.filter((x) => !x.lum.unreliable);
    if (ok.length) {
      const r = ok.map((x) => x.lum.ratio);
      const min = ok.reduce((a, b) => (b.lum.ratio < a.lum.ratio ? b : a));
      console.log(`median ${median(r).toFixed(3)}, min ${min.lum.ratio.toFixed(3)} (${min.name}), max ${Math.max(...r).toFixed(3)}`
        + (ok.length < lumRows.length ? ` (${lumRows.length - ok.length} unreliable left out)` : ''));
    }
    // the in-scope day interiors' gate (dayActorGated): each reliable measure within the band, their median ≥ the floor
    const gated = ok.filter((x) => { const e = entries.find((y) => y.name === x.name); return !!e && dayActorGated(e); });
    const unmeasured = entries.filter((e) => dayActorGated(e) && !gated.some((x) => x.name === e.name)).map((e) => e.name);
    for (const x of gated) {
      if (!(x.lum.ratio >= DAY_ACTOR_BAND[0] && x.lum.ratio <= DAY_ACTOR_BAND[1])) dayActorFailures.push(`${x.name} ${x.lum.ratio.toFixed(3)}`);
    }
    dayGatedMeasured = gated.length;
    if (gated.length) {
      const m = median(gated.map((x) => x.lum.ratio));
      if (m < DAY_ACTOR_MEDIAN_MIN) dayActorFailures.push(`median ${m.toFixed(3)} < ${DAY_ACTOR_MEDIAN_MIN}`);
      console.log(`in-scope day interiors (gated: ${DAY_ACTOR_BAND.join('-')}, median ≥ ${DAY_ACTOR_MEDIAN_MIN}): ${gated.length} entries, `
        + `median ${m.toFixed(3)}, ${Math.min(...gated.map((x) => x.lum.ratio)).toFixed(3)}-${Math.max(...gated.map((x) => x.lum.ratio)).toFixed(3)}`
        + (unmeasured.length ? `; not measured (not gated): ${unmeasured.join(', ')}` : ''));
    }
  }
  // (never a vacuous pass: in-scope day interiors ran in both styles, yet not one gave a reliable measure)
  const dayGatedRun = styles.includes('modern') && styles.includes('retro') ? entries.filter(dayActorGated).map((e) => e.name) : [];
  if (dayGatedRun.length && !dayGatedMeasured) dayActorFailures.push(`no reliable measure of any of ${dayGatedRun.join(', ')}`);
  if (nightRows.length) {
    console.log(`\nnight twins, Modern night / day (mean sRGB luma; gated in scope: room ${NIGHT_ROOM_BAND.join('-')} at night, ${DUSK_ROOM_BAND.join('-')} at dusk, actors ${NIGHT_ACTOR_BAND.join('-')}):`);
    console.log('| night | day | roomLuma | room night / day | actorLum | actor night / day | actor px | gate |');
    console.log('|---|---|---|---|---|---|---|---|');
    for (const { name, n } of nightRows) {
      console.log(`| ${name} | ${n.day} | ${n.roomLuma.toFixed(3)} | ${n.room.join(' / ')} | ${n.actorLum?.toFixed(3) ?? '-'} | `
        + `${n.actor?.join(' / ') ?? '-'} | ${n.actorPx} | ${!n.gated ? (OUT_OF_SCOPE_INTERIOR.has(name) ? 'out of scope' : 'not gated (Phase 4b looks pending)') : n.broken ? `FAILED: ${n.broken.join('; ')}` : 'passed'} |`);
    }
  }
  if (abRows.length) {
    const how = abMethod === 'frame' ? `${abRounds} ABBA quads (per half ${abHalf.settle} settle + ${abHalf.timed} timed frames)`
      : `${abRounds} paired rounds of 60-frame blocks`;
    console.log(`\n--ab${abAa ? ' (A/A: both arms on, the noise floor)' : ''}: ${abFeature.what}, ${how}, medians (ms); OVER = Δgpu > +${abFeature.gpuMs} or Δcpu > +${abFeature.cpuMs}`);
    console.log('| entry | idle gpu on / off | idle Δgpu | idle Δcpu | walk gpu on / off | walk Δgpu | walk Δcpu | walk moved px |');
    console.log('|---|---|---|---|---|---|---|---|');
    console.log(abRows.join('\n'));
  }
  // any of these makes the run unusable as a gate: exit non-zero
  if (pageErrors) console.log(`${pageErrors} page error(s) in: ${errored.join(', ') || 'sheets'}`);
  if (missingRefs.length) console.log(`no reference shot in ${compare} for: ${missingRefs.join(', ')}`);
  if (failures.length) console.log(`failed (shot and stats removed): ${failures.join(', ')}`);
  if (gbaDiffFailures.length) console.log(`GBA picture diff failed (the pictures and stats stay): ${gbaDiffFailures.join(', ')}`);
  if (selftestFailures.length) {
    console.log(`self-test failed (no slots, field parity > max(0.02, 0.003·inflateMax) px, xbr > ${XBR_TOL.toFixed(4)} or baked xbr `
      + `> ${XBR_BAKED_VS_LIVE} bytes off the live one) in: ${selftestFailures.join(', ')}`);
  }
  if (walkFailures.length) console.log(`crossing / scene-change gates failed in: ${walkFailures.join(', ')}`);
  if (puzzleFailures.length) console.log(`puzzle gates failed in: ${puzzleFailures.join(', ')}`);
  if (nightFailures.length) console.log(`night-twin gates (D8) failed in: ${nightFailures.join(', ')}`);
  if (dayActorFailures.length) console.log(`day actor-luminance gate (in-scope interiors vs Retro) failed: ${dayActorFailures.join(', ')}`);
  if (sameFailures.length) console.log(`--expect-same: controls that differ from ${compare}: ${sameFailures.join(', ')}`);
  if (pageErrors || missingRefs.length || failures.length || gbaDiffFailures.length || selftestFailures.length || walkFailures.length
    || puzzleFailures.length
    || nightFailures.length || dayActorFailures.length || sameFailures.length) {
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
