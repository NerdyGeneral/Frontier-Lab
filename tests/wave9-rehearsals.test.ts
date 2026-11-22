import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RELEASE_REHEARSAL_RULES as RULES } from '../src/content/wave9-rehearsals';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState, ModuleContext } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave9ReleaseRehearsals } from '../src/core/wave9-rehearsals-validation';
import { advanceReleaseRehearsals, getQualifiedReleaseRehearsal, releaseCandidateReason, releaseConfigurationFingerprint, releaseModelFingerprint, releaseRehearsalOutcomes, releaseRehearsalRequests } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const PRODUCT = 'product:natural-business-command-8';
const CANDIDATE = 'model-wave7-natural-command-9';
const SOURCE = 'model-wave7-natural-command-13';
let baseline: GameState | undefined;
function campaign() {
  if (!baseline) {
    const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave7-snapshot.json'), 'utf8'));
    assert.ok(imported.ok, imported.ok ? '' : imported.error);
    const run = new NaturalBusinessCampaign(imported.state, 'wave9-rehearsal-accounting');
    run.queue({ kind: 'start_system_rollout', method: 'cost-accounting' });
    run.until(state => Object.values(state.slices.research.systemRollouts).some(item => item.companyId === state.playerCompanyId && item.method === 'cost-accounting' && item.status === 'active'), 12, 'paid cost-accounting rollout');
    baseline = structuredClone(run.state);
  }
  return new NaturalBusinessCampaign(structuredClone(baseline), 'wave9-rehearsal');
}
function start(run: NaturalBusinessCampaign): string {
  return 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId: PRODUCT, candidateModelId: CANDIDATE });
}
let reviewed: { state: GameState; id: string } | undefined;
function completed() {
  if (!reviewed) {
    const run = campaign(), id = start(run);
    run.until(state => state.slices.products.releaseRehearsals?.[id]?.status === 'complete', 10, 'completed paid rehearsal');
    reviewed = { state: structuredClone(run.state), id };
  }
  return structuredClone(reviewed);
}

test('W9-H01: both finite arms and ML review consume normal resources; outcomes arrive next boundary while incumbent invoices continue', () => {
  const run = campaign(), modelEvidence = (state: GameState) => ({ source: state.slices.models.versions[SOURCE], candidate: state.slices.models.versions[CANDIDATE],
    reports: Object.values(state.slices.models.reports).filter(report => report.modelId === SOURCE || report.modelId === CANDIDATE) });
  const modelsBefore = canonicalStateHash(modelEvidence(run.state)), sourceDeployment = run.state.slices.products.offers[PRODUCT].deploymentId;
  const quote = previewCommand(run.state, { kind: 'start_release_rehearsal', productId: PRODUCT, candidateModelId: CANDIDATE });
  assert.equal(quote.accepted, true, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0);
  const id = start(run), duplicate = submitCommand(run.state, { kind: 'start_release_rehearsal', productId: PRODUCT, candidateModelId: CANDIDATE });
  assert.equal(duplicate.accepted, false); assert.equal(duplicate.reason?.code, 'ALREADY_ACTIVE');
  run.until(state => state.slices.products.releaseRehearsals?.[id]?.status === 'ready', 10, 'both comparison arms');
  const rehearsal = run.state.slices.products.releaseRehearsals![id];
  assert.equal(rehearsal.completedStaff, U); assert.equal(rehearsal.arms.source.requiredWork, 2 * U); assert.equal(rehearsal.arms.candidate.requiredWork, 2 * U);
  assert.equal(rehearsal.arms.source.completedWork, 2 * U); assert.equal(rehearsal.arms.candidate.completedWork, 2 * U);
  assert.equal(rehearsal.arms.source.memoryMU, 2_270_000_000); assert.equal(rehearsal.arms.candidate.memoryMU, 2_020_000_000);
  assert.equal(rehearsal.arms.source.outcomes, null); assert.equal(rehearsal.availableWeek, run.week + 1);
  assert.equal(getQualifiedReleaseRehearsal(run.state, PRODUCT, CANDIDATE), undefined);
  assert.equal(run.state.slices.products.offers[PRODUCT].status, 'active'); assert.equal(run.state.slices.products.offers[PRODUCT].deploymentId, sourceDeployment);
  assert.equal(run.state.slices.products.offers[PRODUCT].publicModelId, SOURCE);
  assert.ok(run.state.slices.products.invoices.some(invoice => invoice.productId === PRODUCT && invoice.week === run.week && invoice.amountCents > 0));
  assert.equal(canonicalStateHash(modelEvidence(run.state)), modelsBefore, 'Comparisons neither train nor independently evaluate/release either model.');
  const cost = run.state.slices.compute.costReports![run.state.playerCompanyId].find(item => item.week === rehearsal.arms.candidate.latestGrant!.week)!;
  assert.ok(cost.workloads.some(item => item.requestId.endsWith(':candidate') && item.targetId === 'internal:development' && item.physicalWorkCUw > 0));
  assert.equal(run.state.slices.company.ledger.filter(item => item.sourceId === id).length, 0, 'The existing compute bill charges actual work; no duplicate rehearsal fee or revenue fact is posted.');
  run.step();
  const complete = run.state.slices.products.releaseRehearsals![id];
  assert.equal(complete.status, 'complete'); assert.equal(getQualifiedReleaseRehearsal(run.state, PRODUCT, CANDIDATE)?.id, id);
  for (const arm of Object.values(complete.arms)) {
    assert.equal(arm.outcomes!.cases, RULES.cases);
    assert.equal(arm.outcomes!.useful + arm.outcomes!.confidentError + arm.outcomes!.falseRefusal + arm.outcomes!.clarification, RULES.cases);
    assert.equal(arm.physicalWork, Object.values(arm.workReceipts).reduce((sum, receipt) => sum + receipt.physicalCUw, 0));
  }
  assert.deepEqual(validateState(run.state), []);
});

