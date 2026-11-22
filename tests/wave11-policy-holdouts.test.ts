import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { POLICY_HOLDOUT_ADMISSION_MESSAGE, POLICY_HOLDOUT_RULES as RULES, POLICY_PROTOCOL } from '../src/content/wave11-policy';
import type { CommandPayload, EvaluationReport, GameState, ModelVersion, ModuleContext } from '../src/contracts/types';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { isCapabilitySuite } from '../src/modules/evaluation-classification';
import { createEvaluationReport } from '../src/modules/lab-evaluation';
import { hasCapabilityEvaluation } from '../src/modules/model-runtime';
import { capturedPolicyHoldoutAdmission, createPolicyHoldoutAdmission, createPolicyHoldoutResult, policyHoldoutReport, policyModelFingerprint, policyReleaseRejection } from '../src/modules/policy-holdouts';

/** An established published company earned its existing models, capability reports and R1A through ordinary play. */
class PolicyCampaign {
  constructor(public state: GameState) {}
  get id() { return this.state.playerCompanyId; }
  get modelId() { return 'model-natural-business-command-4'; }
  get model() { return this.state.slices.models.versions[this.modelId]; }
  queue(payload: CommandPayload): string {
    const result = submitCommand(this.state, payload);
    assert.ok(result.accepted, result.reason?.message); this.state = result.state; return result.commandId!;
  }
  step(): void {
    const commands = this.state.queuedCommands.filter(command => command.companyId === this.id).map(command => command.id);
    const result = advanceWeek(this.state); assert.ok(result.accepted, result.reason?.message); this.state = result.state;
    for (const id of commands) assert.equal(this.state.commandReceipts[id].status, 'accepted', this.state.commandReceipts[id].reason?.message);
    assert.equal(this.state.slices.company.companies[this.id].arrearsCents, 0);
  }
  until(done: () => boolean, limit = 10): void {
    for (let week = 0; week < limit && !done(); week++) this.step();
    assert.ok(done(), 'The paid policy test should finish with actual staff and compute grants.');
  }
  allocation(development: number): void { this.queue({ kind: 'allocate_compute', serving: 81 * U, development, research: 0 }); }
  staff(fte: number): void {
    for (const person of staffContributors(this.state, 'research'))
      this.queue({ kind: 'set_staff_allocation', staffId: person.id, fte });
  }
  evaluate(): { runId: string; report: EvaluationReport } {
    this.allocation(4 * U);
    const id = this.queue({ kind: 'evaluate_model', modelId: this.modelId, suiteId: RULES.suiteId }), runId = 'evaluation-' + id;
    this.until(() => this.state.slices.models.evaluationRuns[runId]?.status === 'complete');
    return { runId, report: this.state.slices.models.reports['report-' + runId] };
  }
}

let prepared: GameState | undefined;
function company(): PolicyCampaign {
  if (!prepared) {
    const decoded = deserializeState(readFileSync(join(__dirname, 'fixtures/wave5-snapshot.json'), 'utf8'));
    assert.ok(decoded.ok, decoded.ok ? '' : decoded.error);
    const run = new PolicyCampaign(decoded.state); run.queue({ kind: 'set_cloud_capacity', cu: 90 * U }); run.step();
    prepared = structuredClone(run.state);
  }
  return new PolicyCampaign(structuredClone(prepared));
}
let completed: GameState | undefined, completedRunId = '';
function complete(): { run: PolicyCampaign; runId: string; report: EvaluationReport } {
  if (!completed) { const run = company(), result = run.evaluate(); completed = structuredClone(run.state); completedRunId = result.runId; }
  const run = new PolicyCampaign(structuredClone(completed));
  return { run, runId: completedRunId, report: run.state.slices.models.reports['report-' + completedRunId] };
}

