// Edge-directed pixel-art upscaling (Scale2x / EPX, the simplest of the xBR family): doubles the
// resolution while rounding staircase diagonals instead of blurring them. Pixels are packed RGBA
// in Uint32 words (any packing works: only equality is compared).

export function scale2x(src: Uint32Array, w: number, h: number): Uint32Array {
  const W = w * 2;
  const out = new Uint32Array(W * h * 2);
  for (let y = 0; y < h; y++) {
    const row = y * w, up = Math.max(0, y - 1) * w, down = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const l = Math.max(0, x - 1), r = Math.min(w - 1, x + 1);
      const E = src[row + x], B = src[up + x], D = src[row + l], F = src[row + r], H = src[down + x];
      let e0 = E, e1 = E, e2 = E, e3 = E;
      if (B !== H && D !== F) {
        if (D === B) e0 = D;
        if (B === F) e1 = F;
        if (D === H) e2 = D;
        if (H === F) e3 = F;
      }
      const o = y * 2 * W + x * 2;
      out[o] = e0;
      out[o + 1] = e1;
      out[o + W] = e2;
      out[o + W + 1] = e3;
    }
  }
  return out;
}

export function scale4x(src: Uint32Array, w: number, h: number): Uint32Array {
  return scale2x(scale2x(src, w, h), w * 2, h * 2);
}

// Scale-free xBR (lv2): the CPU reference of actors/xbr.glsl.ts (XBR_GLSL), the same steps in the same
// order. A sample at any continuous texel position: the texel E containing it, rounded at each of its four
// corners where an edge runs diagonally through that corner and on past it (Hyllian's lv1 restriction:
// small blocks and single pixels keep their corners) — a 45° cut, or the 30° / 60° lines of a 2:1
// staircase — towards the more similar of the corner's two neighbours. Edges are smoothed at any
// magnification; texel centres keep their colour (one-pixel details stay).
//
// Colours are compared by a weighted distance on a perceptual key (√rgb, alpha): the atlas stores linear
// colour, and dark palette shades differ little in linear terms. The CPU reference applies it to the
// texel values as given (as the shader does to what it fetches).

/** "Equal" threshold of the weighted colour distance, and the lv2 (2:1 staircase) slope coefficient. */
export const XBR = { eq: 0.06, coef: 2.0 };
/** Comparisons whose two sides are mathematically equal resolve the same way on the CPU (float64) and the GPU
 *  (float32): the left side must win by more than this. */
export const XBR_TIE = 1e-4;

/**
 * The three lines of a corner, in its frame (f = the sample's position in the texel, the corner at +x/+y): the 45°
 * cut x + y = 1.5 and the lv2 30° line y + x/2 = 1 and 60° line 2x + y = 2. The blend's half-width δ is given in
 * the 45° line's units (its value changes by 2δ across ~one screen px): `k30` / `k60` scale it by the other lines'
 * gradient norms over the 45° line's (√1.25 / √2, √5 / √2), so every line blends over the same screen width; `cap*`
 * keep each band short of the texel centre (0.5, 0.5), where the lines' values are 1.0, 0.75 and 1.5: centres keep
 * their colour whatever δ.
 */
export const XBR_LINES = { k30: Math.sqrt(1.25 / 2), k60: Math.sqrt(5 / 2), cap45: 0.5, cap30: 0.25, cap60: 0.5 };

/** The blend half-widths of the 45°, 30° and 60° lines for a δ in the 45° line's units (XBR_LINES). */
export function xbrLineDeltas(delta: number): [number, number, number] {
  return [Math.min(delta, XBR_LINES.cap45), Math.min(delta * XBR_LINES.k30, XBR_LINES.cap30), Math.min(delta * XBR_LINES.k60, XBR_LINES.cap60)];
}

