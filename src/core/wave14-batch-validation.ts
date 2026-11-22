import { assertFacilityTariffGrant, validatedFacilityRate } from '../modules/facility-tariffs';
import { CONTENT } from '../content/catalog';
import { CHIP_RULES, chipDesignValues } from '../content/wave4-hardware';
import { BATCH_ORDER_BY_ID, BATCH_RULES as RULES } from '../content/wave14-batch';
import type { CommandPayload, GameContent, GameState, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { BatchGrant, BatchInvoice, BatchJob, BatchScheduler, BatchWeekUsage, BatchWorkReceipt } from '../contracts/wave14-batch';
import { batchInvoiceAmount, batchJobLive, batchMeter, batchPlacementAtWeek, batchReceiptKey, batchResearchReady, batchServingRequest, batchWorkId } from '../modules/batch-inference';
import { getPoolMultiplierBps, poolSupportsWorkload, usesCrossRackTraining } from '../modules/compute-pools';
import { inheritedModelRights, modelWorkBps } from '../modules/model-runtime';
import { paidPolicyCapabilityBaseline, policyHoldoutReport, policyModelFingerprint, policyReleaseRejection } from '../modules/policy-holdouts';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);
const record = (value: unknown, label: string): void => check(!!value && typeof value === 'object' && !Array.isArray(value), `${label} must be a record.`);
function identifier(value: unknown, label: string): void {
  check(typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\u0000-\u001f\u007f]/.test(value)
    && !['__proto__', 'constructor', 'prototype'].includes(value), `${label} is invalid.`);
}
function hash(value: unknown, label: string): void { check(typeof value === 'string' && /^[a-f0-9]{8}$/.test(value), `${label} is invalid.`); }
function description(value: unknown, label: string): void { check(typeof value === 'string' && value.length <= 2000 && !/[\u0000-\u001f\u007f]/.test(value), `${label} is invalid.`); }
function exactKeys(value: object, keys: readonly string[], label: string): void {
  check(Object.keys(value).sort().join() === [...keys].sort().join(), `${label} contains an unknown or missing field.`);
}

export function assertBatchCommand(payload: CommandPayload): void {
  if (payload.kind === 'install_batch_scheduler') exactKeys(payload, ['kind'], 'Batch scheduler command');
  else if (payload.kind === 'accept_batch_job') {
    exactKeys(payload, ['kind', 'productId', 'orderId', 'modelId', 'weeklyWorkCapCUw', ...(payload.poolId !== undefined ? ['poolId'] : [])], 'Batch acceptance command');
    if (payload.poolId !== undefined) identifier(payload.poolId, 'Batch pool');
    identifier(payload.productId, 'Batch source API'); identifier(payload.modelId, 'Batch model');
    check(Object.hasOwn(BATCH_ORDER_BY_ID, payload.orderId), 'Batch order is unknown.');
    check(RULES.weeklyWorkCapsCUw.includes(payload.weeklyWorkCapCUw), 'Batch work cap must be 2, 4, 8 or 16 CUw.');
  } else if (payload.kind === 'set_batch_job_placement') {
    exactKeys(payload, ['kind', 'jobId', 'poolId'], 'Batch placement command'); identifier(payload.jobId, 'Batch job'); identifier(payload.poolId, 'Batch pool');
  } else if (payload.kind === 'set_batch_job_paused') {
    exactKeys(payload, ['kind', 'jobId', 'paused'], 'Batch pause command'); identifier(payload.jobId, 'Batch job');
    check(typeof payload.paused === 'boolean', 'Batch pause choice is invalid.');
  } else if (payload.kind === 'cancel_batch_job') {
    exactKeys(payload, ['kind', 'jobId'], 'Batch cancellation command'); identifier(payload.jobId, 'Batch job');
  }
}

function assertTariff(state: GameState, target: BatchScheduler | BatchJob, receipt: BatchWorkReceipt, job: boolean, content: GameContent): void {
  if (receipt.ownership === 'cloud') {
    check(receipt.hardwareId === 'general' && receipt.multiplierBps === 10000 && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, target.companyId, content.opening.rentCentsPerCUWeek, receipt.firstWeek, receipt.lastWeek, { category: job ? 'serving' : 'development' }),
      'Batch cloud work changed its general hardware conversion or reservation tariff.');
    if (job) check((target as BatchJob).model.architecture !== 'sparse', 'Sparse batch work cannot run on cloud without fast fabric.');
    return;
  }
  check(receipt.ownership === 'owned', 'Batch hardware ownership is invalid.');
  const hardware = content.hardware.find(item => item.id === receipt.hardwareId);
  if (hardware) {
    const base = Math.round((job ? hardware.servingMultiplier : hardware.trainingMultiplier) * 10000);
    const multipliers = job ? [base] : [base, mulDiv(base, content.infrastructure.crossRackTrainingBps, 10000), mulDiv(base, CHIP_RULES.fabricCrossRackBps, 10000)];
    check(multipliers.includes(receipt.multiplierBps) && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, target.companyId, hardware.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: job ? 'serving' : 'development' }),
      'Batch owned hardware conversion or variable tariff is not authored.');
  } else {
    const design = state.slices.compute.chipDesigns?.[receipt.hardwareId];
    check(job && design?.companyId === target.companyId && design.status === 'validated' && design.spec.target === 'inference'
      && design.spec.architecture === (target as BatchJob).model.architecture && design.prototypeRun?.readyWeek !== null
      && design.prototypeRun?.readyWeek !== undefined && design.prototypeRun.readyWeek <= receipt.firstWeek,
    'Batch work used an incompatible custom chip or a design without earlier paid prototype qualification.');
    const values = chipDesignValues(design!);
    check(receipt.multiplierBps === values.servingBps && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, target.companyId, values.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: job ? 'serving' : 'development' }),
      'Batch custom-chip conversion or variable tariff changed.');
  }
}

