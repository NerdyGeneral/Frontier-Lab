import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { POLICY_DATA_ID, POLICY_HOLDOUT_RULES } from '../src/content/wave11-policy';
import { DEFAULT_FEATURES } from '../src/content/wave2-market';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { CommandPayload, GameState, ProductKind } from '../src/contracts/types';
import { previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { assertWave11PolicyReleases } from '../src/core/wave11-policy-release-validation';
import { getAgentView } from '../src/modules/agents';
import { getModelCommerceRights } from '../src/modules/business';
import { inheritedModelRights } from '../src/modules/model-runtime';
import { policyHoldoutReport, policyReleaseRejection } from '../src/modules/policy-holdouts';
import { eligibleModel, requestMeter } from '../src/modules/product-models';
import { getQualifiedReleaseRehearsal, releaseModelFingerprint } from '../src/modules/release-rehearsals';
import { NaturalBusinessCampaign } from './fixtures/wave5-business';
import { createPolicyScenario, policyCandidate } from './fixtures/wave11-policy';
import type { PolicyCandidateFixture } from './fixtures/wave11-policy';

const missingReport = /exact paid policy boundary report/;
const unsafeReport = /at most 5\/50/;
function deploy(run: NaturalBusinessCampaign, modelId: string, productKind: ProductKind = 'basic-chat'): string {
  const id = 'product:' + run.queue({ kind: 'deploy_product', modelId, productKind, priceCents: 400, allowance: 100 });
  run.until(state => state.slices.products.offers[id]?.status === 'active', 8, 'public deployment');
  return id;
}
function incumbent(fixture: PolicyCandidateFixture, prefix: string) {
  const run = new NaturalBusinessCampaign(structuredClone(fixture.state), prefix);
  const productId = deploy(run, fixture.baseModelId);
  return { run, productId };
}
function agentCommand(state: GameState, modelId: string): CommandPayload {
  const order = getAgentView(state, state.playerCompanyId).orders[0];
  assert.ok(order, 'An unclaimed support intake must exist.');
  return { kind: 'start_agent_job', orderId: order.id, modelId, mode: 'draft', verification: 'basic',
    tools: ['read_ticket', 'search_docs', 'send_reply', 'issue_credit'], maxSteps: 24, maxRetries: 0, workBudget: 8 * U };
}
function gateCommands(state: GameState, modelId: string, productId: string, packetId: string): CommandPayload[] {
  return [
    { kind: 'deploy_product', modelId, productKind: 'developer-api', priceCents: 400, allowance: 100 },
    { kind: 'upgrade_product', productId, modelId },
    { kind: 'install_product_efficiency', productId, method: 'routing', secondaryModelId: modelId },
    { kind: 'start_release_rehearsal', productId, candidateModelId: modelId },
    { kind: 'start_prepared_release', productId, candidateModelId: modelId },
    { kind: 'sign_business_contract', customerId: 'aster-services', contractKind: 'private-hosted', modelId, packetId },
    { kind: 'sign_business_contract', customerId: 'vector-studio', contractKind: 'customer-hosted', modelId },
    agentCommand(state, modelId),
  ];
}
function deny(state: GameState, payload: CommandPayload, message: RegExp) {
  const before = canonicalStateHash(state), quote = previewCommand(state, payload), submitted = submitCommand(state, payload);
  assert.equal(quote.accepted, false, payload.kind); assert.equal(submitted.accepted, false, payload.kind);
  assert.equal(quote.reason?.code, 'NOT_READY', payload.kind); assert.equal(submitted.reason?.code, 'NOT_READY', payload.kind);
  assert.match(quote.reason!.message, message, payload.kind); assert.match(submitted.reason!.message, message, payload.kind);
  assert.equal(canonicalStateHash(state), before); assert.equal(canonicalStateHash(submitted.state), before);
}
function invalidImport(state: GameState) {
  assert.ok(validateState(state).length > 0);
  const text = JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: state.contentVersion,
    checksum: canonicalStateHash(state), state });
  assert.equal(deserializeState(text).ok, false);
}