/** GLSL's smoothstep; with e1 ≤ e0 (a blend width ≤ 0) a hard step at their middle (GLSL leaves it undefined). */
const smoothstep = (e0: number, e1: number, x: number): number => {
  if (!(e1 > e0)) return x < (e0 + e1) / 2 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Weighted distance of two keys (√r, √g, √b, a): luma weights on the colour, alpha counted fully. */
const xbrDf = (a: Float64Array, b: Float64Array): number =>
  0.299 * Math.abs(a[0] - b[0]) + 0.587 * Math.abs(a[1] - b[1]) + 0.114 * Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);

/**
 * One corner in its own frame (the corner at +x/+y; B, D, C, G, F4, I4, H5, I5 named as in xBR); `fx`, `fy`:
 * the sample's position in the texel in that frame. Returns [coverage, 1 when the blend goes towards F, 0: H].
 */
function xbrCorner(E: Float64Array, F: Float64Array, H: Float64Array, I: Float64Array, B: Float64Array, D: Float64Array,
  C: Float64Array, G: Float64Array, F4: Float64Array, I4: Float64Array, H5: Float64Array, I5: Float64Array,
  fx: number, fy: number, d: number): [number, number] {
  const dEF = xbrDf(E, F), dEH = xbrDf(E, H);
  if (dEF <= XBR.eq || dEH <= XBR.eq) return [0, 0];
  // (each line's own half-width: XBR_LINES)
  const [d45, d30, d60] = xbrLineDeltas(d);
  // (none of the three lines reaches this sample: no coverage, whatever the edge)
  if (fx + fy <= 1.5 - d45 && fy + 0.5 * fx <= 1.0 - d30 && 2.0 * fx + fy <= 2.0 - d60) return [0, 0];
  // lv1: only where the edge runs on (past F or H, or E continues diagonally): small blocks, single pixels and
  // their highlights keep their corners (rounding them all thins light details inside dark outlines)
  const eq = (a: Float64Array, b: Float64Array) => xbrDf(a, b) <= XBR.eq;
  const runsOn = (!eq(F, B) && !eq(F, C)) || (!eq(H, D) && !eq(H, G))
    || (eq(E, I) && ((!eq(F, F4) && !eq(F, I4)) || (!eq(H, H5) && !eq(H, I5)))) || eq(E, G) || eq(E, C);
  if (!runsOn) return [0, 0];
  const edge = xbrDf(E, C) + xbrDf(E, G) + xbrDf(I, H5) + xbrDf(I, F4) + 4.0 * xbrDf(H, F) + XBR_TIE
    < xbrDf(H, D) + xbrDf(H, I5) + xbrDf(F, I4) + xbrDf(F, B) + 4.0 * xbrDf(E, I);
  if (!edge) return [0, 0];
  const dFG = xbrDf(F, G), dHC = xbrDf(H, C);
  let cov = smoothstep(1.5 - d45, 1.5 + d45, fx + fy);
  // lv2: a 30° line into G's side, a 60° line into C's side
  if (XBR.coef * dFG <= dHC + XBR_TIE && xbrDf(E, G) > XBR.eq && xbrDf(D, G) > XBR.eq) cov = Math.max(cov, smoothstep(1.0 - d30, 1.0 + d30, fy + 0.5 * fx));
  if (XBR.coef * dHC <= dFG + XBR_TIE && xbrDf(E, C) > XBR.eq && xbrDf(B, C) > XBR.eq) cov = Math.max(cov, smoothstep(2.0 - d60, 2.0 + d60, 2.0 * fx + fy));
  return [cov, dEF <= dEH + XBR_TIE ? 1 : 0];
}

/**
 * The xBR-smoothed colour (RGBA 0..1) of `src` (w×h, 0xAABBGGRR, rows in order of y) at continuous texel
 * coordinates (x, y) (texel centres at k + 0.5). `delta`: half-width of the blend across an edge (in units of
 * the texel's diagonal coordinate x + y, ~ one screen pixel; each line scales it to its own slope, XBR_LINES; ≤ 0:
 * a hard step). `rect` = [x0, y0, x1, y1) in texels: texels outside it
 * (and outside the image) read as transparent black. Where transparent texels blend with opaque ones the
 * colour comes out premultiplied (as the GPU's mix of them does).
 */
