// Four 16-bit timers with prescalers and cascade (count-up) mode.
// Counters are evaluated lazily from the global cycle count; overflows are
// scheduled events processed by the Gba scheduler.

const PRESCALE_SHIFT = [0, 6, 8, 10];

export interface TimerHost {
  readonly now: number;
  raiseIrq(bit: number): void;
  onTimerOverflow(timer: number, at: number): void;
  requestReschedule(): void;
}

export class Timers {
  readonly reload = new Uint16Array(4);
  readonly control = new Uint16Array(4);
  /** Counter value at `base` cycles (for running, non-cascade timers). */
  readonly counter = new Int32Array(4);
  readonly base = new Float64Array(4);
  readonly nextOverflow = new Float64Array(4).fill(Infinity);

  constructor(private host: TimerHost) {}

  reset(): void {
    this.reload.fill(0);
    this.control.fill(0);
    this.counter.fill(0);
    this.base.fill(0);
    this.nextOverflow.fill(Infinity);
  }

  private running(n: number): boolean {
    return (this.control[n] & 0x80) !== 0;
  }

  private cascade(n: number): boolean {
    return n > 0 && (this.control[n] & 0x04) !== 0;
  }

  /** Current counter value as seen by the CPU. */
  read(n: number): number {
    if (!this.running(n) || this.cascade(n)) return this.counter[n] & 0xffff;
    const shift = PRESCALE_SHIFT[this.control[n] & 3];
    const elapsed = Math.floor((this.host.now - this.base[n]) / (1 << shift));
    return (this.counter[n] + elapsed) & 0xffff;
  }

  writeReload(n: number, v: number): void {
    this.reload[n] = v;
  }

  writeControl(n: number, v: number): void {
    const now = this.host.now;
    const wasRunning = this.running(n);
    // Freeze the current count before changing anything.
    if (wasRunning && !this.cascade(n)) {
      this.counter[n] = this.read(n);
      this.base[n] = now;
    }
    this.control[n] = v & 0xc7;
    const nowRunning = this.running(n);
    if (nowRunning && !wasRunning) {
      this.counter[n] = this.reload[n];
      this.base[n] = now;
    }
    this.schedule(n);
    this.host.requestReschedule();
  }

  private schedule(n: number): void {
    if (!this.running(n) || this.cascade(n)) {
      this.nextOverflow[n] = Infinity;
      return;
    }
    const shift = PRESCALE_SHIFT[this.control[n] & 3];
    // Align to the prescaler's tick: base marks the moment counter[n] was valid.
    this.nextOverflow[n] = this.base[n] + (0x10000 - this.counter[n]) * (1 << shift);
  }

  nextEvent(): number {
    const o = this.nextOverflow;
    return Math.min(o[0], o[1], o[2], o[3]);
  }

  /** Processes all overflows scheduled at or before `now`, in time order. */
  process(now: number): void {
    for (;;) {
      let n = -1;
      let t = Infinity;
      for (let k = 0; k < 4; k++) {
        if (this.nextOverflow[k] <= now && this.nextOverflow[k] < t) { t = this.nextOverflow[k]; n = k; }
      }
      if (n < 0) return;
      this.counter[n] = this.reload[n];
      this.base[n] = t;
      this.schedule(n);
      this.overflow(n, t);
    }
  }

  private overflow(n: number, at: number): void {
    if (this.control[n] & 0x40) this.host.raiseIrq(1 << (3 + n));
    this.host.onTimerOverflow(n, at);
    // Cascade into the next timer.
    if (n < 3 && this.running(n + 1) && this.cascade(n + 1)) {
      const next = (this.counter[n + 1] + 1) & 0x1ffff;
      if (next > 0xffff) {
        this.counter[n + 1] = this.reload[n + 1];
        this.overflow(n + 1, at);
      } else {
        this.counter[n + 1] = next;
      }
    }
  }

  serialize(): Float64Array {
    const out = new Float64Array(4 * 5);
    for (let n = 0; n < 4; n++) {
      out[n * 5] = this.reload[n];
      out[n * 5 + 1] = this.control[n];
      out[n * 5 + 2] = this.counter[n];
      out[n * 5 + 3] = this.base[n];
      out[n * 5 + 4] = this.nextOverflow[n];
    }
    return out;
  }

  deserialize(d: Float64Array): void {
    for (let n = 0; n < 4; n++) {
      this.reload[n] = d[n * 5];
      this.control[n] = d[n * 5 + 1];
      this.counter[n] = d[n * 5 + 2];
      this.base[n] = d[n * 5 + 3];
      this.nextOverflow[n] = d[n * 5 + 4];
    }
  }
}
