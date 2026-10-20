# Final whole-branch review: Phase 1 (outdoor), 94eaf15..83108ba

Reviewer: final review (opus). Read-only on the checkout. HEAD and the working tree were unchanged after the review.
Fresh evidence: `npx tsc --noEmit` passes; unit tests 21 files / 423 tests pass. Smoke tests were not re-run.
Two probes were written outside the repo (`%TEMP%/review-probe/`): (a) the cost of the first frame after
`PreviewApp.rebuild()`, in headless Chrome on the dev machine with ANGLE D3D11, the same setup as `regress`;
(b) a Node count of cell edges where the terrain and the legacy emitter both draw a bank.

How I reviewed: four passes, reading HEAD files and running targeted `git diff`s rather than reading the 794 KB package top to bottom.
- Pass 1, read closely: `world.ts`, `overworldView.ts`, `claims.ts`, `legacyQuads.ts`, the tail of `analyze.ts`, the `metatileAtlas.ts` diff, `semantics.ts`, `events.ts`, `materials.ts`, `palette.ts`.
- Pass 2, read closely: `terrain.ts`, `water.ts`, `footprints.ts`, the building extract/build and its signs and facades, the grass and flower families, the tables, `text.ts` and `upscale.ts`.
- Pass 2, skimmed: the internal heuristics of the cliffs, trees and props extract code (rock roles, forest edges, fence runs). For those I relied on the per-task reviews and tests.
- Pass 3: `renderer.ts`, `post.ts`, `preview.ts`, `main.ts`, `settings.ts`, `README.md`, `CLAUDE.md`.
- Pass 4: `kitRun`, `kitEvents`, `legacyClaims`, the `kitTables` test list, the smoke semantics/golden tests, `tools/regress.ts`.

## Strengths

- **The architecture follows the spec.** `analyze.ts` is a pure analysis and `legacyQuads.ts` is the old emitter, now honouring claims. The split is pinned by the golden test. Families claim cells through a bitfield (`Claims`) that has snapshot and rollback. `World.build` falls back to Retro if the whole kit throws, and a failing family is rolled back on its own (spec §3, §11). Every legacy pass checks claims, so the per-cell fallback is real.
- **Gameplay cues are treated with care.**
  - Secret-base spots are never claimed by any family. The smoke test checks this on all 68 outdoor maps and every secret-base bg event.
  - Walk-in doors publish `surfaceY`, so characters stand on the threshold.
  - The grass overlay sprite is hidden only where 3D blades stand. The world knows this per cell, and it holds after a failed build.
  - The occlusion fade's core is sized so that the player is never hidden. A test checks this for every camera preset × zoom.
  - Ledges get a lip that faces their jump direction.
- **The connected-map strips (Task 17b) are correct.** `stripPlacement` is tested against a literal transcription of fieldmap.c over a sweep of offsets. Events in each strip are limited to the cells the game actually copied. This fixes Review Focus #1 in substance: from Route 101, Oldale's PC is a PC.
- **Performance discipline.**
  - Medium quality peaks at 74 draw calls and 403k triangles (budgets 150 / 1.5M).
  - Trees, grass and flowers are instanced, with per-chunk shadow culling.
  - Geometry is cached per session and marked `userData.shared`.
  - The atlas redraws only when VRAM, palettes, tilesets or ground refs change, and skips the Dry band when it is not needed.
  - The PostFX HiDPI double-scaling bug is fixed (4× fill at DPR 2).
  - Water shader gating was checked for pixel equivalence.
- **Resource lifetime is handled for geometry and textures.** `disposeKit` frees instance buffers and non-shared geometry. Per-build textures go through `kit.disposables`. A test asserts there is exactly one kit group after any rebuild and none in Retro.
- **Tests are solid and behaviour-focused.** Examples: the hook-hash program keys, the winding of every prop kind, the claim guards of the legacy emitter, the strip placement, the grass-overlay rule. ROM smoke tests pin the building kinds of every town and coverage on all outdoor maps.
- **Documentation is honest.** The progress log and README list the known gaps (mountains, Ever Grande, Sootopolis/Lavaridge rock, rain under water, JIT warm-up hitch, NPCs not faded). Rulings are recorded with their cost.
- **Retro is preserved.** The golden test pins the legacy output. Retro shadows are back to 2048 / radius 1, and tilt-shift is set per style. The remaining 0.59 % pixel difference is sub-texel and explained (it comes from the 5-band atlas).