export function xbrSample(src: Uint32Array, w: number, h: number, x: number, y: number, delta: number,
  rect: [number, number, number, number] = [0, 0, w, h]): [number, number, number, number] {
  const x0 = Math.max(0, rect[0]), y0 = Math.max(0, rect[1]), x1 = Math.min(w, rect[2]), y1 = Math.min(h, rect[3]);
  const ex = Math.floor(x), ey = Math.floor(y);
  const fx = x - ex, fy = y - ey;
  const color = (dx: number, dy: number): number[] => {
    const tx = ex + dx, ty = ey + dy;
    if (tx < x0 || ty < y0 || tx >= x1 || ty >= y1) return [0, 0, 0, 0];
    const v = src[ty * w + tx];
    return [(v & 0xff) / 255, ((v >>> 8) & 0xff) / 255, ((v >>> 16) & 0xff) / 255, (v >>> 24) / 255];
  };
  const keyOf = (c: number[]) => Float64Array.of(Math.sqrt(c[0]), Math.sqrt(c[1]), Math.sqrt(c[2]), c[3]);
  const key = (dx: number, dy: number) => keyOf(color(dx, dy));
  const cE = color(0, 0), cF = color(1, 0), cH = color(0, 1), cD = color(-1, 0), cB = color(0, -1);
  const E = keyOf(cE), F = keyOf(cF), H = keyOf(cH), D = keyOf(cD), B = keyOf(cB);
  const nF = xbrDf(E, F) > XBR.eq, nH = xbrDf(E, H) > XBR.eq, nD = xbrDf(E, D) > XBR.eq, nB = xbrDf(E, B) > XBR.eq;
  // every corner needs both of its sides to differ from E: when none can, E stands as it is
  if (!((nF || nD) && (nH || nB))) return [cE[0], cE[1], cE[2], cE[3]];
  const kmm = key(-1, -1), kpm = key(1, -1), kmp = key(-1, 1), kpp = key(1, 1);
  const km20 = key(-2, 0), kp20 = key(2, 0), k0m2 = key(0, -2), k0p2 = key(0, 2);
  const km2m = key(-2, -1), km2p = key(-2, 1), kp2m = key(2, -1), kp2p = key(2, 1);
  const km1m2 = key(-1, -2), kp1m2 = key(1, -2), km1p2 = key(-1, 2), kp1p2 = key(1, 2);
  // the four corners in a fixed order, each in its frame (mirrored: the rule is symmetric under transposition)
  const corners: [[number, number], number[], number[]][] = [
    [xbrCorner(E, F, H, kpp, B, D, kpm, kmp, kp20, kp2p, k0p2, kp1p2, fx, fy, delta), cF, cH],          // +x +y
    [xbrCorner(E, D, H, kmp, B, F, kmm, kpp, km20, km2p, k0p2, km1p2, 1 - fx, fy, delta), cD, cH],      // −x +y
    [xbrCorner(E, F, B, kpm, H, D, kpp, kmm, kp20, kp2m, k0m2, kp1m2, fx, 1 - fy, delta), cF, cB],      // +x −y
    [xbrCorner(E, D, B, kmm, H, F, kmp, kpm, km20, km2m, k0m2, km1m2, 1 - fx, 1 - fy, delta), cD, cB],  // −x −y
  ];
  const out = [cE[0], cE[1], cE[2], cE[3]];
  for (const [[cov, towardsF], sideF, sideH] of corners) {
    if (cov <= 0) continue;
    const px = towardsF ? sideF : sideH;
    for (let i = 0; i < 4; i++) out[i] = out[i] * (1 - cov) + px[i] * cov; // (GLSL mix)
  }
  return [out[0], out[1], out[2], out[3]];
}
