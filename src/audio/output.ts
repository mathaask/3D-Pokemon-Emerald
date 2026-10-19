// Streams APU samples to an AudioWorklet. The worklet resamples very slightly
// (±0.5 %) based on its queue depth so emulation and audio clocks never drift apart.

const WORKLET_SOURCE = `
class GbaOutput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0;
    this.queued = 0;
    this.pos = 0;
    this.last = [0, 0];
    this.target = 2048;
    this.volume = 1;
    this.counter = 0;
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.samples) { this.chunks.push(d.samples); this.queued += d.samples.length / 2; }
      if (d.volume !== undefined) this.volume = d.volume;
      if (d.target !== undefined) this.target = d.target;
      if (d.flush) { this.chunks = []; this.queued = 0; this.offset = 0; }
      // Hard cap: drop the oldest audio if we fall far behind.
      while (this.queued > this.target * 4 && this.chunks.length > 1) {
        const c = this.chunks.shift();
        this.queued -= (c.length - this.offset) / 2;
        this.offset = 0;
      }
    };
  }
  next() {
    while (this.chunks.length && this.offset >= this.chunks[0].length) { this.chunks.shift(); this.offset = 0; }
    if (!this.chunks.length) return false;
    const c = this.chunks[0];
    this.last[0] = c[this.offset];
    this.last[1] = c[this.offset + 1];
    this.offset += 2;
    this.queued--;
    return true;
  }
  process(_inputs, outputs) {
    const out = outputs[0];
    const L = out[0], R = out[1] || out[0];
    // Rate control: consume slightly faster when the queue is long, slower when short.
    const ratio = 1 + Math.max(-0.005, Math.min(0.005, (this.queued - this.target) / this.target * 0.005));
    for (let i = 0; i < L.length; i++) {
      this.pos += ratio;
      while (this.pos >= 1) { this.pos -= 1; this.next(); }
      L[i] = this.last[0] * this.volume;
      R[i] = this.last[1] * this.volume;
    }
    if (++this.counter % 8 === 0) this.port.postMessage({ queued: this.queued });
    return true;
  }
}
registerProcessor('gba-output', GbaOutput);
`;

export class AudioOutput {
  readonly ctx: AudioContext;
  private node: AudioWorkletNode | null = null;
  queued = 0;
  private scratch = new Float32Array(8192);
  ready = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  async init(): Promise<void> {
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.ctx, 'gba-output', { outputChannelCount: [2] });
    this.node.port.onmessage = (e) => { this.queued = e.data.queued; };
    this.node.connect(this.ctx.destination);
    this.node.port.postMessage({ target: Math.round(this.ctx.sampleRate * 0.05) });
    this.ready = true;
  }

  /** Resumes the context (browsers require a user gesture). */
  resume(): void {
    if (this.ctx.state !== 'running') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.node?.port.postMessage({ volume: v });
  }

  /** Pulls everything the APU produced and ships it to the worklet. */
  push(drain: (out: Float32Array) => number): void {
    if (!this.node) {
      while (drain(this.scratch) > 0) { /* discard */ }
      return;
    }
    for (;;) {
      const frames = drain(this.scratch);
      if (frames === 0) break;
      const chunk = this.scratch.slice(0, frames * 2);
      this.node.port.postMessage({ samples: chunk }, [chunk.buffer]);
      this.queued += frames;
    }
  }

  flush(): void {
    this.node?.port.postMessage({ flush: true });
    this.queued = 0;
  }
}
