import { facilityTariffBinding, facilityTariffIdentity } from './facility-tariffs';
import { CONTENT } from '../content/catalog';
import { SYNTHETIC_RULES as RULES } from '../content/wave26-synthetic';
import type { CommandQuote, DataSlice, DomainResult, GameCommand, GameContent, GameState, ModuleContext, Rejection, WorkRequest } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { SyntheticComputeMeter, SyntheticGenerationOptions, SyntheticGenerationPreview, SyntheticJob, SyntheticStaffMeter, SyntheticView } from '../contracts/wave26-synthetic';
import { canonicalStateHash, freezeDeep } from '../core/canonical';
import { checkedAdd, checkedInteger, formatMoney, formatUnits, mulDiv } from '../core/math';
import { getComputePools, getPoolWorkCostRate, getPoolMultiplierBps, usesCrossRackTraining } from './compute-pools';
import { inheritedModelRights, modelExecutionHints } from './model-runtime';
import { hasResearch } from './research';
import { SYNTHETIC_DOMAINS, paidSyntheticTeacherReport, syntheticAudit, syntheticDataPacket, syntheticGenerationTerms, syntheticModelAncestry,
  syntheticRights, syntheticSourceFingerprint, syntheticSourceIds, syntheticSourceKey, syntheticSourceReason, syntheticTeacherFingerprint, syntheticTeacherReason } from './synthetic-evidence';

export const SYNTHETIC_COMMANDS = ['start_synthetic_generation', 'start_synthetic_review', 'set_synthetic_job_paused'] as const;
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });
const jobs = (data: Readonly<DataSlice>) => Object.values(data.syntheticJobs ?? {});
export const syntheticWorkId = (id: string, phase: 'generation' | 'review' | 'audit' | 'audit-staff') => `synthetic:${id}:${phase}`;
const computeMeter = (requiredWork: number, memoryMU: number): SyntheticComputeMeter => ({ requiredWork, completedWork: 0, physicalWork: 0, memoryMU, workReceipts: {}, latestGrant: null });
const staffMeter = (role: SyntheticStaffMeter['role'], requiredStaff: number): SyntheticStaffMeter => ({ role, requiredStaff, completedStaff: 0, grantCount: 0, firstWeek: null, latestGrant: null });

export function validateSyntheticCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): Rejection | undefined {
  const p = command.payload, owner = command.companyId;
  if (!state.slices.company.companies[owner]) return reject('The company does not exist.', 'UNKNOWN_COMPANY');
  if (p.kind === 'start_synthetic_generation') {
    if (!hasResearch(state, owner, 'S1')) return reject('Complete Synthetic provenance S1 before funding generation.');
    if (!SYNTHETIC_DOMAINS.includes(p.domain)) return reject('Choose an authored target domain.', 'INVALID_COMMAND');
    const teacher = syntheticTeacherReason(state, owner, p.teacherModelId, p.domain, content); if (teacher) return reject(teacher);
    const source = syntheticSourceReason(state, owner, p.sourcePacketId); if (source) return reject(source);
    const sources = syntheticSourceIds(state.slices.data.packets[p.sourcePacketId]);
    const overlaps = (ids: readonly string[]) => ids.some(id => sources.includes(id));
    if (jobs(state.slices.data).some(job => job.companyId === owner && job.domain === p.domain && overlaps(job.sourceIds))) return reject('This source lineage already supplied this target slice. Reuse its paid job or accepted packet; new teachers and curated copies cannot mint more independent units.', 'NO_IMPROVEMENT');
    if (state.queuedCommands.some(other => other.id !== command.id && other.companyId === owner && other.payload.kind === 'start_synthetic_generation'
      && other.payload.domain === p.domain && overlaps(syntheticSourceIds(state.slices.data.packets[other.payload.sourcePacketId])))) return reject('A generation job for an overlapping source and this domain is already queued.', 'ALREADY_ACTIVE');
    if (jobs(state.slices.data).length >= RULES.maximumJobs) return reject('The bounded synthetic job history is full. Accepted packets remain reusable.', 'CAPACITY_EXCEEDED');
    return;
  }
  if (p.kind !== 'start_synthetic_review' && p.kind !== 'set_synthetic_job_paused') return reject('This is not a synthetic-data command.', 'INVALID_COMMAND');
  const job = state.slices.data.syntheticJobs?.[p.jobId];
  if (!job || job.companyId !== owner) return reject('Choose one of your synthetic data jobs.');
  if (p.kind === 'start_synthetic_review') {
    if (!hasResearch(state, owner, 'S1')) return reject('Complete Synthetic provenance S1 before reviewing generated candidates.');
    if (job.phase !== 'awaiting-review' || job.reviewCommandId !== null) return reject('Finish generation first, then review it once. Existing paid review can be resumed.');
    if (state.queuedCommands.some(other => other.id !== command.id && other.companyId === owner && other.payload.kind === 'start_synthetic_review' && other.payload.jobId === job.id)) return reject('This review is already queued.', 'ALREADY_ACTIVE');
    return;
  }
  if (!['generating', 'reviewing', 'auditing'].includes(job.phase)) return reject('Only unfinished active synthetic work can be paused or resumed.');
  if (typeof p.paused !== 'boolean' || job.paused === p.paused) return reject('Choose a different pause state.', 'INVALID_COMMAND');
}

