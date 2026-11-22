import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTENT } from '../src/content/catalog';
import { AGENT_ORDERS, CODING_AGENT_ORDER } from '../src/content/wave3-agents';
import { RESOURCE_SCALE as U } from '../src/contracts/types';
import type { AgentConfiguration, AgentJob, AgentModelSnapshot, CommandPayload, GameContent, GameState, ModelBehavior } from '../src/contracts/types';
import { advanceWeek, previewCommand, submitCommand } from '../src/core/engine';
import { canonicalStateHash } from '../src/core/canonical';
import { assertWave3AgentsState } from '../src/core/wave3-agents-validation';
import { validateState } from '../src/core/validation';
import { deserializeState, serializeState } from '../src/core/snapshot';
import { agentEvidenceKey, agentOrderTools, agentExpectedCheck, agentExpectedDraft, agentExpectedPlan, agentJobId, createAgentsModule, getAgentView, getAgentWorkflowEstimate, isAgentTerminal } from '../src/modules/agents';
import { createPlayerOnlyState } from './fixtures/player-only';

const config = (overrides: Partial<AgentConfiguration> = {}): AgentConfiguration => ({ mode: 'draft', verification: 'basic', tools: ['read_ticket', 'search_docs', 'send_reply', 'issue_credit'], maxSteps: 24, maxRetries: 0, workBudget: 8 * U, ...overrides });
const researchIds = ['R1', 'R2', 'R5', 'R6', 'R9', 'R10', 'R11'];
/** A qualified scenario fixture; real weekly engine, resource owners and company ledger execute every job. */
function scenario(behavior: ModelBehavior = { confidentErrorBps: 1000, falseRefusalBps: 700 }, reliability = 9600, content: GameContent = CONTENT, seed = content.opening.seed): GameState {
  const seededContent = { ...content, opening: { ...content.opening, seed } };
  const first = advanceWeek(createPlayerOnlyState(seededContent), seededContent); assert.ok(first.accepted, first.reason?.message);
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
  assert.deepEqual(validateState(state, content), []); return state;
}
function snapshotModel(state: GameState): AgentModelSnapshot {
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  return { id: model.id, name: model.name, family: model.family, residentMU: model.residentMU, capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, behavior: { ...model.behavior! }, reportId: model.evaluationReportId! };
}
function chooseEvidence(state: GameState, configuration: AgentConfiguration, predicate: (job: Pick<AgentJob, 'model' | 'configuration' | 'terms' | 'evidenceKey'>) => boolean, template = AGENT_ORDERS[0]): GameState {
  assert.equal(state.week, 1, 'Choose the authored evidence before starting paid agent work.');
  for (let i = 0; i < 100000; i++) {
    const seed = 'agent-case-seed-' + i, probe = { model: snapshotModel(state), configuration, terms: template, evidenceKey: agentEvidenceKey(seed, state.playerCompanyId, template.id, Math.floor((state.week + 1) / 4)) };
    if (predicate(probe)) return scenario(probe.model.behavior, probe.model.reliabilityBps, CONTENT, seed);
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
function successful(mode: AgentConfiguration['mode'] = 'draft', verification: AgentConfiguration['verification'] = 'basic'): { state: GameState; id: string } {
  let state = scenario(); const configuration = config({ mode, verification });
  state = chooseEvidence(state, configuration, job => agentExpectedDraft(job, 0) === 'useful' && agentExpectedPlan(job, 0).every(tool => job.terms.readTools.includes(tool)));
  const accepted = start(state, configuration); state = accepted.state;
  if (mode !== 'bounded') { state = until(state, accepted.id, job => job.status === 'awaiting-approval'); state = approve(state, accepted.id); }
  state = until(state, accepted.id, isAgentTerminal); return { state, id: accepted.id };
}

test('W3-A01: intake preview freezes evidence, research, model, terms and baseline resource budgets', () => {
  let state = scenario(); const c = config(); state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'useful');
  const view = getAgentView(state, state.playerCompanyId); assert.equal(view.models.length, 1); assert.equal(view.orders.length, 3); assert.equal(view.orders[0].id, 'support-replies@0');
  const estimate = getAgentWorkflowEstimate(AGENT_ORDERS[0], view.models[0], c); assert.equal(estimate.steps, 5); assert.equal(estimate.work, 660_000_000); assert.equal(estimate.staff, U / 4);
  const preview = previewCommand(state, { kind: 'start_agent_job', orderId: view.orders[0].id, modelId: view.models[0].id, ...c }); assert.equal(preview.accepted, true); assert.equal(preview.upfrontCostCents, 2500);
  const accepted = start(state, c); state = accepted.state; const job = state.slices.agents.jobs[accepted.id];
  assert.equal(job.history[0].stage, 'plan'); assert.equal(job.spentWork, U / 5); assert.equal(job.modelCalls, 10); assert.equal(job.inputTokens, 5000);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === `agent-fee:${job.id}`).length, 1);
  assert.equal(submitCommand(state, { kind: 'start_agent_job', orderId: job.orderId, modelId: job.model.id, ...c }).accepted, false);
  assert.equal(state.slices.company.companies[state.playerCompanyId].earnedRevenueCents, 0);
});

