import { FAMILY_SERVING_MULTIPLIER } from './model-design';
import { CONTENT } from '../content/catalog';
import { DATA_CATALOG } from '../content/wave2-lab';
import { SYNTHETIC_RULES as RULES } from '../content/wave26-synthetic';
import type { CapabilityDomain, DataPacket, GameContent, GameState, ModelVersion } from '../contracts/types';
import type { SyntheticAudit, SyntheticJob } from '../contracts/wave26-synthetic';
import { canonicalStateHash } from '../core/canonical';
import { mulDiv } from '../core/math';
import { isCapabilitySuite } from './evaluation-classification';
import { inheritedModelRights, modelWorkBps } from './model-runtime';

export const SYNTHETIC_DOMAINS: readonly CapabilityDomain[] = ['conversation', 'documents', 'coding', 'tools'];
export function syntheticSourceIds(packet: DataPacket | undefined): string[] { return [...new Set(packet?.sourceIds ?? [])].sort(); }
export function syntheticSourceKey(companyId: string, packet: DataPacket, domain: CapabilityDomain): string {
  return canonicalStateHash({ companyId, sources: syntheticSourceIds(packet), domain });
}
export function syntheticSourceFingerprint(packet: DataPacket): string {
  return canonicalStateHash({ id: packet.id, sources: syntheticSourceIds(packet), units: packet.readyUnits,
    qualityBps: packet.qualityBps, coverageBps: packet.coverageBps, rights: packet.rights,
    feedback: packet.feedback ?? null });
}
export function syntheticTeacherFingerprint(model: ModelVersion): string {
  return canonicalStateHash({ id: model.id, family: model.family, architecture: model.architecture,
    capabilityBps: model.capabilityBps, reliabilityBps: model.reliabilityBps, residentMU: model.residentMU,
    parentModelId: model.parentModelId ?? null, trainingEvidenceId: model.trainingEvidenceId ?? null,
    runtimeVariant: model.runtimeVariant ?? null });
}
/** Includes parent, format and distillation ancestry. It is deliberately based
 * on identities, never a model's editable display label. */
export function syntheticModelAncestry(state: Readonly<GameState>, modelId: string): string[] {
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return; seen.add(id);
    const model = state.slices.models.versions[id]; if (!model) return;
    if (model.parentModelId) visit(model.parentModelId);
    if (model.runtimeVariant) visit(model.runtimeVariant.sourceModelId);
    const run = model.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId] : undefined;
    if (run?.plan?.teacher) visit(run.plan.teacher.modelId);
    if (run?.plan?.synthetic) visit(run.plan.synthetic.teacherModelId);
  };
  visit(modelId); return [...seen].sort();
}
export function modelUsesSyntheticData(state: Readonly<GameState>, modelId: string): boolean {
  return syntheticModelAncestry(state, modelId).some(id => {
    const model = state.slices.models.versions[id], run = model?.trainingRunId ? state.slices.models.trainingRuns[model.trainingRunId] : undefined;
    return !!run?.plan?.synthetic || (run?.plan?.corpus.packetIds ?? []).some(packetId => !!state.slices.data.packets[packetId]?.synthetic);
  });
}
export function paidSyntheticTeacherReport(state: Readonly<GameState>, modelId: string) {
  const model = state.slices.models.versions[modelId];
  return Object.values(state.slices.models.reports).filter(report => model && report.companyId === model.companyId && report.modelId === modelId
    && report.heldOut && !report.scenarioStart && isCapabilitySuite(report.suiteId)
    && Object.values(state.slices.models.evaluationRuns).some(run => run.modelId === modelId && run.companyId === model.companyId
      && run.status === 'complete' && run.reportId === report.id && run.completedWork === run.requiredWork && run.requiredWork > 0
      && run.completedStaff === run.requiredStaff && run.requiredStaff > 0))
    .sort((a, b) => a.week - b.week || a.id.localeCompare(b.id))[0];
}
export function syntheticTeacherReason(state: Readonly<GameState>, companyId: string, modelId: string, domain?: CapabilityDomain, content: GameContent = CONTENT): string | null {
  const model = state.slices.models.versions[modelId];
  if (!model || model.companyId !== companyId) return 'Choose a teacher owned by your company.';
  if (!paidSyntheticTeacherReport(state, model.id)) return 'The teacher needs a completed paid capability evaluation on this exact model.';
  if (model.reliabilityBps < RULES.minimumTeacherReliabilityBps) return 'The teacher needs reliability of at least 60 before generating reviewed examples.';
  const rights = inheritedModelRights(state, model.id, content);
  if (!rights.hosted || !rights.weights) return 'The teacher and its full ancestry must permit hosted use and weight transfer.';
  if (modelUsesSyntheticData(state, model.id)) return 'A synthetic-trained teacher or descendant cannot generate another synthetic teaching loop.';
  if (domain && model.capabilityBps[domain] < RULES.minimumTeacherScoreBps) return 'The teacher needs at least 60 capability in the selected target domain.';
  return null;
}
export function syntheticSourceReason(state: Readonly<GameState>, companyId: string, packetId: string): string | null {
  const packet = state.slices.data.packets[packetId];
  if (!packet || packet.companyId !== companyId) return 'Choose a licensed source packet owned by your company.';
  if (!syntheticSourceIds(packet).length) return 'The source must retain its original licensed source identities.';
  if (!packet.prepared || packet.readyUnits < RULES.minimumSourceUnits) return 'Prepare at least 100 source units before generating this bounded slice.';
  if (packet.qualityBps < RULES.minimumSourceQualityBps) return 'The licensed source needs quality of at least 60 before generation.';
  if (!packet.rights.hosted) return 'The source license does not permit hosted model training.';
  if (packet.synthetic || syntheticSourceIds(packet).some(id => id.startsWith('synthetic-'))) return 'Synthetic outputs cannot become another generation source.';
  const study = packet.feedback ? state.slices.data.feedbackStudies?.[packet.feedback.studyId] : undefined;
  if (study && [study.sourceModelId, ...study.weeks.map(week => week.routingModelId).filter((id): id is string => !!id)].some(id => modelUsesSyntheticData(state, id))) return 'Feedback from a synthetic-trained model cannot become another synthetic generation source.';
  if (packet.policy || (!packet.feedback && packet.catalogId !== CONTENT.starterData.id && !DATA_CATALOG.some(item => item.id === packet.catalogId && !item.id.startsWith('policy-')))
    || syntheticSourceIds(packet).some(id => /holdout|audit|evaluation|reserved|policy/i.test(id))) return 'Reserved holdout, audit, evaluation and policy cases are excluded from synthetic training sources.';
  return null;
}
export function syntheticGenerationTerms(model: ModelVersion) {
  const family = FAMILY_SERVING_MULTIPLIER[model.family];
  return { requiredWork: mulDiv(RULES.generationBaseWork * family, modelWorkBps(model), 10000), memoryMU: model.residentMU };
}
export function syntheticRights(state: Readonly<GameState>, job: Pick<SyntheticJob, 'teacherModelId' | 'sourcePacketId'>, content: GameContent = CONTENT): DataPacket['rights'] {
  const source = state.slices.data.packets[job.sourcePacketId], teacher = inheritedModelRights(state, job.teacherModelId, content);
  return { hosted: source.rights.hosted && teacher.hosted, weights: source.rights.weights && teacher.weights, feedback: false };
}
/** Fixed authored audit bank, separate from every final model-evaluation bank.
 * Repeated sources cannot reroll which candidates were quarantined. */