let variantWithoutReport: PolicyCandidateFixture | undefined, variantWithReport: PolicyCandidateFixture | undefined;
function variantFixture(reported: boolean): PolicyCandidateFixture {
  if (!variantWithoutReport) {
    const original = policyCandidate({ reported: true }), run = new NaturalBusinessCampaign(original.state, 'commercial-variant');
    const id = run.queue({ kind: 'create_model_variant', modelId: original.modelId, variant: 'compression' });
    const modelId = 'variant:' + id;
    run.until(state => !!state.slices.models.versions[modelId], 8, 'paid model compression');
    run.evaluate(modelId, 'expanded-capabilities-1');
    variantWithoutReport = { ...original, state: run.state, modelId };
  }
  if (!reported) return structuredClone(variantWithoutReport);
  if (!variantWithReport) {
    const run = new NaturalBusinessCampaign(structuredClone(variantWithoutReport.state), 'commercial-variant-policy');
    run.evaluate(variantWithoutReport.modelId, POLICY_HOLDOUT_RULES.suiteId);
    variantWithReport = { ...variantWithoutReport, state: run.state };
  }
  return structuredClone(variantWithReport);
}

type AdmissionKind = 'deployment' | 'rehearsal' | 'release' | 'routing' | 'contract' | 'agent';
interface Admission { name: string; kind: AdmissionKind; id: string; state: GameState; modelId: string }
let admissions: Admission[] | undefined;
function commercialAdmissions(): Admission[] {
  if (admissions) return structuredClone(admissions);
  const approved = policyCandidate({ reported: true }), results: Admission[] = [];
  const remember = (name: string, kind: AdmissionKind, id: string, run: NaturalBusinessCampaign, modelId = approved.modelId) => {
    assert.deepEqual(validateState(run.state), []); assert.doesNotThrow(() => assertWave11PolicyReleases(run.state));
    results.push({ name, kind, id, state: structuredClone(run.state), modelId });
  };
  const direct = new NaturalBusinessCampaign(structuredClone(approved.state), 'commercial-direct');
  const command = direct.queue({ kind: 'deploy_product', modelId: approved.modelId, priceCents: 400, allowance: 100 }); direct.step();
  remember('direct deployment', 'deployment', 'deployment:' + command, direct);
  const upgraded = incumbent(approved, 'commercial-upgrade');
  const upgrade = upgraded.run.queue({ kind: 'upgrade_product', productId: upgraded.productId, modelId: approved.modelId }); upgraded.run.step();
  remember('direct replacement', 'deployment', 'deployment:' + upgrade, upgraded.run);
  for (const kind of ['private-hosted', 'customer-hosted'] as const) {
    const run = new NaturalBusinessCampaign(structuredClone(approved.state), 'commercial-' + kind);
    const customerId = kind === 'private-hosted' ? 'aster-services' : 'vector-studio';
    run.queue({ kind: 'sign_business_contract', customerId, contractKind: kind, modelId: approved.modelId,
      ...(kind === 'private-hosted' ? { packetId: approved.packetId } : {}) }); run.step();
    remember(kind, 'contract', 'business:' + customerId, run);
  }
  const agent = new NaturalBusinessCampaign(structuredClone(approved.state), 'commercial-agent');
  agent.queue(agentCommand(agent.state, approved.modelId)); agent.step();
  remember('agent work', 'agent', Object.values(agent.state.slices.agents.jobs)[0].id, agent);
  const staged = incumbent(approved, 'commercial-staged');
  const rehearsalId = 'release-rehearsal:' + staged.run.queue({ kind: 'start_release_rehearsal', productId: staged.productId, candidateModelId: approved.modelId });
  staged.run.step(); remember('release rehearsal', 'rehearsal', rehearsalId, staged.run);
  staged.run.until(state => !!getQualifiedReleaseRehearsal(state, staged.productId, approved.modelId), 8, 'qualified paid rehearsal');
  const releaseId = 'prepared-release:' + staged.run.queue({ kind: 'start_prepared_release', productId: staged.productId, candidateModelId: approved.modelId });
  staged.run.step(); remember('release preparation', 'release', releaseId, staged.run);
  const variant = variantFixture(true), routed = incumbent(variant, 'commercial-routing');
  const installationId = 'efficiency:' + routed.run.queue({ kind: 'install_product_efficiency', productId: routed.productId, method: 'routing', secondaryModelId: variant.modelId });
  routed.run.step(); remember('routing secondary', 'routing', installationId, routed.run, variant.modelId);
  admissions = results; return structuredClone(results);
}
function backdateAdmission(item: Admission, week: number) {
  const products = item.state.slices.products;
  if (item.kind === 'deployment') products.deployments[item.id].startedWeek = week;
  else if (item.kind === 'rehearsal') products.releaseRehearsals![item.id].startedWeek = week;
  else if (item.kind === 'release') products.preparedReleases![item.id].startedWeek = week;
  else if (item.kind === 'routing') Object.values(products.efficiencyInstalls).find(install => install.id === item.id)!.startedWeek = week;
  else if (item.kind === 'contract') products.commercialContracts[item.id].signedWeek = week;
  else item.state.slices.agents.jobs[item.id].acceptedWeek = week;
}

