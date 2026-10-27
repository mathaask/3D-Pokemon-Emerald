// The arena parts' mesh indexing: a polar surface (a centre and rings round it: the ground's disc, the platform tops, the
// dunes, the islets, the lava pools, the sea's sheet) and a band of rings (the platforms' sides, the ripple annulus, the
// stalagmites, the lava pools' banks). The winding decides which side faces up or out (back faces are culled): it is
// written here once.

/** The index of a band of `rows` rings of `segments` vertices each, closed round (segment `segments` is segment 0): vertex
 *  (k, s) at `base` + k × segments + s, ring by ring (`columns`: at `base` + s × rows + k, segment by segment, and indexed in
 *  that order). Each quad a = (k, s), b = (k, s + 1), c = (k + 1, s + 1), d = (k + 1, s) as the triangles a, b, c and a,
 *  c, d: with s turning counter-clockwise seen from above, a band whose ring k + 1 lies outside ring k (or below it) faces
 *  up (or out); `flip` (ring k + 1 above ring k: a, d, c and a, c, b) faces it the other way. Appended to `out`. */
export function ringBands(rows: number, segments: number,
  o: { base?: number; out?: number[]; flip?: boolean; columns?: boolean } = {}): number[] {
  const base = o.base ?? 0, out = o.out ?? [];
  const vi = o.columns ? (k: number, s: number) => base + (s % segments) * rows + k : (k: number, s: number) => base + k * segments + (s % segments);
  const quad = (k: number, s: number) => {
    const a = vi(k, s), b = vi(k, s + 1), c = vi(k + 1, s + 1), d = vi(k + 1, s);
    if (o.flip) out.push(a, d, c, a, c, b);
    else out.push(a, b, c, a, c, d);
  };
  if (o.columns) {
    for (let s = 0; s < segments; s++) for (let k = 0; k + 1 < rows; k++) quad(k, s);
  } else {
    for (let k = 0; k + 1 < rows; k++) for (let s = 0; s < segments; s++) quad(k, s);
  }
  return out;
}

/** The index of a polar surface: its centre at `base`, then `rings` rings of `segments` vertices (ring k = 1..rings from
 *  `base` + 1 + (k − 1) × segments), s turning counter-clockwise seen from above: a fan from the centre to ring 1, then
 *  the bands between the rings (ringBands) — facing up (+y). Appended to `out`. */
export function polarIndex(rings: number, segments: number, o: { base?: number; out?: number[] } = {}): number[] {
  const base = o.base ?? 0, out = o.out ?? [];
  for (let s = 0; s < segments; s++) out.push(base, base + 1 + ((s + 1) % segments), base + 1 + (s % segments));
  return ringBands(rings, segments, { base: base + 1, out });
}
