import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import { facilityTariffBinding, facilityTariffIdentity } from './facility-tariffs';
import { CONTENT } from '../content/catalog';
import { BATCH_COMMANDS, BATCH_ORDERS, BATCH_ORDER_BY_ID, BATCH_RULES as RULES } from '../content/wave14-batch';
import type { BatchGrant, BatchInvoice, BatchJob, BatchMeter, BatchModelBinding, BatchOrderDefinition, BatchOrderId, BatchScheduler, BatchView, BatchWeekUsage, BatchWorkReceipt } from '../contracts/wave14-batch';
import type { CommandQuote, DomainResult, GameCommand, GameContent, GameState, Invoice, LedgerFact, ModuleContext, ProductsSlice, Rejection, ResourceGrant, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, checkedInteger, formatMoney, formatUnits, mulDiv } from '../core/math';
import { getCompatibleComputePools, getComputePools, getPoolWorkCostRate, getPoolMultiplierBps, poolSupportsWorkload, usesCrossRackTraining } from './compute-pools';
import { inheritedModelRights, modelExecutionHints, modelWorkBps } from './model-runtime';
import { paidPolicyCapabilityBaseline, policyHoldoutReport, policyModelFingerprint, policyReleaseRejection } from './policy-holdouts';

export { BATCH_COMMANDS };
const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message });
const schedulers = (products: Readonly<ProductsSlice>): BatchScheduler[] => Object.values(products.batchSchedulers ?? {});
const jobs = (products: Readonly<ProductsSlice>): BatchJob[] => Object.values(products.batchJobs ?? {});
export const batchJobLive = (job: BatchJob): boolean => job.status === 'active' || job.status === 'paused';
export const batchPlacementAtWeek = (job: BatchJob, week = Infinity): string => job.placementHistory?.filter(item => item.week <= week).at(-1)?.poolId ?? 'auto';
export const batchWorkId = (id: string, kind: 'serve' | 'compute' | 'ml'): string => kind === 'serve' ? `batch-serve:${id}` : `batch-scheduler:${id}:${kind}`;
export const batchScheduler = (state: Readonly<GameState>, companyId = state.playerCompanyId): BatchScheduler | null => state.slices.products.batchSchedulers?.[companyId] ?? null;

export function batchResearchReady(state: Readonly<GameState>, companyId: string, atWeek = state.week): boolean {
  const project = Object.values(state.slices.research.projects).find(item => item.companyId === companyId && item.researchId === RULES.researchId);
  return !!project && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek
    && (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.researchId);
}

/** Admission comes from a real previously settled paid API invoice, not another new market account. */
export function batchPaidProductInvoice(state: Readonly<GameState>, productId: string, companyId = state.playerCompanyId): Invoice | null {
  const product = state.slices.products.offers[productId], usage = state.slices.products.lastUsage[productId];
  const accounts = state.slices.markets.cohorts.filter(item => item.companyId === companyId && item.productId === productId && item.activeWeek <= state.week).reduce((sum, item) => sum + item.count, 0);
  if (!product || product.companyId !== companyId || product.kind !== 'developer-api' || product.status !== 'active' || accounts < 1
    || !usage || usage.paidAccounts < 1 || usage.paidExecutedWork <= 0 || usage.week < state.week - 1) return null;
  return state.slices.products.invoices.find(item => item.id === `invoice:${productId}:${usage.week}` && item.companyId === companyId
    && item.productId === productId && item.contractId === product.contractId && item.billing === 'tokens' && item.accounts === usage.paidAccounts
    && item.amountCents > 0 && item.week === usage.week && state.slices.company.postedFacts[item.id]) ?? null;
}

export function batchModelBinding(state: Readonly<GameState>, modelId: string, content: GameContent = CONTENT): BatchModelBinding | null {
  const model = state.slices.models.versions[modelId];
  if (!model || model.status === 'checkpoint' || policyReleaseRejection(state, modelId) || !inheritedModelRights(state, modelId, content).hosted) return null;
  const report = Object.values(state.slices.models.reports).filter(item => paidPolicyCapabilityBaseline(state, model, item.id, state.week))
    .sort((a, b) => b.week - a.week || a.id.localeCompare(b.id))[0];
  if (!report) return null;
  return { modelId, modelFingerprint: policyModelFingerprint(model), capabilityReportId: report.id,
    policyReportId: policyHoldoutReport(state, modelId)?.id ?? null, hostedRights: true,
    family: model.family, architecture: model.architecture, residentMU: model.residentMU, workBps: modelWorkBps(model) };
}