test('W3-A02: zero serving allocation and insufficient connected memory produce no calls or progress', () => {
  let state = scenario(); state.slices.compute.fleets[state.playerCompanyId].allocation.serving = 0;
  const accepted = start(state); state = step(accepted.state); let job = state.slices.agents.jobs[accepted.id];
  assert.equal(job.spentWork, 0); assert.equal(job.modelCalls, 0); assert.equal(job.history.length, 0);
  const model = state.slices.models.versions[CONTENT.seedModel.id];
  // A separate admitted medium model needs 8 MU plus session workspace, beyond this 8 MU cloud pool.
  let memoryState = scenario(); const large = memoryState.slices.models.versions[CONTENT.seedModel.id]; large.family = 'medium'; large.residentMU = 8 * U;
  memoryState = start(memoryState).state; job = Object.values(memoryState.slices.agents.jobs)[0]; assert.equal(job.spentWork, 0); assert.equal(job.modelCalls, 0);
  assert.equal(model.residentMU, 2 * U); assert.equal(job.model.residentMU, 8 * U);
});

test('W3-A03: partial compute meters actual tokens, calls and shared physical use; pause/save/replay preserves work', () => {
  let state = scenario(); const c = config(); state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'useful');
  state.slices.compute.fleets[state.playerCompanyId].allocation.serving = U / 10;
  const accepted = start(state, c); state = accepted.state; const partial = structuredClone(state.slices.agents.jobs[accepted.id]);
  assert.ok(partial.stageWork > 0 && partial.stageWork < U / 5); assert.ok(partial.inputTokens > 0 && partial.inputTokens < 5000);
  assert.equal(partial.physicalWork, state.slices.compute.fleets[state.playerCompanyId].lastWork.serving);
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: accepted.id, paused: true })); state = step(state);
  assert.equal(state.slices.agents.jobs[accepted.id].stageWork, partial.stageWork); assert.equal(state.slices.agents.jobs[accepted.id].inputTokens, partial.inputTokens);
  const saved = deserializeState(serializeState(state)); assert.ok(saved.ok); if (!saved.ok) return;
  let a = step(send(state, { kind: 'set_agent_job_paused', jobId: accepted.id, paused: false }));
  let b = step(send(saved.state, { kind: 'set_agent_job_paused', jobId: accepted.id, paused: false }));
  for (let i = 0; i < 20; i++) { a = step(a); b = step(b); }
  assert.equal(canonicalStateHash(a), canonicalStateHash(b)); assert.equal(a.slices.agents.jobs[accepted.id].status, 'awaiting-approval');
  assert.equal(a.slices.agents.jobs[accepted.id].inputTokens, 20000); assert.equal(a.slices.agents.jobs[accepted.id].modelCalls, 20);
});

