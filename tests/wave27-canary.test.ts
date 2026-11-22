import { SEGMENT_BY_ID } from '../src/content/wave2-market';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { CANARY_RULES as RULES } from '../src/content/wave27-canary';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, createInitialState, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { getCanaryView, assessCanary } from '../src/modules/release-canary';
import { canaryRequestId } from '../src/modules/canary-traffic';
import { getEvaluatedReleaseIdentity, evaluatedReleaseIdentityReason } from '../src/modules/release-identity';
import { meteredBill, standardServingRequests } from '../src/modules/products';
import { requestMeter } from '../src/modules/product-models';
import { getComputePools } from '../src/modules/compute-pools';
import { preparedReleaseReadinessReason } from '../src/modules/prepared-releases';
import { getCanaryFixture, getCanaryReadyFixture } from './fixtures/wave27-canary';

const step = (state: GameState) => { const result = advanceWeek(state); assert.equal(result.accepted, true, result.reason?.message); return result.state; };
const queue = (state: GameState, payload: CommandPayload) => { const result = submitCommand(state, payload); assert.equal(result.accepted, true, result.reason?.message); return result.state; };
const reload = (state: GameState) => { const result = deserializeState(serializeState(state)); assert.ok(result.ok, result.ok ? '' : result.error); return result.state; };
const canary = (state: GameState, id: string) => state.slices.products.canaryReleases![id];
const invoice = (state: GameState, productId: string) => state.slices.products.invoices.filter(row => row.productId === productId && row.week === state.week);
function expectInvalidImport(state: GameState): void {
  assert.ok(validateState(state).length > 0);
  const result = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion,
    contentVersion: state.contentVersion, checksum: canonicalStateHash(state), state }));
  assert.equal(result.ok, false);
}