export function batchMeter(state: Readonly<GameState>, modelId: string, orderId: BatchOrderId): BatchMeter {
  const model = state.slices.models.versions[modelId], order = BATCH_ORDER_BY_ID[orderId];
  const family = FAMILY_SERVING_MULTIPLIER[model.family];
  return { inputTokensPerRequest: order.inputTokensPerRequest, outputTokensPerRequest: order.outputTokensPerRequest,
    workPerRequestCUw: mulDiv((order.inputTokensPerRequest * 200 + order.outputTokensPerRequest * 1000) * family, modelWorkBps(model), 10000),
    memoryMU: checkedAdd(model.residentMU, RULES.jobWorkspaceMU), executionHints: modelExecutionHints(model) };
}

export function batchPlacementRejection(state: Readonly<GameState>, companyId: string, meter: BatchMeter, poolId: string, content: GameContent = CONTENT): Rejection | undefined {
  if (poolId === 'auto') return;
  const pool = getComputePools(state, companyId, content).find(item => item.id === poolId);
  if (!pool || !poolSupportsWorkload(pool, meter.executionHints)) return reject('NOT_READY', 'Choose one of your connected pools supporting this model architecture and inference workload.');
  if (pool.memoryMU < meter.memoryMU || pool.capacityCU <= 0) return reject('MISSING_MEMORY', 'The selected pool needs usable capacity and enough memory for this model and its separate batch workspace.');
}

export function batchModelEligible(state: Readonly<GameState>, modelId: string, orderId: BatchOrderId, companyId = state.playerCompanyId, content: GameContent = CONTENT): boolean {
  const order = BATCH_ORDER_BY_ID[orderId], model = state.slices.models.versions[modelId];
  return !!order && !!model && model.companyId === companyId && model.capabilityBps[order.domain] >= order.minimumScoreBps
    && model.reliabilityBps >= order.minimumReliabilityBps && !!batchModelBinding(state, modelId, content);
}

/** One terminal token invoice, rounded once to whole cents; unfinished requests never earn token revenue. */
export function batchInvoiceAmount(terms: BatchOrderDefinition, completedRequests: number): number {
  const input = BigInt(completedRequests) * BigInt(terms.inputTokensPerRequest) * BigInt(terms.inputPriceCentsPerMillion);
  const output = BigInt(completedRequests) * BigInt(terms.outputTokensPerRequest) * BigInt(terms.outputPriceCentsPerMillion);
  return checkedInteger(Number((input + output) / BigInt(1_000_000)), 'Batch earned invoice');
}

function newBatchJob(state: Readonly<GameState>, command: GameCommand, content: GameContent): BatchJob {
  if (command.payload.kind !== 'accept_batch_job') throw new Error('Expected a batch order acceptance.');
  const p = command.payload, order = BATCH_ORDER_BY_ID[p.orderId], invoice = batchPaidProductInvoice(state, p.productId, command.companyId)!;
  const meter = batchMeter(state, p.modelId, p.orderId), model = batchModelBinding(state, p.modelId, content)!;
  const claim = jobs(state.slices.products).filter(item => item.companyId === command.companyId && item.orderId === p.orderId).length + 1;
  return { id: `batch:${command.id}`, companyId: command.companyId, productId: p.productId, orderId: p.orderId, claim,
    schedulerId: batchScheduler(state, command.companyId)!.id, acceptedWeek: state.week, deadlineWeek: state.week + order.windowWeeks - 1,
    terminalWeek: null, status: 'active', cancellationCommandId: null,
    admission: { publicInvoiceId: invoice.id, publicInvoiceWeek: invoice.week, paidAccounts: invoice.accounts, publicContractId: invoice.contractId },
    model, meter, terms: structuredClone(order), weeklyWorkCapCUw: p.weeklyWorkCapCUw,
    requiredWork: order.requests * meter.workPerRequestCUw, completedWork: 0, physicalWork: 0, completedRequests: 0,
    inputTokens: 0, outputTokens: 0, commercialStaffSpent: 0, workReceipts: {}, latestGrant: null, usageHistory: [],
    quotedCents: batchInvoiceAmount(order, order.requests), invoiceId: null,
    ...(p.poolId !== undefined && p.poolId !== 'auto' ? { placementHistory: [{ commandId: command.id, week: state.week, poolId: p.poolId }] } : {}),
    lastBottleneck: 'The fixed benign backlog uses residual serving allocation after ordinary workloads, with separate commercial supervision.' };
}

