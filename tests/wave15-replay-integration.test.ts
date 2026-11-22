import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState } from '../src/contracts/types';
import { canonicalStateHash } from '../src/core/canonical';
import { previewCommand, validateState } from '../src/core/engine';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { batchModelEligible } from '../src/modules/batch-inference';
import { getAvailableRoleCapacity } from '../src/modules/workforce';
import { getTrainingPreview } from '../src/modules/lab-planner';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { replayResearchAvailable } from '../src/modules/replay-curriculum';
import { activeRuntimeGuardrail } from '../src/modules/runtime-guardrails';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const API = 'product:natural-business-command-67';
const BASE = 'model-wave11-natural-command-3';
const TRANSFERABLE_BASE = 'model-natural-business-command-63';
const DOCUMENTS = 'curated-natural-business-command-111';
const CODING = 'curated-natural-business-command-54';
const FEEDBACK = 'feedback-data:wave10-natural-command-2';
type Training = Extract<CommandPayload, { kind: 'start_training' }>;
const fork = (state: GameState, prefix: string) => new NaturalBusinessCampaign(structuredClone(state), prefix);
const training = (run: NaturalBusinessCampaign, id: string) => run.state.slices.models.trainingRuns[id];
const latestCost = (run: NaturalBusinessCampaign) => run.state.slices.compute.costReports![run.state.playerCompanyId].at(-1)!;
const trainRow = (run: NaturalBusinessCampaign, id: string) => latestCost(run).workloads.find(row => row.requestId === id + ':work');
const configuration = (state: GameState) => canonicalStateHash({
  offers: Object.fromEntries(Object.entries(state.slices.products.offers).filter(([, offer]) => offer.companyId === state.playerCompanyId)),
  deployments: Object.fromEntries(Object.entries(state.slices.products.deployments).filter(([, deployment]) => deployment.companyId === state.playerCompanyId)),
});
const valid = (run: NaturalBusinessCampaign) => assert.deepEqual(validateState(run.state), []);

let earned: GameState | undefined;
/** An authentic paid company, followed by ordinary R4C discovery; no resources or model scores are granted. */
function replayCompany(): GameState {
  if (earned) return structuredClone(earned);
  const imported = deserializeState(readFileSync(join(__dirname, 'fixtures/wave14-snapshot.json'), 'utf8'));
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(imported.state.week, 477);
  const run = new NaturalBusinessCampaign(imported.state, 'w15-integration-research');
  const id = 'research-' + run.queue({ kind: 'start_research', researchId: 'R4C' });
  run.until(state => replayResearchAvailable(state), 10, 'paid replay research and next-boundary availability');
  const project = run.state.slices.research.projects[id];
  assert.equal(project.completedWork, 6 * U); assert.equal(project.completedStaff, 3 * U);
  assert.ok(project.availableWeek! > project.completedWeek!);
  const fees = run.state.slices.company.ledger.filter(fact => fact.id === id + ':fee');
  assert.equal(fees.length, 1); assert.equal(fees[0].amountCents, 300_000);
  assert.ok(Object.values(run.state.slices.compute.racks).some(rack => rack.companyId === run.state.playerCompanyId && rack.status === 'installed'));
  valid(run); earned = structuredClone(run.state); return structuredClone(earned);
}

function adaptation(overrides: Partial<Training> = {}): Training {
  return { kind: 'start_training', baseModelId: BASE, packetId: DOCUMENTS, recipeId: 'document-adaptation', profile: 'stable', ...overrides };
}
function replayAdaptation(overrides: Partial<Training> = {}): Training {
  return adaptation({ replay: { domain: 'coding', shareBps: 5000, packetIds: [CODING] }, ...overrides });
}
function start(run: NaturalBusinessCampaign, payload = replayAdaptation()): string {
  return 'training-' + run.queue(payload);
}

