import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { AGENT_ORDERS, AGENT_TERMINAL_HISTORY } from '../src/content/wave3-agents';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { AgentConfiguration, AgentJob, AgentModelSnapshot, CommandPayload, GameState, ModelBehavior } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { assertWave3AgentsState } from '../src/core/wave3-agents-validation';
import { validateState } from '../src/core/validation';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { agentEvidenceKey, agentExpectedCheck, agentExpectedDraft, agentExpectedPlan, agentJobId, agentRecoveryBlock, agentRecoveryJobId, agentRecoveryRequirements, agentStageNeeds, getAgentView, isAgentTerminal, pruneAgentHistory } from '../src/modules/agents';
import { plannerTarget, plannerRepeatMultiplier, validPlannerTrait } from '../src/modules/agent-planning';
import { systemRollout } from '../src/modules/applied-research';
import { createPlayerOnlyState } from './fixtures/player-only';

const config = (overrides: Partial<AgentConfiguration> = {}): AgentConfiguration => ({ mode: 'draft', verification: 'basic', tools: ['read_ticket', 'search_docs', 'send_reply', 'issue_credit'], maxSteps: 24, maxRetries: 0, workBudget: 8 * U, ...overrides });
const researchIds = ['R1', 'R2', 'R5', 'R6', 'R9', 'R9A', 'R10', 'R11'];
/** A qualified scenario fixture; real weekly engine, resource owners and company ledger execute every job. */
function scenario(behavior: ModelBehavior = { confidentErrorBps: 1000, falseRefusalBps: 700 }, reliability = 9600): GameState {
  const first = advanceWeek(createPlayerOnlyState()); assert.ok(first.accepted, first.reason?.message);
  const state = first.state, companyId = state.playerCompanyId;
  state.slices.company.companies[companyId].cashCents = 100_000_000;
  state.slices.company.founderAssignments[companyId] = { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: U, hardware: 0 };
  state.slices.compute.fleets[companyId].allocation = { serving: 4 * U, development: 0, research: 0 };
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  model.status = 'evaluated'; model.scenarioStart = true; model.capabilityBps = { conversation: 7000, documents: 7000, coding: 6000, tools: 6500 }; model.reliabilityBps = reliability; model.behavior = { ...behavior };
  model.evaluationReportId = 'agent-fixture-report';
  state.slices.models.reports[model.evaluationReportId] = { id: model.evaluationReportId, companyId, modelId: model.id, week: 0, scenarioStart: true, heldOut: true,
    capabilityBps: { ...model.capabilityBps }, reliabilityBps: reliability, basicChatEligible: reliability >= CONTENT.firstSale.minReliabilityBps, cases: Array.from({ length: 20 }, (_, index) => ({ id: 'agent-case-' + index, domain: 'conversation' as const, difficultyBps: 0, passed: true })), passedCases: 20 };
  state.slices.research.completedByCompany[companyId] = [...researchIds].sort(); state.slices.research.completed = [...researchIds].sort();
  for (const researchId of researchIds) {
    const definition = CONTENT.research.find(item => item.id === researchId)!, id = 'agent-fixture-' + researchId;
    state.slices.research.projects[id] = { id, companyId, researchId, startedWeek: 0, completedWeek: 0, availableWeek: 1, requiredWork: definition.workCUw, completedWork: definition.workCUw,
      requiredStaff: definition.staffWeeks * U, completedStaff: definition.staffWeeks * U, role: definition.role, status: 'complete', lastProgress: 0, lastBottleneck: '' };
    state.slices.company.postedFacts[id + ':fee'] = true;
  }
  assert.deepEqual(validateState(state, CONTENT), []); return state;
}
function snapshotModel(state: GameState): AgentModelSnapshot {
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  return { id: model.id, name: model.name, family: model.family, residentMU: model.residentMU, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, behavior: { ...model.behavior! }, reportId: model.evaluationReportId! };
}
function chooseEvidence(state: GameState, configuration: AgentConfiguration, predicate: (job: Pick<AgentJob, 'model' | 'configuration' | 'terms' | 'evidenceKey'>) => boolean, template = AGENT_ORDERS[0]): void {
  for (let i = 0; i < 100000; i++) {
    const seed = 'agent-case-seed-' + i, probe = { model: snapshotModel(state), configuration, terms: template, evidenceKey: agentEvidenceKey(seed, state.playerCompanyId, template.id, Math.floor((state.week + 1) / 4)) };
    if (predicate(probe)) { state.seed = seed; return; }
  }
  assert.fail('Find a deterministic authored test case.');
}
function step(state: GameState): GameState { const next = advanceWeek(state); assert.ok(next.accepted, next.reason?.message); return next.state; }
function send(state: GameState, payload: CommandPayload, id?: string): GameState {
  const next = submitCommand(state, payload, CONTENT, id); assert.ok(next.accepted, next.reason?.message); return next.state;
}
function start(state: GameState, configuration = config(), template = AGENT_ORDERS[0]): { state: GameState; id: string } {
  const cycle = Math.floor((state.week + 1) / 4), id = agentJobId(state.playerCompanyId, template.id, cycle);
  state = step(send(state, { kind: 'start_agent_job', orderId: `${template.id}@${cycle}`, modelId: CONTENT.seedModel.id, ...configuration }));
  assert.ok(state.slices.agents.jobs[id]); return { state, id };
}
function until(state: GameState, id: string, predicate: (job: AgentJob) => boolean, maximum = 100): GameState {
  for (let i = 0; i < maximum && !predicate(state.slices.agents.jobs[id]); i++) state = step(state);
  assert.ok(predicate(state.slices.agents.jobs[id]), state.slices.agents.jobs[id].lastBottleneck); return state;
}
function approve(state: GameState, id: string): GameState { return step(send(state, { kind: 'review_agent_job', jobId: id, decision: 'approve' })); }

