// The analytic floor patterns (moved from battle/parts/floor.ts in Phase 4: the battle's hall floor composes its
// FLOOR_COLOR from them unchanged, the interiors' floor program reuses them). GLSL snippets, no texture fetch:
//
// - FLOOR_SEAM_GLSL defines `float floorSeam(float f, float halfW, float fw)` (a seam's antialiased coverage; fades to
//   its average where a pixel spans much of a period). Put it in the fragment head.
// - BOARDS_GLSL (wooden boards along z) and TILES_GLSL (square tiles, a soft checker) are statement blocks for the
//   fragment's colour hook. They need kitHash12 / kitNoise2 (the kit's noise head) and floorSeam, and READ:
//     `fp`        vec2   the floor point (world x, z)
//     `uFloor`    vec4   .y the board's width / the tile's side (units), .z the seams' darkness (unused here: the caller
//                        applies `1.0 - uFloor.z * seam`), .w each board's / tile's tone spread (±); .x is the style the
//                        caller branches on
//     `uFloorAlt` vec3   tiles: the alternate tiles' colour factor (boards: unread)
//   and WRITE:
//     `k`         vec3   the colour factor (multiplied in place: start it at vec3(1.0))
//     `seam`      float  the seam coverage 0..1 (assigned)
//   A program without those uniforms declares them as locals in a block around the snippet (`{ vec4 uFloor = …; … }`).

/** The seam function (fragment head). */
export const FLOOR_SEAM_GLSL = /* glsl */ `// A seam's coverage at fract coordinate f (one period = 1), halfW its half width (periods), the pixel fw periods across:
// antialiased; where a pixel spans much of a period, the seams' share of it (no moire).
float floorSeam(float f, float halfW, float fw) {
  float d = min(f, 1.0 - f);
  float line = 1.0 - smoothstep(halfW - fw, halfW + fw, d);
  return mix(line, 2.0 * halfW, smoothstep(0.12, 0.45, fw));
}
`;

// Each pattern is also exported in its three parts (the whole is their concatenation, byte for byte): _CELL (the
// pattern's coordinates), _FW (`vec2 fw`, the pixel's footprint in them: the snippet's only derivative) and _SHADE (the
// rest, no derivatives). A caller choosing a pattern per fragment (the interior floor: by the cell's kind) takes the
// footprint before its branch, where control flow is uniform, and passes it in as `fw` (kit/interior/geom/floorPatterns.ts).

/** Boards: their coordinates (bx across, bz along; bi, bj the board and its segment; h, len its hash and length). */
export const BOARDS_CELL_GLSL = /* glsl */ `    // boards along z, uFloor.y wide, each 2.6–4.2 long, their butt joints staggered board to board; a tone per board and
    // a soft grain along it, both fading out where a pixel spans a board
    float bx = fp.x / uFloor.y, bi = floor(bx);
    float h = kitHash12(vec2(bi, 17.0));
    float len = 2.6 + 1.6 * h;
    float bz = fp.y / len + h * 5.3, bj = floor(bz);
`;
/** Boards: the pixel's footprint in board coordinates (needs uniform control flow). */
export const BOARDS_FW_GLSL = /* glsl */ `    vec2 fw = fwidth(vec2(bx, bz));
`;
/** Boards: tone, grain and seams from the coordinates and `fw`. */
export const BOARDS_SHADE_GLSL = /* glsl */ `    float near = 1.0 - smoothstep(0.08, 0.4, fw.x);
    float tone = kitHash12(vec2(bi * 1.7 + 3.0, bj));
    float grain = kitNoise2(vec2(fp.x * 6.0 + tone * 31.0, fp.y * 0.5));
    k *= 1.0 + near * (uFloor.w * (2.0 * tone - 1.0) + 0.05 * (grain - 0.5));
    seam = max(floorSeam(fract(bx), 0.03, fw.x), floorSeam(fract(bz), 0.02 / len, fw.y));
`;

/** Boards along z (statements; see the header for what they read and write). */
export const BOARDS_GLSL = BOARDS_CELL_GLSL + BOARDS_FW_GLSL + BOARDS_SHADE_GLSL;

/** Tiles: their coordinates (t, and ti the tile). */
export const TILES_CELL_GLSL = /* glsl */ `    // square tiles, uFloor.y on a side: a soft checker (uFloorAlt) and a tone per tile, fading out with distance
    vec2 t = fp / uFloor.y, ti = floor(t);
`;
/** Tiles: the pixel's footprint in tile coordinates (needs uniform control flow). */
export const TILES_FW_GLSL = /* glsl */ `    vec2 fw = fwidth(t);
`;
/** Tiles: checker, tone and seams from the coordinates and `fw`. */
export const TILES_SHADE_GLSL = /* glsl */ `    float near = 1.0 - smoothstep(0.1, 0.4, max(fw.x, fw.y));
    float tone = kitHash12(ti + 5.0);
    float chk = mod(ti.x + ti.y, 2.0);
    k *= mix(vec3(1.0), uFloorAlt, mix(0.5, chk, near)) * (1.0 + near * uFloor.w * (2.0 * tone - 1.0));
    seam = max(floorSeam(fract(t.x), 0.012, fw.x), floorSeam(fract(t.y), 0.012, fw.y));
`;

/** Square tiles (statements; see the header for what they read and write). */
export const TILES_GLSL = TILES_CELL_GLSL + TILES_FW_GLSL + TILES_SHADE_GLSL;
