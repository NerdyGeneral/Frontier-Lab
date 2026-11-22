type Speed = 1 | 2 | 5;
export class BrowserClock {
  private paused = true;
  private speed: Speed = 1;
  private last: number | null = null;
  private elapsed = 0;
  private disposed = false;
  private onWeek: () => void;
  private onVisibilityPause?: () => void;
  constructor(options: { onWeek: () => void; onVisibilityPause?: () => void }) { this.onWeek = options.onWeek; this.onVisibilityPause = options.onVisibilityPause; }
  setPaused(paused: boolean): void { if (this.paused !== paused) this.last = null; this.paused = paused; }
  setSpeed(speed: Speed): void { if (![1, 2, 5].includes(speed)) throw new Error('Unsupported speed.'); this.speed = speed; this.last = null; }
  reset(timestamp?: number): void { this.last = timestamp ?? null; this.elapsed = 0; }
  pulse(timestamp: number, visible = true): void {
    if (this.disposed || !Number.isFinite(timestamp)) return;
    if (!visible) {
      const wasRunning = !this.paused;
      this.paused = true; this.last = null; this.elapsed = 0;
      if (wasRunning) this.onVisibilityPause?.();
      return;
    }
    if (this.paused) { this.last = null; return; }
    if (this.last === null) { this.last = timestamp; return; }
    const delta = timestamp - this.last; this.last = timestamp;
    if (delta < 0 || delta > 2000) { this.elapsed = 0; return; }
    this.elapsed += delta * this.speed;
    while (this.elapsed >= 10000 && !this.paused && !this.disposed) { this.elapsed -= 10000; this.onWeek(); }
  }
  dispose(): void { this.disposed = true; this.paused = true; this.last = null; this.elapsed = 0; }
}
