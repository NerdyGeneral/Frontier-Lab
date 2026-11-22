import { assertFacilityTariffGrant, facilityTariffIdentity, validatedFacilityRate } from '../modules/facility-tariffs';
import { CHIP_RULES } from '../content/wave4-hardware';
import { SYNTHETIC_RULES as RULES } from '../content/wave26-synthetic';
import type { GameContent, GameState, TrainingRun } from '../contracts/types';
import { RESOURCE_SCALE as U } from '../contracts/types';
import type { SyntheticComputeMeter, SyntheticJob, SyntheticStaffMeter } from '../contracts/wave26-synthetic';
import { getRackHardware } from '../modules/compute-pools';
import { syntheticReceiptKey, syntheticWorkId } from '../modules/synthetic-data';
import { SYNTHETIC_DOMAINS, paidSyntheticTeacherReport, syntheticAudit, syntheticDataPacket, syntheticGenerationTerms, syntheticModelAncestry, syntheticRights,
  syntheticSourceFingerprint, syntheticSourceIds, syntheticSourceKey, syntheticSourceReason, syntheticTeacherFingerprint, syntheticTeacherReason } from '../modules/synthetic-evidence';
import { createSyntheticTrainingReceipt, validateSyntheticTraining } from '../modules/synthetic-training';
import { canonicalStateHash } from './canonical';
import { checkedAdd, checkedInteger, mulDiv } from './math';

