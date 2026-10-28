# Emerald 3D — working notes for Claude

Pokémon Emerald running unmodified in a custom GBA emulator (`src/gba`), with a Three.js renderer
(`src/render`) that rebuilds the world in 3D from live emulated state. See `README.md`.

## Active work (read this first after a context reset)
- **Project:** Modern stylized 3D models (replace pixel-textured boxes/cards with real models).
- **All four phases are done** — 1 (outdoor environment), 2 (characters, Pokémon, field objects), 3 (battles),
  4 (interiors: 137 in-scope rooms, light follows the clock) — merged to `main`; results, numbers and known gaps in
  the progress log; full rulings in `phase{1,2,3,4}-sdd-ledger.md`. Hitch fix and the battle-feet fix are merged too.
- **PAUSED 2026-10-28** at the user's request (another project needed capacity). Nothing is running. Resume from the
  "Phase 4b status" section of the progress log (its "Resume here" list) and the end of the SDD ledger. Ask the user
  before resuming.
- **Phase 4b — gyms, League/E4/Hall of Fame, town special rooms, Trick House — in progress (tasks 1–6, 13 done)** on branch
  `phase4b-special-interiors`, plan `docs/superpowers/plans/2026-10-28-phase4b-special-interiors.md` (user-approved:
  gym puzzles modern but GBA-exact; Retro also gets the incremental cell-change update; REAL raised platforms; a fixture
  tool may write the warp destination in RAM). SDD ledger `.superpowers/sdd/2026-10-28-phase4b-special-interiors/progress.md`;
  baseline `p4b-base`. Later: Phase 4c (Frontier, contests, S.S. Tidal, facility rooms, secret bases), terrain solver v2,
  a look-polish pass, interior perf. Write the plan first (`docs/superpowers/plans/`), then execute
  subagent-driven (only `opus` subagents work here; the user wants parallel agents where files don't overlap). Show
  the user a phase progress bar in every update (they write Norwegian; reply in Norwegian). Merge + push to `origin`
  (private account) without asking.
- **Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`
- **Progress log (source of truth for where we are):** `docs/superpowers/progress/modern-3d.md`
  — update it after every completed task / milestone, and before long-running steps.
- Plans live in `docs/superpowers/plans/` (one per phase).

## Commands
- `npm test` — unit tests (no ROM needed)
- `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/<file>` — ROM-driven smoke tests
- `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/golden.test.ts tests/smoke/semantics.test.ts`
  — the renderer smoke set: golden pins legacy `classify()` output per regression map; semantics pins what
  the model families find on real maps and writes `out/coverage.txt` / `out/coverage-all.txt` (legacy share)
- `npx tsc --noEmit` — typecheck
- `npm run regress -- --label x [--style retro] [--only littleroot,oldale] [--hours 11,21]` — visual regression:
  16 maps → `out/regress/x/` (PNGs, `_sheet_h11.png` / `_sheet_h21.png` contact sheets, `stats.json`
  calls/triangles/buildMs, plus rebuildMs/firstFrameMs = a map crossing's cost); compare against `out/regress/before` (pre-Phase-1 baseline) or `phase1`
- `npm run regress:live -- --label x --static --gpu --selftest --compare p4-base` — deterministic live visual
  regression (`tools/regress-live.ts`, header documents every flag): save states replayed in manual mode (`?manual=1`: no
  frame loop, fixed RTC and clock; `emu.step(keys, frames)` emulates + renders and returns each frame's renderer CPU ms,
  `emu.gpuFrames(n, keys)` times frames with GPU timer queries) plus, with `--static`, map previews with their object
  events (`?map=G.N&actors=1`); both styles → `out/regress-live/x/` (PNGs, `_sheet_*`, `_crops.png`, `stats.json`:
  calls/triangles/programs, stepMsMax, gpuMs/cpuMs with `--gpu`, actorLum Modern/Retro). `--compare p4-base` diffs against the pre-Phase-4
  baseline (the current gate: Retro must stay 0.00 %; `p3-base` = pre-Phase-3). `p2-base` (pre-Phase-2) lacks every entry added later (`b_*`,
  `battle_grass`/`enter`/`exit`/…, `gba_`/`ref_`), and a missing reference fails the run: compare against it only with
  `--only` of the pre-Phase-3 entries (there only `lr_truck`/`littleroot_npcs` differ: the composed truck).
  `--selftest`: GPU inflation field + xBR vs CPU references. `--ab`: same-session cost of the Phase 2 actors vs flat
  cards (frame-interleaved; `--ab-aa` = noise floor, `--ab-feature npcfade`); budgets are judged this way, never
  against stored gpuMs (the Intel iGPU drifts 6–14 ms between sessions). Also `--only a,b`, `--styles modern`,
  `--query quality=high`, `--query actorUniforms=0` (inflated actors' attribute fallback, see inflatedActors.ts), `--dpr 2`
- `npm run regress:live -- --label x --battles [--review --review-before <label>]` — battle entries only (live
  `battle*` + static `b_*`, one preview per arena kind; with `--static` every entry), each with the GBA's picture
  (`gba_`/`ref_<entry>.png`, diffed by `--compare`); `--review` → `_review_battle.png` (GBA | before | Modern | Retro
  per entry). Phase 3 gate: `--static --compare p3-base` → Retro 0.00 % everywhere, Modern overworld + `transition`
  0.00 %. Battle A/B: `--ab --only <battle entries> --ab-feature battle|battlers` — `battle` = Modern vs Retro battle
  (≤ +3.0 ms GPU / +0.5 ms CPU), `battlers` = inflated vs cards (≤ +1.0 / +0.5); judged by same-session A/B only
- `npm run regress:live -- --label x --interiors [--review --review-before p4-base]` — interior entries only: the static
  room previews `i_*` (`STATIC_INTERIOR`: every in-scope room kind, `i_pc_yaw`/`i_house_back` orbits, `i_house_low`,
  night `*_night` + dusk `*_dusk`, `i_pc_nurse` (&focus), `i_house_fail` (`&kitFail=furniture`), out-of-scope controls
  `i_gym`/`i_gym_night`/`i_secret`/`i_dept_roof`) + the indoor live entries (`INTERIOR_LIVE`: `vigoroth`,
  `vigoroth_switch` (style toggle, samePrograms), `vigoroth_v` (V and back), `item_indoor`, `truck_inside`, the door walks
  `door_enter`/`door_exit`, crossing-gated); `--review` → `_review_interior.png` (GBA map from `out/atlas/` | before |
  Modern | Retro). Gated: `NIGHT_TWINS` (`nightLum`: night/dusk vs its day twin — room 0.45–0.8 at night, 0.7–0.95 at dusk (two-sided: D8 switched off fails), actors 0.9–1.15) and the
  in-scope day rooms' actorLum vs Retro (0.9–1.15, median ≥ 0.95). Phase 4 gate: `--static --compare p4-base` → Retro
  0.00 % everywhere, Modern 0.00 % except the in-scope interior entries and the in-scope live entries (`item_indoor`,
  `vigoroth`, `vigoroth_v`, `door_enter`). Fitting: `tests/smoke/interiorFitting.test.ts` (furniture over walkable cells
  ≤ 0.45, none over free floor, 137 maps). Interior A/B: `--ab --only <entries> --ab-feature interior` (kit on vs today's interior, light included; ≤ +2.0 ms GPU / +0.5 ms CPU, the Phase 4 ruling). Scope: 137 maps
  (`interiorScope(opts, mapKey)`, fails closed without a map key; `OUT_OF_SCOPE_MAPS` = the rooftop 13.21). Preview
  `&kitFail=<family>` (shell / floor / furniture) makes one family fail (its cells legacy, one warning); page API
  `preview.setInteriorKit(on)`, `preview.measureRebuild()` (warm rebuild ≤ 40 ms, + first frame ≤ 100 ms)
- Battle preview `/?battle=<kind>&player=<species>&enemy=<species>` (kinds = `ARENA_KINDS`; internal species ids;
  `&double=1&player2=&enemy2=`, `&hour=`, `&style=`, `&quality=`, `&yaw=`, `&spriteFilter=`, `&actorUniforms=`,
  `&arenaFail=<part>`, `&manual=1`; header of `src/render/battlePreview.ts`). Page API: `preview.measureArenaBuild()`
  (warm median, ≤ 60 ms), `preview.setStyle()`, `selfTest()`, `referencePng()`. shot3d: `--query "battle=gym&…"`
- `npx tsx tools/shot3d.ts --query "map=0.9&hour=11" --name x` — screenshot a static map preview → `out/3d/x_0.png`
  (`&actors=1` adds the map's object events, `&focusGfx=<id>` / `&focusObj=<n>` aims at one, `&focus=1` puts a
  stand-in player at the camera target for the occlusion fade, `&style=retro`, `&spriteFilter=pixel`, `&yaw=`)
- `npx tsx tools/shot3d.ts --batch "name=map=0.9;name2=map=0.10"` — several previews in one run
- `npx tsx tools/shot3d.ts --state out/r101.state --wait 3000 --keys "LEFT:600"` — screenshot live play from a save
  state (`r101.state`: Route 101, free to walk; `s22.state`: Littleroot; `littleroot.state` is an indoor cutscene;
  `--eval` runs after the shots)

## Conventions
- ROM (`*.gba`), save states, `out/`, `vendor/` are gitignored; never commit Nintendo assets.
- World mapping: grid (x, y) at height h → world (X=x, Y=h, Z=y+h) ("un-projection").
- Live baselines: `out/regress-live/p2-base` = before Phase 2 (both styles; entries added later got their reference
  at their task's base, noted beside them in `STATIC`). Never overwrite it; a new phase captures its own base label.
  `out/regress-live/p3-base` = before Phase 3 (both styles, live + static incl. the `b_*` battle previews and their
  `gba_`/`ref_` pictures; `b_grass_fail` and `b_sand_night`, added later, have references rendered from Task 4's
  pre-arena code). Never overwrite it either.
  `out/regress-live/p4-base` = before Phase 4 (both styles, every entry incl. the `i_*` previews and the door walks; the
  dusk entries' references are copies of their day twins'). Never overwrite it either.
- Keep context lean: store findings/decisions in the progress log instead of re-deriving them.

## Battle arenas (Phase 3, Modern; Retro = today's `battle/arena.ts`, untouched)
- `src/render/battle/`: `battleView.ts` (style split, camera, precompile), `stage.ts` (reference projection,
  `BATTLE_CAMERA`), `battleActors.ts` (sprite routing hud/card/inflated/decal/skip), `modernArena.ts` (`ArenaPart`,
  `ARENA_PARTS`, per-part try/catch → today's arena) + `parts/`, `palette.ts` / `look.ts` (colours from the BG3
  sample; lights/fog/night per kind and hour), `sky.ts`, `bgSample.ts`. Kinds: `src/game/battle/arenaKind.ts` (24).
- `catalogue.ts`: every battle program, compiled at boot; drift guard `tests/battleCatalogue.test.ts` (a part's new
  material/variant must be in its catalogue entries). Render orders (`tests/battleRenderOrder.test.ts`): deep water −1,
  scenery and battlers ≤ 2, platform tops 2.5, ground 3 (late, for early-z), Sky Pillar clouds 3.5, sky 10.
