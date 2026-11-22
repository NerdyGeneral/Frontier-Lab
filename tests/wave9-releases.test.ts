import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave9PreparedReleases } from '../src/core/wave9-releases-validation';
import { preparedReleaseRequests } from '../src/modules/prepared-releases';
import { getQualifiedReleaseRehearsal } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

let readyState: GameState | undefined;
const productId = 'product:natural-business-command-8', candidateModelId = 'model-wave7-natural-command-9';
function setup(prefix: string) {
  if (!readyState) {
    const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave7-snapshot.json'), 'utf8'));
    assert.ok(imported.ok, imported.ok ? '' : imported.error);
    const run = new NaturalBusinessCampaign(imported.state, 'wave9-release-base');
    run.queue({ kind: 'start_system_rollout', method: 'cost-accounting' });
    run.until(state => Object.values(state.slices.research.systemRollouts).some(item => item.companyId === state.playerCompanyId && item.method === 'cost-accounting' && item.status === 'active'), 6, 'operating cost meter');
    run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId });
    run.until(state => !!getQualifiedReleaseRehearsal(state, productId, candidateModelId), 10, 'paid release rehearsal');
    readyState = run.state;
  }
  return new NaturalBusinessCampaign(structuredClone(readyState), prefix);
}

function prepare(run: NaturalBusinessCampaign) {
  const id = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId });
  run.until(state => state.slices.products.preparedReleases?.[id]?.status === 'ready', 6, 'release preparation');
  run.step();
  return id;
}

function release(run: NaturalBusinessCampaign) {
  const id = prepare(run);
  run.queue({ kind: 'promote_prepared_release', releaseId: id }); run.step(2);
  assert.equal(run.state.slices.products.preparedReleases![id].status, 'released');
  return id;
}

test('W9-P01: paid independent preparation keeps incumbent revenue and records internal GPU cost without releasing the candidate', () => {
  const run = setup('w9-p01'), before = run.state.slices.products.offers[productId], contractId = before.contractId, deploymentId = before.deploymentId;
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated');
  const id = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId });
  run.step();
  const project = run.state.slices.products.preparedReleases![id];
  assert.equal(project.completedWork, U); assert.equal(project.completedStaff, U);
  assert.equal(project.status, 'preparing'); assert.equal(project.physicalWork, U);
  assert.equal(run.state.slices.products.offers[productId].deploymentId, deploymentId);
  assert.equal(run.state.slices.products.offers[productId].contractId, contractId);
  const usage = run.state.slices.products.lastUsage[productId];
  assert.equal(usage.fulfillmentBps, 10000); assert.equal(usage.creditsCents, 0); assert.ok(usage.billedCents > 0);
  const request = preparedReleaseRequests(run.state).find(item => item.taskId === id)!;
  assert.equal(request.memoryMU, run.state.slices.models.versions[candidateModelId].residentMU + 20_000_000);
  assert.equal(request.sharedAdapterMemory, undefined, 'Preparation has a separate workspace even when serving adapters can share weights.');
  const cost = run.state.slices.compute.costReports![run.state.playerCompanyId].at(-1)!;
  const billedWork = cost.workloads.find(item => item.requestId === 'release-work:' + id)!;
  assert.ok(billedWork.attributedComputeCents > 0); assert.equal(cost.targets.find(item => item.id === billedWork.targetId)?.kind, 'internal');
  run.step();
  assert.equal(run.state.slices.products.preparedReleases![id].status, 'ready');
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated');
  assert.equal(run.state.scheduled.some(item => item.kind === 'model_release' && item.targetId === candidateModelId), false);
  assert.equal(preparedReleaseRequests(run.state).some(item => item.taskId === id), false, 'Durable prepared bundles reserve no idle GPU capacity or memory.');
  assert.deepEqual(validateState(run.state), []);
});

