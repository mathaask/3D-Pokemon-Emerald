# Emerald 3D — working notes for Claude

Pokémon Emerald running unmodified in a custom GBA emulator (`src/gba`), with a Three.js renderer
(`src/render`) that rebuilds the world in 3D from live emulated state. See `README.md`.

## Active work (read this first after a context reset)
- **Project:** Modern stylized 3D models (replace pixel-textured boxes/cards with real models).
- **Phases 1 (outdoor environment), 2 (characters, Pokémon, field objects) and 3 (battles) are done** (merged to
  `main`; results, numbers and known gaps in the progress log; full rulings in `phase1-sdd-ledger.md` /
  `phase2-sdd-ledger.md` / `phase3-sdd-ledger.md`).
- **Hitch fix done** (boot-time program catalogue, one build per map load).
- battle-feet fix merged (battlers stand on their platform tops, both styles).
- **Phase 4 — interiors — in progress** on branch `phase4-interiors`, plan
  `docs/superpowers/plans/2026-10-27-phase4-interiors.md` (user-approved 2026-10-27: five secondaries; ALL indoor light
  follows the clock (D8); real-world heights). SDD ledger `.superpowers/sdd/2026-10-27-phase4-interiors/progress.md`
  (gitignored; `Task N: complete` lines are done); parallel groups A/B/C per the plan. Baseline label `p4-base`.
- Later: terrain height solver v2 (mountain ridges), a battle look-polish pass (Phase 3 known gaps). Write the plan first (`docs/superpowers/plans/`), then execute
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
- `npm run regress:live -- --label x --static --gpu --selftest --compare p3-base` — deterministic live visual
  regression (`tools/regress-live.ts`, header documents every flag): save states replayed in manual mode (`?manual=1`: no
  frame loop, fixed RTC and clock; `emu.step(keys, frames)` emulates + renders and returns each frame's renderer CPU ms,
  `emu.gpuFrames(n, keys)` times frames with GPU timer queries) plus, with `--static`, map previews with their object
  events (`?map=G.N&actors=1`); both styles → `out/regress-live/x/` (PNGs, `_sheet_*`, `_crops.png`, `stats.json`:
  calls/triangles/programs, stepMsMax, gpuMs/cpuMs with `--gpu`, actorLum Modern/Retro). `--compare p3-base` diffs against the pre-Phase-3
  baseline (the current gate: Retro must stay 0.00 %). `p2-base` (pre-Phase-2) lacks every entry added later (`b_*`,
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
- Keep context lean: store findings/decisions in the progress log instead of re-deriving them.

## Battle arenas (Phase 3, Modern; Retro = today's `battle/arena.ts`, untouched)
- `src/render/battle/`: `battleView.ts` (style split, camera, precompile), `stage.ts` (reference projection,
  `BATTLE_CAMERA`), `battleActors.ts` (sprite routing hud/card/inflated/decal/skip), `modernArena.ts` (`ArenaPart`,
  `ARENA_PARTS`, per-part try/catch → today's arena) + `parts/`, `palette.ts` / `look.ts` (colours from the BG3
  sample; lights/fog/night per kind and hour), `sky.ts`, `bgSample.ts`. Kinds: `src/game/battle/arenaKind.ts` (24).
- `catalogue.ts`: every battle program, compiled at boot; drift guard `tests/battleCatalogue.test.ts` (a part's new
  material/variant must be in its catalogue entries). Render orders (`tests/battleRenderOrder.test.ts`): deep water −1,
  scenery and battlers ≤ 2, platform tops 2.5, ground 3 (late, for early-z), Sky Pillar clouds 3.5, sky 10.