test('W9-H02: starvation and pause cannot create work; paid progress survives exact save continuation', () => {
  const run = campaign(), allocation = structuredClone(run.fleet.allocation);
  run.queue({ kind: 'allocate_compute', ...allocation, development: 0 });
  for (const member of staffContributors(run.state, 'ml')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  const id = start(run); run.step(2);
  let rehearsal = run.state.slices.products.releaseRehearsals![id];
  assert.equal(rehearsal.arms.source.completedWork + rehearsal.arms.candidate.completedWork + rehearsal.completedStaff, 0);
  assert.equal(rehearsal.status, 'running'); assert.ok(releaseRehearsalRequests(run.state).every(request => !request.sharedAdapterMemory));
  run.queue({ kind: 'set_release_rehearsal_paused', rehearsalId: id, paused: true }); run.step();
  const paused = canonicalStateHash(run.state.slices.products.releaseRehearsals![id]); run.step();
  assert.equal(canonicalStateHash(run.state.slices.products.releaseRehearsals![id]), paused);
  assert.equal(releaseRehearsalRequests(run.state).length, 0);
  const imported = deserializeState(serializeState(run.state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(canonicalStateHash(advanceWeek(run.state).state), canonicalStateHash(advanceWeek(imported.state).state));
  run.queue({ kind: 'set_release_rehearsal_paused', rehearsalId: id, paused: false });
  run.queue({ kind: 'allocate_compute', ...allocation });
  for (const member of staffContributors(run.state, 'ml')) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: U });
  run.until(state => state.slices.products.releaseRehearsals![id].status === 'complete', 10, 'resumed comparison');
  rehearsal = run.state.slices.products.releaseRehearsals![id];
  assert.equal(rehearsal.completedStaff, U); assert.equal(rehearsal.arms.source.completedWork, rehearsal.arms.source.requiredWork);
});

test('W9-H03: names and weeks cannot reroll cases; configuration changes stale qualification but preserve valid history', () => {
  const { state, id } = completed(), rehearsal = state.slices.products.releaseRehearsals![id], model = state.slices.models.versions[CANDIDATE];
  assert.equal(releaseModelFingerprint(model), releaseModelFingerprint({ ...model, name: 'A friendlier name', status: 'released' }));
  assert.deepEqual(releaseRehearsalOutcomes(model, rehearsal.configuration, rehearsal.evidenceKey),
    releaseRehearsalOutcomes({ ...model, name: 'Another name' }, rehearsal.configuration, rehearsal.evidenceKey));
  const run = new NaturalBusinessCampaign(state, 'wave9-config');
  const before = releaseConfigurationFingerprint(run.state, PRODUCT), contract = run.state.slices.products.contracts[run.state.slices.products.offers[PRODUCT].contractId];
  run.queue({ kind: 'set_product_terms', productId: PRODUCT, allowance: contract.allowance, priceCents: contract.weeklyPriceCents + 100 }); run.step();
  assert.equal(releaseConfigurationFingerprint(run.state, PRODUCT), before); assert.ok(getQualifiedReleaseRehearsal(run.state, PRODUCT, CANDIDATE));
  run.queue({ kind: 'set_product_features', productId: PRODUCT, features: { memory: true, extendedContext: false, deepReasoning: false } }); run.step();
  assert.equal(getQualifiedReleaseRehearsal(run.state, PRODUCT, CANDIDATE), undefined);
  assert.deepEqual(run.state.slices.products.releaseRehearsals![id], rehearsal);
  assert.deepEqual(validateState(run.state), []);
  const imported = deserializeState(serializeState(run.state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const newId = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId: PRODUCT, candidateModelId: CANDIDATE }); run.step();
  assert.equal(run.state.slices.products.releaseRehearsals![newId].evidenceKey, rehearsal.evidenceKey);
  assert.ok(run.state.slices.products.releaseRehearsals![newId].arms.candidate.requiredWork > rehearsal.arms.candidate.requiredWork);
});

test('W9-H04: import validation rejects outcome, work, memory, tariff, report and early-availability fabrication', () => {
  const { state, id } = completed();
  const mutations: ((copy: GameState) => void)[] = [
    copy => { copy.slices.products.releaseRehearsals![id].arms.candidate.outcomes!.useful += 1; },
    copy => { copy.slices.products.releaseRehearsals![id].arms.candidate.completedWork -= 1; },
    copy => { copy.slices.products.releaseRehearsals![id].arms.candidate.memoryMU = 1; },
    copy => { Object.values(copy.slices.products.releaseRehearsals![id].arms.candidate.workReceipts)[0].rateCentsPerCUw = 0; },
    copy => { copy.slices.products.releaseRehearsals![id].arms.candidate.capabilityReportId = 'invented-report'; },
    copy => { copy.slices.products.releaseRehearsals![id].availableWeek! -= 1; },
    copy => { copy.slices.products.releaseRehearsals![id].evidenceKey = '12345678'; },
    copy => { copy.slices.products.releaseRehearsals![id].completedStaff = 0; },
    copy => { copy.slices.products.releaseRehearsals![id].arms.candidate.latestGrant!.physicalCUw += 1; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(state); mutate(copy);
    assert.throws(() => assertWave9ReleaseRehearsals(copy, CONTENT));
    assert.ok(validateState(copy).length > 0);
  }
});

test('W9-H05: exact evaluated ownership, R12 timing and actual unshared resident grants remain mandatory', () => {
  const run = campaign(), state = run.state;
  assert.equal(releaseCandidateReason(state, state.playerCompanyId, PRODUCT, CANDIDATE), undefined);
  assert.equal(releaseCandidateReason(state, state.playerCompanyId, PRODUCT, SOURCE)?.code, 'NO_IMPROVEMENT');
  assert.equal(releaseCandidateReason(state, state.playerCompanyId, PRODUCT, 'seed-0')?.code, 'NOT_READY');
  const noReport = structuredClone(state);
  for (const [key, report] of Object.entries(noReport.slices.models.reports)) if (report.modelId === CANDIDATE) delete noReport.slices.models.reports[key];
  assert.equal(releaseCandidateReason(noReport, state.playerCompanyId, PRODUCT, CANDIDATE)?.code, 'NOT_READY');
  const early = structuredClone(state), research = Object.values(early.slices.research.projects).find(item => item.companyId === state.playerCompanyId && item.researchId === 'R12')!;
  research.availableWeek = state.week + 1;
  assert.equal(releaseCandidateReason(early, state.playerCompanyId, PRODUCT, CANDIDATE)?.code, 'NOT_READY');
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 }); const id = start(run); run.step();
  const request = releaseRehearsalRequests(run.state).find(item => item.id.endsWith(':candidate'))!;
  const products = structuredClone(run.state.slices.products);
  const context: ModuleContext = { week: run.week + 1, phase: 'execute', content: CONTENT, facts: [], random: { draw: () => 0 }, resources: {
    requests: [request], staffGrants: [], computeGrants: [{ requestId: request.id, physicalCUw: U, hardwareEffectiveCUw: U, memoryMU: 0, poolId: 'general-cloud' }],
  } };
  assert.throws(() => advanceReleaseRehearsals(run.state, context, products), /resident|workspace/);
  assert.equal(run.state.slices.products.releaseRehearsals![id].arms.candidate.completedWork, 0);
});