test('W3-A04: human approval alone is not paid staff review, draft delivery or revenue', () => {
  let state = scenario(); const c = config(); state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'useful');
  state.slices.company.founderAssignments[state.playerCompanyId].commercial = 0;
  const accepted = start(state, c); state = until(accepted.state, accepted.id, job => job.status === 'awaiting-approval');
  assert.equal(state.slices.agents.jobs[accepted.id].claimedComplete, true); assert.equal(state.slices.agents.invoices.length, 0);
  state = approve(state, accepted.id); state = step(state); const stalled = state.slices.agents.jobs[accepted.id];
  assert.equal(stalled.humanDecision, 'approved'); assert.equal(stalled.stageStaff, 0); assert.equal(stalled.deliveredDraft, false); assert.equal(stalled.billedCents, 0);
  state = step(send(state, { kind: 'assign_founder', allocations: { research: 0, ml: 0, data: 0, infrastructure: 0, commercial: U, hardware: 0 } }));
  const done = state.slices.agents.jobs[accepted.id]; assert.equal(done.status, 'complete'); assert.equal(done.reviewStaff, U / 4); assert.equal(done.deliveredDraft, true); assert.equal(done.actionApplied, false); assert.equal(done.verifiedOutcome, false);
  assert.equal(done.billedCents, AGENT_ORDERS[0].draftFeeCents); assert.equal(state.slices.agents.invoices[0].basis, 'reviewed-draft');
});

test('W3-A05: approved actions get one receipt, require paid audit and bill only once after accepted outcome', () => {
  let state = scenario(); const c = config({ mode: 'approval', verification: 'independent' });
  state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'useful'); const accepted = start(state, c);
  state = until(accepted.state, accepted.id, job => job.status === 'awaiting-approval'); state = approve(state, accepted.id);
  assert.equal(state.slices.agents.jobs[accepted.id].actionApplied, false); assert.equal(state.slices.agents.invoices.length, 0);
  state = step(state); let job = state.slices.agents.jobs[accepted.id]; assert.equal(job.actionApplied, true); assert.equal(job.stage, 'audit'); assert.equal(job.verifiedOutcome, false); assert.equal(job.billedCents, 0);
  assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, null);
  assert.equal(submitCommand(state, { kind: 'cancel_agent_job', jobId: job.id }).accepted, false);
  const saved = deserializeState(serializeState(state)); assert.ok(saved.ok); if (!saved.ok) return;
  state = step(state); const replay = step(saved.state); assert.equal(canonicalStateHash(state), canonicalStateHash(replay));
  job = state.slices.agents.jobs[accepted.id]; assert.equal(job.verifiedOutcome, true); assert.equal(job.billedCents, AGENT_ORDERS[0].outcomeFeeCents); assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, true);
  for (let i = 0; i < 10; i++) state = step(state);
  assert.equal(Object.keys(state.slices.agents.actionReceipts).length, 1); assert.equal(state.slices.agents.invoices.length, 1);
  assert.equal(state.slices.company.companies[state.playerCompanyId].earnedRevenueCents, AGENT_ORDERS[0].outcomeFeeCents);
});

test('W3-A06: basic approval cannot earn the independent outcome fee', () => {
  const { state, id } = successful('approval', 'basic'), job = state.slices.agents.jobs[id];
  assert.equal(job.verifiedOutcome, true); assert.equal(job.billedCents, AGENT_ORDERS[0].draftFeeCents); assert.equal(state.slices.agents.invoices[0].basis, 'reviewed-draft');
  assert.ok(job.history.some(h => h.stage === 'review')); assert.ok(job.history.some(h => h.stage === 'audit'));
});

test('W3-A07: missing allowlist and bounded out-of-scope proposals block before execution', () => {
  let state = scenario(); const c = config({ tools: ['send_reply'] }); const accepted = start(state, c); state = step(accepted.state);
  let job = state.slices.agents.jobs[accepted.id]; assert.equal(job.status, 'failed'); assert.equal(job.permissionBlocks, 1); assert.equal(job.toolCalls, 0); assert.equal(job.spentWork, U / 5); assert.equal(job.actionApplied, false);
  state = scenario({ confidentErrorBps: 8000, falseRefusalBps: 0 }, 6000); const bounded = config({ mode: 'bounded', verification: 'independent' });
  state = chooseEvidence(state, bounded, probe => agentExpectedPlan(probe, 0).some(tool => !probe.terms.readTools.includes(tool)));
  const planned = start(state, bounded); state = until(planned.state, planned.id, isAgentTerminal); job = state.slices.agents.jobs[planned.id];
  assert.equal(job.permissionBlocks, 1); assert.equal(job.actionApplied, false); assert.equal(job.receiptId, null); assert.equal(job.billedCents, 0); assert.equal(job.toolCalls, 10);
  assert.ok(job.plannedTools.includes('issue_credit')); assert.ok(job.configuration.tools.includes('issue_credit'), 'Even an allowlisted write is blocked in the wrong stage and customer scope.');
});

