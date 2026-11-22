import { CURRICULUM_RULES as RULES } from '../content/wave17-curriculum';
import type { GameState, ModelVersion, Rejection } from '../contracts/types';
import type { CapabilityDomain, CapabilityScores, CorpusEvidence } from '../contracts/wave2-lab';
import type { TrainingCurriculumChoice, TrainingCurriculumReceipt, TrainingCurriculumTrackReceipt } from '../contracts/wave17-curriculum';
import { canonicalStateHash } from '../core/canonical';
import { checkedAdd, mulDiv } from '../core/math';
import { trainingDeduplicationReceipt } from './data-quality';
import { policyModelFingerprint } from './policy-holdouts';
import { replayPacketAvailable, replayPaidBaseline, replayRecipeFocusDomains, replayResearchAvailable } from './replay-curriculum';

const DOMAINS: readonly CapabilityDomain[] = ['conversation', 'documents', 'coding', 'tools'];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 160
  && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const reject = (message: string, code: Rejection['code'] = 'NOT_READY'): Rejection => ({ code, message });

export function curriculumChoiceRejection(value: unknown): Rejection | undefined {
  if (!record(value) || Object.keys(value).sort().join() !== 'shareBps,tracks' || !RULES.sharesBps.includes(value.shareBps as number)
    || !Array.isArray(value.tracks) || value.tracks.length !== RULES.tracks)
    return reject('Choose exactly two replay skills and a 50% or 75% total replay budget.', 'INVALID_COMMAND');
  const domains = new Set<CapabilityDomain>();
  for (const track of value.tracks) {
    if (!record(track) || Object.keys(track).sort().join() !== 'domain,packetIds' || !DOMAINS.includes(track.domain as CapabilityDomain)
      || domains.has(track.domain as CapabilityDomain) || !Array.isArray(track.packetIds)
      || track.packetIds.length < 1 || track.packetIds.length > RULES.maximumPacketsPerTrack
      || track.packetIds.some(id => !identifier(id)) || new Set(track.packetIds).size !== track.packetIds.length)
      return reject('Each curriculum track needs a different skill and up to twenty distinct prepared packet IDs; no other fields are supported.', 'INVALID_COMMAND');
    domains.add(track.domain as CapabilityDomain);
  }
}

export function validateCurriculumTrainingOption(state: Readonly<GameState>, companyId: string, base: ModelVersion, recipeId: string,
  choice: TrainingCurriculumChoice, corpora: readonly [CorpusEvidence, CorpusEvidence], asAdapter?: boolean, primaryCorpus?: CorpusEvidence): Rejection | undefined {
  const malformed = curriculumChoiceRejection(choice); if (malformed) return malformed;
  if (!replayResearchAvailable(state, companyId)) return reject('Complete Replay curricula (R4C) before combining two replay skills.');
  const focus = replayRecipeFocusDomains(recipeId);
  if (!focus.length || asAdapter || base.runtimeVariant || (base.trainingRunId && state.slices.models.trainingRuns[base.trainingRunId]?.plan?.adapter))
    return reject('Two-skill curricula apply to an ordinary conversation, document, or coding/tools adaptation. Select the original model rather than an adapter or deployment format.');
  if (choice.tracks.some(track => focus.includes(track.domain))) return reject('Preserve two existing skills outside the adaptation’s focus; the primary corpus supplies the new specialization.');
  if (base.companyId !== companyId || !replayPaidBaseline(state, base.id)) return reject('The incoming base needs its own completed paid Expanded capabilities report before combining replay skills.');
  const usedSources = new Set(primaryCorpus?.sourceIds ?? []);
  for (let index = 0; index < choice.tracks.length; index++) {
    const track = choice.tracks[index], corpus = corpora[index];
    for (const id of track.packetIds) {
      if (!replayPacketAvailable(state, id, companyId))
        return reject('Each replay track needs owned, hosted-use evidence with an earlier completed preparation or paid feedback-review receipt.');
    }
    if (corpus.sourceIds.some(id => usedSources.has(id)))
      return reject('Use separate source evidence for the primary adaptation and each replay skill. Renamed, curated, or cleaned revisions cannot occupy different curriculum roles.');
    for (const id of corpus.sourceIds) usedSources.add(id);
    if (!corpus.relevantUnits[track.domain] || !corpus.qualityBps[track.domain] || !base.capabilityBps[track.domain])
      return reject('Each replay corpus must cover its selected incoming skill. Held-out reports and policy labels do not supply ordinary replay evidence.');
  }
}