test('W9-H06: owned GPUs convert useful work into actual physical execution and reconcile with the existing cost meter', () => {
  const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave8-snapshot.json'), 'utf8'));
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const run = new NaturalBusinessCampaign(imported.state, 'wave9-owned-rehearsal'), id = start(run);
  run.until(state => state.slices.products.releaseRehearsals?.[id]?.status === 'complete', 10, 'owned comparison');
  const rehearsal = run.state.slices.products.releaseRehearsals![id];
  for (const arm of Object.values(rehearsal.arms)) {
    assert.ok(Object.values(arm.workReceipts).some(receipt => receipt.ownership === 'owned' && receipt.multiplierBps > 10000));
    assert.ok(arm.physicalWork < arm.completedWork, 'Authored training GPU conversion uses fewer physical units for this development workload.');
    const report = run.state.slices.compute.costReports![run.state.playerCompanyId].find(item => item.week === arm.latestGrant!.week)!;
    const measured = report.workloads.find(item => item.requestId === `rehearsal:${id}:${arm === rehearsal.arms.source ? 'source' : 'candidate'}`)!;
    assert.equal(measured.physicalWorkCUw, arm.latestGrant!.physicalCUw); assert.ok(measured.ownedVariableCents > 0);
  }
  assert.deepEqual(validateState(run.state), []);
});