export function syntheticAudit(job: SyntheticJob): SyntheticAudit {
  const qualityBps = Math.min(job.teacherScoreBps, job.teacherReliabilityBps, job.sourceQualityBps);
  const unique = RULES.candidateUnits - RULES.sourceOverlapUnits - RULES.holdoutOverlapUnits;
  const acceptedUnits = mulDiv(unique, qualityBps, 10000);
  const ordered = Array.from({ length: unique }, (_, index) => ({ index,
    order: canonicalStateHash({ protocol: RULES.auditProtocol, sourceKey: job.sourceKey, index }) }))
    .sort((a, b) => a.order.localeCompare(b.order) || a.index - b.index);
  const acceptedCaseIds = ordered.slice(0, acceptedUnits).map(item => `synthetic-case:${job.sourceKey}:${item.index}`).sort();
  const quarantinedCaseIds = [...Array.from({ length: RULES.sourceOverlapUnits }, (_, index) => `source-overlap:${job.sourceKey}:${index}`),
    ...Array.from({ length: RULES.holdoutOverlapUnits }, (_, index) => `synthetic-audit-reserved:${job.domain}:${index}`),
    ...ordered.slice(acceptedUnits).map(item => `synthetic-case:${job.sourceKey}:${item.index}`)].sort();
  const audit = { protocol: RULES.auditProtocol, bankId: `synthetic-audit-bank-1:${job.domain}`, acceptedUnits,
    sourceOverlapUnits: RULES.sourceOverlapUnits, holdoutOverlapUnits: RULES.holdoutOverlapUnits,
    qualityRejectedUnits: unique - acceptedUnits, qualityBps, acceptedCaseIds, quarantinedCaseIds };
  return { ...audit, fingerprint: canonicalStateHash({ ...audit, teacher: job.teacherFingerprint, source: job.sourceFingerprint }) };
}
export function syntheticDataPacket(job: SyntheticJob): DataPacket {
  if (!job.audit || job.audit.acceptedUnits <= 0) throw new Error('Synthetic evidence has not passed its paid audit.');
  return { id: job.outputPacketId, companyId: job.companyId, catalogId: RULES.catalogId,
    name: `Audited ${job.domain} synthetic slice`, rawUnits: job.audit.acceptedUnits, readyUnits: job.audit.acceptedUnits,
    qualityBps: job.audit.qualityBps, coverageBps: { conversation: 0, documents: 0, coding: 0, tools: 0, [job.domain]: 10000 },
    rights: { ...job.rights }, prepared: true, sourceIds: [`synthetic-source:${job.sourceKey}`], revision: 0, broadUnits: 0, behaviorUnits: 0,
    synthetic: { protocol: RULES.protocol, jobId: job.id, teacherModelId: job.teacherModelId, teacherFingerprint: job.teacherFingerprint,
      sourcePacketId: job.sourcePacketId, sourceIds: [...job.sourceIds], sourceKey: job.sourceKey, domain: job.domain, auditFingerprint: job.audit.fingerprint } };
}