test('W3-A08: a confident claim and missed checker are not a successful customer outcome', () => {
  let state = scenario({ confidentErrorBps: 8000, falseRefusalBps: 0 }, 6000); const c = config({ mode: 'bounded', verification: 'independent' });
  state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'confident-error' && agentExpectedCheck(job, 0) && agentExpectedPlan(job, 0).every(tool => job.terms.readTools.includes(tool)));
  const accepted = start(state, c); state = until(accepted.state, accepted.id, job => job.stage === 'audit');
  let job = state.slices.agents.jobs[accepted.id]; assert.equal(job.claimedComplete, true); assert.equal(job.checkerPassed, true); assert.equal(job.actionApplied, true); assert.equal(job.billedCents, 0);
  state = step(state); job = state.slices.agents.jobs[accepted.id]; assert.equal(job.status, 'failed'); assert.equal(job.verifiedOutcome, false); assert.equal(job.billedCents, 0); assert.equal(job.penaltyCents, AGENT_ORDERS[0].failurePenaltyCents);
  assert.equal(state.slices.agents.invoices.length, 0); assert.equal(getAgentView(state, state.playerCompanyId).receipts[0].correct, false);
  assert.equal(state.slices.company.ledger.filter(entry => entry.id.startsWith('agent-penalty:')).length, 1);
});

test('W3-A09: refusal and clarification retries consume new calls and stay within retry bounds', () => {
  let state = scenario({ confidentErrorBps: 1000, falseRefusalBps: 6000 }, 6000); const c = config({ maxRetries: 1 });
  state = chooseEvidence(state, c, job => ['false-refusal', 'clarification'].includes(agentExpectedDraft(job, 0)) && !agentExpectedCheck(job, 1));
  const accepted = start(state, c); state = until(accepted.state, accepted.id, isAgentTerminal); const job = state.slices.agents.jobs[accepted.id];
  assert.equal(job.status, 'failed'); assert.equal(job.retries, 1); assert.equal(job.attempt, 1); assert.equal(job.modelCalls, 40); assert.equal(job.checkerRuns, 20); assert.equal(job.toolCalls, 20); assert.equal(job.spentWork, 2 * 660_000_000); assert.equal(job.billedCents, 0);
  assert.ok(job.history.some(h => /refused|clarification/.test(h.note)));
});

test('W3-A10: step and work budgets prevent an unauditable action before side effects', () => {
  for (const bounds of [{ maxSteps: 6, workBudget: 8 * U }, { maxSteps: 24, workBudget: 800_000_000 }]) {
    let state = scenario(); const c = config({ mode: 'approval', verification: 'independent', ...bounds }); state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'useful');
    const accepted = start(state, c); state = until(accepted.state, accepted.id, job => job.status === 'awaiting-approval'); state = approve(state, accepted.id); state = until(state, accepted.id, isAgentTerminal);
    const job = state.slices.agents.jobs[accepted.id]; assert.equal(job.status, 'failed'); assert.equal(job.actionApplied, false); assert.equal(job.receiptId, null); assert.equal(job.billedCents, 0); assert.ok(job.lastBottleneck.includes('mandatory'));
  }
  let state = scenario(); const c = config({ workBudget: U / 100 }); const accepted = start(state, c); state = accepted.state; const job = state.slices.agents.jobs[accepted.id];
  assert.equal(job.status, 'failed'); assert.equal(job.spentWork, U / 100); assert.equal(job.steps, 0); assert.ok(job.inputTokens > 0); assert.equal(job.receiptId, null);
});

