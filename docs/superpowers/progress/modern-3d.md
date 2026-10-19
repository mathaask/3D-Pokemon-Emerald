# Modern 3D models — progress log

Spec: `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`

## Status
- 2026-10-19: Brainstorming done. User chose: modern stylized 3D; scope = outdoor, interiors,
  characters, battles; approach A in 4 phases. Spec written — **awaiting user review**.
- Git repo initialised; baseline commit `667c190`.

## Next step
- After spec approval: write Phase 1 plan (`docs/superpowers/plans/2026-10-19-phase1-outdoor.md`)
  via the writing-plans skill.

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