export function validateBatchCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload, company = state.slices.company.companies[command.companyId];
  if (!company) return reject('UNKNOWN_COMPANY', 'This company does not exist.');
  if (p.kind !== 'install_batch_scheduler' && p.kind !== 'accept_batch_job' && p.kind !== 'set_batch_job_placement' && p.kind !== 'set_batch_job_paused' && p.kind !== 'cancel_batch_job') return reject('INVALID_COMMAND', 'Choose an implemented batch inference action.');
  if (p.kind === 'set_batch_job_placement') {
    const job = state.slices.products.batchJobs?.[p.jobId];
    if (!job || job.companyId !== command.companyId || !batchJobLive(job) || state.week > job.deadlineWeek) return reject('NOT_READY', 'Choose your unfinished batch order before its original deadline.');
    if (state.queuedCommands.some(item => item.id !== command.id && (item.payload.kind === 'set_batch_job_placement' || item.payload.kind === 'cancel_batch_job') && item.payload.jobId === job.id)) return reject('ALREADY_ACTIVE', 'This batch already has a queued placement or cancellation.');
    if (batchPlacementAtWeek(job) === p.poolId) return reject('ALREADY_ACTIVE', 'This batch already uses that placement choice.');
    return batchPlacementRejection(state, command.companyId, job.meter, p.poolId, content);
  }
  if (p.kind === 'set_batch_job_paused' || p.kind === 'cancel_batch_job') {
    const job = state.slices.products.batchJobs?.[p.jobId];
    if (!job || job.companyId !== command.companyId || !batchJobLive(job) || state.week > job.deadlineWeek) return reject('NOT_READY', 'Choose one of your unfinished batch orders before its original deadline.');
    if (state.queuedCommands.some(item => item.id !== command.id && (item.payload.kind === 'set_batch_job_paused' || item.payload.kind === 'cancel_batch_job') && item.payload.jobId === job.id)) return reject('ALREADY_ACTIVE', 'This batch order already has a queued operating choice.');
    if (p.kind === 'cancel_batch_job') return;
    if (typeof p.paused !== 'boolean') return reject('INVALID_COMMAND', 'Choose whether this batch order should be paused.');
    if ((job.status === 'paused') === p.paused) return reject('ALREADY_ACTIVE', 'This batch order already has that operating state.');
    if (!p.paused && company.arrearsCents) return reject('ARREARS', 'Resolve unpaid expenses before resuming batch execution.');
    return;
  }
  if (company.arrearsCents) return reject('ARREARS', 'Resolve unpaid expenses before installing a scheduler or accepting more batch work.');
  if (p.kind === 'install_batch_scheduler') {
    if (!batchResearchReady(state, command.companyId)) return reject('NOT_READY', 'Complete Enterprise operations (R12) before implementing a batch scheduler.');
    if (batchScheduler(state, command.companyId) || state.queuedCommands.some(item => item.id !== command.id && item.companyId === command.companyId && item.payload.kind === 'install_batch_scheduler')) return reject('ALREADY_ACTIVE', 'Your company already has a batch scheduler or a queued installation.');
    if (schedulers(state.slices.products).length >= RULES.maximumSchedulers) return reject('CAPACITY_EXCEEDED', 'The supported company scheduler history is full.');
    if (!getCompatibleComputePools(state, command.companyId, { workloadKind: 'general' }, content).some(pool => pool.memoryMU >= RULES.schedulerMemoryMU)) return reject('MISSING_MEMORY', 'The scheduler needs one MU in a connected general-work pool for its paid implementation.');
    return;
  }
  const scheduler = batchScheduler(state, command.companyId);
  if (!scheduler || scheduler.status !== 'active' || scheduler.availableWeek === null || scheduler.availableWeek > state.week) return reject('NOT_READY', 'Finish the paid batch scheduler and its next-boundary activation before accepting orders.');
  const order = BATCH_ORDER_BY_ID[p.orderId]; if (!order) return reject('INVALID_COMMAND', 'Choose one of the three authored benign batch orders.');
  if (!RULES.weeklyWorkCapsCUw.includes(p.weeklyWorkCapCUw)) return reject('INVALID_COMMAND', 'Choose a weekly batch work cap of 2, 4, 8 or 16 CUw.');
  if (!batchPaidProductInvoice(state, p.productId, command.companyId)) return reject('NOT_READY', 'Accept batch work through your active Developer API with existing paying accounts and a recent real paid token invoice.');
  const history = jobs(state.slices.products), owned = history.filter(item => item.companyId === command.companyId);
  const queued = state.queuedCommands.filter(item => item.id !== command.id && item.payload.kind === 'accept_batch_job');
  if (history.length + queued.length >= RULES.maximumJobs || owned.length + queued.filter(item => item.companyId === command.companyId).length >= RULES.maximumJobsPerCompany
    || owned.filter(item => item.orderId === p.orderId).length + queued.filter(item => item.companyId === command.companyId && item.payload.kind === 'accept_batch_job' && item.payload.orderId === p.orderId).length >= RULES.maximumClaimsPerOrder) return reject('CAPACITY_EXCEEDED', 'These customers offer three finite orders of each type, nine per company. Completed or cancelled claims remain in the retained history.');
  if (!batchModelEligible(state, p.modelId, p.orderId, command.companyId, content)) return reject('NOT_READY', `${order.name} needs an owned model with its exact paid capability report, hosted-use rights, normal commercial policy admission, ${order.domain} score at least ${order.minimumScoreBps / 100} and reliability at least ${order.minimumReliabilityBps / 100}.`);
  const meter = batchMeter(state, p.modelId, p.orderId);
  const placement = batchPlacementRejection(state, command.companyId, meter, p.poolId ?? 'auto', content);
  if (placement) return placement;
  if (!getCompatibleComputePools(state, command.companyId, meter.executionHints, content).some(pool => pool.memoryMU >= meter.memoryMU)) return reject('MISSING_MEMORY', 'Provide a connected inference-compatible pool with the frozen model and this batch’s separate workspace. Sparse models also need fast fabric.');
  // Best-effort backlog is deliberately absent from recurring serving commitments and their admission forecasts.
}