function assertWorkReceipts(state: GameState, target: BatchScheduler | BatchJob, job: boolean, content: GameContent): void {
  record(target.workReceipts, 'Batch lifetime hardware receipts'); const receipts = Object.entries(target.workReceipts);
  check(receipts.length <= RULES.maximumReceiptBuckets, 'Batch hardware receipt buckets exceed their supported bound.');
  const started = job ? (target as BatchJob).acceptedWeek : (target as BatchScheduler).startedWeek;
  const cap = job ? (target as BatchJob).weeklyWorkCapCUw : RULES.maximumWeeklySchedulerWorkCUw;
  let effective = 0, physical = 0, grants = 0;
  for (const [key, receipt] of receipts) {
    record(receipt, 'Batch hardware receipt');
    exactKeys(receipt, ['hardwareId', 'ownership', 'multiplierBps', 'rateCentsPerCUw', 'physicalCUw', 'effectiveCUw', 'conversionRemainder', 'grants', 'firstWeek', 'lastWeek', ...(Object.hasOwn(receipt, 'facilityTariff') ? ['facilityTariff'] : [])], 'Batch hardware receipt');
    hash(key, 'Batch hardware tariff key'); identifier(receipt.hardwareId, 'Batch hardware');
    check(batchReceiptKey(receipt) === key, 'Batch lifetime receipt changed its tariff identity.');
    for (const value of [receipt.multiplierBps, receipt.rateCentsPerCUw, receipt.physicalCUw, receipt.effectiveCUw, receipt.conversionRemainder, receipt.grants, receipt.firstWeek, receipt.lastWeek]) checkedInteger(value, 'Batch hardware quantity');
    check(receipt.multiplierBps > 0 && receipt.physicalCUw > 0 && receipt.effectiveCUw > 0 && receipt.grants > 0
      && receipt.firstWeek >= started && receipt.lastWeek >= receipt.firstWeek && receipt.lastWeek <= state.week
      && receipt.grants <= receipt.lastWeek - receipt.firstWeek + 1 && receipt.effectiveCUw <= receipt.grants * cap,
    'Batch GPU progress exceeds its elapsed grants or weekly work cap.');
    assertTariff(state, target, receipt, job, content);
    check(BigInt(receipt.physicalCUw) * BigInt(receipt.multiplierBps) === BigInt(receipt.effectiveCUw) * BigInt(10000) + BigInt(receipt.conversionRemainder)
      && BigInt(receipt.conversionRemainder) < BigInt(Math.max(receipt.multiplierBps, 10000)) * BigInt(receipt.grants),
    'Batch effective work does not reconcile with physical GPU grants and bounded integer conversion.');
    effective = checkedAdd(effective, receipt.effectiveCUw); physical = checkedAdd(physical, receipt.physicalCUw); grants += receipt.grants;
  }
  check(effective === target.completedWork && physical === target.physicalWork && grants <= state.week - started + 1,
    'Batch lifetime work differs from the actual hardware receipts.');
  if (target.latestGrant === null) {
    check(effective === 0 && physical === 0 && receipts.length === 0, 'Batch work has no actual latest GPU grant.'); return;
  }
  const latest = target.latestGrant;
  record(latest, 'Batch latest GPU grant'); exactKeys(latest, ['week', 'poolId', 'receiptKey', 'remainingBefore', 'requestedWork', 'effectiveCUw', 'physicalCUw', 'memoryMU'], 'Batch latest GPU grant');
  identifier(latest.poolId, 'Batch GPU pool'); hash(latest.receiptKey, 'Batch latest tariff key');
  for (const value of [latest.week, latest.remainingBefore, latest.requestedWork, latest.effectiveCUw, latest.physicalCUw, latest.memoryMU]) checkedInteger(value, 'Batch latest grant quantity');
  const receipt = target.workReceipts[latest.receiptKey], memory = job ? (target as BatchJob).meter.memoryMU : (target as BatchScheduler).memoryMU;
  if (receipt) assertFacilityTariffGrant(state, receipt, target.companyId, latest.poolId, latest.week, { category: job ? 'serving' : 'development' }, content);
  check(receipt && latest.week === receipt.lastWeek && latest.week === Math.max(...receipts.map(([, item]) => item.lastWeek))
    && latest.remainingBefore <= target.requiredWork && latest.requestedWork === Math.min(cap, latest.remainingBefore)
    && latest.effectiveCUw > 0 && latest.effectiveCUw <= latest.requestedWork && latest.effectiveCUw <= receipt.effectiveCUw
    && latest.physicalCUw > 0 && latest.physicalCUw <= receipt.physicalCUw && latest.memoryMU === memory
    && target.completedWork === target.requiredWork - latest.remainingBefore + latest.effectiveCUw,
  'Batch latest GPU grant exceeds its actual work, remaining request or separate resident workspace.');
  if (grants === 1) check(latest.remainingBefore === target.requiredWork && latest.effectiveCUw === effective && latest.physicalCUw === physical
    && receipt.firstWeek === latest.week, 'A batch first GPU grant invented earlier physical work or useful progress.');
  if (!job) check(latest.effectiveCUw === Math.min(latest.requestedWork, mulDiv(latest.physicalCUw, receipt!.multiplierBps, 10000)),
    'Batch scheduler physical work did not produce its reported useful progress.');
}

function assertPlacement(state: GameState, target: BatchScheduler | BatchJob, poolId: string, receipt: BatchWorkReceipt, week: number, job: boolean, content: GameContent = CONTENT): void {
  assertFacilityTariffGrant(state, receipt, target.companyId, poolId, week, { category: job ? 'serving' : 'development' }, content);
  if (receipt.ownership === 'cloud') { check(poolId === 'general-cloud', 'Batch cloud grant belongs to a different pool.'); return; }
  check(poolId.startsWith('owned:') && poolId.endsWith(`:${receipt.hardwareId}`), 'Batch owned pool identity does not match its retained hardware.');
  const location = poolId.slice('owned:'.length, -(`:${receipt.hardwareId}`).length);
  check(location === 'colocation' || state.slices.compute.facilities[location]?.companyId === target.companyId, 'Batch work came from another company’s site.');
  if (job && (target as BatchJob).model.architecture === 'sparse') check(Object.values(state.slices.compute.fabricProjects).some(item => item.companyId === target.companyId
    && item.location === location && item.status === 'active' && item.readyWeek !== null && item.readyWeek <= week), 'Sparse batch service lacks fast fabric at its actual serving location.');
}

