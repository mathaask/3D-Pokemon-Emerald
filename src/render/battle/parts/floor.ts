// The indoor floors: one battle-only kit program ('hallFloor') that paints a room's floor analytically — wide wooden
// boards running away from the camera, or large polished tiles — and, in the same program, the battle platforms' tops in
// those rooms (polished stone with an inlaid rim and a ring of dots, as the GBA's platforms carry). It replaces the
// terrain shader there (kit/terrain.ts: its crazy-paving Paving read as cracked flagstone, its quarter-unit Deck planks
// aliased into fine lines in the distance) and costs a fraction of it: no warp, no fbm, no voronoi, no texture fetch.
// Every line is antialiased by its pixel footprint (fwidth) and fades to its average where a pixel spans much of a
// board or a tile: no moiré in the distance. The halls (Task 10) use it; the stadium rooms (Task 11) map their kinds in
// FLOOR_STYLE and, where they need a new pattern, add a branch to FLOOR_COLOR (still one program).

import * as THREE from 'three';
import type { KitMaterialOptions } from '../../kit/materials';
import { mix, toLinear, type RGB } from '../../kit/palette';
import type { ArenaKind } from '../arenaKind';
import type { ArenaPalette } from '../palette';
import { STAGE, type Stage } from '../stage';
import { platformsGlsl } from './ground';
import { BOARDS_GLSL, FLOOR_SEAM_GLSL, TILES_GLSL } from '../../kit/interior/floorGlsl';

/** A floor's pattern: wooden boards along z, square tiles, or a platform's top. */
export type FloorStyle = 'boards' | 'tiles' | 'stage';

/** The kinds whose ground is a hall floor (the arena ground's disc drawn with hallFloorMaterial) and whose platform tops
 *  are 'stage' tops: the halls (Task 10) and the Stadium rooms (Task 11: the hideouts, the Elite Four, the Champion —
 *  tiled as the GBA's platforms); any other kind keeps the terrain shader. */
export const FLOOR_STYLE: Readonly<Partial<Record<ArenaKind, Exclude<FloorStyle, 'stage'>>>> = {
  building: 'boards', gym: 'tiles', leader: 'tiles', frontier: 'tiles',
  magma: 'tiles', aqua: 'tiles', sidney: 'tiles', phoebe: 'tiles', glacia: 'tiles', drake: 'tiles', champion: 'tiles',
};

/** A pattern's parameters: `size` the board's width / the tile's side (units), `seam` how much the seams darken (0..1),
 *  `tone` each board's / tile's tone spread (±), `alt` the alternate tiles' colour factor (a soft checker; boards: none),
 *  `roughness` the material's. (The 'stage' top: its rim inlay's factor is `alt`, its dots darken by `seam`.) */
export interface FloorPattern { size: number; seam: number; tone: number; alt: RGB; roughness: number }

export const FLOOR_PATTERN: Readonly<Record<FloorStyle, FloorPattern>> = {
  boards: { size: 0.55, seam: 0.38, tone: 0.07, alt: [1, 1, 1], roughness: 0.75 },
  tiles: { size: 2.0, seam: 0.22, tone: 0.025, alt: [0.95, 0.95, 0.95], roughness: 0.6 },
  stage: { size: 1, seam: 0.3, tone: 0, alt: [0.86, 0.86, 0.86], roughness: 0.55 },
};

const STYLE_ID: Readonly<Record<FloorStyle, number>> = { boards: 0, tiles: 1, stage: 2 };

/** The court painted on a gym's floor: its rectangle (x ± `x` from the stage centre, z from / to it: the court lines'
 *  boundary, rooms.ts courtLines) in its own colour (courtColor), the floor's pattern kept. */
export const COURT_BOUNDS = { x: 9, z: [-9, 6] as const };
/** The kinds with a court, and its shade (× its colour): the Leader's a little deeper than a gym's. */
export const FLOOR_COURT: Readonly<Partial<Record<ArenaKind, number>>> = { gym: 0.93, leader: 0.84 };
/** A court's colour (sRGB): the floor turned 0.55 towards the arena's accent, × `shade` (the GBA's tan band). */
export const courtColor = (p: ArenaPalette, shade: number): RGB => mix(p.ground, p.accent, 0.55).map((v) => v * shade) as RGB;

