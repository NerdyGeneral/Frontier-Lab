import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { POLICY_DATA_ID, POLICY_DATA_RULES } from '../src/content/wave11-policy';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { GameState } from '../src/contracts/types';
import { advanceWeek, previewCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { BASE_BEHAVIOR, buildTrainingPlan, expectedTrainingOutcome, getTrainingPreview } from '../src/modules/lab-planner';
import { getAvailableRoleCapacity } from '../src/modules/workforce';
import { policyEvidenceFromPackets } from '../src/modules/policy-training';
import { behaviorMeter } from '../src/modules/product-models';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { createPolicyScenario, policyCandidate } from './fixtures/wave11-policy';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';

const recipe = 'policy-boundary-discrimination';
const conservative = 'policy-conservative-refusal';

test('W11-T01: paid policy labels need three data staff-weeks and cannot be replaced by generic behavior evidence', () => {
  const run = new NaturalBusinessCampaign(createPolicyScenario(), 'policy-data-test');
  run.queue({ kind: 'buy_data', catalogId: POLICY_DATA_ID }); run.step();
  const packet = run.packet(POLICY_DATA_ID)!;
  assert.equal(packet.rawUnits, 200); assert.equal(packet.readyUnits, 0); assert.equal(packet.policy?.pairs, 100);
  assert.equal(packet.qualityBps, 9000); assert.equal(packet.behaviorUnits, 0); assert.equal(packet.broadUnits, 0);
  assert.deepEqual(packet.coverageBps, { conversation: 0, documents: 0, coding: 0, tools: 0 });
  assert.deepEqual(packet.rights, { hosted: true, weights: true, feedback: false });
  assert.equal(run.state.slices.company.ledger.find(fact => fact.id === packet.purchaseFactId)?.amountCents, 800_000);
  const training = { kind: 'start_training' as const, baseModelId: CONTENT.seedModel.id, packetId: packet.id, recipeId: recipe };
  assert.equal(previewCommand(run.state, training).accepted, false);
  // Isolate the founder's 20 Data points, so one week pays for exactly one of the three units.
  const employees = Object.values(run.state.slices.company.staff).filter(member => member.companyId === run.state.playerCompanyId);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('data');
  run.queue({ kind: 'prepare_data', packetId: packet.id }); run.step();
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'data'), U);
  const preparationId = Object.values(run.state.slices.data.preparationJobs).find(job => job.packetId === packet.id)!.id;
  assert.equal(run.state.slices.data.preparationJobs[preparationId].requiredStaff, 3 * U);
  assert.equal(run.state.slices.data.preparationJobs[preparationId].completedStaff, U);
  assert.equal(previewCommand(run.state, training).accepted, false);
  run.until(state => state.slices.data.packets[packet.id].prepared, 4);
  assert.equal(run.state.slices.data.preparationJobs[preparationId].completedStaff, POLICY_DATA_RULES.preparationStaff);
  assert.equal(previewCommand(run.state, training).accepted, true);
  const genericId = run.prepare('specialist-conversation-1');
  assert.equal(previewCommand(run.state, { ...training, packetId: genericId }).accepted, false);
  assert.deepEqual(policyEvidenceFromPackets([run.state.slices.data.packets[genericId]]), { sourceIds: [], distinctPairs: 0, qualityBps: 0 });
  for (const missing of ['R5', 'R1A']) {
    const state = structuredClone(run.state); state.slices.research.completedByCompany[state.playerCompanyId] = state.slices.research.completedByCompany[state.playerCompanyId].filter(id => id !== missing);
    assert.equal(previewCommand(state, training).accepted, false);
  }
});

test('W11-T02: the two paid methods earn a genuine finite refusal tradeoff without changing capability, reliability or serving work', () => {
  for (const [approach, work, unsafe, refusal] of [
    ['boundary-discrimination', 24 * U, 660, 385], ['conservative-refusal', 16 * U, 390, 1150],
  ] as const) {
    const { state, modelId, baseModelId } = policyCandidate({ approach }), model = state.slices.models.versions[modelId], base = state.slices.models.versions[baseModelId];
    const trained = state.slices.models.trainingRuns[model.trainingRunId!];
    assert.equal(trained.requiredWork, work); assert.equal(trained.completedWork, work); assert.equal(trained.physicalWork, work);
    assert.equal(trained.plan?.policy?.distinctPairs, 100); assert.equal(trained.plan?.policy?.qualityBps, 9000);
    assert.equal(trained.plan?.policy?.baselineFalseRefusalBps, 700);
    assert.equal(model.policy?.currentUnsafeComplianceBps, unsafe); assert.equal(model.behavior?.falseRefusalBps, refusal);
    assert.deepEqual(model.capabilityBps, base.capabilityBps); assert.equal(model.reliabilityBps, base.reliabilityBps);
    assert.equal(model.behavior?.confidentErrorBps, base.behavior?.confidentErrorBps ?? BASE_BEHAVIOR.confidentErrorBps);
    assert.equal(model.planner, base.planner); assert.equal(model.residentMU, base.residentMU);
    assert.equal(behaviorMeter(model, 2000).falseRefusalBps, refusal);
    assert.deepEqual(inheritedModelRights(state, modelId, CONTENT), { hosted: true, weights: true });
    assert.equal(trained.plan?.corpus.rights.feedback, false);
    assert.equal(trained.evidence.policy, undefined, 'Aggregate evidence must not impersonate the original paired-label packet.');
    assert.deepEqual(validateState(state), []);
  }
});