function assertScheduler(state: GameState, companyId: string, scheduler: BatchScheduler, content: GameContent): void {
  record(scheduler, 'Batch scheduler');
  exactKeys(scheduler, ['id', 'companyId', 'status', 'startedWeek', 'completedWeek', 'availableWeek', 'feeCents', 'feeFactId', 'requiredWork', 'completedWork', 'physicalWork', 'memoryMU',
    'requiredStaff', 'completedStaff', 'workReceipts', 'latestGrant', 'staffGrantCount', 'firstStaffWeek', 'latestStaffGrant', 'lastBottleneck'], 'Batch scheduler');
  for (const value of [companyId, scheduler.id, scheduler.companyId, scheduler.feeFactId]) identifier(value, 'Batch scheduler identity');
  const commandId = scheduler.id.startsWith('batch-scheduler:') ? scheduler.id.slice('batch-scheduler:'.length) : '', command = state.commandReceipts[commandId];
  checkedInteger(scheduler.startedWeek, 'Batch scheduler start');
  check(scheduler.companyId === companyId && state.slices.company.companies[companyId] && command?.status === 'accepted' && command.week === scheduler.startedWeek
    && scheduler.startedWeek <= state.week && batchResearchReady(state, companyId, scheduler.startedWeek - 1),
  'Batch scheduler lacks its accepted command, company or prior Enterprise operations research.');
  check(['building', 'ready', 'active'].includes(scheduler.status), 'Batch scheduler status is invalid.'); description(scheduler.lastBottleneck, 'Batch scheduler explanation');
  for (const value of [scheduler.feeCents, scheduler.requiredWork, scheduler.completedWork, scheduler.physicalWork, scheduler.memoryMU, scheduler.requiredStaff, scheduler.completedStaff, scheduler.staffGrantCount]) checkedInteger(value, 'Batch scheduler quantity');
  check(scheduler.feeCents === RULES.schedulerFeeCents && scheduler.feeFactId === `batch-scheduler-fee:${commandId}` && state.slices.company.postedFacts[scheduler.feeFactId] === true
    && scheduler.requiredWork === RULES.schedulerWorkCUw && scheduler.requiredStaff === RULES.schedulerStaff && scheduler.memoryMU === RULES.schedulerMemoryMU
    && scheduler.completedWork <= scheduler.requiredWork && scheduler.completedStaff <= scheduler.requiredStaff,
  'Batch scheduler changed its paid fee, implementation effort, workspace or progress.');
  const fee = state.slices.company.ledger.find(item => item.id === scheduler.feeFactId);
  if (fee) check(fee.companyId === companyId && fee.sourceId === scheduler.id && fee.week === scheduler.startedWeek && fee.kind === 'expense' && fee.category === 'operating' && fee.amountCents === scheduler.feeCents,
    'Batch scheduler fee differs from its retained operating expense.');
  assertWorkReceipts(state, scheduler, false, content);
  if (scheduler.latestStaffGrant === null) check(scheduler.completedStaff === 0 && scheduler.firstStaffWeek === null && scheduler.staffGrantCount === 0, 'Batch scheduler ML progress has no actual staff receipt.');
  else {
    const latest = scheduler.latestStaffGrant; record(latest, 'Batch scheduler ML receipt'); exactKeys(latest, ['week', 'remainingBefore', 'grantedStaff'], 'Batch scheduler ML receipt');
    checkedInteger(scheduler.firstStaffWeek!, 'Batch scheduler first ML week');
    for (const value of [latest.week, latest.remainingBefore, latest.grantedStaff]) checkedInteger(value, 'Batch scheduler ML quantity');
    check(scheduler.firstStaffWeek! >= scheduler.startedWeek && latest.week >= scheduler.firstStaffWeek! && latest.week <= state.week
      && scheduler.staffGrantCount > 0 && scheduler.staffGrantCount <= latest.week - scheduler.firstStaffWeek! + 1
      && scheduler.completedStaff >= scheduler.staffGrantCount && scheduler.completedStaff <= scheduler.staffGrantCount * RULES.maximumWeeklySchedulerStaff
      && latest.remainingBefore <= scheduler.requiredStaff && latest.grantedStaff > 0 && latest.grantedStaff <= Math.min(RULES.maximumWeeklySchedulerStaff, latest.remainingBefore)
      && scheduler.completedStaff === scheduler.requiredStaff - latest.remainingBefore + latest.grantedStaff,
    'Batch scheduler ML progress exceeds its actual elapsed grants or weekly cap.');
    if (scheduler.staffGrantCount === 1) check(scheduler.firstStaffWeek === latest.week && latest.remainingBefore === scheduler.requiredStaff,
      'A batch scheduler’s first paid ML grant invented earlier implementation effort.');
    const reports = state.slices.compute.costReports?.[companyId] ?? [];
    const covered = reports.filter(item => item.week >= scheduler.firstStaffWeek! && item.week <= latest.week);
    if (covered.length === latest.week - scheduler.firstStaffWeek! + 1) {
      const amounts = covered.map(item => item.resources.staffGrants.find(grant => grant.requestId === batchWorkId(scheduler.id, 'ml'))?.grants.find(grant => grant.role === 'ml')?.staffWeeks ?? 0);
      check(amounts.reduce((sum, amount) => checkedAdd(sum, amount), 0) === scheduler.completedStaff
        && amounts.filter(amount => amount > 0).length === scheduler.staffGrantCount,
      'Batch scheduler cumulative ML effort differs from its fully retained paid staff history.');
    }
    const cost = state.slices.compute.costReports?.[companyId]?.find(item => item.week === latest.week);
    if (cost) {
      const id = batchWorkId(scheduler.id, 'ml'), request = cost.resources.requests.find(item => item.id === id);
      const supplied = cost.resources.staffGrants.find(item => item.requestId === id)?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
      check(request?.taskId === scheduler.id && request.companyId === companyId && request.normalizedWorkCUw === 0 && request.memoryMU === 0
        && request.priority === RULES.schedulerPriority && request.staffPriority === undefined && request.staffDemand?.length === 1
        && request.staffDemand[0].role === 'ml' && request.staffDemand[0].staffWeeks === Math.min(RULES.maximumWeeklySchedulerStaff, latest.remainingBefore)
        && supplied === latest.grantedStaff, 'Batch scheduler ML receipt differs from its actual settled staff request.');
    }
  }
  const latest = scheduler.latestGrant;
  if (latest) {
    const receipt = scheduler.workReceipts[latest.receiptKey]; assertPlacement(state, scheduler, latest.poolId, receipt, latest.week, false, content);
    const firstWeek = Math.min(...Object.values(scheduler.workReceipts).map(item => item.firstWeek));
    const covered = (state.slices.compute.costReports?.[companyId] ?? []).filter(item => item.week >= firstWeek && item.week <= latest.week);
    if (covered.length === latest.week - firstWeek + 1) {
      const grants = covered.flatMap(item => item.resources.computeGrants.filter(grant => grant.requestId === batchWorkId(scheduler.id, 'compute') && grant.hardwareEffectiveCUw > 0));
      check(grants.reduce((sum, grant) => checkedAdd(sum, grant.hardwareEffectiveCUw), 0) === scheduler.completedWork
        && grants.reduce((sum, grant) => checkedAdd(sum, grant.physicalCUw), 0) === scheduler.physicalWork
        && grants.length === Object.values(scheduler.workReceipts).reduce((sum, item) => sum + item.grants, 0),
      'Batch scheduler cumulative GPU effort differs from its fully retained physical resource history.');
    }
    if (latest.week === state.week) {
      const actual = state.slices.compute.fleets[companyId].lastGrants.find(item => item.requestId === batchWorkId(scheduler.id, 'compute'));
      check(actual?.requestedWork === latest.requestedWork && actual.grantedWork === latest.effectiveCUw, 'Batch scheduler progress differs from the actual current shared GPU grant.');
    }
    const cost = state.slices.compute.costReports?.[companyId]?.find(item => item.week === latest.week);
    if (cost) {
      const id = batchWorkId(scheduler.id, 'compute'), request = cost.resources.requests.find(item => item.id === id), grant = cost.resources.computeGrants.find(item => item.requestId === id);
      const pool = cost.pools.find(item => item.id === latest.poolId);
      check(request?.taskId === scheduler.id && request.companyId === companyId && request.category === 'development' && request.workloadKind === 'general'
        && request.priority === RULES.schedulerPriority && request.staffPriority === undefined && request.normalizedWorkCUw === latest.requestedWork && request.memoryMU === scheduler.memoryMU
        && !request.sharedAdapterMemory && !request.supervision && grant?.hardwareEffectiveCUw === latest.effectiveCUw && grant.physicalCUw === latest.physicalCUw
        && grant.memoryMU === scheduler.memoryMU && !grant.sharedMemoryMU && grant.poolId === latest.poolId && pool && poolSupportsWorkload(pool, request)
        && pool.hardwareId === receipt.hardwareId && pool.ownership === receipt.ownership
        && getPoolMultiplierBps(pool, 'development', usesCrossRackTraining(pool, 'development', latest.physicalCUw, scheduler.memoryMU), content, 'general') === receipt.multiplierBps,
      'Batch scheduler GPU progress differs from its retained actual compatible resource frame.');
    }
  }
  const finished = scheduler.completedWork === scheduler.requiredWork && scheduler.completedStaff === scheduler.requiredStaff;
  if (scheduler.status === 'building') check(!finished && scheduler.completedWeek === null && scheduler.availableWeek === null, 'Unfinished batch scheduler gained completion evidence.');
  else {
    checkedInteger(scheduler.completedWeek!, 'Batch scheduler completion'); checkedInteger(scheduler.availableWeek!, 'Batch scheduler availability');
    check(finished && scheduler.completedWeek! >= scheduler.startedWeek + 1 && scheduler.completedWeek! <= state.week
      && scheduler.completedWeek === Math.max(scheduler.latestGrant!.week, scheduler.latestStaffGrant!.week) && scheduler.availableWeek === scheduler.completedWeek! + 1
      && (scheduler.status === 'ready' ? scheduler.availableWeek === state.week + 1 : scheduler.availableWeek! <= state.week),
    'Batch scheduler activation skipped paid work, staff chronology or the following weekly boundary.');
  }
}