test('W15-I01: preserving an evaluated skill consumes additional owned GPU work without rerolling other skills or changing live service', () => {
  const state = replayCompany(), plain = fork(state, 'w15-paid-pair'), replay = fork(state, 'w15-paid-pair');
  const originalConfiguration = configuration(state), originalBase = canonicalStateHash(state.slices.models.versions[BASE]);
  const ordinaryPreview = getTrainingPreview(state, state.playerCompanyId, adaptation());
  const replayPreview = getTrainingPreview(state, state.playerCompanyId, replayAdaptation());
  assert.equal(ordinaryPreview.workCUw, 19_800_000_000); assert.equal(replayPreview.workCUw, 39_600_000_000);
  const a = start(plain, adaptation()), b = start(replay);
  const totals = { plainPhysical: 0, replayPhysical: 0, plainCost: 0, replayCost: 0 };
  let plainCompleted = 0, replayCompleted = 0;
  for (let tick = 0; tick < 12 && (!plainCompleted || !replayCompleted); tick++) {
    plain.step(); replay.step();
    const p = trainRow(plain, a), r = trainRow(replay, b);
    for (const row of [p, r]) if (row?.physicalWorkCUw) {
      assert.ok(row.poolId.startsWith('owned:')); assert.ok(row.ownedVariableCents > 0);
    }
    totals.plainPhysical += p?.physicalWorkCUw ?? 0; totals.replayPhysical += r?.physicalWorkCUw ?? 0;
    totals.plainCost += p?.ownedVariableCents ?? 0; totals.replayCost += r?.ownedVariableCents ?? 0;
    if (training(plain, a).status === 'complete' && !plainCompleted) plainCompleted = plain.week;
    if (training(replay, b).status === 'complete' && !replayCompleted) replayCompleted = replay.week;
    assert.deepEqual(replay.state.slices.products.lastUsage[API], plain.state.slices.products.lastUsage[API]);
    assert.equal(configuration(replay.state), originalConfiguration);
    assert.equal(canonicalStateHash(replay.state.slices.models.versions[BASE]), originalBase);
    assert.equal(latestCost(replay).totals.cloudRentCents, latestCost(plain).totals.cloudRentCents);
    assert.equal(replay.state.slices.products.invoices.filter(invoice => invoice.productId === API && invoice.week === replay.week).length, 1);
  }
  assert.ok(replayCompleted > plainCompleted && plainCompleted > 0);
  const ordinary = training(plain, a), retained = training(replay, b), receipt = retained.plan!.replay!;
  assert.equal(ordinary.completedWork, 19_800_000_000); assert.equal(retained.completedWork, 39_600_000_000);
  assert.equal(receipt.focusWorkCUw, ordinary.requiredWork); assert.equal(receipt.replayWorkCUw, ordinary.requiredWork);
  assert.equal(receipt.ordinaryIdentity, ordinary.plan!.identity);
  assert.deepEqual(retained.plan!.savedAdjustments, ordinary.plan!.savedAdjustments);
  assert.equal(retained.physicalWork, totals.replayPhysical); assert.equal(ordinary.physicalWork, totals.plainPhysical);
  assert.ok(totals.replayPhysical > totals.plainPhysical); assert.ok(totals.replayCost > totals.plainCost);
  const plainModel = plain.state.slices.models.versions[ordinary.outputModelId], replayModel = replay.state.slices.models.versions[retained.outputModelId];
  for (const domain of ['conversation', 'documents', 'tools'] as const) assert.equal(replayModel.capabilityBps[domain], plainModel.capabilityBps[domain]);
  assert.equal(replayModel.reliabilityBps, plainModel.reliabilityBps);
  assert.deepEqual(replayModel.behavior, plainModel.behavior); assert.deepEqual(replayModel.policy, plainModel.policy);
  assert.ok(replayModel.capabilityBps.coding >= 5000 && plainModel.capabilityBps.coding < 5000);
  assert.ok(replayModel.capabilityBps.coding <= state.slices.models.versions[BASE].capabilityBps.coding);
  assert.equal(Object.values(replay.state.slices.models.reports).some(report => report.modelId === replayModel.id), false);
  assert.equal(latestCost(replay).totals.attributedComputeCents + latestCost(replay).totals.sharedComputeCents, latestCost(replay).totals.totalComputeCents);
  valid(plain); valid(replay);
});

