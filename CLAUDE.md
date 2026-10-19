# Emerald 3D — working notes for Claude

Pokémon Emerald running unmodified in a custom GBA emulator (`src/gba`), with a Three.js renderer
(`src/render`) that rebuilds the world in 3D from live emulated state. See `README.md`.

## Active work (read this first after a context reset)
- **Project:** Modern stylized 3D models (replace pixel-textured boxes/cards with real models).
- **Spec:** `docs/superpowers/specs/2026-10-19-modern-3d-models-design.md`
- **Progress log (source of truth for where we are):** `docs/superpowers/progress/modern-3d.md`
  — update it after every completed task / milestone, and before long-running steps.
- Plans live in `docs/superpowers/plans/` (one per phase).

## Commands
- `npm test` — unit tests (no ROM needed)
- `npx vitest run --config tests/smoke/vitest.smoke.config.ts tests/smoke/<file>` — ROM-driven smoke tests
- `npx tsc --noEmit` — typecheck
- `npx tsx tools/shot3d.ts --query "map=0.9&hour=11" --name x` — screenshot a static map preview → `out/3d/x_0.png`
- `npx tsx tools/shot3d.ts --batch "name=map=0.9;name2=map=0.10"` — several previews in one run
- `npx tsx tools/shot3d.ts --state out/littleroot.state --wait 3000` — screenshot live play from a save state

## Conventions
- ROM (`*.gba`), save states, `out/`, `vendor/` are gitignored; never commit Nintendo assets.
- World mapping: grid (x, y) at height h → world (X=x, Y=h, Z=y+h) ("un-projection").
- Keep context lean: store findings/decisions in the progress log instead of re-deriving them.