test('W9-P02: explicit promotion retains the source for its command boundary then changes exactly one deployment and invoice stream', () => {
  const run = setup('w9-p02'), id = prepare(run), before = structuredClone(run.state.slices.products.offers[productId]);
  const promotionWeek = run.week;
  const quote = previewCommand(run.state, { kind: 'promote_prepared_release', releaseId: id });
  assert.equal(quote.accepted, true); assert.ok(quote.summary.includes('Week ' + (promotionWeek + 2)));
  run.queue({ kind: 'promote_prepared_release', releaseId: id }); run.step();
  assert.equal(run.state.slices.products.offers[productId].deploymentId, before.deploymentId);
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'evaluated');
  assert.equal(run.state.slices.products.lastUsage[productId].fulfillmentBps, 10000);
  assert.equal(run.state.slices.products.preparedReleases![id].cutoverWeek, promotionWeek + 2);
  run.step();
  const product = run.state.slices.products.offers[productId], project = run.state.slices.products.preparedReleases![id];
  assert.equal(product.publicModelId, candidateModelId); assert.equal(product.contractId, before.contractId); assert.equal(product.status, 'active');
  assert.equal(run.state.slices.models.versions[candidateModelId].status, 'released');
  assert.equal(run.state.slices.products.deployments[before.deploymentId], undefined);
  assert.equal(Object.values(run.state.slices.products.deployments).filter(item => item.productId === productId).length, 1);
  assert.equal(project.releasedWeek, promotionWeek + 2); assert.equal(project.rollbackExpiresWeek, promotionWeek + 8);
  assert.equal(project.completedStaff, 2 * U); assert.equal(run.state.slices.products.deployments[product.deploymentId].requiredStaff, CONTENT.firstSale.deploymentStaff);
  assert.equal(run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week).length, 1);
  assert.equal(run.state.slices.products.lastUsage[productId].creditsCents, 0);
  assert.deepEqual(validateState(run.state), []);
});

test('W9-P03: zero development allocation and zero ML allocation independently block completion while the product stays live', () => {
  const run = setup('w9-p03');
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 });
  const id = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId }); run.step(2);
  let project = run.state.slices.products.preparedReleases![id];
  assert.equal(project.completedStaff, 2 * U); assert.equal(project.completedWork, 0); assert.equal(project.status, 'preparing');
  assert.equal(run.state.slices.products.lastUsage[productId].fulfillmentBps, 10000);
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 2 * U }); run.step(2);
  assert.equal(run.state.slices.products.preparedReleases![id].status, 'ready');
  const second = setup('w9-p03-no-ml');
  for (const staff of staffContributors(second.state, 'ml')) second.queue({ kind: 'set_staff_allocation', staffId: staff.id, fte: 0 });
  const secondId = 'prepared-release:' + second.queue({ kind: 'start_prepared_release', productId, candidateModelId }); second.step(2);
  project = second.state.slices.products.preparedReleases![secondId];
  assert.equal(project.completedWork, 2 * U); assert.equal(project.completedStaff, 0); assert.equal(project.status, 'preparing');
  assert.equal(second.state.slices.products.offers[productId].status, 'active');
});

test('W9-P04: queued and active release work lock both directions of configuration changes; discard restores ordinary choices', () => {
  const run = setup('w9-p04');
  const id = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId });
  assert.equal(submitCommand(run.state, { kind: 'start_prepared_release', productId, candidateModelId }).accepted, false);
  assert.equal(submitCommand(run.state, { kind: 'upgrade_product', productId, modelId: candidateModelId }).accepted, false);
  assert.equal(submitCommand(run.state, { kind: 'set_product_features', productId, features: { memory: true, extendedContext: false, deepReasoning: false } }).accepted, false);
  run.step();
  assert.equal(submitCommand(run.state, { kind: 'set_product_terms', productId, priceCents: 400, allowance: 50 }).accepted, false);
  run.queue({ kind: 'discard_prepared_release', releaseId: id }); run.step();
  assert.equal(run.state.slices.products.preparedReleases![id].status, 'discarded');
  assert.equal(run.state.slices.products.preparedReleases![id].completedWork, U, 'Discard never refunds already performed work.');
  assert.equal(previewCommand(run.state, { kind: 'upgrade_product', productId, modelId: candidateModelId }).accepted, true);
  const reversed = setup('w9-p04-reverse');
  reversed.queue({ kind: 'set_product_features', productId, features: { memory: true, extendedContext: false, deepReasoning: false } });
  assert.equal(submitCommand(reversed.state, { kind: 'start_prepared_release', productId, candidateModelId }).accepted, false);
  reversed.step();
  assert.equal(getQualifiedReleaseRehearsal(reversed.state, productId, candidateModelId), undefined, 'A configuration change makes the old rehearsal stale.');
});