test('W3-A11: pause after an action preserves the unpaid audit obligation and cannot cancel it', () => {
  let state = scenario(); const c = config({ mode: 'bounded', verification: 'independent' }); state = chooseEvidence(state, c, job => agentExpectedDraft(job, 0) === 'useful' && agentExpectedPlan(job, 0).every(tool => job.terms.readTools.includes(tool)));
  const accepted = start(state, c); state = until(accepted.state, accepted.id, job => job.stage === 'audit'); const spent = state.slices.agents.jobs[accepted.id].spentWork;
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: accepted.id, paused: true })); state = step(state);
  assert.equal(state.slices.agents.jobs[accepted.id].spentWork, spent); assert.equal(state.slices.agents.jobs[accepted.id].invoiceId, null); assert.equal(submitCommand(state, { kind: 'cancel_agent_job', jobId: accepted.id }).accepted, false);
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: accepted.id, paused: false })); assert.equal(state.slices.agents.jobs[accepted.id].status, 'complete');
});

test('W3-A12: support evidence cannot reroll through changed command IDs, cancelling or reaccepting the same intake', () => {
  const state = scenario(); const payload: CommandPayload = { kind: 'start_agent_job', orderId: 'support-replies@0', modelId: CONTENT.seedModel.id, ...config() };
  const agentModule = createAgentsModule(CONTENT), companyId = state.playerCompanyId;
  const first = agentModule.applyCommand!(state, { id: 'first-identity', companyId, issuedForWeek: 2, payload }, CONTENT).updates!.agents!;
  const second = agentModule.applyCommand!(state, { id: 'different-identity', companyId, issuedForWeek: 2, payload }, CONTENT).updates!.agents!;
  assert.deepEqual(first, second);
  let live = step(send(state, payload)); const jobId = Object.keys(live.slices.agents.jobs)[0]; live = step(send(live, { kind: 'cancel_agent_job', jobId }));
  assert.equal(submitCommand(live, payload).accepted, false);
  const board = getAgentView(live, companyId); assert.ok(board.orders[0].id.endsWith('@1'), 'Next boundary advertises only its actual intake, not the expired one.');
});

test('W3-A13: hostile imported jobs cannot manufacture permission, work, review, receipts or outcome invoices', () => {
  const { state, id } = successful('approval', 'independent');
  const corruptions: ((state: GameState, job: AgentJob) => void)[] = [
    (_s, job) => { job.spentWork = 0; },
    (_s, job) => { job.configuration.tools = ['read_ticket']; },
    (_s, job) => { job.configuration.maxSteps = 4; },
    (_s, job) => { job.model.behavior.confidentErrorBps = 9999; },
    (_s, job) => { job.evidenceKey = 'rerolled'; },
    (_s, job) => { job.history.find(h => h.stage === 'review')!.staff = 0; },
    (_s, job) => { job.history.find(h => h.stage === 'audit')!.work = 0; },
    (_s, job) => { job.history[0].physicalWork = 1; job.physicalWork -= 199_999_999; },
    (_s, job) => { job.history[0].completedWeek = state.week + 1; },
    (s, job) => { s.slices.agents.actionReceipts[job.receiptId!].authorizedBy = 'bounded-policy'; },
    (s, job) => { s.slices.agents.actionReceipts[job.receiptId!].correct = false; },
    (s, job) => { delete s.slices.company.postedFacts[job.invoiceId!]; },
    (s) => { s.slices.agents.invoices[0].amountCents += 1; },
    (s, job) => { s.slices.agents.actionReceipts.orphan = { ...s.slices.agents.actionReceipts[job.receiptId!], id: 'orphan' }; },
    (s) => { s.slices.agents.activeJobIds.push(id); },
  ];
  for (const corrupt of corruptions) {
    const bad = structuredClone(state); corrupt(bad, bad.slices.agents.jobs[id]); assert.throws(() => assertWave3AgentsState(bad, CONTENT));
    const text = JSON.stringify({ format: 'frontier-lab', schemaVersion: state.schemaVersion, contentVersion: state.contentVersion, checksum: canonicalStateHash(bad), state: bad });
    assert.equal(deserializeState(text).ok, false, 'A recomputed outer checksum does not make forged workflow evidence valid.');
  }
});