## Issues

### Critical (Must Fix)
None.

### Important (Should Fix)

**I1. Every world rebuild in Modern destroys and recompiles all kit shader programs, so each map crossing in Modern stalls about 4× longer than in Retro.**
- **Where:** `src/render/kit/semantics.ts:104-117` (`disposeKit` calls `mat.dispose()` and `customDepthMaterial.dispose()`); `src/render/overworld/world.ts:122-123` (`build()` disposes the old kit before the new one exists).
- **Root cause:** in three r186, `WebGLPrograms.releaseProgram` destroys a program as soon as its last material is disposed. The new build's materials have identical cache keys, but there is nothing left to share, so the first frame after every rebuild re-creates every kit program and its depth twin.
- **Measured** (probe (a), median frame without a rebuild about 22 ms; 5 rebuilds each):

  | Case | `rebuild()` (warm) | First frame after rebuild | Kit programs re-created |
  |---|---|---|---|
  | Oldale, Modern | 14–26 ms | **106–140 ms** | 9 of 9 |
  | Oldale, Retro | 13–64 ms | 31–47 ms | 0 (the 2 re-created are the existing TreeCards material) |
  | Route 113, Modern | 37–61 ms | **105–121 ms** | 6 of 6 |
  | Route 113, Modern, programs kept alive by hand (`usedTimes++`) | — | 26–34 ms | — |

  So about 80–100 ms per rebuild is pure program re-creation.
- **Why it matters:**
  - Spec §10 says "World rebuild ≤ 150 ms (no hitch when crossing map connections)". The Task 16 ruling measured only the CPU `buildMs`, so this cost was invisible to the budget.
  - What a player actually feels per crossing is about 110–160 ms in Modern versus about 30–45 ms in Retro, and crossings are constant in Hoenn.
  - The same stall follows every in-game grid edit: Cut, opening a secret base, a style toggle.
  - From pokeemerald's `FldEff_Ash` (`MapGridSetMetatileIdAt`), every step into Route 113's ash grass changes a metatile and so triggers a rebuild. I did not measure this live.
- **How to fix** (either option is small):
  - (a) Keep programs alive across rebuilds. Detach the previous kit group in `build()`, but dispose it only after the new world has been drawn once. For example, `World.releaseRetired()` called by `Renderer.render` / `PreviewApp.frame` after `post.render`. While old and new materials coexist, three shares the programs (`acquireProgram` finds the key).
  - (b) Cache kit materials per option set for the session and swap the per-build uniforms (`tCells`, `tWater`, facade maps).
- **How to verify:** add a unit test that `World` does not dispose the old kit's materials until after the release hook. Make `regress` or the preview report first-frame-after-rebuild time, so the budget measures what the spec means.

### Minor (Nice to Have)

**M1. Dive maps draw the same bank twice: terrain and legacy put a quad in the same plane on 1,037 cell edges.**
- **Where:** `terrain.ts:337-358` treats every water cell as a bank partner. `legacyQuads.ts:331,350` also emits a connector whenever one of the two cells is not a kit surface.
- **When:** on Dive maps the water family is off, so the water cells are unclaimed and both sides draw the bank. Probe (b) found 1,037 such edges across 11 underwater maps (Underwater Route 126: 533) and none on other outdoor maps.
- **Why it matters:** this is double overdraw at every seabed edge, with likely z-fighting because the two quads split along different diagonals. A still screenshot (Underwater Route 126) shows the seams but no obvious speckle, so the flicker is unconfirmed.
- **How to fix:** in the terrain, count water as a bank partner only when it is claimed `CLAIM_SURFACE | CLAIM_WATER_UNDER`. Or skip the legacy connector when the other cell is terrain-claimed. Add a smoke assertion that no edge is drawn by both.

**M2. An exception while reading live events stops the render loop (the game freezes).**
- **Where:** `overworldView.ts:185-195, 238` (deferred minor from Task 3).
- **What happens:** `liveGridEvents` runs inside `sync()` outside any try/catch. A `RomError` would propagate out of `Renderer.render`, and `tick` in `main.ts` has no guard, so `requestAnimationFrame` is never re-armed.
- **Who is affected:** only unrecognised ROMs, which `main.ts` explicitly lets run ("Trying anyway…"). Before Phase 1 nothing read events live, so this failure mode is new.
- **How to fix:** wrap the read in try/catch, fall back to `NO_EVENTS`, and warn once (three lines).

