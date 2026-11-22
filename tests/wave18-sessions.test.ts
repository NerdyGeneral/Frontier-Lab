import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import type { ConsumerSessionProfile } from '../src/contracts/wave18-sessions';
import type { GameContent } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { deserializeState, previewCommand, serializeState, validateState } from '../src/core/index';
import { sessionChurnRelief } from '../src/modules/consumer-sessions';
import { productDemand } from '../src/modules/products';
import { SEGMENT_BY_ID } from '../src/content/wave2-market';
import { activeGuardrailScenario } from './fixtures/wave12-guardrails';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

function scenario(content: GameContent = CONTENT) {
  const original = deserializeState(readFileSync(join(__dirname, 'fixtures/wave1-snapshot.json'), 'utf8'), content);
  assert.ok(original.ok, original.ok ? undefined : original.error);
  const run = new NaturalBusinessCampaign(original.state, 'sessions');
  const product = Object.values(run.state.slices.products.offers).find(offer => offer.kind === 'basic-chat' && offer.companyId === run.state.playerCompanyId)!;
  return { run, product };
}

test('W18-S01: paid sessions grow, survive save/load, and change repeat usage and GPU demand within subscription terms', () => {
  const { run, product } = scenario();
  run.queue({ kind: 'set_product_terms', productId: product.id, priceCents: 1200, allowance: 200 });
  run.queue({ kind: 'set_consumer_sessions', productId: product.id, profile: 'extended' });
  run.step();
  const first = run.state.slices.products.lastUsage[product.id];
  assert.equal(first.consumerSessions?.profile, 'extended');
  assert.ok(first.segments?.every(row => row.sessionHistory?.tokens === 0));
  const resumed = deserializeState(serializeState(run.state));
  assert.ok(resumed.ok, resumed.ok ? undefined : resumed.error);
  assert.deepEqual(resumed.state, run.state);

  const enabled = run.state.slices.products.offers[product.id];
  const next = productDemand(resumed.state, enabled, CONTENT, run.state.week + 1);
  const stateless = productDemand(resumed.state, { ...enabled, sessionProfile: undefined }, CONTENT, run.state.week + 1);
  assert.ok(next.retainedInput > 0);
  assert.ok(next.paidWork > stateless.paidWork && next.memory > stateless.memory);
  assert.ok(next.segments.some((row, index) => row.requestedExchanges > stateless.segments[index].requestedExchanges));
  assert.equal(next.trialWork, stateless.trialWork);
  assert.deepEqual(next.trials, stateless.trials);
  run.step();
  const second = run.state.slices.products.lastUsage[product.id];
  assert.ok(second.segments!.some(row => row.errorBps < stateless.segments.find(base => base.segmentId === row.segmentId)!.errorBps));
  assert.ok(sessionChurnRelief(second, SEGMENT_BY_ID.regular, 100) > 0);
  assert.equal(second.grossBillCents, second.paidAccounts * 1200);
  assert.equal(second.paidRequestedWork, next.paidWork);
  assert.ok(second.tokens!.inputTokens > 0);
});

test('W18-S02: history respects the profile ceiling, is reduced by shortages, and clears when switched off', () => {
  const { run, product } = scenario();
  run.queue({ kind: 'set_consumer_sessions', productId: product.id, profile: 'extended' });
  run.step();
  for (let i = 0; i < 6; i++) run.step();
  const histories = () => run.state.slices.markets.cohorts.filter(c => c.productId === product.id && c.sessionHistory);
  assert.ok(histories().some(cohort => cohort.sessionHistory!.tokens > cohort.sessionHistory!.accounts * 400));
  run.queue({ kind: 'set_consumer_sessions', productId: product.id, profile: 'brief' });
  run.step();
  assert.ok(histories().length > 0 && histories().every(cohort => cohort.sessionHistory!.tokens <= cohort.sessionHistory!.accounts * 400));
  run.queue({ kind: 'allocate_compute', serving: 0, development: 0, research: 0 });
  run.step();
  const interrupted = run.state.slices.products.lastUsage[product.id];
  assert.ok(interrupted.grossBillCents > 0);
  assert.equal(interrupted.creditsCents, interrupted.grossBillCents);
  assert.equal(histories().length, 0);
  run.queue({ kind: 'allocate_compute', serving: 4 * U, development: 0, research: 0 });
  run.step();
  assert.ok(histories().length > 0);
  run.queue({ kind: 'set_consumer_sessions', productId: product.id, profile: 'off' });
  run.step();
  assert.equal(histories().length, 0);
  assert.equal(run.state.slices.products.lastUsage[product.id].consumerSessions, undefined);
});

test('W18-S03: returning traffic pays for its own guarded requests and trial requests keep the standard meter', () => {
  const base = activeGuardrailScenario('balanced', 'basic-chat');
  const run = new NaturalBusinessCampaign(base.state, 'sessions-guarded');
  run.queue({ kind: 'set_consumer_sessions', productId: base.productId, profile: 'brief' });
  run.step();
  run.step();
  const usage = run.state.slices.products.lastUsage[base.productId];
  assert.ok(usage.guardrail && usage.consumerSessions);
  assert.ok(usage.consumerSessions.paidWorkPerExchange > usage.guardrail.requestWorkCUw);
  assert.equal(usage.guardrail.checkedRequests, usage.exchanges);
  assert.equal(usage.guardrail.requestedRequests, usage.segments!.reduce((sum, row) => sum + row.requestedExchanges, 0)
    + Math.ceil(usage.trialRequestedWork / usage.guardrail.requestWorkCUw));
  assert.deepEqual(validateState(run.state), []);
  const forged = structuredClone(run.state);
  const cohort = forged.slices.markets.cohorts.find(row => row.productId === base.productId && row.sessionHistory)!;
  cohort.sessionHistory!.tokens += 1;
  assert.match(validateState(forged)[0].message, /Retained sessions/);
});

test('W18-S04: previous releases migrate without enabling sessions and future session records cannot hide in old saves', () => {
  const { run, product } = scenario();
  const previous = { ...CONTENT, version: '0.20.0', buildVersion: '0.20.0' };
  const state = scenario(previous).run.state;
  const loaded = deserializeState(serializeState(state, previous));
  assert.ok(loaded.ok, loaded.ok ? undefined : loaded.error);
  assert.equal(loaded.migratedFrom, 20);
  assert.deepEqual(loaded.state.slices, { ...state.slices, markets: { ...state.slices.markets, opportunityCalendar: { startedWeek: state.week, sequenceVersion: 2 as const } } });
  assert.equal(previewCommand(run.state, { kind: 'set_consumer_sessions', productId: 'missing', profile: 'brief' }).accepted, false);
  assert.equal(previewCommand(run.state, { kind: 'set_consumer_sessions', productId: product.id, profile: 'invalid' as ConsumerSessionProfile }).accepted, false);
  run.queue({ kind: 'set_consumer_sessions', productId: product.id, profile: 'brief' });
  const disguised = { ...structuredClone(run.state), contentVersion: previous.version, buildVersion: previous.buildVersion };
  // Keep this negative test about session evidence, rather than the newer calendar guard.
  delete disguised.slices.markets.opportunityCalendar;
  const result = deserializeState(serializeState(disguised, previous));
  assert.ok(!result.ok);
  assert.match(result.error, /unavailable/);
});
