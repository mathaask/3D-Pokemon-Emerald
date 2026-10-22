// Scale-free xBR (lv2) in GLSL: the inflated actors' HD sprite edges. The same steps, constants and corner
// order as the CPU reference xbrSample (kit/upscale.ts), which the self-test (xbrSelfTest) checks it
// against. Evaluated at the fragment's continuous texel position, so staircases and silhouettes become
// smooth lines at any magnification; texel centres keep their colour.
//
// Cost: the four texels beside E decide first — every corner needs both of its sides to differ from E, so
// when none can (flat areas, straight edges, most of a sprite) E is returned after 5 fetches. Otherwise the
// 21-texel neighbourhood (5×5 without its corners) is fetched once and shared by the four corners; a corner
// none of whose lines reaches the sample is skipped before its edge rule.

import { XBR, XBR_LINES, XBR_TIE } from '../kit/upscale';
import { glslFloat } from './glsl';

/**
 * Defines `vec4 xbrSample(sampler2D tex, vec2 p, vec4 rect, float delta)`: the xBR-smoothed colour of `tex`
 * at texel coordinates `p` (texel centres at k + 0.5, texelFetch's rows); `rect` = x0, y0, x1, y1 in texels
 * (integers; [x0, x1) × [y0, y1)), texels outside it read as transparent black; `delta`: the blend's
 * half-width across an edge (the 45° line's; each line scales it to its slope, XBR_LINES). Blends with transparent
 * texels come out premultiplied.
 */