test('W15-I02: paid replay cannot advance without both actual ML supervision and development capacity', () => {
  const run = fork(replayCompany(), 'w15-resource-gates');
  const employees = Object.values(run.state.slices.company.staff).filter(member => member.companyId === run.state.playerCompanyId);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('commercial');
  // The owned racks need operators. Keep an actual cloud development budget for this zero-Design week.
  run.queue({ kind: 'allocate_compute', serving: Math.min(run.fleet.allocation.serving, run.fleet.cloudCU - 6 * U), development: 6 * U, research: 0 });
  const id = start(run); run.step();
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'ml'), 0);
  assert.equal(training(run, id).completedWork, 0); assert.equal(training(run, id).physicalWork, 0);
  assert.equal(trainRow(run, id)!.physicalWorkCUw, 0);
  assert.equal(training(run, id).checkpointModelIds!.length, 0);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 0 }); run.step();
  assert.equal(training(run, id).completedWork, 0); assert.equal(training(run, id).physicalWork, 0);
  assert.equal(trainRow(run, id)!.physicalWorkCUw, 0);
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 6 * U }); run.step();
  assert.ok(training(run, id).completedWork > 0 && training(run, id).completedWork < training(run, id).requiredWork);
  assert.ok(training(run, id).physicalWork > 0); assert.ok(trainRow(run, id)!.ownedVariableCents > 0);
  assert.equal(run.state.slices.models.versions[training(run, id).outputModelId], undefined);
  valid(run);
});

test('W15-I03: paid automated checkpoints preserve partial retention and resume deterministically after pause and reload', () => {
  const run = fork(replayCompany(), 'w15-checkpoints');
  run.queue({ kind: 'allocate_compute', ...run.fleet.allocation, development: 2 * U });
  const id = start(run, replayAdaptation({ automatedCheckpoints: true }));
  run.until(state => (state.slices.models.trainingRuns[id]?.checkpointModelIds?.length ?? 0) > 0, 8, 'first paid replay checkpoint');
  const current = training(run, id), receipt = canonicalStateHash(current.plan!.replay), checkpointIds = [...current.checkpointModelIds!];
  assert.equal(current.plan!.checkpointOverheadRequired, 2 * U); assert.ok(current.checkpointOverheadCompleted! > 0);
  assert.ok(current.completedWork < current.requiredWork); assert.equal(current.status, 'running');
  const saved = Object.fromEntries(checkpointIds.map(modelId => [modelId, canonicalStateHash(run.state.slices.models.versions[modelId])]));
  const firstCheckpoint = run.state.slices.models.versions[checkpointIds[0]];
  assert.ok(firstCheckpoint.capabilityBps.coding < current.plan!.replay!.preservationFloorBps);
  const paidWork = current.completedWork, paidPhysical = current.physicalWork;
  run.queue({ kind: 'set_job_paused', jobId: id, paused: true }); run.step(2);
  assert.equal(training(run, id).completedWork, paidWork); assert.equal(training(run, id).physicalWork, paidPhysical);
  assert.equal(canonicalStateHash(training(run, id).plan!.replay), receipt);
  run.queue({ kind: 'set_job_paused', jobId: id, paused: false });
  const imported = deserializeState(serializeState(run.state)); assert.ok(imported.ok, imported.ok ? '' : imported.error);
  const reopened = new NaturalBusinessCampaign(imported.state, 'w15-reopened-no-new-commands');
  let executedAfterResume = 0;
  for (let count = 0; count < 30 && training(run, id).status !== 'complete'; count++) {
    run.step(); reopened.step();
    executedAfterResume += trainRow(run, id)?.effectiveWorkCUw ?? 0;
    assert.equal(canonicalStateHash(reopened.state), canonicalStateHash(run.state));
  }
  const completed = training(run, id);
  assert.equal(completed.status, 'complete'); assert.equal(completed.checkpointOverheadCompleted, 2 * U);
  assert.equal(completed.completedWork, completed.requiredWork);
  assert.equal(executedAfterResume, completed.requiredWork - paidWork + 2 * U - current.checkpointOverheadCompleted!);
  assert.equal(completed.checkpointModelIds!.length, 10);
  for (const modelId of checkpointIds) assert.equal(canonicalStateHash(run.state.slices.models.versions[modelId]), saved[modelId]);
  assert.equal(canonicalStateHash(completed.plan!.replay), receipt); valid(run); valid(reopened);
});

