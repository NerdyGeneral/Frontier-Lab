import { staffContributors } from './fixtures/staff-contributors';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT } from '../src/content/catalog';
import { AGENT_ORDERS } from '../src/content/wave3-agents';
import { INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE, INDEPENDENT_HOLDOUT_RULES as RULES } from '../src/content/wave7-holdouts';
import type { CommandPayload, EvaluationReport, GameState, ModelVersion, ModuleContext } from '../src/contracts/types';
import type { AgentConfiguration, AgentModelSnapshot } from '../src/contracts/wave3-agents';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand, validateState } from '../src/core/engine';
import { canonicalStateHash, hashText } from '../src/core/canonical';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { agentExpectedCheck, agentExpectedDraft, agentExpectedPlan } from '../src/modules/agents';
import { isCapabilitySuite } from '../src/modules/evaluation-classification';
import { createEvaluationReport } from '../src/modules/lab-evaluation';
import { BASE_BEHAVIOR } from '../src/modules/lab-planner';
import { createIndependentHoldoutAdmission, createIndependentHoldoutResult, independentHoldoutFingerprint } from '../src/modules/independent-holdouts';
import { hasCapabilityEvaluation, modelWorkBps } from '../src/modules/model-runtime';
import { hasResearch } from '../src/modules/research';

/** This published company earned its models, capability reports, staff, and R10 through ordinary play. */
class HoldoutCampaign {
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
  until(done: () => boolean, limit = 12): void { for (let week = 0; week < limit && !done(); week++) this.step(); assert.ok(done(), 'The paid evaluation must finish with real resource grants.'); }
  allocation(development: number, research = 0): void { this.queue({ kind: 'allocate_compute', serving: 81 * U, development, research }); }
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

function publishedCompany(): HoldoutCampaign {
  const result = deserializeState(readFileSync(join(__dirname, 'fixtures/wave5-snapshot.json'), 'utf8'));
  assert.ok(result.ok, result.ok ? '' : result.error); return new HoldoutCampaign(result.state);
}
let researched: GameState | undefined;
function researchedCompany(): HoldoutCampaign {
  if (!researched) {
    const run = publishedCompany(); run.queue({ kind: 'set_cloud_capacity', cu: 90 * U }); run.step(); run.allocation(0, 4 * U);
    run.queue({ kind: 'start_research', researchId: RULES.researchId }); run.until(() => hasResearch(run.state, run.id, RULES.researchId));
    researched = structuredClone(run.state);
  }
  return new HoldoutCampaign(structuredClone(researched));
}
let completed: GameState | undefined, completedRunId = '';
function completedCompany(): { run: HoldoutCampaign; report: EvaluationReport; runId: string } {
  if (!completed) { const run = researchedCompany(), result = run.evaluate(); completed = structuredClone(run.state); completedRunId = result.runId; }
  const run = new HoldoutCampaign(structuredClone(completed));
  return { run, runId: completedRunId, report: run.state.slices.models.reports['report-' + completedRunId] };
}

test('W7-H01: independent holdouts require their paid research and this exact version’s prior paid capability report', () => {
  const old = publishedCompany();
  assert.equal(previewCommand(old.state, { kind: 'evaluate_model', modelId: old.modelId, suiteId: RULES.suiteId }).accepted, false);
  const run = researchedCompany(), definition = CONTENT.research.find(item => item.id === RULES.researchId)!;
  const project = Object.values(run.state.slices.research.projects).find(item => item.companyId === run.id && item.researchId === RULES.researchId)!;
  assert.equal(project.completedWork, 4 * U); assert.equal(project.completedStaff, 2 * U);
  assert.equal(run.state.slices.company.postedFacts[project.id + ':fee'], true); assert.equal(definition.feeCents, 150_000);
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }).accepted, true);
  const unevaluated = Object.values(run.state.slices.models.versions).find(model => model.companyId === run.id && model.status === 'checkpoint' && model.trainingRunId)!;
  const blocked = previewCommand(run.state, { kind: 'evaluate_model', modelId: unevaluated.id, suiteId: RULES.suiteId });
  assert.equal(blocked.accepted, false); assert.equal(blocked.reason?.message, INDEPENDENT_HOLDOUT_ADMISSION_MESSAGE);
  const foreign = Object.values(run.state.slices.models.versions).find(model => model.companyId !== run.id)!;
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: foreign.id, suiteId: RULES.suiteId }).accepted, false);
  const unpaid = structuredClone(run.state), baseline = createIndependentHoldoutAdmission(unpaid, run.id, run.modelId)!;
  for (const [id, paid] of Object.entries(unpaid.slices.models.evaluationRuns)) if (paid.reportId === baseline.baselineReportId) delete unpaid.slices.models.evaluationRuns[id];
  assert.equal(createIndependentHoldoutAdmission(unpaid, run.id, run.modelId), null, 'A copied report cannot replace paid work.');
});