/** Names, packet aliases, track order, and descendants cannot reroll this finite choice. */
export function curriculumAdmissionIdentity(ordinaryIdentity: string, choice: TrainingCurriculumChoice,
  corpora: readonly [CorpusEvidence, CorpusEvidence]): string {
  const tracks = choice.tracks.map((track, index) => ({ domain: track.domain, corpus: corpora[index].fingerprint }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return 'training-curriculum-' + canonicalStateHash({ ordinaryIdentity, shareBps: choice.shareBps, tracks });
}

export function createTrainingCurriculumReceipt(state: Readonly<GameState>, base: ModelVersion, choice: TrainingCurriculumChoice,
  corpora: readonly [CorpusEvidence, CorpusEvidence], ordinaryIdentity: string, nominalFocusWorkCUw: number, focusWorkCUw: number,
  baselineReportId = replayPaidBaseline(state, base.id)?.id): TrainingCurriculumReceipt | null {
  if (curriculumChoiceRejection(choice) || !baselineReportId) return null;
  const selected = choice.tracks.map((track, index) => ({ ...track, corpus: corpora[index] }))
    .sort((a, b) => a.domain.localeCompare(b.domain));
  const nominalReplayWorkCUw = mulDiv(nominalFocusWorkCUw, choice.shareBps, 10000 - choice.shareBps, 'ceil');
  // Split equal nominal shares before independent cleanup. The first canonical
  // domain receives the final fixed-point work unit when the total is odd.
  const firstWork = mulDiv(nominalReplayWorkCUw, 1, 2, 'ceil');
  const tracks = selected.map((track, index): TrainingCurriculumTrackReceipt => {
    const corpus = track.corpus, qualityBps = corpus.qualityBps[track.domain];
    const coverageBps = Math.min(10000, mulDiv(corpus.relevantUnits[track.domain], 10000, RULES.requiredEvidence));
    const retentionBps = mulDiv(mulDiv(choice.shareBps, coverageBps, 10000), qualityBps, 10000);
    const trackWork = index === 0 ? firstWork : nominalReplayWorkCUw - firstWork;
    const deduplication = trainingDeduplicationReceipt(corpus.packetIds.map(id => state.slices.data.packets[id]), trackWork);
    return { domain: track.domain, shareBps: (choice.shareBps / 2) as 2500 | 3750,
      baselineScoreBps: base.capabilityBps[track.domain], corpus: structuredClone(corpus), requiredEvidence: RULES.requiredEvidence,
      coverageBps, qualityBps, retentionBps, preservationFloorBps: mulDiv(base.capabilityBps[track.domain], retentionBps, 10000),
      nominalReplayWorkCUw: trackWork, replayWorkCUw: trackWork - (deduplication?.savedWorkCUw ?? 0),
      ...(deduplication ? { deduplication } : {}) };
  }) as [TrainingCurriculumTrackReceipt, TrainingCurriculumTrackReceipt];
  return { shareBps: choice.shareBps, baseModelId: base.id, baseModelFingerprint: policyModelFingerprint(base),
    baselineReportId, ordinaryIdentity, nominalFocusWorkCUw, focusWorkCUw, nominalReplayWorkCUw,
    replayWorkCUw: checkedAdd(tracks[0].replayWorkCUw, tracks[1].replayWorkCUw), tracks };
}

/** Paid replay retains bounded incoming skills; it adds no target headroom. */
export function applyCurriculumOutcome(receipt: TrainingCurriculumReceipt | undefined, scores: CapabilityScores,
  completedWork: number, requiredWork: number): CapabilityScores {
  if (!receipt) return scores;
  const result = { ...scores };
  for (const track of receipt.tracks) {
    const floor = mulDiv(track.preservationFloorBps, Math.min(completedWork, requiredWork), requiredWork);
    result[track.domain] = Math.max(result[track.domain], floor);
  }
  return result;
}