test('W15-I04: hosted-only replay evidence restricts a transferable base and its later tuning and deployment variant', () => {
  const run = fork(replayCompany(), 'w15-replay-rights');
  assert.deepEqual(inheritedModelRights(run.state, TRANSFERABLE_BASE, CONTENT), { hosted: true, weights: true });
  assert.equal(run.state.slices.data.packets[DOCUMENTS].rights.weights, true);
  assert.deepEqual(run.state.slices.data.packets[FEEDBACK].rights, { hosted: true, weights: false, feedback: true });
  const id = start(run, replayAdaptation({ baseModelId: TRANSFERABLE_BASE, replay: { domain: 'coding', shareBps: 5000, packetIds: [FEEDBACK] } }));
  run.until(state => state.slices.models.trainingRuns[id]?.status === 'complete', 12, 'hosted-only replay candidate');
  const completed = training(run, id), modelId = completed.outputModelId;
  assert.equal(completed.plan!.corpus.rights.weights, true); assert.equal(completed.plan!.replay!.corpus.rights.weights, false);
  assert.deepEqual(inheritedModelRights(run.state, modelId, CONTENT), { hosted: true, weights: false });
  assert.deepEqual(inheritedModelRights(run.state, TRANSFERABLE_BASE, CONTENT), { hosted: true, weights: true });
  run.evaluate(modelId);
  const variantId = 'variant:' + run.queue({ kind: 'create_model_variant', modelId, variant: 'compression' });
  run.until(state => !!state.slices.models.versions[variantId], 8, 'paid compression of hosted-only replay output');
  assert.deepEqual(inheritedModelRights(run.state, variantId, CONTENT), { hosted: true, weights: false });
  const descendant = run.train({ baseModelId: modelId, packetId: DOCUMENTS, packetIds: [DOCUMENTS, CODING], recipeId: 'behavior-reliability' });
  assert.deepEqual(run.state.slices.models.versions[descendant].capabilityBps, run.state.slices.models.versions[modelId].capabilityBps);
  assert.deepEqual(inheritedModelRights(run.state, descendant, CONTENT), { hosted: true, weights: false });
  assert.equal(run.state.slices.data.packets[FEEDBACK].rights.weights, false); valid(run);
});

test('W15-I05: replay earns new batch eligibility only after fresh capability and policy evaluations while old products and orders keep their bindings', () => {
  const state = replayCompany(), run = fork(state, 'w15-commercial-release');
  const oldConfiguration = configuration(state), oldBase = canonicalStateHash(state.slices.models.versions[BASE]);
  const oldGuardrail = activeRuntimeGuardrail(state, API)?.id;
  assert.ok(oldGuardrail);
  const packets = canonicalStateHash(state.slices.data.packets), feedback = canonicalStateHash(state.slices.data.feedbackStudies);
  const priorBatchId = 'batch:' + run.queue({ kind: 'accept_batch_job', productId: API, orderId: 'code-index', modelId: BASE, weeklyWorkCapCUw: 2 * U });
  const id = start(run); run.step();
  const priorBatch = run.state.slices.products.batchJobs![priorBatchId];
  const frozenBatch = canonicalStateHash({ model: priorBatch.model, meter: priorBatch.meter, terms: priorBatch.terms, deadline: priorBatch.deadlineWeek });
  run.until(state => state.slices.models.trainingRuns[id].status === 'complete', 12, 'retained coding candidate');
  const modelId = training(run, id).outputModelId, model = run.state.slices.models.versions[modelId];
  assert.ok(model.capabilityBps.coding >= 5000); assert.ok(model.capabilityBps.documents >= 5500);
  assert.deepEqual(model.policy, state.slices.models.versions[BASE].policy);
  const acceptance: CommandPayload = { kind: 'accept_batch_job', productId: API, orderId: 'code-index', modelId, weeklyWorkCapCUw: 16 * U };
  assert.equal(batchModelEligible(run.state, modelId, 'code-index'), false);
  assert.equal(previewCommand(run.state, acceptance).accepted, false);
  run.evaluate(modelId, 'expanded-capabilities-1');
  assert.equal(batchModelEligible(run.state, modelId, 'code-index'), false, 'Inherited policy needs a fresh paid holdout for this exact replay candidate.');
  assert.equal(previewCommand(run.state, acceptance).accepted, false);
  run.evaluate(modelId, 'policy-boundaries-1');
  assert.equal(batchModelEligible(run.state, modelId, 'code-index'), true);
  assert.equal(batchModelEligible(run.state, modelId, 'longform-digest'), false, 'Replay retains a capability without granting the missing reliability tune.');
  const reports = Object.values(run.state.slices.models.reports).filter(report => report.modelId === modelId);
  assert.deepEqual(reports.map(report => report.suiteId).sort(), ['expanded-capabilities-1', 'policy-boundaries-1']);
  for (const report of reports) {
    const paid = Object.values(run.state.slices.models.evaluationRuns).find(evaluation => evaluation.reportId === report.id)!;
    assert.equal(paid.completedWork, paid.requiredWork); assert.equal(paid.completedStaff, paid.requiredStaff);
  }
  const newBatchId = 'batch:' + run.queue(acceptance);
  run.until(next => next.slices.products.batchJobs?.[newBatchId]?.status === 'completed', 6, 'paid code-index delivery from the new replay model');
  const nextBatch = run.state.slices.products.batchJobs![newBatchId], terminal = run.state.slices.products.batchInvoices!.filter(invoice => invoice.jobId === newBatchId);
  assert.equal(nextBatch.model.modelId, modelId); assert.equal(terminal.length, 1); assert.equal(terminal[0].amountCents, 1_500_000);
  assert.equal(configuration(run.state), oldConfiguration); assert.equal(canonicalStateHash(run.state.slices.models.versions[BASE]), oldBase);
  assert.equal(activeRuntimeGuardrail(run.state, API)?.id, oldGuardrail);
  const old = run.state.slices.products.batchJobs![priorBatchId];
  assert.equal(canonicalStateHash({ model: old.model, meter: old.meter, terms: old.terms, deadline: old.deadlineWeek }), frozenBatch);
  assert.equal(canonicalStateHash(run.state.slices.data.packets), packets); assert.equal(canonicalStateHash(run.state.slices.data.feedbackStudies), feedback);
  assert.equal(run.state.slices.products.invoices.filter(invoice => invoice.productId === API && invoice.week === run.week).length, 1);
  assert.equal(run.state.slices.company.ledger.filter(fact => fact.id === terminal[0].id).length, 1); valid(run);
});