test('W7-H02: development compute and research staff finish independently, pause safely, and preserve the model’s capability pointer', () => {
  const run = researchedCompany(), before = structuredClone(run.model), oldReport = structuredClone(run.state.slices.models.reports[before.evaluationReportId!]);
  run.staff(0); run.allocation(4 * U);
  const id = run.queue({ kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }), runId = 'evaluation-' + id;
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }).reason?.code, 'ALREADY_ACTIVE');
  run.step();
  let evaluation = run.state.slices.models.evaluationRuns[runId];
  assert.equal(evaluation.requiredWork, 4 * U); assert.equal(evaluation.requiredStaff, U);
  assert.equal(evaluation.completedWork, 4 * U); assert.equal(evaluation.completedStaff, 0); assert.equal(evaluation.reportId, null);
  assert.equal(run.state.slices.compute.fleets[run.id].lastWork.development, 4 * U);
  const frozen = structuredClone(evaluation.holdout);
  run.queue({ kind: 'set_job_paused', jobId: runId, paused: true }); run.staff(U); run.step();
  assert.equal(run.state.slices.models.evaluationRuns[runId].completedStaff, 0);
  run.allocation(0); run.queue({ kind: 'set_job_paused', jobId: runId, paused: false }); run.step();
  evaluation = run.state.slices.models.evaluationRuns[runId];
  assert.equal(evaluation.status, 'complete'); assert.equal(evaluation.completedStaff, U);
  assert.deepEqual(evaluation.holdout, frozen); assert.deepEqual(run.model, before);
  assert.deepEqual(run.state.slices.models.reports[oldReport.id], oldReport);
  const report = run.state.slices.models.reports[evaluation.reportId!];
  assert.equal(report.basicChatEligible, false); assert.equal(report.cases.length, 100); assert.equal(report.passedCases, report.holdout!.totals.actualSuccesses);
  assert.equal(previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }).reason?.code, 'NO_IMPROVEMENT');
  assert.equal(run.state.slices.company.ledger.some(entry => entry.sourceId === runId && entry.kind === 'receipt'), false);
  assert.deepEqual(validateState(run.state), []);
});

test('W7-H03: every reserved case compares real draft and checker behavior with actual success and explicit false-accept denominators', () => {
  const { run, report } = completedCompany(), totals = report.holdout!.totals;
  const model: AgentModelSnapshot = { id: run.model.id, name: run.model.name, family: run.model.family, residentMU: run.model.residentMU,
    capabilityBps: run.model.capabilityBps, reliabilityBps: run.model.reliabilityBps, behavior: run.model.behavior ?? BASE_BEHAVIOR,
    architecture: run.model.architecture, workBps: modelWorkBps(run.model), reportId: report.holdout!.baselineReportId };
  for (const [index, item] of report.cases.entries()) {
    const terms = AGENT_ORDERS[index % AGENT_ORDERS.length], configuration: AgentConfiguration = { mode: 'bounded', verification: 'basic',
      tools: [...terms.readTools, terms.actionTool], maxSteps: 24, maxRetries: 0, workBudget: 32 * U };
    const job = { model, terms, configuration, evidenceKey: hashText(`${report.holdout!.evidenceKey}:reserved-case:${index + 1}`) };
    const outcome = agentExpectedDraft(job, 0), planned = agentExpectedPlan(job, 0);
    assert.equal(item.holdout!.outcome, outcome); assert.equal(item.passed, outcome === 'useful');
    assert.equal(item.holdout!.actualSuccess, outcome === 'useful');
    assert.equal(item.holdout!.claimedComplete, outcome === 'useful' || outcome === 'confident-error');
    assert.equal(item.holdout!.basicAccepted, agentExpectedCheck(job, 0));
    assert.equal(item.holdout!.independentAccepted, agentExpectedCheck({ ...job, configuration: { ...configuration, verification: 'independent' } }, 0));
    assert.equal(item.holdout!.plannedLookups, planned.filter(tool => terms.readTools.includes(tool)).length);
    assert.equal(item.holdout!.outOfScopeProposals, planned.filter(tool => !terms.readTools.includes(tool)).length);
  }
  assert.equal(totals.cases, 100); assert.equal(totals.actualSuccesses + totals.unsuccessfulCases, 100);
  assert.equal(totals.basicAccepted - totals.basicFalseAccepts, totals.actualSuccesses);
  assert.equal(totals.independentAccepted - totals.independentFalseAccepts, totals.actualSuccesses);
  assert.ok(totals.independentFalseAccepts <= totals.basicFalseAccepts);
  assert.ok(totals.claimedCompletions > totals.actualSuccesses, 'The sample distinguishes confident completion claims from correct outcomes.');
  assert.equal(totals.necessaryLookups, 166); assert.equal(totals.plannedLookups, totals.necessaryLookups + totals.repeatedLookups);
});

