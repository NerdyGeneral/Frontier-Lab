import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { mulDiv } from '../src/core/math';
import { previewCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { activeEfficiency, cacheWarm } from '../src/modules/product-efficiency';
import { productDemand, productRequestMeter } from '../src/modules/products';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { activeGuardrailScenario, deployedGuardrailScenario, installGuardrail, installGuardrailOwnedGpu, installGuardrailRouteAndCache } from './fixtures/wave12-guardrails';

function demand(state: GameState, productId: string) {
  const product = state.slices.products.offers[productId];
  return { product, ...productDemand(state, product, CONTENT, state.week + 1) };
}
function fork(state: GameState, prefix: string) { return new NaturalBusinessCampaign(structuredClone(state), prefix); }
function usage(run: NaturalBusinessCampaign, productId: string) { return run.state.slices.products.lastUsage[productId]; }
function disable(run: NaturalBusinessCampaign, productId: string) {
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId, enabled: false });
}
function checkOneInvoice(run: NaturalBusinessCampaign, productId: string) {
  const rows = run.state.slices.products.invoices.filter(row => row.productId === productId && row.week === run.week);
  assert.equal(rows.length, 1); assert.equal(rows[0].amountCents, usage(run, productId).billedCents);
  assert.equal(run.state.slices.company.ledger.filter(row => row.id === rows[0].id).length, 1);
}

test('W12-S01: runtime checking consumes real owned GPU work once and never creates extra customer tokens or invoices', () => {
  const initial = activeGuardrailScenario(), setup = fork(initial.state, 'w12-owned-setup');
  setup.queue({ kind: 'set_product_terms', productId: initial.productId, priceCents: 400, allowance: 100 }); setup.step();
  installGuardrailOwnedGpu(setup);
  const modelHash = canonicalStateHash(setup.state.slices.models), protectedRun = fork(setup.state, 'w12-owned-on');
  const ordinaryRun = fork(setup.state, 'w12-owned-off'); disable(ordinaryRun, initial.productId);
  protectedRun.step(); ordinaryRun.step();
  const guarded = usage(protectedRun, initial.productId), ordinary = usage(ordinaryRun, initial.productId), check = guarded.guardrail!;
  assert.ok(check); assert.equal(ordinary.guardrail, undefined);
  assert.equal(guarded.paidAccounts, ordinary.paidAccounts); assert.equal(guarded.fulfillmentBps, 10000); assert.equal(ordinary.fulfillmentBps, 10000);
  assert.equal(guarded.tokens!.inputTokens, ordinary.tokens!.inputTokens);
  assert.equal(guarded.tokens!.outputTokens, ordinary.tokens!.outputTokens);
  assert.equal(guarded.tokens!.internalTokens, ordinary.tokens!.internalTokens);
  assert.equal(guarded.tokens!.billCarryIn, ordinary.tokens!.billCarryIn); assert.equal(guarded.tokens!.billCarryOut, ordinary.tokens!.billCarryOut);
  assert.equal(guarded.billedCents, ordinary.billedCents);
  assert.equal(guarded.executedWork - ordinary.executedWork, check.checkWorkCUw);
  assert.ok(check.checkedRequests > 0); assert.equal(check.checkWorkCUw, check.checkedRequests * 20_000);
  assert.ok(guarded.tokens!.physicalWork > ordinary.tokens!.physicalWork);
  assert.ok(guarded.tokens!.physicalWork < guarded.executedWork, 'Owned hardware conversion still applies to the combined request.');
  assert.ok(guarded.tokens!.ownedVariableCostCents > ordinary.tokens!.ownedVariableCostCents);
  assert.equal(guarded.errorBps, ordinary.errorBps); assert.equal(guarded.behavior!.confidentErrorBps, ordinary.behavior!.confidentErrorBps);
  assert.ok(guarded.behavior!.falseRefusalBps > ordinary.behavior!.falseRefusalBps);
  const guardedCost = protectedRun.state.slices.compute.costReports![protectedRun.state.playerCompanyId].at(-1)!;
  const ordinaryCost = ordinaryRun.state.slices.compute.costReports![ordinaryRun.state.playerCompanyId].at(-1)!;
  const one = guardedCost.workloads.filter(row => row.requestId === 'serve:' + initial.productId);
  assert.equal(one.length, 1); assert.ok(one[0].poolId.startsWith('owned:'));
  assert.equal(one[0].physicalWorkCUw, guarded.tokens!.physicalWork);
  assert.equal(one[0].effectiveWorkCUw, guarded.executedWork);
  assert.ok(one[0].ownedVariableCents > ordinaryCost.workloads.find(row => row.requestId === one[0].requestId)!.ownedVariableCents);
  assert.equal(guardedCost.workloads.some(row => row.requestId.startsWith('guardrail') && row.category === 'serving'), false,
    'The checker is part of the normal serving grant, not a duplicate billable workload.');
  checkOneInvoice(protectedRun, initial.productId); checkOneInvoice(ordinaryRun, initial.productId);
  assert.equal(canonicalStateHash(protectedRun.state.slices.models), modelHash);
  assert.equal(canonicalStateHash(ordinaryRun.state.slices.models), modelHash);
  assert.deepEqual(validateState(protectedRun.state), []); assert.deepEqual(validateState(ordinaryRun.state), []);
});

