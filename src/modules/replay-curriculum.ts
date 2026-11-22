import { REPLAY_FOCUS_DOMAINS, REPLAY_RULES as RULES } from '../content/wave15-replay';
import { CONTENT } from '../content/catalog';
import type { CapabilityDomain, CapabilityScores, CorpusEvidence, TrainingPlan } from '../contracts/wave2-lab';
import type { ReplayTrainingChoice, TrainingReplayReceipt } from '../contracts/wave15-replay';
import type { EvaluationReport, GameState, ModelVersion, Rejection } from '../contracts/types';
import { canonicalStateHash } from '../core/canonical';
import { mulDiv } from '../core/math';
import { trainingDeduplicationReceipt } from './data-quality';
import { paidPolicyCapabilityBaseline, policyModelFingerprint } from './policy-holdouts';

const DOMAINS: readonly CapabilityDomain[] = ['conversation', 'documents', 'coding', 'tools'];
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160
  && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });

export function replayChoiceRejection(value: unknown): Rejection | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return reject('Choose a replay domain, a 25% or 50% nominal budget, and prepared replay packets.', 'INVALID_COMMAND');
  const choice = value as ReplayTrainingChoice;
  if (Object.keys(value).sort().join() !== 'domain,packetIds,shareBps' || !DOMAINS.includes(choice.domain) || !RULES.sharesBps.includes(choice.shareBps)
    || !Array.isArray(choice.packetIds) || choice.packetIds.length < 1 || choice.packetIds.length > RULES.maximumPackets
    || choice.packetIds.some(id => !identifier(id)) || new Set(choice.packetIds).size !== choice.packetIds.length)
    return reject('Replay accepts one domain, a 25% or 50% nominal budget, and up to twenty distinct packet IDs; no other fields are supported.', 'INVALID_COMMAND');
}

export const replayRecipeFocusDomains = (recipeId: string): readonly CapabilityDomain[] => REPLAY_FOCUS_DOMAINS[recipeId] ?? [];

export function replayResearchAvailable(state: Readonly<GameState>, companyId = state.playerCompanyId, atWeek = state.week): boolean {
  const project = Object.values(state.slices.research.projects).find(item => item.companyId === companyId && item.researchId === RULES.researchId);
  return !!project && project.status === 'complete' && project.availableWeek !== undefined && project.availableWeek <= atWeek
    && (state.slices.research.completedByCompany[companyId] ?? []).includes(RULES.researchId);
}

/** The authored player seed predates paid laboratory projects and intentionally has no creation timestamp. */
export function replayBaseOriginWeek(state: Readonly<GameState>, modelId: string): number | null {
  const model = state.slices.models.versions[modelId];
  if (!model) return null;
  if (model.createdWeek !== undefined) return model.createdWeek;
  return model.id === CONTENT.seedModel.id && model.companyId === CONTENT.seedModel.companyId ? 0 : null;
}

/** Expanded capability cases establish the exact prior skill; their held-out cases never become replay training data. */
export function replayPaidBaseline(state: Readonly<GameState>, modelId: string, atWeek = state.week): EvaluationReport | null {
  const model = state.slices.models.versions[modelId], originWeek = replayBaseOriginWeek(state, modelId);
  if (!model || model.status === 'checkpoint' || model.runtimeVariant || originWeek === null || originWeek > atWeek) return null;
  return Object.values(state.slices.models.reports).filter(report => report.suiteId === RULES.capabilitySuiteId
    && paidPolicyCapabilityBaseline(state, model, report.id, atWeek)).sort((a, b) => b.week - a.week || a.id.localeCompare(b.id))[0] ?? null;
}

/** Replay needs retained paid preparation evidence, even when an older valid save merely marks a packet prepared. */
export function replayPacketAvailable(state: Readonly<GameState>, packetId: string, companyId: string, atWeek = state.week): boolean {
  const packet = state.slices.data.packets[packetId];
  if (!packet || (packet.companyId ?? state.playerCompanyId) !== companyId || !packet.prepared || !packet.readyUnits || !packet.rights.hosted
    || (packet.purchasedWeek !== undefined && packet.purchasedWeek > atWeek)) return false;
  const preparation = Object.values(state.slices.data.preparationJobs).find(job => job.packetId === packetId);
  if (preparation) return preparation.companyId === companyId && preparation.status === 'complete'
    && preparation.completedStaff === preparation.requiredStaff && preparation.completedWeek !== undefined && preparation.completedWeek <= atWeek;
  const review = packet.feedback ? state.slices.data.feedbackReviews?.[packet.feedback.reviewId] : undefined;
  return !!review && review.companyId === companyId && review.status === 'complete' && review.outputPacketId === packetId
    && review.completedStaff === review.requiredStaff && review.completedWork === review.requiredWork
    && review.availableWeek !== null && review.availableWeek <= atWeek;
}