function installRecovery(state: GameState): GameState {
  const companyId = state.playerCompanyId;
  state.slices.company.founderAssignments[companyId] = { research: 0, ml: U, data: 0, infrastructure: 0, commercial: 0, hardware: 0 };
  state.slices.compute.fleets[companyId].allocation = { serving: 3 * U, development: U, research: 0 };
  state = step(send(state, { kind: 'start_system_rollout', method: 'action-receipts' }));
  const paid = systemRollout(state, companyId, 'action-receipts')!;
  assert.equal(paid.completedWork, U); assert.equal(paid.completedStaff, U); assert.equal(paid.status, 'ready');
  assert.ok(state.slices.compute.fleets[companyId].lastWork.development > 0);
  state = step(state); assert.equal(systemRollout(state, companyId, 'action-receipts')?.status, 'active');
  state.slices.company.founderAssignments[companyId] = { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: U, hardware: 0 };
  state.slices.compute.fleets[companyId].allocation = { serving: 4 * U, development: 0, research: 0 };
  return state;
}
function recover(state: GameState, parentId: string, maxSteps = 24, workBudget = 8 * U): { state: GameState; id: string } {
  const parent = state.slices.agents.jobs[parentId], root = parent.recovery?.rootJobId ?? parentId;
  const id = agentRecoveryJobId(root, (parent.recovery?.generation ?? 0) + 1);
  state = step(send(state, { kind: 'recover_agent_job', jobId: parentId, maxSteps, workBudget }));
  assert.equal(state.slices.agents.jobs[parentId].handedOffTo, id); return { state, id };
}
function useful(state: GameState, configuration: AgentConfiguration): void {
  chooseEvidence(state, configuration, job => agentExpectedDraft(job, 0) === 'useful' && agentExpectedPlan(job, 0).every(tool => job.terms.readTools.includes(tool)));
}
function pausedAfterAction(success = true): { state: GameState; id: string } {
  let state = installRecovery(scenario(success ? undefined : { confidentErrorBps: 8000, falseRefusalBps: 0 }, success ? 9600 : 5000));
  const configuration = config({ mode: 'bounded', verification: 'independent' });
  chooseEvidence(state, configuration, job => agentExpectedDraft(job, 0) === (success ? 'useful' : 'confident-error') && agentExpectedCheck(job, 0) && agentExpectedPlan(job, 0).every(tool => job.terms.readTools.includes(tool)));
  const accepted = start(state, configuration); state = until(accepted.state, accepted.id, job => job.stage === 'audit');
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: accepted.id, paused: true }));
  return { state, id: accepted.id };
}