test('W11-H01: policy holdouts require R1A and an exact, completed, paid capability baseline', () => {
  const run = company();
  const quote = previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId });
  assert.ok(quote.accepted, quote.reason?.message); assert.equal(quote.upfrontCostCents, 0);
  const noResearch = structuredClone(run.state);
  noResearch.slices.research.completedByCompany[run.id] = noResearch.slices.research.completedByCompany[run.id].filter(id => id !== RULES.researchId);
  assert.equal(previewCommand(noResearch, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }).accepted, false);
  const checkpoint = Object.values(run.state.slices.models.versions).find(model => model.companyId === run.id && model.status === 'checkpoint')!;
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: checkpoint.id, suiteId: RULES.suiteId }).reason?.message, POLICY_HOLDOUT_ADMISSION_MESSAGE);
  const foreign = Object.values(run.state.slices.models.versions).find(model => model.companyId !== run.id)!;
  assert.equal(createPolicyHoldoutAdmission(run.state, run.id, foreign.id), null);
  const admission = createPolicyHoldoutAdmission(run.state, run.id, run.modelId)!;
  assert.ok(admission); assert.equal(admission.protocol, POLICY_PROTOCOL);
  const unpaid = structuredClone(run.state);
  for (const [id, paid] of Object.entries(unpaid.slices.models.evaluationRuns)) if (paid.reportId === admission.baselineReportId) delete unpaid.slices.models.evaluationRuns[id];
  assert.equal(createPolicyHoldoutAdmission(unpaid, run.id, run.modelId), null, 'A copied report cannot replace paid capability work.');
  const wrongVersion = structuredClone(run.state); wrongVersion.slices.models.reports[admission.baselineReportId].capabilityBps.conversation++;
  assert.equal(createPolicyHoldoutAdmission(wrongVersion, run.id, run.modelId), null, 'The prior report must measure this exact candidate.');
});

test('W11-H02: actual compute and research staff finish independently; pausing preserves admission and the capability pointer', () => {
  const run = company(), modelBefore = structuredClone(run.model), reportBefore = structuredClone(run.state.slices.models.reports[run.model.evaluationReportId!]);
  run.staff(0); run.allocation(4 * U);
  const id = run.queue({ kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }), runId = 'evaluation-' + id;
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }).reason?.code, 'ALREADY_ACTIVE');
  run.step();
  let evaluation = run.state.slices.models.evaluationRuns[runId];
  assert.equal(evaluation.requiredWork, 4 * U); assert.equal(evaluation.requiredStaff, U);
  assert.equal(evaluation.completedWork, 4 * U); assert.equal(evaluation.completedStaff, 0); assert.equal(evaluation.reportId, null);
  assert.equal(run.state.slices.compute.fleets[run.id].lastWork.development, 4 * U);
  const frozen = structuredClone(evaluation.policy);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: true }); run.staff(U); run.step();
  assert.equal(run.state.slices.models.evaluationRuns[runId].completedStaff, 0);
  run.allocation(0); run.queue({ kind: 'set_job_paused', jobId: runId, paused: false }); run.step();
  evaluation = run.state.slices.models.evaluationRuns[runId];
  assert.equal(evaluation.status, 'complete'); assert.equal(evaluation.completedStaff, U);
  assert.deepEqual(evaluation.policy, frozen); assert.deepEqual(run.model, modelBefore);
  assert.deepEqual(run.state.slices.models.reports[reportBefore.id], reportBefore);
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }).reason?.code, 'NO_IMPROVEMENT');
  assert.deepEqual(validateState(run.state), []);
});

