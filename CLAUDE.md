# Emerald 3D — working notes for Claude

Pokémon Emerald running unmodified in a custom GBA emulator (`src/gba`), with a Three.js renderer
(`src/render`) that rebuilds the world in 3D from live emulated state. See `README.md`.

## Active work (read this first after a context reset)
- **Project:** Modern stylized 3D models (replace pixel-textured boxes/cards with real models).
- **Phase 1 (outdoor environment) is done** (merged to `main`; known gaps in the progress log).
- **Phase 2 — characters, Pokémon, field objects — in progress** on branch `phase2-characters`,
  plan `docs/superpowers/plans/2026-10-20-phase2-characters.md` (12 tasks), executed subagent-driven.
  Resume from the SDD ledger `.superpowers/sdd/2026-10-20-phase2-characters/progress.md` (gitignored;
  tasks with a `Task N: complete` line are done) and the Phase 2 checklist in the progress log.
  Show the user a phase progress bar in every update (they write Norwegian; reply in Norwegian).
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
- `npm run regress:live -- --label x --static --gpu --selftest --compare p2-base` — deterministic live visual
  regression (`tools/regress-live.ts`, header documents every flag): save states replayed in manual mode (`?manual=1`: no
  frame loop, fixed RTC and clock; `emu.step(keys, frames)` emulates + renders and returns each frame's renderer CPU ms,
  `emu.gpuFrames(n, keys)` times frames with GPU timer queries) plus, with `--static`, map previews with their object
  events (`?map=G.N&actors=1`); both styles → `out/regress-live/x/` (PNGs, `_sheet_*`, `_crops.png`, `stats.json`:
  calls/triangles/programs, stepMsMax, gpuMs/cpuMs with `--gpu`, actorLum Modern/Retro). `--compare p2-base` diffs against the pre-Phase-2
  baseline: Retro must stay 0.00 % (only `lr_truck`/`littleroot_npcs` differ: the composed truck, Task 10).
  `--selftest`: GPU inflation field + xBR vs CPU references. `--ab`: same-session cost of the Phase 2 actors vs flat
  cards (frame-interleaved; `--ab-aa` = noise floor, `--ab-feature npcfade`); budgets are judged this way, never
  against stored gpuMs (the Intel iGPU drifts 6–14 ms between sessions). Also `--only a,b`, `--styles modern`,
  `--query quality=high`, `--query actorUniforms=0` (inflated actors' attribute fallback, see inflatedActors.ts), `--dpr 2`
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
- Keep context lean: store findings/decisions in the progress log instead of re-deriving them.