export function validateReplayTrainingOption(state: Readonly<GameState>, companyId: string, base: ModelVersion, recipeId: string,
  choice: ReplayTrainingChoice, corpus: CorpusEvidence, asAdapter?: boolean, primaryCorpus?: CorpusEvidence): Rejection | undefined {
  const malformed = replayChoiceRejection(choice); if (malformed) return malformed;
  if (!replayResearchAvailable(state, companyId)) return reject('Complete Replay curricula (R4C) before adding replay updates to an adaptation.');
  const focus = replayRecipeFocusDomains(recipeId);
  if (!focus.length || asAdapter || (base.trainingRunId && state.slices.models.trainingRuns[base.trainingRunId]?.plan?.adapter))
    return reject('Replay applies to an ordinary conversation, document, or coding/tools adaptation. Select the original model rather than an adapter or deployment format.');
  if (focus.includes(choice.domain)) return reject('Preserve one previously learned domain outside this adaptation’s focus. Its primary corpus still supplies the new skill.');
  if (base.companyId !== companyId || !replayPaidBaseline(state, base.id)) return reject('The incoming base needs its own completed paid Expanded capabilities report before a skill can be replayed.');
  for (const id of choice.packetIds) {
    const packet = state.slices.data.packets[id];
    if (!packet || (packet.companyId ?? state.playerCompanyId) !== companyId || !packet.prepared || !packet.readyUnits || !packet.rights.hosted)
      return reject('Every replay packet must be owned, fully prepared, and licensed for hosted model use.');
    if (!replayPacketAvailable(state, id, companyId))
      return reject('Replay needs an earlier completed preparation or paid feedback-review receipt. Choose documented prepared evidence, or create an eligible curated or cleaned revision of this older source.');
  }
  if (primaryCorpus?.sourceIds.some(id => corpus.sourceIds.includes(id)))
    return reject('Use distinct source evidence for replay and the primary adaptation. Renamed or curated revisions of the same source cannot fill both roles.');
  if (!corpus.relevantUnits[choice.domain] || !corpus.qualityBps[choice.domain] || !base.capabilityBps[choice.domain])
    return reject('Select prepared replay evidence that covers the existing skill. Held-out reports and policy labels do not provide ordinary replay units.');
}

/** This admission identity changes neither ordinary profile draws nor the lineage's finite targets. */
export function replayAdmissionIdentity(ordinaryIdentity: string, choice: Pick<ReplayTrainingChoice, 'domain' | 'shareBps'>,
  corpus: CorpusEvidence): string {
  return 'training-replay-' + canonicalStateHash({ ordinaryIdentity, domain: choice.domain, shareBps: choice.shareBps, replayCorpus: corpus.fingerprint });
}

export function createTrainingReplayReceipt(state: Readonly<GameState>, base: ModelVersion, choice: ReplayTrainingChoice,
  corpus: CorpusEvidence, ordinaryIdentity: string, nominalFocusWorkCUw: number, focusWorkCUw: number,
  baselineReportId = replayPaidBaseline(state, base.id)?.id): TrainingReplayReceipt | null {
  if (replayChoiceRejection(choice) || !baselineReportId) return null;
  const qualityBps = corpus.qualityBps[choice.domain], coverageBps = Math.min(10000, mulDiv(corpus.relevantUnits[choice.domain], 10000, RULES.requiredEvidence));
  const retentionBps = mulDiv(mulDiv(2 * choice.shareBps, coverageBps, 10000), qualityBps, 10000);
  const nominalReplayWorkCUw = mulDiv(nominalFocusWorkCUw, choice.shareBps, 10000 - choice.shareBps, 'ceil');
  const deduplication = trainingDeduplicationReceipt(corpus.packetIds.map(id => state.slices.data.packets[id]), nominalReplayWorkCUw);
  return { domain: choice.domain, shareBps: choice.shareBps, baseModelId: base.id, baseModelFingerprint: policyModelFingerprint(base),
    baselineReportId, baselineScoreBps: base.capabilityBps[choice.domain], ordinaryIdentity, corpus: structuredClone(corpus), requiredEvidence: RULES.requiredEvidence,
    coverageBps, qualityBps, retentionBps, preservationFloorBps: mulDiv(base.capabilityBps[choice.domain], retentionBps, 10000),
    nominalFocusWorkCUw, focusWorkCUw, nominalReplayWorkCUw, replayWorkCUw: nominalReplayWorkCUw - (deduplication?.savedWorkCUw ?? 0),
    ...(deduplication ? { deduplication } : {}) };
}

export function replayPreservationFloor(receipt: TrainingReplayReceipt, completedWork: number, requiredWork: number): number {
  return mulDiv(receipt.preservationFloorBps, Math.min(completedWork, requiredWork), requiredWork);
}

/** Rehearsal preserves a bounded portion of an already paid skill. It never creates new target headroom. */
export function applyReplayOutcome(receipt: TrainingReplayReceipt | undefined, scores: CapabilityScores,
  completedWork: number, requiredWork: number): CapabilityScores {
  if (!receipt) return scores;
  return { ...scores, [receipt.domain]: Math.max(scores[receipt.domain], replayPreservationFloor(receipt, completedWork, requiredWork)) };
}

export function trainingEvidenceFingerprint(plan: TrainingPlan): string {
  if (plan.curriculum) return 'curriculum-evidence-' + canonicalStateHash({ primary: plan.corpus.fingerprint,
    baseModelFingerprint: plan.curriculum.baseModelFingerprint, shareBps: plan.curriculum.shareBps,
    tracks: plan.curriculum.tracks.map(track => ({ domain: track.domain, corpus: track.corpus.fingerprint })) });
  if (!plan.replay) return plan.corpus.fingerprint;
  return 'replay-evidence-' + canonicalStateHash({ primary: plan.corpus.fingerprint, replay: plan.replay.corpus.fingerprint,
    baseModelFingerprint: plan.replay.baseModelFingerprint, domain: plan.replay.domain, shareBps: plan.replay.shareBps });
}
