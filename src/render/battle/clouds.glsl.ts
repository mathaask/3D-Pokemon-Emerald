// The battle's soft clouds, one definition shared by the sky (Task 7: drawn along skyCloudUv), the arena ground's drifting
// cloud shadows (parts/ground.ts) and the arena water's reflections (Task 8). Needs KIT_NOISE_GLSL before it (every kit
// material's fragment prelude has it).

export const CLOUD_GLSL = /* glsl */ `
// Cloud coverage at p (0 clear .. 1 overcast): a two-octave fbm (kitFbm2's first two octaves, renormalised) domain-warped
// along a diagonal by one value noise — soft, billowy edges, no grid look — cut to broad patches. Three noise lookups:
// the ground pays them on every outdoor pixel (kitFbm2's finer octaves were ~0.3 ms of detail no cloud shadow shows).
float arenaClouds(vec2 p) {
  float w = kitNoise2(p * 0.9 + 3.7) - 0.5;
  vec2 q = p + vec2(w, -w) * 1.4;
  float f = (0.5 * kitNoise2(q) + 0.25 * kitNoise2(q * 2.03 + 17.1)) / 0.75;
  return smoothstep(0.5, 0.75, f);
}
// Where a view direction meets the cloud layer, drifting with time (the sky's cloud uv; a direction below the horizon
// lands far out, never divides by zero).
vec2 skyCloudUv(vec3 dir, float time) {
  return dir.xz / max(dir.y + 0.15, 0.05) * 0.54 + time * vec2(0.004, 0.002);
}
`;
