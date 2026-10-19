// GLSL helpers shared by kit shaders (ground, water, patterns, fade).

export const KIT_NOISE_GLSL = /* glsl */ `
float kitHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 kitHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float kitNoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = kitHash12(i), b = kitHash12(i + vec2(1.0, 0.0));
  float c = kitHash12(i + vec2(0.0, 1.0)), d = kitHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float kitFbm2(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * kitNoise2(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s / 0.9375;
}
// x: distance to the nearest cell border (F2 - F1), y: random id of the nearest cell.
vec2 kitVoronoi(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      float d = length(g + kitHash22(i + g) - f);
      if (d < d1) { d2 = d1; d1 = d; id = kitHash12(i + g + 7.7); }
      else if (d < d2) { d2 = d; }
    }
  }
  return vec2(d2 - d1, id);
}
float kitBayer4(vec2 p) {
  ivec2 q = ivec2(mod(floor(p), 4.0));
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[q.x + q.y * 4]) + 0.5) / 16.0;
}
vec3 kitSrgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
`;