**M3. If a family's build fails, the terrain's claims made around it are not undone.**
- **Where:** `semantics.ts:85-92`; `terrain.ts:270-292`; `cliffs.ts:609-615`.
- **What happens:** terrain extracts last and claims `CLAIM_SURFACE` on ledge cells, because the cliffs draw the lip. If the cliffs' build throws, the rollback clears only the cliffs' own bits. The ledge is then drawn as flat terrain with neither the 3D lip nor the legacy art, so the one-way cue is lost. Spec §11 expects the failed family's cells to render as legacy.
- **Same pattern:** flower beds, via `CLAIM_DECOR`.
- **How likely:** exception path only.
- **How to fix:** let the families whose art the terrain defers to (ledges, flowers) set a bit the terrain checks. Or, on a build failure, also release the terrain claims on that family's cells.

**M4. Tests don't cover material/program lifetime or the `World`-level outdoor gating.**
- The `kitRun` dispose test checks geometry, instance buffers and textures, but not materials, which are what I1 is about.
- No `World`-level test checks that indoor and underground maps skip the kit (also a deferred Task 5 minor). The smoke test only checks at the extract level.

**M5. A failing family is logged on every rebuild, not once per map.**
- `semantics.ts:68,91` warns on every rebuild. Spec §11 says once per map. Console noise only, for example each ash step on Route 113.

**M6. A world-style change made with the settings panel open shows only partly until the panel closes.**
- Shadows and tilt-shift switch immediately. The world itself rebuilds only on the next emulated frame, and emulation is paused while the panel is open.
- Cosmetic and transient. A fix is to flag the overworld to rebuild on the next `render()`.

**M7. A corrupted `worldStyle` in localStorage leaves the world style in an inconsistent state.**
- `settings.ts:16`: `loadSettings` does not validate `worldStyle`.
- A corrupted value turns the kit off while keeping Modern shadows and tilt-shift. Nit: clamp the value to `'modern' | 'retro'`.

### Plan defects (separate from the implementation)

- **P1. The rebuild budget measured the wrong thing.** The plan's instrumentation (`stats().buildMs`, then the Task 16 warm `rebuild()`) times only the CPU build. GPU program creation and first-use uploads after a rebuild are excluded. This is how I1 got past the controller's budget ruling.
- **P2. A spec smoke assertion was dropped.** Spec §9.2 "Fortree: deck heights > ground" was never carried into the plan's Task 15, so no test pins deck heights.
- **P3. The plan contradicts itself on interiors.**
  - Review Focus #3 says interiors and caves in Modern are "identical to Retro".
  - Task 16 Steps 2 and 4 apply the gentler tilt-shift and softer shadows per style everywhere.
  - The controller ruled the conflict; the ruling is reasonable.
- **P4. The spec names a shadow type three no longer has.** Spec §5.9 names `PCFSoftShadowMap`, which three r186 removed. The PCF `shadow.radius` substitute is justified.

## Deferred-minor triage (from the ledger)

**Must fix before merge:** none of the deferred minors. The merge blocker is the new finding I1, which none of the per-task reviews could see.

**Recommended, cheap (not required):**
- The Task 3 `liveEvents`/`readEvents` throw inside `sync`. It freezes the render loop on unrecognised ROMs (M2).

**Already resolved by later tasks** (can be closed in the ledger):
- Task 9: `style.length` (fixed in 8bf8801).
- Task 10: fade radius scaling; `PostFX.sceneTargetSize`.
- Task 11: `KIT_BEND` in the depth twin; grass overlay hidden only where claimed.
- Task 13: facades glow.
- Task 14: opened secret-base spots getting `CLAIM_TOP` (guards now in `trees.ts:502,523`, `flowers.ts:280`, `water.ts:280,295,319`, `props.ts:141,226`).
- Task 7: water fragment gating.
- Task 15c: Ever Grande yellow.
- Task 8: cliffs on dirt-floor maps (checked in 15/15b).
- Task 8: cliffs rebuild evidence (measured in 16).