function assertModel(state: GameState, job: BatchJob, content: GameContent): void {
  const binding = job.model;
  record(binding, 'Batch model binding'); exactKeys(binding, ['modelId', 'modelFingerprint', 'capabilityReportId', 'policyReportId', 'hostedRights', 'family', 'architecture', 'residentMU', 'workBps'], 'Batch model binding');
  identifier(binding.modelId, 'Batch model'); identifier(binding.capabilityReportId, 'Batch capability report'); hash(binding.modelFingerprint, 'Batch model fingerprint');
  checkedInteger(binding.residentMU, 'Batch resident weights'); checkedInteger(binding.workBps, 'Batch inference work scaling');
  const model = state.slices.models.versions[binding.modelId], order = BATCH_ORDER_BY_ID[job.orderId];
  check(model?.companyId === job.companyId && model.status !== 'checkpoint' && binding.modelFingerprint === policyModelFingerprint(model)
    && binding.family === model.family && binding.architecture === model.architecture && binding.residentMU === model.residentMU && binding.workBps === modelWorkBps(model)
    && binding.hostedRights === true && inheritedModelRights(state, model.id, content).hosted
    && model.capabilityBps[order.domain] >= order.minimumScoreBps && model.reliabilityBps >= order.minimumReliabilityBps
    && paidPolicyCapabilityBaseline(state, model, binding.capabilityReportId, job.acceptedWeek - 1),
  'Batch admission changed its exact owned model, prior paid evaluation, required quality or inherited hosted-use rights.');
  const policy = policyHoldoutReport(state, model.id);
  if (binding.policyReportId !== null) {
    identifier(binding.policyReportId, 'Batch policy report');
    check(policy?.id === binding.policyReportId && policy.week < job.acceptedWeek, 'Batch policy evidence was not the exact paid report available at admission.');
  }
  check(!policyReleaseRejection(state, model.id) && (!model.policy || binding.policyReportId !== null), 'Batch hosting bypassed the source model’s commercial policy gate.');
  record(job.meter, 'Batch frozen tenant meter');
  exactKeys(job.meter, ['inputTokensPerRequest', 'outputTokensPerRequest', 'workPerRequestCUw', 'memoryMU', 'executionHints'], 'Batch frozen tenant meter');
  check(same(job.meter, batchMeter(state, model.id, job.orderId)), 'Batch meter changed its fixed token workload, model-only scaling or separate resident workspace.');
}