test('W12-S02: constrained serving exposes the GPU tradeoff through fewer API tokens and proportional subscription credits', () => {
  for (const kind of ['developer-api', 'basic-chat'] as const) {
    const initial = activeGuardrailScenario('strict', kind), next = demand(initial.state, initial.productId);
    const plainPaidWork = mulDiv(next.paidWork, next.meter.work - 50_000, next.meter.work);
    const capacity = mulDiv(plainPaidWork, 11000, 10000, 'ceil');
    const protectedRun = fork(initial.state, 'w12-scarce-on-' + kind), ordinaryRun = fork(initial.state, 'w12-scarce-off-' + kind);
    disable(ordinaryRun, initial.productId);
    for (const run of [protectedRun, ordinaryRun]) run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, serving: capacity });
    protectedRun.step(); ordinaryRun.step();
    const guarded = usage(protectedRun, initial.productId), ordinary = usage(ordinaryRun, initial.productId);
    assert.equal(guarded.paidAccounts, ordinary.paidAccounts);
    assert.equal(ordinary.fulfillmentBps, 10000); assert.ok(guarded.fulfillmentBps < ordinary.fulfillmentBps);
    assert.ok(guarded.guardrail!.checkedRequests < guarded.guardrail!.requestedRequests);
    assert.ok(guarded.tokens!.inputTokens < ordinary.tokens!.inputTokens);
    assert.ok(guarded.tokens!.outputTokens < ordinary.tokens!.outputTokens);
    assert.ok(guarded.billedCents < ordinary.billedCents);
    if (kind === 'basic-chat') { assert.equal(guarded.grossBillCents, ordinary.grossBillCents); assert.ok(guarded.creditsCents > 0); }
    else { assert.equal(guarded.creditsCents, 0); assert.equal(ordinary.creditsCents, 0); }
    checkOneInvoice(protectedRun, initial.productId); checkOneInvoice(ordinaryRun, initial.productId);
    assert.deepEqual(validateState(protectedRun.state), []); assert.deepEqual(validateState(ordinaryRun.state), []);
  }
});

test('W12-S03: zero capacity and pause generate no checks, no guardrail work, and no API token charge', () => {
  const initial = activeGuardrailScenario('strict');
  for (const stop of ['capacity', 'pause'] as const) {
    const run = fork(initial.state, 'w12-zero-' + stop);
    if (stop === 'capacity') run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, serving: 0 });
    else run.queue({ kind: 'set_product_paused', productId: initial.productId, paused: true });
    run.step();
    const actual = usage(run, initial.productId), check = actual.guardrail!;
    assert.ok(activeRuntimeGuardrail(run.state, initial.productId), 'An installed checker remains a configuration while service is stopped.');
    assert.ok(check); assert.equal(check.checkedRequests, 0); assert.equal(check.checkWorkCUw, 0);
    assert.equal(actual.executedWork, 0); assert.equal(actual.tokens!.physicalWork, 0);
    assert.equal(actual.tokens!.inputTokens + actual.tokens!.outputTokens + actual.tokens!.internalTokens, 0);
    assert.equal(actual.billedCents, 0); assert.equal(actual.behavior!.falseRefusalBps, run.state.slices.models.versions[initial.modelId].behavior!.falseRefusalBps);
    assert.deepEqual(validateState(run.state), []);
  }
});