test('W3-A14: finite claims and bounded terminal histories keep hundreds of jobs saveable while preserving active work', () => {
  let state = scenario(); const c = config({ tools: [] });
  const waiting = start(state, config()); state = waiting.state; const preserved = waiting.id;
  state = step(send(state, { kind: 'set_agent_job_paused', jobId: preserved, paused: true }));
  for (let cycle = 1; cycle <= 75; cycle++) {
    while (Math.floor((state.week + 1) / 4) < cycle) state = step(state);
    for (const order of AGENT_ORDERS) state = send(state, { kind: 'start_agent_job', orderId: `${order.id}@${Math.floor((state.week + 1) / 4)}`, modelId: CONTENT.seedModel.id, ...c });
    state = step(state); state = step(state);
  }
  assert.equal(state.slices.agents.jobs[preserved].status, 'paused'); assert.equal(Object.keys(state.slices.agents.claims).length, 3);
  assert.ok(Object.keys(state.slices.agents.jobs).length <= 33); assert.ok(state.slices.agents.totalsByCompany[state.playerCompanyId].accepted >= 226);
  const save = serializeState(state); assert.ok(Buffer.byteLength(save, 'utf8') < 2_000_000); assert.equal(deserializeState(save).ok, true);
});

test('W3-A15: concurrent support batches contend for one serving ceiling and pool memory', () => {
  let state = scenario(); state.slices.compute.fleets[state.playerCompanyId].allocation.serving = U / 5;
  for (const order of AGENT_ORDERS) state = send(state, { kind: 'start_agent_job', orderId: `${order.id}@0`, modelId: CONTENT.seedModel.id, ...config() });
  state = step(state);
  const jobs = Object.values(state.slices.agents.jobs), fleet = state.slices.compute.fleets[state.playerCompanyId];
  assert.equal(jobs.length, 3); assert.ok(jobs.some(job => job.spentWork > 0)); assert.ok(jobs.some(job => job.spentWork === 0));
  assert.equal(jobs.reduce((sum, job) => sum + job.physicalWork, 0), fleet.lastWork.serving);
  assert.ok(fleet.lastWork.serving <= U / 5); assert.ok(fleet.reservedCU <= U / 5); assert.ok(fleet.occupiedMemoryMU <= fleet.memoryMU);
});

test('W3-A16: bounded/independent research gates and held-out capability evidence cannot be bypassed', () => {
  const agentModule = createAgentsModule(CONTENT), state = scenario(), companyId = state.playerCompanyId;
  const command = (configuration: AgentConfiguration) => ({ id: 'gate-test', companyId, issuedForWeek: 2, payload: { kind: 'start_agent_job' as const, orderId: 'support-replies@0', modelId: CONTENT.seedModel.id, ...configuration } });
  state.slices.research.completedByCompany[companyId] = ['R1', 'R2', 'R6', 'R9'];
  assert.equal(agentModule.validateCommand!(state, command(config({ verification: 'independent' })), CONTENT)?.code, 'NOT_READY');
  assert.equal(agentModule.validateCommand!(state, command(config({ mode: 'bounded' })), CONTENT)?.code, 'NOT_READY');
  assert.equal(agentModule.validateCommand!(state, command(config()), CONTENT), undefined);
  state.slices.models.reports['agent-fixture-report'].suiteId = 'behavior-cases-1';
  assert.equal(agentModule.validateCommand!(state, command(config()), CONTENT)?.code, 'NOT_READY');
  assert.equal(getAgentView(state, companyId).models.length, 0);
});

function codingConfig(overrides: Partial<AgentConfiguration> = {}): AgentConfiguration {
  return config({ mode: 'approval', verification: 'independent', tools: agentOrderTools(CODING_AGENT_ORDER), ...overrides });
}