export function quoteBatchCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): CommandQuote {
  const p = command.payload;
  if (p.kind === 'set_batch_job_placement') {
    const name = getComputePools(state, command.companyId, content).find(pool => pool.id === p.poolId)?.name ?? p.poolId;
    return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: p.poolId === 'auto'
      ? 'Resume automatic pool selection next week. The existing model, work cap, paid progress, token rates and deadline stay fixed. No new capacity is rented.'
      : `Use ${name} for this batch from next week. If it is unavailable or full, the batch waits; it does not fall back to another pool. Existing progress and the original deadline stay fixed. This choice does not reserve extra capacity or add cloud rent.` };
  }
  if (p.kind === 'install_batch_scheduler') return { upfrontCostCents: RULES.schedulerFeeCents, weeklyCostDeltaCents: 0,
    summary: `Pay ${formatMoney(RULES.schedulerFeeCents)} and implement the batch scheduler with 2 development CUw and 40 Design points, at most 1 CUw and 20 Design points per week, with 1 MU of workspace. It activates at the following boundary. Future orders use residual serving allocation after ordinary workloads.` };
  if (p.kind === 'set_batch_job_paused') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: p.paused ? 'Pause future batch GPU and commercial requests next week. Preserve every paid fraction of progress; the original deadline continues.'
      : 'Resume this order next week under its original model, weekly cap, rates and deadline. Its frozen backlog remains separate from mutable public API options.' };
  if (p.kind === 'cancel_batch_job') return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: 'Stop this order next week and settle its one terminal invoice for fully completed requests. Unfinished quoted work receives credit; paid GPU work and the finite order claim remain recorded.' };
  const job = newBatchJob(state, command, content);
  const chosenPool = batchPlacementAtWeek(job);
  const placementNote = chosenPool === 'auto' ? '' : ` Selected pool: ${getComputePools(state, command.companyId, content).find(pool => pool.id === chosenPool)?.name ?? chosenPool}. If unavailable, the job waits; no automatic fallback is used.`;
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0,
    summary: `${job.terms.name}: ${job.terms.requests.toLocaleString('en-US')} benign requests, ${formatUnits(job.requiredWork)} effective CUw and ${formatUnits(job.meter.memoryMU)} separate MU. Begin at acceptance and finish within ${job.terms.windowWeeks} calendar weeks, at most ${formatUnits(job.weeklyWorkCapCUw)} CUw/week with ${usesWorkPointProfiles(state) ? '5 Business points per week' : '0.25 commercial FTE'}; short staffing limits execution. Ordinary workloads run first. The ${formatMoney(job.quotedCents)} quote bills once on completion, deadline or cancellation, using only completed requests at fixed token rates; the unfinished quote is credited. No latency headroom, live API configuration, or public token bill is reused.${placementNote}` };
}