test('W11-C01: capability-qualified policy candidates cannot enter any commercial path without their own paid policy report', () => {
  const candidate = policyCandidate(), { run, productId } = incumbent(candidate, 'commercial-unreported');
  assert.equal(policyHoldoutReport(run.state, candidate.modelId), undefined);
  assert.equal(eligibleModel(run.state, candidate.modelId, run.state.playerCompanyId, 'basic-chat'), false);
  assert.ok(!getAgentView(run.state, run.state.playerCompanyId).models.some(model => model.id === candidate.modelId));
  for (const payload of gateCommands(run.state, candidate.modelId, productId, candidate.packetId)) deny(run.state, payload, missingReport);
  assert.deepEqual(validateState(run.state), []);
});

test('W11-C02: the exact paid passing report admits direct and staged releases, contracts, agents and a separately tested routing variant', () => {
  const approved = policyCandidate({ reported: true }), report = policyHoldoutReport(approved.state, approved.modelId)!;
  assert.ok(report); assert.ok(report.policy!.totals.unsafeCompliances <= POLICY_HOLDOUT_RULES.unsafeCeiling);
  assert.equal(policyReleaseRejection(approved.state, approved.modelId), undefined);
  assert.ok(eligibleModel(approved.state, approved.modelId, approved.state.playerCompanyId, 'basic-chat'));
  assert.ok(getAgentView(approved.state, approved.state.playerCompanyId).models.some(model => model.id === approved.modelId));
  const accepted = commercialAdmissions(); assert.equal(accepted.length, 8);
  for (const item of accepted) {
    const restored = deserializeState(serializeState(item.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
    assert.equal(canonicalStateHash(restored.state), canonicalStateHash(item.state), item.name);
    assert.ok(policyHoldoutReport(restored.state, item.modelId), item.name);
  }
});

test('W11-C03: a genuine paid report above the release ceiling blocks every commercial route and cannot be rerolled', () => {
  // A fixed authored scenario with seven failures at the trained boundary policy;
  // the candidate, labels, staff, GPU work and both reports are still earned normally.
  const state = createPolicyScenario(); state.seed = 'policy-commercial-stress-1';
  const run = new NaturalBusinessCampaign(state, 'commercial-failed-policy');
  const packetId = run.prepare(POLICY_DATA_ID), modelId = run.train({ baseModelId: CONTENT.seedModel.id, packetId, recipeId: 'policy-boundary-discrimination' });
  run.evaluate(modelId, 'expanded-capabilities-1'); run.evaluate(modelId, POLICY_HOLDOUT_RULES.suiteId);
  const report = policyHoldoutReport(run.state, modelId)!; assert.ok(report); assert.equal(report.policy!.totals.unsafeCompliances, 7);
  assert.deepEqual(validateState(run.state), []);
  const productId = deploy(run, CONTENT.seedModel.id);
  for (const payload of gateCommands(run.state, modelId, productId, packetId)) deny(run.state, payload, unsafeReport);
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId, suiteId: POLICY_HOLDOUT_RULES.suiteId }).reason?.code, 'NO_IMPROVEMENT');
});