function assertUsage(state: GameState, job: BatchJob, usage: BatchWeekUsage, index: number, content: GameContent): void {
  record(usage, 'Batch weekly progress');
  exactKeys(usage, ['week', 'paused', 'remainingBefore', 'requestedWorkCUw', 'executedWorkCUw', 'physicalWorkCUw', 'poolId', 'receiptKey', 'memoryMU', 'staffRequired', 'staffGranted',
    'supervisedLimitCUw', 'completedWorkBefore', 'completedWorkAfter', 'completedRequestsBefore', 'completedRequestsAfter', 'completedRequests', 'inputTokens', 'outputTokens', 'explanation'], 'Batch weekly progress');
  for (const value of [usage.week, usage.remainingBefore, usage.requestedWorkCUw, usage.executedWorkCUw, usage.physicalWorkCUw, usage.memoryMU, usage.staffRequired, usage.staffGranted,
    usage.supervisedLimitCUw, usage.completedWorkBefore, usage.completedWorkAfter, usage.completedRequestsBefore, usage.completedRequestsAfter, usage.completedRequests, usage.inputTokens, usage.outputTokens]) checkedInteger(value, 'Batch weekly quantity');
  check(typeof usage.paused === 'boolean', 'Batch historical pause choice is invalid.'); description(usage.explanation, 'Batch weekly explanation');
  const previous = index ? job.usageHistory[index - 1] : null;
  check(usage.week === job.acceptedWeek + index && usage.week <= state.week && usage.week <= job.deadlineWeek
    && usage.completedWorkBefore === (previous?.completedWorkAfter ?? 0) && usage.completedRequestsBefore === (previous?.completedRequestsAfter ?? 0)
    && usage.remainingBefore === job.requiredWork - usage.completedWorkBefore && usage.remainingBefore > 0
    && usage.requestedWorkCUw === (usage.paused ? 0 : Math.min(job.weeklyWorkCapCUw, usage.remainingBefore))
    && usage.staffRequired === (usage.paused ? 0 : RULES.commercialStaffPerWeek) && usage.staffGranted <= usage.staffRequired
    && usage.supervisedLimitCUw === (usage.staffRequired ? mulDiv(usage.requestedWorkCUw, usage.staffGranted, usage.staffRequired) : 0)
    && usage.executedWorkCUw <= usage.supervisedLimitCUw && usage.completedWorkAfter === usage.completedWorkBefore + usage.executedWorkCUw
    && usage.completedWorkAfter <= job.requiredWork,
  'Batch weekly progress skipped time, reset paid work, exceeded its cap or ran without supplied commercial supervision.');
  check(usage.completedRequestsBefore === mulDiv(usage.completedWorkBefore, 1, job.meter.workPerRequestCUw)
    && usage.completedRequestsAfter === mulDiv(usage.completedWorkAfter, 1, job.meter.workPerRequestCUw)
    && usage.completedRequests === usage.completedRequestsAfter - usage.completedRequestsBefore
    && usage.inputTokens === usage.completedRequests * job.meter.inputTokensPerRequest && usage.outputTokens === usage.completedRequests * job.meter.outputTokensPerRequest,
  'Batch weekly token earnings lost partial-request carry or invented whole completed requests.');
  if (usage.executedWorkCUw === 0) check(usage.physicalWorkCUw === 0 && usage.memoryMU === 0 && usage.poolId === null && usage.receiptKey === null,
    'Batch zero progress has an invented GPU receipt or resident workspace.');
  else {
    identifier(usage.poolId, 'Batch serving pool'); hash(usage.receiptKey, 'Batch serving tariff');
    const receipt = job.workReceipts[usage.receiptKey!];
    check(receipt && usage.week >= receipt.firstWeek && usage.week <= receipt.lastWeek && usage.physicalWorkCUw > 0 && usage.memoryMU === job.meter.memoryMU
      && usage.executedWorkCUw === Math.min(usage.supervisedLimitCUw, mulDiv(usage.physicalWorkCUw, receipt.multiplierBps, 10000)),
    'Batch weekly effective work differs from physical GPU conversion, staff-limited rounding or separate memory.');
    assertPlacement(state, job, usage.poolId!, receipt, usage.week, true, content);
  }
  const expected: WorkRequest = batchServingRequest({ ...job, completedWork: usage.completedWorkBefore }, usage.week);
  check(!usage.executedWorkCUw || expected.poolId === 'auto' || usage.poolId === expected.poolId, 'Batch work ignored its selected connected pool.');
  if (usage.week === state.week) {
    const actual = state.slices.compute.fleets[job.companyId].lastGrants.find(item => item.requestId === expected.id);
    check(usage.paused ? !actual : actual?.requestedWork === usage.requestedWorkCUw && actual.grantedWork === usage.executedWorkCUw,
      'Batch progress differs from the actual current capped shared-allocator grant.');
    if (batchJobLive(job)) check(usage.paused === (job.status === 'paused'), 'The current batch operating choice differs from its actual service week.');
  }
  const cost = state.slices.compute.costReports?.[job.companyId]?.find(item => item.week === usage.week);
  if (cost) {
    const request = cost.resources.requests.find(item => item.id === expected.id), grant = cost.resources.computeGrants.find(item => item.requestId === expected.id);
    const staff = cost.resources.staffGrants.find(item => item.requestId === expected.id);
    if (usage.paused) check(!request && !grant && !staff, 'Paused batch work appeared in an actual paid resource frame.');
    else {
      check(request && same(request, expected) && request.staffPriority === 60 && request.priority === RULES.servingPriorityBase + job.deadlineWeek
        && grant?.hardwareEffectiveCUw === usage.executedWorkCUw && grant.physicalCUw === usage.physicalWorkCUw && !grant.sharedMemoryMU
        && (staff?.grants.find(item => item.role === 'commercial')?.staffWeeks ?? 0) === usage.staffGranted,
      'Batch history changed its low GPU priority, commercial priority, cap, actual work or linked staff allocation.');
      if (usage.executedWorkCUw) {
        const receipt = job.workReceipts[usage.receiptKey!], pool = cost.pools.find(item => item.id === usage.poolId);
        check(pool && poolSupportsWorkload(pool, expected) && pool.hardwareId === receipt.hardwareId && pool.ownership === receipt.ownership
          && pool.servingBps === receipt.multiplierBps && grant!.poolId === usage.poolId && grant!.memoryMU === job.meter.memoryMU,
        'Batch historical service came from an incompatible pool or borrowed another tenant’s resident memory.');
      }
    }
  }
}

