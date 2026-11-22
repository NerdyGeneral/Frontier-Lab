import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTaskGate, afterBrowserPaint } from '../src/persistence/browser-task';

function scheduler() {
  const callbacks: (() => void)[] = [];
  let cancelled = 0;
  return {
    callbacks,
    schedule: (callback: () => void) => { callbacks.push(callback); return () => { cancelled += 1; }; },
    cancelled: () => cancelled,
  };
}

test('W29-B01: rapid repeated activation admits one deferred operation', () => {
  const gate = new BrowserTaskGate(), clock = scheduler();
  let weeks = 556;
  assert.equal(gate.start(clock.schedule, () => { weeks += 1; }), true);
  assert.equal(gate.busy, true);
  assert.equal(gate.start(clock.schedule, () => { weeks += 1; }), false);
  assert.equal(weeks, 556);
  assert.equal(clock.callbacks.length, 1);
  clock.callbacks[0]();
  assert.equal(weeks, 557);
  assert.equal(gate.busy, false);
  // A scheduler that delivers the same callback twice cannot apply twice.
  clock.callbacks[0]();
  assert.equal(weeks, 557);
});

test('W29-B02: hidden-page cancellation prevents an old callback from changing a later run', () => {
  const gate = new BrowserTaskGate(), clock = scheduler();
  const applied: string[] = [];
  gate.start(clock.schedule, () => applied.push('old company'));
  assert.equal(gate.cancel(), true);
  assert.equal(clock.cancelled(), 1);
  gate.start(clock.schedule, () => applied.push('new company'));
  clock.callbacks[0]();
  assert.deepEqual(applied, []);
  assert.equal(gate.busy, true);
  clock.callbacks[1]();
  assert.deepEqual(applied, ['new company']);
  assert.equal(gate.busy, false);
});

test('W29-B03: an executing step stays atomic and rejects reentrant work', () => {
  const gate = new BrowserTaskGate(), clock = scheduler();
  let committed = false;
  gate.start(clock.schedule, () => {
    assert.equal(gate.cancel(), false);
    assert.equal(gate.start(clock.schedule, () => assert.fail('reentrant action ran')), false);
    committed = true;
  });
  clock.callbacks[0]();
  assert.equal(committed, true);
  assert.equal(gate.busy, false);
});

test('W29-B04: failed work releases the admission guard for an explicit retry', () => {
  const gate = new BrowserTaskGate(), clock = scheduler();
  gate.start(clock.schedule, () => { throw new Error('operation failed'); });
  assert.throws(clock.callbacks[0], /operation failed/);
  assert.equal(gate.busy, false);
  let retried = false;
  assert.equal(gate.start(clock.schedule, () => { retried = true; }), true);
  clock.callbacks[1]();
  assert.equal(retried, true);
});

test('W29-B05: scheduler failure cannot leave the UI permanently busy', () => {
  const gate = new BrowserTaskGate();
  assert.throws(() => gate.start(() => { throw new Error('scheduler unavailable'); }, () => assert.fail('ran')), /scheduler unavailable/);
  assert.equal(gate.busy, false);
  assert.equal(gate.cancel(), false);
});

test('W29-B06: work waits for both a frame and a later browser task, and either stage cancels', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const frames = new Map<number, () => void>(), timers = new Map<number, () => void>();
  let sequence = 1, work = 0;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    requestAnimationFrame: (callback: () => void) => { const id = sequence++; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => { const id = sequence++; timers.set(id, callback); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  } });
  try {
    const cancelBeforeFrame = afterBrowserPaint(() => { work += 1; });
    cancelBeforeFrame();
    assert.equal(frames.size, 0);
    const cancelAfterFrame = afterBrowserPaint(() => { work += 1; });
    frames.values().next().value!(); frames.clear();
    assert.equal(work, 0);
    assert.equal(timers.size, 1);
    cancelAfterFrame();
    assert.equal(timers.size, 0);
    afterBrowserPaint(() => { work += 1; });
    frames.values().next().value!(); frames.clear();
    assert.equal(work, 0);
    timers.values().next().value!(); timers.clear();
    assert.equal(work, 1);
  } finally {
    if (original) Object.defineProperty(globalThis, 'window', original);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('W29-B07: deferred non-week work preserves partial clock progress without counting its wall time', async () => {
  const { BrowserClock } = await import('../src/core/clock');
  for (const operation of ['command', 'diagnostics']) {
    const gate = new BrowserTaskGate(), scheduled = scheduler();
    let weeks = 0, completed = 0;
    const clock = new BrowserClock({ onWeek: () => { weeks += 1; } });
    clock.setPaused(false);
    for (let timestamp = 0; timestamp <= 9_000; timestamp += 1_000) clock.pulse(timestamp);
    assert.equal(weeks, 0, operation + ' starts nine seconds into the week');

    clock.setPaused(true);
    assert.equal(gate.start(scheduled.schedule, () => {
      completed += 1;
      // Non-week operations resume the existing countdown. A settled week or
      // explicit visibility/manual reset has its own reset policy.
      clock.setPaused(false);
    }), true);
    clock.pulse(60_000);
    assert.equal(weeks, 0, 'paused work cannot create offline progress');
    scheduled.callbacks[0]();
    assert.equal(completed, 1);
    assert.equal(gate.busy, false);
    clock.pulse(90_000);
    clock.pulse(90_999);
    assert.equal(weeks, 0, 'resuming starts a fresh wall-clock baseline');
    clock.pulse(91_000);
    assert.equal(weeks, 1, operation + ' preserves the nine seconds already earned');
    clock.pulse(92_000);
    assert.equal(weeks, 1, 'deferred work cannot cause an extra catch-up week');
    clock.dispose();
  }
});
