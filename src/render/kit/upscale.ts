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