export function previewSyntheticGeneration(state: Readonly<GameState>, options: SyntheticGenerationOptions, content: GameContent = CONTENT): SyntheticGenerationPreview {
  const rejection = validateSyntheticCommand(state, { id: 'synthetic-preview', companyId: state.playerCompanyId, issuedForWeek: state.week + 1,
    payload: { kind: 'start_synthetic_generation', ...options } }, content);
  const teacher = state.slices.models.versions[options.teacherModelId], source = state.slices.data.packets[options.sourcePacketId];
  const terms = teacher ? syntheticGenerationTerms(teacher) : { requiredWork: 0, memoryMU: 0 };
  return freezeDeep({ accepted: !rejection, reason: rejection?.message ?? null, sourceKey: source ? syntheticSourceKey(state.playerCompanyId, source, options.domain) : null,
    candidateUnits: RULES.candidateUnits, generationFeeCents: RULES.generationFeeCents, reviewFeeCents: RULES.reviewFeeCents, ...terms,
    reviewStaff: RULES.reviewStaff, auditStaff: RULES.auditStaff, auditWork: RULES.auditWork, rights: teacher && source ? syntheticRights(state, options, content) : null });
}
export function quoteSyntheticCommand(state: Readonly<GameState>, command: GameCommand): CommandQuote {
  const p = command.payload;
  if (p.kind === 'start_synthetic_generation') {
    const terms = syntheticGenerationTerms(state.slices.models.versions[p.teacherModelId]);
    return { upfrontCostCents: RULES.generationFeeCents, weeklyCostDeltaCents: 0,
      summary: `${formatMoney(RULES.generationFeeCents)} generation setup; ${formatUnits(terms.requiredWork)} development CUw with ${formatUnits(terms.memoryMU)} MU teacher memory and actual ML supervision. Produces 100 unaccepted candidates; paid review and independent evaluation remain separate.` };
  }
  if (p.kind === 'start_synthetic_review') return { upfrontCostCents: RULES.reviewFeeCents, weeklyCostDeltaCents: 0,
    summary: `${formatMoney(RULES.reviewFeeCents)} audit setup, 40 Data points, then 20 Research points and 2 development CUw in 1 MU. Overlap and quality failures are quarantined; only accepted unique units become data at the following boundary.` };
  return { upfrontCostCents: 0, weeklyCostDeltaCents: 0, summary: 'Change the synthetic job pause state next week; paid work and source identity remain.' };
}
export function applySyntheticCommand(state: Readonly<GameState>, command: GameCommand, content: GameContent = CONTENT): DomainResult {
  const p = command.payload, data = structuredClone(state.slices.data); let amountCents = 0, label = '';
  if (p.kind === 'start_synthetic_generation') {
    const teacher = state.slices.models.versions[p.teacherModelId], source = data.packets[p.sourcePacketId], terms = syntheticGenerationTerms(teacher);
    const id = `synthetic-job:${command.id}`;
    data.syntheticJobs ??= {};
    data.syntheticJobs[id] = { id, companyId: command.companyId, protocol: RULES.protocol, phase: 'generating', paused: false,
      startedWeek: state.week, generatedWeek: null, reviewStartedWeek: null, reviewCommandId: null, completedWeek: null, availableWeek: null,
      outputPacketId: `synthetic-data:${command.id}`, teacherModelId: teacher.id, sourcePacketId: source.id, domain: p.domain,
      sourceIds: syntheticSourceIds(source), sourceKey: syntheticSourceKey(command.companyId, source, p.domain),
      sourceFingerprint: syntheticSourceFingerprint(source), sourceUnits: source.readyUnits,
      teacherFingerprint: syntheticTeacherFingerprint(teacher), teacherReportId: paidSyntheticTeacherReport(state, teacher.id)!.id,
      teacherLineageIds: syntheticModelAncestry(state, teacher.id), teacherScoreBps: teacher.capabilityBps[p.domain], teacherReliabilityBps: teacher.reliabilityBps,
      sourceQualityBps: source.qualityBps, rights: syntheticRights(state, p, content), candidateUnits: RULES.candidateUnits,
      generation: computeMeter(terms.requiredWork, terms.memoryMU), review: staffMeter('data', RULES.reviewStaff),
      auditCompute: computeMeter(RULES.auditWork, RULES.auditMemory), auditStaff: staffMeter('research', RULES.auditStaff),
      generationStaffGranted: 0, generationStaffGrantCount: 0, audit: null, lastProgress: 0,
      lastBottleneck: 'Assign ML supervision and development compute with the teacher’s connected memory.' };
    amountCents = RULES.generationFeeCents; label = 'Synthetic generation';
  } else if (p.kind === 'start_synthetic_review') {
    const job = data.syntheticJobs![p.jobId]; job.phase = 'reviewing'; job.paused = false; job.reviewStartedWeek = state.week; job.reviewCommandId = command.id;
    job.lastProgress = 0; job.lastBottleneck = 'Review and deduplication need Data points.';
    amountCents = RULES.reviewFeeCents; label = 'Synthetic review and audit';
  } else if (p.kind === 'set_synthetic_job_paused') {
    const job = data.syntheticJobs![p.jobId]; job.paused = p.paused; job.lastProgress = 0; job.lastBottleneck = p.paused ? 'Paused; paid progress is preserved.' : 'Waiting for actual staff and compute grants.';
    label = p.paused ? 'Synthetic job paused' : 'Synthetic job resumed';
  }
  return { updates: { data }, facts: amountCents ? [{ id: `synthetic-fee:${command.id}`, companyId: command.companyId, week: state.week,
    sourceId: command.id, category: 'operating', amountCents, label, kind: 'expense' }] : [],
    messages: [{ companyId: command.companyId, category: 'project', message: label + '. Actual resource grants determine progress; elapsed time alone earns no evidence.' }] };
}

