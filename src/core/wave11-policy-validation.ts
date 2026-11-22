import type { GameContent, GameState, ModelVersion } from '../contracts/types';
import type { PolicyHoldoutAdmission } from '../contracts/wave11-policy';
import { POLICY_HOLDOUT_RULES as RULES } from '../content/wave11-policy';
import { canonicalStateHash } from './canonical';
import { capturedPolicyHoldoutAdmission, createPolicyHoldoutResult, paidPolicyCapabilityBaseline } from '../modules/policy-holdouts';

const check = (condition: unknown, message: string): void => { if (!condition) throw new Error(message); };
const same = (left: unknown, right: unknown): boolean => canonicalStateHash(left) === canonicalStateHash(right);

function assertAdmission(state: Readonly<GameState>, model: ModelVersion, admission: PolicyHoldoutAdmission | undefined, startedWeek: number): void {
  check(admission && typeof admission === 'object' && !Array.isArray(admission), 'Policy holdouts lost their reserved protocol and candidate.');
  const saved = admission!;
  check(paidPolicyCapabilityBaseline(state, model, saved.baselineReportId, startedWeek - 1),
    'Policy holdouts require this exact candidate’s paid capability report from an earlier boundary.');
  check(same(saved, capturedPolicyHoldoutAdmission(state, model, saved.baselineReportId)),
    'Policy holdouts changed their immutable candidate, protocol or reserved case set.');
}

/** Optional new evidence has strict paid-work and immutable-case proofs; legacy suites retain their published shapes. */
export function assertWave11PolicyHoldouts(state: GameState, _content: GameContent): void {
  const { models, research } = state.slices, pairs = new Set<string>();
  for (const run of Object.values(models.evaluationRuns)) {
    if (run.suiteId !== RULES.suiteId) { check(run.policy === undefined, 'An ordinary evaluation contains a policy holdout admission.'); continue; }
    const model = models.versions[run.modelId];
    check(model && model.companyId === run.companyId && model.status !== 'checkpoint', 'Policy holdouts lost their completed owned candidate.');
    check(run.holdout === undefined, 'A policy evaluation acquired an unrelated outcome-holdout receipt.');
    check((research.completedByCompany[run.companyId] ?? []).includes(RULES.researchId), 'Policy holdouts were not researched.');
    const method = Object.values(research.projects).find(project => project.companyId === run.companyId && project.researchId === RULES.researchId);
    check(method?.status === 'complete' && method.availableWeek !== undefined && method.availableWeek <= run.startedWeek,
      'Policy holdouts began before their researched evaluation method became available.');
    check(run.requiredWork === RULES.workCUw && run.requiredStaff === RULES.researchStaff, 'Policy holdouts changed their paid requirements.');
    const receipt = state.commandReceipts[run.id.slice('evaluation-'.length)];
    check(run.id.startsWith('evaluation-') && receipt?.status === 'accepted' && receipt.week === run.startedWeek,
      'Policy holdouts have no accepted admission at their saved boundary.');
    assertAdmission(state, model, run.policy, run.startedWeek);
    const pair = run.companyId + ':' + run.modelId;
    check(!pairs.has(pair), 'Policy holdouts were rerun on the same candidate.'); pairs.add(pair);
  }
  for (const report of Object.values(models.reports)) {
    if (report.suiteId !== RULES.suiteId) {
      check(report.policy === undefined && report.cases.every(item => item.policy === undefined), 'An ordinary report contains policy holdout results.');
      continue;
    }
    const model = models.versions[report.modelId], run = Object.values(models.evaluationRuns).find(item => item.reportId === report.id);
    check(run && run.suiteId === RULES.suiteId && run.companyId === report.companyId && run.modelId === report.modelId
      && run.status === 'complete' && run.completedWeek === report.week && report.id === 'report-' + run.id
      && run.completedWork === RULES.workCUw && run.completedStaff === RULES.researchStaff,
    'Policy results have no completed paid evaluation.');
    check(model && report.heldOut && !report.scenarioStart && report.basicChatEligible === false && model.evaluationReportId !== report.id,
      'Policy holdouts cannot manufacture a capability release or replace its preferred report.');
    const expected = createPolicyHoldoutResult(model, run!.policy!);
    check(same(report.policy ?? null, expected.policy) && same(report.cases, expected.cases)
      && report.passedCases === expected.cases.filter(item => item.passed).length && report.outcomes === undefined && report.holdout === undefined,
    'Policy outcomes, pressure groups or separate allowed/restricted denominators do not reconcile with their reserved cases.');
  }
}