test('W12-S04: the checker covers both routed models and its full work survives a warm prefix cache', () => {
  const initial = deployedGuardrailScenario(), run = fork(initial.state, 'w12-routed');
  const secondaryId = installGuardrailRouteAndCache(run, initial.productId, initial.modelId);
  const id = installGuardrail(run, initial.productId, 'strict');
  assert.equal(activeEfficiency(run.state, initial.productId, 'routing')!.secondaryModelId, secondaryId);
  assert.ok(cacheWarm(run.state, run.state.slices.products.offers[initial.productId]));
  const on = fork(run.state, 'w12-routed-on'), off = fork(run.state, 'w12-routed-off'); disable(off, initial.productId);
  on.step(); off.step();
  const protectedDemand = demand(on.state, initial.productId), ordinaryDemand = demand(off.state, initial.productId);
  const protectedMeter = productRequestMeter(on.state, protectedDemand.product, protectedDemand.primaryModel);
  const ordinaryMeter = productRequestMeter(off.state, ordinaryDemand.product, ordinaryDemand.primaryModel);
  assert.equal(protectedMeter.work - ordinaryMeter.work, 50_000);
  const reserved = (campaign: NaturalBusinessCampaign) => campaign.state.slices.compute.costReports![campaign.state.playerCompanyId].at(-1)!
    .resources.requests.find(row => row.id === 'serve:' + initial.productId)!.memoryMU;
  assert.equal(reserved(on) - reserved(off), 2 * U);
  assert.equal(protectedMeter.inputTokens, ordinaryMeter.inputTokens); assert.equal(protectedMeter.outputTokens, ordinaryMeter.outputTokens);
  assert.equal(usage(on, initial.productId).guardrail!.installationId, id);
  assert.equal(usage(on, initial.productId).guardrail!.checkWorkCUw, usage(on, initial.productId).guardrail!.checkedRequests * 50_000);
  assert.equal(usage(on, initial.productId).billedCents, usage(off, initial.productId).billedCents);
  assert.deepEqual(validateState(on.state), []); assert.deepEqual(validateState(off.state), []);
});

test('W12-S05: real benign customer feedback records extra false refusals without importing restricted audit cases', () => {
  const initial = activeGuardrailScenario('strict'), on = fork(initial.state, 'w12-feedback-on'), off = fork(initial.state, 'w12-feedback-off');
  disable(off, initial.productId);
  const records = [on, off].map(run => ({ run, id: 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId: initial.productId,
    sampling: 'representative', consent: 'hosted-only' }) }));
  for (const entry of records) entry.run.step(4);
  const [guarded, ordinary] = records.map(entry => entry.run.state.slices.data.feedbackStudies![entry.id]);
  assert.equal(guarded.status, 'closed'); assert.equal(ordinary.status, 'closed');
  assert.equal(guarded.totalCases, 100); assert.equal(ordinary.totalCases, 100);
  assert.equal(guarded.weeks[0].paidUsage.paidAccounts, ordinary.weeks[0].paidUsage.paidAccounts);
  assert.ok(guarded.weeks[0].paidUsage.falseRefusalBps > ordinary.weeks[0].paidUsage.falseRefusalBps);
  assert.ok(guarded.weeks.reduce((sum, row) => sum + row.outcomes.falseRefusal, 0)
    > ordinary.weeks.reduce((sum, row) => sum + row.outcomes.falseRefusal, 0));
  for (const row of guarded.weeks) {
    assert.equal(row.outcomes.cases, row.outcomes.useful + row.outcomes.confidentError + row.outcomes.falseRefusal + row.outcomes.clarification);
    assert.equal(row.paidUsage.guardrail!.installationId, initial.installationId);
    assert.equal(row.paidUsage.guardrail!.profile, 'strict');
    assert.equal(row.paidUsage.guardrail!.checkingApplied, true);
    assert.ok(row.paidUsage.guardrail!.addedFalseRefusalBps > 0);
    assert.equal(Object.hasOwn(row.outcomes, 'unsafeCompliances'), false);
    assert.equal(Object.hasOwn(row.outcomes, 'correctPolicyRefusals'), false);
    assert.equal(row.paidUsage.billedCents, on.state.slices.products.invoices.find(invoice => invoice.id === row.paidUsage.invoiceId)!.amountCents);
  }
  assert.ok(ordinary.weeks.every(row => row.paidUsage.guardrail === undefined));
  assert.equal(canonicalStateHash(on.state.slices.models), canonicalStateHash(off.state.slices.models));
  const preserved = canonicalStateHash(guarded);
  on.step(10);
  assert.equal(canonicalStateHash(on.state.slices.data.feedbackStudies![records[0].id]), preserved);
  const restored = deserializeState(serializeState(on.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.deepEqual(validateState(on.state), []); assert.deepEqual(validateState(off.state), []);
});