test('W19: coding qualification, scoped permissions and independent checks are enforced at admission', () => {
  const state = scenario();
  const view = getAgentView(state, state.playerCompanyId);
  assert.equal(view.codingOrders.length, 1);
  assert.equal(view.orders.length, AGENT_ORDERS.length);
  const model = view.models[0];
  const payload = { kind: 'start_agent_job' as const, orderId: view.codingOrders[0].id, modelId: model.id, ...codingConfig() };
  assert.equal(previewCommand(state, payload).accepted, true);
  assert.match(previewCommand(state, { ...payload, verification: 'basic' }).reason?.message ?? '', /independent/);
  assert.match(previewCommand(state, { ...payload, tools: ['send_reply'] }).reason?.message ?? '', /scope/);
  const weak = scenario(undefined, 8400);
  assert.match(previewCommand(weak, payload).reason?.message ?? '', /reliability 85/);
});

test('W19: a coding job pays for sandbox and approval, persists mid-run and invoices only after audit', () => {
  const configuration = codingConfig();
  let initial = scenario();
  initial = chooseEvidence(initial, configuration, job => agentExpectedDraft(job, 0) === 'useful', CODING_AGENT_ORDER);
  const accepted = start(initial, configuration, CODING_AGENT_ORDER);
  const id = accepted.id;
  let state = until(accepted.state, id, job => job.stage === 'sandbox');
  const saved = serializeState(state), loaded = deserializeState(saved);
  assert.ok(loaded.ok);
  assert.equal(serializeState(loaded.state), saved);
  state = until(loaded.state, id, job => job.status === 'awaiting-approval');
  let job = state.slices.agents.jobs[id];
  assert.deepEqual(job.history.map(h => h.stage), ['plan', 'lookup', 'lookup', 'lookup', 'draft', 'sandbox', 'check']);
  assert.equal(job.history.find(h => h.stage === 'sandbox')?.physicalWork, 800_000_000);
  assert.equal(job.toolCalls, 160);
  assert.equal(job.billedCents, 0);
  assert.equal(Object.keys(state.slices.agents.actionReceipts).length, 0);
  state = until(approve(state, id), id, job => job.actionApplied);
  assert.equal(state.slices.agents.jobs[id].billedCents, 0);
  assert.equal(submitCommand(state, { kind: 'cancel_agent_job', jobId: id }).accepted, false);
  state = until(state, id, isAgentTerminal);
  job = state.slices.agents.jobs[id];
  const estimate = getAgentWorkflowEstimate(CODING_AGENT_ORDER, job.model, configuration);
  assert.equal(job.steps, 10);
  assert.equal(job.spentWork, estimate.work);
  assert.equal(job.reviewStaff, U);
  assert.equal(job.billedCents, CODING_AGENT_ORDER.outcomeFeeCents);
  assert.equal(state.slices.agents.actionReceipts[job.receiptId!].tool, 'publish_patch');
  assert.equal(state.slices.company.ledger.filter(entry => entry.id === job.invoiceId).length, 1);
  const forged = structuredClone(state);
  forged.slices.agents.jobs[id].history.find(h => h.stage === 'sandbox')!.tool = 'publish_patch';
  assert.ok(validateState(forged, CONTENT).length);
});

test('W19: a planner cannot publish during evidence gathering even with delivery permission', () => {
  const configuration = codingConfig({ mode: 'bounded' });
  let state = scenario({ confidentErrorBps: 3000, falseRefusalBps: 700 });
  state = chooseEvidence(state, configuration, job => agentExpectedPlan(job, 0).includes('publish_patch'), CODING_AGENT_ORDER);
  const accepted = start(state, configuration, CODING_AGENT_ORDER);
  const finished = until(accepted.state, accepted.id, isAgentTerminal);
  const job = finished.slices.agents.jobs[accepted.id];
  assert.equal(job.status, 'failed');
  assert.equal(job.permissionBlocks, 1);
  assert.match(job.lastBottleneck, /publish_patch during lookup/);
  assert.equal(job.billedCents, 0);
  assert.equal(job.actionApplied, false);
  assert.equal(Object.keys(finished.slices.agents.actionReceipts).length, 0);
  assert.ok(job.spentWork > 0);
});

