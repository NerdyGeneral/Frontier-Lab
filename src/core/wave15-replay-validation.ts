import { REPLAY_RULES as RULES } from '../content/wave15-replay';
import type { GameContent, GameState, TrainingRun } from '../contracts/types';
import type { ReplayTrainingChoice } from '../contracts/wave15-replay';
import { canonicalStateHash } from './canonical';
import { checkedInteger } from './math';
import { getCorpusEvidence } from '../modules/lab-planner';
import { createTrainingReplayReceipt, replayAdmissionIdentity, replayBaseOriginWeek, replayChoiceRejection, replayPacketAvailable, replayRecipeFocusDomains, replayResearchAvailable } from '../modules/replay-curriculum';
import { paidPolicyCapabilityBaseline } from '../modules/policy-holdouts';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

export function assertReplayTrainingChoice(value: unknown): asserts value is ReplayTrainingChoice {
  const rejection = replayChoiceRejection(value); if (rejection) throw new Error(rejection.message);
}

/** The ordinary validator supplies its independently recomputed primary work and unchanged RNG identity. */
export function assertTrainingReplay(state: GameState, run: TrainingRun, ordinaryIdentity: string,
  nominalFocusWorkCUw: number, focusWorkCUw: number, _content: GameContent): void {
  const plan = run.plan!;
  if (plan.replay === undefined) {
    check(!Object.hasOwn(plan, 'replay') && !plan.methods.includes(RULES.researchId), 'An ordinary training run acquired an empty or unearned replay method.');
    return;
  }
  const replay = plan.replay;
  check(record(replay), 'Replay training lost its frozen receipt.');
  const keys = ['domain', 'shareBps', 'baseModelId', 'baseModelFingerprint', 'baselineReportId', 'baselineScoreBps', 'ordinaryIdentity', 'corpus',
    'requiredEvidence', 'coverageBps', 'qualityBps', 'retentionBps', 'preservationFloorBps', 'nominalFocusWorkCUw', 'focusWorkCUw', 'nominalReplayWorkCUw', 'replayWorkCUw',
    ...(Object.hasOwn(replay, 'deduplication') ? ['deduplication'] : [])];
  check(Object.keys(replay).sort().join() === keys.sort().join(), 'Replay receipt contains an unknown or missing field.');
  check(record(replay.corpus), 'Replay corpus is not an immutable evidence record.');
  const choice: ReplayTrainingChoice = { domain: replay.domain, shareBps: replay.shareBps, packetIds: replay.corpus.packetIds };
  assertReplayTrainingChoice(choice);
  for (const value of [replay.baselineScoreBps, replay.requiredEvidence, replay.coverageBps, replay.qualityBps, replay.retentionBps, replay.preservationFloorBps,
    replay.nominalFocusWorkCUw, replay.focusWorkCUw, replay.nominalReplayWorkCUw, replay.replayWorkCUw]) checkedInteger(value, 'Replay training quantity');
  const focus = replayRecipeFocusDomains(run.recipeId), base = state.slices.models.versions[run.baseModelId];
  check(plan.kind === 'adaptation' && focus.length > 0 && !focus.includes(replay.domain) && !plan.adapter && !base.runtimeVariant
    && !(base.trainingRunId && state.slices.models.trainingRuns[base.trainingRunId]?.plan?.adapter),
  'Replay was applied to a focus domain, an unsupported recipe, or stacked with a deployment format or adapter.');
  check(plan.methods.includes(RULES.researchId) && replayResearchAvailable(state, run.companyId, run.startedWeek - 1),
    'Replay updates began before their paid researched method was available.');
  const admission = state.commandReceipts[run.id.slice('training-'.length)];
  check(run.id.startsWith('training-') && admission?.status === 'accepted' && admission.week === run.startedWeek,
    'Replay training has no accepted command at its saved admission boundary.');
  const report = state.slices.models.reports[replay.baselineReportId];
  const originWeek = replayBaseOriginWeek(state, base.id);
  check(base.companyId === run.companyId && base.status !== 'checkpoint' && originWeek !== null && originWeek < run.startedWeek
    && replay.baseModelId === base.id && report?.suiteId === RULES.capabilitySuiteId
    && paidPolicyCapabilityBaseline(state, base, replay.baselineReportId, run.startedWeek - 1),
  'Replay lost the incoming model’s exact paid expanded-capability evidence from before admission.');
  for (const id of replay.corpus.packetIds) {
    const packet = state.slices.data.packets[id];
    check(packet?.companyId === run.companyId && packet.prepared && packet.readyUnits > 0 && packet.rights.hosted,
      'Replay evidence is unprepared, foreign or not licensed for hosted use.');
    check(replayPacketAvailable(state, id, run.companyId, run.startedWeek - 1),
    'Replay evidence has no prior completed preparation or paid feedback review.');
  }
  const corpus = getCorpusEvidence(state, run.companyId, replay.corpus.packetIds);
  check(same(replay.corpus, corpus) && corpus.rights.hosted && corpus.relevantUnits[replay.domain] > 0 && corpus.qualityBps[replay.domain] > 0,
    'Replay changed its distinct source coverage, quality, fingerprint, or inherited rights.');
  check(!plan.corpus.sourceIds.some(id => corpus.sourceIds.includes(id)), 'Replay reused the primary adaptation’s source evidence, including another revision of the same source.');
  const expected = createTrainingReplayReceipt(state, base, choice, corpus, ordinaryIdentity, nominalFocusWorkCUw, focusWorkCUw, replay.baselineReportId);
  check(expected && same(replay, expected) && replay.baselineScoreBps > 0 && replay.preservationFloorBps <= replay.baselineScoreBps,
    'Replay changed its exact source binding, independent work/cleanup budget, or finite preservation floor.');
  check(plan.identity === replayAdmissionIdentity(ordinaryIdentity, choice, corpus), 'Replay identity was changed to reroll or stack a saved training choice.');
}