export function applyBatchCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): DomainResult {
  const products = structuredClone(state.slices.products), p = command.payload;
  if (p.kind === 'install_batch_scheduler') {
    products.batchSchedulers ??= {}; products.batchJobs ??= {}; products.batchInvoices ??= [];
    const id = `batch-scheduler:${command.id}`, feeFactId = `batch-scheduler-fee:${command.id}`;
    products.batchSchedulers[command.companyId] = { id, companyId: command.companyId, status: 'building', startedWeek: state.week, completedWeek: null, availableWeek: null,
      feeCents: RULES.schedulerFeeCents, feeFactId, requiredWork: RULES.schedulerWorkCUw, completedWork: 0, physicalWork: 0, memoryMU: RULES.schedulerMemoryMU,
      requiredStaff: RULES.schedulerStaff, completedStaff: 0, workReceipts: {}, latestGrant: null, staffGrantCount: 0, firstStaffWeek: null, latestStaffGrant: null,
      lastBottleneck: 'Development compute and Design points advance this project. The two paid meters advance independently, up to one unit each week.' };
    return { updates: { products }, facts: [{ id: feeFactId, companyId: command.companyId, week: state.week, sourceId: id, category: 'operating',
      amountCents: RULES.schedulerFeeCents, label: 'Batch scheduler implementation', kind: 'expense' }],
      messages: [{ category: 'project', companyId: command.companyId, message: 'Paid batch scheduler implementation started. Its GPU work and ML effort must finish before the next-boundary activation.' }] };
  }
  if (p.kind === 'accept_batch_job') {
    const job = newBatchJob(state, command, content); products.batchJobs![job.id] = job;
    return { updates: { products }, messages: [{ category: 'project', companyId: command.companyId,
      message: `${job.terms.name} accepted with a fixed ${job.terms.requests.toLocaleString('en-US')}-request backlog and Week ${job.deadlineWeek} deadline. The selected model and separate tenant meter are frozen.` }] };
  }
  if (p.kind === 'set_batch_job_placement') {
    const job = products.batchJobs![p.jobId];
    (job.placementHistory ??= []).push({ commandId: command.id, week: state.week, poolId: p.poolId });
    job.lastBottleneck = p.poolId === 'auto' ? 'Automatic pool selection resumes under the original deadline.' : 'The selected connected pool must have enough residual capacity and memory. The original deadline continues.';
    return { updates: { products }, messages: [{ category: 'command', companyId: job.companyId, message: `${job.terms.name}: ${p.poolId === 'auto' ? 'automatic placement restored' : 'connected pool selected'}. Paid progress, work limit and original deadline are preserved.` }] };
  }
  if (p.kind !== 'set_batch_job_paused' && p.kind !== 'cancel_batch_job') return {};
  const job = products.batchJobs![p.jobId];
  if (p.kind === 'set_batch_job_paused') {
    job.status = p.paused ? 'paused' : 'active'; job.lastBottleneck = p.paused ? 'Paused; the original deadline continues.' : 'Resumed under the original frozen model, cap and deadline.';
    return { updates: { products }, messages: [{ category: 'command', companyId: job.companyId, message: `${job.terms.name} ${p.paused ? 'paused' : 'resumed'}. Its original deadline and already-paid progress are unchanged.` }] };
  }
  job.status = 'cancelled'; job.terminalWeek = state.week; job.cancellationCommandId = command.id; job.lastBottleneck = 'Cancelled. Fully completed requests will settle once; unfinished quoted work is credited.';
  return { updates: { products }, messages: [{ category: 'market', companyId: job.companyId, message: `${job.terms.name} cancelled. Its completed request count will produce one final invoice.` }] };
}

export function commitBatch(_state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const scheduler of schedulers(products)) if (scheduler.status === 'ready' && scheduler.availableWeek !== null && scheduler.availableWeek <= ctx.week) {
    scheduler.status = 'active'; scheduler.lastBottleneck = '';
    messages.push({ category: 'delivery', companyId: scheduler.companyId, message: 'The paid batch scheduler is active. Existing paying Developer API customers can now submit the finite benign order backlog.' });
  }
  return messages;
}

export function batchServingRequest(job: BatchJob, week = Infinity): WorkRequest {
  const requested = Math.min(job.weeklyWorkCapCUw, job.requiredWork - job.completedWork);
  return { id: batchWorkId(job.id, 'serve'), companyId: job.companyId, taskId: job.id, category: 'serving',
    normalizedWorkCUw: requested, memoryMU: job.meter.memoryMU, priority: RULES.servingPriorityBase + job.deadlineWeek,
    staffPriority: 60, poolId: batchPlacementAtWeek(job, week), headroomBps: 0, ...job.meter.executionHints,
    staffDemand: [{ role: 'commercial', staffWeeks: RULES.commercialStaffPerWeek }],
    supervision: { role: 'commercial', workPerStaffWeek: mulDiv(requested, U, RULES.commercialStaffPerWeek) } };
}

export function batchRequests(state: Readonly<GameState>, week = state.week): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const scheduler of schedulers(state.slices.products)) {
    if (scheduler.status !== 'building' || state.slices.company.companies[scheduler.companyId].arrearsCents) continue;
    if (scheduler.completedWork < scheduler.requiredWork) requests.push({ id: batchWorkId(scheduler.id, 'compute'), companyId: scheduler.companyId, taskId: scheduler.id,
      category: 'development', normalizedWorkCUw: Math.min(RULES.maximumWeeklySchedulerWorkCUw, scheduler.requiredWork - scheduler.completedWork),
      memoryMU: scheduler.memoryMU, workloadKind: 'general', priority: RULES.schedulerPriority, poolId: 'auto' });
    if (scheduler.completedStaff < scheduler.requiredStaff) requests.push({ id: batchWorkId(scheduler.id, 'ml'), companyId: scheduler.companyId, taskId: scheduler.id,
      category: 'development', normalizedWorkCUw: 0, memoryMU: 0, priority: RULES.schedulerPriority, poolId: 'auto',
      staffDemand: [{ role: 'ml', staffWeeks: Math.min(RULES.maximumWeeklySchedulerStaff, scheduler.requiredStaff - scheduler.completedStaff) }] });
  }
  for (const job of jobs(state.slices.products)) if (job.status === 'active' && job.acceptedWeek <= week && job.deadlineWeek >= week && job.completedWork < job.requiredWork) requests.push(batchServingRequest(job, week));
  return requests;
}

