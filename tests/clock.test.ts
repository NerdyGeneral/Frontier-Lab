import test from 'node:test';
import assert from 'node:assert/strict';
import { BrowserClock } from '../src/core/clock';

function pulseSeconds(clock: BrowserClock, from: number, seconds: number, visible = true) {
  for (let step = 1; step <= seconds; step++) clock.pulse(from + step * 1000, visible);
}

test('W0-T01: clock starts paused and ten active seconds advance one week at 1x', () => {
  let weeks = 0;
  const clock = new BrowserClock({ onWeek: () => { weeks++; } });
  clock.pulse(0);
  pulseSeconds(clock, 0, 20);
  assert.equal(weeks, 0);
  clock.setPaused(false);
  clock.pulse(20_000);
  pulseSeconds(clock, 20_000, 9);
  assert.equal(weeks, 0);
  clock.pulse(30_000);
  assert.equal(weeks, 1);
  clock.dispose();
});

test('W0-T02: supported speeds change active-time rate without changing week size', () => {
  for (const [speed, seconds] of [[1, 10], [2, 5], [5, 2]] as const) {
    let weeks = 0;
    const clock = new BrowserClock({ onWeek: () => { weeks++; } });
    clock.setSpeed(speed);
    clock.setPaused(false);
    clock.pulse(0);
    pulseSeconds(clock, 0, seconds);
    assert.equal(weeks, 1, `${speed}x should advance one week in ${seconds} active seconds`);
    clock.dispose();
  }
});

test('W0-T03: hidden time pauses rather than catching up or resuming itself', () => {
  let weeks = 0;
  let visibilityPauses = 0;
  const clock = new BrowserClock({
    onWeek: () => { weeks++; },
    onVisibilityPause: () => { visibilityPauses++; },
  });
  clock.setPaused(false);
  clock.pulse(0);
  pulseSeconds(clock, 0, 4);
  clock.pulse(5000, false);
  pulseSeconds(clock, 5000, 60, false);
  clock.pulse(65_000, true);
  pulseSeconds(clock, 65_000, 10, true);
  assert.equal(weeks, 0);
  assert.equal(visibilityPauses, 1);
  clock.setPaused(false);
  clock.pulse(75_000, true);
  pulseSeconds(clock, 75_000, 10, true);
  assert.equal(weeks, 1);
  clock.dispose();
});

test('W0-T04: long scheduler suspension is discarded instead of creating overdue weeks', () => {
  let weeks = 0;
  const clock = new BrowserClock({ onWeek: () => { weeks++; } });
  clock.setPaused(false);
  clock.pulse(0);
  clock.pulse(1000);
  clock.pulse(61_000);
  assert.equal(weeks, 0);
  pulseSeconds(clock, 61_000, 10);
  assert.equal(weeks, 1);
  clock.dispose();
});

test('W0-T05: a speed change does not retroactively bill prior wall-clock time', () => {
  let weeks = 0;
  const clock = new BrowserClock({ onWeek: () => { weeks++; } });
  clock.setPaused(false);
  clock.pulse(0);
  pulseSeconds(clock, 0, 4);
  clock.setSpeed(5);
  clock.pulse(4000);
  assert.equal(weeks, 0);
  clock.pulse(5000);
  assert.equal(weeks, 0);
  clock.pulse(6000);
  assert.equal(weeks, 1);
  clock.dispose();
});

test('W0-T06: a pause inside the callback prevents later automatic steps', () => {
  let weeks = 0;
  const clock = new BrowserClock({ onWeek: () => { weeks++; clock.setPaused(true); } });
  clock.setSpeed(5);
  clock.setPaused(false);
  clock.pulse(0);
  pulseSeconds(clock, 0, 20);
  assert.equal(weeks, 1);
  clock.dispose();
});

test('W0-T07: reset and disposal discard elapsed timing state', () => {
  let weeks = 0;
  const clock = new BrowserClock({ onWeek: () => { weeks++; } });
  clock.setPaused(false);
  clock.pulse(0);
  pulseSeconds(clock, 0, 9);
  clock.reset(9000);
  clock.pulse(10_000);
  assert.equal(weeks, 0);
  pulseSeconds(clock, 10_000, 9);
  assert.equal(weeks, 1);
  clock.dispose();
  pulseSeconds(clock, 19_000, 20);
  assert.equal(weeks, 1);
});
