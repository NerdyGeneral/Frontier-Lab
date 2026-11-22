import { inheritedModelRights, modelWorkBps } from '../modules/model-runtime';
import type { GameContent, GameState, LedgerFact } from '../contracts/types';
import type { AgentJob, AgentStageRecord } from '../contracts/wave3-agents';
import { AGENT_INTAKE_WEEKS, AGENT_INVOICE_HISTORY, ALL_AGENT_ORDERS, CODING_AGENT_ORDER, AGENT_TERMINAL_HISTORY, MAX_ACTIVE_AGENT_JOBS } from '../content/wave3-agents';
import { agentCanFundActionAudit, agentMeetsOrder, agentOrderTools, agentClaimKey, agentEvidenceKey, agentJobId, agentRecoveryBlock, agentRecoveryJobId, agentRecoveryRequirements, agentRootJobId, agentStageNeeds, agentToolAllowed, completeAgentStage, createAgentRecovery, createEmptyAgentsSlice, emptyAgentTotals, isAgentTerminal, validAgentConfiguration } from '../modules/agents';
import { AGENT_RECOVERY } from '../content/wave7-agents';
import { validPlannerTrait } from '../modules/agent-planning';
import { isCapabilitySuite } from '../modules/evaluation-classification';
import { BASE_BEHAVIOR } from '../modules/lab-planner';
import { hasResearch } from '../modules/research';
import { canonicalStateHash } from './canonical';
import { checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error('Support workflows: ' + message); };
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);
function record(value: unknown, label: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), label + ' must be a record.'); }
function keys(value: object, expected: string, label: string): void { check(Object.keys(value).sort().join() === expected.split(' ').sort().join(), label + ' has unknown or missing fields.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !['__proto__', 'constructor', 'prototype'].includes(value), 'An identifier is invalid.'); }
const numbers = (values: number[]): void => { values.forEach(value => checkedInteger(value, 'Agent quantity')); };
const STAGES = ['plan', 'lookup', 'draft', 'sandbox', 'check', 'review', 'action', 'audit', 'recover'];
const STATUSES = ['running', 'paused', 'awaiting-approval', 'complete', 'failed', 'cancelled', 'handed-off'];
const JOB_KEYS = 'id companyId orderId templateId cycle acceptedWeek completedWeek configuration model terms evidenceKey status stage stageStartedWeek stageWork stagePhysicalWork stageStaff steps retries attempt lookupIndex plannedTools spentWork physicalWork reviewStaff inputTokens outputTokens modelCalls checkerRuns toolCalls claimedComplete draftOutcome checkerPassed humanDecision deliveredDraft actionApplied actualSuccess verifiedOutcome permissionBlocks receiptId invoiceId billedCents penaltyCents lastBottleneck history';
const HISTORY_KEYS = 'index stage attempt tool startedWeek completedWeek work physicalWork staff inputTokens outputTokens calls note';

function freshReplay(job: AgentJob): AgentJob {
  return { ...structuredClone(job), completedWeek: null, status: 'running', stage: 'plan', stageStartedWeek: job.acceptedWeek, stageWork: 0, stagePhysicalWork: 0, stageStaff: 0,
    steps: 0, retries: 0, attempt: 0, lookupIndex: 0, plannedTools: [], spentWork: 0, physicalWork: 0, reviewStaff: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, checkerRuns: 0, toolCalls: 0,
    claimedComplete: false, draftOutcome: null, checkerPassed: null, humanDecision: null, deliveredDraft: false, actionApplied: false, actualSuccess: null, verifiedOutcome: false, permissionBlocks: 0,
    receiptId: null, invoiceId: null, billedCents: 0, penaltyCents: 0, lastBottleneck: '', history: [] };
}
function countWork(job: AgentJob, h: Pick<AgentStageRecord, 'work' | 'physicalWork' | 'staff'>): void {
  const spec = agentStageNeeds(job), token = (total: number, rounding: 'floor' | 'ceil' = 'floor') => spec.work ? mulDiv(h.work, total, spec.work, rounding) - mulDiv(job.stageWork, total, spec.work, rounding) : 0;
  check(h.work >= job.stageWork && h.physicalWork >= job.stagePhysicalWork && h.staff >= job.stageStaff, 'A recovery erased already-paid partial progress.');
  const work = h.work - job.stageWork, physical = h.physicalWork - job.stagePhysicalWork, staff = h.staff - job.stageStaff;
  job.spentWork += work; job.physicalWork += physical; job.reviewStaff += staff;
  job.inputTokens += token(spec.inputTokens); job.outputTokens += token(spec.outputTokens);
  if (job.stage === 'plan' || job.stage === 'draft' || job.stage === 'recover') job.modelCalls += token(spec.calls, 'ceil');
  if (job.stage === 'check' || job.stage === 'audit') job.checkerRuns += token(spec.calls, 'ceil');
  if (job.stage === 'lookup' || job.stage === 'sandbox' || job.stage === 'action') job.toolCalls += token(spec.calls, 'ceil');
  job.stageWork = h.work; job.stagePhysicalWork = h.physicalWork; job.stageStaff = h.staff;
}
function originalHandoffSource(parent: AgentJob, child: AgentJob): AgentJob {
  const source = structuredClone(parent); delete source.handedOffTo;
  source.status = child.recovery!.parentStatus;
  if (source.status === 'paused') source.completedWeek = null;
  return source;
}
/** Replay frozen, paid stages to reject invented claims, permissions, side effects and invoices on import. */
export function assertWave3AgentsState(state: GameState, content: GameContent): void {
  const slice = state.slices.agents, company = state.slices.company;
  record(slice, 'Agent slice'); keys(slice, 'activeJobIds jobs actionReceipts invoices claims totalsByCompany', 'Agent slice');
  record(slice.jobs, 'Jobs'); record(slice.actionReceipts, 'Action receipts'); record(slice.claims, 'Intake claims'); record(slice.totalsByCompany, 'Totals');
  check(Array.isArray(slice.activeJobIds) && Array.isArray(slice.invoices), 'Histories must be bounded lists.');
  const owners = Object.keys(company.companies), owner = (companyId: string) => { id(companyId); check(Object.hasOwn(company.companies, companyId), 'A job belongs to an unknown company.'); };
  const past = (week: number) => { checkedInteger(week); check(week <= state.week, 'A record comes from a future week.'); };
  const fastestServingBps = Math.max(10000, ...content.hardware.map(hardware => Math.round(hardware.servingMultiplier * 10000)));
  const physicalEvidence = (work: number, physical: number): void => {
    check((work === 0 && physical === 0) || (work > 0 && physical > 0 && work <= mulDiv(physical, fastestServingBps, 10000)), 'Effective work exceeds its physical grant and the fastest authored serving hardware.');
  };
  check(Object.keys(slice.claims).length <= owners.length * ALL_AGENT_ORDERS.length, 'Intake claim history is unbounded.');
  for (const [key, cycle] of Object.entries(slice.claims)) {
    check(owners.some(companyId => ALL_AGENT_ORDERS.some(order => agentClaimKey(companyId, order.id) === key)), 'An intake claim has no authored company and order.');
    checkedInteger(cycle); check(cycle <= Math.floor(state.week / AGENT_INTAKE_WEEKS), 'A future intake was claimed.');
  }
  check(Object.keys(slice.jobs).length <= owners.length * (MAX_ACTIVE_AGENT_JOBS + AGENT_TERMINAL_HISTORY + AGENT_INVOICE_HISTORY) * (AGENT_RECOVERY.maximumHandoffs + 1), 'Job history exceeds its retention bound.');
  const expectedReceiptIds = new Set<string>(), expectedInvoices = new Map<string, LedgerFact>();
  for (const [key, storedJob] of Object.entries(slice.jobs)) {
    record(storedJob, 'Job'); keys(storedJob, JOB_KEYS + (storedJob.recovery ? ' recovery' : '') + (storedJob.handedOffTo ? ' handedOffTo' : ''), 'Job'); id(key); check(key === storedJob.id, 'A job key and identity differ.'); owner(storedJob.companyId);
    let job = storedJob;
    if (storedJob.status === 'handed-off' || storedJob.handedOffTo) {
      id(storedJob.handedOffTo);
      const child = slice.jobs[storedJob.handedOffTo!];
      check(storedJob.status === 'handed-off' && child?.recovery?.parentJobId === key && child.recovery.rootJobId === agentRootJobId(storedJob), 'A handoff has no uniquely linked continuation.');
      check(storedJob.completedWeek !== null && (child.recovery!.parentStatus !== 'paused' || storedJob.completedWeek === child.recovery!.startedWeek), 'A handoff changed its stop boundary.');
      job = originalHandoffSource(storedJob, child);
    }
    numbers([job.cycle, job.acceptedWeek, job.stageStartedWeek, job.stageWork, job.stagePhysicalWork, job.stageStaff, job.steps, job.retries, job.attempt, job.lookupIndex, job.spentWork, job.physicalWork, job.reviewStaff, job.inputTokens, job.outputTokens, job.modelCalls, job.checkerRuns, job.toolCalls, job.permissionBlocks, job.billedCents, job.penaltyCents]);
    past(job.acceptedWeek); past(job.stageStartedWeek); if (job.completedWeek !== null) past(job.completedWeek);
    const definition = ALL_AGENT_ORDERS.find(order => order.id === job.templateId); check(definition && same(job.terms, definition), 'Frozen customer terms differ from their authored offer.');
    const rootJobId = agentJobId(job.companyId, job.templateId, job.cycle);
    check(job.cycle === Math.floor(job.acceptedWeek / AGENT_INTAKE_WEEKS) && job.orderId === `${job.templateId}@${job.cycle}` && (job.recovery ? job.recovery.rootJobId === rootJobId : job.id === rootJobId), 'A job changed its intake identity.');
    check(job.evidenceKey === agentEvidenceKey(state.seed, job.companyId, job.templateId, job.cycle), 'A job rerolled its customer evidence.');
    check((slice.claims[agentClaimKey(job.companyId, job.templateId)] ?? -1) >= job.cycle, 'An accepted intake can reopen.');
    check(company.postedFacts[`agent-fee:${rootJobId}`], 'An accepted job has no posted intake charge.');
    const fee = company.ledger.find(entry => entry.id === `agent-fee:${rootJobId}`);
    if (fee) check(fee.companyId === job.companyId && fee.kind === 'expense' && fee.category === 'operating' && fee.week === job.acceptedWeek && fee.amountCents === definition!.setupCents, 'The intake charge differs from the frozen customer terms.');
    record(job.configuration, 'Configuration'); keys(job.configuration, 'mode verification tools maxSteps maxRetries workBudget', 'Configuration');
    check(validAgentConfiguration(job.configuration), 'Frozen permissions or budgets are invalid.');
    check(hasResearch(state, job.companyId, 'R9') && (job.configuration.verification !== 'independent' || hasResearch(state, job.companyId, 'R10')) && (job.configuration.mode !== 'bounded' || (hasResearch(state, job.companyId, 'R11') && job.configuration.verification === 'independent')), 'A workflow uses unavailable research.');
    const model = state.slices.models.versions[job.model.id], report = state.slices.models.reports[job.model.reportId];
    record(job.model, 'Frozen model'); keys(job.model, 'id name family residentMU capabilityBps reliabilityBps behavior reportId' + (model?.architecture === 'sparse' || model?.runtimeVariant ? ' architecture workBps' : '') + (model?.planner ? ' planner' : ''), 'Frozen model');
    if (job.model.planner) check(validPlannerTrait(job.model.planner), 'The saved planner multiplier is invalid.');
    check(model && model.companyId === job.companyId && report && report.companyId === job.companyId && report.modelId === model.id && report.heldOut && isCapabilitySuite(report.suiteId) && report.week <= job.acceptedWeek, 'A model lacks owned, prior capability evidence.');
    check(same(job.model, { id: model.id, name: model.name, family: model.family, residentMU: model.residentMU, capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, behavior: model.behavior ?? BASE_BEHAVIOR, reportId: report.id, ...(model.architecture === 'sparse' || model.runtimeVariant ? { architecture: model.architecture, workBps: modelWorkBps(model) } : {}), ...(model.planner ? { planner: model.planner } : {}) }), 'The admitted model snapshot was changed.');
    check(same(report.capabilityBps, job.model.capabilityBps) && report.reliabilityBps === job.model.reliabilityBps, 'The held-out report does not describe this frozen model.');
    check(agentMeetsOrder(definition!, job.model), 'A model bypassed customer capability requirements.');
    const codingTools = agentOrderTools(CODING_AGENT_ORDER);
    check(job.configuration.tools.every(tool => definition!.coding ? codingTools.includes(tool) : !codingTools.includes(tool)), 'Permissions crossed workflow families.');
    if (definition!.coding) check(job.configuration.verification === 'independent' && inheritedModelRights(state, job.model.id, content).hosted, 'Coding work lacks independent verification or hosted model rights.');
    check(STAGES.includes(job.stage) && STATUSES.includes(job.status), 'Unknown stage or status.');
    check(typeof job.lastBottleneck === 'string' && job.lastBottleneck.length <= 2000, 'A job explanation is invalid.');
    check(Array.isArray(job.history) && job.history.length <= job.configuration.maxSteps && job.history.length === job.steps, 'The completed-step journal differs from the step budget.');
    check(job.attempt === job.retries && job.retries <= job.configuration.maxRetries && job.spentWork <= job.configuration.workBudget && job.permissionBlocks <= 1, 'The job exceeded a frozen retry, permission or work bound.');
    check(Array.isArray(job.plannedTools) && job.plannedTools.length <= definition!.readTools.length + 1, 'The saved planner escaped its finite tool graph.');
    for (const value of [job.claimedComplete, job.deliveredDraft, job.actionApplied, job.verifiedOutcome]) check(typeof value === 'boolean', 'A completion field is not boolean.');
    check([true, false, null].includes(job.checkerPassed) && [true, false, null].includes(job.actualSuccess) && [null, 'pending', 'approved', 'rejected'].includes(job.humanDecision), 'A saved claim or decision is invalid.');
    let parent: AgentJob | undefined, source: AgentJob | undefined;
    if (job.recovery) {
      const recovery = job.recovery;
      record(recovery, 'Recovery'); keys(recovery, 'rootJobId parentJobId rolloutId generation startedWeek parentStatus', 'Recovery');
      id(recovery.rootJobId); id(recovery.parentJobId); id(recovery.rolloutId); past(recovery.startedWeek);
      check((recovery.generation === 1 || recovery.generation === 2) && ['paused', 'failed'].includes(recovery.parentStatus), 'A recovery escaped its bounded chain or changed its parent disposition.');
      parent = slice.jobs[recovery.parentJobId];
      check(parent && parent.handedOffTo === job.id && parent.status === 'handed-off' && recovery.parentJobId === (recovery.generation === 1 ? rootJobId : agentRecoveryJobId(rootJobId, recovery.generation - 1)) && job.id === agentRecoveryJobId(rootJobId, recovery.generation), 'A recovery lost its parent, forked, or invented an execution identity.');
      check(parent.companyId === job.companyId && agentRootJobId(parent) === rootJobId && (parent.recovery?.generation ?? 0) + 1 === recovery.generation, 'A recovery crossed an owner or order boundary.');
      const rollout = state.slices.research.systemRollouts?.[recovery.rolloutId];
      check(hasResearch(state, job.companyId, AGENT_RECOVERY.research) && rollout?.companyId === job.companyId && rollout.method === 'action-receipts' && rollout.status === 'active' && rollout.readyWeek !== null && rollout.readyWeek <= recovery.startedWeek, 'Recovery preceded its researched, paid implementation and activation.');
      check(recovery.startedWeek > Math.max(parent.acceptedWeek, parent.history.at(-1)?.completedWeek ?? parent.acceptedWeek) && (recovery.parentStatus !== 'failed' || (parent.completedWeek !== null && parent.completedWeek < recovery.startedWeek)), 'A recovery began before the saved execution stopped.');
      source = originalHandoffSource(parent, job);
      check(!agentRecoveryBlock(source), 'A recovery reopened a settled outcome, permission failure, exhausted retry, or ineligible stage.');
      const needs = agentRecoveryRequirements(source);
      check(job.configuration.maxSteps >= needs.minimumSteps && job.configuration.workBudget >= needs.minimumBudget, 'Recovery erased previous limits or left its saved stage and audit unpaid.');
      for (const field of ['acceptedWeek', 'orderId', 'templateId', 'cycle', 'evidenceKey', 'model', 'terms'] as const) check(same(job[field], parent[field]), 'A recovery changed frozen customer or model evidence.');
      check(same(job.configuration, { ...parent.configuration, maxSteps: job.configuration.maxSteps, workBudget: job.configuration.workBudget }), 'A recovery changed tools, retry limits, mode, or verification.');
      check(job.history.length >= parent.history.length && same(job.history.slice(0, parent.history.length), parent.history), 'A recovery rewrote or omitted paid parent history.');
      check(!company.postedFacts[`agent-fee:${job.id}`], 'A continuation charged a second intake fee.');
    }
    const replay = source ? createAgentRecovery(source, job.recovery!.rolloutId, job.recovery!.startedWeek, job.configuration.maxSteps, job.configuration.workBudget) : freshReplay(job);
    const replaySlice = createEmptyAgentsSlice(), facts: LedgerFact[] = []; replaySlice.jobs[job.id] = replay;
    if (parent) replaySlice.jobs[parent.id] = structuredClone(parent);
    if (source?.receiptId) replaySlice.actionReceipts[source.receiptId] = structuredClone(slice.actionReceipts[source.receiptId]);
    replaySlice.totalsByCompany[job.companyId] = { ...emptyAgentTotals(), accepted: 1 };
    let previousCompletion = (job.recovery?.startedWeek ?? job.acceptedWeek) - 1;
    for (const h of job.history.slice(parent?.steps ?? 0)) {
      record(h, 'Stage receipt'); keys(h, HISTORY_KEYS, 'Stage receipt');
      numbers([h.index, h.attempt, h.startedWeek, h.completedWeek, h.work, h.physicalWork, h.staff, h.inputTokens, h.outputTokens, h.calls]); past(h.completedWeek);
      check(typeof h.note === 'string' && h.note.length <= 2000, 'A stage note is invalid.');
      check(!isAgentTerminal(replay) && h.index === replay.steps && h.stage === replay.stage && h.attempt === replay.attempt, 'The stage sequence or retry identity was forged.');
      check(h.startedWeek === replay.stageStartedWeek && h.completedWeek >= h.startedWeek && h.completedWeek > previousCompletion, 'A stage executed before admission or without a weekly boundary.');
      previousCompletion = h.completedWeek;
      if (replay.status === 'awaiting-approval') { check(h.stage === 'review', 'Approval was bypassed.'); replay.status = 'running'; replay.humanDecision = 'approved'; }
      const spec = agentStageNeeds(replay);
      check(agentToolAllowed(replay) && agentCanFundActionAudit(replay), 'A prohibited or unauditable action appears in the completed history.');
      check(h.work === spec.work && h.staff === spec.staff && h.tool === spec.tool && h.inputTokens === spec.inputTokens && h.outputTokens === spec.outputTokens && h.calls === spec.calls, 'A completed stage has unpaid or altered calls, work, tools or staff.');
      physicalEvidence(h.work, h.physicalWork); physicalEvidence(h.work - replay.stageWork, h.physicalWork - replay.stagePhysicalWork);
      countWork(replay, h); check(replay.spentWork <= job.configuration.workBudget, 'A completed stage exceeded total work.');
      completeAgentStage(replaySlice, replay, h.completedWeek, facts);
      check(same(replay.history[replay.history.length - 1], h), 'A stage journal changed its deterministic evidence or explanation.');
    }
    for (const field of ['stage', 'stageStartedWeek', 'steps', 'attempt', 'retries', 'lookupIndex', 'plannedTools', 'claimedComplete', 'draftOutcome', 'checkerPassed', 'deliveredDraft', 'actionApplied', 'actualSuccess', 'verifiedOutcome', 'receiptId', 'invoiceId', 'billedCents', 'penaltyCents'] as const) check(same(job[field], replay[field]), `Saved ${field} is not supported by paid stage evidence.`);
    const spec = agentStageNeeds(replay);
    check(job.stageWork <= spec.work && job.stageStaff <= spec.staff, 'Partial progress exceeds a stage requirement.');
    physicalEvidence(job.stageWork, job.stagePhysicalWork); physicalEvidence(job.stageWork - replay.stageWork, job.stagePhysicalWork - replay.stagePhysicalWork);
    if (isAgentTerminal(replay)) check(job.stageWork === 0 && job.stagePhysicalWork === 0 && job.stageStaff === 0, 'Terminal stage meters contain duplicate work.');
    if (job.stageWork > 0 || job.stageStaff > 0) {
      check(!isAgentTerminal(replay) && agentToolAllowed(job) && agentCanFundActionAudit(job), 'Partial work used a prohibited tool or followed terminal settlement.');
      if (job.stage === 'review') check(job.humanDecision === 'approved', 'Paid human review began without approval.');
    }
    countWork(replay, { work: job.stageWork, physicalWork: job.stagePhysicalWork, staff: job.stageStaff });
    for (const field of ['spentWork', 'physicalWork', 'reviewStaff', 'inputTokens', 'outputTokens', 'modelCalls', 'checkerRuns', 'toolCalls'] as const) check(job[field] === replay[field], `Metered ${field} does not reconcile with actual stage work.`);
    const completedByMachine = isAgentTerminal(replay);
    if (completedByMachine) {
      check(job.status === replay.status && job.completedWeek === replay.completedWeek && job.humanDecision === replay.humanDecision && job.permissionBlocks === 0, 'Terminal result differs from paid workflow evidence.');
    } else {
      const permissionFailure = !agentToolAllowed(job), budgetFailure = job.spentWork >= job.configuration.workBudget && job.stageWork < spec.work, auditBudgetFailure = !agentCanFundActionAudit(job);
      if (job.status === 'failed') check((permissionFailure && job.permissionBlocks === 1) || ((budgetFailure || auditBudgetFailure) && job.permissionBlocks === 0), 'Failure has no bound or permission cause.');
      else check(job.permissionBlocks === 0, 'A live or cancelled job has a completed permission failure.');
      if (job.status === 'cancelled') check(!job.actionApplied, 'Cancellation erased an applied action’s mandatory audit.');
      check(job.status !== 'complete', 'Completion lacks the required paid review or audit.');
      if (job.status === 'awaiting-approval') check(job.stage === 'review' && job.humanDecision === 'pending' && job.stageStaff === 0, 'Approval wait has unearned progress.');
      if (job.stage === 'review') {
        check(job.humanDecision === 'pending' || job.humanDecision === 'approved' || (job.status === 'cancelled' && job.humanDecision === 'rejected'), 'Human review has no explicit decision.');
        if (job.status === 'running' || job.status === 'paused') check(job.humanDecision === 'approved', 'A review ran without an approved decision.');
      } else check(job.humanDecision === replay.humanDecision, 'Human decision changed outside its approval step.');
      if (isAgentTerminal(job)) check(job.completedWeek !== null && job.completedWeek >= Math.max(job.acceptedWeek, previousCompletion), 'Terminal time predates its work.');
      else check(job.completedWeek === null, 'A live job has a settlement date.');
    }
    if (job.actionApplied) {
      check(job.receiptId !== null && !!slice.actionReceipts[job.receiptId], 'An applied action has no durable receipt.');
      check(same(slice.actionReceipts[job.receiptId!], replaySlice.actionReceipts[job.receiptId!]), 'An action receipt changed its company, scope, authority, time or realized result.');
      expectedReceiptIds.add(job.receiptId!);
      if (!job.history.some(h => h.stage === 'audit')) {
        const recovering = job.stage === 'recover' && source?.stage === 'audit';
        const audit = recovering ? agentStageNeeds(source!).work - source!.stageWork : 0;
        check(['running', 'paused'].includes(job.status) && (job.stage === 'audit' || recovering) && job.configuration.maxSteps - job.steps >= (recovering ? 2 : 1) && job.configuration.workBudget - job.spentWork >= spec.work - job.stageWork + audit, 'An applied action escaped its mandatory paid audit obligation.');
      }
    }
    for (const fact of facts) {
      check(company.postedFacts[fact.id], 'A customer invoice or penalty has no posted company-ledger fact.');
      const entry = company.ledger.find(item => item.id === fact.id);
      if (entry) check(entry.companyId === fact.companyId && entry.kind === fact.kind && entry.amountCents === fact.amountCents && entry.category === fact.category && entry.week === fact.week && entry.sourceId === fact.sourceId, 'A workflow settlement differs from the company ledger.');
      if (fact.kind === 'receipt') expectedInvoices.set(fact.id, fact);
    }
  }
  check(same(Object.keys(slice.actionReceipts).sort(), [...expectedReceiptIds].sort()), 'An orphan or duplicate action receipt exists.');
  check(slice.invoices.length <= owners.length * AGENT_INVOICE_HISTORY && new Set(slice.invoices.map(item => item.id)).size === slice.invoices.length, 'Invoice history is unbounded or contains duplicates.');
  for (const invoice of slice.invoices) {
    record(invoice, 'Invoice'); keys(invoice, 'id jobId companyId week basis amountCents caseCount', 'Invoice'); id(invoice.id); owner(invoice.companyId); numbers([invoice.week, invoice.amountCents, invoice.caseCount]);
    const job = slice.jobs[invoice.jobId], expected = expectedInvoices.get(invoice.id);
    check(job && expected && job.invoiceId === invoice.id && invoice.companyId === job.companyId && invoice.week === expected.week && invoice.amountCents === expected.amountCents && invoice.caseCount === job.terms.caseCount, 'An invoice is not backed by its retained completed job.');
    check(invoice.basis === (job.configuration.mode !== 'draft' && job.configuration.verification === 'independent' ? 'verified-outcome' : 'reviewed-draft'), 'Invoice basis misrepresents model claims as accepted outcomes.');
  }
  const expectedActive = Object.values(slice.jobs).filter(job => !isAgentTerminal(job)).map(job => job.id).sort();
  check(same(slice.activeJobIds, expectedActive), 'The active job alias lost or invented a paused or waiting order.');
  for (const companyId of owners) {
    const jobs = Object.values(slice.jobs).filter(job => job.companyId === companyId), active = jobs.filter(job => !isAgentTerminal(job)), leaves = jobs.filter(job => !job.handedOffTo);
    check(active.length <= MAX_ACTIVE_AGENT_JOBS && leaves.length - active.length <= AGENT_TERMINAL_HISTORY + AGENT_INVOICE_HISTORY && jobs.length <= leaves.length * (AGENT_RECOVERY.maximumHandoffs + 1) && slice.invoices.filter(item => item.companyId === companyId).length <= AGENT_INVOICE_HISTORY, 'Per-company retained history exceeds its bounds.');
    const total = slice.totalsByCompany[companyId];
    if (!total) { check(jobs.length === 0 && !Object.keys(slice.claims).some(key => ALL_AGENT_ORDERS.some(order => key === agentClaimKey(companyId, order.id))), 'An accepted order has no cumulative totals.'); continue; }
    record(total, 'Cumulative totals'); keys(total, 'accepted complete failed deliveredDrafts verifiedOutcomes revenueCents penaltyCents', 'Cumulative totals'); numbers(Object.values(total));
    const maxIntakes = ALL_AGENT_ORDERS.length * (Math.floor(state.week / AGENT_INTAKE_WEEKS) + 1);
    check(total.accepted >= leaves.length && total.accepted <= maxIntakes && total.complete + total.failed <= total.accepted && total.deliveredDrafts <= total.complete && total.verifiedOutcomes <= total.complete, 'Cumulative counts exceed finite customer intake.');
    check(total.complete >= jobs.filter(job => job.status === 'complete').length && total.failed >= jobs.filter(job => job.status === 'failed').length && total.deliveredDrafts >= jobs.filter(job => job.deliveredDraft).length && total.verifiedOutcomes >= jobs.filter(job => job.verifiedOutcome).length, 'Totals lost retained job outcomes.');
    check(total.revenueCents >= jobs.reduce((sum, job) => sum + job.billedCents, 0) && total.revenueCents <= total.complete * Math.max(...ALL_AGENT_ORDERS.map(order => order.outcomeFeeCents)) && total.penaltyCents >= jobs.reduce((sum, job) => sum + job.penaltyCents, 0) && total.penaltyCents <= total.failed * Math.max(...ALL_AGENT_ORDERS.map(order => order.failurePenaltyCents)), 'Cumulative money exceeds supported customer settlement.');
  }
  for (const companyId of Object.keys(slice.totalsByCompany)) owner(companyId);
  // The passed catalog remains part of the interface so authored research gates are checked by the shared validator.
  check(content.research.some(item => item.id === 'R9'), 'Workflow research is absent from the active catalog.');
}
