import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import { formatWorkPoints } from './workforce-points';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { policyReleaseRejection } from './policy-holdouts';
import type { DomainModule, DomainResult, GameCommand, GameContent, GameState, LedgerFact, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import type { AgentCompanyTotals, AgentConfiguration, AgentDraftOutcome, AgentJob, AgentModelSnapshot, AgentOrderDefinition, AgentSlice, AgentStage, AgentTool, AgentView } from '../contracts/wave3-agents';
import { CONTENT } from '../content/catalog';
import { AGENT_INTAKE_WEEKS, AGENT_INVOICE_HISTORY, ALL_AGENT_ORDERS, CODING_AGENT_ORDER, AGENT_TERMINAL_HISTORY, AGENT_TOOLS, MAX_ACTIVE_AGENT_JOBS } from '../content/wave3-agents';
import { canonicalStateHash, hashText } from '../core/canonical';
import { checkedAdd, formatMoney, formatUnits, mulDiv } from '../core/math';
import { BASE_BEHAVIOR } from './lab-planner';
import { hasResearch } from './research';
import { inheritedModelRights, modelExecutionHints, modelWorkBps } from './model-runtime';
import { SPARSE_DESIGN } from '../content/wave4-research';
import { AGENT_RECOVERY } from '../content/wave7-agents';
import { plannerRepeatMultiplier } from './agent-planning';
import { isCapabilitySuite } from './evaluation-classification';
import { systemRollout } from './applied-research';

const TERMINAL = new Set(['complete', 'failed', 'cancelled', 'handed-off']);
const STAGE_LABELS: Record<AgentStage, string> = { plan: 'Plan bounded steps', lookup: 'Read approved evidence', draft: 'Generate response', sandbox: 'Run isolated smoke tests', check: 'Check proposed completion', review: 'Human approval and staff review', action: 'Apply authorized action', audit: 'Check actual customer outcome', recover: 'Reconcile saved work and action receipt' };
const jobWorkId = (job: AgentJob) => `${job.id}:work`;
export const agentClaimKey = (companyId: string, templateId: string): string => `${companyId}:${templateId}`;
export const agentJobId = (companyId: string, templateId: string, cycle: number): string => `agent:${hashText(companyId)}:${templateId}:${cycle}`;
export const agentEvidenceKey = (seed: string, companyId: string, templateId: string, cycle: number): string => canonicalStateHash({ seed, companyId, templateId, cycle });
export const isAgentTerminal = (job: AgentJob): boolean => TERMINAL.has(job.status);
export const agentRootJobId = (job: AgentJob): string => job.recovery?.rootJobId ?? job.id;
export const agentRecoveryJobId = (rootJobId: string, generation: number): string => `${rootJobId}:recovery:${generation}`;
export function emptyAgentTotals(): AgentCompanyTotals { return { accepted: 0, complete: 0, failed: 0, deliveredDrafts: 0, verifiedOutcomes: 0, revenueCents: 0, penaltyCents: 0 }; }
export function createEmptyAgentsSlice(): AgentSlice { return { activeJobIds: [], jobs: {}, actionReceipts: {}, invoices: [], claims: {}, totalsByCompany: {} }; }
function totals(slice: AgentSlice, companyId: string): AgentCompanyTotals { return slice.totalsByCompany[companyId] ??= emptyAgentTotals(); }
function roll(job: Pick<AgentJob, 'evidenceKey'>, label: string, attempt: number): number { return Number.parseInt(hashText(`${job.evidenceKey}:${label}:${attempt}`), 16) % 10000; }

/** These values are authored game costs, not a claim about any real API or accelerator. */
export interface AgentStageNeeds { work: number; memory: number; staff: number; inputTokens: number; outputTokens: number; calls: number; tool: AgentTool | null }
export function agentStageNeeds(job: Pick<AgentJob, 'stage' | 'model' | 'terms' | 'configuration' | 'plannedTools' | 'lookupIndex'>): AgentStageNeeds {
  const cases = job.terms.caseCount, multiplier = FAMILY_SERVING_MULTIPLIER[job.model.family];
  const batch = (perCase: number) => perCase * cases;
  const memory = job.model.residentMU + batch(U / 200);
  const base = { work: 0, memory: 0, staff: 0, inputTokens: 0, outputTokens: 0, calls: 0, tool: null as AgentTool | null };
  switch (job.stage) {
    case 'recover': return { ...base, work: mulDiv(batch(AGENT_RECOVERY.workPerCase) * multiplier, job.model.workBps ?? 10000, 10000), memory, inputTokens: batch(AGENT_RECOVERY.inputTokensPerCase), outputTokens: batch(AGENT_RECOVERY.outputTokensPerCase), calls: cases };
    case 'plan': return { ...base, work: mulDiv(batch(U / 50) * multiplier, job.model.workBps ?? 10000, 10000), memory, inputTokens: batch(500), outputTokens: batch(100), calls: cases };
    case 'lookup': return { ...base, work: batch(U / 500), memory: U / 4, calls: cases, tool: job.plannedTools[job.lookupIndex] ?? null };
    case 'draft': return { ...base, work: mulDiv(batch(U / 25) * multiplier, job.model.workBps ?? 10000, 10000), memory, inputTokens: batch(1500), outputTokens: batch(400), calls: cases };
    case 'sandbox': return { ...base, work: batch(U / 50), memory: U, calls: cases, tool: 'run_sandbox_tests' };
    case 'check': return { ...base, work: batch(job.configuration.verification === 'independent' ? 3 * U / 250 : U / 250), memory: U / 2, calls: cases };
    case 'review': return { ...base, staff: batch(U / 40) };
    case 'action': return { ...base, work: batch(U / 500), memory: U / 4, calls: cases, tool: job.terms.actionTool };
    case 'audit': return { ...base, work: batch(U / 125), memory: U / 2, calls: cases };
  }
}
export function getAgentWorkflowEstimate(order: AgentOrderDefinition, model: Pick<AgentModelSnapshot, 'family' | 'residentMU' | 'architecture' | 'workBps'> & { runtimeVariant?: { servingWorkBps: number } }, configuration: AgentConfiguration): { work: number; staff: number; steps: number; peakMemory: number; note: string } {
  const stages: AgentStage[] = ['plan', ...order.readTools.map(() => 'lookup' as const), 'draft', ...(order.coding ? ['sandbox' as const] : []), 'check', ...(configuration.mode === 'bounded' ? [] : ['review' as const]), ...(configuration.mode === 'draft' ? [] : ['action' as const, 'audit' as const])];
  const specs = stages.map(stage => agentStageNeeds({ stage, model: { ...model, workBps: model.workBps ?? mulDiv(model.architecture === 'sparse' ? SPARSE_DESIGN.servingWorkBps : 10000, model.runtimeVariant?.servingWorkBps ?? 10000, 10000) } as AgentModelSnapshot, terms: order, configuration, plannedTools: order.readTools, lookupIndex: 0 }));
  return { work: specs.reduce((sum, spec) => sum + spec.work, 0), staff: specs.reduce((sum, spec) => sum + spec.staff, 0), steps: stages.length, peakMemory: Math.max(...specs.map(spec => spec.memory)), note: 'Baseline for one successful attempt. Retries and an extra bounded lookup consume additional steps and work; payroll and allocated GPU costs come from the shared company ledger.' };
}
export function agentExpectedPlan(job: Pick<AgentJob, 'configuration' | 'terms' | 'model' | 'evidenceKey'>, attempt: number): AgentTool[] {
  const tools = [...job.terms.readTools];
  if (job.configuration.mode !== 'bounded') return tools;
  // A model may propose an inappropriate write. Permission checks reject it before any side effect.
  if (roll(job, 'plan-scope', attempt) < Math.floor(job.model.behavior.confidentErrorBps / 3)) tools.push(job.terms.coding ? 'publish_patch' : job.terms.actionTool === 'issue_credit' ? 'send_reply' : 'issue_credit');
  else if (roll(job, 'plan-extra', attempt) < mulDiv(Math.max(250, 6500 - job.model.capabilityBps.tools), plannerRepeatMultiplier(job.model), 10000)) tools.push(job.terms.readTools[job.terms.readTools.length - 1]);
  return tools;
}
export function agentExpectedDraft(job: Pick<AgentJob, 'terms' | 'model' | 'evidenceKey'>, attempt: number): AgentDraftOutcome {
  const relevant = job.terms.coding ? job.model.capabilityBps.coding : job.terms.readTools.includes('search_docs') ? Math.floor((job.model.capabilityBps.conversation + job.model.capabilityBps.documents) / 2) : job.model.capabilityBps.conversation;
  const usefulBase = mulDiv(Math.min(9800, Math.max(1000, 5000 + relevant - job.terms.difficultyBps)), job.model.reliabilityBps, 10000);
  const useful = Math.max(0, usefulBase - job.model.behavior.falseRefusalBps);
  const confident = Math.min(job.model.behavior.confidentErrorBps, 10000 - useful);
  const refusal = Math.min(job.model.behavior.falseRefusalBps, 10000 - useful - confident);
  const draw = roll(job, 'draft-outcome', attempt);
  return draw < useful ? 'useful' : draw < useful + confident ? 'confident-error' : draw < useful + confident + refusal ? 'false-refusal' : 'clarification';
}
export function agentExpectedCheck(job: Pick<AgentJob, 'configuration' | 'terms' | 'model' | 'evidenceKey'>, attempt: number): boolean {
  const draft = agentExpectedDraft(job, attempt);
  if (draft === 'useful') return true;
  if (draft !== 'confident-error') return false;
  return roll(job, 'checker-miss', attempt) < (job.configuration.verification === 'independent' ? 500 : 2000);
}
export function agentExpectedReview(job: Pick<AgentJob, 'terms' | 'model' | 'evidenceKey'>, attempt: number): boolean {
  return agentExpectedDraft(job, attempt) === 'useful' || roll(job, 'review-miss', attempt) < 500;
}
export function agentToolAllowed(job: AgentJob, stage: AgentStage = job.stage): boolean {
  const tool = stage === 'lookup' ? job.plannedTools[job.lookupIndex] : stage === 'action' ? job.terms.actionTool : stage === 'sandbox' ? 'run_sandbox_tests' : null;
  if (!tool) return stage !== 'lookup' && stage !== 'action';
  if (!job.configuration.tools.includes(tool)) return false;
  if (stage === 'sandbox') return !!job.terms.coding;
  if (stage === 'lookup') return job.terms.readTools.includes(tool) && AGENT_TOOLS.some(definition => definition.id === tool && definition.kind === 'read');
  return job.configuration.mode !== 'draft' && (job.configuration.mode === 'bounded' || job.humanDecision === 'approved');
}
export function agentCanFundActionAudit(job: AgentJob): boolean {
  if (job.stage !== 'action') return true;
  const action = agentStageNeeds(job), audit = agentStageNeeds({ ...job, stage: 'audit' });
  return job.configuration.maxSteps - job.steps >= 2 && job.configuration.workBudget - job.spentWork >= action.work - job.stageWork + audit.work;
}
/** Eligibility comes from paid stage evidence and exhausted limits, never from a display note. */
export function agentRecoveryBlock(job: AgentJob): string | undefined {
  if (job.handedOffTo || (job.recovery?.generation ?? 0) >= AGENT_RECOVERY.maximumHandoffs) return 'This order has used its available recovery handoffs.';
  if (job.stage === 'recover') return 'Finish or resume the existing paid recovery before another handoff.';
  if (job.invoiceId || job.deliveredDraft || job.verifiedOutcome || job.penaltyCents || job.permissionBlocks || !agentToolAllowed(job)) return 'Settled, rejected-outcome, or out-of-scope work cannot be reopened.';
  if (job.status === 'paused') return;
  if (job.status !== 'failed' || job.actionApplied) return 'Pause unfinished work, or choose a job stopped by a work or step budget.';
  const lastStage = job.history.at(-1);
  if ((job.stage === 'check' && job.checkerPassed === false) || ((job.stage === 'review' || job.stage === 'sandbox') && lastStage?.stage === job.stage && lastStage.attempt === job.attempt)) return job.stage === 'sandbox' ? 'Recovery cannot reopen a rejected sandbox test after retries are exhausted.' : 'Recovery does not reset a rejected check, exhausted retry, or staff review.';
  const spec = agentStageNeeds(job);
  if (job.steps >= job.configuration.maxSteps || !agentCanFundActionAudit(job) || (job.spentWork >= job.configuration.workBudget && job.stageWork < spec.work)) return;
  return 'Only a budget-stopped failure can be reopened.';
}
export function agentRecoveryRequirements(job: AgentJob): { minimumSteps: number; minimumBudget: number; recoveryWork: number; memory: number } {
  const recover = agentStageNeeds({ ...job, stage: 'recover' }), current = agentStageNeeds(job);
  const auditWork = job.stage === 'action' ? agentStageNeeds({ ...job, stage: 'audit' }).work : 0;
  return { minimumSteps: Math.max(job.configuration.maxSteps, job.steps + 2 + (job.stage === 'action' ? 1 : 0)), minimumBudget: Math.max(job.configuration.workBudget, job.spentWork + recover.work + current.work - job.stageWork + auditWork), recoveryWork: recover.work, memory: recover.memory };
}
/** Seed a continuation without changing the original outcome draw, paid meters, or customer claim. */
export function createAgentRecovery(parent: AgentJob, rolloutId: string, week: number, maxSteps: number, workBudget: number): AgentJob {
  const rootJobId = agentRootJobId(parent), generation = ((parent.recovery?.generation ?? 0) + 1) as 1 | 2;
  const child = structuredClone(parent); delete child.handedOffTo;
  return { ...child, id: agentRecoveryJobId(rootJobId, generation), recovery: { rootJobId, parentJobId: parent.id, rolloutId, generation, startedWeek: week, parentStatus: parent.status as 'paused' | 'failed' },
    configuration: { ...child.configuration, maxSteps, workBudget }, status: 'running', completedWeek: null, stage: 'recover', stageStartedWeek: week,
    stageWork: 0, stagePhysicalWork: 0, stageStaff: 0, lastBottleneck: 'Pay the saved-model recovery pass before continuing the same customer order. All prior calls, permissions, retries, receipts and billing terms are retained.' };
}
function aliases(slice: AgentSlice): void { slice.activeJobIds = Object.values(slice.jobs).filter(job => !isAgentTerminal(job)).map(job => job.id).sort(); }
export function pruneAgentHistory(slice: AgentSlice): void {
  const owners = new Set(Object.values(slice.jobs).map(job => job.companyId));
  for (const owner of owners) {
    const invoices = slice.invoices.filter(invoice => invoice.companyId === owner).sort((a, b) => b.week - a.week || a.id.localeCompare(b.id)).slice(0, AGENT_INVOICE_HISTORY);
    slice.invoices = [...slice.invoices.filter(invoice => invoice.companyId !== owner), ...invoices];
    const retained = new Set(invoices.map(invoice => invoice.jobId));
    const terminal = Object.values(slice.jobs).filter(job => job.companyId === owner && isAgentTerminal(job) && !job.handedOffTo).sort((a, b) => (b.completedWeek ?? 0) - (a.completedWeek ?? 0) || a.id.localeCompare(b.id));
    terminal.slice(0, AGENT_TERMINAL_HISTORY).forEach(job => retained.add(job.id));
    Object.values(slice.jobs).filter(job => job.companyId === owner && !isAgentTerminal(job)).forEach(job => retained.add(job.id));
    // Keep bounded chains together so a leaf can always reconcile its original paid action.
    for (const jobId of [...retained]) { let job = slice.jobs[jobId]; while (job?.recovery) { retained.add(job.recovery.parentJobId); job = slice.jobs[job.recovery.parentJobId]; } }
    for (const job of Object.values(slice.jobs)) if (job.companyId === owner && isAgentTerminal(job) && !retained.has(job.id)) delete slice.jobs[job.id];
  }
  for (const [id, receipt] of Object.entries(slice.actionReceipts)) if (!Object.hasOwn(slice.jobs, receipt.jobId)) delete slice.actionReceipts[id];
  slice.invoices.sort((a, b) => b.week - a.week || a.id.localeCompare(b.id)); aliases(slice);
}
function finish(slice: AgentSlice, job: AgentJob, week: number, status: 'complete' | 'failed' | 'cancelled', note: string): void {
  if (isAgentTerminal(job)) return;
  job.status = status; job.completedWeek = week; job.lastBottleneck = note;
  if (status === 'complete') totals(slice, job.companyId).complete += 1;
  if (status === 'failed') totals(slice, job.companyId).failed += 1;
}
function enter(job: AgentJob, stage: AgentStage, week: number): void {
  job.stage = stage; job.stageStartedWeek = week; job.stageWork = 0; job.stagePhysicalWork = 0; job.stageStaff = 0;
  job.lastBottleneck = stage === 'review' ? 'Approve the proposed draft; commercial staff must then perform the review.' : 'Waiting for allocated serving compute and workspace.';
}
function retryOrFail(slice: AgentSlice, job: AgentJob, week: number, note: string): void {
  if (job.retries >= job.configuration.maxRetries || job.steps >= job.configuration.maxSteps || job.spentWork >= job.configuration.workBudget) { finish(slice, job, week, 'failed', note + ' Retry or work budget exhausted.'); return; }
  job.retries += 1; job.attempt += 1; job.lookupIndex = 0; job.plannedTools = []; job.claimedComplete = false; job.draftOutcome = null; job.checkerPassed = null; job.humanDecision = null;
  enter(job, 'plan', week); job.lastBottleneck = note + ' Retrying from a new paid planning step.';
}
function invoice(slice: AgentSlice, job: AgentJob, week: number, facts: LedgerFact[], basis: 'reviewed-draft' | 'verified-outcome'): void {
  if (job.invoiceId) return;
  const amountCents = basis === 'verified-outcome' ? job.terms.outcomeFeeCents : job.terms.draftFeeCents;
  const id = `invoice:agent:${agentRootJobId(job)}:${week}`;
  job.invoiceId = id; job.billedCents = amountCents;
  slice.invoices.push({ id, jobId: job.id, companyId: job.companyId, week, basis, amountCents, caseCount: job.terms.caseCount });
  totals(slice, job.companyId).revenueCents = checkedAdd(totals(slice, job.companyId).revenueCents, amountCents);
  facts.push({ id, companyId: job.companyId, week, sourceId: job.id, category: 'revenue', amountCents, kind: 'receipt', label: `${job.terms.name}: ${basis === 'verified-outcome' ? 'accepted customer outcome' : 'reviewed draft delivery'}` });
}
function recordStage(job: AgentJob, week: number, note: string): void {
  const spec = agentStageNeeds(job);
  job.history.push({ index: job.steps, stage: job.stage, attempt: job.attempt, tool: spec.tool, startedWeek: job.stageStartedWeek, completedWeek: week, work: job.stageWork, physicalWork: job.stagePhysicalWork, staff: job.stageStaff, inputTokens: spec.inputTokens, outputTokens: spec.outputTokens, calls: spec.calls, note });
  job.steps += 1;
  job.stageWork = 0; job.stagePhysicalWork = 0; job.stageStaff = 0;
}
/** Deterministic transition used by the runtime and by imported-history reconciliation. */
export function completeAgentStage(slice: AgentSlice, job: AgentJob, week: number, facts: LedgerFact[]): void {
  const stage = job.stage;
  if (stage === 'recover') {
    const parent = job.recovery && slice.jobs[job.recovery.parentJobId];
    if (!parent || parent.handedOffTo !== job.id) throw new Error('Recovery lost its saved parent execution.');
    recordStage(job, week, 'Paid recovery reconciled the original order, admitted permissions, prior calls and once-only action receipt. No new customer action or invoice was created.');
    job.stage = parent.stage; job.stageStartedWeek = parent.stageStartedWeek; job.stageWork = parent.stageWork; job.stagePhysicalWork = parent.stagePhysicalWork; job.stageStaff = parent.stageStaff;
    if (job.stage === 'review' && job.humanDecision === 'pending') job.status = 'awaiting-approval';
    job.lastBottleneck = 'Continue the saved stage with its already-paid progress; the original outcome evidence is unchanged.';
  } else if (stage === 'plan') {
    job.plannedTools = agentExpectedPlan(job, job.attempt); job.lookupIndex = 0;
    recordStage(job, week, job.configuration.mode === 'bounded' ? `Model selected ${job.plannedTools.length} bounded evidence steps; each permission is checked before execution.` : 'Fixed workflow selected its required evidence steps.');
    enter(job, 'lookup', week);
  } else if (stage === 'lookup') {
    recordStage(job, week, `Read ${agentStageNeeds(job).tool} within this order’s scope.`); job.lookupIndex += 1;
    enter(job, job.lookupIndex < job.plannedTools.length ? 'lookup' : 'draft', week);
  } else if (stage === 'draft') {
    job.draftOutcome = agentExpectedDraft(job, job.attempt); job.claimedComplete = ['useful', 'confident-error'].includes(job.draftOutcome);
    recordStage(job, week, job.terms.coding && job.draftOutcome === 'confident-error'
      ? 'Model claims the patch fixes the issue. Passing visible tests can still miss the customer’s acceptance criteria.'
      : job.claimedComplete ? 'Model claims the draft completes the task. This claim is not customer acceptance.' : job.draftOutcome === 'false-refusal' ? 'Model refused an allowed support case; no completion claimed.' : 'Model requested clarification; no completion claimed.');
    enter(job, job.terms.coding ? 'sandbox' : 'check', week);
  } else if (stage === 'sandbox') {
    // A patch can satisfy visible tests while failing the actual customer objective.
    recordStage(job, week, job.claimedComplete ? 'Sandbox smoke tests passed. Independent checks still need to compare the patch with the issue requirements.' : 'Sandbox found no runnable patch for the requested issue.');
    if (!job.claimedComplete) { retryOrFail(slice, job, week, 'Sandbox rejected the attempted patch.'); return; }
    enter(job, 'check', week);
  } else if (stage === 'check') {
    job.checkerPassed = agentExpectedCheck(job, job.attempt);
    recordStage(job, week, `${job.configuration.verification === 'independent' ? 'Independent' : 'Basic'} proposal check ${job.checkerPassed ? 'passed' : 'rejected'}; actual outcome remains unverified.`);
    if (!job.checkerPassed) { retryOrFail(slice, job, week, 'The paid checker did not accept the proposed completion.'); return; }
    if (job.configuration.mode === 'bounded') enter(job, 'action', week);
    else { enter(job, 'review', week); job.status = 'awaiting-approval'; job.humanDecision = 'pending'; }
  } else if (stage === 'review') {
    const accepted = agentExpectedReview(job, job.attempt);
    recordStage(job, week, accepted ? 'Approved draft passed the paid commercial review.' : 'Commercial review rejected the proposed draft despite the earlier check.');
    if (!accepted) { retryOrFail(slice, job, week, 'Commercial review found an unacceptable draft.'); return; }
    if (job.configuration.mode === 'draft') {
      job.deliveredDraft = true; totals(slice, job.companyId).deliveredDrafts += 1;
      invoice(slice, job, week, facts, 'reviewed-draft'); finish(slice, job, week, 'complete', 'Reviewed draft delivered and invoiced. No external action or business outcome was claimed.');
    } else enter(job, 'action', week);
  } else if (stage === 'action') {
    const id = `${agentRootJobId(job)}:action`;
    if (Object.hasOwn(slice.actionReceipts, id) || job.receiptId || job.actionApplied) throw new Error('An agent action receipt cannot be applied twice.');
    job.actualSuccess = job.draftOutcome === 'useful'; job.actionApplied = true; job.receiptId = id;
    slice.actionReceipts[id] = { id, jobId: job.id, companyId: job.companyId, orderId: job.orderId, tool: job.terms.actionTool, week, caseCount: job.terms.caseCount, correct: job.actualSuccess, authorizedBy: job.configuration.mode === 'bounded' ? 'bounded-policy' : 'human' };
    recordStage(job, week, 'Authorized simulated action applied once. Its durable receipt still needs a paid customer-outcome audit.');
    enter(job, 'audit', week);
  } else if (stage === 'audit') {
    job.verifiedOutcome = job.actualSuccess === true;
    recordStage(job, week, job.verifiedOutcome ? 'Customer-outcome audit accepted the actual result and action receipt.' : job.terms.coding ? 'Customer regression audit found that the patch passed smoke tests but failed the actual issue requirements. The outcome fee was withheld.' : 'Customer-outcome audit rejected the actual result; completion claim did not earn an outcome fee.');
    if (!job.verifiedOutcome) {
      job.penaltyCents = job.terms.failurePenaltyCents;
      totals(slice, job.companyId).penaltyCents = checkedAdd(totals(slice, job.companyId).penaltyCents, job.penaltyCents);
      facts.push({ id: `agent-penalty:${job.id}:${week}`, companyId: job.companyId, week, sourceId: job.id, category: 'operating', amountCents: job.penaltyCents, kind: 'expense', label: job.terms.name + ': rejected customer outcome' });
      finish(slice, job, week, 'failed', 'Actual customer outcome failed the audit. The once-only action remains recorded and a service penalty was charged.');
    } else {
      totals(slice, job.companyId).verifiedOutcomes += 1;
      if (job.configuration.verification === 'independent') invoice(slice, job, week, facts, 'verified-outcome');
      else { job.deliveredDraft = true; totals(slice, job.companyId).deliveredDrafts += 1; invoice(slice, job, week, facts, 'reviewed-draft'); }
      finish(slice, job, week, 'complete', job.configuration.verification === 'independent' ? 'Verified customer outcome accepted and invoiced.' : 'Reviewed draft invoiced at the draft rate; outcome-rate billing requires independent verification research.');
    }
  }
  if (!isAgentTerminal(job) && job.steps >= job.configuration.maxSteps) finish(slice, job, week, 'failed', 'Workflow step budget exhausted; no additional call, review or action can execute.');
}
function validateConfiguration(config: AgentConfiguration): boolean {
  return ['draft', 'approval', 'bounded'].includes(config.mode) && ['basic', 'independent'].includes(config.verification)
    && Array.isArray(config.tools) && config.tools.length <= AGENT_TOOLS.length && new Set(config.tools).size === config.tools.length && config.tools.every(tool => AGENT_TOOLS.some(item => item.id === tool))
    && Number.isSafeInteger(config.maxSteps) && config.maxSteps >= 4 && config.maxSteps <= 24
    && Number.isSafeInteger(config.maxRetries) && config.maxRetries >= 0 && config.maxRetries <= 2
    && Number.isSafeInteger(config.workBudget) && config.workBudget >= U / 100 && config.workBudget <= 32 * U;
}
export { validateConfiguration as validAgentConfiguration };
export function agentMeetsOrder(order: AgentOrderDefinition, model: Pick<AgentModelSnapshot, 'capabilityBps' | 'reliabilityBps'>): boolean {
  const { conversation, documents, coding, tools } = model.capabilityBps;
  return conversation >= order.minConversationBps && documents >= order.minDocumentsBps && tools >= order.minToolsBps
    && (!order.coding || (coding >= order.coding.minCodingBps && model.reliabilityBps >= order.coding.minReliabilityBps));
}
export function agentOrderTools(order: AgentOrderDefinition): AgentTool[] {
  return [...order.readTools, ...(order.coding ? ['run_sandbox_tests' as const] : []), order.actionTool];
}
function orderForId(orderId: string, week: number): AgentOrderDefinition | undefined { return ALL_AGENT_ORDERS.find(order => `${order.id}@${Math.floor(week / AGENT_INTAKE_WEEKS)}` === orderId); }
function qualifiedModel(state: Readonly<GameState>, companyId: string, modelId: string): AgentModelSnapshot | undefined {
  const model = state.slices.models.versions[modelId];
  const report = Object.values(state.slices.models.reports).filter(item => item.companyId === companyId && item.modelId === modelId && item.heldOut && isCapabilitySuite(item.suiteId)).sort((a, b) => b.week - a.week || a.id.localeCompare(b.id))[0];
  if (!model || model.companyId !== companyId || model.status === 'checkpoint' || !report || report.companyId !== companyId || report.modelId !== model.id || !report.heldOut || policyReleaseRejection(state, model.id)) return;
  return { id: model.id, name: model.name, family: model.family, residentMU: model.residentMU, capabilityBps: structuredClone(model.capabilityBps), reliabilityBps: model.reliabilityBps, behavior: structuredClone(model.behavior ?? BASE_BEHAVIOR), reportId: report.id, ...(model.architecture === 'sparse' || model.runtimeVariant ? { architecture: model.architecture, workBps: modelWorkBps(model) } : {}), ...(model.planner ? { planner: structuredClone(model.planner) } : {}) };
}
function validate(state: Readonly<GameState>, command: GameCommand, content: GameContent): Rejection | undefined {
  const p = command.payload, company = state.slices.company.companies[command.companyId];
  if (!company) return { code: 'UNKNOWN_COMPANY', message: 'Choose an existing company.' };
  if (p.kind === 'start_agent_job') {
    if (company.arrearsCents) return { code: 'ARREARS', message: 'Resolve unpaid bills before accepting agent work.' };
    if (!hasResearch(state, command.companyId, 'R9')) return { code: 'NOT_READY', message: 'Complete fixed-workflow research (R9) before accepting agent orders.' };
    if (!validateConfiguration(p)) return { code: 'INVALID_COMMAND', message: 'Choose supported permissions, 4–24 steps, 0–2 retries, and 0.01–32 CUw of total work.' };
    if (p.verification === 'independent' && !hasResearch(state, command.companyId, 'R10')) return { code: 'NOT_READY', message: 'Independent outcome verification requires R10.' };
    if (p.mode === 'bounded' && (!hasResearch(state, command.companyId, 'R11') || p.verification !== 'independent')) return { code: 'NOT_READY', message: 'Bounded autonomy requires R11 and independent verification.' };
    const order = orderForId(p.orderId, command.issuedForWeek);
    if (!order) return { code: 'NOT_READY', message: 'That intake has expired. Choose an offer for the next weekly boundary.' };
    if (order.coding && p.verification !== 'independent') return { code: 'NOT_READY', message: 'Coding orders require independent verification (R10), including for draft delivery.' };
    const codingTools = agentOrderTools(CODING_AGENT_ORDER);
    if (p.tools.some(tool => order.coding ? !codingTools.includes(tool) : codingTools.includes(tool))) return { code: 'INVALID_COMMAND', message: 'Choose tools from this workflow family’s scope.' };
    const cycle = Math.floor(command.issuedForWeek / AGENT_INTAKE_WEEKS);
    if ((state.slices.agents.claims[agentClaimKey(command.companyId, order.id)] ?? -1) >= cycle || state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind && other.payload.orderId === p.orderId)) return { code: 'ALREADY_ACTIVE', message: 'This intake is already accepted or queued. Cancellation cannot reroll the same customer cases.' };
    const policyRejection = policyReleaseRejection(state, p.modelId); if (policyRejection) return policyRejection;
    const model = qualifiedModel(state, command.companyId, p.modelId);
    if (!model) return { code: 'NOT_READY', message: 'Choose your evaluated model with a saved held-out report.' };
    if (!agentMeetsOrder(order, model)) return { code: 'NOT_READY', message: order.coding ? 'Coding orders require coding 50, tools 25 and reliability 85.' : 'This model does not meet the order’s conversation, documents or tool capability requirements.' };
    if (order.coding && !inheritedModelRights(state, model.id, content).hosted) return { code: 'NOT_READY', message: 'The model’s inherited data rights do not allow hosted coding work.' };
    const active = Object.values(state.slices.agents.jobs).filter(job => job.companyId === command.companyId && !isAgentTerminal(job)).length + state.queuedCommands.filter(other => other.id !== command.id && other.companyId === command.companyId && (other.payload.kind === 'start_agent_job' || (other.payload.kind === 'recover_agent_job' && state.slices.agents.jobs[other.payload.jobId]?.status === 'failed'))).length;
    if (active >= MAX_ACTIVE_AGENT_JOBS) return { code: 'QUEUE_FULL', message: 'Finish or cancel an active agent order before accepting another.' };
    return;
  }
  if (p.kind === 'recover_agent_job') {
    if (company.arrearsCents) return { code: 'ARREARS', message: 'Resolve unpaid bills before commissioning recovery work.' };
    const job = state.slices.agents.jobs[p.jobId], rollout = systemRollout(state, command.companyId, 'action-receipts');
    if (!hasResearch(state, command.companyId, AGENT_RECOVERY.research) || rollout?.status !== 'active') return { code: 'NOT_READY', message: 'Research Action receipts (R9A), then finish and activate its paid implementation.' };
    if (!job || job.companyId !== command.companyId) return { code: 'NOT_READY', message: 'Choose one of your retained support jobs.' };
    const block = agentRecoveryBlock(job); if (block) return { code: 'NOT_READY', message: block };
    if (!validateConfiguration({ ...job.configuration, maxSteps: p.maxSteps, workBudget: p.workBudget })) return { code: 'INVALID_COMMAND', message: 'Recovery retains 4–24 total steps and 0.01–32 CUw, including all original work.' };
    const needs = agentRecoveryRequirements(job);
    if (p.maxSteps < needs.minimumSteps || p.workBudget < needs.minimumBudget) return { code: 'NOT_READY', message: `Preserve the old limits and reserve at least ${needs.minimumSteps} total steps and ${formatUnits(needs.minimumBudget)} CUw for paid recovery and the saved stage${job.stage === 'action' ? ' plus its mandatory audit' : ''}.` };
    if (state.queuedCommands.some(other => other.id !== command.id && other.companyId === command.companyId && other.payload.kind === p.kind && other.payload.jobId === job.id)) return { code: 'ALREADY_ACTIVE', message: 'This execution already has a queued recovery handoff.' };
    const active = Object.values(state.slices.agents.jobs).filter(item => item.companyId === command.companyId && !isAgentTerminal(item)).length;
    const queued = state.queuedCommands.filter(other => other.id !== command.id && other.companyId === command.companyId && (other.payload.kind === 'start_agent_job' || (other.payload.kind === 'recover_agent_job' && state.slices.agents.jobs[other.payload.jobId]?.status === 'failed'))).length;
    if (job.status === 'failed' && active + queued >= MAX_ACTIVE_AGENT_JOBS) return { code: 'QUEUE_FULL', message: 'Finish an active support order before reopening another customer obligation.' };
    return;
  }
  if (p.kind !== 'set_agent_job_paused' && p.kind !== 'review_agent_job' && p.kind !== 'cancel_agent_job') return { code: 'INVALID_COMMAND', message: 'Unknown support workflow command.' };
  const job = state.slices.agents.jobs[p.jobId];
  if (!job || job.companyId !== command.companyId || isAgentTerminal(job)) return { code: 'NOT_READY', message: 'Choose one of your unfinished support jobs.' };
  if (p.kind === 'set_agent_job_paused') {
    if (job.status === 'awaiting-approval') return { code: 'NOT_READY', message: 'This draft is already waiting without using resources. Approve, reject, or cancel it.' };
    if ((job.status === 'paused') === p.paused) return { code: 'ALREADY_ACTIVE', message: p.paused ? 'The support job is already paused.' : 'The support job is already running.' };
  }
  if (p.kind === 'review_agent_job' && (job.status !== 'awaiting-approval' || job.stage !== 'review' || job.humanDecision !== 'pending')) return { code: 'NOT_READY', message: 'This job has no pending draft approval.' };
  if (p.kind === 'cancel_agent_job' && job.actionApplied) return { code: 'NOT_READY', message: 'An applied action must finish its reserved customer-outcome audit. Pause preserves the obligation; cancellation cannot erase it.' };
  return;
}
function requests(state: Readonly<GameState>, content: GameContent): WorkRequest[] {
  const result: WorkRequest[] = [];
  for (const job of Object.values(state.slices.agents.jobs)) {
    if (job.status !== 'running' || job.steps >= job.configuration.maxSteps || !agentToolAllowed(job) || !agentCanFundActionAudit(job)) continue;
    if (job.stage === 'review' && job.humanDecision !== 'approved') continue;
    const spec = agentStageNeeds(job), work = Math.min(spec.work - job.stageWork, job.configuration.workBudget - job.spentWork), staff = spec.staff - job.stageStaff;
    if (spec.work > job.stageWork && work <= 0) continue;
    result.push({ id: jobWorkId(job), companyId: job.companyId, taskId: job.id, category: 'serving', normalizedWorkCUw: work, memoryMU: spec.memory, ...modelExecutionHints(state.slices.models.versions[job.model.id]), priority: 5, poolId: 'auto', ...(staff > 0 ? { staffDemand: [{ role: 'commercial', staffWeeks: staff }] } : {}), headroomBps: content.firstSale.servingHeadroomBps });
  }
  return result;
}
function advance(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const agents = structuredClone(state.slices.agents);
  for (const job of Object.values(agents.jobs)) {
    if (job.status !== 'running' || !agentToolAllowed(job)) continue;
    const spec = agentStageNeeds(job), grant = ctx.resources.computeGrants.find(item => item.requestId === jobWorkId(job));
    const staff = ctx.resources.staffGrants.find(item => item.requestId === jobWorkId(job))?.grants.find(item => item.role === 'commercial')?.staffWeeks ?? 0;
    const work = grant?.hardwareEffectiveCUw ?? 0, physical = grant?.physicalCUw ?? 0;
    if (work > Math.min(spec.work - job.stageWork, job.configuration.workBudget - job.spentWork) || staff > spec.staff - job.stageStaff || (work > 0 && (grant?.memoryMU ?? 0) < spec.memory)) throw new Error('Agent work exceeded its frozen grant, budget or workspace.');
    const oldWork = job.stageWork, nextWork = checkedAdd(oldWork, work);
    const delta = (total: number, rounded: 'floor' | 'ceil' = 'floor') => spec.work ? mulDiv(nextWork, total, spec.work, rounded) - mulDiv(oldWork, total, spec.work, rounded) : 0;
    job.stageWork = nextWork; job.stagePhysicalWork = checkedAdd(job.stagePhysicalWork, physical); job.stageStaff = checkedAdd(job.stageStaff, staff);
    job.spentWork = checkedAdd(job.spentWork, work); job.physicalWork = checkedAdd(job.physicalWork, physical); job.reviewStaff = checkedAdd(job.reviewStaff, staff);
    job.inputTokens = checkedAdd(job.inputTokens, delta(spec.inputTokens)); job.outputTokens = checkedAdd(job.outputTokens, delta(spec.outputTokens));
    if (job.stage === 'plan' || job.stage === 'draft' || job.stage === 'recover') job.modelCalls = checkedAdd(job.modelCalls, delta(spec.calls, 'ceil'));
    if (job.stage === 'check' || job.stage === 'audit') job.checkerRuns = checkedAdd(job.checkerRuns, delta(spec.calls, 'ceil'));
    if (job.stage === 'lookup' || job.stage === 'sandbox' || job.stage === 'action') job.toolCalls = checkedAdd(job.toolCalls, delta(spec.calls, 'ceil'));
    job.lastBottleneck = spec.staff > job.stageStaff ? 'The approved draft review needs Business points.' : spec.work > job.stageWork ? 'Waiting for serving allocation and a connected pool with enough workspace. Existing paid workloads share this capacity.' : '';
  }
  return { updates: { agents } };
}
function resolve(state: Readonly<GameState>, ctx: ModuleContext): DomainResult {
  const agents = structuredClone(state.slices.agents), facts: LedgerFact[] = [], messages: NonNullable<DomainResult['messages']> = [];
  for (const job of Object.values(agents.jobs)) {
    if (job.status !== 'running') continue;
    if (!agentToolAllowed(job)) { job.permissionBlocks += 1; finish(agents, job, ctx.week, 'failed', job.terms.coding
      ? `Permission guard blocked ${agentStageNeeds(job).tool ?? 'the proposed tool'} during ${job.stage}. No patch was published. Previously executed calls remain paid.`
      : 'Permission guard blocked a missing or out-of-scope tool before any side effect. Previously executed calls remain paid.'); }
    else if (!agentCanFundActionAudit(job)) finish(agents, job, ctx.week, 'failed', 'Action blocked before any side effect: reserve enough remaining steps and work for both the action and its mandatory customer-outcome audit.');
    else if (job.steps >= job.configuration.maxSteps) finish(agents, job, ctx.week, 'failed', 'Workflow step limit reached.');
    else {
      const spec = agentStageNeeds(job);
      if (job.stageWork === spec.work && job.stageStaff === spec.staff && (job.stage !== 'review' || job.humanDecision === 'approved')) completeAgentStage(agents, job, ctx.week, facts);
      else if (job.spentWork >= job.configuration.workBudget && job.stageWork < spec.work) finish(agents, job, ctx.week, 'failed', 'Total effective-work budget exhausted partway through a paid stage. No uncompleted action or claim was accepted.');
    }
    if (isAgentTerminal(job) || job.humanDecision === 'pending') messages.push({ companyId: job.companyId, category: 'project', message: `${job.terms.name}: ${job.lastBottleneck}` });
  }
  pruneAgentHistory(agents); return { updates: { agents }, facts, messages };
}
export function createAgentsModule(content: GameContent): DomainModule {
  return {
    id: 'agents', owns: ['agents'], commandKinds: ['start_agent_job', 'set_agent_job_paused', 'review_agent_job', 'recover_agent_job', 'cancel_agent_job'],
    validateCommand: (state, command) => validate(state, command, content),
    quoteCommand(state, command) {
      const p = command.payload;
      if (p.kind === 'recover_agent_job') {
        const job = state.slices.agents.jobs[p.jobId];
        if (!job) return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Choose a retained support execution.' };
        const needs = agentRecoveryRequirements(job);
        return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: `Continue the same order: ${formatUnits(needs.recoveryWork)} serving CUw and ${formatUnits(needs.memory)} connected MU for the paid recovery pass. ${formatUnits(job.spentWork)} CUw and ${job.steps} completed steps remain spent. New cumulative caps: ${p.maxSteps} steps / ${formatUnits(p.workBudget)} CUw. Original model, tools, retries, evidence and action receipt remain; no second intake fee or customer invoice. These caps must still cover every remaining stage, check and audit.` };
      }
      if (p.kind !== 'start_agent_job') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Apply the saved workflow decision next week. Executed work, receipts and customer intake identity remain.' };
      const order = orderForId(p.orderId, command.issuedForWeek), model = qualifiedModel(state, command.companyId, p.modelId);
      if (!order || !model) return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Choose a current support offer and evaluated model.' };
      const estimate = getAgentWorkflowEstimate(order, model, p);
      return { upfrontCostCents: order.setupCents, weeklyCostDeltaCents: 0, summary: `${order.name}: ${formatMoney(order.setupCents)} intake fee; baseline ${estimate.steps} steps, ${formatUnits(estimate.work)} serving CUw and ${formatWorkPoints(estimate.staff)} Business points. Cap ${p.maxSteps} steps, ${p.maxRetries} retries, ${formatUnits(p.workBudget)} CUw. ${p.mode === 'draft' || p.verification === 'basic' ? 'Only reviewed draft delivery can earn the explicit draft fee.' : 'Outcome fees require an accepted independent check of the actual result.'} Payroll, rented capacity and actual GPU use are shared company costs.` };
    },
    applyCommand(state, command) {
      const agents = structuredClone(state.slices.agents), p = command.payload;
      if (p.kind === 'start_agent_job') {
        const terms = orderForId(p.orderId, command.issuedForWeek)!, cycle = Math.floor(command.issuedForWeek / AGENT_INTAKE_WEEKS), id = agentJobId(command.companyId, terms.id, cycle);
        if (Object.hasOwn(agents.jobs, id)) throw new Error('The support intake identity already exists.');
        const job: AgentJob = { id, companyId: command.companyId, orderId: p.orderId, templateId: terms.id, cycle, acceptedWeek: state.week, completedWeek: null,
          configuration: { mode: p.mode, verification: p.verification, tools: [...p.tools].sort(), maxSteps: p.maxSteps, maxRetries: p.maxRetries, workBudget: p.workBudget },
          model: qualifiedModel(state, command.companyId, p.modelId)!, terms: structuredClone(terms), evidenceKey: agentEvidenceKey(state.seed, command.companyId, terms.id, cycle),
          status: 'running', stage: 'plan', stageStartedWeek: state.week, stageWork: 0, stagePhysicalWork: 0, stageStaff: 0, steps: 0, retries: 0, attempt: 0, lookupIndex: 0, plannedTools: [],
          spentWork: 0, physicalWork: 0, reviewStaff: 0, inputTokens: 0, outputTokens: 0, modelCalls: 0, checkerRuns: 0, toolCalls: 0, claimedComplete: false, draftOutcome: null, checkerPassed: null,
          humanDecision: null, deliveredDraft: false, actionApplied: false, actualSuccess: null, verifiedOutcome: false, permissionBlocks: 0, receiptId: null, invoiceId: null, billedCents: 0, penaltyCents: 0,
          lastBottleneck: 'Waiting for serving compute and model workspace.', history: [] };
        agents.jobs[id] = job; agents.claims[agentClaimKey(command.companyId, terms.id)] = cycle; totals(agents, command.companyId).accepted += 1; aliases(agents);
        return { updates: { agents }, facts: [{ id: `agent-fee:${id}`, companyId: command.companyId, week: state.week, sourceId: command.id, category: 'operating', amountCents: terms.setupCents, label: terms.name + ': intake', kind: 'expense' }], messages: [{ companyId: command.companyId, category: 'project', message: `${terms.name} accepted with frozen model, permissions and budgets. Every executed call, checker and retry uses shared capacity.` }] };
      }
      if (p.kind === 'recover_agent_job') {
        const parent = agents.jobs[p.jobId], rollout = systemRollout(state, command.companyId, 'action-receipts')!;
        const child = createAgentRecovery(parent, rollout.id, state.week, p.maxSteps, p.workBudget);
        if (Object.hasOwn(agents.jobs, child.id)) throw new Error('A recovery handoff cannot fork or reuse its execution identity.');
        // Totals count final customer outcomes, not execution attempts. The parent journal retains its failure.
        if (parent.status === 'failed') totals(agents, command.companyId).failed -= 1;
        parent.status = 'handed-off'; parent.handedOffTo = child.id; parent.completedWeek ??= state.week;
        agents.jobs[child.id] = child;
      }
      if (p.kind === 'set_agent_job_paused') { const job = agents.jobs[p.jobId]; job.status = p.paused ? 'paused' : 'running'; job.lastBottleneck = p.paused ? 'Paused; all work and evidence are preserved.' : 'Waiting for the next resource grant.'; }
      if (p.kind === 'review_agent_job') { const job = agents.jobs[p.jobId]; job.humanDecision = p.decision === 'approve' ? 'approved' : 'rejected'; if (p.decision === 'reject') finish(agents, job, state.week, 'cancelled', 'Human rejected the draft. No action or customer fee was applied.'); else { job.status = 'running'; job.lastBottleneck = 'Approved; commercial staff must still complete the paid review.'; } }
      if (p.kind === 'cancel_agent_job') finish(agents, agents.jobs[p.jobId], state.week, 'cancelled', 'Cancelled. Executed work and any already-applied simulated action remain in the journal; no new invoice is created.');
      pruneAgentHistory(agents); return { updates: { agents } };
    },
    handlers: { reserve: state => ({ workRequests: requests(state, content) }), execute: advance, resolve },
  };
}
export function getAgentView(state: Readonly<GameState>, companyId: string, content: GameContent = CONTENT): AgentView {
  const slice = state.slices.agents, cycle = Math.floor((state.week + 1) / AGENT_INTAKE_WEEKS);
  const orderView = (order: AgentOrderDefinition) => ({ ...structuredClone(order), id: `${order.id}@${cycle}`, templateId: order.id, cycle, availableWeek: cycle * AGENT_INTAKE_WEEKS, expiresWeek: (cycle + 1) * AGENT_INTAKE_WEEKS - 1, claimed: (slice.claims[agentClaimKey(companyId, order.id)] ?? -1) >= cycle || state.queuedCommands.some(command => command.companyId === companyId && command.payload.kind === 'start_agent_job' && command.payload.orderId === `${order.id}@${cycle}`) });
  return { unlocked: hasResearch(state, companyId, 'R9') && content.research.some(item => item.id === 'R9' && item.implemented), independentUnlocked: hasResearch(state, companyId, 'R10'), boundedUnlocked: hasResearch(state, companyId, 'R11'), nextCycleWeek: (cycle + 1) * AGENT_INTAKE_WEEKS,
    orders: ALL_AGENT_ORDERS.filter(order => !order.coding).map(orderView),
    codingOrders: hasResearch(state, companyId, 'R10') ? [orderView(CODING_AGENT_ORDER)] : [],
    models: Object.values(state.slices.models.versions).map(model => qualifiedModel(state, companyId, model.id)).filter((model): model is AgentModelSnapshot => !!model).map(({ id, name, family, residentMU, capabilityBps, reliabilityBps, workBps }) => ({ id, name, family, residentMU, capabilityBps, reliabilityBps, workBps })),
    jobs: Object.values(slice.jobs).filter(job => job.companyId === companyId).sort((a, b) => Number(isAgentTerminal(a)) - Number(isAgentTerminal(b)) || b.acceptedWeek - a.acceptedWeek || a.id.localeCompare(b.id)).map(job => {
      const spec = agentStageNeeds(job), terminal = isAgentTerminal(job), partial = spec.work ? mulDiv(job.stageWork, 10000, spec.work) : spec.staff ? mulDiv(job.stageStaff, 10000, spec.staff) : 0;
      const outcome = job.configuration.mode !== 'draft' && job.configuration.verification === 'independent';
      return { job, title: job.terms.name, stageLabel: STAGE_LABELS[job.stage], progressBps: job.status === 'complete' ? 10000 : partial, stageRequiredWork: spec.work, stageRequiredStaff: spec.staff, stageMemory: spec.memory, expectedBillCents: outcome ? job.terms.outcomeFeeCents : job.terms.draftFeeCents, billingLabel: outcome ? 'Accepted actual outcome only' : 'Explicit reviewed-draft fee only', canReview: job.status === 'awaiting-approval', canPause: !terminal && job.status !== 'awaiting-approval', canCancel: !terminal && !job.actionApplied };
    }), invoices: slice.invoices.filter(invoice => invoice.companyId === companyId), receipts: Object.values(slice.actionReceipts).filter(receipt => receipt.companyId === companyId).map(receipt => ({ ...receipt, correct: Object.values(slice.jobs).some(job => job.receiptId === receipt.id && job.history.some(record => record.stage === 'audit')) ? receipt.correct : null })), totals: slice.totalsByCompany[companyId] ?? emptyAgentTotals() };
}