function assertJob(state: GameState, key: string, job: BatchJob, content: GameContent): void {
  record(job, 'Batch job');
  exactKeys(job, ['id', 'companyId', 'productId', 'orderId', 'claim', 'schedulerId', 'acceptedWeek', 'deadlineWeek', 'terminalWeek', 'status', 'cancellationCommandId', 'admission', 'model', 'meter', 'terms',
    'weeklyWorkCapCUw', 'requiredWork', 'completedWork', 'physicalWork', 'completedRequests', 'inputTokens', 'outputTokens', 'commercialStaffSpent', 'workReceipts', 'latestGrant', 'usageHistory', 'quotedCents', 'invoiceId', 'lastBottleneck', ...(job.placementHistory !== undefined ? ['placementHistory'] : [])], 'Batch job');
  for (const value of [key, job.id, job.companyId, job.productId, job.schedulerId]) identifier(value, 'Batch identity');
  const commandId = key.startsWith('batch:') ? key.slice('batch:'.length) : '', command = state.commandReceipts[commandId], scheduler = state.slices.products.batchSchedulers?.[job.companyId];
  const product = state.slices.products.offers[job.productId], order = BATCH_ORDER_BY_ID[job.orderId];
  for (const value of [job.claim, job.acceptedWeek, job.deadlineWeek, job.weeklyWorkCapCUw, job.requiredWork, job.completedWork, job.physicalWork,
    job.completedRequests, job.inputTokens, job.outputTokens, job.commercialStaffSpent, job.quotedCents]) checkedInteger(value, 'Batch contract quantity');
  check(key === job.id && state.slices.company.companies[job.companyId] && product?.companyId === job.companyId && product.kind === 'developer-api'
    && command?.status === 'accepted' && command.week === job.acceptedWeek && job.acceptedWeek > product.createdWeek && job.acceptedWeek <= state.week
    && scheduler?.id === job.schedulerId && scheduler.status === 'active' && scheduler.availableWeek !== null && scheduler.availableWeek < job.acceptedWeek,
  'Batch order lacks its accepted command, existing owned API or previously completed paid scheduler.');
  check(order && same(job.terms, order) && job.claim >= 1 && job.claim <= RULES.maximumClaimsPerOrder
    && job.deadlineWeek === job.acceptedWeek + order.windowWeeks - 1 && RULES.weeklyWorkCapsCUw.includes(job.weeklyWorkCapCUw),
  'Batch order changed its finite claim, frozen terms, original inclusive deadline or admitted weekly work cap.');
  check(['active', 'paused', 'completed', 'expired', 'cancelled'].includes(job.status), 'Batch status is invalid.'); description(job.lastBottleneck, 'Batch explanation');
  if (job.placementHistory !== undefined) {
    check(Array.isArray(job.placementHistory) && job.placementHistory.length > 0 && job.placementHistory.length <= order.windowWeeks, 'Batch placement history must fit its finite delivery window.');
    let previousWeek = job.acceptedWeek - 1, previousPool = 'auto';
    const usedCommands = new Set<string>();
    for (const choice of job.placementHistory) {
      record(choice, 'Batch placement'); exactKeys(choice, ['commandId', 'week', 'poolId'], 'Batch placement');
      identifier(choice.commandId, 'Batch placement command'); identifier(choice.poolId, 'Batch pool'); checkedInteger(choice.week, 'Batch placement week');
      const receipt = state.commandReceipts[choice.commandId];
      check(choice.week > previousWeek && choice.week >= job.acceptedWeek && choice.week <= Math.min(state.week, job.deadlineWeek, job.terminalWeek ?? state.week)
        && choice.poolId !== previousPool && !usedCommands.has(choice.commandId) && receipt?.status === 'accepted' && receipt.week === choice.week
        && (choice.week !== job.acceptedWeek || choice.commandId === commandId)
        && (choice.poolId === 'auto' || choice.poolId === 'general-cloud' || choice.poolId.startsWith('owned:')),
      'Batch placement lost its boundary command, order, selected pool or fixed delivery window.');
      usedCommands.add(choice.commandId); previousWeek = choice.week; previousPool = choice.poolId;
    }
  }
  record(job.admission, 'Batch paid customer admission'); exactKeys(job.admission, ['publicInvoiceId', 'publicInvoiceWeek', 'paidAccounts', 'publicContractId'], 'Batch paid customer admission');
  identifier(job.admission.publicInvoiceId, 'Batch source paid invoice'); identifier(job.admission.publicContractId, 'Batch source public contract');
  checkedInteger(job.admission.publicInvoiceWeek, 'Batch source invoice week'); checkedInteger(job.admission.paidAccounts, 'Batch admitted paid accounts');
  check(job.admission.publicInvoiceWeek === job.acceptedWeek - 1 && job.admission.paidAccounts > 0 && job.admission.paidAccounts <= 400
    && job.admission.publicInvoiceId === `invoice:${job.productId}:${job.admission.publicInvoiceWeek}` && job.admission.publicContractId === product.contractId
    && state.slices.company.postedFacts[job.admission.publicInvoiceId] === true,
  'Batch demand was not admitted from a prior real paid Developer API invoice.');
  const sourceInvoice = state.slices.products.invoices.find(item => item.id === job.admission.publicInvoiceId);
  if (sourceInvoice) check(sourceInvoice.companyId === job.companyId && sourceInvoice.productId === job.productId && sourceInvoice.contractId === job.admission.publicContractId
    && sourceInvoice.week === job.admission.publicInvoiceWeek && sourceInvoice.accounts === job.admission.paidAccounts && sourceInvoice.amountCents > 0 && sourceInvoice.billing === 'tokens',
  'Batch paid customer admission differs from its retained public token invoice.');
  assertModel(state, job, content);
  check(job.requiredWork === order.requests * job.meter.workPerRequestCUw && job.completedWork <= job.requiredWork
    && job.completedRequests === mulDiv(job.completedWork, 1, job.meter.workPerRequestCUw) && job.completedRequests <= order.requests
    && job.inputTokens === job.completedRequests * job.meter.inputTokensPerRequest && job.outputTokens === job.completedRequests * job.meter.outputTokensPerRequest
    && job.quotedCents === batchInvoiceAmount(order, order.requests), 'Batch workload, cumulative token counts or frozen quote changed.');
  check(Array.isArray(job.usageHistory) && job.usageHistory.length <= order.windowWeeks, 'Batch service history exceeds its finite calendar window.');
  assertWorkReceipts(state, job, true, content);
  job.usageHistory.forEach((usage, index) => assertUsage(state, job, usage, index, content));
  const last = job.usageHistory.at(-1), actual = job.usageHistory.filter(item => item.executedWorkCUw > 0);
  check((last?.completedWorkAfter ?? 0) === job.completedWork && (last?.completedRequestsAfter ?? 0) === job.completedRequests
    && job.usageHistory.reduce((sum, item) => checkedAdd(sum, item.physicalWorkCUw), 0) === job.physicalWork
    && job.usageHistory.reduce((sum, item) => checkedAdd(sum, item.staffGranted), 0) === job.commercialStaffSpent,
  'Batch lifetime progress or commercial effort differs from its retained actual calendar receipts.');
  for (const [key, receipt] of Object.entries(job.workReceipts)) {
    const grants = actual.filter(item => item.receiptKey === key);
    check(grants.length === receipt.grants && grants[0]?.week === receipt.firstWeek && grants.at(-1)?.week === receipt.lastWeek
      && grants.reduce((sum, item) => checkedAdd(sum, item.executedWorkCUw), 0) === receipt.effectiveCUw
      && grants.reduce((sum, item) => checkedAdd(sum, item.physicalWorkCUw), 0) === receipt.physicalCUw,
    'Batch lifetime tariff receipts lost, duplicated or fabricated a weekly physical grant.');
  }
  const latest = actual.at(-1);
  const expected: BatchGrant | null = latest ? { week: latest.week, poolId: latest.poolId!, receiptKey: latest.receiptKey!, remainingBefore: latest.remainingBefore,
    requestedWork: latest.requestedWorkCUw, effectiveCUw: latest.executedWorkCUw, physicalCUw: latest.physicalWorkCUw, memoryMU: latest.memoryMU } : null;
  check(same(job.latestGrant, expected), 'Batch latest physical grant differs from its last actual execution.');
  if (batchJobLive(job)) check(job.terminalWeek === null && job.cancellationCommandId === null && job.invoiceId === null && job.completedWork < job.requiredWork
    && state.week < job.deadlineWeek && job.usageHistory.length === state.week - job.acceptedWeek + 1, 'Live batch order lost a calendar receipt, exceeded its deadline or settled early.');
  else {
    checkedInteger(job.terminalWeek!, 'Batch terminal week');
    check(job.terminalWeek! >= job.acceptedWeek && job.terminalWeek! <= state.week && job.terminalWeek! <= job.deadlineWeek
      && job.invoiceId === `batch-invoice:${job.id}`, 'Batch terminal date or once-only invoice identity changed.');
    if (job.status === 'cancelled') {
      identifier(job.cancellationCommandId, 'Batch cancellation command'); const cancellation = state.commandReceipts[job.cancellationCommandId!];
      check(cancellation?.status === 'accepted' && cancellation.week === job.terminalWeek && job.terminalWeek! > job.acceptedWeek
        && job.completedWork < job.requiredWork && job.usageHistory.length === job.terminalWeek! - job.acceptedWeek,
      'Batch cancellation lacks its accepted command or executed again after stopping.');
    } else {
      check(job.cancellationCommandId === null && job.usageHistory.length === job.terminalWeek! - job.acceptedWeek + 1,
        'Completed or expired batch work changed its calendar receipts or cancellation identity.');
      if (job.status === 'completed') check(job.completedWork === job.requiredWork && last?.week === job.terminalWeek && last.executedWorkCUw > 0 && !last.paused,
        'Batch completion did not follow the final paid physical work.');
      else check(job.terminalWeek === job.deadlineWeek && job.completedWork < job.requiredWork, 'Batch deadline was extended or a completed order expired.');
    }
  }
}