test('W11-C04: runtime variants inherit policy and rights but need their own capability and policy evidence before cheaper routing', () => {
  const fixture = variantFixture(false), variant = fixture.state.slices.models.versions[fixture.modelId];
  const source = fixture.state.slices.models.versions[variant.runtimeVariant!.sourceModelId];
  assert.deepEqual(variant.policy, source.policy);
  assert.deepEqual(inheritedModelRights(fixture.state, variant.id, CONTENT), inheritedModelRights(fixture.state, source.id, CONTENT));
  assert.ok(policyHoldoutReport(fixture.state, source.id)); assert.equal(policyHoldoutReport(fixture.state, variant.id), undefined);
  const routed = incumbent(fixture, 'commercial-unreported-variant');
  deny(routed.run.state, { kind: 'install_product_efficiency', productId: routed.productId, method: 'routing', secondaryModelId: variant.id }, missingReport);
  deny(fixture.state, { kind: 'deploy_product', modelId: variant.id, priceCents: 400, allowance: 100 }, missingReport);
  const reported = variantFixture(true);
  assert.ok(policyHoldoutReport(reported.state, reported.modelId)); assert.equal(policyReleaseRejection(reported.state, reported.modelId), undefined);
  assert.ok(requestMeter(reported.state.slices.models.versions[reported.modelId], DEFAULT_FEATURES).work < requestMeter(source, DEFAULT_FEATURES).work);
  const forged = structuredClone(reported.state); delete forged.slices.models.versions[reported.modelId].policy;
  invalidImport(forged);
});

test('W11-C05: commercial save histories reject deleted policy evidence or admission backdated before the paid report', () => {
  for (const item of commercialAdmissions()) {
    const report = policyHoldoutReport(item.state, item.modelId)!;
    const missing = structuredClone(item.state);
    delete missing.slices.models.reports[report.id];
    for (const [id, run] of Object.entries(missing.slices.models.evaluationRuns)) if (run.reportId === report.id) delete missing.slices.models.evaluationRuns[id];
    assert.throws(() => assertWave11PolicyReleases(missing), /before admission/, item.name + ' missing report');
    invalidImport(missing);
    backdateAdmission(item, report.week - 1);
    assert.throws(() => assertWave11PolicyReleases(item.state), /before admission/, item.name + ' postdated report');
    invalidImport(item.state);
  }
});

test('W11-C06: policy labels and a passing report cannot launder hosted-only feedback ancestry into a weight license', () => {
  const run = new NaturalBusinessCampaign(createPolicyScenario(), 'commercial-hosted-rights');
  const productId = deploy(run, CONTENT.seedModel.id);
  const studyId = 'feedback-study:' + run.queue({ kind: 'start_feedback_study', productId, sampling: 'representative', consent: 'hosted-only' });
  run.until(state => state.slices.data.feedbackStudies?.[studyId]?.status === 'closed', 12, 'closed consented study');
  run.until(state => state.slices.data.feedbackStudies![studyId].reviewableWeek! <= state.week, 2, 'reviewable feedback');
  const reviewId = 'feedback-review:' + run.queue({ kind: 'start_feedback_review', studyId, mode: 'verified' });
  run.until(state => state.slices.data.feedbackReviews?.[reviewId]?.status === 'complete', 8, 'paid feedback review');
  const feedbackId = run.state.slices.data.feedbackReviews![reviewId].outputPacketId;
  const hostedBase = run.train({ baseModelId: CONTENT.seedModel.id, packetId: feedbackId, recipeId: 'calibration-curriculum' });
  assert.deepEqual(getModelCommerceRights(run.state, hostedBase, CONTENT), { hosted: true, weights: false });
  const packetId = run.prepare(POLICY_DATA_ID), modelId = run.train({ baseModelId: hostedBase, packetId, recipeId: 'policy-boundary-discrimination' });
  run.evaluate(modelId, 'expanded-capabilities-1'); run.evaluate(modelId, POLICY_HOLDOUT_RULES.suiteId);
  assert.equal(policyReleaseRejection(run.state, modelId), undefined);
  assert.deepEqual(getModelCommerceRights(run.state, modelId, CONTENT), { hosted: true, weights: false });
  deny(run.state, { kind: 'sign_business_contract', customerId: 'vector-studio', contractKind: 'customer-hosted', modelId }, /weight distribution rights/);
  run.queue({ kind: 'sign_business_contract', customerId: 'aster-services', contractKind: 'private-hosted', modelId, packetId: feedbackId }); run.step();
  assert.deepEqual(run.state.slices.products.commercialContracts['business:aster-services'].rights, { hosted: true, weights: false });
  assert.deepEqual(validateState(run.state), []);
});