test('W15-I06: replay-source cleanup saves only paid replay processing and keeps the retained target and ordinary outcomes fixed', () => {
  const setup = fork(replayCompany(), 'w15-replay-cleanup');
  const cleanedId = 'deduplicated-' + setup.queue({ kind: 'deduplicate_data', packetId: CODING });
  setup.until(state => !!state.slices.data.packets[cleanedId]?.prepared, 8, 'paid replay source cleanup');
  const cleanupJob = Object.values(setup.state.slices.data.preparationJobs).find(job => job.packetId === cleanedId)!;
  assert.equal(cleanupJob.completedStaff, cleanupJob.requiredStaff); assert.ok(cleanupJob.requiredStaff > 0);
  const plain = fork(setup.state, 'w15-cleanup-pair'), clean = fork(setup.state, 'w15-cleanup-pair');
  const a = start(plain), b = start(clean, replayAdaptation({ replay: { domain: 'coding', shareBps: 5000, packetIds: [cleanedId] } }));
  plain.step(); clean.step();
  const ordinaryReceipt = training(plain, a).plan!.replay!, cleanedReceipt = training(clean, b).plan!.replay!;
  assert.equal(ordinaryReceipt.focusWorkCUw, 19_800_000_000); assert.equal(cleanedReceipt.focusWorkCUw, ordinaryReceipt.focusWorkCUw);
  assert.equal(cleanedReceipt.nominalReplayWorkCUw, 19_800_000_000); assert.equal(cleanedReceipt.replayWorkCUw, 17_820_000_000);
  assert.equal(cleanedReceipt.deduplication!.savedWorkCUw, 1_980_000_000); assert.equal(training(clean, b).requiredWork, 37_620_000_000);
  assert.equal(training(clean, b).plan!.deduplication, undefined, 'Cleaning replay data does not discount the separate focus corpus.');
  assert.equal(cleanedReceipt.preservationFloorBps, ordinaryReceipt.preservationFloorBps);
  assert.equal(cleanedReceipt.corpus.fingerprint, ordinaryReceipt.corpus.fingerprint);
  assert.deepEqual(training(clean, b).plan!.savedAdjustments, training(plain, a).plan!.savedAdjustments);
  plain.until(state => state.slices.models.trainingRuns[a].status === 'complete', 10, 'ordinary replay work');
  clean.until(state => state.slices.models.trainingRuns[b].status === 'complete', 10, 'cleaned replay work');
  const originalModel = plain.state.slices.models.versions[training(plain, a).outputModelId], cleanedModel = clean.state.slices.models.versions[training(clean, b).outputModelId];
  assert.deepEqual(cleanedModel.capabilityBps, originalModel.capabilityBps); assert.equal(cleanedModel.reliabilityBps, originalModel.reliabilityBps);
  assert.deepEqual(cleanedModel.policy, originalModel.policy); assert.ok(training(clean, b).physicalWork < training(plain, a).physicalWork);
  valid(plain); valid(clean);
});