function assertInvoice(state: GameState, invoice: BatchInvoice, job: BatchJob): void {
  record(invoice, 'Batch terminal invoice');
  exactKeys(invoice, ['id', 'jobId', 'companyId', 'productId', 'orderId', 'week', 'reason', 'modelId', 'modelFingerprint', 'requestedRequests', 'completedRequests', 'inputTokens', 'outputTokens', 'grossCents', 'creditsCents', 'amountCents'], 'Batch terminal invoice');
  const amount = batchInvoiceAmount(job.terms, job.completedRequests);
  check(!batchJobLive(job) && invoice.id === job.invoiceId && invoice.jobId === job.id && invoice.companyId === job.companyId && invoice.productId === job.productId
    && invoice.orderId === job.orderId && invoice.week === job.terminalWeek && invoice.reason === (job.status === 'completed' ? 'completed' : job.status === 'expired' ? 'deadline' : 'cancelled')
    && invoice.modelId === job.model.modelId && invoice.modelFingerprint === job.model.modelFingerprint
    && invoice.requestedRequests === job.terms.requests && invoice.completedRequests === job.completedRequests && invoice.inputTokens === job.inputTokens && invoice.outputTokens === job.outputTokens
    && invoice.grossCents === job.quotedCents && invoice.amountCents === amount && invoice.creditsCents === job.quotedCents - amount
    && state.slices.company.postedFacts[invoice.id] === true, 'Batch invoice changed its frozen source, completed requests, once-only earned amount or unfinished-work credit.');
  const ledger = state.slices.company.ledger.find(item => item.id === invoice.id);
  if (ledger) check(ledger.companyId === job.companyId && ledger.sourceId === job.id && ledger.week === invoice.week
    && ledger.kind === 'receipt' && ledger.category === 'revenue' && ledger.amountCents === amount, 'Batch terminal invoice differs from its retained revenue ledger fact.');
}