test('W11-H03: allowed and restricted outcomes reconcile separately with explicit direct and adversarial denominators', () => {
  const { run, report } = complete(), totals = report.policy!.totals;
  assert.equal(report.basicChatEligible, false); assert.equal(report.cases.length, 100);
  assert.equal(totals.allowedCases, 50); assert.equal(totals.restrictedCases, 50);
  assert.equal(totals.usefulAnswers + totals.confidentErrors + totals.falseRefusals + totals.clarifications, 50);
  assert.equal(totals.correctPolicyRefusals + totals.unsafeCompliances, 50);
  assert.equal(totals.directRestrictedCases, 25); assert.equal(totals.adversarialRestrictedCases, 25);
  assert.equal(totals.directUnsafeCompliances + totals.adversarialUnsafeCompliances, totals.unsafeCompliances);
  assert.ok(totals.unsafeCompliances > 0, 'Restricted cases can fail instead of being automatic policy passes.');
  for (const [index, item] of report.cases.entries()) {
    assert.equal(item.id, `${RULES.suiteId}:case-${String(index + 1).padStart(2, '0')}`);
    assert.equal(item.policy!.eligibility, index < 50 ? 'allowed' : 'restricted');
    assert.equal(item.passed, ['useful', 'correct-policy-refusal'].includes(item.policy!.outcome));
    assert.equal(item.outcome, undefined); assert.equal(item.holdout, undefined);
  }
  assert.equal(policyHoldoutReport(run.state, run.modelId)?.id, report.id);
  assert.equal(report.outcomes, undefined); assert.equal(report.holdout, undefined);
  assert.equal(isCapabilitySuite(RULES.suiteId), false);
  const diagnosticsOnly = structuredClone(run.state); diagnosticsOnly.slices.models.reports = { [report.id]: report };
  assert.equal(hasCapabilityEvaluation(diagnosticsOnly, run.modelId), false);
  assert.equal(createPolicyHoldoutAdmission(diagnosticsOnly, run.id, run.modelId), null);
});

test('W11-H04: candidate aliases, report IDs, waiting, preview and random stream changes cannot reroll reserved cases', () => {
  const run = company(), before = canonicalStateHash(run.state), admission = createPolicyHoldoutAdmission(run.state, run.id, run.modelId)!;
  const first = createPolicyHoldoutResult(run.model, admission);
  for (let i = 0; i < 3; i++) previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId });
  assert.equal(canonicalStateHash(run.state), before);
  const alias: ModelVersion = { ...run.model, id: 'same-weights-another-name', name: 'Another candidate' };
  const changed = { ...admission, baselineReportId: 'a-different-paid-report', modelFingerprint: policyModelFingerprint(alias) };
  assert.deepEqual(createPolicyHoldoutResult(alias, changed).cases, first.cases);
  assert.equal(policyModelFingerprint({ ...run.model, name: 'Only renamed', status: 'evaluated', evaluationReportId: 'a-new-pointer' }), admission.modelFingerprint);
  const context: ModuleContext = { week: run.state.week + 30, phase: 'resolve', content: CONTENT, facts: [],
    resources: { requests: [], staffGrants: [], computeGrants: [] }, random: { draw: () => { throw new Error('Policy diagnostics must not consume simulation randomness.'); } } };
  const later = createEvaluationReport(alias, 'later-command', RULES.suiteId, context, CONTENT, undefined, changed);
  assert.deepEqual(later.cases, first.cases); assert.deepEqual(later.policy!.totals, first.policy.totals);
  assert.throws(() => createEvaluationReport(run.model, 'unreserved', RULES.suiteId, context, CONTENT), /reserved candidate/);
  const waiting = structuredClone(run.state); waiting.week += 30;
  assert.equal(createPolicyHoldoutAdmission(waiting, run.id, run.modelId)!.evidenceKey, admission.evidenceKey);
});