export function batchReceiptKey(receipt: Pick<BatchWorkReceipt, 'hardwareId' | 'ownership' | 'multiplierBps' | 'rateCentsPerCUw' | 'facilityTariff'>): string {
  return canonicalStateHash({ hardwareId: receipt.hardwareId, ownership: receipt.ownership, multiplierBps: receipt.multiplierBps, rateCentsPerCUw: receipt.rateCentsPerCUw, ...facilityTariffIdentity(receipt) });
}

function addWorkReceipt(state: Readonly<GameState>, ctx: ModuleContext, target: BatchJob | BatchScheduler, grant: ResourceGrant, request: WorkRequest, remainingBefore: number): BatchGrant {
  const pool = getComputePools(state, target.companyId, ctx.content, ctx.resources.staffGrants).find(item => item.id === grant.poolId);
  if (!pool || !poolSupportsWorkload(pool, request) || grant.memoryMU !== request.memoryMU || grant.sharedMemoryMU
    || grant.hardwareEffectiveCUw <= 0 || grant.hardwareEffectiveCUw > request.normalizedWorkCUw || grant.physicalCUw <= 0) throw new Error('Batch work lost its compatible pool, separate resident memory or bounded physical grant.');
  const multiplierBps = getPoolMultiplierBps(pool, request.category, usesCrossRackTraining(pool, request.category, grant.physicalCUw, request.memoryMU), ctx.content, request.workloadKind);
  const supplied = request.supervision ? ctx.resources.staffGrants.find(item => item.requestId === request.id)?.grants.find(item => item.role === request.supervision!.role)?.staffWeeks ?? 0 : 0;
  const limit = request.supervision ? Math.min(request.normalizedWorkCUw, mulDiv(supplied, request.supervision.workPerStaffWeek, U)) : request.normalizedWorkCUw;
  if (grant.hardwareEffectiveCUw !== Math.min(limit, mulDiv(grant.physicalCUw, multiplierBps, 10000))) throw new Error('Batch work does not reconcile with its physical hardware conversion and supplied supervision.');
  const tariff = { hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps, rateCentsPerCUw: pool.ownership === 'cloud' ? ctx.content.opening.rentCentsPerCUWeek : getPoolWorkCostRate(pool, request), ...facilityTariffBinding(pool, request) };
  const key = batchReceiptKey(tariff), receipt = target.workReceipts[key] ??= { ...tariff, physicalCUw: 0, effectiveCUw: 0, conversionRemainder: 0, grants: 0, firstWeek: ctx.week, lastWeek: ctx.week };
  if (Object.keys(target.workReceipts).length > RULES.maximumReceiptBuckets) throw new Error('Batch hardware receipt history exceeds its supported bound.');
  receipt.physicalCUw = checkedAdd(receipt.physicalCUw, grant.physicalCUw); receipt.effectiveCUw = checkedAdd(receipt.effectiveCUw, grant.hardwareEffectiveCUw);
  receipt.conversionRemainder = checkedAdd(receipt.conversionRemainder, checkedInteger(Number(BigInt(grant.physicalCUw) * BigInt(multiplierBps) - BigInt(grant.hardwareEffectiveCUw) * BigInt(10000))));
  receipt.grants++; receipt.lastWeek = ctx.week;
  target.completedWork = checkedAdd(target.completedWork, grant.hardwareEffectiveCUw); target.physicalWork = checkedAdd(target.physicalWork, grant.physicalCUw);
  return { week: ctx.week, poolId: grant.poolId, receiptKey: key, remainingBefore, requestedWork: request.normalizedWorkCUw,
    effectiveCUw: grant.hardwareEffectiveCUw, physicalCUw: grant.physicalCUw, memoryMU: grant.memoryMU };
}