test('W7-A01: recovery needs the separate paid implementation and a stopped eligible order', () => {
  let state = scenario(); const configuration = config({ workBudget: U / 10 }); useful(state, configuration);
  const accepted = start(state, configuration); state = accepted.state;
  assert.equal(state.slices.agents.jobs[accepted.id].status, 'failed');
  assert.equal(previewCommand(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 24, workBudget: 8 * U }).accepted, false);
  state = installRecovery(state);
  const preview = previewCommand(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 24, workBudget: 8 * U });
  assert.equal(preview.accepted, true); assert.equal(preview.upfrontCostCents, 0); assert.match(preview.summary!, /0.1 serving CUw/);
  const queued = send(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 24, workBudget: 8 * U });
  assert.equal(submitCommand(queued, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 24, workBudget: 8 * U }).accepted, false);
});

test('W7-A02: partial failed work survives paid recovery and settles one customer order', () => {
  let state = installRecovery(scenario()); const configuration = config({ workBudget: U / 10 }); useful(state, configuration);
  const accepted = start(state, configuration); state = accepted.state;
  const original = structuredClone(state.slices.agents.jobs[accepted.id]);
  assert.equal(original.stageWork, U / 10); assert.equal(state.slices.agents.totalsByCompany[state.playerCompanyId].failed, 1);
  const resumed = recover(state, accepted.id); state = resumed.state;
  const child = state.slices.agents.jobs[resumed.id];
  assert.equal(child.stage, 'plan'); assert.equal(child.stageWork, original.stageWork); assert.equal(child.stagePhysicalWork, original.stagePhysicalWork);
  assert.equal(child.spentWork, original.spentWork + U / 10); assert.equal(child.modelCalls, original.modelCalls + 10);
  assert.equal(child.evidenceKey, original.evidenceKey); assert.equal(child.attempt, original.attempt); assert.equal(child.retries, original.retries);
  assert.equal(state.slices.agents.jobs[accepted.id].lastBottleneck, original.lastBottleneck); assert.equal(child.recovery?.parentStatus, 'failed');
  assert.deepEqual(child.configuration.tools, original.configuration.tools); assert.deepEqual(child.model, original.model);
  assert.equal(state.slices.agents.totalsByCompany[state.playerCompanyId].accepted, 1); assert.equal(state.slices.agents.totalsByCompany[state.playerCompanyId].failed, 0);
  state = until(state, resumed.id, job => job.status === 'awaiting-approval'); state = approve(state, resumed.id);
  const done = state.slices.agents.jobs[resumed.id], totals = state.slices.agents.totalsByCompany[state.playerCompanyId];
  assert.equal(done.status, 'complete'); assert.equal(done.spentWork, 760_000_000); assert.equal(done.modelCalls, 30); assert.equal(done.inputTokens, 23000); assert.equal(done.outputTokens, 5500); assert.equal(done.reviewStaff, U / 4);
  assert.equal(totals.accepted, 1); assert.equal(totals.complete, 1); assert.equal(totals.failed, 0); assert.equal(state.slices.agents.invoices.length, 1);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id.startsWith('agent-fee:')).length, 1);
  assert.ok(done.invoiceId!.startsWith('invoice:agent:' + accepted.id + ':')); assert.equal(done.billedCents, done.terms.draftFeeCents);
  assert.deepEqual(validateState(state, CONTENT), []);
});