test('W19: a patch that games smoke tests can be rejected by the customer audit and incur one penalty', () => {
  const configuration = codingConfig({ mode: 'bounded' });
  let state = scenario({ confidentErrorBps: 3000, falseRefusalBps: 700 });
  state = chooseEvidence(state, configuration, job => agentExpectedDraft(job, 0) === 'confident-error' && agentExpectedCheck(job, 0)
    && agentExpectedPlan(job, 0).every(tool => job.terms.readTools.includes(tool)), CODING_AGENT_ORDER);
  const accepted = start(state, configuration, CODING_AGENT_ORDER);
  const finished = until(accepted.state, accepted.id, isAgentTerminal);
  const job = finished.slices.agents.jobs[accepted.id];
  assert.equal(job.status, 'failed');
  assert.equal(job.actionApplied, true);
  assert.equal(job.verifiedOutcome, false);
  assert.equal(job.billedCents, 0);
  assert.match(job.history.find(h => h.stage === 'sandbox')!.note, /passed/);
  assert.match(job.history.at(-1)!.note, /failed the actual issue requirements/);
  assert.equal(job.penaltyCents, CODING_AGENT_ORDER.failurePenaltyCents);
  assert.equal(finished.slices.company.ledger.filter(entry => entry.sourceId === job.id && entry.kind === 'expense').length, 1);
  const after = step(finished);
  assert.equal(after.slices.agents.totalsByCompany[state.playerCompanyId].penaltyCents, job.penaltyCents);
});

test('W19: sandbox permission and budget limits halt work without inventing tests or billing', () => {
  for (const overrides of [{ tools: agentOrderTools(CODING_AGENT_ORDER).filter(tool => tool !== 'run_sandbox_tests') }, { workBudget: 3 * U }]) {
    const configuration = codingConfig(overrides);
    let initial = scenario();
    initial = chooseEvidence(initial, configuration, job => agentExpectedDraft(job, 0) === 'useful', CODING_AGENT_ORDER);
    const accepted = start(initial, configuration, CODING_AGENT_ORDER);
    const finished = until(accepted.state, accepted.id, isAgentTerminal);
    const job = finished.slices.agents.jobs[accepted.id];
    assert.equal(job.stage, 'sandbox');
    assert.equal(job.status, 'failed');
    assert.equal(job.history.some(h => h.stage === 'sandbox'), false);
    assert.equal(job.billedCents, 0);
    assert.equal(job.actionApplied, false);
    assert.equal(job.permissionBlocks, 'tools' in overrides ? 1 : 0);
    if ('workBudget' in overrides) assert.equal(job.spentWork, overrides.workBudget);
  }
});

test('W19: a Wave 17 snapshot preserves its paid state, gains an announced market calendar and cannot claim coding work', () => {
  const previous = { ...CONTENT, version: '0.18.0', buildVersion: '0.18.0' };
  const initial = scenario(undefined, undefined, previous);
  const snapshot = serializeState(initial, previous);
  const result = deserializeState(snapshot);
  assert.ok(result.ok);
  assert.equal(result.migratedFrom, 18);
  assert.deepEqual({ ...result.state, contentVersion: previous.version, buildVersion: previous.buildVersion }, {
    ...initial, slices: { ...initial.slices, markets: { ...initial.slices.markets, opportunityCalendar: { startedWeek: initial.week, sequenceVersion: 2 as const } } },
  });
  const configuration = codingConfig();
  const codingEra = { ...CONTENT, version: '0.19.0', buildVersion: '0.19.0' };
  const codingState = scenario(undefined, undefined, codingEra);
  const queued = submitCommand(codingState, { kind: 'start_agent_job', orderId: CODING_AGENT_ORDER.id + '@0', modelId: CONTENT.seedModel.id, ...configuration }, codingEra);
  assert.ok(queued.accepted, queued.reason?.message);
  const tick = advanceWeek(queued.state, codingEra); assert.ok(tick.accepted, tick.reason?.message);
  const accepted = tick.state;
  const forged = { ...structuredClone(accepted), contentVersion: previous.version, buildVersion: previous.buildVersion };
  // Isolate the coding-work guard from the independently tested calendar-version guard.
  delete forged.slices.markets.opportunityCalendar;
  const result2 = deserializeState(JSON.stringify({ format: 'frontier-lab', schemaVersion: forged.schemaVersion,
    contentVersion: previous.version, checksum: canonicalStateHash(forged), state: forged }));
  assert.ok(!result2.ok);
  assert.match(result2.error, /unavailable/);
});