test('W27-C01 paid regression canary observes disjoint traffic, restores the incumbent and invoices once', () => {
  const f = getCanaryFixture(), stopped = canary(f.observed, f.canaryId), receipt = stopped.observations[0];
  assert.equal(f.originalWeek, 537); assert.ok(f.minimumCashCents > 0); assert.deepEqual(validateState(f.restored), []);
  assert.equal(canary(f.scheduled, f.canaryId).status, 'scheduled'); assert.equal(stopped.status, 'stopped'); assert.equal(stopped.stopCode, 'regression');
  assert.equal(stopped.observations.length, 1); assert.match(stopped.lastMessage, /useful answers/);
  const assessment = assessCanary(stopped); assert.ok(assessment.sufficient);
  assert.ok(assessment.incumbentUsefulBps - assessment.candidateUsefulBps >= RULES.regressionBps);
  assert.equal(receipt.eligibleRequests, receipt.incumbent.requestedRequests + receipt.candidate.requestedRequests);
  assert.ok(receipt.candidate.requestedRequests <= Math.floor(receipt.eligibleRequests / 10));
  // Live market intake changes the cohort size between releases. The experiment must
  // still split exactly the paid demand present before this service boundary.
  const cohorts = f.scheduled.slices.markets.cohorts.filter(row => row.productId === f.productId && row.activeWeek <= f.observed.week);
  const expectedRequests = cohorts.reduce((sum, row) => sum + row.count * Math.min(SEGMENT_BY_ID[row.segmentId ?? 'regular'].exchanges, f.scheduled.slices.products.contracts[row.contractId].allowance), 0);
  assert.equal(receipt.eligibleRequests, expectedRequests);
  assert.equal(receipt.candidate.executedRequests, expectedRequests / 10); assert.equal(receipt.incumbent.executedRequests, expectedRequests * 9 / 10);
  assert.equal(receipt.candidate.fulfillmentBps, 10000); assert.equal(receipt.incumbent.fulfillmentBps, 10000);
  assert.ok(receipt.candidate.requiredMemoryMU > 0 && receipt.incumbent.requiredMemoryMU > 0);
  assert.equal(receipt.candidate.grantedMemoryMU, receipt.candidate.requiredMemoryMU);
  assert.equal(receipt.sourceEffectiveWorkCUw, receipt.incumbent.effectiveWorkCUw + receipt.trialExecutedWorkCUw);
  assert.equal(stopped.consumedWorkCUw, receipt.candidate.effectiveWorkCUw); assert.ok(stopped.consumedWorkCUw <= stopped.budgetCUw);
  const expectedSubscriptionCents = cohorts.reduce((sum, row) => sum + row.count * f.scheduled.slices.products.contracts[row.contractId].weeklyPriceCents, 0);
  assert.equal(invoice(f.observed, f.productId).length, 1); assert.equal(invoice(f.observed, f.productId)[0].amountCents, expectedSubscriptionCents);
  assert.equal(f.observed.slices.company.ledger.filter(row => row.id === invoice(f.observed, f.productId)[0].id).length, 1);
  assert.equal(f.scheduled.slices.company.ledger.filter(row => row.id === 'canary-setup:' + stopped.startCommandId).length, 1);
  assert.equal(f.scheduled.slices.company.ledger.find(row => row.id === 'canary-setup:' + stopped.startCommandId)!.amountCents, RULES.setupFeeCents);
  const cost = f.observed.slices.compute.costReports![f.observed.playerCompanyId].find(row => row.week === f.observed.week)!;
  const target = cost.targets.find(row => row.kind === 'public-product' && row.sourceId === f.productId)!;
  assert.deepEqual(target.requestIds, [receipt.candidate.requestId, receipt.incumbent.requestId].sort());
  assert.deepEqual(target.revenueFactIds, [invoice(f.observed, f.productId)[0].id]);
  assert.ok(cost.workloads.filter(row => target.requestIds.includes(row.requestId)).every(row => row.targetId === target.id));
  assert.equal(f.restored.slices.products.offers[f.productId].deploymentId, stopped.sourceDeploymentId);
  assert.equal(f.restored.slices.products.deployments[stopped.sourceDeploymentId].modelId, f.sourceModelId);
  assert.equal(f.restored.slices.products.lastUsage[f.productId].canary, undefined);
  assert.equal(invoice(f.restored, f.productId).length, 1);
  assert.equal(standardServingRequests(f.restored, CONTENT, f.restored.week + 1).some(row => row.id === canaryRequestId(f.canaryId)), false);
  assert.equal(submitCommand(f.restored, { kind: 'promote_prepared_release', releaseId: f.releaseId }).accepted, false);
});

test('W27-C02 queue and stopped-save reloads preserve exact continuation and duplicate commands cannot charge again', () => {
  const f = getCanaryReadyFixture(), payload = { kind: 'start_release_canary', ...f.options } as const;
  const before = canonicalStateHash(f.state), submitted = submitCommand(f.state, payload, CONTENT, 'canary-replay');
  assert.equal(submitted.accepted, true, submitted.reason?.message); assert.equal(canonicalStateHash(f.state), before);
  assert.equal(submitted.state.queuedCommands.at(-1)!.reservedCents, RULES.setupFeeCents);
  assert.equal(canonicalStateHash(step(reload(submitted.state))), canonicalStateHash(step(submitted.state)));
  const duplicate = submitCommand(submitted.state, payload, CONTENT, 'canary-replay');
  assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason?.code, 'DUPLICATE_COMMAND'); assert.equal(duplicate.state, submitted.state);
  const completed = getCanaryFixture();
  assert.equal(canonicalStateHash(step(reload(completed.observed))), canonicalStateHash(completed.restored));
  assert.equal(submitCommand(completed.restored, payload).accepted, false);
  assert.equal(submitCommand(completed.restored, { kind: 'stop_release_canary', canaryId: completed.canaryId }).accepted, false);
});