**Fine to defer** (cosmetic, tooling, code-structure, exception-only, or documented known gaps):
- Task 1 and Task 2: regress tooling and timing noise.
- Task 3:
  - The `gridKey` rebuild flag. A style toggle runs `onMapChanged`, which is harmless because the jump is under 3.
  - The `NO_EVENTS` singleton, which is never mutated.
  - The `kitEvents` boundary test nits.
  - The 404 (it's the favicon).
- Task 4: shader-hook constraints and leftovers. None reachable today: the lantern casts no shadow, and there is no `BatchedMesh`.
- Task 5: rollback edge cases (exception-only; see M3), duplicate names (static list), the dead catch branch, test gaps (M4).
- Task 6 and Task 6b: thresholds without pin tests, `isStructure` sharing. Wet ground and the Mossdeep gantry patch are cosmetic.
- Task 7: `ROCK_DZ` duplication; rain under water (documented).
- Tasks 8, 9 and 15b: file sizes, remaining legacy cliffs and the shoal edge cases (coverage met: 5.3 %).
- Tasks 9 and 11: shading nits; per-frame allocations (small); bounding spheres that ignore shader displacement.
- Tasks 12, 13 and 13b: footprint heuristics, Shipyard pier and Dept Store. These are documented gaps.
- Task 14: fence interpolation; town-tileset props (documented).
- Task 15 and Task 15c: documentation and labels; import layering.
- Task 16a: Dry cut under palette effects (documented); water-level connectors.
- Task 16:
  - High-quality shadow grain.
  - The `look()` cache footgun (correct today).
  - The per-frame `Uint32Array` view (about 10 µs).
  - Modern tilt-shift being weak at DPR 2 (aesthetic).
  - `post.ts` layering.
- Task 17b: strip-cut building extents (documented); the missing `num` bound (ROM hacks); duplicate quality state; the 0.59 % Retro residual.
- Task 17: diagnosis and documentation completeness.

## Declined to judge

- **Taste-level look of models and colours** (olive Route 113 crowns; a flatter Modern Dive seabed than Retro's pixel dots). This is aesthetic, and was judged per task from screenshots I did not redo.
- **Accuracy of the footprint, cliff, tree and prop heuristics on individual maps beyond the smoke assertions.** The coverage target is met, and the residual legacy share is a documented known gap.
- **NPCs and item balls hidden behind 3D crowns or roofs.** Spec §5.9 scopes the fade to the player, and this is documented as a Phase 2 gap.
- **Gentler tilt-shift and softer shadows in interiors, caves and battles in Modern.** The controller ruled this (Task 16 Important 2), and it is consistent with the chosen art direction.
- **Cold first-build times and the JIT warm-up hitch on the first 1–2 rebuilds.** Ruled informational or accepted. I1 is separate: it is steady-state.
- **Mountain ridge maps, Ever Grande, and Sootopolis/Lavaridge rock left on legacy.** Ruled a follow-up ("terrain height solver v2").
- **Frame times on the spec's target hardware** (mid-range desktop GPU, 1080p). I could only measure the dev iGPU, and my I1 numbers are relative to Retro on the same machine.
- **Plan-sanctioned simplifications:** flat waterfalls, non-directional currents, per-cell stair ramps, Scale2x instead of xBR.
- **Rain streaks below the water surface; pixel-water squares under palette effects.** Documented cosmetic gaps.
- **Robustness of the dev tooling** (regress CLI, browser paths). It is developer-only.
- **ROM hacks in general**, beyond the freeze path in M2. They are outside the spec ("Pokémon Emerald runs unmodified").
- **Phases 2–4** (characters, battles, interiors). Out of Phase 1.

## Recommendations

1. **Fix I1 before merge.**
   - Defer disposal of the previous kit group until the new world has rendered once, or cache kit materials.
   - Add a first-frame-after-rebuild timing to `regress` or the preview stats.
   - Re-measure Oldale, Route 113 and Route 119 against Retro.
2. **Cheap hardening worth folding into the same round:**
   - M2: try/catch around the live events read.
   - M1: no duplicate banks on Dive maps.
3. **For Phase 2 planning:**
   - Budget "rebuild" as the perceived stall: build plus first frame.
   - Design a session-level material/program cache before adding inflated-sprite materials.
   - Add the missing Fortree deck-height smoke assertion (P2).
4. **Close the resolved deferred minors in the ledger** (list above), so the Phase 2 backlog only carries live items.

## Assessment

**Ready to merge?** With fixes

**Reasoning:** Phase 1 delivers the planned outdoor kit with sound architecture, good tests and honest known gaps, and Retro is preserved. One Important regression should be fixed first, and the fix is small: every rebuild re-creates all kit shader programs, adding about 80–100 ms to every map crossing in Modern (about 4× the Retro hitch), which works against spec §10's "no hitch when crossing map connections".
