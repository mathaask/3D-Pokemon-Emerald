# Modern 3D models — progress log

Spec: `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`

## Status
- 2026-10-19: Brainstorming done. User chose: modern stylized 3D; scope = outdoor, interiors,
  characters, battles; approach A in 4 phases. Spec approved ("go for it").
- Git repo initialised; baseline commit `667c190`.
- Phase 1 plan written: `docs/superpowers/plans/2026-10-19-phase1-outdoor.md` (17 tasks) —
  **awaiting user review + choice of execution method**.
- Regression baseline (`npx tsx tools/regress.ts --label before`, 16 maps × h11/h21, `out/regress/before/stats.json`):
  max calls 27, max triangles 111213 (route119), max buildMs 162 (route119 h21; build time is noisy, 108 at h11).

## Next step
- Execute Phase 1 plan from Task 1. Tick tasks off below as they are committed.

## Phase 1 tasks
- [ ] 1 regress harness · [ ] 2 golden + split · [ ] 3 style/events · [ ] 4 kit foundation
- [ ] 5 semantic core · [ ] 6 terrain · [ ] 7 water · [ ] 8 cliffs · [ ] 9 trees · [ ] 10 fade
- [ ] 11 grass/flowers · [ ] 12 buildings I · [ ] 13 buildings II · [ ] 14 table/props
- [ ] 15 smoke/coverage · [ ] 16 polish/perf · [ ] 17 live check/docs

## Phases
- [ ] Phase 1 — Foundation + Outdoor environment
- [ ] Phase 2 — Characters, Pokémon, field objects
- [ ] Phase 3 — Battles
- [ ] Phase 4 — Interiors

## Key facts (so they don't need re-deriving)
- `classify.ts` mixes analysis + quad emission; plan is to split into `analyze.ts` + `legacyQuads.ts`.
- `src/game/rom/maps.ts` already decodes warps + bg events (`MapEvents`); map names in `src/game/mapNames.ts`.
- Live backup grid coords include `MAP_OFFSET = 7` (`src/game/state.ts`); preview uses offset 0.
- `ObjectEventSnap.graphicsId` available for object model replacements (phase 2).
- Indoor maps share primary `gTileset_Building`; outdoor share `gTileset_General`.
- Existing screenshots of the old look: `out/3d/*.png` (pv_*, t_* are map previews).
- PC (red roof 0x050–0x06B), Mart (blue roof 0x030–0x04B), gym facades (0x1C8–0x1D5) are all in
  gTileset_General → identical in every town. Building kind comes from warp destination names.
- Measured ROM ground colours (sRGB): grass (0.45,0.78,0.65); path (0.65,0.84,0.78) pale mint;
  paving (0.81,0.81,0.87); sand (0.87,0.81,0.52); Route 113 ash (0.68,0.68,0.55); water (0.32,0.42,0.84).
- Map ids: Littleroot 0.9, Oldale 0.10, Petalburg 0.0, Rustboro 0.3, Petalburg Woods 24.11 (ROUTE type),
  Slateport 0.1, Mauville 0.2, Route 101 0.16, Route 110 0.25, Route 113 0.28, Route 119 0.34,
  Fortree 0.4, Lilycove 0.5, Mossdeep 0.6, Sootopolis 0.7, Brendan's house 1F 1.0, Granite Cave 1F 24.7.
- Bash heredocs with large content fail in this harness — write big files with the Write tool.
- `npx tsx -e "..."` with dynamic imports hung once; use a script file in `.scratch/` (gitignored).