export function advanceBatch(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): void {
  const staff = (id: string, role: 'ml' | 'commercial') => ctx.resources.staffGrants.find(item => item.requestId === id)?.grants.find(item => item.role === role)?.staffWeeks ?? 0;
  for (const scheduler of schedulers(products)) {
    if (scheduler.status !== 'building') continue;
    const computeId = batchWorkId(scheduler.id, 'compute'), grant = ctx.resources.computeGrants.find(item => item.requestId === computeId);
    if (grant?.hardwareEffectiveCUw) {
      const request = ctx.resources.requests.find(item => item.id === computeId);
      if (!request) throw new Error('Batch scheduler work has no admitted request.');
      scheduler.latestGrant = addWorkReceipt(state, ctx, scheduler, grant, request, scheduler.requiredWork - scheduler.completedWork);
    }
    const granted = staff(batchWorkId(scheduler.id, 'ml'), 'ml'), remaining = scheduler.requiredStaff - scheduler.completedStaff;
    if (granted < 0 || granted > Math.min(RULES.maximumWeeklySchedulerStaff, remaining)) throw new Error('Batch scheduler exceeds its actual weekly ML grant.');
    if (granted > 0) {
      scheduler.firstStaffWeek ??= ctx.week; scheduler.staffGrantCount++;
      scheduler.latestStaffGrant = { week: ctx.week, remainingBefore: remaining, grantedStaff: granted };
      scheduler.completedStaff = checkedAdd(scheduler.completedStaff, granted);
    }
    scheduler.lastBottleneck = scheduler.completedWork < scheduler.requiredWork && scheduler.completedStaff < scheduler.requiredStaff ? 'Needs development compute and ML staff, independently capped at one unit each week.'
      : scheduler.completedWork < scheduler.requiredWork ? 'ML implementation finished; development GPU work remains.'
        : scheduler.completedStaff < scheduler.requiredStaff ? 'GPU implementation finished; ML work remains.' : '';
  }
  for (const job of jobs(products)) {
    if (!batchJobLive(job) || job.acceptedWeek > ctx.week || job.deadlineWeek < ctx.week || job.usageHistory.some(item => item.week === ctx.week)) continue;
    const paused = job.status === 'paused', completedWorkBefore = job.completedWork, completedRequestsBefore = job.completedRequests;
    const remainingBefore = job.requiredWork - completedWorkBefore, requestedWorkCUw = paused ? 0 : Math.min(job.weeklyWorkCapCUw, remainingBefore);
    const id = batchWorkId(job.id, 'serve'), grant = ctx.resources.computeGrants.find(item => item.requestId === id), staffRequired = paused ? 0 : RULES.commercialStaffPerWeek;
    const staffGranted = staff(id, 'commercial'), supervisedLimitCUw = staffRequired ? mulDiv(requestedWorkCUw, staffGranted, staffRequired) : 0;
    if (staffGranted < 0 || staffGranted > staffRequired || (grant?.hardwareEffectiveCUw ?? 0) > supervisedLimitCUw) throw new Error('Batch execution exceeded its independent commercial supervision or ran while paused.');
    let actual: BatchGrant | null = null;
    if (grant?.hardwareEffectiveCUw) {
      const request = ctx.resources.requests.find(item => item.id === id);
      if (!request || request.normalizedWorkCUw !== requestedWorkCUw) throw new Error('Batch execution has no matching capped resource request.');
      actual = addWorkReceipt(state, ctx, job, grant, request, remainingBefore); job.latestGrant = actual;
    }
    job.completedRequests = mulDiv(job.completedWork, 1, job.meter.workPerRequestCUw);
    job.inputTokens = job.completedRequests * job.meter.inputTokensPerRequest; job.outputTokens = job.completedRequests * job.meter.outputTokensPerRequest;
    job.commercialStaffSpent = checkedAdd(job.commercialStaffSpent, staffGranted);
    const completedRequests = job.completedRequests - completedRequestsBefore;
    const selectedPoolReason = batchPlacementAtWeek(job, ctx.week) !== 'auto'
      ? state.slices.compute.fleets[job.companyId].lastGrants.find(item => item.requestId === id)?.reason : undefined;
    const explanation = paused ? 'Paused; paid partial progress is retained and the original deadline continues.'
      : !staffGranted ? 'No commercial supervision was available for batch execution.'
        : !actual ? selectedPoolReason || 'No residual compatible serving capacity and full workspace were available after ordinary workloads.'
          : actual.effectiveCUw < requestedWorkCUw ? 'Partial batch progress: residual serving capacity or commercial supervision limited this week.' : 'The requested batch work executed after ordinary workloads.';
    const usage: BatchWeekUsage = { week: ctx.week, paused, remainingBefore, requestedWorkCUw, executedWorkCUw: actual?.effectiveCUw ?? 0,
      physicalWorkCUw: actual?.physicalCUw ?? 0, poolId: actual?.poolId ?? null, receiptKey: actual?.receiptKey ?? null, memoryMU: actual?.memoryMU ?? 0,
      staffRequired, staffGranted, supervisedLimitCUw, completedWorkBefore, completedWorkAfter: job.completedWork,
      completedRequestsBefore, completedRequestsAfter: job.completedRequests, completedRequests,
      inputTokens: completedRequests * job.meter.inputTokensPerRequest, outputTokens: completedRequests * job.meter.outputTokensPerRequest, explanation };
    job.usageHistory.push(usage); job.lastBottleneck = actual?.effectiveCUw === requestedWorkCUw && !paused ? '' : explanation;
  }
}