test('W7-H04: preview and reserved outcomes cannot be rerolled by names, model aliases, report IDs, waiting, or unrelated random streams', () => {
  const run = researchedCompany(), before = canonicalStateHash(run.state), admission = createIndependentHoldoutAdmission(run.state, run.id, run.modelId)!;
  const first = createIndependentHoldoutResult(run.model, admission);
  for (let n = 0; n < 3; n++) previewCommand(run.state, { kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId });
  assert.equal(canonicalStateHash(run.state), before);
  const alias = { ...run.model, id: 'renamed-candidate', name: 'Renamed candidate' };
  const changedReceipt = { ...admission, baselineReportId: 'other-paid-report', modelFingerprint: independentHoldoutFingerprint(alias) };
  assert.deepEqual(createIndependentHoldoutResult(alias, changedReceipt).cases, first.cases);
  const ctx: ModuleContext = { week: run.state.week + 30, phase: 'resolve', content: CONTENT, facts: [], resources: { requests: [], staffGrants: [], computeGrants: [] },
    random: { draw: () => { throw new Error('Reserved diagnostics must not consume or reroll simulation randomness.'); } } };
  const later = createEvaluationReport(alias, 'later-command', RULES.suiteId, ctx, CONTENT, changedReceipt);
  assert.deepEqual(later.cases, first.cases); assert.deepEqual(later.holdout!.totals, first.holdout.totals);
  assert.throws(() => createEvaluationReport(run.model, 'unreserved', RULES.suiteId, ctx, CONTENT), /reserved candidate/);
  const nextWeek = structuredClone(run.state); nextWeek.week += 10;
  assert.equal(createIndependentHoldoutAdmission(nextWeek, run.id, run.modelId)!.evidenceKey, admission.evidenceKey);
});

test('W7-H05: diagnostic and behavior suites cannot qualify releases, teachers, or agents through capability-evidence selectors', () => {
  assert.equal(isCapabilitySuite(undefined), true); assert.equal(isCapabilitySuite('basic-conversation-1'), true);
  assert.equal(isCapabilitySuite('expanded-capabilities-1'), true); assert.equal(isCapabilitySuite('behavior-cases-1'), false);
  assert.equal(isCapabilitySuite(RULES.suiteId), false); assert.equal(isCapabilitySuite('invented-suite'), false);
  const { run, report } = completedCompany(); assert.equal(hasCapabilityEvaluation(run.state, run.modelId), true);
  run.state.slices.models.reports = { [report.id]: report };
  assert.equal(hasCapabilityEvaluation(run.state, run.modelId), false);
  assert.equal(createIndependentHoldoutAdmission(run.state, run.id, run.modelId), null, 'Holdouts cannot recursively authorize another holdout.');
});

test('W7-H06: a trained planner changes only avoidable-repeat diagnostics on the same reserved cases', () => {
  const run = researchedCompany(), admission = createIndependentHoldoutAdmission(run.state, run.id, run.modelId)!;
  const before = createIndependentHoldoutResult(run.model, admission);
  // Isolate the authored planner property; the training lane tests earning this immutable candidate.
  const trained: ModelVersion = { ...run.model, planner: { baselineRepeatBps: 10000, currentRepeatBps: 8000 } };
  const after = createIndependentHoldoutResult(trained, { ...admission, modelFingerprint: independentHoldoutFingerprint(trained) });
  assert.notEqual(independentHoldoutFingerprint(trained), admission.modelFingerprint);
  assert.equal(after.holdout.totals.necessaryLookups, before.holdout.totals.necessaryLookups);
  assert.equal(after.holdout.totals.outOfScopeProposals, before.holdout.totals.outOfScopeProposals);
  assert.ok(after.holdout.totals.repeatedLookups < before.holdout.totals.repeatedLookups);
  for (const [index, item] of before.cases.entries()) {
    const { plannedLookups: _plannedBefore, repeatedLookups: _repeatsBefore, ...previous } = item.holdout!;
    const { plannedLookups: _plannedAfter, repeatedLookups: _repeatsAfter, ...current } = after.cases[index].holdout!;
    assert.deepEqual(current, previous, 'Planner specialization does not change model accuracy or checker errors.');
  }
});