test('W27-C03 explicit protocol limits and both queued command orders reject stale full rollout', () => {
  const f = getCanaryReadyFixture(), payload = { kind: 'start_release_canary', ...f.options } as const;
  const quote = previewCommand(f.state, payload); assert.equal(quote.accepted, true); assert.equal(quote.upfrontCostCents, RULES.setupFeeCents);
  assert.match(quote.summary, /not a cash prepayment/); assert.equal(previewCommand(createInitialState(), payload).accepted, false);
  for (const invalid of [{ ...payload, shareBps: 1001 }, { ...payload, sampleFloor: 99 }, { ...payload, sampleFloor: 10001 },
    { ...payload, budgetCUw: 33 * U }, { ...payload, budgetCUw: 1 }, { ...payload, grantQualified: true }, { ...payload, releaseId: '__proto__' }])
    assert.equal(previewCommand(f.state, invalid as CommandPayload).accepted, false);
  const startFirst = queue(f.state, payload);
  assert.equal(submitCommand(startFirst, { kind: 'promote_prepared_release', releaseId: f.releaseId }).accepted, false);
  assert.equal(submitCommand(startFirst, { kind: 'set_product_features', productId: f.productId, features: { memory: true, extendedContext: false, deepReasoning: false } }).accepted, false);
  const promoteFirst = queue(f.state, { kind: 'promote_prepared_release', releaseId: f.releaseId });
  assert.equal(submitCommand(promoteFirst, payload).accepted, false);
  const scheduled = step(startFirst), id = Object.values(scheduled.slices.products.canaryReleases!)[0].id;
  const stopFirst = queue(scheduled, { kind: 'stop_release_canary', canaryId: id });
  assert.equal(submitCommand(stopFirst, { kind: 'promote_prepared_release', releaseId: f.releaseId }).accepted, false);
  const stopped = step(reload(stopFirst)); assert.equal(canary(stopped, id).stopCode, 'manual'); assert.equal(canary(stopped, id).observations.length, 0);
  assert.equal(stopped.slices.products.lastUsage[f.productId].canary, undefined); assert.equal(invoice(stopped, f.productId).length, 1);
});

test('W27-C04 sufficient nonregressing evidence permits the existing paid handover and retained-source rollback', () => {
  const f = getCanaryFixture('qualifying'); assert.equal(canary(f.observed, f.canaryId).status, 'qualified');
  assert.equal(f.observed.slices.products.deployments[f.observed.slices.products.offers[f.productId].deploymentId].modelId, f.sourceModelId);
  assert.ok(getCanaryView(f.observed, f.productId).canaries[0].canPromote);
  let state = step(queue(f.observed, { kind: 'promote_prepared_release', releaseId: f.releaseId }));
  assert.equal(state.slices.products.preparedReleases![f.releaseId].status, 'scheduled');
  state = step(state); assert.equal(canary(state, f.canaryId).status, 'promoted');
  assert.equal(state.slices.products.deployments[state.slices.products.offers[f.productId].deploymentId].modelId, f.candidateModelId);
  assert.equal(state.slices.products.lastUsage[f.productId].canary, undefined); assert.equal(invoice(state, f.productId).length, 1);
  state = step(queue(state, { kind: 'start_release_rollback', releaseId: f.releaseId }));
  for (let i = 0; i < 4 && preparedReleaseReadinessReason(state, state.slices.products.preparedReleases![f.releaseId]); i++) state = step(state);
  assert.equal(preparedReleaseReadinessReason(state, state.slices.products.preparedReleases![f.releaseId]), undefined);
  state = step(queue(state, { kind: 'promote_prepared_release', releaseId: f.releaseId })); state = step(reload(state));
  assert.equal(state.slices.products.preparedReleases![f.releaseId].rollback!.status, 'complete');
  assert.equal(state.slices.products.deployments[state.slices.products.offers[f.productId].deploymentId].modelId, f.sourceModelId);
  assert.equal(invoice(state, f.productId).length, 1); assert.deepEqual(validateState(state), []);
});