export function resolveBatch(_state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const scheduler of schedulers(products)) if (scheduler.status === 'building' && scheduler.completedWork === scheduler.requiredWork && scheduler.completedStaff === scheduler.requiredStaff) {
    scheduler.status = 'ready'; scheduler.completedWeek = ctx.week; scheduler.availableWeek = ctx.week + 1;
    scheduler.lastBottleneck = 'Implementation finished; the batch scheduler activates at the following weekly boundary.';
    messages.push({ category: 'project', companyId: scheduler.companyId, message: 'Batch scheduler GPU and ML work finished. Activation arrives next week.' });
  }
  for (const job of jobs(products)) if (batchJobLive(job)) {
    if (job.completedWork === job.requiredWork) {
      job.status = 'completed'; job.terminalWeek = ctx.week; job.lastBottleneck = 'The fixed backlog is complete; all requests settle in one terminal invoice.';
      messages.push({ category: 'delivery', companyId: job.companyId, message: `${job.terms.name}: all ${job.completedRequests.toLocaleString('en-US')} requests finished before the inclusive deadline.` });
    } else if (ctx.week >= job.deadlineWeek) {
      job.status = 'expired'; job.terminalWeek = job.deadlineWeek; job.lastBottleneck = 'The original deadline ended. Fully completed requests are billed once; the unfinished quote is credited.';
      messages.push({ category: 'market', companyId: job.companyId, message: `${job.terms.name}: its fixed deadline arrived with ${job.completedRequests.toLocaleString('en-US')} complete requests. Unfinished work receives credit.` });
    }
  }
  return messages;
}

export function settleBatch(state: Readonly<GameState>, products: ProductsSlice, ctx: ModuleContext): LedgerFact[] {
  const facts: LedgerFact[] = [];
  for (const job of jobs(products)) {
    if (batchJobLive(job) || job.terminalWeek !== ctx.week) continue;
    const id = `batch-invoice:${job.id}`;
    if (job.invoiceId || products.batchInvoices?.some(item => item.id === id) || state.slices.company.postedFacts[id]) continue;
    const amountCents = batchInvoiceAmount(job.terms, job.completedRequests), reason = job.status === 'completed' ? 'completed' : job.status === 'expired' ? 'deadline' : 'cancelled';
    const invoice: BatchInvoice = { id, jobId: job.id, companyId: job.companyId, productId: job.productId, orderId: job.orderId, week: ctx.week, reason,
      modelId: job.model.modelId, modelFingerprint: job.model.modelFingerprint, requestedRequests: job.terms.requests,
      completedRequests: job.completedRequests, inputTokens: job.inputTokens, outputTokens: job.outputTokens,
      grossCents: job.quotedCents, creditsCents: job.quotedCents - amountCents, amountCents };
    products.batchInvoices ??= []; products.batchInvoices.push(invoice); job.invoiceId = id;
    facts.push({ id, companyId: job.companyId, week: ctx.week, sourceId: job.id, category: 'revenue', amountCents,
      label: `${job.terms.name}: completed batch requests after unfinished-work credit`, kind: 'receipt' });
  }
  return facts;
}

/** Physical-work tariff estimate, not an allocation of settled company ledger cents. */
export function batchTariffEstimateCents(item: Pick<BatchJob | BatchScheduler, 'workReceipts'>): number {
  return Number(Object.values(item.workReceipts).reduce((sum, receipt) => sum + BigInt(receipt.physicalCUw) * BigInt(receipt.rateCentsPerCUw), BigInt(0)) / BigInt(U));
}

export function getBatchView(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT): BatchView {
  const owned = jobs(state.slices.products).filter(job => job.companyId === companyId), live = owned.filter(batchJobLive), active = live.filter(job => job.status === 'active');
  return { researched: batchResearchReady(state, companyId), scheduler: batchScheduler(state, companyId),
    products: Object.values(state.slices.products.offers).filter(product => product.companyId === companyId && product.kind === 'developer-api').map(product => {
      const invoice = batchPaidProductInvoice(state, product.id, companyId);
      return { id: product.id, name: product.name, status: product.status, paidAccounts: invoice?.accounts ?? 0, available: !!invoice };
    }),
    models: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId && model.status !== 'checkpoint').map(model => ({ id: model.id,
      name: model.name, family: model.family, architecture: model.architecture, residentMU: model.residentMU,
      eligibleOrders: BATCH_ORDERS.filter(order => batchModelEligible(state, model.id, order.id, companyId, content)).map(order => order.id) })),
    board: BATCH_ORDERS.map(order => { const acceptedClaims = owned.filter(job => job.orderId === order.id).length;
      return { ...order, acceptedClaims, remainingClaims: RULES.maximumClaimsPerOrder - acceptedClaims, quotedCents: batchInvoiceAmount(order, order.requests) }; }),
    jobs: owned, invoices: (state.slices.products.batchInvoices ?? []).filter(invoice => invoice.companyId === companyId), activeJobs: live.length,
    remainingWorkCUw: live.reduce((sum, job) => checkedAdd(sum, job.requiredWork - job.completedWork), 0),
    requestedWeeklyCapCUw: active.reduce((sum, job) => checkedAdd(sum, Math.min(job.weeklyWorkCapCUw, job.requiredWork - job.completedWork)), 0),
    maximumCommercialStaff: active.length * RULES.commercialStaffPerWeek };
}
import { usesWorkPointProfiles } from './workforce';