export function syntheticRequests(state: Readonly<GameState>): WorkRequest[] {
  const requests: WorkRequest[] = [];
  for (const job of jobs(state.slices.data)) {
    if (job.paused || state.slices.company.companies[job.companyId].arrearsCents) continue;
    const common = { companyId: job.companyId, taskId: job.id, category: 'development' as const, priority: RULES.requestPriority, poolId: 'auto' };
    if (job.phase === 'generating') {
      const remaining = job.generation.requiredWork - job.generation.completedWork;
      if (remaining) requests.push({ ...common, id: syntheticWorkId(job.id, 'generation'), normalizedWorkCUw: remaining, memoryMU: job.generation.memoryMU,
        ...modelExecutionHints(state.slices.models.versions[job.teacherModelId]),
        staffDemand: [{ role: 'ml', staffWeeks: Math.min(U, mulDiv(remaining, U, RULES.generationWorkPerMlWeek, 'ceil')) }],
        supervision: { role: 'ml', workPerStaffWeek: RULES.generationWorkPerMlWeek } });
    } else if (job.phase === 'reviewing') {
      requests.push({ ...common, id: syntheticWorkId(job.id, 'review'), normalizedWorkCUw: 0, memoryMU: 0,
        staffDemand: [{ role: 'data', staffWeeks: Math.min(RULES.maximumWeeklyStaff, job.review.requiredStaff - job.review.completedStaff) }] });
    } else if (job.phase === 'auditing') {
      if (job.auditCompute.completedWork < job.auditCompute.requiredWork) requests.push({ ...common, id: syntheticWorkId(job.id, 'audit'), workloadKind: 'general',
        normalizedWorkCUw: job.auditCompute.requiredWork - job.auditCompute.completedWork, memoryMU: job.auditCompute.memoryMU });
      if (job.auditStaff.completedStaff < job.auditStaff.requiredStaff) requests.push({ ...common, id: syntheticWorkId(job.id, 'audit-staff'), normalizedWorkCUw: 0, memoryMU: 0,
        staffDemand: [{ role: 'research', staffWeeks: Math.min(RULES.maximumWeeklyStaff, job.auditStaff.requiredStaff - job.auditStaff.completedStaff) }] });
    }
  }
  return requests;
}
export function syntheticReceiptKey(receipt: Pick<import('../contracts/wave10-feedback-review').FeedbackReviewWorkReceipt, 'hardwareId' | 'ownership' | 'multiplierBps' | 'rateCentsPerCUw' | 'facilityTariff'>): string { return canonicalStateHash({ hardwareId: receipt.hardwareId, ownership: receipt.ownership, multiplierBps: receipt.multiplierBps, rateCentsPerCUw: receipt.rateCentsPerCUw, ...facilityTariffIdentity(receipt) }); }
function advanceCompute(state: Readonly<GameState>, context: ModuleContext, job: SyntheticJob, meter: SyntheticComputeMeter, phase: 'generation' | 'audit'): number {
  const grant = context.resources.computeGrants.find(item => item.requestId === syntheticWorkId(job.id, phase));
  if (!grant?.hardwareEffectiveCUw) return 0;
  const remaining = meter.requiredWork - meter.completedWork;
  const pool = getComputePools(state, job.companyId, context.content, context.resources.staffGrants).find(item => item.id === grant.poolId);
  if (!pool || grant.hardwareEffectiveCUw > remaining || grant.memoryMU !== meter.memoryMU || grant.sharedMemoryMU || grant.physicalCUw <= 0) throw new Error('Synthetic GPU progress requires its actual full-workspace physical grant.');
  const multiplierBps = getPoolMultiplierBps(pool, 'development', usesCrossRackTraining(pool, 'development', grant.physicalCUw, meter.memoryMU), context.content, phase === 'generation' ? 'inference' : 'general');
  const supervisionStaff = phase === 'generation' ? context.resources.staffGrants.find(item => item.requestId === syntheticWorkId(job.id, phase))?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0 : 0;
  const limit = phase === 'generation' ? Math.min(remaining, mulDiv(supervisionStaff, RULES.generationWorkPerMlWeek, U)) : remaining;
  if (grant.hardwareEffectiveCUw !== Math.min(limit, mulDiv(grant.physicalCUw, multiplierBps, 10000))) throw new Error('Synthetic useful work does not match hardware conversion and actual supervision.');
  const request = { category: 'development' as const, workloadKind: phase === 'generation' ? 'inference' as const : 'general' as const };
  const tariff = { hardwareId: pool.hardwareId, ownership: pool.ownership, multiplierBps,
    rateCentsPerCUw: pool.ownership === 'cloud' ? context.content.opening.rentCentsPerCUWeek : getPoolWorkCostRate(pool, request), ...facilityTariffBinding(pool, request) };
  const key = syntheticReceiptKey(tariff), receipt = meter.workReceipts[key] ??= { ...tariff, physicalCUw: 0, effectiveCUw: 0,
    conversionRemainder: 0, grants: 0, firstWeek: context.week, lastWeek: context.week };
  receipt.physicalCUw = checkedAdd(receipt.physicalCUw, grant.physicalCUw); receipt.effectiveCUw = checkedAdd(receipt.effectiveCUw, grant.hardwareEffectiveCUw);
  receipt.conversionRemainder = checkedAdd(receipt.conversionRemainder, checkedInteger(Number(BigInt(grant.physicalCUw) * BigInt(multiplierBps) - BigInt(grant.hardwareEffectiveCUw) * BigInt(10000))));
  receipt.grants++; receipt.lastWeek = context.week;
  meter.completedWork = checkedAdd(meter.completedWork, grant.hardwareEffectiveCUw); meter.physicalWork = checkedAdd(meter.physicalWork, grant.physicalCUw);
  meter.latestGrant = { week: context.week, poolId: pool.id, receiptKey: key, remainingBefore: remaining, physicalCUw: grant.physicalCUw,
    effectiveCUw: grant.hardwareEffectiveCUw, memoryMU: grant.memoryMU, supervisionStaff };
  return grant.hardwareEffectiveCUw;
}
function advanceStaff(context: ModuleContext, job: SyntheticJob, meter: SyntheticStaffMeter, phase: 'review' | 'audit-staff'): number {
  const staff = context.resources.staffGrants.find(item => item.requestId === syntheticWorkId(job.id, phase))?.grants.find(item => item.role === meter.role)?.staffWeeks ?? 0;
  const remaining = meter.requiredStaff - meter.completedStaff;
  if (staff > Math.min(RULES.maximumWeeklyStaff, remaining)) throw new Error('Synthetic review exceeded its remaining staff requirement.');
  if (staff > 0) { meter.latestGrant = { week: context.week, remainingBefore: remaining, grantedStaff: staff };
    meter.firstWeek ??= context.week; meter.grantCount++; meter.completedStaff = checkedAdd(meter.completedStaff, staff); }
  return staff;
}
export function advanceSyntheticJobs(state: Readonly<GameState>, context: ModuleContext, data: DataSlice): void {
  for (const job of jobs(data)) {
    job.lastProgress = 0;
    if (job.paused || state.slices.company.companies[job.companyId].arrearsCents) continue;
    if (job.phase === 'generating') {
      job.lastProgress = advanceCompute(state, context, job, job.generation, 'generation');
      const ml = context.resources.staffGrants.find(item => item.requestId === syntheticWorkId(job.id, 'generation'))?.grants.find(item => item.role === 'ml')?.staffWeeks ?? 0;
      if (ml > 0) { job.generationStaffGranted = checkedAdd(job.generationStaffGranted, ml); job.generationStaffGrantCount++; }
      job.lastBottleneck = job.lastProgress ? '' : state.slices.compute.fleets[job.companyId].lastGrants.find(item => item.requestId === syntheticWorkId(job.id, 'generation'))?.reason ?? 'Waiting for development compute and ML supervision.';
    } else if (job.phase === 'reviewing') {
      job.lastProgress = advanceStaff(context, job, job.review, 'review');
      job.lastBottleneck = job.lastProgress ? '' : 'Generate Data points; at most 20 points review candidates each week.';
    } else if (job.phase === 'auditing') {
      const work = advanceCompute(state, context, job, job.auditCompute, 'audit');
      const staff = advanceStaff(context, job, job.auditStaff, 'audit-staff'); job.lastProgress = work || staff;
      const needsWork = job.auditCompute.completedWork < job.auditCompute.requiredWork, needsStaff = job.auditStaff.completedStaff < job.auditStaff.requiredStaff;
      job.lastBottleneck = [needsWork ? 'Complete separate audit GPU work with 1 MU memory.' : '', needsStaff ? 'Verification of answer quality and reserved-case overlap needs Research points.' : ''].filter(Boolean).join(' ');
    }
  }
}
export function resolveSyntheticJobs(context: ModuleContext, data: DataSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const job of jobs(data)) {
    if (job.paused) continue;
    if (job.phase === 'generating' && job.generation.completedWork === job.generation.requiredWork) {
      job.phase = 'awaiting-review'; job.generatedWeek = context.week; job.lastBottleneck = 'Generation finished. Fund a separate review before any candidate becomes training evidence.';
    } else if (job.phase === 'reviewing' && job.review.completedStaff === job.review.requiredStaff) {
      job.phase = 'auditing'; job.lastBottleneck = 'Data review finished. The separate audit needs research staff and GPU work.';
    } else if (job.phase === 'auditing' && job.auditCompute.completedWork === job.auditCompute.requiredWork && job.auditStaff.completedStaff === job.auditStaff.requiredStaff) {
      job.audit = syntheticAudit(job); job.phase = 'ready'; job.completedWeek = context.week; job.availableWeek = context.week + 1;
      job.lastBottleneck = `Audit accepted ${job.audit.acceptedUnits} unique units; the packet becomes available in Week ${job.availableWeek}.`;
      messages.push({ companyId: job.companyId, category: 'project', message: job.lastBottleneck + ' Reserved overlap and failed answers remain quarantined.' });
    }
  }
  return messages;
}
export function commitSyntheticJobs(context: ModuleContext, data: DataSlice): NonNullable<DomainResult['messages']> {
  const messages: NonNullable<DomainResult['messages']> = [];
  for (const job of jobs(data)) if (job.phase === 'ready' && job.availableWeek !== null && job.availableWeek <= context.week) {
    data.packets[job.outputPacketId] = syntheticDataPacket(job); job.phase = 'complete'; job.lastBottleneck = '';
    messages.push({ companyId: job.companyId, category: 'delivery', message: `${job.audit!.acceptedUnits} audited ${job.domain} units are available. Pay for a separate student curriculum and independent model evaluation.` });
  }
  return messages;
}
export function getSyntheticView(state: Readonly<GameState>, companyId = state.playerCompanyId, content: GameContent = CONTENT): SyntheticView {
  const canGenerate = hasResearch(state, companyId, 'S1'), canTrain = hasResearch(state, companyId, 'S2');
  const ownJobs = jobs(state.slices.data).filter(job => job.companyId === companyId).sort((a, b) => a.startedWeek - b.startedWeek || a.id.localeCompare(b.id));
  const tariff = (job: SyntheticJob) => Number([...Object.values(job.generation.workReceipts), ...Object.values(job.auditCompute.workReceipts)]
    .reduce((sum, item) => sum + BigInt(item.physicalCUw) * BigInt(item.rateCentsPerCUw), BigInt(0)) / BigInt(U));
  return freezeDeep({ canGenerate, canReview: canGenerate, canTrain, generationGate: canGenerate ? null : 'Complete Synthetic provenance S1 to fund generation and review.',
    trainingGate: canTrain ? null : 'Complete Targeted synthetic curriculum S2 before training a separate student.',
    teachers: Object.values(state.slices.models.versions).filter(model => model.companyId === companyId).map(model => ({ id: model.id, name: model.name,
      capabilityBps: { ...model.capabilityBps }, reliabilityBps: model.reliabilityBps, residentMU: model.residentMU, transferRights: inheritedModelRights(state, model.id, content).weights,
      eligibleDomains: SYNTHETIC_DOMAINS.filter(domain => !syntheticTeacherReason(state, companyId, model.id, domain, content)), reason: syntheticTeacherReason(state, companyId, model.id, undefined, content) })),
    sources: Object.values(state.slices.data.packets).filter(packet => packet.companyId === companyId).map(packet => ({ id: packet.id, name: packet.name,
      readyUnits: packet.readyUnits, qualityBps: packet.qualityBps, coverageBps: { ...packet.coverageBps }, rights: { ...packet.rights }, sourceIds: syntheticSourceIds(packet),
      eligible: !syntheticSourceReason(state, companyId, packet.id), reason: syntheticSourceReason(state, companyId, packet.id) })),
    jobs: ownJobs.map(job => ({ ...structuredClone(job), teacherName: state.slices.models.versions[job.teacherModelId].name,
      sourceName: state.slices.data.packets[job.sourcePacketId].name,
      progressBps: Math.min(10000, mulDiv(job.generation.completedWork, 4000, job.generation.requiredWork) + mulDiv(job.review.completedStaff, 3000, job.review.requiredStaff)
        + mulDiv(job.auditCompute.completedWork, 1500, job.auditCompute.requiredWork) + mulDiv(job.auditStaff.completedStaff, 1500, job.auditStaff.requiredStaff)),
      generationFeeCents: RULES.generationFeeCents, reviewFeeCents: job.reviewCommandId ? RULES.reviewFeeCents : 0, actualGpuTariffEstimateCents: tariff(job),
      canReview: canGenerate && job.phase === 'awaiting-review', reviewReason: job.phase === 'awaiting-review' ? null : 'Finish generation before starting its one paid review.' })),
    packets: ownJobs.filter(job => job.phase === 'complete').map(job => ({ id: job.outputPacketId, name: state.slices.data.packets[job.outputPacketId].name,
      jobId: job.id, domain: job.domain, teacherModelId: job.teacherModelId, teacherName: state.slices.models.versions[job.teacherModelId].name,
      acceptedUnits: job.audit!.acceptedUnits, qualityBps: job.audit!.qualityBps, rights: { ...job.rights }, auditFingerprint: job.audit!.fingerprint })),
    costs: { generationFeeCents: RULES.generationFeeCents, reviewFeeCents: RULES.reviewFeeCents, trainingFeeCents: RULES.trainingFeeCents,
      reviewStaff: RULES.reviewStaff, auditStaff: RULES.auditStaff, auditWork: RULES.auditWork, trainingWork: RULES.trainingWork } });
}