test('W27-C05 compressed API candidate keeps its paid policy/runtime identity and shares one executed-token carry', () => {
  const f = getCanaryFixture('api'), row = canary(f.observed, f.canaryId), usage = f.observed.slices.products.lastUsage[f.productId], r = usage.canary!;
  assert.equal(row.candidate.runtimeSourceModelId, f.sourceModelId); assert.ok(row.candidate.runtimeFingerprint && row.candidate.policyReportId);
  assert.equal(evaluatedReleaseIdentityReason(f.observed, row.candidate), undefined);
  assert.equal(r.candidate.effectiveWorkCUw, r.candidate.executedRequests * requestMeter(f.observed.slices.models.versions[f.candidateModelId], row.features).work);
  assert.equal(usage.tokens!.inputTokens, r.incumbent.inputTokens + r.candidate.inputTokens);
  assert.equal(usage.tokens!.outputTokens, r.incumbent.outputTokens + r.candidate.outputTokens);
  assert.equal(usage.tokens!.internalTokens, r.incumbent.internalTokens + r.candidate.internalTokens);
  const bill = meteredBill(usage.tokens!.inputTokens, usage.tokens!.outputTokens, usage.tokens!.internalTokens,
    usage.tokens!.inputPriceCentsPerMillion, usage.tokens!.outputPriceCentsPerMillion, r.billCarryIn);
  assert.equal(r.billedCents, bill.cents); assert.equal(r.billCarryOut, bill.remainder);
  assert.equal(f.observed.slices.products.contracts[row.configuration.contractId].tokenBillRemainder, bill.remainder);
  assert.equal(invoice(f.observed, f.productId).length, 1); assert.equal(invoice(f.observed, f.productId)[0].amountCents, bill.cents);
  assert.equal(f.restored.slices.products.lastUsage[f.productId].tokens!.billCarryIn, bill.remainder);
  assert.equal(canonicalStateHash(step(reload(f.observed))), canonicalStateHash(f.restored));
});

test('W27-C06 actual work respects its hard allowance and eight insufficient samples never unlock rollout', () => {
  const f = getCanaryReadyFixture('qualifying'), meter = requestMeter(f.state.slices.models.versions[f.candidateModelId], f.state.slices.products.offers[f.productId].features!);
  let bounded = queue(f.state, { kind: 'start_release_canary', ...f.options, budgetCUw: 100 * meter.work });
  const boundedId = 'canary:' + bounded.queuedCommands.at(-1)!.id; bounded = step(step(bounded));
  assert.equal(canary(bounded, boundedId).consumedWorkCUw, 100 * meter.work);
  assert.equal(canary(bounded, boundedId).observations[0].candidate.requestedRequests, 100);
  assert.equal(canary(bounded, boundedId).observations[0].candidate.executedRequests, 100);
  let slow = queue(f.state, { kind: 'start_release_canary', ...f.options, shareBps: 100, sampleFloor: 10000, budgetCUw: 32 * U });
  const id = 'canary:' + slow.queuedCommands.at(-1)!.id; slow = step(slow);
  for (let i = 0; i < 8; i++) { slow = step(slow); if (i < 7) { assert.equal(canary(slow, id).status, 'collecting'); assert.equal(submitCommand(slow, { kind: 'promote_prepared_release', releaseId: f.releaseId }).accepted, false); } }
  assert.equal(canary(slow, id).stopCode, 'insufficient-sample'); assert.equal(canary(slow, id).observations.length, 8);
  assert.ok(assessCanary(canary(slow, id)).candidateSamples < 10000); assert.equal(getCanaryView(slow, f.productId).canaries[0].canPromote, false);
});