test('W7-H07: forged free work, baselines, case banks, scores, pointer changes, and planner counts fail snapshot validation', () => {
  const { run, report, runId } = completedCompany();
  const corruptions: ((state: GameState) => void)[] = [
    state => { state.slices.models.evaluationRuns[runId].requiredWork--; },
    state => { state.slices.models.evaluationRuns[runId].completedStaff = 0; },
    state => { state.slices.models.evaluationRuns[runId].holdout!.baselineReportId = report.id; },
    state => { state.slices.models.evaluationRuns[runId].holdout!.evidenceKey = 'rerolled'; },
    state => { state.slices.models.evaluationRuns[runId].holdout!.modelFingerprint = 'different-candidate'; },
    state => { state.slices.models.reports[report.id].holdout!.totals.independentFalseAccepts++; },
    state => { state.slices.models.reports[report.id].cases[0].holdout!.actualSuccess = !report.cases[0].holdout!.actualSuccess; },
    state => { state.slices.models.reports[report.id].cases[0].holdout!.repeatedLookups++; },
    state => { state.slices.models.reports[report.id].basicChatEligible = true; },
    state => { state.slices.models.versions[run.modelId].evaluationReportId = report.id; },
    state => { delete state.slices.models.reports[report.id].holdout; },
    state => { const baseline = state.slices.models.reports[report.holdout!.baselineReportId]; baseline.holdout = structuredClone(report.holdout); },
    state => { delete state.slices.models.evaluationRuns[runId]; },
    state => { const paid = Object.values(state.slices.models.evaluationRuns).find(item => item.reportId === report.holdout!.baselineReportId)!; delete state.slices.models.evaluationRuns[paid.id]; },
    state => {
      const method = Object.values(state.slices.research.projects).find(item => item.companyId === run.id && item.researchId === RULES.researchId)!;
      const evaluation = state.slices.models.evaluationRuns[runId];
      evaluation.startedWeek = method.startedWeek; evaluation.completedWeek = method.startedWeek;
      state.slices.models.reports[report.id].week = method.startedWeek;
    },
  ];
  for (const [index, corrupt] of corruptions.entries()) {
    const bad = structuredClone(run.state); corrupt(bad);
    assert.ok(validateState(bad).length > 0, `Corruption ${index + 1} must be rejected.`);
    const envelope = { format: 'frontier-lab', schemaVersion: bad.schemaVersion, contentVersion: bad.contentVersion, checksum: canonicalStateHash(bad), state: bad };
    assert.equal(deserializeState(JSON.stringify(envelope)).ok, false, `Imported corruption ${index + 1} must be rejected after a valid checksum.`);
  }
  assert.deepEqual(validateState(run.state), []);
});

test('W7-H08: in-flight reservations and completed reports survive deterministic save/load without new customer actions or bills', () => {
  const run = researchedCompany(); run.allocation(0);
  const id = run.queue({ kind: 'evaluate_model', modelId: run.modelId, suiteId: RULES.suiteId }); run.step();
  const runId = 'evaluation-' + id, frozen = structuredClone(run.state.slices.models.evaluationRuns[runId].holdout);
  const restored = deserializeState(serializeState(run.state)); assert.ok(restored.ok, restored.ok ? '' : restored.error);
  assert.equal(canonicalStateHash(restored.state), canonicalStateHash(run.state));
  const replay = new HoldoutCampaign(restored.state);
  for (const candidate of [run, replay]) { candidate.allocation(4 * U); candidate.step(); }
  assert.equal(canonicalStateHash(replay.state), canonicalStateHash(run.state));
  assert.deepEqual(run.state.slices.models.evaluationRuns[runId].holdout, frozen);
  const again = deserializeState(serializeState(run.state)); assert.ok(again.ok, again.ok ? '' : again.error);
  assert.deepEqual(again.state.slices.models.reports['report-' + runId], run.state.slices.models.reports['report-' + runId]);
  const beforeAgents = structuredClone(run.state.slices.agents), beforeData = structuredClone(run.state.slices.data);
  const beforeRandom = structuredClone(run.state.random), beforeLedger = structuredClone(run.state.slices.company.ledger);
  createIndependentHoldoutResult(run.model, frozen!);
  assert.deepEqual(run.state.slices.agents, beforeAgents); assert.deepEqual(run.state.slices.data, beforeData);
  assert.deepEqual(run.state.random, beforeRandom); assert.deepEqual(run.state.slices.company.ledger, beforeLedger);
});