test('W11-C07: conservative refusals affect legitimate service and retention while token and GPU work per request stay unchanged', () => {
  const boundary = policyCandidate({ reported: true }), setup = new NaturalBusinessCampaign(boundary.state, 'commercial-policy-comparison');
  const conservativeId = setup.train({ baseModelId: boundary.baseModelId, packetId: boundary.packetId, recipeId: 'policy-conservative-refusal' });
  setup.evaluate(conservativeId, 'expanded-capabilities-1'); setup.evaluate(conservativeId, POLICY_HOLDOUT_RULES.suiteId);
  const discerning = setup.state.slices.models.versions[boundary.modelId], conservative = setup.state.slices.models.versions[conservativeId];
  assert.deepEqual(technicalTraits(discerning), technicalTraits(conservative));
  assert.ok(conservative.behavior!.falseRefusalBps > discerning.behavior!.falseRefusalBps);
  assert.deepEqual(requestMeter(conservative, DEFAULT_FEATURES), requestMeter(discerning, DEFAULT_FEATURES));
  const left = new NaturalBusinessCampaign(structuredClone(setup.state), 'commercial-service');
  const right = new NaturalBusinessCampaign(structuredClone(setup.state), 'commercial-service');
  const leftProduct = deploy(left, discerning.id), rightProduct = deploy(right, conservative.id);
  assert.equal(leftProduct, rightProduct);
  let equalTrafficChecked = false, leftLost = 0, rightLost = 0;
  for (let week = 0; week < 24; week++) {
    left.step(); right.step();
    const a = left.state.slices.products.lastUsage[leftProduct], b = right.state.slices.products.lastUsage[rightProduct];
    assert.equal(a.behavior!.falseRefusalBps, discerning.behavior!.falseRefusalBps);
    assert.equal(b.behavior!.falseRefusalBps, conservative.behavior!.falseRefusalBps);
    if (!equalTrafficChecked && a.executedWork > 0) {
      assert.equal(a.requestedWork, b.requestedWork); assert.equal(a.executedWork, b.executedWork);
      assert.equal(a.errorBps, b.errorBps);
      assert.equal(left.fleet.lastWork.serving, right.fleet.lastWork.serving);
      assert.equal(a.billedCents, b.billedCents); equalTrafficChecked = true;
    }
    leftLost += left.state.slices.markets.lastLost; rightLost += right.state.slices.markets.lastLost;
  }
  assert.ok(equalTrafficChecked); assert.ok(rightLost > leftLost, `Conservative ${rightLost} versus boundary ${leftLost} departed accounts.`);
  assert.deepEqual(validateState(left.state), []); assert.deepEqual(validateState(right.state), []);
});

function technicalTraits(model: GameState['slices']['models']['versions'][string]) {
  return { capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps,
    confidentErrorBps: model.behavior!.confidentErrorBps, family: model.family, architecture: model.architecture, residentMU: model.residentMU };
}

test('W11-C08: release fingerprints retain published legacy values and bind newly adopted policy behavior', () => {
  const published = JSON.parse(readFileSync(join(__dirname, 'fixtures/wave10-snapshot.json'), 'utf8')).state as GameState;
  assert.equal(releaseModelFingerprint(published.slices.models.versions['model-wave7-natural-command-14']), '867a11db');
  assert.equal(releaseModelFingerprint(published.slices.models.versions['variant:wave9-natural-command-2']), '109ede20');
  const fixture = policyCandidate({ reported: true }), model = fixture.state.slices.models.versions[fixture.modelId];
  const saved = releaseModelFingerprint(model), changed = structuredClone(model); changed.policy!.currentUnsafeComplianceBps++;
  assert.notEqual(releaseModelFingerprint(changed), saved);
  assert.equal(releaseModelFingerprint({ ...model, name: 'Renamed release', status: 'released', evaluationReportId: 'another-display-pointer' }), saved);
});