export const XBR_GLSL = /* glsl */ `
const float XBR_EQ = ${glslFloat(XBR.eq)};
const float XBR_COEF = ${glslFloat(XBR.coef)};
const float XBR_TIE = ${glslFloat(XBR_TIE)};
// each line's blend half-width: δ scaled by its gradient norm over the 45° line's, capped short of the texel centre
const float XBR_K30 = ${glslFloat(XBR_LINES.k30)};
const float XBR_K60 = ${glslFloat(XBR_LINES.k60)};
// weighted distance of two keys (sqrt rgb, a): luma weights on the colour, alpha counted fully
float xbrDf(vec4 a, vec4 b) {
  vec4 d = abs(a - b);
  return 0.299 * d.r + 0.587 * d.g + 0.114 * d.b + d.a;
}
vec4 xbrKey(vec4 c) {
  return vec4(sqrt(c.rgb), c.a);
}
// texel q when inside r ([r.xy, r.zw)), else transparent black (the clamp keeps the fetch inside the texture)
vec4 xbrFetch(sampler2D tex, ivec2 q, ivec4 r) {
  vec4 c = texelFetch(tex, clamp(q, r.xy, r.zw - 1), 0);
  return all(greaterThanEqual(q, r.xy)) && all(lessThan(q, r.zw)) ? c : vec4(0.0);
}
vec4 xbrKeyAt(sampler2D tex, ivec2 q, ivec4 r) {
  return xbrKey(xbrFetch(tex, q, r));
}
// one corner in its own frame (the corner at +x/+y): x = coverage, y = 1 when the blend goes towards F, 0: H
vec2 xbrCorner(vec4 kE, vec4 kF, vec4 kH, vec4 kI, vec4 kB, vec4 kD, vec4 kC, vec4 kG,
               vec4 kF4, vec4 kI4, vec4 kH5, vec4 kI5, vec2 f, float d) {
  float dEF = xbrDf(kE, kF), dEH = xbrDf(kE, kH);
  if (dEF <= XBR_EQ || dEH <= XBR_EQ) return vec2(0.0);
  // (none of the three lines reaches this sample: no coverage, whatever the edge)
  float d45 = min(d, ${glslFloat(XBR_LINES.cap45)}), d30 = min(d * XBR_K30, ${glslFloat(XBR_LINES.cap30)}), d60 = min(d * XBR_K60, ${glslFloat(XBR_LINES.cap60)});
  if (f.x + f.y <= 1.5 - d45 && f.y + 0.5 * f.x <= 1.0 - d30 && 2.0 * f.x + f.y <= 2.0 - d60) return vec2(0.0);
  // lv1: only where the edge runs on (past F or H, or E continues diagonally)
  bool runsOn = (xbrDf(kF, kB) > XBR_EQ && xbrDf(kF, kC) > XBR_EQ) || (xbrDf(kH, kD) > XBR_EQ && xbrDf(kH, kG) > XBR_EQ)
    || (xbrDf(kE, kI) <= XBR_EQ && ((xbrDf(kF, kF4) > XBR_EQ && xbrDf(kF, kI4) > XBR_EQ) || (xbrDf(kH, kH5) > XBR_EQ && xbrDf(kH, kI5) > XBR_EQ)))
    || xbrDf(kE, kG) <= XBR_EQ || xbrDf(kE, kC) <= XBR_EQ;
  if (!runsOn) return vec2(0.0);
  bool edge = xbrDf(kE, kC) + xbrDf(kE, kG) + xbrDf(kI, kH5) + xbrDf(kI, kF4) + 4.0 * xbrDf(kH, kF) + XBR_TIE
            < xbrDf(kH, kD) + xbrDf(kH, kI5) + xbrDf(kF, kI4) + xbrDf(kF, kB) + 4.0 * xbrDf(kE, kI);
  if (!edge) return vec2(0.0);
  float dFG = xbrDf(kF, kG), dHC = xbrDf(kH, kC);
  float cov = smoothstep(1.5 - d45, 1.5 + d45, f.x + f.y);
  // lv2: a 30° line into G's side, a 60° line into C's side
  if (XBR_COEF * dFG <= dHC + XBR_TIE && xbrDf(kE, kG) > XBR_EQ && xbrDf(kD, kG) > XBR_EQ) cov = max(cov, smoothstep(1.0 - d30, 1.0 + d30, f.y + 0.5 * f.x));
  if (XBR_COEF * dHC <= dFG + XBR_TIE && xbrDf(kE, kC) > XBR_EQ && xbrDf(kB, kC) > XBR_EQ) cov = max(cov, smoothstep(2.0 - d60, 2.0 + d60, 2.0 * f.x + f.y));
  return vec2(cov, dEF <= dEH + XBR_TIE ? 1.0 : 0.0);
}
vec4 xbrSample(sampler2D tex, vec2 p, vec4 rect, float delta) {
  ivec4 r = ivec4(floor(rect + 0.5)); // (an interpolated varying: integers up to rounding)
  vec2 pf = floor(p);
  ivec2 e = ivec2(pf);
  vec2 f = p - pf;
  vec4 cE = xbrFetch(tex, e, r), cF = xbrFetch(tex, e + ivec2(1, 0), r), cH = xbrFetch(tex, e + ivec2(0, 1), r);
  vec4 cD = xbrFetch(tex, e + ivec2(-1, 0), r), cB = xbrFetch(tex, e + ivec2(0, -1), r);
  vec4 kE = xbrKey(cE), kF = xbrKey(cF), kH = xbrKey(cH), kD = xbrKey(cD), kB = xbrKey(cB);
  bool nF = xbrDf(kE, kF) > XBR_EQ, nH = xbrDf(kE, kH) > XBR_EQ, nD = xbrDf(kE, kD) > XBR_EQ, nB = xbrDf(kE, kB) > XBR_EQ;
  // every corner needs both of its sides to differ from E: when none can, E stands as it is
  if (!((nF || nD) && (nH || nB))) return cE;
  vec4 kmm = xbrKeyAt(tex, e + ivec2(-1, -1), r), kpm = xbrKeyAt(tex, e + ivec2(1, -1), r);
  vec4 kmp = xbrKeyAt(tex, e + ivec2(-1, 1), r), kpp = xbrKeyAt(tex, e + ivec2(1, 1), r);
  vec4 km20 = xbrKeyAt(tex, e + ivec2(-2, 0), r), kp20 = xbrKeyAt(tex, e + ivec2(2, 0), r);
  vec4 k0m2 = xbrKeyAt(tex, e + ivec2(0, -2), r), k0p2 = xbrKeyAt(tex, e + ivec2(0, 2), r);
  vec4 km2m = xbrKeyAt(tex, e + ivec2(-2, -1), r), km2p = xbrKeyAt(tex, e + ivec2(-2, 1), r);
  vec4 kp2m = xbrKeyAt(tex, e + ivec2(2, -1), r), kp2p = xbrKeyAt(tex, e + ivec2(2, 1), r);
  vec4 km1m2 = xbrKeyAt(tex, e + ivec2(-1, -2), r), kp1m2 = xbrKeyAt(tex, e + ivec2(1, -2), r);
  vec4 km1p2 = xbrKeyAt(tex, e + ivec2(-1, 2), r), kp1p2 = xbrKeyAt(tex, e + ivec2(1, 2), r);
  // the four corners in a fixed order, each in its frame (mirrored: the rule is symmetric under transposition)
  vec4 c = cE;
  vec2 v = xbrCorner(kE, kF, kH, kpp, kB, kD, kpm, kmp, kp20, kp2p, k0p2, kp1p2, f, delta);              // +x +y
  c = mix(c, v.y > 0.5 ? cF : cH, v.x);
  v = xbrCorner(kE, kD, kH, kmp, kB, kF, kmm, kpp, km20, km2p, k0p2, km1p2, vec2(1.0 - f.x, f.y), delta); // -x +y
  c = mix(c, v.y > 0.5 ? cD : cH, v.x);
  v = xbrCorner(kE, kF, kB, kpm, kH, kD, kpp, kmm, kp20, kp2m, k0m2, kp1m2, vec2(f.x, 1.0 - f.y), delta); // +x -y
  c = mix(c, v.y > 0.5 ? cF : cB, v.x);
  v = xbrCorner(kE, kD, kB, kmm, kH, kF, kmp, kpm, km20, km2m, k0m2, km1m2, 1.0 - f, delta);             // -x -y
  c = mix(c, v.y > 0.5 ? cD : cB, v.x);
  return c;
}
`;