test('W27-C07 loss of connected memory stops actual zero-grant traffic without rejecting the settlement', () => {
  const f = getCanaryReadyFixture('qualifying');
  let state = queue(f.state, { kind: 'start_release_canary', ...f.options }); const id = 'canary:' + state.queuedCommands.at(-1)!.id;
  state = queue(state, { kind: 'allocate_compute', serving: 2 * U, development: 0, research: 0 });
  for (const rack of Object.values(state.slices.compute.racks).filter(row => row.companyId === state.playerCompanyId && row.status === 'installed'))
    state = queue(state, { kind: 'set_rack_parked', rackId: rack.id, parked: true });
  // Seven cloud CU retain the ordinary 12.25 MU resident-weight requirement,
  // but cannot fit either cohort's full model plus live account workspace.
  state = step(state); state = step(queue(state, { kind: 'set_cloud_capacity', cu: 7 * U }));
  const row = canary(state, id), receipt = row.observations[0], largest = Math.max(...getComputePools(state, state.playerCompanyId).map(pool => pool.memoryMU));
  assert.equal(row.status, 'stopped'); assert.equal(row.stopCode, 'severe-incident');
  assert.ok(receipt.candidate.requiredMemoryMU > largest); assert.equal(receipt.candidate.effectiveWorkCUw, 0);
  assert.equal(receipt.candidate.grantedMemoryMU, 0); assert.equal(receipt.candidate.executedRequests, 0);
  assert.equal(invoice(state, f.productId).length, 1); assert.deepEqual(validateState(reload(state)), []);
});

test('W27-C08 checksummed imports reject stopped-canary resurrection, fabricated qualification and changed cohort billing', () => {
  const f = getCanaryFixture();
  const corruptions: Array<(state: GameState) => void> = [
    state => { const row = canary(state, f.canaryId); row.status = 'collecting'; row.stoppedWeek = null; row.stopCode = null; row.incident = null; row.stopCommandId = null; },
    state => { const row = canary(state, f.canaryId); row.status = 'qualified'; row.qualifiedWeek = state.week; row.stoppedWeek = null; row.stopCode = null; row.incident = null; },
    state => { canary(state, f.canaryId).candidate.capabilityReportId = 'unpaid-report'; },
    state => { canary(state, f.canaryId).candidate.rights.hosted = false; },
    state => { canary(state, f.canaryId).consumedWorkCUw = 0; },
    state => { canary(state, f.canaryId).observations[0].candidate.executedRequests++; },
    state => { canary(state, f.canaryId).observations[0].candidate.requiredMemoryMU = 0; },
    state => { canary(state, f.canaryId).observations[0].billedCents++; },
    state => { canary(state, f.canaryId).observations[0].week--; },
    state => { canary(state, f.canaryId).incident!.restoredRoutingWeek = state.week + 2; },
  ];
  for (const corrupt of corruptions) { const bad = structuredClone(f.observed); corrupt(bad); expectInvalidImport(bad); }
  const active = getCanaryFixture('qualifying');
  const forged = structuredClone(active.observed), row = canary(forged, active.canaryId);
  row.status = 'collecting'; row.qualifiedWeek = null; expectInvalidImport(forged);
});

test('W27-C09 pure release views and frozen paid identities preserve state, RNG and canonical reload ordering', () => {
  const f = getCanaryFixture('api'), hash = canonicalStateHash(f.observed), random = structuredClone(f.observed.random);
  for (let i = 0; i < 3; i++) getCanaryView(f.observed, f.productId);
  assert.equal(canonicalStateHash(f.observed), hash); assert.deepEqual(f.observed.random, random);
  const identity = getEvaluatedReleaseIdentity(f.observed, f.candidateModelId)!; assert.ok(identity);
  const reordered = structuredClone(f.observed);
  reordered.slices.models.reports = Object.fromEntries(Object.entries(reordered.slices.models.reports).reverse());
  assert.equal(evaluatedReleaseIdentityReason(reordered, identity), undefined); assert.equal(canonicalStateHash(reordered), hash);
  assert.equal(evaluatedReleaseIdentityReason(reload(reordered), identity), undefined);
  assert.ok(evaluatedReleaseIdentityReason(f.observed, { ...identity, runtimeFingerprint: '00000000' }));
  assert.equal(getEvaluatedReleaseIdentity(f.observed, CONTENT.seedModel.id), null);
  const opening = createInitialState(), openingHash = canonicalStateHash(opening);
  assert.equal(getCanaryView(opening).researched, false); assert.equal(opening.slices.products.canaryReleases, undefined);
  assert.equal(canonicalStateHash(opening), openingHash);
});
