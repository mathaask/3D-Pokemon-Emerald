// GPU frame timing for the harnesses (live `emu.gpuFrames`, map preview `preview.gpuFrames`):
// an EXT_disjoint_timer_query_webgl2 query around each frame's render and a 1-pixel readPixels
// sync after it; medians of the batch.

export interface GpuTiming {
  /** Median GPU ms of the timed part, its 90th percentile, and the median CPU ms of it. */
  gpuMs: number;
  gpuP90: number;
  cpuMs: number;
}

/** Median and 90th percentile (upper element) of a list of numbers. */
export function percentiles(xs: number[]): { p50: number; p90: number } {
  const s = [...xs].sort((a, b) => a - b);
  return { p50: s[s.length >> 1], p90: s[Math.floor(s.length * 0.9)] };
}

type TimerExt = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/**
 * Runs n frames: `prepare` (untimed, e.g. emulating), then `render` inside a GPU timer query and the
 * CPU clock. A disjoint batch (GPU clock change, context switch) is discarded and measured again,
 * up to 3 attempts. Throws without the extension or when results never arrive (10 s).
 */
export async function timeGpuFrames(gl: WebGL2RenderingContext, n: number, render: () => void,
  prepare?: () => void): Promise<GpuTiming> {
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null;
  if (!ext) throw new Error('EXT_disjoint_timer_query_webgl2 is not available');
  const px = new Uint8Array(4);
  for (let attempt = 0; attempt < 3; attempt++) {
    gl.getParameter(ext.GPU_DISJOINT_EXT); // (reading clears the flag)
    const queries: WebGLQuery[] = [];
    const cpu: number[] = [];
    for (let i = 0; i < n; i++) {
      prepare?.();
      const query = gl.createQuery();
      gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
      const t0 = performance.now();
      render();
      cpu.push(performance.now() - t0);
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      queries.push(query);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // (waits for the GPU)
    }
    // query results become available only after control returns to the browser
    const deadline = performance.now() + 10_000;
    while (!queries.every((q) => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE))) {
      if (performance.now() > deadline) throw new Error('GPU timer query results never became available');
      await new Promise((r) => setTimeout(r, 20));
    }
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    const gpu = queries.map((q) => (gl.getQueryParameter(q, gl.QUERY_RESULT) as number) / 1e6);
    for (const q of queries) gl.deleteQuery(q);
    if (disjoint) continue;
    const g = percentiles(gpu);
    return { gpuMs: g.p50, gpuP90: g.p90, cpuMs: percentiles(cpu).p50 };
  }
  throw new Error('GPU timer queries disjoint in 3 attempts');
}