const FLOOR_UNIFORMS = /* glsl */ `
uniform vec4 uFloor;      // style (0 boards, 1 tiles, 2 stage), size, seam darkness, tone spread
uniform vec3 uFloorAlt;   // tiles: the alternate tiles' factor; stage: the rim inlay's
uniform vec4 uFloorCourt; // a court's rectangle (x0, z0, x1, z1; empty: none) ...
uniform vec3 uFloorCourtColor; // ... and its colour (linear), in place of the floor's
`;
/** The floor's head: its uniforms, the build's stage's two platforms (platformsGlsl: the 'stage' tops' rings; the court's
 *  rectangle comes from the same stage, hallFloorMaterial) and the seam function (kit/interior/floorGlsl.ts). */
const floorHead = (stage: Stage) => FLOOR_UNIFORMS + platformsGlsl('FLOOR_PLATFORMS', stage) + FLOOR_SEAM_GLSL;

// (the boards' and the tiles' branches: kit/interior/floorGlsl.ts, the interiors' floors share them)
const FLOOR_COLOR = /* glsl */ `
{
  vec2 fp = vKitWorld.xz;
  vec3 k = vec3(1.0);
  float seam = 0.0;
  if (uFloor.x < 0.5) {
${BOARDS_GLSL}  } else if (uFloor.x < 1.5) {
${TILES_GLSL}  } else {
    // a platform's top: polished stone, an inlaid band at its rim (uFloorAlt) and a ring of dots inside it, as the GBA's
    // platforms; by the nearer platform's elliptical radius
    vec2 q0 = (fp - FLOOR_PLATFORMS[0].xy) / FLOOR_PLATFORMS[0].zw, q1 = (fp - FLOOR_PLATFORMS[1].xy) / FLOOR_PLATFORMS[1].zw;
    bool first = dot(q0, q0) < dot(q1, q1);
    vec2 q = first ? q0 : q1;
    vec2 r = first ? FLOOR_PLATFORMS[0].zw : FLOOR_PLATFORMS[1].zw;
    float e = length(q);
    float few = fwidth(e);
    float band = smoothstep(0.84 - few, 0.84 + few, e) * (1.0 - smoothstep(0.92 - few, 0.92 + few, e));
    k *= mix(vec3(1.0), uFloorAlt, band);
    // 32 dots on the ring e = 0.74, 0.075 units across (world units: the ellipse's own scale)
    float a = atan(q.y, q.x) / 6.2831853 * 32.0;
    float ac = (floor(a) + 0.5) / 32.0 * 6.2831853;
    vec2 dc = (q - 0.74 * vec2(cos(ac), sin(ac))) * r;
    float dd = length(dc);
    float fwd = fwidth(dd);
    seam = (1.0 - smoothstep(0.075 - fwd, 0.075 + fwd, dd));
    // a soft sheen towards the middle
    k *= 1.04 - 0.08 * e * e;
  }
  if (uFloorCourt.x < uFloorCourt.z) {
    vec2 cd = max(uFloorCourt.xy - fp, fp - uFloorCourt.zw);
    float inside = max(cd.x, cd.y), cfw = fwidth(inside);
    diffuseColor.rgb = mix(diffuseColor.rgb, uFloorCourtColor, 1.0 - smoothstep(-cfw, cfw, inside));
  }
  diffuseColor.rgb *= k * (1.0 - uFloor.z * seam);
}
`;

/** The hall floor's material for `style` in sRGB `tint`: the floor's colour, its pattern (FLOOR_PATTERN) in the uniforms;
 *  `court`: a court (COURT_BOUNDS round its stage's centre) in its sRGB colour; `stage`: the stage whose platforms the
 *  'stage' tops ring (the court's, else STAGE: every arena builds on it, ModernArena's ctx.stage). hookKey 'hallFloor' —
 *  one program for every style (on one stage). */
export function hallFloorMaterial(style: FloorStyle, tint: RGB, court: { stage: Stage; color: RGB } | null = null,
  stage: Stage = court?.stage ?? STAGE): KitMaterialOptions {
  const f = FLOOR_PATTERN[style];
  const c = court ? court.stage.centre : null;
  const rect = c ? new THREE.Vector4(c.x - COURT_BOUNDS.x, c.z + COURT_BOUNDS.z[0], c.x + COURT_BOUNDS.x, c.z + COURT_BOUNDS.z[1])
    : new THREE.Vector4(1, 0, 0, 0);
  return {
    color: new THREE.Color(...toLinear(tint)),
    roughness: f.roughness,
    uniforms: { uFloor: { value: new THREE.Vector4(STYLE_ID[style], f.size, f.seam, f.tone) }, uFloorAlt: { value: new THREE.Vector3(...f.alt) },
      uFloorCourt: { value: rect }, uFloorCourtColor: { value: new THREE.Color(...toLinear(court ? court.color : tint)) } },
    fragHead: floorHead(stage),
    fragColor: FLOOR_COLOR,
    hookKey: 'hallFloor',
  };
}