test('W7-A03: recovery step and action-audit reserves share cumulative hard limits', () => {
  let state = installRecovery(scenario()); const configuration = config({ mode: 'bounded', verification: 'independent', maxSteps: 4 }); useful(state, configuration);
  const accepted = start(state, configuration); state = until(accepted.state, accepted.id, isAgentTerminal);
  const failed = state.slices.agents.jobs[accepted.id]; assert.equal(failed.stage, 'action'); assert.equal(failed.steps, 4); assert.equal(failed.actionApplied, false);
  assert.equal(agentRecoveryRequirements(failed).minimumSteps, 7);
  assert.equal(previewCommand(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 6, workBudget: 8 * U }).accepted, false);
  assert.equal(previewCommand(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 25, workBudget: 8 * U }).accepted, false);
  assert.equal(previewCommand(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 7, workBudget: 33 * U }).accepted, false);
  const resumed = recover(state, accepted.id, 7); state = until(resumed.state, resumed.id, isAgentTerminal);
  assert.equal(state.slices.agents.jobs[resumed.id].status, 'complete'); assert.equal(state.slices.agents.jobs[resumed.id].steps, 7); assert.equal(Object.keys(state.slices.agents.actionReceipts).length, 1);
});

test('W7-A04: two paid handoffs after an action never repeat its action or invoice', () => {
  const started = pausedAfterAction(); let state = started.state;
  const original = structuredClone(state.slices.agents.jobs[started.id]), receipt = structuredClone(state.slices.agents.actionReceipts[original.receiptId!]);
  assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, null);
  const first = recover(state, started.id); state = first.state;
  assert.equal(state.slices.agents.jobs[first.id].stage, 'audit'); assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, null);
  assert.equal(submitCommand(state, { kind: 'cancel_agent_job', jobId: first.id }).accepted, false);
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: first.id, paused: true }));
  const second = recover(state, first.id); state = second.state;
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: second.id, paused: true }));
  assert.equal(submitCommand(state, { kind: 'recover_agent_job', jobId: second.id, maxSteps: 24, workBudget: 8 * U }).accepted, false);
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: second.id, paused: false }));
  const done = state.slices.agents.jobs[second.id]; assert.equal(done.status, 'complete'); assert.equal(done.verifiedOutcome, true);
  assert.equal(done.spentWork, original.spentWork + 2 * U / 10 + agentStageNeeds({ ...original, stage: 'audit' }).work);
  assert.deepEqual(state.slices.agents.actionReceipts[original.receiptId!], receipt); assert.equal(Object.keys(state.slices.agents.actionReceipts).length, 1);
  assert.equal(state.slices.agents.invoices.length, 1); assert.equal(state.slices.agents.totalsByCompany[state.playerCompanyId].accepted, 1); assert.equal(state.slices.agents.totalsByCompany[state.playerCompanyId].complete, 1);
  assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, true); assert.deepEqual(validateState(state, CONTENT), []);
});

test('W7-A05: recovery keeps a wrong applied action wrong and pays its audit and penalty', () => {
  const started = pausedAfterAction(false); let state = started.state;
  const original = state.slices.agents.jobs[started.id]; assert.equal(original.actualSuccess, false); assert.equal(original.claimedComplete, true);
  const resumed = recover(state, started.id); state = step(resumed.state);
  const done = state.slices.agents.jobs[resumed.id]; assert.equal(done.status, 'failed'); assert.equal(done.verifiedOutcome, false); assert.equal(done.billedCents, 0); assert.equal(done.penaltyCents, done.terms.failurePenaltyCents);
  assert.equal(state.slices.agents.invoices.length, 0); assert.equal(Object.keys(state.slices.agents.actionReceipts).length, 1);
  assert.equal(state.slices.agents.totalsByCompany[state.playerCompanyId].failed, 1); assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, false);
  assert.equal(submitCommand(state, { kind: 'recover_agent_job', jobId: resumed.id, maxSteps: 24, workBudget: 8 * U }).accepted, false);
  assert.deepEqual(validateState(state, CONTENT), []);
});

