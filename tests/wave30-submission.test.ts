import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserTaskGate } from '../src/persistence/browser-task';

function deferredScheduler() {
  const callbacks: Array<() => void> = [];
  const cancelled: number[] = [];
  return {
    callbacks, cancelled,
    schedule(run: () => void) {
      const index = callbacks.push(run) - 1;
      return () => { cancelled.push(index); };
    },
  };
}

test('W30-B01: cancelling a pending submission acknowledges cancellation exactly once', () => {
  const gate = new BrowserTaskGate(), scheduled = deferredScheduler();
  let cancellationCount = 0, applied = 0;
  assert.equal(gate.start(scheduled.schedule, () => { applied += 1; }, () => { cancellationCount += 1; }), true);
  assert.equal(gate.busy, true);
  assert.equal(gate.cancel(), true);
  assert.equal(gate.busy, false);
  assert.deepEqual(scheduled.cancelled, [0]);
  assert.equal(cancellationCount, 1);
  assert.equal(gate.cancel(), false);
  scheduled.callbacks[0]();
  scheduled.callbacks[0]();
  assert.equal(applied, 0, 'A late scheduler callback cannot execute cancelled work');
  assert.equal(cancellationCount, 1, 'Repeated cancel or late delivery cannot settle the acknowledgement twice');
});

test('W30-B02: a cancelled task cannot cancel or complete a later company submission', () => {
  const gate = new BrowserTaskGate(), scheduled = deferredScheduler();
  const receipts: string[] = [];
  gate.start(scheduled.schedule, () => receipts.push('old accepted'), () => receipts.push('old cancelled'));
  assert.equal(gate.cancel(), true);
  gate.start(scheduled.schedule, () => receipts.push('new accepted'), () => receipts.push('new cancelled'));
  scheduled.callbacks[0]();
  assert.equal(gate.busy, true);
  assert.deepEqual(receipts, ['old cancelled']);
  scheduled.callbacks[1]();
  assert.equal(gate.busy, false);
  assert.deepEqual(receipts, ['old cancelled', 'new accepted']);
  assert.equal(gate.cancel(), false);
  assert.deepEqual(receipts, ['old cancelled', 'new accepted']);
});

test('W30-B03: executing and completed submissions never receive a cancellation acknowledgement', () => {
  const gate = new BrowserTaskGate(), scheduled = deferredScheduler();
  let cancellations = 0, applied = 0;
  gate.start(scheduled.schedule, () => {
    assert.equal(gate.cancel(), false, 'Running synchronous work stays atomic');
    assert.equal(gate.busy, true);
    applied += 1;
  }, () => { cancellations += 1; });
  scheduled.callbacks[0]();
  assert.equal(applied, 1);
  assert.equal(gate.busy, false);
  assert.equal(gate.cancel(), false);
  assert.equal(cancellations, 0);
  assert.deepEqual(scheduled.cancelled, []);
});

test('W30-B04: a scheduling exception releases admission and cannot leak its callback into the next submission', () => {
  const gate = new BrowserTaskGate(), scheduled = deferredScheduler();
  let oldCancellations = 0, nextCancellations = 0;
  assert.throws(() => gate.start(() => { throw new Error('Scheduler unavailable'); }, noOperation,
    () => { oldCancellations += 1; }), /Scheduler unavailable/);
  assert.equal(gate.busy, false);
  assert.equal(gate.cancel(), false);
  const afterFailure = oldCancellations;
  assert.equal(gate.start(scheduled.schedule, noOperation, () => { nextCancellations += 1; }), true);
  assert.equal(gate.cancel(), true);
  assert.equal(nextCancellations, 1);
  assert.equal(oldCancellations, afterFailure, 'A later cancel cannot invoke the failed operation handler');
  assert.equal(gate.busy, false);
});

function noOperation(): never { assert.fail('This deferred operation must not execute'); }
