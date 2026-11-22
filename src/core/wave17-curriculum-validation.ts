import { CURRICULUM_RULES as RULES } from '../content/wave17-curriculum';
import type { GameContent, GameState, TrainingRun } from '../contracts/types';
import type { CorpusEvidence } from '../contracts/wave2-lab';
import type { TrainingCurriculumChoice } from '../contracts/wave17-curriculum';
import { canonicalStateHash } from './canonical';
import { checkedInteger } from './math';
import { getCorpusEvidence } from '../modules/lab-planner';
import { createTrainingCurriculumReceipt, curriculumAdmissionIdentity, curriculumChoiceRejection } from '../modules/training-curriculum';
import { replayBaseOriginWeek, replayPacketAvailable, replayRecipeFocusDomains, replayResearchAvailable } from '../modules/replay-curriculum';
import { paidPolicyCapabilityBaseline } from '../modules/policy-holdouts';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function assertTrainingCurriculumChoice(value: unknown): asserts value is TrainingCurriculumChoice {
  const rejection = curriculumChoiceRejection(value); if (rejection) throw new Error(rejection.message);
}

/** Reconcile frozen receipts against real evidence and independently rebuilt primary work. */
export function assertTrainingCurriculum(state: GameState, run: TrainingRun, ordinaryIdentity: string,
  nominalFocusWorkCUw: number, focusWorkCUw: number, _content: GameContent): void {
  const plan = run.plan!;
  if (plan.curriculum === undefined) {
    check(!Object.hasOwn(plan, 'curriculum'), 'An ordinary training run acquired an empty curriculum field.');
    return;
  }
  const curriculum = plan.curriculum;
  check(record(curriculum) && !Object.hasOwn(plan, 'replay'), 'A curriculum lost its frozen receipt or stacked with one-skill replay.');
  const keys = ['shareBps', 'baseModelId', 'baseModelFingerprint', 'baselineReportId', 'ordinaryIdentity', 'nominalFocusWorkCUw',
    'focusWorkCUw', 'nominalReplayWorkCUw', 'replayWorkCUw', 'tracks'];
  check(Object.keys(curriculum).sort().join() === keys.sort().join(), 'Curriculum receipt contains an unknown or missing field.');
  check(Array.isArray(curriculum.tracks) && curriculum.tracks.length === RULES.tracks, 'Curriculum needs exactly two frozen tracks.');
  for (const track of curriculum.tracks) {
    check(record(track) && record(track.corpus), 'Curriculum track lost its immutable source corpus.');
    const trackKeys = ['domain', 'shareBps', 'baselineScoreBps', 'corpus', 'requiredEvidence', 'coverageBps', 'qualityBps', 'retentionBps',
      'preservationFloorBps', 'nominalReplayWorkCUw', 'replayWorkCUw', ...(Object.hasOwn(track, 'deduplication') ? ['deduplication'] : [])];
    check(Object.keys(track).sort().join() === trackKeys.sort().join(), 'Curriculum track contains an unknown or missing field.');
    for (const value of [track.shareBps, track.baselineScoreBps, track.requiredEvidence, track.coverageBps, track.qualityBps,
      track.retentionBps, track.preservationFloorBps, track.nominalReplayWorkCUw, track.replayWorkCUw]) checkedInteger(value, 'Curriculum track quantity');
  }
  const choice: TrainingCurriculumChoice = { shareBps: curriculum.shareBps,
    tracks: curriculum.tracks.map(track => ({ domain: track.domain, packetIds: track.corpus.packetIds })) as TrainingCurriculumChoice['tracks'] };
  assertTrainingCurriculumChoice(choice);
  for (const value of [curriculum.nominalFocusWorkCUw, curriculum.focusWorkCUw, curriculum.nominalReplayWorkCUw, curriculum.replayWorkCUw])
    checkedInteger(value, 'Curriculum work quantity');
  const focus = replayRecipeFocusDomains(run.recipeId), base = state.slices.models.versions[run.baseModelId];
  check(plan.kind === 'adaptation' && focus.length > 0 && curriculum.tracks.every(track => !focus.includes(track.domain))
    && !plan.adapter && !base.runtimeVariant && !(base.trainingRunId && state.slices.models.trainingRuns[base.trainingRunId]?.plan?.adapter),
  'Curriculum was applied to a focus skill, an unsupported recipe, a deployment variant, or an adapter.');
  check(plan.methods.includes(RULES.researchId) && replayResearchAvailable(state, run.companyId, run.startedWeek - 1),
    'Curriculum updates began before the paid replay research became available.');
  const admission = state.commandReceipts[run.id.slice('training-'.length)];
  check(run.id.startsWith('training-') && admission?.status === 'accepted' && admission.week === run.startedWeek,
    'Curriculum training has no accepted command at its saved admission boundary.');
  const originWeek = replayBaseOriginWeek(state, base.id), report = state.slices.models.reports[curriculum.baselineReportId];
  check(base.companyId === run.companyId && base.status !== 'checkpoint' && originWeek !== null && originWeek < run.startedWeek
    && curriculum.baseModelId === base.id && report?.suiteId === RULES.capabilitySuiteId
    && paidPolicyCapabilityBaseline(state, base, curriculum.baselineReportId, run.startedWeek - 1),
  'Curriculum lost the incoming model’s exact paid expanded-capability evidence from before admission.');
  const sources = new Set(plan.corpus.sourceIds);
  const corpora = curriculum.tracks.map(track => {
    for (const id of track.corpus.packetIds) {
      const packet = state.slices.data.packets[id];
      check(packet?.companyId === run.companyId && packet.prepared && packet.readyUnits > 0 && packet.rights.hosted
        && replayPacketAvailable(state, id, run.companyId, run.startedWeek - 1),
      'Curriculum evidence is foreign, unprepared, unavailable, or lacks a prior paid preparation or feedback review.');
    }
    const corpus = getCorpusEvidence(state, run.companyId, track.corpus.packetIds);
    check(same(track.corpus, corpus) && corpus.rights.hosted && corpus.relevantUnits[track.domain] > 0 && corpus.qualityBps[track.domain] > 0,
      'Curriculum changed its distinct source coverage, quality, fingerprint, or inherited rights.');
    check(!corpus.sourceIds.some(id => sources.has(id)), 'Curriculum reused a source across primary or replay roles, including another revision of the source.');
    for (const id of corpus.sourceIds) sources.add(id);
    return corpus;
  }) as [CorpusEvidence, CorpusEvidence];
  const expected = createTrainingCurriculumReceipt(state, base, choice, corpora, ordinaryIdentity, nominalFocusWorkCUw, focusWorkCUw, curriculum.baselineReportId);
  check(expected && same(curriculum, expected) && curriculum.tracks.every(track => track.baselineScoreBps > 0 && track.preservationFloorBps <= track.baselineScoreBps),
    'Curriculum changed its exact base, track order, independent work/cleanup budget, or finite preservation floors.');
  check(plan.identity === curriculumAdmissionIdentity(ordinaryIdentity, choice, corpora), 'Curriculum identity changed to reroll or stack a saved training choice.');
}