test('W7-A06: recovery cannot reopen permission failures, rejected checks, or completed outcomes', () => {
  let state = installRecovery(scenario()); const configuration = config({ mode: 'bounded', verification: 'independent', tools: ['read_ticket'] }); useful(state, configuration);
  const accepted = start(state, configuration); state = until(accepted.state, accepted.id, isAgentTerminal);
  assert.equal(state.slices.agents.jobs[accepted.id].permissionBlocks, 1);
  assert.equal(submitCommand(state, { kind: 'recover_agent_job', jobId: accepted.id, maxSteps: 24, workBudget: 8 * U }).accepted, false);
  let other = installRecovery(scenario({ confidentErrorBps: 1000, falseRefusalBps: 4000 })); const c = config();
  chooseEvidence(other, c, job => !agentExpectedCheck(job, 0)); const rejected = start(other, c); other = until(rejected.state, rejected.id, isAgentTerminal);
  assert.equal(other.slices.agents.jobs[rejected.id].checkerPassed, false); assert.match(agentRecoveryBlock(other.slices.agents.jobs[rejected.id])!, /rejected check/);
  assert.equal(submitCommand(other, { kind: 'recover_agent_job', jobId: rejected.id, maxSteps: 24, workBudget: 8 * U }).accepted, false);
});

test('W7-A07: stalled paid recovery survives export and deterministic reload without free calls', () => {
  const started = pausedAfterAction(); let state = started.state;
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = U / 100;
  const resumed = recover(state, started.id); state = resumed.state;
  const job = state.slices.agents.jobs[resumed.id]; assert.equal(job.stage, 'recover'); assert.ok(job.stageWork > 0 && job.stageWork < U / 10);
  const saved = deserializeState(serializeState(state)); assert.ok(saved.ok); if (!saved.ok) return;
  let a = state, b = saved.state;
  for (let i = 0; i < 25; i++) { a = step(a); b = step(b); }
  assert.equal(canonicalStateHash(a), canonicalStateHash(b)); assert.equal(a.slices.agents.jobs[resumed.id].status, 'complete');
  assert.equal(Object.keys(a.slices.agents.actionReceipts).length, 1); assert.equal(a.slices.agents.invoices.length, 1);
});

test('W7-A08: imported handoffs cannot forge parents, evidence, progress, permissions, budgets or receipts', () => {
  const started = pausedAfterAction(); const resumed = recover(started.state, started.id); const original = resumed.state;
  const attacks: ((state: GameState) => void)[] = [
    s => { delete s.slices.agents.jobs[started.id]; },
    s => { s.slices.agents.jobs[resumed.id].recovery!.generation = 2; },
    s => { s.slices.agents.jobs[resumed.id].recovery!.rolloutId = 'missing-rollout'; },
    s => { s.slices.agents.jobs[resumed.id].recovery!.startedWeek = 0; },
    s => { s.slices.agents.jobs[resumed.id].evidenceKey = 'rerolled'; },
    s => { s.slices.agents.jobs[resumed.id].configuration.tools = ['issue_credit']; },
    s => { s.slices.agents.jobs[resumed.id].configuration.maxRetries = 2; },
    s => { s.slices.agents.jobs[resumed.id].configuration.workBudget = U; },
    s => { s.slices.agents.jobs[resumed.id].spentWork -= U / 10; },
    s => { s.slices.agents.jobs[resumed.id].modelCalls -= 10; },
    s => { s.slices.agents.jobs[resumed.id].history[0].note = 'Rewrote the parent'; },
    s => { s.slices.agents.jobs[resumed.id].actionApplied = false; },
    s => { s.slices.agents.jobs[started.id].handedOffTo = started.id; },
    s => { s.slices.company.postedFacts['agent-fee:' + resumed.id] = true; },
    s => { const receipt = Object.values(s.slices.agents.actionReceipts)[0]; receipt.jobId = resumed.id; },
    s => { const receipt = Object.values(s.slices.agents.actionReceipts)[0]; s.slices.agents.actionReceipts['duplicate-action'] = { ...receipt, id: 'duplicate-action' }; },
  ];
  for (const attack of attacks) { const bad = structuredClone(original); attack(bad); assert.throws(() => assertWave3AgentsState(bad, CONTENT)); }
});

