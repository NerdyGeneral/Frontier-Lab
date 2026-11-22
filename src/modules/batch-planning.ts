import { CONTENT } from '../content/catalog';
import { BATCH_ORDER_BY_ID, BATCH_RULES } from '../content/wave14-batch';
import type { BatchJob } from '../contracts/wave14-batch';
import type { BatchPlacementForecast, BatchPlacementForecastOptions, BatchPlacementForecastRow, BatchPlacementPoolOption, BatchPlacementScenario, BatchPlanningCapacity } from '../contracts/wave16-planning';
import type { ComputePool, DomainModule, GameContent, GameState, ModuleContext, ResourceFrame, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import { freezeDeep } from '../core/canonical';
import { createDefaultModules } from '../core/foundation-modules';
import { checkedAdd, checkedInteger, formatUnits, mulDiv } from '../core/math';
import { batchInvoiceAmount, batchJobLive, batchMeter, batchModelBinding, batchModelEligible, batchPaidProductInvoice, batchRequests, batchScheduler, batchServingRequest, batchWorkId } from './batch-inference';
import { createComputeModule } from './compute';
import { getComputePools, getPoolWorkCostRate, getPoolWorkCapacityCU, poolSupportsWorkload } from './compute-pools';

const MAXIMUM_HORIZON = 6;
const ASSUMPTIONS = [
  'This is a conditional comparison of the next service weeks through the original inclusive deadline, not a promise of delivery. Each batch uses one connected compatible pool; memory and capacity at different sites or hardware classes cannot be added together.',
  'Ordinary workload requests are captured from the next-week reserve handlers and repeat unchanged. They include live products, named services, agents, training, evaluations, research, infrastructure work and research assistance. These projects do not finish or change stages in the comparison.',
  'Only ready staff and available hardware count. Queued commands, future hires, deliveries, commissioning, new rollouts and automatic model releases are excluded. Apply changes and compare again.',
  'Existing paid accounts and the trial load due next week stay fixed. Named-service load repeats across later term boundaries without promising renewal. Acquisition, churn, competition and changing model, routing, cache or guardrail settings are not predicted.',
  'All accepted batch jobs compete with their current caps, pauses and placements. Only their finite work progresses; completed jobs and expired deadlines release their later requests. A paused job stays paused. Other actions or new orders can change the result.',
  'The real staff allocator runs before the real GPU allocator. Batch handling keeps its existing priority before acquisition, and batch GPU work remains after ordinary work. Development and research allocations stay reserved; no allocation, staff, hardware or discount is supplied by the comparison.',
  'Projected bills include earlier completed requests but earn tokens only from whole completed requests. Future owned usage and attributed cloud work use actual projected physical grants and current tariffs; they are estimates before shared cent rounding, not posted ledger entries.',
  'Attributed cloud work is already part of reservation rent, not an additional usage bill. Extra reservation cost is the full positive increase in company cloud rent for the entire comparison horizon, even if a job finishes earlier. Existing rent, payroll, fixed upkeep, construction and prior work are separate; lowering a reservation is shown in its weekly price, not counted as job profit.',
  'Continued operation assumes that weekly bills remain funded. Cash balances and future arrears are not projected; the batch invoice arrives only when the job finishes, expires or is cancelled.',
  'Every comparison is read-only: it spends nothing, reserves nothing, draws no randomness and changes no saved progress. Admission and capacity commands still need their normal validation at the weekly boundary.',
] as const;

const emptyResources = (): ResourceFrame => ({ requests: [], staffGrants: [], computeGrants: [] });
const context = (week: number, content: GameContent, resources: ResourceFrame): ModuleContext => ({
  week, phase: 'reserve', content, facts: [], resources,
  random: { draw: () => { throw new Error('Batch planning must not draw simulation randomness.'); } },
});
const safeQuantity = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

function capacityOf(state: Readonly<GameState>, content: GameContent): BatchPlanningCapacity {
  const fleet = state.slices.compute.fleets[state.playerCompanyId];
  return { cloudCU: fleet.cloudCU, ownedCU: fleet.ownedCU, servingCU: fleet.allocation.serving,
    developmentCU: fleet.allocation.development, researchCU: fleet.allocation.research,
    cloudRentCentsPerWeek: mulDiv(fleet.cloudCU, content.opening.rentCentsPerCUWeek, U) };
}

function selectedCapacity(state: Readonly<GameState>, options: BatchPlacementForecastOptions, content: GameContent) {
  const current = capacityOf(state, content), cloudCU = options.cloudCU ?? current.cloudCU, servingCU = options.servingCU ?? current.servingCU;
  const selected = { ...current, cloudCU: safeQuantity(cloudCU) ? cloudCU : current.cloudCU,
    servingCU: safeQuantity(servingCU) ? servingCU : current.servingCU,
    cloudRentCentsPerWeek: safeQuantity(cloudCU) && cloudCU <= content.firstSale.maxCloudCU
      ? mulDiv(cloudCU, content.opening.rentCentsPerCUWeek, U) : current.cloudRentCentsPerWeek };
  if (!safeQuantity(cloudCU) || cloudCU % U || cloudCU > content.firstSale.maxCloudCU) return { selected, reason: 'Choose whole general-cloud CU between zero and ' + formatUnits(content.firstSale.maxCloudCU) + '.' };
  if (!safeQuantity(servingCU) || !Number.isSafeInteger(servingCU + current.developmentCU + current.researchCU)
    || servingCU + current.developmentCU + current.researchCU > cloudCU + current.ownedCU) return { selected, reason: 'Serving, development and research allocations must fit the proposed rented and installed nominal capacity.' };
  const companyId = state.playerCompanyId, fleet = state.slices.compute.fleets[companyId];
  const proposed = { ...state, queuedCommands: [], slices: { ...state.slices, compute: { ...state.slices.compute,
    fleets: { ...state.slices.compute.fleets, [companyId]: { ...fleet, allocation: { ...fleet.allocation, serving: servingCU } } } } } };
  // Match the existing live-product memory guard while allowing the proposed
  // serving allocation to shrink atomically with the reservation. Queue and
  // unchanged-value gates belong to the eventual command, not this comparison.
  const rejection = createComputeModule(content).validateCommand!(proposed, {
    id: 'batch-capacity-comparison', companyId, issuedForWeek: state.week + 1, payload: { kind: 'set_cloud_capacity', cu: cloudCU },
  }, content);
  return { selected, reason: rejection?.message ?? null };
}

function withCapacity(state: Readonly<GameState>, selected: BatchPlanningCapacity): GameState {
  const copy = structuredClone(state), fleet = copy.slices.compute.fleets[state.playerCompanyId];
  fleet.cloudCU = selected.cloudCU;
  fleet.allocation.serving = selected.servingCU;
  // Historical reports are not allocation inputs. Avoid copying their bounded
  // evidence again for every hypothetical grant; the source stays untouched.
  delete copy.slices.compute.costReports;
  return copy;
}

function forecastJob(state: Readonly<GameState>, options: BatchPlacementForecastOptions, content: GameContent): { job: BatchJob | null; reason: string | null } {
  const companyId = state.playerCompanyId;
  if (options.jobId !== undefined) {
    const job = state.slices.products.batchJobs?.[options.jobId];
    return job && job.companyId === companyId && batchJobLive(job) && job.deadlineWeek > state.week
      ? { job: structuredClone(job), reason: null }
      : { job: null, reason: 'Choose an unfinished owned batch with at least one service week remaining.' };
  }
  const order = options.orderId ? BATCH_ORDER_BY_ID[options.orderId] : undefined;
  const product = options.productId ? state.slices.products.offers[options.productId] : undefined;
  const cap = options.weeklyWorkCapCUw;
  if (!order || !options.modelId || cap === undefined || !BATCH_RULES.weeklyWorkCapsCUw.includes(cap)) {
    return { job: null, reason: 'Choose an order, an evaluated model and a weekly cap of 2, 4, 8 or 16 CUw to compare placement.' };
  }
  if (!product || product.companyId !== companyId || product.kind !== 'developer-api') return { job: null, reason: 'Choose one of your Developer API products for the prospective batch.' };
  if (!batchModelEligible(state, options.modelId, order.id, companyId, content)) return { job: null, reason: 'Choose an owned model with the paid reports, hosted rights and capability required by this order.' };
  const scheduler = batchScheduler(state, companyId);
  if (!scheduler || scheduler.status !== 'active' || scheduler.availableWeek === null || scheduler.availableWeek > state.week) return { job: null, reason: 'Finish the paid batch scheduler before comparing a new order.' };
  const meter = batchMeter(state, options.modelId, order.id), model = batchModelBinding(state, options.modelId, content)!;
  const invoice = batchPaidProductInvoice(state, product.id, companyId);
  const acceptedWeek = state.week + 1, id = 'batch:command-' + state.nextId;
  // This transient record only supplies the real allocator's job ownership and
  // demand contract. It is never validated as an accepted order or persisted;
  // public customer eligibility and finite claims remain command admission gates.
  const job: BatchJob = { id, companyId, productId: product.id, orderId: order.id,
    claim: Object.values(state.slices.products.batchJobs ?? {}).filter(item => item.companyId === companyId && item.orderId === order.id).length + 1,
    schedulerId: scheduler.id, acceptedWeek, deadlineWeek: acceptedWeek + order.windowWeeks - 1,
    terminalWeek: null, status: 'active', cancellationCommandId: null,
    admission: { publicInvoiceId: invoice?.id ?? 'unadmitted-batch-comparison', publicInvoiceWeek: invoice?.week ?? state.week,
      paidAccounts: invoice?.accounts ?? 0, publicContractId: product.contractId },
    model, meter, terms: structuredClone(order), weeklyWorkCapCUw: cap,
    requiredWork: checkedInteger(order.requests * meter.workPerRequestCUw), completedWork: 0, physicalWork: 0,
    completedRequests: 0, inputTokens: 0, outputTokens: 0, commercialStaffSpent: 0,
    workReceipts: {}, latestGrant: null, usageHistory: [], quotedCents: batchInvoiceAmount(order, order.requests), invoiceId: null, lastBottleneck: '',
  };
  return { job, reason: null };
}

/** Capture each real reserve handler once; only batch progress changes afterward. */
function frozenRequests(state: GameState, modules: readonly DomainModule[], content: GameContent): { state: GameState; ordinary: WorkRequest[] } {
  let local = state;
  const resources = emptyResources();
  for (const module of modules) {
    const reserve = module.handlers.reserve;
    if (!reserve) continue;
    const result = reserve(freezeDeep(local), context(state.week + 1, content, resources));
    if (result.updates) local = { ...local, slices: { ...local.slices, ...result.updates } };
    resources.requests.push(...(result.workRequests ?? []));
  }
  return { state: local, ordinary: resources.requests.filter(request => request.companyId === state.playerCompanyId && !request.id.startsWith('batch-serve:')) };
}

function poolOption(pool: ComputePool, job: BatchJob): BatchPlacementPoolOption {
  const compatible = poolSupportsWorkload(pool, job.meter.executionHints);
  const reason = !compatible ? 'This pool does not support the captured model architecture, inference workload or required fast fabric.'
    : pool.capacityCU <= 0 ? pool.bottleneck || 'This pool currently has no usable capacity.'
      : pool.memoryMU < job.meter.memoryMU ? 'The full model and separate batch workspace need ' + formatUnits(job.meter.memoryMU) + ' MU in this one pool.'
        : null;
  return { poolId: pool.id, poolName: pool.name, ownership: pool.ownership, compatible: compatible && reason === null, reason,
    nominalCU: pool.nominalCU, capacityCU: getPoolWorkCapacityCU(pool, { category: 'serving' }), memoryMU: pool.memoryMU,
    servingMultiplierBps: pool.servingBps, variableCentsPerCUw: getPoolWorkCostRate(pool, { category: 'serving' }) };
}

function comparePool(base: GameState, ordinary: readonly WorkRequest[], targetId: string, option: BatchPlacementPoolOption,
  horizonWeeks: number, extraRentCents: number, modules: readonly DomainModule[], content: GameContent): BatchPlacementScenario {
  const jobs = Object.fromEntries(Object.entries(base.slices.products.batchJobs ?? {}).map(([id, job]) => [id, { ...job }]));
  const local = { ...base, slices: { ...base.slices, products: { ...base.slices.products, batchJobs: jobs } } };
  const target = jobs[targetId], company = modules.find(module => module.id === 'company')!, compute = modules.find(module => module.id === 'compute')!;
  const rows: BatchPlacementForecastRow[] = [];
  let completionWeek: number | null = null;
  for (let offset = 1; offset <= horizonWeeks; offset++) {
    const week = base.week + offset;
    const batches = batchRequests(local, week).filter(request => request.companyId === base.playerCompanyId && request.id.startsWith('batch-serve:'))
      .map(request => request.taskId === targetId ? { ...request, poolId: option.poolId } : request);
    const resources: ResourceFrame = { requests: [...ordinary, ...batches], staffGrants: [], computeGrants: [] };
    // The original source week freezes staff readiness. Merely projecting a
    // later calendar row must not finish onboarding or commission hardware.
    resources.staffGrants = company.grantResources!(local, context(base.week, content, resources)).staffGrants ?? [];
    const result = compute.grantResources!(local, context(base.week, content, resources));
    resources.computeGrants = result.computeGrants ?? [];
    const pools = getComputePools(local, base.playerCompanyId, content, resources.staffGrants);
    const id = batchWorkId(targetId, 'serve'), request = batches.find(item => item.id === id);
    const grant = resources.computeGrants.find(item => item.requestId === id);
    const actualPool = grant && (grant.physicalCUw || grant.memoryMU) ? pools.find(item => item.id === grant.poolId) : undefined;
    const staffGranted = resources.staffGrants.find(item => item.requestId === id)?.grants.find(item => item.role === 'commercial')?.staffWeeks ?? 0;
    const before = target.completedRequests;
    for (const job of Object.values(jobs)) {
      if (job.companyId !== base.playerCompanyId || !batchJobLive(job) || job.acceptedWeek > week || job.deadlineWeek < week) continue;
      const supplied = resources.computeGrants.find(item => item.requestId === batchWorkId(job.id, 'serve'))?.hardwareEffectiveCUw ?? 0;
      job.completedWork = checkedAdd(job.completedWork, supplied);
      job.completedRequests = mulDiv(job.completedWork, 1, job.meter.workPerRequestCUw);
      if (job.completedWork === job.requiredWork) {
        job.status = 'completed'; job.terminalWeek = week;
        if (job.id === targetId) completionWeek = week;
      } else if (week === job.deadlineWeek) { job.status = 'expired'; job.terminalWeek = week; }
    }
    const effectiveWorkCUw = grant?.hardwareEffectiveCUw ?? 0, physicalWorkCUw = grant?.physicalCUw ?? 0;
    const rawReason = result.updates?.compute?.fleets[base.playerCompanyId].lastGrants.find(item => item.requestId === id)?.reason ?? '';
    const paused = !request && target.status !== 'completed' && completionWeek === null;
    const bottleneck = !request ? completionWeek !== null ? 'Completed earlier; the comparison keeps the selected cloud reservation through its full horizon.'
      : 'Paused; the original deadline continues and no handling or GPU work is requested.'
      : !staffGranted ? 'No commercial handling is available after earlier staff commitments.'
        : effectiveWorkCUw < request.normalizedWorkCUw && staffGranted < BATCH_RULES.commercialStaffPerWeek ? 'Commercial handling limits the requested batch work.'
          : rawReason || (effectiveWorkCUw < request.normalizedWorkCUw ? option.reason || 'Residual compatible capacity or connected memory limits this batch.' : '');
    rows.push({ week, paused, requestedWorkCUw: request?.normalizedWorkCUw ?? 0, effectiveWorkCUw, physicalWorkCUw,
      completedRequests: target.completedRequests - before, cumulativeRequests: target.completedRequests, cumulativeWorkCUw: target.completedWork,
      actualPoolId: actualPool?.id ?? null, actualPoolName: actualPool?.name ?? null,
      staffRequested: request ? BATCH_RULES.commercialStaffPerWeek : 0, staffGranted,
      memoryMU: grant?.memoryMU ?? 0, bottleneck,
      ownedVariableCents: actualPool?.ownership === 'owned' ? mulDiv(physicalWorkCUw, getPoolWorkCostRate(actualPool, { category: 'serving' }), U) : 0,
      cloudWorkRentCents: actualPool?.ownership === 'cloud' ? mulDiv(physicalWorkCUw, content.opening.rentCentsPerCUWeek, U) : 0 });
  }
  const total = (pick: (row: BatchPlacementForecastRow) => number) => rows.reduce((sum, row) => checkedAdd(sum, pick(row)), 0);
  const projectedInvoiceCents = batchInvoiceAmount(target.terms, target.completedRequests);
  return { poolId: option.poolId, poolName: option.poolName, compatible: option.compatible,
    reason: option.reason ?? (completionWeek === null ? rows.find(row => row.bottleneck)?.bottleneck || 'The remaining workload exceeds what this cap can complete before the original deadline.' : null),
    rows, completionWeek, completedRequests: target.completedRequests, remainingRequests: target.terms.requests - target.completedRequests,
    projectedInvoiceCents, projectedCreditsCents: target.quotedCents - projectedInvoiceCents,
    effectiveWorkCUw: total(row => row.effectiveWorkCUw), physicalWorkCUw: total(row => row.physicalWorkCUw),
    commercialStaffWeeks: total(row => row.staffGranted), ownedVariableCents: total(row => row.ownedVariableCents),
    cloudWorkRentCents: total(row => row.cloudWorkRentCents), additionalCloudReservationCents: extraRentCents };
}

/**
 * Bounded, allocation-backed planning only. No coordinator tick, market turn,
 * completion handler, command, payment or random draw is executed.
 */
export function getBatchPlacementForecast(state: Readonly<GameState>, options: BatchPlacementForecastOptions = {}, content: GameContent = CONTENT): BatchPlacementForecast {
  const currentCapacity = capacityOf(state, content), selection = selectedCapacity(state, options, content);
  const selected = forecastJob(state, options, content), target = selected.job;
  const horizonWeeks = target ? Math.max(0, Math.min(MAXIMUM_HORIZON, target.deadlineWeek - state.week)) : 0;
  const result: BatchPlacementForecast = {
    available: false, reason: selection.reason ?? selected.reason, sourceWeek: state.week, startWeek: state.week + 1, horizonWeeks,
    jobId: target?.id ?? null, jobName: target?.terms.name ?? '', deadlineWeek: target?.deadlineWeek ?? null,
    requiredWorkCUw: target?.requiredWork ?? 0, completedWorkCUw: target?.completedWork ?? 0, quotedCents: target?.quotedCents ?? 0,
    currentPlacementPoolId: target ? batchServingRequest(target).poolId : 'auto', paused: target?.status === 'paused',
    currentCapacity, selectedCapacity: selection.selected, capacityPlanValid: selection.reason === null, capacityPlanReason: selection.reason,
    poolOptions: [], scenarios: [], assumptions: state.queuedCommands.some(command => command.companyId === state.playerCompanyId)
      ? ['There are queued company changes. This comparison excludes them; apply the queue and compare again before relying on its result.', ...ASSUMPTIONS] : ASSUMPTIONS,
  };
  if (!target || selection.reason || !horizonWeeks) return result;
  const prepared = withCapacity(state, selection.selected);
  prepared.slices.products.batchJobs = { ...prepared.slices.products.batchJobs, [target.id]: target };
  const modules = createDefaultModules(content), captured = frozenRequests(prepared, modules, content);
  const resources: ResourceFrame = { requests: [...captured.ordinary, ...batchRequests(captured.state, state.week + 1).filter(request => request.companyId === state.playerCompanyId && request.id.startsWith('batch-serve:'))], staffGrants: [], computeGrants: [] };
  resources.staffGrants = modules.find(module => module.id === 'company')!.grantResources!(captured.state, context(state.week, content, resources)).staffGrants ?? [];
  const pools = getComputePools(captured.state, state.playerCompanyId, content, resources.staffGrants);
  const explicit = pools.map(pool => poolOption(pool, target)).sort((a, b) => a.ownership === b.ownership ? a.poolId.localeCompare(b.poolId) : a.ownership === 'cloud' ? -1 : 1);
  const usable = explicit.some(option => option.compatible);
  const automatic: BatchPlacementPoolOption = { poolId: 'auto', poolName: 'Automatic placement', ownership: 'auto', compatible: usable,
    reason: usable ? null : 'No currently usable pool fits this model and its separate workspace.', nominalCU: 0, capacityCU: 0, memoryMU: 0,
    servingMultiplierBps: null, variableCentsPerCUw: null };
  result.poolOptions = [automatic, ...explicit];
  if (!result.poolOptions.some(option => option.poolId === result.currentPlacementPoolId)) result.poolOptions.push({
    poolId: result.currentPlacementPoolId, poolName: 'Unavailable selected pool', ownership: 'unavailable', compatible: false,
    reason: 'This selected pool is no longer present. The batch waits until its placement is changed or capacity returns; there is no automatic fallback.',
    nominalCU: 0, capacityCU: 0, memoryMU: 0, servingMultiplierBps: null, variableCentsPerCUw: null,
  });
  const extraRentCents = Math.max(0, selection.selected.cloudRentCentsPerWeek - currentCapacity.cloudRentCentsPerWeek) * horizonWeeks;
  result.scenarios = result.poolOptions.map(option => comparePool(captured.state, captured.ordinary, target.id, option, horizonWeeks, extraRentCents, modules, content));
  result.available = true; result.reason = null;
  return result;
}