test('W9-P05: paused preparation is lossless across save/load and its completed handover preserves an explicitly paused product', () => {
  const run = setup('w9-p05');
  const id = 'prepared-release:' + run.queue({ kind: 'start_prepared_release', productId, candidateModelId }); run.step();
  run.queue({ kind: 'set_prepared_release_paused', releaseId: id, paused: true }); run.step(2);
  const savedWork = structuredClone(run.state.slices.products.preparedReleases![id]);
  assert.equal(savedWork.completedWork, U); assert.equal(savedWork.completedStaff, U);
  const decoded = deserializeState(serializeState(run.state)); assert.ok(decoded.ok, decoded.ok ? '' : decoded.error);
  const replay = new NaturalBusinessCampaign(decoded.state, 'w9-p05-resume'), original = new NaturalBusinessCampaign(structuredClone(run.state), 'w9-p05-resume');
  for (const continuation of [original, replay]) {
    continuation.queue({ kind: 'set_prepared_release_paused', releaseId: id, paused: false }); continuation.step(2);
    continuation.queue({ kind: 'set_product_paused', productId, paused: true });
    continuation.queue({ kind: 'promote_prepared_release', releaseId: id }); continuation.step(2);
    assert.equal(continuation.state.slices.products.offers[productId].status, 'paused');
    assert.equal(continuation.state.slices.products.offers[productId].publicModelId, candidateModelId);
  }
  assert.equal(canonicalStateHash(original.state), canonicalStateHash(replay.state));
});

test('W9-P06: rollback uses fresh paid work, restores the retained source once, and preserves the original contract', () => {
  const run = setup('w9-p06'), id = release(run), forward = structuredClone(run.state.slices.products.preparedReleases![id]);
  const contractId = run.state.slices.products.offers[productId].contractId;
  run.queue({ kind: 'start_release_rollback', releaseId: id }); run.step();
  let rollback = run.state.slices.products.preparedReleases![id].rollback!;
  assert.equal(rollback.completedWork, U); assert.equal(rollback.completedStaff, U); assert.equal(rollback.status, 'ready');
  assert.equal(run.state.slices.products.offers[productId].publicModelId, candidateModelId);
  assert.equal(run.state.slices.products.preparedReleases![id].rollbackExpiresWeek, forward.rollbackExpiresWeek);
  run.step(); run.queue({ kind: 'promote_prepared_release', releaseId: id }); run.step(2);
  rollback = run.state.slices.products.preparedReleases![id].rollback!;
  assert.equal(rollback.status, 'complete'); assert.equal(run.state.slices.products.offers[productId].publicModelId, forward.sourceModelId);
  assert.equal(run.state.slices.products.offers[productId].contractId, contractId);
  assert.equal(previewCommand(run.state, { kind: 'start_release_rollback', releaseId: id }).accepted, false);
  assert.equal(run.state.slices.products.invoices.filter(item => item.productId === productId && item.week === run.week).length, 1);
  assert.deepEqual(validateState(run.state), []);
});

test('W9-P07: a starved or paused rollback cannot extend its window or produce a late model switch', () => {
  const run = setup('w9-p07'), id = release(run), expiry = run.state.slices.products.preparedReleases![id].rollbackExpiresWeek!;
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 });
  run.queue({ kind: 'start_release_rollback', releaseId: id }); run.step();
  run.queue({ kind: 'set_prepared_release_paused', releaseId: id, paused: true }); run.step();
  run.until(state => state.week > expiry, 8, 'retained-source expiration');
  const saved = run.state.slices.products.preparedReleases![id];
  assert.equal(saved.rollback!.status, 'discarded'); assert.equal(saved.rollbackExpiresWeek, expiry);
  assert.equal(saved.rollback!.completedWork, 0); assert.equal(saved.rollback!.completedStaff, U);
  assert.equal(run.state.slices.products.offers[productId].publicModelId, candidateModelId);
  assert.equal(previewCommand(run.state, { kind: 'promote_prepared_release', releaseId: id }).accepted, false);
  assert.equal(previewCommand(run.state, { kind: 'start_release_rollback', releaseId: id }).accepted, false);
});

test('W9-P08: saved proof rejects free preparation, changed workspace, missing rehearsal, fabricated cutover, and extended rollback', () => {
  const run = setup('w9-p08'), id = release(run);
  const bad = (change: (state: GameState) => void) => { const state = structuredClone(run.state); change(state); assert.throws(() => assertWave9PreparedReleases(state, CONTENT)); };
  bad(state => { state.slices.products.preparedReleases![id].physicalWork = 0; });
  bad(state => { state.slices.products.preparedReleases![id].requiredStaff = U; });
  bad(state => { state.slices.products.preparedReleases![id].requiredMemory = 0; });
  bad(state => { delete state.slices.products.releaseRehearsals![state.slices.products.preparedReleases![id].rehearsalId]; });
  bad(state => { state.slices.products.preparedReleases![id].cutoverWeek!--; });
  bad(state => { state.slices.products.preparedReleases![id].rollbackExpiresWeek!++; });
  bad(state => { delete state.commandReceipts[state.slices.products.preparedReleases![id].promotionCommandId!]; });
  bad(state => { delete state.slices.products.preparedReleases; });
  bad(state => { (state.slices.products as unknown as { preparedReleases: unknown }).preparedReleases = null; });
});