test('W7-A09: history retention preserves active recovery ancestors as one bounded order', () => {
  const started = pausedAfterAction(); const resumed = recover(started.state, started.id), slice = structuredClone(resumed.state.slices.agents);
  for (let i = 0; i < AGENT_TERMINAL_HISTORY + 5; i++) {
    const job = structuredClone(slice.jobs[started.id]); job.id = 'old-terminal-' + i; delete job.handedOffTo; job.status = 'cancelled'; job.completedWeek = 100 + i;
    slice.jobs[job.id] = job;
  }
  pruneAgentHistory(slice);
  assert.ok(slice.jobs[started.id]); assert.ok(slice.jobs[resumed.id]); assert.equal(slice.jobs[started.id].handedOffTo, resumed.id);
  assert.equal(Object.keys(slice.jobs).length, AGENT_TERMINAL_HISTORY + 2); assert.equal(Object.keys(slice.actionReceipts).length, 1);
});

test('W7-A10: finite planner multiplier removes only avoidable repeats and preserves permissions and outcomes', () => {
  const state = scenario(), base = snapshotModel(state), configuration = config({ mode: 'bounded', verification: 'independent' });
  base.capabilityBps.tools = 3000; const learned = { ...base, planner: plannerTarget() };
  assert.equal(plannerRepeatMultiplier(base), 10000); assert.equal(plannerRepeatMultiplier(learned), 8000);
  assert.deepEqual(plannerTarget(learned.planner), learned.planner); assert.equal(validPlannerTrait(learned.planner), true); assert.equal(validPlannerTrait({ baselineRepeatBps: 8000, currentRepeatBps: 6400 }), false);
  let oldRepeats = 0, newRepeats = 0, blocked = 0;
  for (let i = 0; i < 5000; i++) {
    const before = { model: base, configuration, terms: AGENT_ORDERS[0], evidenceKey: 'planner-reserved-' + i }, after = { ...before, model: learned };
    const oldPlan = agentExpectedPlan(before, 0), newPlan = agentExpectedPlan(after, 0);
    assert.deepEqual(newPlan.slice(0, before.terms.readTools.length), before.terms.readTools);
    if (oldPlan.some(tool => !before.terms.readTools.includes(tool))) { blocked++; assert.deepEqual(newPlan, oldPlan); }
    else { if (oldPlan.length > before.terms.readTools.length) oldRepeats++; if (newPlan.length > before.terms.readTools.length) newRepeats++; assert.ok(newPlan.length <= oldPlan.length); }
    assert.equal(agentExpectedDraft(after, 0), agentExpectedDraft(before, 0)); assert.equal(agentExpectedCheck(after, 0), agentExpectedCheck(before, 0));
  }
  assert.ok(blocked > 0); assert.ok(newRepeats < oldRepeats); assert.ok(newRepeats / oldRepeats > 0.74 && newRepeats / oldRepeats < 0.86);
});

test('W7-A11: a budget stop at the human decision restores approval without revealing an unpaid review result', () => {
  let state = installRecovery(scenario()); const configuration = config({ maxSteps: 4 }); useful(state, configuration);
  const accepted = start(state, configuration); state = until(accepted.state, accepted.id, isAgentTerminal);
  const source = state.slices.agents.jobs[accepted.id]; assert.equal(source.stage, 'review'); assert.equal(source.humanDecision, 'pending'); assert.equal(source.reviewStaff, 0);
  assert.equal(agentRecoveryBlock(source), undefined);
  const resumed = recover(state, accepted.id, 6); state = resumed.state;
  const restored = state.slices.agents.jobs[resumed.id]; assert.equal(restored.status, 'awaiting-approval'); assert.equal(restored.humanDecision, 'pending'); assert.equal(restored.reviewStaff, 0); assert.equal(restored.billedCents, 0);
  state = approve(state, resumed.id); assert.equal(state.slices.agents.jobs[resumed.id].status, 'complete'); assert.equal(state.slices.agents.jobs[resumed.id].reviewStaff, U / 4);
  assert.deepEqual(validateState(state, CONTENT), []);
});