test('W11-H05: the same cases reveal refusal-versus-compliance tradeoffs without inventing technical improvements', () => {
  const run = company(), admission = createPolicyHoldoutAdmission(run.state, run.id, run.modelId)!;
  // Isolate the properties earned by the separately tested training lane; these are not injected game saves.
  const boundary: ModelVersion = { ...run.model, behavior: { ...run.model.behavior!, falseRefusalBps: 385 },
    policy: { protocol: POLICY_PROTOCOL, baselineUnsafeComplianceBps: 1200, currentUnsafeComplianceBps: 660 } };
  const conservative: ModelVersion = { ...run.model, behavior: { ...run.model.behavior!, falseRefusalBps: 1150 },
    policy: { protocol: POLICY_PROTOCOL, baselineUnsafeComplianceBps: 1200, currentUnsafeComplianceBps: 390 } };
  const original = createPolicyHoldoutResult(run.model, admission), discerning = createPolicyHoldoutResult(boundary, admission), cautious = createPolicyHoldoutResult(conservative, admission);
  assert.ok(discerning.policy.totals.falseRefusals <= original.policy.totals.falseRefusals);
  assert.ok(discerning.policy.totals.usefulAnswers >= original.policy.totals.usefulAnswers);
  assert.ok(cautious.policy.totals.falseRefusals >= discerning.policy.totals.falseRefusals);
  assert.ok(cautious.policy.totals.usefulAnswers <= discerning.policy.totals.usefulAnswers);
  assert.ok(cautious.policy.totals.unsafeCompliances <= discerning.policy.totals.unsafeCompliances);
  assert.ok(discerning.policy.totals.unsafeCompliances <= original.policy.totals.unsafeCompliances);
  for (const candidate of [discerning, cautious]) {
    assert.equal(candidate.policy.totals.confidentErrors, original.policy.totals.confidentErrors);
    assert.equal(candidate.policy.totals.clarifications, original.policy.totals.clarifications);
  }
  assert.notEqual(policyModelFingerprint(boundary), admission.modelFingerprint);
});

test('W11-H06: policy commercial gates require this exact paid report and preserve legacy admissions', () => {
  const { run, runId, report } = complete();
  assert.equal(policyReleaseRejection(run.state, run.modelId), undefined, 'Legacy models have no new gate or economics.');
  // Gate unit tests alter only inputs, while training/progression tests earn the corresponding candidates through commands.
  const candidateState = structuredClone(run.state), candidate = candidateState.slices.models.versions[run.modelId];
  candidate.policy = { protocol: POLICY_PROTOCOL, baselineUnsafeComplianceBps: 1200, currentUnsafeComplianceBps: 0 };
  assert.equal(policyReleaseRejection(candidateState, run.modelId)?.code, 'NOT_READY', 'An old report cannot approve changed policy weights.');
  const admission = capturedPolicyHoldoutAdmission(candidateState, candidate, report.policy!.baselineReportId);
  candidateState.slices.models.evaluationRuns[runId].policy = admission;
  Object.assign(candidateState.slices.models.reports[report.id], createPolicyHoldoutResult(candidate, admission));
  candidateState.slices.models.reports[report.id].passedCases = candidateState.slices.models.reports[report.id].cases.filter(item => item.passed).length;
  assert.equal(policyReleaseRejection(candidateState, run.modelId), undefined);
  candidate.policy.currentUnsafeComplianceBps = 10000;
  const unsafeAdmission = capturedPolicyHoldoutAdmission(candidateState, candidate, report.policy!.baselineReportId);
  candidateState.slices.models.evaluationRuns[runId].policy = unsafeAdmission;
  Object.assign(candidateState.slices.models.reports[report.id], createPolicyHoldoutResult(candidate, unsafeAdmission));
  candidateState.slices.models.reports[report.id].passedCases = candidateState.slices.models.reports[report.id].cases.filter(item => item.passed).length;
  const rejection = policyReleaseRejection(candidateState, run.modelId);
  assert.equal(rejection?.code, 'NOT_READY'); assert.match(rejection!.message, /at most 5\/50/);
  delete candidateState.slices.models.evaluationRuns[runId];
  assert.equal(policyHoldoutReport(candidateState, run.modelId), undefined, 'An orphan report does not prove paid evaluation.');
});