test('W11-T03: policy work stalls without assigned ML staff or connected workspace and pause preserves its paid progress', () => {
  const { state, baseModelId, packetId } = policyCandidate(), run = new NaturalBusinessCampaign(state, 'policy-resources');
  const employees = Object.values(run.state.slices.company.staff).filter(member => member.companyId === run.state.playerCompanyId);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: 0 });
  run.founder('research');
  const id = 'training-' + run.queue({ kind: 'start_training', baseModelId, packetId, recipeId: conservative }); run.step();
  assert.equal(run.state.slices.models.trainingRuns[id].completedWork, 0);
  run.queue({ kind: 'allocate_compute', serving: 0, development: U, research: 0 }); run.step();
  assert.equal(getAvailableRoleCapacity(run.state, run.state.playerCompanyId, 'ml'), 0);
  for (const member of employees) run.queue({ kind: 'set_staff_allocation', staffId: member.id, fte: member.assignedFte });
  run.queue({ kind: 'set_cloud_capacity', cu: U }); run.founder('ml'); run.step();
  assert.equal(run.state.slices.models.trainingRuns[id].completedWork, 0, 'One cloud CU has only two MU, below the four-MU training workspace.');
  run.queue({ kind: 'set_job_paused', jobId: id, paused: true }); run.queue({ kind: 'set_cloud_capacity', cu: 64 * U }); run.step();
  run.queue({ kind: 'allocate_compute', serving: 48 * U, development: 8 * U, research: 0 }); run.step();
  assert.equal(run.state.slices.models.trainingRuns[id].completedWork, 0);
  const frozen = structuredClone(run.state.slices.models.trainingRuns[id].plan);
  run.queue({ kind: 'set_job_paused', jobId: id, paused: false }); run.step();
  assert.equal(run.state.slices.models.trainingRuns[id].completedWork, 8 * U);
  assert.deepEqual(run.state.slices.models.trainingRuns[id].plan, frozen);
  assert.ok(run.state.slices.models.trainingRuns[id].physicalWork > 0);
  run.until(value => value.slices.models.trainingRuns[id].status === 'complete', 4);
  assert.deepEqual(validateState(run.state), []);
});

test('W11-T04: curation improves paired-label quality once, source aliases do not multiply pairs, and old plans stay frozen', () => {
  const fixture = policyCandidate(), run = new NaturalBusinessCampaign(fixture.state, 'policy-curation');
  const original = structuredClone(run.state.slices.data.packets[fixture.packetId]);
  const oldPlan = structuredClone(run.state.slices.models.trainingRuns[run.state.slices.models.versions[fixture.modelId].trainingRunId!].plan);
  const curatedId = run.prepare(POLICY_DATA_ID, 9500), curated = run.state.slices.data.packets[curatedId];
  assert.deepEqual(curated.policy, original.policy); assert.deepEqual(run.state.slices.data.packets[original.id], original);
  const evidence = policyEvidenceFromPackets([original, curated, curated]);
  assert.deepEqual(evidence, { sourceIds: [POLICY_DATA_ID], distinctPairs: 100, qualityBps: 9500 });
  const options = { baseModelId: fixture.baseModelId, packetId: original.id, packetIds: [original.id, curated.id], recipeId: recipe };
  const preview = getTrainingPreview(run.state, run.state.playerCompanyId, options);
  assert.deepEqual(preview.policy, { distinctPairs: 100, qualityBps: 9500, unsafeComplianceBps: 630, falseRefusalBps: 367 });
  assert.equal(preview.workCUw, 24 * U); assert.equal(preview.reason, undefined);
  assert.deepEqual(run.state.slices.models.trainingRuns[run.state.slices.models.versions[fixture.modelId].trainingRunId!].plan, oldPlan);
  const modelId = run.train(options), model = run.state.slices.models.versions[modelId];
  assert.equal(model.policy?.currentUnsafeComplianceBps, 630); assert.equal(model.behavior?.falseRefusalBps, 367);
  const forged = structuredClone(run.state), curation = Object.values(forged.slices.data.preparationJobs).find(job => job.packetId === curatedId)!;
  delete forged.slices.data.preparationJobs[curation.id]; assert.notDeepEqual(validateState(forged), [], 'A curated policy packet must retain its own paid review.');
});