test('W9-H07: installed evidence and retrieval identities are captured; runtime optimizations do not alter standard work', () => {
  const run = campaign(), productId = 'product:natural-business-command-163', candidateModelId = 'model-natural-business-command-157';
  run.queue({ kind: 'evaluate_model', modelId: candidateModelId, suiteId: 'expanded-capabilities-1' });
  run.until(state => Object.values(state.slices.models.reports).some(report => report.modelId === candidateModelId && report.suiteId === 'expanded-capabilities-1'), 12, 'paid candidate capability evaluation');
  const installed = structuredClone(run.state.slices.products.efficiencyInstalls[productId + ':evidence-links']);
  const id = 'release-rehearsal:' + run.queue({ kind: 'start_release_rehearsal', productId, candidateModelId });
  run.until(state => state.slices.products.releaseRehearsals?.[id]?.status === 'complete', 10, 'comparison with installed evidence links');
  const rehearsal = run.state.slices.products.releaseRehearsals![id];
  assert.equal(rehearsal.configuration.efficiency[0].id, installed.id);
  assert.equal(rehearsal.configuration.retrieval!.id, run.state.slices.products.retrievalInstalls[productId].id);
  assert.equal(rehearsal.arms.source.requiredWork, 4 * U, 'The standard bank excludes retrieval and evidence-check work.');
  assert.ok(getQualifiedReleaseRehearsal(run.state, productId, candidateModelId));
  run.queue({ kind: 'set_product_efficiency_enabled', productId, method: 'evidence-links', enabled: false }); run.step();
  assert.equal(getQualifiedReleaseRehearsal(run.state, productId, candidateModelId), undefined);
  assert.deepEqual(validateState(run.state), []);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
});