test('W12-S06: disabling a checker preserves its paid audit and reenabling the same binding costs no second rollout', () => {
  const initial = activeGuardrailScenario(), run = fork(initial.state, 'w12-operating-choice');
  const installation = structuredClone(run.state.slices.products.runtimeGuardrails![initial.installationId]);
  const initialCount = Object.keys(run.state.slices.products.runtimeGuardrails!).length;
  disable(run, initial.productId); run.step();
  assert.equal(activeRuntimeGuardrail(run.state, initial.productId), null); assert.equal(usage(run, initial.productId).guardrail, undefined);
  const disabled = structuredClone(run.state.slices.products.runtimeGuardrails![initial.installationId]);
  assert.equal(disabled.completedWork, installation.completedWork); assert.equal(disabled.completedStaff, installation.completedStaff);
  assert.equal(previewCommand(run.state, { kind: 'install_runtime_guardrail', productId: initial.productId, profile: 'balanced' }).accepted, false,
    'A second identical rollout cannot reroll the paid audit.');
  run.queue({ kind: 'set_runtime_guardrail_enabled', productId: initial.productId, enabled: true }); run.step();
  assert.equal(activeRuntimeGuardrail(run.state, initial.productId)!.id, initial.installationId);
  assert.equal(Object.keys(run.state.slices.products.runtimeGuardrails!).length, initialCount);
  assert.equal(run.state.slices.products.runtimeGuardrails![initial.installationId].completedWork, installation.completedWork);
  assert.deepEqual(validateState(run.state), []);
});

test('W12-S07: stricter checking creates consumer retention friction even when both branches fully serve every paid request', () => {
  const initial = activeGuardrailScenario('strict', 'basic-chat');
  const on = fork(initial.state, 'w12-retention-on'), off = fork(initial.state, 'w12-retention-off'); disable(off, initial.productId);
  let checkedLost = 0, ordinaryLost = 0;
  for (let week = 0; week < 24; week++) {
    on.step(); off.step();
    const guarded = usage(on, initial.productId), ordinary = usage(off, initial.productId);
    assert.equal(guarded.fulfillmentBps, 10000); assert.equal(ordinary.fulfillmentBps, 10000);
    assert.ok(guarded.behavior!.falseRefusalBps > ordinary.behavior!.falseRefusalBps);
    assert.deepEqual(guarded.segments!.map(row => [row.segmentId, row.errorBps]), ordinary.segments!.map(row => [row.segmentId, row.errorBps]));
    checkedLost += on.state.slices.markets.lastLost; ordinaryLost += off.state.slices.markets.lastLost;
  }
  assert.ok(checkedLost > ordinaryLost, `Strict checking lost ${checkedLost} accounts versus ${ordinaryLost} without checking.`);
  assert.equal(canonicalStateHash(on.state.slices.models), canonicalStateHash(off.state.slices.models));
  assert.deepEqual(validateState(on.state), []); assert.deepEqual(validateState(off.state), []);
});