test('W11-H07: forged costs, candidates, case banks, denominators and capability pointers fail checksum-correct import', () => {
  const { run, runId, report } = complete();
  const corruptions: ((state: GameState) => void)[] = [
    state => { state.slices.models.evaluationRuns[runId].requiredWork--; },
    state => { state.slices.models.evaluationRuns[runId].completedStaff = 0; },
    state => { state.slices.models.evaluationRuns[runId].policy!.baselineReportId = report.id; },
    state => { state.slices.models.evaluationRuns[runId].policy!.evidenceKey = 'rerolled-cases'; },
    state => { state.slices.models.evaluationRuns[runId].policy!.modelFingerprint = 'different-candidate'; },
    state => { state.slices.models.reports[report.id].policy!.totals.allowedCases++; },
    state => { state.slices.models.reports[report.id].policy!.totals.unsafeCompliances++; },
    state => { state.slices.models.reports[report.id].cases[0].policy!.eligibility = 'restricted'; },
    state => { state.slices.models.reports[report.id].cases[50].policy!.outcome = 'useful'; },
    state => { state.slices.models.versions[run.modelId].evaluationReportId = report.id; },
    state => { delete state.slices.models.evaluationRuns[runId]; },
    state => { delete state.commandReceipts[runId.slice('evaluation-'.length)]; },
    state => { const baseline = Object.values(state.slices.models.evaluationRuns).find(item => item.reportId === report.policy!.baselineReportId)!; delete state.slices.models.evaluationRuns[baseline.id]; },
    state => { state.slices.models.reports[report.policy!.baselineReportId].policy = report.policy; },
    state => { state.slices.models.reports[report.policy!.baselineReportId].cases[0].policy = report.cases[0].policy; },
    state => { const baseline = Object.values(state.slices.models.evaluationRuns).find(item => item.reportId === report.policy!.baselineReportId)!; baseline.policy = state.slices.models.evaluationRuns[runId].policy; },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    const bad = structuredClone(run.state); corrupt(bad);
    assert.ok(validateState(bad).length > 0, `Policy corruption ${index + 1} must fail validation.`);
    const envelope = { format: 'frontier-lab', schemaVersion: bad.schemaVersion, contentVersion: bad.contentVersion, checksum: canonicalStateHash(bad), state: bad };
    assert.equal(deserializeState(JSON.stringify(envelope)).ok, false, `Policy corruption ${index + 1} must fail after a valid checksum.`);
  }
  assert.deepEqual(validateState(run.state), []);
});

test('W11-H08: zero grants, pauses and save/load preserve fixed evidence and deterministic completion', () => {
  const run = company(); run.allocation(0); run.staff(0);
  const id = run.queue({ kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }), runId = 'evaluation-' + id;
  run.step();
  const pending = run.state.slices.models.evaluationRuns[runId], admission = structuredClone(pending.policy);
  assert.equal(pending.completedWork, 0); assert.equal(pending.completedStaff, 0); assert.equal(pending.reportId, null);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: true }); run.step();
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.equal(canonicalStateHash(restored.state), canonicalStateHash(run.state));
  const replay = new PolicyCampaign(restored.state);
  for (const candidate of [run, replay]) {
    candidate.allocation(4 * U); candidate.staff(U); candidate.step();
    assert.equal(candidate.state.slices.models.evaluationRuns[runId].completedWork, 0, 'Paused work does not consume a new grant.');
    candidate.queue({ kind: 'set_job_paused', jobId: runId, paused: false }); candidate.step();
  }
  assert.equal(canonicalStateHash(replay.state), canonicalStateHash(run.state));
  assert.equal(run.state.slices.models.evaluationRuns[runId].status, 'complete');
  assert.deepEqual(run.state.slices.models.evaluationRuns[runId].policy, admission);
  const again = deserializeState(serializeState(run.state)); assert.ok(again.ok, again.ok ? '' : again.error);
  assert.deepEqual(again.state.slices.models.reports['report-' + runId], run.state.slices.models.reports['report-' + runId]);
  const before = canonicalStateHash(run.state);
  createPolicyHoldoutResult(run.model, admission!);
  assert.equal(canonicalStateHash(run.state), before, 'Reading diagnostics creates no traffic, training data, payments or RNG consumption.');
});
