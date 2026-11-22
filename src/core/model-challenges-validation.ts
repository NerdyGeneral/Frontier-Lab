import type { GameContent, GameState } from '../contracts/types';
import { modelChallengeDefinition } from '../content/model-challenges';
import { createModelChallengeAdmission, createModelChallengeReceipt, modelChallengeCases } from '../modules/model-challenges';
import { canonicalStateHash } from './canonical';
const check = (value: unknown, message: string): void => { if (!value) throw new Error(message); };
const same = (a: unknown, b: unknown): boolean => canonicalStateHash(a) === canonicalStateHash(b);

export function assertModelChallengesState(state: GameState, _content: GameContent): void {
  for (const run of Object.values(state.slices.models.evaluationRuns)) {
    const tier = modelChallengeDefinition(run.suiteId);
    if (!tier) { check(run.challenge === undefined, 'Ordinary evaluation invented challenge admission.'); continue; }
    const expected = createModelChallengeAdmission(state, run.companyId, run.modelId, run.suiteId, run.startedWeek);
    check(expected && run.challenge && same(run.challenge, expected), 'Challenge admission changed its model, paid baseline, prior achievement or availability week.');
    const command = state.commandReceipts[run.id.slice('evaluation-'.length)];
    check(run.id.startsWith('evaluation-') && command?.status === 'accepted' && command.week === run.startedWeek, 'Challenge has no accepted paid-work admission.');
    const baseline = state.slices.models.reports[expected!.baselineReportId];
    const previous = expected!.previousAchievementReportId ? state.slices.models.reports[expected!.previousAchievementReportId] : undefined;
    check(baseline.week < run.startedWeek && (!previous || previous.week < run.startedWeek), 'Challenge admission borrowed a report that was not available at its weekly boundary.');
    check(run.requiredWork === tier.workCUw && run.requiredStaff === tier.researchStaff, 'Challenge work requirements were changed.');
    if (run.reportId) check(state.slices.models.reports[run.reportId]?.challenge, 'Completed challenge lost its result receipt.');
  }
  for (const report of Object.values(state.slices.models.reports)) {
    const tier = modelChallengeDefinition(report.suiteId);
    if (!tier) { check(report.challenge === undefined, 'Ordinary report invented a challenge achievement.'); continue; }
    const runs = Object.values(state.slices.models.evaluationRuns).filter(run => run.reportId === report.id);
    check(!report.scenarioStart && runs.length === 1, 'Challenge achievement needs exactly one paid evaluation.');
    const run = runs[0], model = state.slices.models.versions[report.modelId];
    check(run && model && run.companyId === report.companyId && run.modelId === model.id && run.suiteId === report.suiteId
      && run.status === 'complete' && run.completedWeek === report.week && run.completedWork === tier.workCUw && run.completedStaff === tier.researchStaff
      && report.id === 'report-' + run.id && run.challenge, 'Challenge result appeared before its actual GPU and research work finished.');
    const expected = createModelChallengeReceipt(model, tier.id, run.challenge!);
    check(report.challenge && same(report.challenge, expected), 'Challenge title, threshold, skill counts or earned result changed.');
    check(same(report.cases, modelChallengeCases(model, tier.id)) && report.passedCases === expected.passedCases && report.basicChatEligible === false,
      'Challenge case outcomes differ from the immutable candidate and authored benchmark.');
  }
}