export function assertBatchState(state: GameState, content: GameContent = CONTENT): void {
  const { batchSchedulers, batchJobs, batchInvoices } = state.slices.products;
  if (batchSchedulers === undefined && batchJobs === undefined && batchInvoices === undefined) return;
  record(batchSchedulers, 'Batch scheduler collection'); record(batchJobs, 'Batch job collection');
  const schedulerEntries = Object.entries(batchSchedulers!), jobEntries = Object.entries(batchJobs!);
  check(schedulerEntries.length > 0 && schedulerEntries.length <= RULES.maximumSchedulers && jobEntries.length <= RULES.maximumJobs
    && Array.isArray(batchInvoices) && batchInvoices.length <= RULES.maximumJobs,
  'Batch adoption must retain all three bounded collections together.');
  for (const [companyId, scheduler] of schedulerEntries) assertScheduler(state, companyId, scheduler, content);
  const claims = new Map<string, BatchJob[]>();
  for (const [id, job] of jobEntries) {
    assertJob(state, id, job, content); const key = `${job.companyId}:${job.orderId}`, previous = claims.get(key) ?? [];
    previous.push(job); claims.set(key, previous);
  }
  for (const history of claims.values()) {
    history.sort((a, b) => a.claim - b.claim);
    check(history.length <= RULES.maximumClaimsPerOrder && history.every((job, index) => job.claim === index + 1
      && (!index || job.acceptedWeek >= history[index - 1].acceptedWeek)), 'Batch finite order claims were duplicated, reordered or regenerated.');
  }
  const invoiceIds = new Set<string>(), invoicedJobs = new Set<string>();
  for (const invoice of batchInvoices!) {
    identifier(invoice.id, 'Batch invoice'); identifier(invoice.jobId, 'Batch invoiced job');
    check(!invoiceIds.has(invoice.id) && !invoicedJobs.has(invoice.jobId), 'A batch order settled more than once.');
    invoiceIds.add(invoice.id); invoicedJobs.add(invoice.jobId);
    const job = batchJobs![invoice.jobId]; check(job, 'Batch invoice has no retained job.'); assertInvoice(state, invoice, job);
  }
  for (const [, job] of jobEntries) check(batchJobLive(job) ? !invoicedJobs.has(job.id) : invoicedJobs.has(job.id), 'A batch order gained an early invoice or lost its final settlement.');
  for (const [companyId, scheduler] of schedulerEntries) {
    const own = jobEntries.map(([, job]) => job).filter(job => job.companyId === companyId);
    check(own.length <= RULES.maximumJobsPerCompany, 'A company exceeded its nine retained batch orders.');
    const current = own.flatMap(job => job.usageHistory.filter(item => item.week === state.week));
    const staff = state.slices.company.lastStaff[companyId], fleet = state.slices.compute.fleets[companyId];
    const commercial = current.reduce((sum, item) => checkedAdd(sum, item.staffGranted), 0);
    const physical = current.reduce((sum, item) => checkedAdd(sum, item.physicalWorkCUw), 0), memory = current.reduce((sum, item) => checkedAdd(sum, item.memoryMU), 0);
    const schedulerStaff = scheduler.latestStaffGrant?.week === state.week ? scheduler.latestStaffGrant.grantedStaff : 0;
    const schedulerPhysical = scheduler.latestGrant?.week === state.week ? scheduler.latestGrant.physicalCUw : 0;
    const schedulerMemory = scheduler.latestGrant?.week === state.week ? scheduler.latestGrant.memoryMU : 0;
    check(commercial <= (staff?.granted.commercial ?? 0) && schedulerStaff <= (staff?.granted.ml ?? 0), 'Batch workloads collectively reused a staff grant.');
    check(physical <= fleet.lastWork.serving && schedulerPhysical <= fleet.lastWork.development && memory + schedulerMemory <= fleet.lastReservedMemoryMU,
      'Batch workloads collectively claimed more physical work or separate resident memory than the company supplied.');
  }
}