test('W11-T05: changing policy methods uses root anchors; repeating a recipe cannot compound or reroll', () => {
  const fixture = policyCandidate(), run = new NaturalBusinessCampaign(fixture.state, 'policy-switch');
  const modelId = run.train({ baseModelId: fixture.modelId, packetId: fixture.packetId, recipeId: conservative });
  const model = run.state.slices.models.versions[modelId], plan = run.state.slices.models.trainingRuns[model.trainingRunId!].plan!;
  assert.equal(plan.policy?.baselineUnsafeComplianceBps, 1200); assert.equal(plan.policy?.baselineFalseRefusalBps, 700);
  assert.equal(model.policy?.currentUnsafeComplianceBps, 390); assert.equal(model.behavior?.falseRefusalBps, 1150);
  assert.equal(previewCommand(run.state, { kind: 'start_training', baseModelId: modelId, packetId: fixture.packetId, recipeId: recipe }).reason?.code, 'NO_IMPROVEMENT');
  assert.equal(previewCommand(run.state, { kind: 'start_training', baseModelId: modelId, packetId: fixture.packetId, recipeId: conservative }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(validateState(run.state), []);
});

test('W11-T06: ordinary descendant training inherits earned policy and false refusals while a fresh foundation resets it', () => {
  const fixture = policyCandidate(), run = new NaturalBusinessCampaign(fixture.state, 'policy-descendant');
  const genericId = run.prepare('specialist-conversation-1');
  const calibratedId = run.train({ baseModelId: fixture.modelId, packetId: genericId, recipeId: 'calibration-curriculum' });
  const parent = run.state.slices.models.versions[fixture.modelId], model = run.state.slices.models.versions[calibratedId];
  const calibration = run.state.slices.models.trainingRuns[model.trainingRunId!];
  assert.deepEqual(model.policy, parent.policy); assert.deepEqual(calibration.plan?.inheritedPolicy, parent.policy); assert.equal(calibration.plan?.policy, undefined);
  assert.equal(model.behavior?.falseRefusalBps, parent.behavior?.falseRefusalBps); assert.equal(model.behavior?.confidentErrorBps, 550);
  const foundation = buildTrainingPlan(run.state, run.state.playerCompanyId, { baseModelId: calibratedId, packetId: genericId, recipeId: 'medium-foundation' });
  assert.equal(foundation.plan.policy, undefined); assert.equal(foundation.plan.inheritedPolicy, undefined);
  assert.deepEqual(foundation.plan.behaviorTarget, BASE_BEHAVIOR);
  const corrupted = structuredClone(run.state); delete corrupted.slices.models.trainingRuns[model.trainingRunId!].plan!.inheritedPolicy;
  assert.notDeepEqual(validateState(corrupted), []);
});

test('W11-T07: earned optional policy survives deterministic saves and forged targets, labels or model gains are rejected', () => {
  const { state, modelId, packetId } = policyCandidate({ reported: true }), model = state.slices.models.versions[modelId];
  const restored = deserializeState(serializeState(state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.equal(canonicalStateHash(restored.state), canonicalStateHash(state));
  const first = advanceWeek(state), second = advanceWeek(restored.state);
  assert.ok(first.accepted, first.reason?.message); assert.ok(second.accepted, second.reason?.message);
  assert.equal(canonicalStateHash(first.state), canonicalStateHash(second.state));
  for (const mutate of [
    (copy: GameState) => { copy.slices.models.versions[modelId].policy!.currentUnsafeComplianceBps -= 1; },
    (copy: GameState) => { copy.slices.models.trainingRuns[model.trainingRunId!].plan!.policy!.targetFalseRefusalBps -= 1; },
    (copy: GameState) => { copy.slices.data.packets[packetId].policy!.pairs += 1; },
    (copy: GameState) => { delete copy.slices.data.packets[packetId].policy; },
    (copy: GameState) => { const job = Object.values(copy.slices.data.preparationJobs).find(item => item.packetId === packetId)!; delete copy.slices.data.preparationJobs[job.id]; },
    (copy: GameState) => { copy.slices.models.versions[CONTENT.seedModel.id].policy = structuredClone(model.policy); },
  ]) {
    const copy = structuredClone(state); mutate(copy); assert.notDeepEqual(validateState(copy), []);
  }
  const trained = state.slices.models.trainingRuns[model.trainingRunId!];
  assert.equal(expectedTrainingOutcome(trained, trained.requiredWork / 2).policy?.currentUnsafeComplianceBps, 930);
  assert.equal(expectedTrainingOutcome(trained, trained.requiredWork / 2).behavior?.falseRefusalBps, 542);
});
