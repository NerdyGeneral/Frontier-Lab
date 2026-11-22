/** Admit one deferred UI operation at a time. The scheduler gives the browser
 * a paint before synchronous simulation work; it never advances game time. */
export class BrowserTaskGate {
  private current: { running: boolean; cancel: (() => void) | null; onCancel?: () => void } | null = null;

  get busy(): boolean { return this.current !== null; }

  start(schedule: (run: () => void) => () => void, operation: () => void, onCancel?: () => void): boolean {
    if (this.current) return false;
    const task = { running: false, cancel: null as (() => void) | null, onCancel };
    this.current = task;
    try {
      task.cancel = schedule(() => {
        if (this.current !== task) return;
        task.running = true;
        try { operation(); }
        finally { if (this.current === task) this.current = null; }
      });
    } catch (error) {
      if (this.current === task) this.current = null;
      throw error;
    }
    return true;
  }

  /** Cancels work that has not begun. A running synchronous step stays atomic. */
  cancel(): boolean {
    const task = this.current;
    if (!task || task.running) return false;
    this.current = null;
    try { task.cancel?.(); }
    finally { task.onCancel?.(); }
    return true;
  }
}

/** requestAnimationFrame runs before paint, so the task starts in a later task. */
export function afterBrowserPaint(operation: () => void): () => void {
  let timer: number | undefined;
  const frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(operation, 0);
  });
  return () => {
    window.cancelAnimationFrame(frame);
    if (timer !== undefined) window.clearTimeout(timer);
  };
}