function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const same = (a: unknown, b: unknown) => canonicalStateHash(a) === canonicalStateHash(b);
function record(value: unknown, name: string): void { check(!!value && typeof value === 'object' && !Array.isArray(value), name + ' must be a record.'); }
function id(value: unknown): void { check(typeof value === 'string' && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value), 'Synthetic identity is invalid.'); }
function hash(value: unknown): void { check(typeof value === 'string' && /^[a-f0-9]{8}$/.test(value), 'Synthetic fingerprint is invalid.'); }
function researchBefore(state: GameState, owner: string, researchId: string, week: number): boolean {
  return Object.values(state.slices.research.projects).some(project => project.companyId === owner && project.researchId === researchId
    && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= week);
}
function assertCompute(meter: SyntheticComputeMeter, job: SyntheticJob, stage: 'generation' | 'audit', state: GameState, content: GameContent): void {
  record(meter, 'Synthetic GPU meter'); record(meter.workReceipts, 'Synthetic GPU receipts');
  for (const value of [meter.requiredWork, meter.completedWork, meter.physicalWork, meter.memoryMU]) checkedInteger(value);
  check(meter.requiredWork > 0 && meter.memoryMU > 0 && meter.completedWork <= meter.requiredWork, 'Synthetic GPU progress exceeds its frozen budget.');
  const receipts = Object.entries(meter.workReceipts); check(receipts.length <= RULES.maximumReceiptBuckets, 'Synthetic GPU history is unbounded.');
  let effective = 0, physical = 0, grants = 0;
  for (const [key, receipt] of receipts) {
    hash(key); record(receipt, 'Synthetic hardware receipt'); id(receipt.hardwareId);
    const tariff = { hardwareId: receipt.hardwareId, ownership: receipt.ownership, multiplierBps: receipt.multiplierBps, rateCentsPerCUw: receipt.rateCentsPerCUw, ...facilityTariffIdentity(receipt) };
    check(syntheticReceiptKey(tariff) === key && ['cloud', 'owned'].includes(receipt.ownership), 'Synthetic hardware receipt identity changed.');
    for (const value of [receipt.multiplierBps, receipt.rateCentsPerCUw, receipt.physicalCUw, receipt.effectiveCUw, receipt.conversionRemainder, receipt.grants, receipt.firstWeek, receipt.lastWeek]) checkedInteger(value);
    check(receipt.physicalCUw > 0 && receipt.effectiveCUw > 0 && receipt.grants > 0 && receipt.multiplierBps > 0 && receipt.firstWeek >= job.startedWeek
      && receipt.lastWeek >= receipt.firstWeek && receipt.lastWeek <= state.week && receipt.grants <= receipt.lastWeek - receipt.firstWeek + 1, 'Synthetic GPU receipts violate elapsed actual-grant history.');
    if (stage === 'audit') check(job.review.latestGrant && receipt.firstWeek > job.review.latestGrant.week, 'The synthetic audit ran before data review finished.');
    if (receipt.ownership === 'cloud') check(receipt.hardwareId === 'general' && receipt.multiplierBps === 10000 && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, job.companyId, content.opening.rentCentsPerCUWeek, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: stage === 'generation' ? 'inference' : 'general' }), 'Synthetic cloud work changed its real conversion or rental tariff.');
    else {
      const rack = Object.values(state.slices.compute.racks).find(item => item.companyId === job.companyId && item.hardwareId === receipt.hardwareId);
      const hardware = content.hardware.find(item => item.id === receipt.hardwareId) ?? (rack ? getRackHardware(state, rack, content) : undefined);
      check(hardware, 'Synthetic owned work has no authored or qualified hardware.');
      const base = Math.round((rack?.chipDesignId && stage === 'generation' ? hardware.servingMultiplier : hardware.trainingMultiplier) * 10000);
      check([base, mulDiv(base, content.infrastructure.crossRackTrainingBps, 10000), mulDiv(base, CHIP_RULES.fabricCrossRackBps, 10000)].includes(receipt.multiplierBps)
        && receipt.rateCentsPerCUw === validatedFacilityRate(state, receipt, job.companyId, hardware.variableCentsPerCUw, receipt.firstWeek, receipt.lastWeek, { category: 'development', workloadKind: stage === 'generation' ? 'inference' : 'general' }), 'Synthetic GPU conversion or variable tariff was changed.');
    }
    check(BigInt(receipt.physicalCUw) * BigInt(receipt.multiplierBps) === BigInt(receipt.effectiveCUw) * BigInt(10000) + BigInt(receipt.conversionRemainder)
      && BigInt(receipt.conversionRemainder) < BigInt(Math.max(receipt.multiplierBps, 10000)) * BigInt(receipt.grants), 'Synthetic useful work does not reconcile with actual hardware grants.');
    effective = checkedAdd(effective, receipt.effectiveCUw); physical = checkedAdd(physical, receipt.physicalCUw); grants += receipt.grants;
  }
  check(effective === meter.completedWork && physical === meter.physicalWork && grants <= state.week - job.startedWeek + 1, 'Synthetic GPU meter has fabricated progress or duplicate weeks.');
  if (meter.latestGrant === null) check(meter.completedWork === 0 && receipts.length === 0, 'Synthetic progress has no GPU receipt.');
  else {
    const latest = meter.latestGrant; record(latest, 'Latest synthetic GPU grant'); id(latest.poolId); hash(latest.receiptKey);
    for (const value of [latest.week, latest.remainingBefore, latest.physicalCUw, latest.effectiveCUw, latest.memoryMU, latest.supervisionStaff]) checkedInteger(value);
    const receipt = meter.workReceipts[latest.receiptKey];
    if (receipt) assertFacilityTariffGrant(state, receipt, job.companyId, latest.poolId, latest.week, { category: 'development', workloadKind: stage === 'generation' ? 'inference' : 'general' }, content);
    const limit = stage === 'generation' ? Math.min(latest.remainingBefore, mulDiv(latest.supervisionStaff, RULES.generationWorkPerMlWeek, U)) : latest.remainingBefore;
    check(stage === 'generation' ? latest.supervisionStaff > 0 && latest.supervisionStaff <= U : latest.supervisionStaff === 0, 'Synthetic GPU receipt changed its required supervision.');
    check(receipt && latest.week === receipt.lastWeek && latest.week === Math.max(...receipts.map(([, row]) => row.lastWeek))
      && latest.physicalCUw > 0 && latest.physicalCUw <= receipt.physicalCUw && latest.effectiveCUw > 0 && latest.effectiveCUw <= receipt.effectiveCUw
      && latest.effectiveCUw <= latest.remainingBefore && latest.remainingBefore <= meter.requiredWork && latest.memoryMU === meter.memoryMU
      && meter.completedWork === meter.requiredWork - latest.remainingBefore + latest.effectiveCUw
      && latest.effectiveCUw === Math.min(limit, mulDiv(latest.physicalCUw, receipt.multiplierBps, 10000)), 'Latest synthetic GPU grant changed its budget or connected workspace.');
    const requestId = syntheticWorkId(job.id, stage);
    if (latest.week === state.week) {
      const actual = state.slices.compute.fleets[job.companyId].lastGrants.find(item => item.requestId === requestId);
      check(actual && actual.requestedWork === latest.remainingBefore && actual.grantedWork === latest.effectiveCUw, 'Synthetic progress disagrees with the shared allocator.');
    }
    const report = state.slices.compute.costReports?.[job.companyId]?.find(item => item.week === latest.week);
    if (report) {
      const request = report.resources.requests.find(item => item.id === requestId), grant = report.resources.computeGrants.find(item => item.requestId === requestId);
      check(request && grant && request.taskId === job.id && request.category === 'development' && request.memoryMU === meter.memoryMU
        && request.normalizedWorkCUw === latest.remainingBefore && grant.poolId === latest.poolId && grant.physicalCUw === latest.physicalCUw
        && grant.hardwareEffectiveCUw === latest.effectiveCUw && grant.memoryMU === meter.memoryMU && !grant.sharedMemoryMU, 'Synthetic work disagrees with retained settled resource evidence.');
      if (stage === 'generation') check(report.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === 'ml')?.staffWeeks === latest.supervisionStaff, 'Synthetic supervision differs from the real staff grant.');
    }
  }
}
function assertStaff(meter: SyntheticStaffMeter, job: SyntheticJob, stage: 'review' | 'audit-staff', state: GameState): void {
  record(meter, 'Synthetic staff meter');
  check(meter.role === (stage === 'review' ? 'data' : 'research'), 'Synthetic review changed its required staff role.');
  for (const value of [meter.requiredStaff, meter.completedStaff, meter.grantCount]) checkedInteger(value);
  check(meter.requiredStaff === (stage === 'review' ? RULES.reviewStaff : RULES.auditStaff) && meter.completedStaff <= meter.requiredStaff, 'Synthetic review staff budget changed.');
  if (meter.latestGrant === null) { check(meter.completedStaff === 0 && meter.grantCount === 0 && meter.firstWeek === null, 'Synthetic review has no staff-grant proof.'); return; }
  const latest = meter.latestGrant; record(latest, 'Latest synthetic staff grant');
  for (const value of [meter.firstWeek, latest.week, latest.remainingBefore, latest.grantedStaff]) checkedInteger(value!);
  check(job.reviewStartedWeek !== null && meter.firstWeek! >= job.reviewStartedWeek && latest.week >= meter.firstWeek! && latest.week <= state.week
    && meter.grantCount > 0 && meter.grantCount <= latest.week - meter.firstWeek! + 1 && meter.completedStaff >= meter.grantCount
    && meter.completedStaff <= meter.grantCount * RULES.maximumWeeklyStaff && latest.grantedStaff > 0
    && latest.grantedStaff <= Math.min(RULES.maximumWeeklyStaff, latest.remainingBefore) && latest.remainingBefore <= meter.requiredStaff
    && meter.completedStaff === meter.requiredStaff - latest.remainingBefore + latest.grantedStaff, 'Synthetic staff work exceeds its actual grants or timing.');
  if (stage === 'audit-staff') check(job.review.latestGrant && meter.firstWeek! > job.review.latestGrant.week, 'Synthetic audit staff worked before data review finished.');
  const report = state.slices.compute.costReports?.[job.companyId]?.find(item => item.week === latest.week);
  if (report) {
    const requestId = syntheticWorkId(job.id, stage), request = report.resources.requests.find(item => item.id === requestId);
    const grant = report.resources.staffGrants.find(item => item.requestId === requestId)?.grants.find(item => item.role === meter.role)?.staffWeeks ?? 0;
    check(request?.taskId === job.id && request.staffDemand?.find(item => item.role === meter.role)?.staffWeeks === Math.min(RULES.maximumWeeklyStaff, latest.remainingBefore)
      && grant === latest.grantedStaff, 'Synthetic review differs from settled staff-grant evidence.');
  }
}
/** Paid source, teacher, work and quarantine receipts form one immutable chain. */
export function assertWave26SyntheticState(state: GameState, content: GameContent): void {
  if (state.slices.data.syntheticJobs !== undefined) record(state.slices.data.syntheticJobs, 'Synthetic jobs');
  const entries = Object.entries(state.slices.data.syntheticJobs ?? {}); check(entries.length <= RULES.maximumJobs, 'Synthetic job history exceeds its bound.');
  const consumed = new Set<string>();
  for (const [key, job] of entries) {
    record(job, 'Synthetic job'); id(key); id(job.companyId); id(job.teacherModelId); id(job.sourcePacketId); id(job.outputPacketId);
    check(SYNTHETIC_DOMAINS.includes(job.domain), 'Synthetic target domain is not authored.');
    for (const value of [job.teacherScoreBps, job.teacherReliabilityBps, job.sourceQualityBps]) {
      checkedInteger(value); check(value <= 10000, 'Synthetic frozen quality is outside its valid range.');
    }
    checkedInteger(job.candidateUnits); checkedInteger(job.sourceUnits);
    const commandId = key.slice('synthetic-job:'.length), admission = state.commandReceipts[commandId];
    check(job.id === key && key.startsWith('synthetic-job:') && job.protocol === RULES.protocol && job.outputPacketId === `synthetic-data:${commandId}`
      && admission?.status === 'accepted' && admission.week === job.startedWeek && state.slices.company.companies[job.companyId], 'Synthetic job has no owned accepted generation admission.');
    checkedInteger(job.startedWeek); check(job.startedWeek <= state.week && researchBefore(state, job.companyId, 'S1', job.startedWeek), 'Synthetic generation preceded its paid S1 method.');
    check(state.slices.company.postedFacts[`synthetic-fee:${commandId}`], 'Synthetic generation omitted its setup fee.');
    check(!syntheticTeacherReason(state, job.companyId, job.teacherModelId, job.domain, content) && !syntheticSourceReason(state, job.companyId, job.sourcePacketId), 'Synthetic source or teacher is restricted, recursive, unqualified or reserved.');
    const teacher = state.slices.models.versions[job.teacherModelId], source = state.slices.data.packets[job.sourcePacketId], terms = syntheticGenerationTerms(teacher);
    hash(job.sourceKey); hash(job.sourceFingerprint); hash(job.teacherFingerprint);
    check(same(job.sourceIds, syntheticSourceIds(source)) && job.sourceKey === syntheticSourceKey(job.companyId, source, job.domain)
      && job.sourceFingerprint === syntheticSourceFingerprint(source) && job.sourceUnits === source.readyUnits
      && job.teacherFingerprint === syntheticTeacherFingerprint(teacher) && job.teacherReportId === paidSyntheticTeacherReport(state, teacher.id)?.id
      && state.slices.models.reports[job.teacherReportId].week <= job.startedWeek && same(job.teacherLineageIds, syntheticModelAncestry(state, teacher.id))
      && job.teacherScoreBps === teacher.capabilityBps[job.domain] && job.teacherReliabilityBps === teacher.reliabilityBps && job.sourceQualityBps === source.qualityBps
      && same(job.rights, syntheticRights(state, job, content)) && job.candidateUnits === RULES.candidateUnits, 'Synthetic lineage, audit inputs, candidate units or restrictive rights changed.');
    for (const sourceId of job.sourceIds) { const identity = `${job.companyId}:${job.domain}:${sourceId}`; check(!consumed.has(identity), 'Repeated or overlapping source units were minted by another synthetic job.'); consumed.add(identity); }
    check(['generating', 'awaiting-review', 'reviewing', 'auditing', 'ready', 'complete'].includes(job.phase) && typeof job.paused === 'boolean', 'Synthetic job phase is invalid.');
    check(job.generation.requiredWork === terms.requiredWork && job.generation.memoryMU === terms.memoryMU
      && job.auditCompute.requiredWork === RULES.auditWork && job.auditCompute.memoryMU === RULES.auditMemory, 'Synthetic GPU requirements changed.');
    assertCompute(job.generation, job, 'generation', state, content); assertCompute(job.auditCompute, job, 'audit', state, content);
    assertStaff(job.review, job, 'review', state); assertStaff(job.auditStaff, job, 'audit-staff', state);
    for (const value of [job.generationStaffGranted, job.generationStaffGrantCount, job.lastProgress]) checkedInteger(value);
    check(job.generationStaffGrantCount <= state.week - job.startedWeek + 1 && job.generationStaffGranted <= job.generationStaffGrantCount * U
      && job.generationStaffGranted >= job.generationStaffGrantCount && job.generation.completedWork <= mulDiv(job.generationStaffGranted, RULES.generationWorkPerMlWeek, U), 'Synthetic teacher work lacks actual ML supervision.');
    if (job.phase === 'generating') check(job.generatedWeek === null && job.generation.completedWork < job.generation.requiredWork, 'Synthetic generation ended without its next phase.');
    else check(job.generation.completedWork === job.generation.requiredWork && job.generatedWeek === job.generation.latestGrant?.week, 'Synthetic review began before real teacher GPU work finished.');
    if (['generating', 'awaiting-review'].includes(job.phase)) check(job.reviewStartedWeek === null && job.reviewCommandId === null && job.review.completedStaff === 0, 'Synthetic review started without a separate paid command.');
    else {
      id(job.reviewCommandId); checkedInteger(job.reviewStartedWeek!);
      const review = state.commandReceipts[job.reviewCommandId!];
      check(review?.status === 'accepted' && review.week === job.reviewStartedWeek && job.reviewStartedWeek! > job.generatedWeek!
        && job.reviewStartedWeek! <= state.week && state.slices.company.postedFacts[`synthetic-fee:${job.reviewCommandId}`], 'Synthetic review has no distinct admitted fee or valid start.');
    }
    if (['generating', 'awaiting-review', 'reviewing'].includes(job.phase)) check(job.auditCompute.completedWork === 0 && job.auditStaff.completedStaff === 0 && job.audit === null, 'Synthetic audit skipped data review.');
    else check(job.review.completedStaff === job.review.requiredStaff, 'Synthetic data review is unfinished.');
    if (['ready', 'complete'].includes(job.phase)) {
      check(job.auditCompute.completedWork === job.auditCompute.requiredWork && job.auditStaff.completedStaff === job.auditStaff.requiredStaff
        && same(job.audit, syntheticAudit(job)) && job.audit!.acceptedUnits >= RULES.trainingEvidence, 'Synthetic accepted evidence changed its audit or skipped paid verification.');
      check(job.completedWeek === Math.max(job.auditCompute.latestGrant!.week, job.auditStaff.latestGrant!.week)
        && job.availableWeek === job.completedWeek! + 1 && (job.phase === 'ready' ? job.availableWeek > state.week : job.availableWeek <= state.week), 'Synthetic delivery boundary changed.');
    } else check(job.completedWeek === null && job.availableWeek === null && job.audit === null, 'Unfinished synthetic work created accepted evidence.');
    const packet = state.slices.data.packets[job.outputPacketId];
    check(job.phase === 'complete' ? same(packet, syntheticDataPacket(job)) : !packet, 'Synthetic data appeared early or changed its accepted units, rights or quarantine.');
  }
  for (const packet of Object.values(state.slices.data.packets)) if (packet.synthetic || packet.catalogId === RULES.catalogId || packet.sourceIds?.some(id => id.startsWith('synthetic-'))) {
    const job = packet.synthetic && state.slices.data.syntheticJobs?.[packet.synthetic.jobId];
    check(job && job.phase === 'complete' && packet.id === job.outputPacketId && same(packet, syntheticDataPacket(job)), 'A synthetic packet has no unique paid audited source or was copied/curated to inflate it.');
  }
}
export function assertSyntheticTraining(state: GameState, run: TrainingRun): void {
  const plan = run.plan; if (!plan) return;
  const options = { baseModelId: run.baseModelId, packetId: run.packetId, recipeId: run.recipeId, packetIds: plan.corpus.packetIds,
    ...(plan.replay ? { replay: { domain: plan.replay.domain, shareBps: plan.replay.shareBps, packetIds: plan.replay.corpus.packetIds } } : {}),
    ...(plan.curriculum ? { curriculum: { shareBps: plan.curriculum.shareBps, tracks: plan.curriculum.tracks.map(track => ({ domain: track.domain, packetIds: track.corpus.packetIds })) as import('../contracts/wave17-curriculum').TrainingCurriculumChoice['tracks'] } } : {}) };
  check(!validateSyntheticTraining(state, run.companyId, options), 'Training bypassed synthetic teacher, unique-source or audit restrictions.');
  check(run.evidence.synthetic === undefined, 'Aggregate training evidence claimed an original synthetic packet receipt.');
  if (plan.kind !== 'synthetic') { check(plan.synthetic === undefined, 'An ordinary recipe invented synthetic training targets.'); return; }
  const expected = createSyntheticTrainingReceipt(state, state.slices.models.versions[run.baseModelId], run.packetId);
  check(expected && same(plan.synthetic, expected), 'Synthetic training changed its teacher cap, accepted units or audit lineage.');
  const job = state.slices.data.syntheticJobs![expected.jobId];
  check(job.availableWeek! <= run.startedWeek && researchBefore(state, run.companyId, 'S2', run.startedWeek)
    && state.slices.company.postedFacts[run.id + ':setup'] && !plan.adapter && !plan.profileApplied && !plan.methods.includes('R3'), 'Targeted training preceded its paid method, evidence or separate setup.');
}
